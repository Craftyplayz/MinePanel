package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongFunction;

/** Tracks per-statistic session baselines and the time each statistic last changed. */
public final class StatisticsTracker {
    /** One synchronized statistic, with Minecraft's own formatter for its unit. */
    public record Sample(String id, String label, String category, long value, LongFunction<String> format) {
    }

    private final Map<String, Long> baselines = new HashMap<>();
    private final Map<String, Long> previousValues = new HashMap<>();
    private final Map<String, Long> changedAt = new HashMap<>();
    private boolean established;

    public void reset() {
        baselines.clear();
        previousValues.clear();
        changedAt.clear();
        established = false;
    }

    /**
     * The first non-empty sample is the session baseline. A statistic first seen later started from zero this
     * session (the server only sends statistics that have a value), so all of it counts as a session change.
     */
    public StatisticsSnapshot sample(long now, List<Sample> samples) {
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
                if (value > baseline) changedAt.put(id, now);
            } else if (previous != null && value < previous) {
                baselines.put(id, value);
                baseline = value;
            } else if (previous != null && value > previous) {
                changedAt.put(id, now);
            }
            long session = value - baseline;
            entries.add(new StatisticsSnapshot.Entry(id, sample.label(), sample.category(), value, session,
                    sample.format().apply(value), sample.format().apply(session), changedAt.get(id)));
        }
        if (!samples.isEmpty()) established = true;
        entries.sort(Comparator.comparing(StatisticsSnapshot.Entry::id));
        return new StatisticsSnapshot(entries.subList(0, Math.min(entries.size(), StatisticsSnapshot.MAX_ENTRIES)));
    }
}
