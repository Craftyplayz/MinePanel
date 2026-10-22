package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * What the Ender Storage panels can show about Ender Storage's ender chests, one per frequency. A chest's
 * {@code key} is its three colours, left to right, then its owner's UUID for a personal chest:
 * {@code white.red.light_blue} or {@code white.red.light_blue.<uuid>}. {@code list} indexes every known chest (in
 * singleplayer, {@code source} "world": every chest in the world, live; on a server, "remembered": the ones this
 * player opened, as last seen), {@code last} is the most recently opened one, and {@code shown} holds the contents and
 * change log of the chests being watched (the last opened one and those the layout selects).
 */
public record EnderStorageSnapshot(String source, String last, List<Entry> list, List<Shown> shown) {
    public static final Pattern KEY = Pattern.compile(
            "[a-z_]{1,32}\\.[a-z_]{1,32}\\.[a-z_]{1,32}(\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?");
    public static final int MAX_LIST = 256;
    public static final int MAX_SHOWN = 8;
    public static final int MAX_ITEM_IDS = 64;
    public static final int MAX_LOG = 500;
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");

    public EnderStorageSnapshot {
        if (!"world".equals(source) && !"remembered".equals(source)) throw new IllegalArgumentException("unknown source");
        if (last != null && !KEY.matcher(last).matches()) throw new IllegalArgumentException("invalid last chest");
        list = List.copyOf(list);
        shown = List.copyOf(shown);
        if (list.size() > MAX_LIST || shown.size() > MAX_SHOWN) throw new IllegalArgumentException("too many chests");
    }

    private static void checkChest(String key, String owner) {
        if (!KEY.matcher(key).matches() || owner != null && (owner.isEmpty() || owner.length() > 64)) {
            throw new IllegalArgumentException("invalid ender storage chest");
        }
    }

    /** One listed chest; {@code owner} (a personal chest's owner name) and {@code seenAt} are null when unknown. */
    public record Entry(String key, String owner, Long seenAt, List<String> items, int filled, int slots) {
        public Entry {
            checkChest(key, owner);
            items = List.copyOf(items);
            if (filled < 0 || filled > slots || slots > ItemSnapshot.MAX_CONTENTS || items.size() > MAX_ITEM_IDS
                    || !items.stream().allMatch(id -> ITEM_ID.matcher(id).matches())) {
                throw new IllegalArgumentException("invalid listed ender storage chest");
            }
        }

        String toJson() {
            return "{\"key\":" + PlayerSnapshot.string(key) + ",\"owner\":" + PlayerSnapshot.string(owner)
                    + ",\"seenAt\":" + seenAt + ",\"items\":["
                    + String.join(",", items.stream().map(PlayerSnapshot::string).toList()) + "],\"filled\":" + filled
                    + ",\"slots\":" + slots + "}";
        }
    }

    /** {@code delta} more (negative: fewer) of {@code item} in the chest, noticed at {@code at}. */
    public record Change(long at, int delta, ItemSnapshot item) {
        public Change {
            Objects.requireNonNull(item, "item");
            if (delta == 0 || item.empty()) throw new IllegalArgumentException("invalid ender storage change");
        }

        String toJson() {
            return "{\"at\":" + at + ",\"delta\":" + delta + ",\"item\":" + item.toJson() + "}";
        }
    }

    /**
     * A watched chest's slots in order, empty ones included (empty with {@code contentsUnknown} while unseen), and its
     * changes, newest first.
     */
    public record Shown(String key, String owner, Long seenAt, boolean contentsUnknown, List<ItemSnapshot> contents,
                        List<Change> log) {
        public Shown {
            checkChest(key, owner);
            contents = List.copyOf(contents);
            log = List.copyOf(log);
            if (contents.size() > ItemSnapshot.MAX_CONTENTS || contentsUnknown && !contents.isEmpty()
                    || log.size() > MAX_LOG || contents.stream().anyMatch(item -> item.contents() != null)) {
                throw new IllegalArgumentException("invalid shown ender storage chest");
            }
        }

        String toJson() {
            return "{\"key\":" + PlayerSnapshot.string(key) + ",\"owner\":" + PlayerSnapshot.string(owner)
                    + ",\"seenAt\":" + seenAt + ",\"contentsUnknown\":" + contentsUnknown + ",\"contents\":["
                    + String.join(",", contents.stream().map(ItemSnapshot::toJson).toList()) + "],\"log\":["
                    + String.join(",", log.stream().map(Change::toJson).toList()) + "]}";
        }
    }

    public String toJson() {
        return "{\"source\":" + PlayerSnapshot.string(source) + ",\"last\":" + PlayerSnapshot.string(last)
                + ",\"list\":[" + String.join(",", list.stream().map(Entry::toJson).toList()) + "],\"shown\":["
                + String.join(",", shown.stream().map(Shown::toJson).toList()) + "]}";
    }
}
