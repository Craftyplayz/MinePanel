package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

public final class TelemetryStore {
    private final AtomicReference<PlayerSnapshot> player =
            new AtomicReference<>(PlayerSnapshot.unavailable(0, System.currentTimeMillis()));

    public PlayerSnapshot player() {
        return player.get();
    }

    public boolean updatePlayer(long capturedAt, Long sessionSeconds, String dimension,
                                Double x, Double y, Double z, Double health, Double maxHealth,
                                Double absorption) {
        return updatePlayer(capturedAt, sessionSeconds, dimension, x, y, z, health, maxHealth,
                absorption, InventorySnapshot.empty());
    }

    public boolean updatePlayer(long capturedAt, Long sessionSeconds, String dimension,
                                Double x, Double y, Double z, Double health, Double maxHealth,
                                Double absorption, InventorySnapshot inventory) {
        return updatePlayer(capturedAt, sessionSeconds, dimension, x, y, z, health, maxHealth, absorption,
                inventory, null, GameplayHistory.empty());
    }

    public boolean updatePlayer(long capturedAt, Long sessionSeconds, String dimension,
                                Double x, Double y, Double z, Double health, Double maxHealth,
                                Double absorption, InventorySnapshot inventory, StatisticsSnapshot statistics,
                                GameplayHistory history) {
        return updatePlayer(capturedAt, sessionSeconds, dimension, x, y, z, health, maxHealth, absorption,
                inventory, statistics, history, 20, 5.0, List.of());
    }

    public boolean updatePlayer(long capturedAt, Long sessionSeconds, String dimension,
                                Double x, Double y, Double z, Double health, Double maxHealth,
                                Double absorption, InventorySnapshot inventory, StatisticsSnapshot statistics,
                                GameplayHistory history, Integer food, Double saturation, List<StatusEffect> effects) {
        return updatePlayer(capturedAt, sessionSeconds, dimension, x, y, z, health, maxHealth, absorption, inventory,
                statistics, history, food, saturation, effects, PlayerDetails.placeholder());
    }

    public boolean updatePlayer(long capturedAt, Long sessionSeconds, String dimension,
                                Double x, Double y, Double z, Double health, Double maxHealth,
                                Double absorption, InventorySnapshot inventory, StatisticsSnapshot statistics,
                                GameplayHistory history, Integer food, Double saturation, List<StatusEffect> effects,
                                PlayerDetails details) {
        PlayerSnapshot current = player.get();
        PlayerSnapshot candidate = new PlayerSnapshot(current.revision(), capturedAt, true, sessionSeconds, dimension,
                x, y, z, health, maxHealth, absorption, inventory, statistics, history, food, saturation, effects,
                details);
        if (current.sameValues(candidate)) {
            return false;
        }
        player.set(new PlayerSnapshot(current.revision() + 1, capturedAt, true, sessionSeconds, dimension,
                x, y, z, health, maxHealth, absorption, inventory, statistics, history, food, saturation, effects,
                details));
        return true;
    }

    public boolean markUnavailable(long capturedAt) {
        GameplayHistory current = player.get().history();
        return markUnavailable(capturedAt, new GameplayHistory(current.sessionId(), false, current.events()));
    }

    public boolean markUnavailable(long capturedAt, GameplayHistory history) {
        PlayerSnapshot current = player.get();
        if (!current.available() && current.history().equals(history)) {
            return false;
        }
        player.set(PlayerSnapshot.unavailable(current.revision() + 1, capturedAt, history));
        return true;
    }
}
