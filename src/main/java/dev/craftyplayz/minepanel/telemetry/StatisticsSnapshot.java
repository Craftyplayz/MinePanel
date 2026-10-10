package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.HashSet;
import java.util.Objects;

public record StatisticsSnapshot(List<Entry> entries) {
    public record Definition(String id, String label, String category, String unit) {
        public Definition {
            if (id == null || !id.matches("[a-z0-9_.-]+:[a-z0-9/._-]+") || id.length() > 256
                    || label == null || label.isEmpty() || label.length() > 256
                    || !List.of("Movement", "Combat", "General").contains(category)
                    || !List.of("count", "cm", "ticks").contains(unit)) {
                throw new IllegalArgumentException("Invalid statistic definition");
            }
        }
    }

    public record Entry(Definition definition, Long cumulative, Long session) {
        public Entry {
            Objects.requireNonNull(definition);
            if (cumulative != null && (cumulative < 0 || cumulative > Integer.MAX_VALUE)
                    || session != null && (session < 0 || cumulative == null || session > cumulative)) {
                throw new IllegalArgumentException("Invalid statistic values");
            }
        }
    }

    public StatisticsSnapshot {
        entries = List.copyOf(entries);
        var ids = new HashSet<String>();
        if (entries.size() > 32 || entries.stream().anyMatch(entry -> !ids.add(entry.definition.id))) {
            throw new IllegalArgumentException("Too many or duplicate statistics");
        }
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"entries\":[");
        boolean separator = false;
        for (Entry entry : entries) {
            if (separator) json.append(',');
            separator = true;
            Definition definition = entry.definition;
            json.append("{\"id\":").append(PlayerSnapshot.string(definition.id))
                    .append(",\"label\":").append(PlayerSnapshot.string(definition.label))
                    .append(",\"category\":").append(PlayerSnapshot.string(definition.category))
                    .append(",\"unit\":").append(PlayerSnapshot.string(definition.unit))
                    .append(",\"cumulative\":").append(entry.cumulative)
                    .append(",\"session\":").append(entry.session).append('}');
        }
        return json.append("]}").toString();
    }
}
