package dev.craftyplayz.minepanel.telemetry;

import java.util.Objects;

public record PlayerSnapshot(
        long revision,
        long capturedAt,
        boolean available,
        Long sessionSeconds,
        String dimension,
        Double x,
        Double y,
        Double z,
        Double health,
        Double maxHealth,
        Double absorption
) {
    public PlayerSnapshot {
        if (revision < 0 || capturedAt < 0) {
            throw new IllegalArgumentException("revision and capturedAt must be non-negative");
        }
        if (available) {
            Objects.requireNonNull(sessionSeconds, "sessionSeconds");
            Objects.requireNonNull(dimension, "dimension");
            Objects.requireNonNull(x, "x");
            Objects.requireNonNull(y, "y");
            Objects.requireNonNull(z, "z");
            Objects.requireNonNull(health, "health");
            Objects.requireNonNull(maxHealth, "maxHealth");
            Objects.requireNonNull(absorption, "absorption");
            if (sessionSeconds < 0 || !finite(x, y, z, health, maxHealth, absorption)
                    || health < 0 || maxHealth < 0 || absorption < 0) {
                throw new IllegalArgumentException("available player values must be finite and non-negative");
            }
        } else if (sessionSeconds != null || dimension != null || x != null || y != null || z != null
                || health != null || maxHealth != null || absorption != null) {
            throw new IllegalArgumentException("unavailable player values must be null");
        }
    }

    public static PlayerSnapshot unavailable(long revision, long capturedAt) {
        return new PlayerSnapshot(revision, capturedAt, false, null, null, null, null, null, null, null, null);
    }

    public String toJson() {
        return "{\"schemaVersion\":1,\"revision\":" + revision
                + ",\"capturedAt\":" + capturedAt
                + ",\"available\":" + available
                + ",\"sessionSeconds\":" + number(sessionSeconds)
                + ",\"dimension\":" + string(dimension)
                + ",\"position\":{\"x\":" + number(x) + ",\"y\":" + number(y) + ",\"z\":" + number(z) + "}"
                + ",\"health\":" + number(health)
                + ",\"maxHealth\":" + number(maxHealth)
                + ",\"absorption\":" + number(absorption) + "}";
    }

    public boolean sameValues(PlayerSnapshot other) {
        return other != null && available == other.available
                && Objects.equals(sessionSeconds, other.sessionSeconds)
                && Objects.equals(dimension, other.dimension)
                && Objects.equals(x, other.x) && Objects.equals(y, other.y) && Objects.equals(z, other.z)
                && Objects.equals(health, other.health) && Objects.equals(maxHealth, other.maxHealth)
                && Objects.equals(absorption, other.absorption);
    }

    private static boolean finite(Double... values) {
        for (Double value : values) {
            if (value == null || !Double.isFinite(value)) {
                return false;
            }
        }
        return true;
    }

    private static String number(Number value) {
        return value == null ? "null" : value.toString();
    }

    private static String string(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder result = new StringBuilder("\"");
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                case '\b' -> result.append("\\b");
                case '\f' -> result.append("\\f");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (character < 0x20) {
                        result.append(String.format("\\u%04x", (int) character));
                    } else {
                        result.append(character);
                    }
                }
            }
        }
        return result.append('"').toString();
    }
}
