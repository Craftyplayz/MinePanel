package dev.craftyplayz.minepanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.craftyplayz.minepanel.telemetry.StatisticsSnapshot;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Persists the dashboard tile layout as a small, strictly validated JSON config file.
 *
 * <p>The top-level {@code tiles} and {@code settings} are the "Default" profile. Optional {@code profiles} are other
 * named layouts, {@code rules} switch between them (or show/hide tiles and change settings) based on what is
 * happening in game, and {@code pinned} lists item windows the player pinned on screen. The browser evaluates rules;
 * this class only checks that the file is well formed. Mirrors {@code normalizeLayout} in layout.js.
 */
public final class LayoutStore {
    public static final int COLUMNS = 12;
    public static final int MAX_BYTES = 256 * 1024;
    public static final int MAX_STATISTIC_IDS = 512;
    public static final int MAX_PROFILES = 16;
    public static final int MAX_RULES = 64;
    public static final int MAX_GROUPS = 8;
    public static final int MAX_CONDITIONS = 8;
    public static final int MAX_VALUES = 32;
    public static final int MAX_PINNED = 16;
    private static final Pattern LOOPBACK_URL =
            Pattern.compile("http://(127\\.0\\.0\\.1|localhost)(:[0-9]{1,5})?(/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?");
    private static final Pattern ID = Pattern.compile("[a-z0-9-]{1,32}");
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    public static final List<String> TILE_IDS = List.of("player", "inventory", "statistics", "history", "map", "build",
            "movement", "xp", "pickups", "advancements", "villagers");
    public static final List<String> CONDITION_TYPES = List.of("world", "dimension", "biome", "time", "gameMode",
            "health", "food", "saturation", "effect", "movement", "elytra", "advancement", "combat");
    public static final List<Integer> XP_WINDOWS = List.of(10, 30, 60, 300, 600, 3600);
    public static final int MAX_XP_GOALS = 8;
    public static final int MAX_XP_GOAL_LEVEL = 10000;
    public static final List<String> PIN_SOURCES = List.of("inventory", "enderchest", "enderchest-item");
    /** How often the game samples the player for the dashboard; one client tick is 50 ms, so 50 is the fastest. */
    public static final List<Integer> UPDATE_INTERVALS = List.of(50, 100, 250, 500, 1000);
    public static final int DEFAULT_UPDATE_INTERVAL = 250;
    private final Path file;
    private volatile int updateIntervalMillis = DEFAULT_UPDATE_INTERVAL;

    public LayoutStore(Path file) {
        this.file = file;
    }

    /** The update interval from the last layout loaded or saved; read by the game thread every tick. */
    public int updateIntervalMillis() {
        return updateIntervalMillis;
    }

    /** Returns the stored layout, or {@code null} when none is saved or the file is unreadable/invalid. */
    public synchronized String load() {
        try {
            if (!Files.isRegularFile(file) || Files.size(file) > MAX_BYTES) return null;
            String normalized = normalize(Files.readString(file, StandardCharsets.UTF_8));
            updateIntervalMillis = updateInterval(normalized);
            return normalized;
        } catch (IOException | RuntimeException invalid) {
            return null;
        }
    }

