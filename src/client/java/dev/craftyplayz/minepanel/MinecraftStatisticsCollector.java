package dev.craftyplayz.minepanel;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.EntityType;
import net.minecraft.network.protocol.game.ClientboundAwardStatsPacket;
import net.minecraft.network.protocol.game.ServerboundClientCommandPacket;
import net.minecraft.stats.Stats;
import net.minecraft.resources.Identifier;

import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Connection-scoped synchronization evidence; accessed only on the client thread. */
public final class MinecraftStatisticsCollector {
    private static ClientPacketListener connection;
    private static final Set<String> received = new HashSet<>();
    private static final Map<String, Integer> kills = new HashMap<>();
    private static boolean killBaselineReceived;
    private static Consumer<Map<String, Integer>> killListener;
    private static final Map<String, Identifier> TRACKED = Map.ofEntries(
            Map.entry("minecraft:walk_one_cm", Stats.WALK_ONE_CM),
            Map.entry("minecraft:sprint_one_cm", Stats.SPRINT_ONE_CM),
            Map.entry("minecraft:swim_one_cm", Stats.SWIM_ONE_CM),
            Map.entry("minecraft:fly_one_cm", Stats.FLY_ONE_CM),
            Map.entry("minecraft:jump", Stats.JUMP),
            Map.entry("minecraft:deaths", Stats.DEATHS),
            Map.entry("minecraft:mob_kills", Stats.MOB_KILLS),
            Map.entry("minecraft:player_kills", Stats.PLAYER_KILLS),
            Map.entry("minecraft:play_time", Stats.PLAY_TIME),
            Map.entry("minecraft:leave_game", Stats.LEAVE_GAME));

    private MinecraftStatisticsCollector() {
    }

    static void reset(ClientPacketListener listener) {
        connection = listener;
        received.clear();
        kills.clear();
        killBaselineReceived = false;
    }

    public static void received(ClientPacketListener listener, ClientboundAwardStatsPacket packet) {
        if (listener != connection) return;
        Map<String, Integer> killDeltas = new HashMap<>();
        for (var entry : packet.stats().object2IntEntrySet()) {
            var stat = entry.getKey();
            if (stat.getType() == Stats.CUSTOM) {
                String id = stat.getValue().toString();
                if (TRACKED.containsKey(id)) received.add(id);
            } else if (stat.getType() == Stats.ENTITY_KILLED && stat.getValue() instanceof EntityType<?> type) {
                String id = BuiltInRegistries.ENTITY_TYPE.getKey(type).toString();
                Integer previous = kills.put(id, entry.getIntValue());
                // The first packet after joining carries every stat; it is the baseline, not new kills.
                int before = previous != null ? previous : killBaselineReceived ? 0 : entry.getIntValue();
                if (entry.getIntValue() > before) killDeltas.put(id, entry.getIntValue() - before);
            }
        }
        killBaselineReceived = true;
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

    static Map<String, Long> collect(Minecraft client) {
        Map<String, Long> result = new HashMap<>();
        if (client.player == null || client.getConnection() != connection) return result;
        for (var stat : TRACKED.entrySet()) {
            if (received.contains(stat.getKey())) {
                result.put(stat.getKey(), (long) client.player.getStats().getValue(Stats.CUSTOM, stat.getValue()));
            }
        }
        return result;
    }
}
