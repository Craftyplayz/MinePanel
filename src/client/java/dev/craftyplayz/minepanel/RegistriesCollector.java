package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.Registries;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.stats.Stats;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Block;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Lists the game's registries once per connection for the rule editor's pickers (see {@link Registries}). Icons are
 * only rendered when the dashboard asks for one. Rebuilt when resource packs change, since that changes icon keys and
 * names. Client thread only.
 */
final class RegistriesCollector {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private Registries registries;
    private int epoch;

    void reset() {
        registries = null;
    }

    Registries collect(ClientLevel level, IconRenderer icons) {
        if (registries != null && epoch == icons.epoch()) return registries;
        epoch = icons.epoch();
        try {
            registries = build(level, icons);
        } catch (RuntimeException failure) {
            LOGGER.log(Level.WARNING, "MinePanel could not list the game's registries; rule pickers will only suggest "
                    + "what the dashboard has seen.", failure);
            registries = Registries.EMPTY;
        }
        return registries;
    }

    private static Registries build(ClientLevel level, IconRenderer icons) {
        List<Entry> items = new ArrayList<>();
        for (Item item : BuiltInRegistries.ITEM) {
            if (item == Items.AIR) continue;
            ItemStack stack = new ItemStack(item);
            add(items, BuiltInRegistries.ITEM.getKey(item), item.getName(stack), icons.deferredKey(stack));
        }
        List<Entry> blocks = new ArrayList<>();
        for (Block block : BuiltInRegistries.BLOCK) {
            Item item = block.asItem();
            if (block.defaultBlockState().isAir()) continue;
            add(blocks, BuiltInRegistries.BLOCK.getKey(block), block.getName(),
                    item == Items.AIR ? null : icons.deferredKey(new ItemStack(item)));
        }
        List<Entry> entities = new ArrayList<>();
        for (var type : BuiltInRegistries.ENTITY_TYPE) {
            Identifier id = BuiltInRegistries.ENTITY_TYPE.getKey(type);
            Item egg = BuiltInRegistries.ITEM.getOptional(id.withSuffix("_spawn_egg")).orElse(Items.AIR);
            add(entities, id, type.getDescription(), egg == Items.AIR ? null : icons.deferredKey(new ItemStack(egg)));
        }
        List<Entry> effects = new ArrayList<>();
        for (var effect : BuiltInRegistries.MOB_EFFECT) {
            add(effects, BuiltInRegistries.MOB_EFFECT.getKey(effect), effect.getDisplayName(), null);
        }
        List<Entry> biomes = new ArrayList<>();
        for (Identifier id : level.registryAccess().lookupOrThrow(net.minecraft.core.registries.Registries.BIOME).keySet()) {
            add(biomes, id, Component.literal(WorldCollector.biomeName(id)), null);
        }
        List<Entry> stats = new ArrayList<>();
        Identifier custom = BuiltInRegistries.STAT_TYPE.getKey(Stats.CUSTOM);
        for (Identifier id : BuiltInRegistries.CUSTOM_STAT) {
            add(stats, custom + "/" + id, Component.translatable("stat." + id.toString().replace(':', '.')), null);
        }
        return new Registries(entries(items), entries(blocks), entries(entities),
                entries(effects), entries(biomes), entries(stats));
    }

    private record Entry(String id, String name, String icon) {
    }

    private static void add(List<Entry> list, Object id, Component name, String icon) {
        if (list.size() >= Registries.MAX_ENTRIES) return;
        String text = name.getString();
        if (text.isBlank()) text = id.toString();
        list.add(new Entry(id.toString(), text.length() > 256 ? text.substring(0, 256) : text, icon));
    }

    /** Entries with an id the protocol accepts (modded registries could hold others), sorted by name. */
    private static List<Registries.Entry> entries(List<Entry> list) {
        List<Registries.Entry> result = new ArrayList<>();
        for (Entry entry : list) {
            try {
                result.add(new Registries.Entry(entry.id, entry.name, entry.icon));
            } catch (IllegalArgumentException invalid) {
                // Skipped: not representable in the protocol.
            }
        }
        result.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
        return result;
    }
}
