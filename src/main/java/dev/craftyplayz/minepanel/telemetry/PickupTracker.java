package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;

/**
 * Items recently added to or removed from the inventory and how ("Picked up", "Mined", "from Chest", "Used", ...). The
 * same item from the same source in the same direction within {@link #MERGE_MILLIS} adds to one entry, which moves to
 * the top. Client thread only.
 */
public final class PickupTracker {
    public static final int MAX_PICKUPS = 32;
    public static final long MERGE_MILLIS = 3_000;

    /** {@code item} shows the icon and tooltip; {@code count} is how many were added (negative: removed), not the stack size. */
    public record Pickup(long id, long at, String source, ItemSnapshot item, long count) {
        public Pickup {
            Objects.requireNonNull(item, "item");
            if (id <= 0 || at < 0 || source == null || source.isEmpty() || source.length() > 256 || item.empty()
                    || count == 0) {
                throw new IllegalArgumentException("Invalid pickup");
            }
        }

        public String toJson() {
            return "{\"id\":" + id + ",\"at\":" + at + ",\"source\":" + PlayerSnapshot.string(source)
                    + ",\"item\":" + item.toJson() + ",\"count\":" + count + "}";
        }
    }

    private record Entry(String key, Pickup pickup) {
    }

    private final ArrayDeque<Entry> entries = new ArrayDeque<>();
    private long nextId;
    private List<Pickup> snapshot = List.of();

    public void reset() {
        entries.clear();
        snapshot = List.of();
    }

    /** {@code key} identifies the item kind (item and components), so differently enchanted books stay apart. */
    public void add(long now, String key, String source, ItemSnapshot item, long count) {
        if (count == 0 || item.empty()) return;
        long total = count;
        for (Iterator<Entry> iterator = entries.iterator(); iterator.hasNext(); ) {
            Entry entry = iterator.next();
            if (entry.key.equals(key) && entry.pickup.source().equals(source) && (entry.pickup.count() > 0) == (count > 0)
                    && now - entry.pickup.at() <= MERGE_MILLIS) {
                total += entry.pickup.count();
                iterator.remove();
                break;
            }
        }
        if (entries.size() == MAX_PICKUPS) entries.removeFirst();
        entries.addLast(new Entry(key, new Pickup(++nextId, now, source, item, total)));
        snapshot = entries.stream().map(Entry::pickup).toList();
    }

    /** Oldest first. */
    public List<Pickup> pickups() {
        return snapshot;
    }
}
