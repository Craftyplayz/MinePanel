package dev.craftyplayz.minepanel.telemetry;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;

public final class StatisticsTracker {
    public static final List<StatisticsSnapshot.Definition> DEFINITIONS = List.of(
            definition("walk_one_cm", "Distance walked", "Movement", "cm"),
            definition("sprint_one_cm", "Distance sprinted", "Movement", "cm"),
            definition("swim_one_cm", "Distance swum", "Movement", "cm"),
            definition("fly_one_cm", "Distance flown", "Movement", "cm"),
            definition("jump", "Jumps", "Movement", "count"),
            definition("deaths", "Deaths", "Combat", "count"),
            definition("mob_kills", "Mob kills", "Combat", "count"),
            definition("player_kills", "Player kills", "Combat", "count"),
            definition("play_time", "Time played", "General", "ticks"),
            definition("leave_game", "Games quit", "General", "count"));
    private final Map<String, Long> baselines = new HashMap<>();
    private final Map<String, Long> previousValues = new HashMap<>();

    private static StatisticsSnapshot.Definition definition(String id, String label, String category, String unit) {
        return new StatisticsSnapshot.Definition("minecraft:" + id, label, category, unit);
    }

    public void reset() {
        baselines.clear();
        previousValues.clear();
    }

    public StatisticsSnapshot sample(Map<String, Long> receivedValues) {
        List<StatisticsSnapshot.Entry> entries = new ArrayList<>();
        for (var definition : DEFINITIONS) {
            Long cumulative = receivedValues.get(definition.id());
            Long session = null;
            if (cumulative != null) {
                if (cumulative < 0 || cumulative > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException("Invalid client statistic");
                }
                Long baseline = baselines.get(definition.id());
                Long previous = previousValues.put(definition.id(), cumulative);
                if (baseline == null || previous != null && cumulative < previous) {
                    baselines.put(definition.id(), cumulative);
                    baseline = cumulative;
                }
                session = cumulative - baseline;
            }
            entries.add(new StatisticsSnapshot.Entry(definition, cumulative, session));
        }
        return new StatisticsSnapshot(entries);
    }
}
