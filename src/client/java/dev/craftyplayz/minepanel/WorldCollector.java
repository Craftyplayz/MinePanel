package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.PortalTracker;
import dev.craftyplayz.minepanel.telemetry.WorldInfo;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Util;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.timeline.Timelines;

import java.util.Locale;

/** Reads where the player is playing and the world around them. Client thread only. */
final class WorldCollector {
    /** How far from the target a lit portal still counts as the linked portal (X/Z only). */
    static final int PORTAL_SEARCH_RADIUS = 4;
    private static final int PORTAL_SEARCH_HEIGHT = 32;

    private WorldCollector() {
    }

    /** Identifies the world for saved data: the server address as typed, or the singleplayer world's name. */
    static String worldKey(Minecraft minecraft) {
        var server = minecraft.getSingleplayerServer();
        if (server != null) return "singleplayer:" + server.getWorldData().getLevelName();
        var data = minecraft.getCurrentServer();
        return data != null && data.ip != null && !data.ip.isBlank() ? "server:" + data.ip.trim().toLowerCase(Locale.ROOT)
                : null;
    }

    static WorldInfo collect(Minecraft minecraft, ClientLevel level, Player player) {
        String kind;
        String name;
        var server = minecraft.getSingleplayerServer();
        if (server != null) {
            kind = "singleplayer";
            name = server.getWorldData().getLevelName();
        } else {
            kind = "server";
            var data = minecraft.getCurrentServer();
            name = data == null || data.ip == null || data.ip.isBlank() ? "Unknown server" : data.ip.trim();
        }
        BlockPos feet = player.blockPosition();
        Identifier biome = level.getBiome(feet).unwrapKey().map(key -> key.identifier())
                .orElse(Identifier.withDefaultNamespace("unknown"));
        var clocks = level.clockManager();
        var timeline = level.registryAccess().get(Timelines.OVERWORLD_DAY);
        long day = timeline.map(holder -> (long) holder.value().getPeriodCount(clocks)).orElse(0L);
        long ticks = timeline.map(holder -> holder.value().getCurrentTicks(clocks)).orElse(level.getOverworldClockTime());
        String weather = level.isThundering() ? "thunder" : level.isRaining() ? "rain" : "clear";
        String gameMode = minecraft.gameMode == null ? "survival" : minecraft.gameMode.getPlayerMode().getName();
        return new WorldInfo(kind, bounded(name), biome.toString(), biomeName(biome), weather, Math.max(0, day),
                (int) Math.floorMod(ticks, 24_000L), gameMode);
    }

    private static String biomeName(Identifier biome) {
        String key = Util.makeDescriptionId("biome", biome);
        String name = Component.translatable(key).getString();
        if (name.isBlank() || name.equals(key)) {
            // Unknown (e.g. a server-side datapack biome without a translation): "cherry_grove" → "Cherry Grove".
            String[] words = biome.getPath().replace('/', ' ').split("_");
            StringBuilder readable = new StringBuilder();
            for (String word : words) {
                if (word.isEmpty()) continue;
                if (!readable.isEmpty()) readable.append(' ');
                readable.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
            }
            name = readable.isEmpty() ? biome.toString() : readable.toString();
        }
        return bounded(name);
    }

    private static String bounded(String text) {
        String trimmed = text.isBlank() ? "Unknown" : text;
        return trimmed.length() > 256 ? trimmed.substring(0, 256) : trimmed;
    }

    /** Whether the player is standing in a Nether portal block (feet or head). */
    static boolean inNetherPortal(ClientLevel level, Player player) {
        BlockPos feet = player.blockPosition();
        return level.getBlockState(feet).is(Blocks.NETHER_PORTAL) || level.getBlockState(feet.above()).is(Blocks.NETHER_PORTAL);
    }

    /** A lit Nether portal block within {@link #PORTAL_SEARCH_RADIUS} of the target column, or null. */
    static PortalTracker.Point findPortal(ClientLevel level, Player player, PortalTracker.Point target) {
        int centerY = (int) Math.floor(player.getY());
        int bottom = Math.max(level.getMinY(), centerY - PORTAL_SEARCH_HEIGHT);
        int top = Math.min(level.getMaxY(), centerY + PORTAL_SEARCH_HEIGHT);
        BlockPos.MutableBlockPos cursor = new BlockPos.MutableBlockPos();
        for (int dx = -PORTAL_SEARCH_RADIUS; dx <= PORTAL_SEARCH_RADIUS; dx++) {
            for (int dz = -PORTAL_SEARCH_RADIUS; dz <= PORTAL_SEARCH_RADIUS; dz++) {
                if (dx * dx + dz * dz > PORTAL_SEARCH_RADIUS * PORTAL_SEARCH_RADIUS) continue;
                int x = target.x() + dx;
                int z = target.z() + dz;
                if (!level.hasChunkAt(cursor.set(x, centerY, z))) continue;
                for (int y = bottom; y <= top; y++) {
                    if (level.getBlockState(cursor.set(x, y, z)).is(Blocks.NETHER_PORTAL)) {
                        return new PortalTracker.Point(x, y, z);
                    }
                }
            }
        }
        return null;
    }
}
