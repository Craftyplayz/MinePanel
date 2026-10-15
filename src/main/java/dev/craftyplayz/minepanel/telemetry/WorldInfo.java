package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Where the player is playing and what the world around them is like. {@code kind} is "server" (with the address
 * as typed in the server list) or "singleplayer" (with the world's name). {@code time} is the time of day in ticks
 * (0 = sunrise, 6000 = noon, 13000 = night) and {@code day} the day counter shown on the F3 screen.
 */
public record WorldInfo(String kind, String name, String biome, String biomeName, String weather,
                        long day, int time, String gameMode) {
    public static final List<String> KINDS = List.of("server", "singleplayer");
    public static final List<String> WEATHER = List.of("clear", "rain", "thunder");
    public static final List<String> GAME_MODES = List.of("survival", "creative", "adventure", "spectator");
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");

    public WorldInfo {
        if (!KINDS.contains(kind) || name == null || name.isEmpty() || name.length() > 256
                || biome == null || biome.length() > 256 || !IDENTIFIER.matcher(biome).matches()
                || biomeName == null || biomeName.isEmpty() || biomeName.length() > 256
                || !WEATHER.contains(weather) || day < 0 || time < 0 || time >= 24_000
                || !GAME_MODES.contains(gameMode)) {
            throw new IllegalArgumentException("Invalid world information");
        }
    }

    public String toJson() {
        return "{\"kind\":" + PlayerSnapshot.string(kind) + ",\"name\":" + PlayerSnapshot.string(name)
                + ",\"biome\":" + PlayerSnapshot.string(biome) + ",\"biomeName\":" + PlayerSnapshot.string(biomeName)
                + ",\"weather\":" + PlayerSnapshot.string(weather) + ",\"day\":" + day + ",\"time\":" + time
                + ",\"gameMode\":" + PlayerSnapshot.string(gameMode) + "}";
    }
}
