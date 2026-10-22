package dev.craftyplayz.minepanel;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.mojang.serialization.JsonOps;
import dev.craftyplayz.minepanel.service.WorldStore;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import dev.craftyplayz.minepanel.telemetry.PlayerDetails;
import dev.craftyplayz.minepanel.telemetry.VillagerSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.ContainerScreen;
import net.minecraft.client.gui.screens.inventory.MerchantScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.Entity;
//? if >=26.1 {
import net.minecraft.world.entity.npc.villager.Villager;
//?} else {
/*import net.minecraft.world.entity.npc.Villager;
*///?}
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.MerchantOffer;

import java.util.ArrayList;
import java.util.List;

/**
 * Feeds the per-world {@link WorldStore}: the trades of villagers the player opens, where those villagers are while
 * they are nearby, the contents of the player's ender chest whenever it is open, and (through {@link Backpacks}) of
 * backpacks. Also turns the stored data
 * back into dashboard values, rebuilt only when the store or the icon keys change. Client thread only.
 */
final class WorldDataCollector {
    /** The trading screen must open this soon after right-clicking the villager to be attributed to it. */
    private static final long INTERACTION_MILLIS = 5_000;
    private static final double MOVED_SQUARED = 1.0;
    private static final int POSITION_INTERVAL_TICKS = 20;

    private final WorldStore store;
    private Villager interacted;
    private long interactedAt;
    private MerchantScreen tradingScreen;
    private long tradingSince;
    private List<WorldStore.Trade> lastTrades;
    private int ticks;
    private long builtRevision = -1;
    private int builtEpoch = -1;
    private List<VillagerSnapshot> villagers = List.of();
    private PlayerDetails.EnderChest enderChest;

    WorldDataCollector(WorldStore store) {
        this.store = store;
    }

    void reset() {
        interacted = null;
        tradingScreen = null;
        lastTrades = null;
        Backpacks.reset();
    }

    /** Fabric's entity-use callback: remember the villager in case its trading screen opens next. */
    void interacted(Entity entity) {
        if (entity instanceof Villager villager) {
            interacted = villager;
            interactedAt = System.currentTimeMillis();
        }
    }

    void tick(Minecraft minecraft, ClientLevel level) {
        long now = System.currentTimeMillis();
        if (minecraft.screen instanceof MerchantScreen screen) {
            if (screen != tradingScreen) {
                tradingScreen = screen;
                tradingSince = now;
                lastTrades = null;
            }
            if (interacted != null && tradingSince - interactedAt <= INTERACTION_MILLIS) {
                recordTrades(level, screen, now);
            }
        } else {
            tradingScreen = null;
        }
        if (minecraft.screen instanceof ContainerScreen screen && isEnderChest(screen)) {
            var container = screen.getMenu().getContainer();
            if (container.getContainerSize() >= 27) {
                List<JsonElement> slots = new ArrayList<>(27);
                for (int slot = 0; slot < 27; slot++) slots.add(encode(level, container.getItem(slot)));
                store.enderChest(new WorldStore.EnderChest(now, slots));
            }
        }
        Backpacks.tick(minecraft, store);
        if (++ticks % POSITION_INTERVAL_TICKS == 0) trackNearby(level, now);
    }

    private static boolean isEnderChest(ContainerScreen screen) {
        return screen.getTitle().getContents() instanceof TranslatableContents title
                && "container.enderchest".equals(title.getKey());
    }

    private void recordTrades(ClientLevel level, MerchantScreen screen, long now) {
        var offers = screen.getMenu().getOffers();
        // Offers arrive in a packet just after the screen opens; wait for them.
        if (offers.isEmpty()) return;
        List<WorldStore.Trade> trades = new ArrayList<>();
        for (MerchantOffer offer : offers) {
            if (trades.size() == VillagerSnapshot.MAX_TRADES) break;
            JsonElement costA = encode(level, offer.getCostA());
            JsonElement result = encode(level, offer.getResult());
            if (costA.isJsonNull() || result.isJsonNull()) continue;
            JsonElement costB = encode(level, offer.getCostB());
            trades.add(new WorldStore.Trade(costA, costB.isJsonNull() ? null : costB, result, offer.getUses(),
                    offer.getMaxUses()));
        }
        if (trades.equals(lastTrades)) return;
        lastTrades = trades;
        Villager villager = interacted;
        var data = villager.getVillagerData();
        //? if >=26.1 {
        String profession = data.profession().unwrapKey().map(key -> key.identifier().toString())
                .orElse("minecraft:none");
        int villagerLevel = data.level();
        //?} else {
        /*String profession = BuiltInRegistries.VILLAGER_PROFESSION.getKey(data.getProfession()).toString();
        int villagerLevel = data.getLevel();
        *///?}
        String name = villager.hasCustomName() ? bounded(villager.getCustomName().getString()) : null;
        store.putVillager(new WorldStore.Villager(villager.getStringUUID(), profession,
                Math.max(1, Math.min(5, villagerLevel)), name, level.dimension().identifier().toString(),
                villager.getX(), villager.getY(), villager.getZ(), now, tradingSince, trades));
    }

