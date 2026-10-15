package dev.craftyplayz.minepanel.telemetry;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public record GameplayHistory(long sessionId, boolean active, List<Event> events) {
    public static final int MAX_EVENTS = 500;
    public static final int MAX_DETAILS_LENGTH = 1024;
    public static final List<String> CATEGORIES = List.of("lifecycle", "death", "dimension", "kill", "mine", "place",
            "container", "inventory", "drop", "damage", "heal", "advancement", "biome", "weather", "time");

    public record Event(long id, long timestamp, String category, String label, String details) {
        public Event {
            if (id <= 0 || timestamp < 0 || !CATEGORIES.contains(category)
                    || label == null || label.isEmpty() || label.length() > 256
                    || details == null || details.length() > MAX_DETAILS_LENGTH) {
                throw new IllegalArgumentException("Invalid gameplay event");
            }
        }

        public String toJson() {
            return "{\"id\":" + id + ",\"timestamp\":" + timestamp
                    + ",\"category\":" + PlayerSnapshot.string(category)
                    + ",\"label\":" + PlayerSnapshot.string(label)
                    + ",\"details\":" + PlayerSnapshot.string(details) + "}";
        }
    }

    public GameplayHistory {
        events = List.copyOf(events);
        if (sessionId < 0 || events.size() > MAX_EVENTS) throw new IllegalArgumentException("Invalid history");
        long previous = 0;
        for (Event event : events) {
            Objects.requireNonNull(event);
            if (event.id <= previous) throw new IllegalArgumentException("Events must be oldest first");
            previous = event.id;
        }
    }

    public static GameplayHistory empty() {
        return new GameplayHistory(0, false, List.of());
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"sessionId\":").append(sessionId)
                .append(",\"active\":").append(active).append(",\"events\":[");
        appendEvents(json, events);
        return json.append("]}").toString();
    }

    /**
     * Within one session, only new or rewritten events are sent; {@code firstId} tells the dashboard which older
     * events were evicted. A new session (or an empty history) always gets a complete replacement.
     */
    public String toDeltaJson(GameplayHistory previous) {
        if (previous == null || previous.sessionId != sessionId || events.isEmpty()) {
            return toJson();
        }
        Map<Long, Event> before = new HashMap<>();
        for (Event event : previous.events) before.put(event.id, event);
        List<Event> changed = events.stream().filter(event -> !event.equals(before.get(event.id))).toList();
        StringBuilder json = new StringBuilder("{\"sessionId\":").append(sessionId)
                .append(",\"active\":").append(active)
                .append(",\"firstId\":").append(events.getFirst().id)
                .append(",\"upsert\":[");
        appendEvents(json, changed);
        return json.append("]}").toString();
    }

    private static void appendEvents(StringBuilder json, List<Event> source) {
        boolean separator = false;
        for (Event event : source) {
            if (separator) json.append(',');
            separator = true;
            json.append(event.toJson());
        }
    }
}
