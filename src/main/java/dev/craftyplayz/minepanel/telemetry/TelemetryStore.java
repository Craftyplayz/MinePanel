package dev.craftyplayz.minepanel.telemetry;

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
        PlayerSnapshot current = player.get();
        PlayerSnapshot candidate = new PlayerSnapshot(current.revision(), capturedAt, true,
                sessionSeconds, dimension, x, y, z, health, maxHealth, absorption, inventory);
        if (current.sameValues(candidate)) {
            return false;
        }
        player.set(new PlayerSnapshot(current.revision() + 1, capturedAt, true,
                sessionSeconds, dimension, x, y, z, health, maxHealth, absorption, inventory));
        return true;
    }

    public boolean markUnavailable(long capturedAt) {
        PlayerSnapshot current = player.get();
        if (!current.available()) {
            return false;
        }
        player.set(PlayerSnapshot.unavailable(current.revision() + 1, capturedAt));
        return true;
    }
}
