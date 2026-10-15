package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.GameplayTracker;
import dev.craftyplayz.minepanel.telemetry.PortalTracker;
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
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.AbstractFurnaceMenu;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.BeaconMenu;
import net.minecraft.world.inventory.BrewingStandMenu;
import net.minecraft.world.inventory.CartographyTableMenu;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.EnchantmentMenu;
import net.minecraft.world.inventory.GrindstoneMenu;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.inventory.ItemCombinerMenu;
import net.minecraft.world.inventory.LoomMenu;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.inventory.SmithingMenu;
import net.minecraft.world.inventory.SmokerMenu;
import net.minecraft.world.inventory.StonecutterMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
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
    /** A ground pickup is matched against inventory gains seen while a screen is open for this long. */
    private static final long GROUND_PICKUP_MILLIS = 2_000;
    private static ClientActivity instance;
    private final GameplayTracker tracker;
    private final PortalTracker portals;
    private final PickupSink pickups;
    private final Map<Entity, Long> attacked = new IdentityHashMap<>();
    private Screen openScreen;
    private String openTitle;
    private Map<String, Integer> countsAtOpen;
    private boolean diffPending;
    private String pickupSource;
    private Map<ItemKey, Integer> ownCounts;
    /** Ground pickups not yet matched to an inventory gain (only tracked while a screen is open). */
    private final Map<ItemKey, int[]> groundPickups = new HashMap<>();
    private long groundPickupAt;

    /** Receives items added to the inventory and how they got there. */
    interface PickupSink {
        void pickup(String source, ItemStack stack, int count);
    }

    ClientActivity(GameplayTracker tracker, PortalTracker portals, PickupSink pickups) {
        this.tracker = tracker;
        this.portals = portals;
        this.pickups = pickups;
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
        ownCounts = null;
        pickupSource = null;
        groundPickups.clear();
    }

    /** The pickup-animation packet for an item entity the local player collected. */
    public void pickedUp(ItemStack stack, int count) {
        if (stack.isEmpty() || count <= 0) return;
        if (ownCounts != null) {
            // A screen is open, so the inventory diff will see this gain; make sure it is labelled "Picked up".
            groundPickups.computeIfAbsent(new ItemKey(stack), key -> new int[1])[0] += count;
            groundPickupAt = now();
        }
        pickups.pickup("Picked up", stack, count);
    }

    void blockMined(BlockPos pos, BlockState state) {
        Block block = state.getBlock();
        tracker.blockMined(now(), BuiltInRegistries.BLOCK.getKey(block).toString(), block.getName().getString(),
                pos.getX(), pos.getY(), pos.getZ());
    }

    public void blockPlaced(Block block, BlockPos pos) {
        tracker.blockPlaced(now(), BuiltInRegistries.BLOCK.getKey(block).toString(), block.getName().getString(),
                pos.getX(), pos.getY(), pos.getZ());
        if (block == Blocks.OBSIDIAN) portals.obsidianPlaced(now(), pos.getX(), pos.getY(), pos.getZ());
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
        var menu = ((AbstractContainerScreen<?>) screen).getMenu();
        pickupSource = pickupSource(screen, menu);
        ownCounts = ownItems(minecraft.player, menu);
        groundPickups.clear();
    }

    void screenClosed(Screen screen) {
        if (screen != openScreen) return;
        openScreen = null;
        ownCounts = null;
        groundPickups.clear();
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
        if (ownCounts != null && openScreen instanceof AbstractContainerScreen<?> screen && minecraft.player != null) {
            trackGains(minecraft.player, screen.getMenu(), now);
        }
    }

    /** Reports items that arrived in the inventory since the last tick while a screen is open. */
    private void trackGains(Player player, AbstractContainerMenu menu, long now) {
        if (now - groundPickupAt > GROUND_PICKUP_MILLIS) groundPickups.clear();
        Map<ItemKey, Integer> current = ownItems(player, menu);
        for (var entry : current.entrySet()) {
            int gain = entry.getValue() - ownCounts.getOrDefault(entry.getKey(), 0);
            if (gain <= 0) continue;
            int[] ground = groundPickups.get(entry.getKey());
            if (ground != null) {
                int matched = Math.min(gain, ground[0]);
                gain -= matched;
                ground[0] -= matched;
                if (ground[0] == 0) groundPickups.remove(entry.getKey());
            }
            if (gain > 0) pickups.pickup(pickupSource, entry.getKey().stack, gain);
        }
        ownCounts = current;
    }

    /**
     * Items the player holds: inventory, armor, offhand, the stack on the cursor and, for crafting-style screens,
     * the input slots (which hand their items back when the screen closes). Moving items between these never
     * counts as a gain; taking a result out, or items out of a chest, does.
     */
    private static Map<ItemKey, Integer> ownItems(Player player, AbstractContainerMenu menu) {
        Map<ItemKey, Integer> counts = new HashMap<>();
        var inventory = player.getInventory();
        for (int index = 0; index < 36; index++) addOwn(counts, inventory.getItem(index));
        for (EquipmentSlot slot : new EquipmentSlot[] {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS,
                EquipmentSlot.FEET, EquipmentSlot.OFFHAND}) {
            addOwn(counts, player.getItemBySlot(slot));
        }
        addOwn(counts, menu.getCarried());
        if (isWorkspace(menu)) {
            for (Slot slot : menu.slots) {
                ItemStack stack = slot.getItem();
                // A slot that would not accept the item it holds is an output slot (crafting result, trade, ...).
                if (slot.container != inventory && !stack.isEmpty() && slot.mayPlace(stack)) addOwn(counts, stack);
            }
        }
        return counts;
    }

    /** Screens whose input slots start empty and return their items on close (unlike chests and furnaces). */
    private static boolean isWorkspace(AbstractContainerMenu menu) {
        return menu instanceof InventoryMenu || menu instanceof CraftingMenu || menu instanceof MerchantMenu
                || menu instanceof ItemCombinerMenu || menu instanceof GrindstoneMenu || menu instanceof StonecutterMenu
                || menu instanceof LoomMenu || menu instanceof CartographyTableMenu || menu instanceof EnchantmentMenu
                || menu instanceof BeaconMenu;
    }

    /** How an item that arrives while this screen is open was added to the inventory. */
    private static String pickupSource(Screen screen, AbstractContainerMenu menu) {
        if (screen instanceof CreativeModeInventoryScreen) return "Creative inventory";
        if (menu instanceof InventoryMenu || menu instanceof CraftingMenu) return "Crafted";
        if (menu instanceof SmokerMenu) return "Cooked";
        if (menu instanceof AbstractFurnaceMenu) return "Smelted";
        if (menu instanceof MerchantMenu) return "Traded";
        if (menu instanceof AnvilMenu) return "Anvil";
        if (menu instanceof SmithingMenu) return "Smithing table";
        if (menu instanceof GrindstoneMenu) return "Grindstone";
        if (menu instanceof StonecutterMenu) return "Stonecutter";
        if (menu instanceof LoomMenu) return "Loom";
        if (menu instanceof CartographyTableMenu) return "Cartography table";
        if (menu instanceof EnchantmentMenu) return "Enchanted";
        if (menu instanceof BrewingStandMenu) return "Brewed";
        String title = screen.getTitle().getString();
        return "from " + (title.isBlank() ? "container" : title.length() > 200 ? title.substring(0, 200) : title);
    }

    private static void addOwn(Map<ItemKey, Integer> counts, ItemStack stack) {
        if (!stack.isEmpty()) counts.merge(new ItemKey(stack), stack.getCount(), Integer::sum);
    }

    /** An item kind: the item and its components, ignoring the count. */
    static final class ItemKey {
        final ItemStack stack;
        private final int hash;

        ItemKey(ItemStack stack) {
            this.stack = stack.copyWithCount(1);
            hash = ItemStack.hashItemAndComponents(stack);
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof ItemKey that && hash == that.hash && ItemStack.isSameItemSameComponents(stack, that.stack);
        }

        @Override
        public int hashCode() {
            return hash;
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
