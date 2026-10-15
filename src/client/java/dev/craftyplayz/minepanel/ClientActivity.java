package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.GameplayTracker;
import net.minecraft.advancements.AdvancementType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * Translates client-side game callbacks (Fabric events and MinePanel mixins) into gameplay history events.
 * Every method runs on the client thread.
 */
public final class ClientActivity {
    private static final long KILL_WINDOW_MILLIS = 10_000;
    private static ClientActivity instance;
    private final GameplayTracker tracker;
    private final Map<Entity, Long> attacked = new IdentityHashMap<>();
    private Screen openScreen;
    private String openTitle;
    private Map<String, Integer> countsAtOpen;
    private boolean diffPending;

    ClientActivity(GameplayTracker tracker) {
        this.tracker = tracker;
        instance = this;
    }

    /** The active instance for mixins, or {@code null} before MinePanel has initialized. */
    public static ClientActivity get() {
        return instance;
    }

    private static long now() {
        return System.currentTimeMillis();
    }

    void reset() {
        attacked.clear();
        openScreen = null;
        countsAtOpen = null;
        diffPending = false;
    }

    void blockMined(BlockPos pos, BlockState state) {
        Block block = state.getBlock();
        tracker.blockMined(now(), BuiltInRegistries.BLOCK.getKey(block).toString(), block.getName().getString(),
                pos.getX(), pos.getY(), pos.getZ());
    }

    public void blockPlaced(Block block, BlockPos pos) {
        tracker.blockPlaced(now(), BuiltInRegistries.BLOCK.getKey(block).toString(), block.getName().getString(),
                pos.getX(), pos.getY(), pos.getZ());
    }

    public void itemDropped(ItemStack stack, int count) {
        if (stack.isEmpty() || count <= 0) return;
        tracker.itemDropped(now(), BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
                stack.getHoverName().getString(), count);
    }

    public void deathMessage(Component message) {
        tracker.deathMessage(now(), message.getString());
    }

    public void damaged(DamageSource source) {
        tracker.damageSource(now(), describe(source));
    }

    public void advancement(AdvancementType type, Component title, Component description) {
        tracker.advancement(now(), type.getSerializedName(), title.getString(), description.getString());
    }

    void attackedEntity(Entity entity) {
        if (entity instanceof LivingEntity) attacked.put(entity, now());
    }

    void killStatistics(Map<String, Integer> deltas) {
        tracker.killStatistics(now(), deltas, id -> EntityType.byString(id)
                .map(type -> type.getDescription().getString()).orElse(id));
    }

    void screenOpened(Minecraft minecraft, Screen screen) {
        if (screen == openScreen || !(screen instanceof AbstractContainerScreen<?>) || minecraft.player == null) {
            return;
        }
        openScreen = screen;
        openTitle = screen instanceof CreativeModeInventoryScreen ? "creative inventory"
                : screen instanceof InventoryScreen ? "inventory" : screen.getTitle().getString();
        if (openTitle.isBlank()) openTitle = "container";
        countsAtOpen = countItems(minecraft.player);
        tracker.containerOpened(now(), openTitle);
    }

    void screenClosed(Screen screen) {
        if (screen != openScreen) return;
        openScreen = null;
        // The carried stack returns to the inventory after closing, so compare on the next tick.
        diffPending = true;
    }

    /** Called every client tick while in a world. */
    void tick(Minecraft minecraft) {
        long now = now();
        Iterator<Map.Entry<Entity, Long>> entries = attacked.entrySet().iterator();
        while (entries.hasNext()) {
            var entry = entries.next();
            Entity entity = entry.getKey();
            if (entity instanceof LivingEntity living && living.isDeadOrDying()) {
                tracker.killed(now, BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString(),
                        entity.getName().getString());
                entries.remove();
            } else if (entity.isRemoved() || now - entry.getValue() > KILL_WINDOW_MILLIS) {
                entries.remove();
            }
        }
        if (diffPending && minecraft.player != null && countsAtOpen != null) {
            diffPending = false;
            Map<String, Integer> after = countItems(minecraft.player);
            Map<String, Integer> changes = new HashMap<>();
            for (String name : countsAtOpen.keySet()) changes.merge(name, -countsAtOpen.get(name), Integer::sum);
            for (String name : after.keySet()) changes.merge(name, after.get(name), Integer::sum);
            changes.values().removeIf(value -> value == 0);
            tracker.inventoryChanged(now, openTitle, changes);
            countsAtOpen = null;
        }
    }

    private static Map<String, Integer> countItems(Player player) {
        Map<String, Integer> counts = new HashMap<>();
        var inventory = player.getInventory();
        for (int index = 0; index < 36; index++) add(counts, inventory.getItem(index));
        for (EquipmentSlot slot : new EquipmentSlot[] {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS,
                EquipmentSlot.FEET, EquipmentSlot.OFFHAND}) {
            add(counts, player.getItemBySlot(slot));
        }
        return counts;
    }

    private static void add(Map<String, Integer> counts, ItemStack stack) {
        if (!stack.isEmpty()) counts.merge(stack.getHoverName().getString(), stack.getCount(), Integer::sum);
    }

    private static String describe(DamageSource source) {
        Entity cause = source.getEntity();
        Entity direct = source.getDirectEntity();
        if (cause != null) {
            String name = cause.getName().getString();
            return direct != null && direct != cause ? direct.getName().getString() + " from " + name : name;
        }
        if (direct != null) return direct.getName().getString();
        String type = source.typeHolder().unwrapKey().map(key -> key.identifier().getPath()).orElse(source.getMsgId());
        String words = type.replace('_', ' ').replaceAll("([a-z])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
        return words.isEmpty() ? "Unknown source" : Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }
}
