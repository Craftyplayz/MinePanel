package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Keeps a rolling record of experience gained, so the dashboard can show XP per hour over several windows without
 * the player starting a "run". Only gains count: spending levels on enchanting or an anvil, or dying, resets the
 * baseline instead of producing a negative rate. Client thread only.
 */
public final class XpTracker {
    /** The windows the dashboard can choose between, in seconds. */
    public static final List<Integer> WINDOWS = List.of(10, 30, 60, 300, 600, 3600);
    private static final long LONGEST_MILLIS = 3_600_000L;

    /** Experience a player has at a level and progress; mirrors {@code Player.getXpNeededForNextLevel}. */
    public record Experience(int level, double progress, long points, Map<Integer, Long> gained) {
        public Experience {
            Objects.requireNonNull(gained, "gained");
            if (level < 0 || !Double.isFinite(progress) || progress < 0 || progress > 1 || points < 0
                    || !gained.keySet().equals(java.util.Set.copyOf(WINDOWS))) {
                throw new IllegalArgumentException("Invalid experience");
            }
            gained = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(gained));
        }

        public String toJson() {
            StringBuilder json = new StringBuilder("{\"level\":").append(level).append(",\"progress\":")
                    .append(progress).append(",\"points\":").append(points).append(",\"gained\":{");
            boolean separator = false;
            for (int window : WINDOWS) {
                if (separator) json.append(',');
                separator = true;
                json.append('"').append(window).append("\":").append(gained.get(window));
            }
            return json.append("}}").toString();
        }
    }

    private record Gain(long second, long amount) {
    }

    private final ArrayDeque<Gain> gains = new ArrayDeque<>();
    private Long lastPoints;

    public void reset() {
        gains.clear();
        lastPoints = null;
    }

    public Experience observe(long now, int level, float progress) {
        int safeLevel = Math.max(0, level);
        double safeProgress = Float.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
        long points = pointsAtLevel(safeLevel) + Math.round(safeProgress * neededForNextLevel(safeLevel));
        if (lastPoints != null && points > lastPoints) {
            long second = now / 1000;
            long amount = points - lastPoints;
            if (!gains.isEmpty() && gains.peekLast().second == second) {
                amount += gains.removeLast().amount;
            }
            gains.addLast(new Gain(second, amount));
        }
        lastPoints = points;
        while (!gains.isEmpty() && now - gains.peekFirst().second * 1000 > LONGEST_MILLIS) gains.removeFirst();
        Map<Integer, Long> gained = new LinkedHashMap<>();
        for (int window : WINDOWS) {
            long since = now / 1000 - window;
            long total = 0;
            for (Gain gain : gains) {
                if (gain.second > since) total += gain.amount;
            }
            gained.put(window, total);
        }
        return new Experience(safeLevel, Math.round(safeProgress * 1000) / 1000.0, points, gained);
    }

    /** Points needed to go from {@code level} to the next level. */
    public static long neededForNextLevel(int level) {
        if (level >= 30) return 112 + (level - 30) * 9L;
        if (level >= 15) return 37 + (level - 15) * 5L;
        return 7 + level * 2L;
    }

    /** Total points a player has at the start of {@code level}. */
    public static long pointsAtLevel(int level) {
        long l = level;
        if (level <= 16) return l * l + 6 * l;
        if (level <= 31) return (5 * l * l - 81 * l + 720) / 2;
        return (9 * l * l - 325 * l + 4440) / 2;
    }
}
