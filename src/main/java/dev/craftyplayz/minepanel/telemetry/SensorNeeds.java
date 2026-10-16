package dev.craftyplayz.minepanel.telemetry;

/**
 * Which of the costlier sensors enabled rules read, worked out from the saved layout: light level, the look target
 * (up to {@code lookDistance} blocks; 0 = not needed), an entity scan (up to {@code entityRadius} blocks; 0 = not
 * needed) and the open screen. Everything else in {@link Sensors} is always collected.
 */
public record SensorNeeds(boolean light, int lookDistance, int entityRadius, boolean screen) {
    public static final SensorNeeds NONE = new SensorNeeds(false, 0, 0, false);

    public SensorNeeds {
        if (lookDistance < 0 || lookDistance > Sensors.MAX_RADIUS || entityRadius < 0
                || entityRadius > Sensors.MAX_RADIUS) {
            throw new IllegalArgumentException("Invalid sensor needs");
        }
    }
}
