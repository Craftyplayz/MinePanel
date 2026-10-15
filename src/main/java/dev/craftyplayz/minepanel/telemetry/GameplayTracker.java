package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Builds the session event log on the client thread. Repeated actions of the same kind (mining the same block,
 * taking damage from the same source, ...) within {@link #COALESCE_MILLIS} update the newest event instead of
 * flooding the log. Every event is handed to the archive exactly once, after it can no longer change.
 */
public final class GameplayTracker {
    public static final long COALESCE_MILLIS = 5_000;
    static final long DAMAGE_SOURCE_MILLIS = 1_000;
    static final long DEATH_MESSAGE_GRACE_MILLIS = 1_500;
    static final long KILL_ATTRIBUTION_MILLIS = 30_000;
    /** A biome is only logged once the player has stayed in it this long, so border crossings do not flood the log. */
    static final long BIOME_SETTLE_MILLIS = 5_000;

    private final Consumer<GameplayHistory.Event> archive;
    private long sessionId;
    private long nextId;
    private boolean active;
    private Boolean dead;
    private String dimension;
    private Double health;
    private boolean belowFullHealth;
    private boolean deathLogged;
    private long pendingDeathAt = -1;
    private String damageSource;
    private long damageSourceAt;
    private final ArrayDeque<GameplayHistory.Event> events = new ArrayDeque<>();
    private boolean lastArchived = true;
    private String coalesceKey;
    private long coalesceCount;
    private double coalesceAmount;
    private final Map<String, ArrayDeque<Long>> attributedKills = new HashMap<>();
    private String biome;
    private String biomeName;
    private String candidateBiome;
    private String candidateBiomeName;
    private long candidateSince;
    private String weather;
    private Long day;

    public GameplayTracker() {
        this(event -> { });
    }

    public GameplayTracker(Consumer<GameplayHistory.Event> archive) {
        this.archive = Objects.requireNonNull(archive);
    }

    public void start(long timestamp) {
        archiveLast();
        sessionId++;
        nextId = 0;
        active = true;
        dead = null;
        dimension = null;
        health = null;
        belowFullHealth = false;
        deathLogged = false;
        pendingDeathAt = -1;
        damageSource = null;
        events.clear();
        attributedKills.clear();
        coalesceKey = null;
        biome = null;
        biomeName = null;
        candidateBiome = null;
        weather = null;
        day = null;
        add(timestamp, "lifecycle", "Session started", "Joined a world/server.");
    }

    /**
     * Logs biome changes (after {@link #BIOME_SETTLE_MILLIS} in the new biome), weather changes and new days. The
     * first observation of a session is the baseline: only the current day is noted.
     */
    public void observeWorld(long timestamp, String biomeId, String currentBiomeName, String currentWeather,
                             long currentDay, int x, int y, int z) {
        if (!active) return;
        if (biome == null) {
            biome = biomeId;
            biomeName = currentBiomeName;
            candidateBiome = biomeId;
            candidateSince = timestamp;
        } else {
            if (!biomeId.equals(candidateBiome)) {
                candidateBiome = biomeId;
                candidateBiomeName = currentBiomeName;
                candidateSince = timestamp;
            }
            if (!candidateBiome.equals(biome) && timestamp - candidateSince >= BIOME_SETTLE_MILLIS) {
                add(timestamp, "biome", "Entered " + candidateBiomeName,
                        "From " + biomeName + " · at " + x + ", " + y + ", " + z);
                biome = candidateBiome;
                biomeName = candidateBiomeName;
            }
        }
        if (weather != null && !weather.equals(currentWeather)) {
            add(timestamp, "weather", weatherLabel(weather, currentWeather), "");
        }
        weather = currentWeather;
        if (day == null) {
            add(timestamp, "time", "Day " + currentDay, "Current day when joining.");
        } else if (currentDay > day) {
            add(timestamp, "time", "Day " + currentDay + " began", currentDay - day > 1
                    ? "Skipped " + (currentDay - day - 1) + " day" + (currentDay - day > 2 ? "s" : "") : "");
        } else if (currentDay < day) {
            add(timestamp, "time", "Time set back to day " + currentDay, "Was day " + day + ".");
        }
        day = currentDay;
    }

    private static String weatherLabel(String before, String after) {
        return switch (after) {
            case "thunder" -> "Thunderstorm started";
            case "rain" -> "thunder".equals(before) ? "Thunderstorm ended; still raining" : "Rain started";
            default -> "thunder".equals(before) ? "Thunderstorm ended" : "Rain stopped";
        };
    }

    public void disconnect(long timestamp) {
        if (active) {
            add(timestamp, "lifecycle", "Disconnected", "Previous session retained in memory until the next join.");
            active = false;
            archiveLast();
        }
    }

    public void observe(long timestamp, String currentDimension, boolean currentlyDead) {
        observe(timestamp, currentDimension, currentlyDead, null, null);
    }

    public void observe(long timestamp, String currentDimension, boolean currentlyDead,
                        Double currentHealth, Double maxHealth) {
        if (!active) start(timestamp);
        if (dimension != null && !Objects.equals(dimension, currentDimension)) {
            add(timestamp, "dimension", "Dimension changed", dimension + " → " + currentDimension);
        }
        if (Boolean.FALSE.equals(dead) && currentlyDead && !deathLogged) {
            pendingDeathAt = timestamp;
        }
        if (pendingDeathAt >= 0 && !deathLogged && timestamp - pendingDeathAt >= DEATH_MESSAGE_GRACE_MILLIS) {
            add(timestamp, "death", "Died", "Observed alive-to-dead transition; no death message was received.");
            deathLogged = true;
        }
        if (Boolean.TRUE.equals(dead) && !currentlyDead) {
            add(timestamp, "lifecycle", "Respawned", currentDimension);
            deathLogged = false;
            pendingDeathAt = -1;
        }
        if (currentHealth != null && maxHealth != null) observeHealth(timestamp, currentHealth, maxHealth, currentlyDead);
        dead = currentlyDead;
        dimension = currentDimension;
    }

    private void observeHealth(long timestamp, double currentHealth, double maxHealth, boolean currentlyDead) {
        if (health != null && currentHealth < health - 0.001) {
            double amount = health - currentHealth;
            String source = damageSource != null && timestamp - damageSourceAt <= DAMAGE_SOURCE_MILLIS
                    ? damageSource : "Unknown source";
            String key = "damage:" + source;
            boolean merge = canCoalesce(key, timestamp);
            double total = (merge ? coalesceAmount : 0) + amount;
            long hits = (merge ? coalesceCount : 0) + 1;
            String label = "Took " + hearts(total) + " damage";
            String details = "From " + source + (hits > 1 ? " · " + hits + " hits" : "")
                    + " · health " + number(currentHealth) + "/" + number(maxHealth);
            record(timestamp, "damage", label, details, key, hits, total);
            belowFullHealth = true;
        } else if (health == null && currentHealth < maxHealth) {
            belowFullHealth = true;
        }
        if (currentlyDead) {
            belowFullHealth = false;
        } else if (belowFullHealth && currentHealth >= maxHealth) {
            add(timestamp, "heal", "Healed to full health", number(currentHealth) + "/" + number(maxHealth) + " health");
            belowFullHealth = false;
        }
        health = currentHealth;
    }

    public void damageSource(long timestamp, String source) {
        damageSource = Objects.requireNonNull(source);
        damageSourceAt = timestamp;
    }

    public void deathMessage(long timestamp, String message) {
        if (!active || deathLogged) return;
        add(timestamp, "death", "Died", message.isBlank() ? "No death message." : message);
        deathLogged = true;
        pendingDeathAt = -1;
    }

    public void blockMined(long timestamp, String blockId, String name, int x, int y, int z) {
        counted(timestamp, "mine", "mine:" + blockId, "Mined", name, "Last at " + x + ", " + y + ", " + z);
    }

    public void blockPlaced(long timestamp, String blockId, String name, int x, int y, int z) {
        counted(timestamp, "place", "place:" + blockId, "Placed", name, "Last at " + x + ", " + y + ", " + z);
    }

    public void itemDropped(long timestamp, String itemId, String name, int count) {
        String key = "drop:" + itemId + ":" + name;
        boolean merge = canCoalesce(key, timestamp);
        long total = (merge ? coalesceCount : 0) + count;
        record(timestamp, "drop", "Dropped " + total + " × " + name, itemId, key, total, 0);
    }

    public void containerOpened(long timestamp, String title) {
        add(timestamp, "container", "Opened " + title, "");
    }

    /** {@code changes} maps an item name to its net count change while a screen was open. */
    public void inventoryChanged(long timestamp, String context, Map<String, Integer> changes) {
        List<String> gained = new ArrayList<>();
        List<String> lost = new ArrayList<>();
        changes.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
            if (entry.getValue() > 0) gained.add(entry.getValue() + " × " + entry.getKey());
            if (entry.getValue() < 0) lost.add(-entry.getValue() + " × " + entry.getKey());
        });
        if (gained.isEmpty() && lost.isEmpty()) return;
        StringBuilder details = new StringBuilder();
        if (!gained.isEmpty()) details.append("Gained ").append(String.join(", ", gained));
        if (!lost.isEmpty()) {
            if (!details.isEmpty()) details.append(" · ");
            details.append("Lost ").append(String.join(", ", lost));
        }
        add(timestamp, "inventory", "Inventory changed (" + context + ")", details.toString());
    }

    /** A kill attributed to the local player's own attack. */
    public void killed(long timestamp, String entityTypeId, String name) {
        attributedKills.computeIfAbsent(entityTypeId, key -> new ArrayDeque<>()).addLast(timestamp);
        counted(timestamp, "kill", "kill:" + entityTypeId + ":" + name, "Killed", name, entityTypeId);
    }

    /**
     * Reconciles synchronized kill statistics with attack-attributed kills, so ranged and indirect kills that were
     * not seen directly are still logged with their exact entity type.
     */
    public void killStatistics(long timestamp, Map<String, Integer> deltas, Function<String, String> names) {
        deltas.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
            ArrayDeque<Long> attributed = attributedKills.getOrDefault(entry.getKey(), new ArrayDeque<>());
            while (!attributed.isEmpty() && timestamp - attributed.peekFirst() > KILL_ATTRIBUTION_MILLIS) {
                attributed.removeFirst();
            }
            int unexplained = entry.getValue();
            while (unexplained > 0 && !attributed.isEmpty()) {
                attributed.removeFirst();
                unexplained--;
            }
            String name = names.apply(entry.getKey());
            for (int index = 0; index < unexplained; index++) {
                counted(timestamp, "kill", "kill:" + entry.getKey() + ":" + name, "Killed", name,
                        entry.getKey() + " · counted from statistics (ranged or indirect kill)");
            }
        });
    }

    public void advancement(long timestamp, String type, String title, String description) {
        String prefix = switch (type.toLowerCase(Locale.ROOT)) {
            case "goal" -> "Goal reached";
            case "challenge" -> "Challenge complete";
            default -> "Advancement made";
        };
        add(timestamp, "advancement", prefix + ": " + title, description);
    }

    public GameplayHistory snapshot() {
        return new GameplayHistory(sessionId, active, List.copyOf(events));
    }

    private void counted(long timestamp, String category, String key, String verb, String name, String details) {
        long count = (canCoalesce(key, timestamp) ? coalesceCount : 0) + 1;
        record(timestamp, category, verb + " " + (count > 1 ? count + " × " : "") + name, details, key, count, 0);
    }

    private boolean canCoalesce(String key, long timestamp) {
        return key.equals(coalesceKey) && !lastArchived && !events.isEmpty()
                && timestamp - events.getLast().timestamp() <= COALESCE_MILLIS;
    }

    private void record(long timestamp, String category, String label, String details,
                        String key, long count, double amount) {
        if (!active) return;
        if (canCoalesce(key, timestamp)) {
            GameplayHistory.Event last = events.removeLast();
            events.addLast(event(last.id(), timestamp, category, label, details));
        } else {
            add(timestamp, category, label, details);
        }
        coalesceKey = key;
        coalesceCount = count;
        coalesceAmount = amount;
    }

    private void add(long timestamp, String category, String label, String details) {
        if (!active) return;
        archiveLast();
        if (events.size() == GameplayHistory.MAX_EVENTS) events.removeFirst();
        events.addLast(event(++nextId, timestamp, category, label, details));
        lastArchived = false;
        coalesceKey = null;
    }

    private void archiveLast() {
        if (!lastArchived && !events.isEmpty()) archive.accept(events.getLast());
        lastArchived = true;
    }

    private static GameplayHistory.Event event(long id, long timestamp, String category, String label, String details) {
        return new GameplayHistory.Event(id, timestamp, category, truncate(label, 256),
                truncate(details, GameplayHistory.MAX_DETAILS_LENGTH));
    }

    private static String truncate(String value, int length) {
        if (value.length() <= length) return value;
        int end = length - 1;
        if (Character.isHighSurrogate(value.charAt(end - 1))) end--;
        return value.substring(0, end) + "…";
    }

    private static String hearts(double health) {
        return number(health / 2) + " ♥";
    }

    private static String number(double value) {
        return value == Math.rint(value) ? Long.toString((long) value) : String.format(Locale.ROOT, "%.1f", value);
    }
}
