package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class GameplayTracker {
    private long sessionId;
    private long nextId;
    private boolean active;
    private Boolean dead;
    private String dimension;
    private final ArrayDeque<GameplayHistory.Event> events = new ArrayDeque<>();
    private final Map<String, Long> kills = new HashMap<>();

    public void start(long timestamp) {
        sessionId++;
        nextId = 0;
        active = true;
        dead = null;
        dimension = null;
        events.clear();
        kills.clear();
        add(timestamp, "lifecycle", "Session started", "Joined a world/server.");
    }

    public void disconnect(long timestamp) {
        if (active) {
            add(timestamp, "lifecycle", "Disconnected", "Previous session retained in memory until the next join.");
            active = false;
        }
    }

    public void observe(long timestamp, String currentDimension, boolean currentlyDead) {
        if (!active) start(timestamp);
        if (dimension != null && !Objects.equals(dimension, currentDimension)) {
            add(timestamp, "dimension", "Dimension changed", dimension + " → " + currentDimension);
        }
        if (Boolean.FALSE.equals(dead) && currentlyDead) {
            add(timestamp, "death", "Local player died", "Observed alive-to-dead transition.");
        }
        dead = currentlyDead;
        dimension = currentDimension;
    }

    public void observeKills(long timestamp, Map<String, Long> receivedValues) {
        for (String id : List.of("minecraft:mob_kills", "minecraft:player_kills")) {
            Long current = receivedValues.get(id);
            if (current == null) continue;
            Long previous = kills.put(id, current);
            if (previous != null && current > previous) {
                add(timestamp, "kill", id.endsWith(":mob_kills") ? "Mob kills reported" : "Player kills reported",
                        "+" + (current - previous) + " in synchronized vanilla statistics; targets and times unavailable.");
            }
        }
    }

    private void add(long timestamp, String category, String label, String details) {
        if (events.size() == GameplayHistory.MAX_EVENTS) events.removeFirst();
        events.addLast(new GameplayHistory.Event(++nextId, timestamp, category, label, details));
    }

    public GameplayHistory snapshot() {
        return new GameplayHistory(sessionId, active, List.copyOf(events));
    }
}
