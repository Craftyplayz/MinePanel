package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongFunction;

/** Tracks per-statistic session baselines, the time each statistic last changed and its hourly rates. */
public final class StatisticsTracker {
    /** One synchronized statistic, with Minecraft's own formatter for its unit. */
    public record Sample(String id, String label, String category, long value, LongFunction<String> format) {
    }

    /** The rolling window behind the recent rate. */
    public static final long RECENT_WINDOW_MILLIS = 60_000;
    private static final double HOUR_MILLIS = 3_600_000;

    private final Map<String, Long> baselines = new HashMap<>();
    private final Map<String, Long> previousValues = new HashMap<>();
    private final Map<String, Long> changedAt = new HashMap<>();
    /** Per statistic, {@code [time, increase]} pairs within the recent window, oldest first. */
    private final Map<String, ArrayDeque<long[]>> increases = new HashMap<>();
    private boolean established;
    private long startedAt;

    public void reset() {
        baselines.clear();
        previousValues.clear();
        changedAt.clear();
        increases.clear();
        established = false;
    }

    /**
     * The first non-empty sample is the session baseline. A statistic first seen later started from zero this
     * session (the server only sends statistics that have a value), so all of it counts as a session change.
     */
    public StatisticsSnapshot sample(long now, List<Sample> samples) {
        if (!established && !samples.isEmpty()) startedAt = now;
        long elapsed = now - startedAt;
        List<StatisticsSnapshot.Entry> entries = new ArrayList<>(samples.size());
        for (Sample sample : samples) {
            long value = sample.value();
            if (value < 0 || value > Integer.MAX_VALUE) throw new IllegalArgumentException("Invalid client statistic");
            String id = sample.id();
            Long previous = previousValues.put(id, value);
            Long baseline = baselines.get(id);
            if (baseline == null) {
                baseline = established ? 0L : value;
                baselines.put(id, baseline);
                if (value > baseline) increased(id, now, value - baseline);
            } else if (previous != null && value < previous) {
                baselines.put(id, value);
                baseline = value;
                increases.remove(id);
            } else if (previous != null && value > previous) {
                increased(id, now, value - previous);
            }
            long session = value - baseline;
            long recent = recent(id, now);
            var format = sample.format();
            entries.add(new StatisticsSnapshot.Entry(id, sample.label(), sample.category(), value, session,
                    format.apply(value), format.apply(session), changedAt.get(id),
                    session > 0 && elapsed > 0 ? format.apply(perHour(session, elapsed)) : null,
                    recent > 0 && elapsed > 0
                            ? format.apply(perHour(recent, Math.min(elapsed, RECENT_WINDOW_MILLIS))) : null));
        }
        if (!samples.isEmpty()) established = true;
        entries.sort(Comparator.comparing(StatisticsSnapshot.Entry::id));
        return new StatisticsSnapshot(entries.subList(0, Math.min(entries.size(), StatisticsSnapshot.MAX_ENTRIES)));
    }

    private void increased(String id, long now, long amount) {
        changedAt.put(id, now);
        increases.computeIfAbsent(id, key -> new ArrayDeque<>()).addLast(new long[] {now, amount});
    }

    /** The increase within the recent window, dropping older increases. */
    private long recent(String id, long now) {
        ArrayDeque<long[]> window = increases.get(id);
        if (window == null) return 0;
        while (!window.isEmpty() && window.peekFirst()[0] <= now - RECENT_WINDOW_MILLIS) window.removeFirst();
        if (window.isEmpty()) {
            increases.remove(id);
            return 0;
        }
        long total = 0;
        for (long[] increase : window) total += increase[1];
        return total;
    }

    private static long perHour(long amount, long millis) {
        return Math.min(Integer.MAX_VALUE, Math.round(amount * HOUR_MILLIS / millis));
    }
}
