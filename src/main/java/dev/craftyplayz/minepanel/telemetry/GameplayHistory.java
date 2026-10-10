package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;

public record GameplayHistory(long sessionId, boolean active, List<Event> events) {
    public static final int MAX_EVENTS = 100;
    public record Event(long id, long timestamp, String category, String label, String details) {
        public Event {
            if (id <= 0 || timestamp < 0 || !List.of("lifecycle", "death", "dimension", "kill").contains(category)
                    || label == null || label.isEmpty() || label.length() > 256
                    || details == null || details.length() > 256) {
                throw new IllegalArgumentException("Invalid gameplay event");
            }
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
        boolean separator = false;
        for (Event event : events) {
            if (separator) json.append(',');
            separator = true;
            json.append("{\"id\":").append(event.id).append(",\"timestamp\":").append(event.timestamp)
                    .append(",\"category\":").append(PlayerSnapshot.string(event.category))
                    .append(",\"label\":").append(PlayerSnapshot.string(event.label))
                    .append(",\"details\":").append(PlayerSnapshot.string(event.details)).append('}');
        }
        return json.append("]}").toString();
    }
}
