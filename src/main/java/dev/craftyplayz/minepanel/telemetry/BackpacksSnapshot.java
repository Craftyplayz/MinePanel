package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * What the Backpacks panels can show about a backpack mod's backpacks: {@code list} indexes every known backpack
 * (in singleplayer, {@code source} "world": every backpack in the world's backpack data; on a server, "remembered":
 * the ones this player opened, as last seen), {@code last} is the most recently opened one, and {@code shown} holds the
 * full contents of the backpacks being watched (the last opened one and those the layout selects). Placed storage
 * blocks (Sophisticated Storage) are listed and shown the same way, with {@code kind} "storage" and their position.
 */
public record BackpacksSnapshot(String source, String last, List<Entry> list, List<Shown> shown) {
    public static final int MAX_LIST = 256;
    public static final int MAX_SHOWN = 8;
    public static final int MAX_ITEM_IDS = 64;
    private static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final Pattern ICON = Pattern.compile("[a-z0-9-]{1,64}");

    public BackpacksSnapshot {
        if (!"world".equals(source) && !"remembered".equals(source)) throw new IllegalArgumentException("unknown source");
        if (last != null && !UUID.matcher(last).matches()) throw new IllegalArgumentException("invalid last backpack");
        list = List.copyOf(list);
        shown = List.copyOf(shown);
        if (list.size() > MAX_LIST || shown.size() > MAX_SHOWN) throw new IllegalArgumentException("too many backpacks");
    }

    /** Where a placed storage is: its dimension's registry id and block coordinates. */
    public record Position(String dimension, int x, int y, int z) {
        public Position {
            if (!ITEM_ID.matcher(dimension).matches()) throw new IllegalArgumentException("invalid dimension");
        }

        String toJson() {
            return "{\"dimension\":" + PlayerSnapshot.string(dimension) + ",\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z
                    + "}";
        }
    }

    // A backpack has no position; a storage always has one.
    private static boolean validKind(String kind, Position position) {
        return "backpack".equals(kind) && position == null || "storage".equals(kind) && position != null;
    }

    private static String kindJson(String kind, Position position) {
        return ",\"kind\":" + PlayerSnapshot.string(kind) + ",\"position\":"
                + (position == null ? "null" : position.toJson());
    }

    /** One listed backpack; {@code name} is "" and {@code player}, {@code openedAt}, {@code icon} null when unknown. */
    public record Entry(String uuid, String name, String player, Long openedAt, String icon, List<String> items,
                       int filled, int slots, String kind, Position position) {
        public Entry {
            if (!validKind(kind, position) || !UUID.matcher(uuid).matches() || name.length() > 256 || player != null
                    && (player.isEmpty() || player.length() > 64) || icon != null && !ICON.matcher(icon).matches()
                    || filled < 0 || filled > ItemSnapshot.MAX_CONTENTS || slots < 0 || slots > ItemSnapshot.MAX_CONTENTS) {
                throw new IllegalArgumentException("invalid listed backpack");
            }
            items = List.copyOf(items);
            if (items.size() > MAX_ITEM_IDS || !items.stream().allMatch(id -> ITEM_ID.matcher(id).matches())) {
                throw new IllegalArgumentException("invalid backpack item ids");
            }
        }

        String toJson() {
            return "{\"uuid\":" + PlayerSnapshot.string(uuid) + ",\"name\":" + PlayerSnapshot.string(name)
                    + ",\"player\":" + PlayerSnapshot.string(player) + ",\"openedAt\":" + openedAt
                    + ",\"icon\":" + PlayerSnapshot.string(icon) + ",\"items\":["
                    + String.join(",", items.stream().map(PlayerSnapshot::string).toList()) + "],\"filled\":" + filled
                    + ",\"slots\":" + slots + kindJson(kind, position) + "}";
        }
    }

    /** A watched backpack's slots in order, empty ones included; empty with {@code contentsUnknown} while unseen. */
    public record Shown(String uuid, String name, boolean contentsUnknown, List<ItemSnapshot> contents, String kind,
                        Position position) {
        public Shown {
            Objects.requireNonNull(contents, "contents");
            contents = List.copyOf(contents);
            if (!validKind(kind, position) || !UUID.matcher(uuid).matches() || name.length() > 256
                    || contents.size() > ItemSnapshot.MAX_CONTENTS || contentsUnknown && !contents.isEmpty()
                    || contents.stream().anyMatch(item -> item.contents() != null)) {
                throw new IllegalArgumentException("invalid shown backpack");
            }
        }

        String toJson() {
            return "{\"uuid\":" + PlayerSnapshot.string(uuid) + ",\"name\":" + PlayerSnapshot.string(name)
                    + ",\"contentsUnknown\":" + contentsUnknown + ",\"contents\":["
                    + String.join(",", contents.stream().map(ItemSnapshot::toJson).toList()) + "]"
                    + kindJson(kind, position) + "}";
        }
    }

    public String toJson() {
        return "{\"source\":" + PlayerSnapshot.string(source) + ",\"last\":" + PlayerSnapshot.string(last)
                + ",\"list\":[" + String.join(",", list.stream().map(Entry::toJson).toList()) + "],\"shown\":["
                + String.join(",", shown.stream().map(Shown::toJson).toList()) + "]}";
    }
}