    /** Updates the last-seen position (and profession/level) of remembered villagers that are loaded nearby. */
    private void trackNearby(ClientLevel level, long now) {
        String dimension = level.dimension().identifier().toString();
        for (Entity entity : level.entitiesForRendering()) {
            if (!(entity instanceof Villager villager)) continue;
            WorldStore.Villager known = store.villager(villager.getStringUUID());
            if (known == null) continue;
            var data = villager.getVillagerData();
            //? if >=26.1 {
            String profession = data.profession().unwrapKey().map(key -> key.identifier().toString())
                    .orElse(known.profession());
            int villagerLevel = Math.max(1, Math.min(5, data.level()));
            //?} else {
            /*String profession = BuiltInRegistries.VILLAGER_PROFESSION.getKey(data.getProfession()).toString();
            int villagerLevel = Math.max(1, Math.min(5, data.getLevel()));
            *///?}
            double dx = known.x() - villager.getX();
            double dy = known.y() - villager.getY();
            double dz = known.z() - villager.getZ();
            if (!known.dimension().equals(dimension) || dx * dx + dy * dy + dz * dz > MOVED_SQUARED
                    || !known.profession().equals(profession) || known.level() != villagerLevel) {
                store.putVillager(known.withPosition(dimension, villager.getX(), villager.getY(), villager.getZ(), now,
                        profession, villagerLevel));
            }
        }
    }

    /** Dashboard values for the stored villagers, rebuilt only when something changed. */
    List<VillagerSnapshot> villagers(Minecraft minecraft, ClientLevel level, IconRenderer icons) {
        rebuild(minecraft, level, icons);
        return villagers;
    }

    PlayerDetails.EnderChest enderChest(Minecraft minecraft, ClientLevel level, IconRenderer icons) {
        rebuild(minecraft, level, icons);
        return enderChest;
    }

    private void rebuild(Minecraft minecraft, ClientLevel level, IconRenderer icons) {
        long revision = store.revision();
        if (revision == builtRevision && icons.epoch() == builtEpoch) return;
        builtRevision = revision;
        builtEpoch = icons.epoch();
        var professions = level.registryAccess().lookupOrThrow(Registries.VILLAGER_PROFESSION);
        List<VillagerSnapshot> built = new ArrayList<>();
        for (WorldStore.Villager villager : store.villagers()) {
            List<VillagerSnapshot.Trade> trades = new ArrayList<>();
            for (WorldStore.Trade trade : villager.trades()) {
                ItemSnapshot costA = item(minecraft, level, icons, trade.costA());
                ItemSnapshot result = item(minecraft, level, icons, trade.result());
                if (costA.empty() || result.empty()) continue;
                ItemSnapshot costB = trade.costB() == null ? null : item(minecraft, level, icons, trade.costB());
                trades.add(new VillagerSnapshot.Trade(costA, costB == null || costB.empty() ? null : costB, result,
                        trade.uses(), trade.maxUses()));
            }
            Identifier id = Identifier.tryParse(villager.profession());
            //? if >=26.1 {
            String professionName = id == null ? villager.profession()
                    : professions.get(ResourceKey.create(Registries.VILLAGER_PROFESSION, id))
                    .map(holder -> holder.value().name().getString()).orElse(id.getPath());
            //?} else {
            /*// Professions had no display name yet; the villager's title is translated by profession path.
            String professionName = id == null ? villager.profession()
                    : Component.translatable("entity.minecraft.villager." + id.getPath()).getString();
            *///?}
            built.add(new VillagerSnapshot(villager.uuid(), villager.profession(), bounded(professionName),
                    villager.level(), villager.name(), villager.dimension(), villager.x(), villager.y(), villager.z(),
                    villager.seenAt(), villager.tradedAt(), trades));
        }
        villagers = List.copyOf(built);
        WorldStore.EnderChest stored = store.enderChest();
        if (stored == null) {
            enderChest = null;
        } else {
            List<ItemSnapshot> slots = new ArrayList<>(27);
            for (JsonElement slot : stored.slots()) {
                slots.add(slot.isJsonNull() ? ItemSnapshot.emptyItem() : item(minecraft, level, icons, slot));
            }
            enderChest = new PlayerDetails.EnderChest(stored.seenAt(), slots);
        }
    }

    private static ItemSnapshot item(Minecraft minecraft, ClientLevel level, IconRenderer icons, JsonElement json) {
        ItemStack stack = ItemStack.CODEC.parse(level.registryAccess().createSerializationContext(JsonOps.INSTANCE), json)
                .result().orElse(ItemStack.EMPTY);
        return MinecraftInventoryCollector.item(minecraft, stack, icons);
    }

    private static JsonElement encode(ClientLevel level, ItemStack stack) {
        if (stack.isEmpty()) return JsonNull.INSTANCE;
        return ItemStack.CODEC.encodeStart(level.registryAccess().createSerializationContext(JsonOps.INSTANCE), stack)
                .result().filter(JsonElement::isJsonObject).orElse(JsonNull.INSTANCE);
    }

    private static String bounded(String text) {
        String value = text.isBlank() ? "Villager" : text;
        return value.length() > 256 ? value.substring(0, 256) : value;
    }
}
