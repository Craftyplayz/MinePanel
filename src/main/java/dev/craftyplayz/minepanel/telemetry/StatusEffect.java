package dev.craftyplayz.minepanel.telemetry;

import java.util.regex.Pattern;

/**
 * An active status effect. {@code endsAt} is the wall-clock time it runs out (null when infinite), so the dashboard
 * counts down locally instead of receiving an update every tick. {@code beacon} marks effects kept alive by a beacon.
 */
public record StatusEffect(String id, String name, int amplifier, Long endsAt, boolean beacon) {
    public static final int MAX_EFFECTS = 64;
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");

    public StatusEffect {
        if (id == null || id.length() > 256 || !IDENTIFIER.matcher(id).matches()
                || name == null || name.isEmpty() || name.length() > 256
                || amplifier < 0 || amplifier > 255 || endsAt != null && endsAt < 0) {
            throw new IllegalArgumentException("Invalid status effect");
        }
    }

    public String toJson() {
        return "{\"id\":" + PlayerSnapshot.string(id) + ",\"name\":" + PlayerSnapshot.string(name)
                + ",\"amplifier\":" + amplifier + ",\"endsAt\":" + endsAt + ",\"beacon\":" + beacon + "}";
    }
}
