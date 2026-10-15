package dev.craftyplayz.minepanel.telemetry;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Every statistic the server has synchronized, keyed as {@code <stat type>/<value>}
 * (for example {@code minecraft:mined/minecraft:stone}), with Minecraft-formatted display text. The rates are
 * per-hour averages over the session and over the last minute, or null while there is no change to average.
 */
public record StatisticsSnapshot(List<Entry> entries) {
    public static final int MAX_ENTRIES = 4096;
    private static final Pattern ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_.-]+/[a-z0-9_.-]+:[a-z0-9/._-]+");

    public record Entry(String id, String label, String category, long value, long session,
                        String display, String sessionDisplay, Long changedAt,
                        String sessionRate, String recentRate) {
        public Entry {
            if (id == null || id.length() > 256 || !ID.matcher(id).matches()
                    || !text(label) || !text(category) || !text(display) || !text(sessionDisplay)
                    || value < 0 || value > Integer.MAX_VALUE || session < 0 || session > value
                    || changedAt != null && changedAt < 0
                    || sessionRate != null && !text(sessionRate) || recentRate != null && !text(recentRate)) {
                throw new IllegalArgumentException("Invalid statistic");
            }
        }

        public String toJson() {
            return "{\"id\":" + PlayerSnapshot.string(id) + ",\"label\":" + PlayerSnapshot.string(label)
                    + ",\"category\":" + PlayerSnapshot.string(category) + ",\"value\":" + value
                    + ",\"session\":" + session + ",\"display\":" + PlayerSnapshot.string(display)
                    + ",\"sessionDisplay\":" + PlayerSnapshot.string(sessionDisplay)
                    + ",\"changedAt\":" + changedAt + ",\"sessionRate\":" + PlayerSnapshot.string(sessionRate)
                    + ",\"recentRate\":" + PlayerSnapshot.string(recentRate) + "}";
        }

        private static boolean text(String value) {
            return value != null && !value.isEmpty() && value.length() <= 256;
        }
    }

    public StatisticsSnapshot {
        entries = List.copyOf(entries);
        var ids = new HashSet<String>();
        if (entries.size() > MAX_ENTRIES || entries.stream().anyMatch(entry -> !ids.add(entry.id))) {
            throw new IllegalArgumentException("Too many or duplicate statistics");
        }
    }

    public static boolean validId(String id) {
        return id != null && id.length() <= 256 && ID.matcher(id).matches();
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"entries\":[");
        append(json, entries);
        return json.append("]}").toString();
    }

    /** Sends only new or changed entries; a removed entry (only after a reset) forces a full replacement. */
    public String toDeltaJson(StatisticsSnapshot previous) {
        if (previous == null) return toJson();
        Map<String, Entry> before = new HashMap<>();
        for (Entry entry : previous.entries) before.put(entry.id, entry);
        var current = new HashSet<String>();
        for (Entry entry : entries) current.add(entry.id);
        if (!current.containsAll(before.keySet())) return toJson();
        StringBuilder json = new StringBuilder("{\"upsert\":[");
        append(json, entries.stream().filter(entry -> !entry.equals(before.get(entry.id))).toList());
        return json.append("]}").toString();
    }

    private static void append(StringBuilder json, List<Entry> source) {
        boolean separator = false;
        for (Entry entry : source) {
            if (separator) json.append(',');
            separator = true;
            json.append(entry.toJson());
        }
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof StatisticsSnapshot snapshot && entries.equals(snapshot.entries);
    }

    @Override
    public int hashCode() {
        return Objects.hash(entries);
    }
}