    public synchronized void save(String json) throws IOException {
        String normalized = normalize(json);
        Files.createDirectories(file.getParent());
        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(temporary, normalized, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
        updateIntervalMillis = updateInterval(normalized);
    }

    /** The update interval of a normalized layout, or the default when it has none. */
    static int updateInterval(String normalized) {
        JsonObject updates = JsonParser.parseString(normalized).getAsJsonObject().getAsJsonObject("updates");
        return updates != null && updates.has("intervalMillis")
                ? updates.get("intervalMillis").getAsInt() : DEFAULT_UPDATE_INTERVAL;
    }

    /** Validates a layout and re-serializes only the known fields. */
    public static String normalize(String json) {
        if (json == null || json.length() > MAX_BYTES) throw new IllegalArgumentException("layout too large");
        try {
            return normalizeParsed(json);
        } catch (IllegalArgumentException invalid) {
            throw invalid;
        } catch (RuntimeException malformed) {
            throw new IllegalArgumentException("malformed layout", malformed);
        }
    }

    private static String normalizeParsed(String json) {
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        if (integer(root.get("version"), 1, 1) != 1) throw new IllegalArgumentException("unsupported layout version");
        JsonObject result = new JsonObject();
        result.addProperty("version", 1);
        result.add("tiles", tiles(root.getAsJsonArray("tiles")));
        if (root.has("settings")) result.add("settings", settings(root.getAsJsonObject("settings")));
        Set<String> profileIds = new HashSet<>(Set.of("default"));
        if (root.has("profiles")) {
            JsonArray profiles = root.getAsJsonArray("profiles");
            if (profiles.size() > MAX_PROFILES) throw new IllegalArgumentException("too many profiles");
            JsonArray normalized = new JsonArray();
            for (JsonElement element : profiles) {
                JsonObject profile = element.getAsJsonObject();
                String id = id(profile.get("id"));
                if (!profileIds.add(id)) throw new IllegalArgumentException("duplicate profile");
                JsonObject copy = new JsonObject();
                copy.addProperty("id", id);
                copy.addProperty("name", text(profile.get("name"), 64));
                copy.add("tiles", tiles(profile.getAsJsonArray("tiles")));
                if (profile.has("settings")) copy.add("settings", settings(profile.getAsJsonObject("settings")));
                normalized.add(copy);
            }
            result.add("profiles", normalized);
        }
        if (root.has("rules")) result.add("rules", rules(root.getAsJsonArray("rules"), profileIds));
        if (root.has("pinned")) result.add("pinned", pinned(root.getAsJsonArray("pinned")));
        if (root.has("updates")) result.add("updates", updates(root.getAsJsonObject("updates")));
        return result.toString();
    }

    /** Global, not per profile: the game samples at one rate whichever profile the browser shows. */
    private static JsonObject updates(JsonObject source) {
        JsonObject result = new JsonObject();
        if (source.has("intervalMillis")) {
            int interval = integer(source.get("intervalMillis"), 1, 1000);
            if (!UPDATE_INTERVALS.contains(interval)) throw new IllegalArgumentException("unknown update interval");
            result.addProperty("intervalMillis", interval);
        }
        return result;
    }

    private static JsonArray tiles(JsonArray tiles) {
        if (tiles == null || tiles.size() > TILE_IDS.size()) throw new IllegalArgumentException("invalid tile list");
        Set<String> seen = new HashSet<>();
        JsonArray normalizedTiles = new JsonArray();
        for (JsonElement element : tiles) {
            JsonObject tile = element.getAsJsonObject();
            String id = tile.get("id").getAsString();
            if (!TILE_IDS.contains(id) || !seen.add(id)) throw new IllegalArgumentException("unknown or duplicate tile");
            JsonPrimitive enabled = tile.getAsJsonPrimitive("enabled");
            if (enabled == null || !enabled.isBoolean()) throw new IllegalArgumentException("enabled must be boolean");
            int w = integer(tile.get("w"), 1, COLUMNS);
            int x = integer(tile.get("x"), 0, COLUMNS - w);
            int y = integer(tile.get("y"), 0, 1000);
            int h = integer(tile.get("h"), 1, 60);
            JsonObject normalized = new JsonObject();
            normalized.addProperty("id", id);
            normalized.addProperty("enabled", enabled.getAsBoolean());
            normalized.addProperty("x", x);
            normalized.addProperty("y", y);
            normalized.addProperty("w", w);
            normalized.addProperty("h", h);
            // A rules-only tile keeps its place in the layout but is hidden until a rule shows it.
            if (tile.has("rulesOnly") && bool(tile.get("rulesOnly"))) normalized.addProperty("rulesOnly", true);
            normalizedTiles.add(normalized);
        }
        return normalizedTiles;
    }

    /** Per-tile preferences; unknown keys are dropped, malformed known keys reject the layout. */
    private static JsonObject settings(JsonObject source) {
        JsonObject result = new JsonObject();
        if (source.has("inventory")) {
            JsonObject inventory = source.getAsJsonObject("inventory");
            JsonObject normalized = new JsonObject();
            if (inventory.has("showArmor")) normalized.addProperty("showArmor", bool(inventory.get("showArmor")));
            result.add("inventory", normalized);
        }
        if (source.has("statistics")) {
            JsonObject statistics = source.getAsJsonObject("statistics");
            JsonObject normalized = new JsonObject();
            for (String key : List.of("shown", "recentExcluded")) {
                if (statistics.has(key)) normalized.add(key, statisticIds(statistics.getAsJsonArray(key)));
            }
            if (statistics.has("recentLifetime")) {
                normalized.addProperty("recentLifetime", integer(statistics.get("recentLifetime"), 0, 3600));
            }
            if (statistics.has("recentRows")) normalized.addProperty("recentRows", integer(statistics.get("recentRows"), 1, 32));
            result.add("statistics", normalized);
        }
        if (source.has("map")) {
            JsonObject map = source.getAsJsonObject("map");
            JsonObject normalized = new JsonObject();
            if (map.has("url")) {
                String url = map.get("url").getAsString();
                if (!LOOPBACK_URL.matcher(url).matches()) throw new IllegalArgumentException("map URL must be loopback http");
                normalized.addProperty("url", url);
            }
            result.add("map", normalized);
        }
        if (source.has("movement")) {
            JsonObject movement = source.getAsJsonObject("movement");
            JsonObject normalized = new JsonObject();
            for (String key : List.of("showVertical", "showGlider")) {
                if (movement.has(key)) normalized.addProperty(key, bool(movement.get(key)));
            }
            result.add("movement", normalized);
        }
        if (source.has("xp")) {
            JsonObject xp = source.getAsJsonObject("xp");
            JsonObject normalized = new JsonObject();
            if (xp.has("window")) {
                int window = integer(xp.get("window"), 1, 3600);
                if (!XP_WINDOWS.contains(window)) throw new IllegalArgumentException("unknown XP window");
                normalized.addProperty("window", window);
            }
            if (xp.has("goals")) normalized.add("goals", xpGoals(xp.getAsJsonArray("goals")));
            result.add("xp", normalized);
        }
        if (source.has("pickups")) {
            JsonObject pickups = source.getAsJsonObject("pickups");
            JsonObject normalized = new JsonObject();
            if (pickups.has("lifetime")) normalized.addProperty("lifetime", integer(pickups.get("lifetime"), 0, 3600));
            if (pickups.has("maxRows")) normalized.addProperty("maxRows", integer(pickups.get("maxRows"), 1, 32));
            if (pickups.has("showSource")) normalized.addProperty("showSource", bool(pickups.get("showSource")));
            if (pickups.has("ignored")) normalized.add("ignored", itemIds(pickups.getAsJsonArray("ignored")));
            result.add("pickups", normalized);
        }
        if (source.has("advancements")) {
            JsonObject advancements = source.getAsJsonObject("advancements");
            JsonObject normalized = new JsonObject();
            if (advancements.has("popupSeconds")) {
                normalized.addProperty("popupSeconds", integer(advancements.get("popupSeconds"), 0, 300));
            }
            result.add("advancements", normalized);
        }
        return result;
    }

    private static JsonArray rules(JsonArray source, Set<String> profileIds) {
        if (source.size() > MAX_RULES) throw new IllegalArgumentException("too many rules");
        Set<String> ids = new HashSet<>();
        JsonArray result = new JsonArray();
        for (JsonElement element : source) {
            JsonObject rule = element.getAsJsonObject();
            JsonObject copy = new JsonObject();
            String id = id(rule.get("id"));
            if (!ids.add(id)) throw new IllegalArgumentException("duplicate rule");
            copy.addProperty("id", id);
            copy.addProperty("name", text(rule.get("name"), 64));
            copy.addProperty("enabled", bool(rule.get("enabled")));
            JsonArray groups = rule.getAsJsonArray("groups");
            if (groups.size() > MAX_GROUPS) throw new IllegalArgumentException("too many condition groups");
            JsonArray normalizedGroups = new JsonArray();
            for (JsonElement group : groups) {
                JsonArray conditions = group.getAsJsonArray();
                if (conditions.isEmpty() || conditions.size() > MAX_CONDITIONS) {
                    throw new IllegalArgumentException("a condition group needs 1 to 8 conditions");
                }
                JsonArray normalizedConditions = new JsonArray();
                for (JsonElement condition : conditions) normalizedConditions.add(condition(condition.getAsJsonObject()));
                normalizedGroups.add(normalizedConditions);
            }
            copy.add("groups", normalizedGroups);
            if (rule.has("profile") && !rule.get("profile").isJsonNull()) {
                String profile = id(rule.get("profile"));
                if (!profileIds.contains(profile)) throw new IllegalArgumentException("rule names an unknown profile");
                copy.addProperty("profile", profile);
            }
            if (rule.has("tiles")) {
                JsonObject tiles = rule.getAsJsonObject("tiles");
                JsonObject normalized = new JsonObject();
                for (Map.Entry<String, JsonElement> entry : tiles.entrySet()) {
                    String action = entry.getValue().getAsString();
                    if (!TILE_IDS.contains(entry.getKey()) || !List.of("show", "hide").contains(action)) {
                        throw new IllegalArgumentException("invalid tile action");
                    }
                    normalized.addProperty(entry.getKey(), action);
                }
                copy.add("tiles", normalized);
            }
            if (rule.has("settings")) copy.add("settings", settings(rule.getAsJsonObject("settings")));
            result.add(copy);
        }
        return result;
    }

    private static JsonObject condition(JsonObject source) {
        String type = source.get("type").getAsString();
        if (!CONDITION_TYPES.contains(type)) throw new IllegalArgumentException("unknown condition");
        JsonObject result = new JsonObject();
        result.addProperty("type", type);
        if (source.has("not") && bool(source.get("not"))) result.addProperty("not", true);
        if (source.has("values")) {
            JsonArray values = source.getAsJsonArray("values");
            if (values.size() > MAX_VALUES) throw new IllegalArgumentException("too many condition values");
            JsonArray normalized = new JsonArray();
            for (JsonElement value : values) normalized.add(text(value, 128));
            result.add("values", normalized);
        }
        for (String key : List.of("min", "max")) {
            if (source.has(key)) {
                double value = source.get(key).getAsJsonPrimitive().getAsDouble();
                if (!Double.isFinite(value) || value < 0 || value > 1024) {
                    throw new IllegalArgumentException("condition bound out of range");
                }
                result.addProperty(key, value);
            }
        }
        if (source.has("seconds")) result.addProperty("seconds", integer(source.get("seconds"), 1, 3600));
        return result;
    }

    private static JsonArray pinned(JsonArray source) {
        if (source.size() > MAX_PINNED) throw new IllegalArgumentException("too many pinned windows");
        JsonArray result = new JsonArray();
        for (JsonElement element : source) {
            JsonObject window = element.getAsJsonObject();
            String kind = window.get("source").getAsString();
            if (!PIN_SOURCES.contains(kind)) throw new IllegalArgumentException("unknown window");
            JsonObject copy = new JsonObject();
            copy.addProperty("source", kind);
            copy.addProperty("slot", integer(window.get("slot"), 0, 40));
            copy.addProperty("x", integer(window.get("x"), 0, 10000));
            copy.addProperty("y", integer(window.get("y"), 0, 10000));
            result.add(copy);
        }
        return result;
    }

    private static JsonArray statisticIds(JsonArray source) {
        if (source.size() > MAX_STATISTIC_IDS) throw new IllegalArgumentException("too many statistics");
        Set<String> seen = new HashSet<>();
        JsonArray result = new JsonArray();
        for (JsonElement element : source) {
            String id = element.getAsJsonPrimitive().getAsString();
            if (!StatisticsSnapshot.validId(id)) throw new IllegalArgumentException("invalid statistic id");
            if (seen.add(id)) result.add(id);
        }
        return result;
    }

    /** Custom target levels for the Experience tile, without duplicates. */
    private static JsonArray xpGoals(JsonArray source) {
        if (source.size() > MAX_XP_GOALS) throw new IllegalArgumentException("too many XP goals");
        Set<Integer> seen = new HashSet<>();
        JsonArray result = new JsonArray();
        for (JsonElement element : source) {
            int level = integer(element, 1, MAX_XP_GOAL_LEVEL);
            if (seen.add(level)) result.add(level);
        }
        return result;
    }

    private static JsonArray itemIds(JsonArray source) {
        if (source.size() > 64) throw new IllegalArgumentException("too many items");
        Set<String> seen = new HashSet<>();
        JsonArray result = new JsonArray();
        for (JsonElement element : source) {
            String id = element.getAsJsonPrimitive().getAsString();
            if (id.length() > 256 || !ITEM_ID.matcher(id).matches()) throw new IllegalArgumentException("invalid item id");
            if (seen.add(id)) result.add(id);
        }
        return result;
    }

    private static String id(JsonElement value) {
        String id = value.getAsJsonPrimitive().getAsString();
        if (!ID.matcher(id).matches()) throw new IllegalArgumentException("invalid id");
        return id;
    }

    private static String text(JsonElement value, int maxLength) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException("expected text");
        }
        String text = value.getAsString();
        if (text.isEmpty() || text.length() > maxLength) throw new IllegalArgumentException("text length out of range");
        return text;
    }

    private static boolean bool(JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
            throw new IllegalArgumentException("expected a boolean");
        }
        return value.getAsBoolean();
    }

    private static int integer(JsonElement value, int min, int max) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("expected an integer");
        }
        double number = value.getAsDouble();
        if (number != Math.rint(number) || number < min || number > max) {
            throw new IllegalArgumentException("integer out of range");
        }
        return (int) number;
    }
}
