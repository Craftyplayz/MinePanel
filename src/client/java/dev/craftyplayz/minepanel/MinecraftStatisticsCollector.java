package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.StatisticsTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundAwardStatsPacket;
import net.minecraft.network.protocol.game.ServerboundClientCommandPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.stats.Stat;
import net.minecraft.stats.StatType;
import net.minecraft.stats.Stats;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Connection-scoped statistics synchronized by the server; accessed only on the client thread. */
public final class MinecraftStatisticsCollector {
    private static final Map<StatType<?>, String> CATEGORIES = Map.of(
            Stats.CUSTOM, "General", Stats.BLOCK_MINED, "Mined", Stats.ITEM_CRAFTED, "Crafted",
            Stats.ITEM_USED, "Used", Stats.ITEM_BROKEN, "Broken", Stats.ITEM_PICKED_UP, "Picked up",
            Stats.ITEM_DROPPED, "Dropped", Stats.ENTITY_KILLED, "Killed", Stats.ENTITY_KILLED_BY, "Killed by");
    private static ClientPacketListener connection;
    private static final Set<Stat<?>> received = new LinkedHashSet<>();
    private static final Map<Stat<?>, String[]> names = new HashMap<>();
    private static boolean baselineReceived;
    private static final Map<String, Integer> kills = new HashMap<>();
    private static Consumer<Map<String, Integer>> killListener;

    private MinecraftStatisticsCollector() {
    }

    static void reset(ClientPacketListener listener) {
        connection = listener;
        received.clear();
        kills.clear();
        baselineReceived = false;
    }

    /** Labels are translated, so they are rebuilt after a language or resource reload. */
    static void clearNames() {
        names.clear();
    }

    public static void received(ClientPacketListener listener, ClientboundAwardStatsPacket packet) {
        if (listener != connection) return;
        Map<String, Integer> killDeltas = new HashMap<>();
        for (var entry : packet.stats().object2IntEntrySet()) {
            var stat = entry.getKey();
            received.add(stat);
            if (stat.getType() == Stats.ENTITY_KILLED && stat.getValue() instanceof EntityType<?> type) {
                String id = BuiltInRegistries.ENTITY_TYPE.getKey(type).toString();
                Integer previous = kills.put(id, entry.getIntValue());
                // The first packet after joining carries every stat; it is the baseline, not new kills.
                int before = previous != null ? previous : baselineReceived ? 0 : entry.getIntValue();
                if (entry.getIntValue() > before) killDeltas.put(id, entry.getIntValue() - before);
            }
        }
        baselineReceived = true;
        if (!killDeltas.isEmpty() && killListener != null) killListener.accept(killDeltas);
    }

    static void onKills(Consumer<Map<String, Integer>> listener) {
        killListener = listener;
    }

    static void request(ClientPacketListener listener) {
        if (listener == connection) {
            listener.send(new ServerboundClientCommandPacket(ServerboundClientCommandPacket.Action.REQUEST_STATS));
        }
    }

    /**
     * Every received statistic, plus every general ("custom") statistic once the first full packet has arrived:
     * the server omits statistics that are still zero, so those are known to be zero rather than unknown.
     */
    static List<StatisticsTracker.Sample> collect(Minecraft client) {
        List<StatisticsTracker.Sample> result = new ArrayList<>();
        if (client.player == null || client.getConnection() != connection || !baselineReceived) return result;
        var counter = client.player.getStats();
        Set<Stat<?>> stats = new LinkedHashSet<>(received);
        for (Identifier custom : BuiltInRegistries.CUSTOM_STAT) stats.add(Stats.CUSTOM.get(custom));
        for (Stat<?> stat : stats) {
            String[] name = names.computeIfAbsent(stat, MinecraftStatisticsCollector::describe);
            if (name == null) continue;
            result.add(new StatisticsTracker.Sample(name[0], name[1], name[2], counter.getValue(stat),
                    value -> stat.format((int) Math.min(Integer.MAX_VALUE, value))));
        }
        return result;
    }

    /** {id, label, category}, or null for a statistic whose registry key cannot be resolved. */
    private static <T> String[] describe(Stat<T> stat) {
        StatType<T> type = stat.getType();
        Identifier typeId = BuiltInRegistries.STAT_TYPE.getKey(type);
        Identifier valueId = ((Registry<T>) type.getRegistry()).getKey(stat.getValue());
        if (typeId == null || valueId == null
                || !dev.craftyplayz.minepanel.telemetry.StatisticsSnapshot.validId(typeId + "/" + valueId)) {
            return null;
        }
        T value = stat.getValue();
        String label;
        if (value instanceof Identifier custom) {
            label = Component.translatable("stat." + custom.toString().replace(':', '.')).getString();
        } else if (value instanceof Block block) {
            label = block.getName().getString();
        } else if (value instanceof Item item) {
            label = item.getName(new ItemStack(item)).getString();
        } else if (value instanceof EntityType<?> entity) {
            label = entity.getDescription().getString();
        } else {
            label = valueId.toString();
        }
        String category = CATEGORIES.getOrDefault(type, type.getDisplayName().getString());
        return new String[] {typeId + "/" + valueId, label.isBlank() ? valueId.toString() : truncate(label),
                truncate(category.isBlank() ? typeId.toString() : category)};
    }

    private static String truncate(String value) {
        return value.length() <= 256 ? value : value.substring(0, 256);
    }
}
