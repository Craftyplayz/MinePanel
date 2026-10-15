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
        Double absorption,
        InventorySnapshot inventory,
        StatisticsSnapshot statistics,
        GameplayHistory history
) {
    public PlayerSnapshot(long revision, long capturedAt, boolean available, Long sessionSeconds, String dimension,
                          Double x, Double y, Double z, Double health, Double maxHealth, Double absorption,
                          InventorySnapshot inventory) {
        this(revision, capturedAt, available, sessionSeconds, dimension, x, y, z, health, maxHealth, absorption,
                inventory, null, GameplayHistory.empty());
    }

    public PlayerSnapshot(long revision, long capturedAt, boolean available, Long sessionSeconds, String dimension,
                          Double x, Double y, Double z, Double health, Double maxHealth, Double absorption) {
        this(revision, capturedAt, available, sessionSeconds, dimension, x, y, z, health, maxHealth, absorption,
                available ? InventorySnapshot.empty() : null);
    }

    public PlayerSnapshot {
        Objects.requireNonNull(history, "history");
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
            Objects.requireNonNull(inventory, "inventory");
            if (dimension.length() > 256 || sessionSeconds < 0 || !finite(x, y, z, health, maxHealth, absorption)
                    || health < 0 || maxHealth < 0 || absorption < 0) {
                throw new IllegalArgumentException("available player values must be finite and non-negative");
            }
        } else if (sessionSeconds != null || dimension != null || x != null || y != null || z != null
                || health != null || maxHealth != null || absorption != null || inventory != null || statistics != null
                || history.active()) {
            throw new IllegalArgumentException("unavailable player values must be null");
        }
    }

    public static PlayerSnapshot unavailable(long revision, long capturedAt) {
        return new PlayerSnapshot(revision, capturedAt, false, null, null, null, null, null, null, null, null);
    }

    public static PlayerSnapshot unavailable(long revision, long capturedAt, GameplayHistory history) {
        return new PlayerSnapshot(revision, capturedAt, false, null, null, null, null, null, null, null, null,
                null, null, history);
    }

    public String toJson() {
        return "{\"schemaVersion\":2,\"revision\":" + revision
                + ",\"capturedAt\":" + capturedAt
                + ",\"available\":" + available
                + ",\"sessionSeconds\":" + number(sessionSeconds)
                + ",\"dimension\":" + string(dimension)
                + ",\"position\":{\"x\":" + number(x) + ",\"y\":" + number(y) + ",\"z\":" + number(z) + "}"
                + ",\"health\":" + number(health)
                + ",\"maxHealth\":" + number(maxHealth)
                + ",\"absorption\":" + number(absorption)
                + ",\"inventory\":" + (inventory == null ? "null" : inventory.toJson())
                + ",\"statistics\":" + (statistics == null ? "null" : statistics.toJson())
                + ",\"history\":" + history.toJson() + "}";
    }

    public String toDeltaJson(PlayerSnapshot previous) {
        if (previous == null) {
            return toJson();
        }
        if (available != previous.available) {
            String full = toJson();
            return full.substring(0, full.length() - 1) + ",\"baseRevision\":" + previous.revision + "}";
        }
        StringBuilder json = new StringBuilder("{\"schemaVersion\":2,\"revision\":")
                .append(revision).append(",\"baseRevision\":").append(previous.revision)
                .append(",\"capturedAt\":").append(capturedAt);
        if (!Objects.equals(sessionSeconds, previous.sessionSeconds)) {
            appendField(json, "sessionSeconds", number(sessionSeconds));
        }
        if (!Objects.equals(dimension, previous.dimension)) {
            appendField(json, "dimension", string(dimension));
        }
        if (!Objects.equals(x, previous.x) || !Objects.equals(y, previous.y) || !Objects.equals(z, previous.z)) {
            json.append(",\"position\":{");
            boolean separator = false;
            if (!Objects.equals(x, previous.x)) {
                json.append("\"x\":").append(number(x));
                separator = true;
            }
            if (!Objects.equals(y, previous.y)) {
                if (separator) json.append(',');
                json.append("\"y\":").append(number(y));
                separator = true;
            }
            if (!Objects.equals(z, previous.z)) {
                if (separator) json.append(',');
                json.append("\"z\":").append(number(z));
            }
            json.append('}');
        }
        if (!Objects.equals(health, previous.health)) appendField(json, "health", number(health));
        if (!Objects.equals(maxHealth, previous.maxHealth)) appendField(json, "maxHealth", number(maxHealth));
        if (!Objects.equals(absorption, previous.absorption)) appendField(json, "absorption", number(absorption));
        if (!Objects.equals(inventory, previous.inventory)) {
            appendField(json, "inventory", inventory == null ? "null" : inventory.toDeltaJson(previous.inventory));
        }
        if (!Objects.equals(statistics, previous.statistics)) {
            appendField(json, "statistics", statistics == null ? "null" : statistics.toJson());
        }
        if (!Objects.equals(history, previous.history)) {
            appendField(json, "history", history.toDeltaJson(previous.history));
        }
        return json.append('}').toString();
    }

    public boolean sameValues(PlayerSnapshot other) {
        return other != null && available == other.available
                && Objects.equals(sessionSeconds, other.sessionSeconds)
                && Objects.equals(dimension, other.dimension)
                && Objects.equals(x, other.x) && Objects.equals(y, other.y) && Objects.equals(z, other.z)
                && Objects.equals(health, other.health) && Objects.equals(maxHealth, other.maxHealth)
                && Objects.equals(absorption, other.absorption)
                && Objects.equals(inventory, other.inventory)
                && Objects.equals(statistics, other.statistics)
                && Objects.equals(history, other.history);
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

    private static void appendField(StringBuilder json, String name, String value) {
        json.append(",\"").append(name).append("\":").append(value);
    }

    static String string(String value) {
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
