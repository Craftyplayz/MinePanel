package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;

/**
 * How the player is moving. Speeds are in blocks per second, {@code speed} in all three dimensions. {@code yaw} is
 * Minecraft's facing angle (0 = south, 90 = west, 180 = north, 270 = east), normalized to 0–360. {@code icon} is the
 * item that represents the movement mode; {@code glider} is the equipped elytra (or other glider), if any.
 */
public record Motion(String mode, double speed, double horizontalSpeed, double verticalSpeed,
                     double yaw, double pitch, ItemSnapshot icon, ItemSnapshot glider) {
    public static final List<String> MODES = List.of("ground", "elytra", "swimming", "riding", "flying", "falling");

    public Motion {
        Objects.requireNonNull(icon, "icon");
        if (!MODES.contains(mode) || !Double.isFinite(speed) || !Double.isFinite(horizontalSpeed)
                || !Double.isFinite(verticalSpeed) || !Double.isFinite(yaw) || !Double.isFinite(pitch)
                || speed < 0 || horizontalSpeed < 0 || yaw < 0 || yaw >= 360 || pitch < -90 || pitch > 90
                || icon.empty() || icon.contents() != null || glider != null && glider.empty()) {
            throw new IllegalArgumentException("Invalid motion");
        }
    }

    /** Rounds values to what the dashboard shows, so tiny jitter does not produce an update every sample. */
    public static Motion rounded(String mode, double speed, double horizontalSpeed, double verticalSpeed,
                                 double yaw, double pitch, ItemSnapshot icon, ItemSnapshot glider) {
        double facing = Math.floorMod(Math.round(yaw), 360);
        return new Motion(mode, tenths(speed), tenths(horizontalSpeed), tenths(verticalSpeed), facing,
                Math.max(-90, Math.min(90, Math.round(pitch))), icon, glider);
    }

    private static double tenths(double value) {
        double rounded = Math.round(value * 10) / 10.0;
        return rounded == 0 ? 0 : rounded;
    }

    public String toJson() {
        return "{\"mode\":" + PlayerSnapshot.string(mode) + ",\"speed\":" + speed
                + ",\"horizontalSpeed\":" + horizontalSpeed + ",\"verticalSpeed\":" + verticalSpeed
                + ",\"yaw\":" + yaw + ",\"pitch\":" + pitch + ",\"icon\":" + icon.toJson()
                + ",\"glider\":" + (glider == null ? "null" : glider.toJson()) + "}";
    }
}
