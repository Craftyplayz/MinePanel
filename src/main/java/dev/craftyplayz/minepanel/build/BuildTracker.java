package dev.craftyplayz.minepanel.build;

import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.function.LongSupplier;

/**
 * Incremental progress of the selected schematic placement. Client thread only: {@link #tick} reads the
 * {@link BuildSource} under a time budget, and {@link #snapshot} turns the cached counts into an immutable
 * {@link BuildProgress}. Per-chunk results are kept for the last {@value #MAX_PLACEMENTS} placements, so progress
 * survives walking away and switching between placements.
 */
public final class BuildTracker {
    public static final int MAX_PLACEMENTS = 4;
    /** Chunk readiness checks per tick, so an out-of-range placement costs little. */
    static final int MAX_CHECKS_PER_TICK = 256;
    private static final int COUNT_BATCH = 4096;

    private final Map<String, Progress> placements = new LinkedHashMap<>(8, 0.75F, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Progress> eldest) {
            return size() > MAX_PLACEMENTS;
        }
    };
    private final Map<Integer, List<BuildSource.Requirement>> requirements = new HashMap<>();
    private final ChunkCounts counts = new ChunkCounts();
    private Progress current;
    private String unavailable;

    public static long chunkKey(int chunkX, int chunkZ) {
        return ((long) chunkX << 32) | (chunkZ & 0xFFFFFFFFL);
    }

    static int chunkX(long key) {
        return (int) (key >> 32);
    }

    static int chunkZ(long key) {
        return (int) key;
    }

    /** Advances counting and scanning until {@code deadline} (in {@code clock} nanoseconds) has passed. */
    public void tick(BuildSource source, long deadline, LongSupplier clock, long nowMillis) {
        if (unavailable != null) return;
        BuildSource.Placement selected = source.selected();
        if (selected == null) {
            current = null;
            return;
        }
        String id = selected.id();
        String fingerprint = selected.fingerprint();
        Progress progress = placements.get(id);
        if (progress == null || !progress.fingerprint.equals(fingerprint)) {
            progress = new Progress(fingerprint, selected.chunks());
            placements.put(id, progress);
        }
        progress.id = id;
        progress.name = name(selected.name());
        current = progress;
        if (!progress.counted && !countTotals(selected, progress, deadline, clock)) return;
        scan(selected, progress, deadline, clock, nowMillis);
        if (progress.leftStale) updateLeft(source, progress);
    }

    /** Client thread: a block in the world changed, so its chunk is compared again. */
    public void markBlockChanged(int blockX, int blockZ) {
        markChanged(chunkKey(blockX >> 4, blockZ >> 4));
    }

    /** Client thread: a chunk (re)loaded; it may have changed while it was out of range. */
    public void markChunkLoaded(int chunkX, int chunkZ) {
        markChanged(chunkKey(chunkX, chunkZ));
    }

    private void markChanged(long key) {
        for (Progress progress : placements.values()) {
            if (progress.results.containsKey(key)) progress.dirty.add(key);
        }
    }

    /** Forgets every placement, e.g. on leaving a world. */
    public void reset() {
        placements.clear();
        requirements.clear();
        current = null;
    }

    /** Makes the tile unavailable for the rest of the game session. */
    public void disable(String reason) {
        reset();
        unavailable = reason;
    }

    public boolean disabled() {
        return unavailable != null;
    }

    /**
     * The current progress. {@code items} describes an item ID for display (null when unknown); {@code inventory}
     * supplies the carried counts and may be null.
     */
    public BuildProgress snapshot(InventorySnapshot inventory, Function<String, ItemSnapshot> items) {
        if (unavailable != null) return BuildProgress.unavailable(unavailable);
        Progress progress = current;
        if (progress == null) return BuildProgress.NO_PLACEMENT;
        if (!progress.counted) return new BuildProgress(true, "counting", null, List.of());
        long placed = Math.min(progress.placed, progress.total);
        long wrong = Math.min(progress.wrong, progress.total - placed);
        var placement = new BuildProgress.Placement(progress.id, progress.name, progress.total, placed, wrong,
                progress.extra, progress.pending.size(), progress.pending.isEmpty() && progress.dirty.isEmpty(),
                progress.checkedAt);
        Map<String, Long> have = carried(inventory);
        List<BuildProgress.Material> rows = new ArrayList<>(progress.left.size());
        for (var entry : progress.left.entrySet()) {
            ItemSnapshot item = items.apply(entry.getKey());
            boolean known = item != null && !item.empty();
            rows.add(new BuildProgress.Material(entry.getKey(), known ? item.name() : entry.getKey(),
                    known ? item.icon() : null, entry.getValue(), have.getOrDefault(entry.getKey(), 0L)));
        }
        rows.sort(Comparator.comparingLong((BuildProgress.Material row) -> Math.max(0, row.left() - row.have()))
                .reversed()
                .thenComparing(Comparator.comparingLong(BuildProgress.Material::left).reversed())
                .thenComparing(BuildProgress.Material::name));
        if (rows.size() > BuildProgress.MAX_MATERIALS) rows = rows.subList(0, BuildProgress.MAX_MATERIALS);
        return new BuildProgress(true, null, placement, rows);
    }

    /** Items in the main inventory and offhand, including the contents of shulker boxes and bundles. */
    static Map<String, Long> carried(InventorySnapshot inventory) {
        Map<String, Long> counts = new HashMap<>();
        if (inventory == null) return counts;
        List<ItemSnapshot> items = new ArrayList<>(inventory.slots());
        items.add(inventory.equipment().get("offhand"));
        for (ItemSnapshot item : items) {
            if (item.empty()) continue;
            counts.merge(item.itemId(), (long) item.count(), Long::sum);
            if (item.contents() == null) continue;
            for (ItemSnapshot inner : item.contents()) {
                if (!inner.empty()) counts.merge(inner.itemId(), (long) inner.count(), Long::sum);
            }
        }
        return counts;
    }

    private static boolean countTotals(BuildSource.Placement placement, Progress progress, long deadline,
                                       LongSupplier clock) {
        int regions = placement.regionCount();
        while (progress.region < regions) {
            long volume = placement.regionVolume(progress.region);
            while (progress.index < volume) {
                long end = Math.min(volume, progress.index + COUNT_BATCH);
                for (long index = progress.index; index < end; index++) {
                    int state = placement.stateAt(progress.region, index);
                    if (placement.isAir(state)) continue;
                    progress.totalByState = grow(progress.totalByState, state);
                    progress.totalByState[state]++;
                    progress.total++;
                }
                progress.index = end;
                if (clock.getAsLong() - deadline >= 0) return false;
            }
            progress.region++;
            progress.index = 0;
        }
        progress.counted = true;
        progress.leftStale = true;
        return true;
    }

    private void scan(BuildSource.Placement placement, Progress progress, long deadline, LongSupplier clock,
                      long nowMillis) {
        int checks = 0;
        // Changed chunks first, so edits show up quickly; ones that are not ready move to the back.
        for (int remaining = progress.dirty.size(); remaining > 0 && checks < MAX_CHECKS_PER_TICK; remaining--) {
            if (clock.getAsLong() - deadline >= 0) return;
            Iterator<Long> iterator = progress.dirty.iterator();
            long key = iterator.next();
            iterator.remove();
            checks++;
            if (placement.ready(chunkX(key), chunkZ(key))) {
                store(progress, key, scanChunk(placement, key), nowMillis);
            } else {
                progress.dirty.add(key);
            }
        }
        for (int remaining = progress.pending.size(); remaining > 0 && checks < MAX_CHECKS_PER_TICK; remaining--) {
            if (clock.getAsLong() - deadline >= 0) return;
            long key = progress.pending.pollFirst();
            checks++;
            if (placement.ready(chunkX(key), chunkZ(key))) {
                store(progress, key, scanChunk(placement, key), nowMillis);
            } else {
                progress.pending.addLast(key);
            }
        }
    }

    private ChunkCounts.ChunkResult scanChunk(BuildSource.Placement placement, long key) {
        counts.clear();
        placement.scan(chunkX(key), chunkZ(key), counts);
        return counts.freeze();
    }

    private static void store(Progress progress, long key, ChunkCounts.ChunkResult result, long nowMillis) {
        ChunkCounts.ChunkResult previous = progress.results.put(key, result);
        if (previous != null) apply(progress, previous, -1);
        apply(progress, result, 1);
        progress.checkedAt = Math.max(0, nowMillis);
        progress.leftStale = true;
    }

    private static void apply(Progress progress, ChunkCounts.ChunkResult result, int sign) {
        for (int index = 0; index < result.states().length; index++) {
            int state = result.states()[index];
            progress.placedByState = grow(progress.placedByState, state);
            progress.placedByState[state] += (long) sign * result.placed()[index];
            progress.placed += (long) sign * result.placed()[index];
        }
        progress.wrong += (long) sign * result.wrong();
        progress.extra += (long) sign * result.extra();
    }

    /** Items still to place: the schematic's count of each state minus the placed ones, converted to items. */
    private void updateLeft(BuildSource source, Progress progress) {
        Map<String, Long> left = new HashMap<>();
        for (int state = 0; state < progress.totalByState.length; state++) {
            long placed = state < progress.placedByState.length ? progress.placedByState[state] : 0;
            long needed = progress.totalByState[state] - placed;
            if (needed <= 0) continue;
            for (var requirement : requirements.computeIfAbsent(state, source::requirements)) {
                left.merge(requirement.itemId(), needed * requirement.count(), Long::sum);
            }
        }
        progress.left = left;
        progress.leftStale = false;
    }

    private static long[] grow(long[] values, int index) {
        if (index < 0) throw new IllegalArgumentException("state IDs are non-negative");
        return index < values.length ? values : Arrays.copyOf(values, Math.max(index + 1, values.length * 2));
    }

    private static String name(String name) {
        if (name == null || name.isBlank()) return "Unnamed placement";
        if (name.length() <= BuildProgress.MAX_TEXT_LENGTH) return name;
        int end = BuildProgress.MAX_TEXT_LENGTH;
        if (Character.isHighSurrogate(name.charAt(end - 1))) end--;
        return name.substring(0, end);
    }

    private static final class Progress {
        final String fingerprint;
        final ArrayDeque<Long> pending = new ArrayDeque<>();
        final Set<Long> dirty = new LinkedHashSet<>();
        final Map<Long, ChunkCounts.ChunkResult> results = new HashMap<>();
        String id;
        String name;
        long[] totalByState = new long[0];
        long total;
        int region;
        long index;
        boolean counted;
        long[] placedByState = new long[0];
        long placed;
        long wrong;
        long extra;
        long checkedAt;
        Map<String, Long> left = Map.of();
        boolean leftStale = true;

        Progress(String fingerprint, long[] chunks) {
            this.fingerprint = fingerprint;
            for (long key : new LinkedHashSet<>(Arrays.stream(chunks).boxed().toList())) pending.add(key);
        }
    }
}
