package dev.craftyplayz.minepanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.craftyplayz.minepanel.telemetry.FrameStats;
import dev.craftyplayz.minepanel.telemetry.SensorNeeds;
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
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Persists the dashboard tile layout as a small, strictly validated JSON config file.
 *
 * <p>The top-level {@code tiles} and {@code settings} are the "Default" profile. Optional {@code profiles} are other
 * named layouts, {@code rules} switch between them, show, hide, move or focus tiles and change settings based on what
 * is happening in game, and {@code pinned} lists item windows the player pinned on screen. The browser evaluates
 * rules; this class only checks that the file is well formed. Mirrors {@code normalizeLayout} in layout.js.
 *
 * <p>Layout version 2 (docs/RULES_V2.md) is current and validated by {@link LayoutRules}. A stored version 1 layout is
 * still read, so the browser can convert it; when the converted layout is first saved, the old file is kept as
 * {@code layout.v1-backup.json}. Only version 2 is saved. A stored file that fails validation is copied to
 * {@code layout.rejected.json} before anything can overwrite it.
 */
public final class LayoutStore {
    public static final int VERSION = 2;
    public static final int COLUMNS = 12;
    public static final int MAX_BYTES = 256 * 1024;
    public static final int MAX_STATISTIC_IDS = 512;
    public static final int MAX_PROFILES = 16;
    public static final int V1_MAX_RULES = 64;
    public static final int V1_MAX_GROUPS = 8;
    public static final int V1_MAX_CONDITIONS = 8;
    public static final int MAX_VALUES = 32;
    public static final int MAX_PINNED = 16;
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final Pattern LOOPBACK_URL =
            Pattern.compile("http://(127\\.0\\.0\\.1|localhost)(:[0-9]{1,5})?(/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?");
    private static final Pattern ID = Pattern.compile("[a-z0-9-]{1,32}");
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    public static final List<String> TILE_IDS = List.of("player", "inventory", "statistics", "history", "map", "build",
            "movement", "xp", "pickups", "advancements", "villagers", "performance", "afk", "model", "backpack", "backpacks");
    /** The 3D render panel's spin axes (vertical, head over heels, cartwheel) and speeds in degrees per second. */
    public static final List<String> MODEL_AXES = List.of("y", "x", "z");
    public static final List<Integer> MODEL_SPEEDS = List.of(15, 30, 60, 120);
    /** The AFK panel's statistics text sizes in px and crawl speeds in px a second. */
    public static final List<Integer> AFK_FONT_SIZES = List.of(11, 13, 16, 20, 24, 32);
    public static final List<Integer> AFK_SPEEDS = List.of(10, 20, 40, 80);
    /** Version 1 condition types; version 2 types are in {@link LayoutRules}. */
    public static final List<String> V1_CONDITION_TYPES = List.of("world", "dimension", "biome", "time", "gameMode",
            "health", "food", "saturation", "effect", "movement", "elytra", "advancement", "combat");
    public static final List<Integer> XP_WINDOWS = List.of(10, 30, 60, 300, 600, 3600);
    public static final int MAX_XP_GOALS = 8;
    public static final int MAX_XP_GOAL_LEVEL = 10000;
    public static final List<String> PIN_SOURCES = List.of("inventory", "enderchest", "enderchest-item", "accessory");
    /** How often the game samples the player for the dashboard; one client tick is 50 ms, so 50 is the fastest. */
    public static final List<Integer> UPDATE_INTERVALS = List.of(50, 100, 250, 500, 1000);
    public static final int DEFAULT_UPDATE_INTERVAL = 250;
    private final Path file;
    private volatile int updateIntervalMillis = DEFAULT_UPDATE_INTERVAL;
    private volatile SensorNeeds sensorNeeds = SensorNeeds.NONE;
    private volatile Set<String> backpackSelections = Set.of();
    /** How many selected backpacks the game reads in full for the Backpacks panels. */
    static final int MAX_WATCHED_BACKPACKS = 7;
    private static final Pattern BACKPACK_UUID =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    public LayoutStore(Path file) {
        this.file = file;
    }

    /** The update interval from the last layout loaded or saved; read by the game thread every tick. */
    public int updateIntervalMillis() {
        return updateIntervalMillis;
    }

    /** The costlier rule sensors that enabled rules of the last layout loaded or saved read; read every sample. */
    /** Backpacks the saved layout's Backpacks panels select, which the game reads in full (any thread). */
    public Set<String> backpackSelections() {
        return backpackSelections;
    }

    public SensorNeeds sensorNeeds() {
        return sensorNeeds;
    }

    /**
     * Returns the stored layout (version 1 or 2), or {@code null} when none is saved or the file is unreadable or
     * invalid. An invalid file is copied to {@code layout.rejected.json} first, so a later save can't lose it.
     */
    public synchronized String load() {
        if (!Files.isRegularFile(file)) return null;
        try {
            if (Files.size(file) > MAX_BYTES) throw new IllegalArgumentException("layout too large");
            String normalized = normalize(Files.readString(file, StandardCharsets.UTF_8));
            updateIntervalMillis = updateInterval(normalized);
            sensorNeeds = LayoutRules.needs(JsonParser.parseString(normalized).getAsJsonObject());
            backpackSelections = backpackSelections(JsonParser.parseString(normalized).getAsJsonObject());
            return normalized;
        } catch (IOException | RuntimeException invalid) {
            keepRejected(invalid);
            return null;
        }
    }

    /** Saves a version 2 layout; version 1 is only read. Keeps a copy of a stored version 1 file the first time. */
    public synchronized void save(String json) throws IOException {
        String normalized = normalize(json);
        if (version(normalized) != VERSION) throw new IllegalArgumentException("only version " + VERSION + " layouts are saved");
        Files.createDirectories(file.getParent());
        backUpVersion1();
        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(temporary, normalized, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
        updateIntervalMillis = updateInterval(normalized);
        sensorNeeds = LayoutRules.needs(JsonParser.parseString(normalized).getAsJsonObject());
        backpackSelections = backpackSelections(JsonParser.parseString(normalized).getAsJsonObject());
    }

    /** The file beside the layout named {@code layout.<suffix>.json}. */
    Path sibling(String suffix) {
        String name = file.getFileName().toString();
        String base = name.endsWith(".json") ? name.substring(0, name.length() - ".json".length()) : name;
        return file.resolveSibling(base + "." + suffix + ".json");
    }

    /** Before the first version 2 layout replaces a stored version 1 file, that file is kept as a backup. */
    private void backUpVersion1() throws IOException {
        Path backup = sibling("v1-backup");
        if (!Files.isRegularFile(file) || Files.exists(backup)) return;
        int stored;
        try {
            stored = version(Files.readString(file, StandardCharsets.UTF_8));
        } catch (IOException | RuntimeException unreadable) {
            return;
        }
        if (stored == 1) Files.copy(file, backup);
    }

    private void keepRejected(Exception reason) {
        Path copy = sibling("rejected");
        try {
            Files.copy(file, copy, StandardCopyOption.REPLACE_EXISTING);
            LOGGER.log(Level.WARNING, "MinePanel could not read its saved dashboard layout (" + reason.getMessage()
                    + "); a copy was kept as " + copy.getFileName() + ".");
        } catch (IOException failure) {
            LOGGER.log(Level.WARNING, "MinePanel could not read or copy its saved dashboard layout.", failure);
        }
    }

    /** The {@code version} of layout JSON. */
    static int version(String json) {
        return JsonParser.parseString(json).getAsJsonObject().get("version").getAsInt();
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
        int version = integer(root.get("version"), 1, VERSION);
        JsonObject result = new JsonObject();
        result.addProperty("version", version);
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
        if (version == 1) {
            if (root.has("rules")) result.add("rules", rulesV1(root.getAsJsonArray("rules"), profileIds));
        } else {
            rulesV2(root, profileIds, result);
        }
        if (root.has("pinned")) result.add("pinned", pinned(root.getAsJsonArray("pinned")));
        if (root.has("updates")) result.add("updates", updates(root.getAsJsonObject("updates")));
        return result.toString();
    }

    /** Animation, folders, places, toggles and rules of a version 2 layout. */
    private static void rulesV2(JsonObject root, Set<String> profileIds, JsonObject result) {
        if (root.has("animation")) result.add("animation", LayoutRules.animation(root.get("animation")));
        JsonArray folders = root.has("folders") ? LayoutRules.folders(root.get("folders")) : new JsonArray();
        JsonArray places = root.has("places") ? LayoutRules.places(root.get("places")) : new JsonArray();
        JsonArray toggles = root.has("toggles") ? LayoutRules.toggles(root.get("toggles")) : new JsonArray();
        if (root.has("folders")) result.add("folders", folders);
        if (root.has("places")) result.add("places", places);
        if (root.has("toggles")) result.add("toggles", toggles);
        if (root.has("rules")) {
            LayoutRules.Refs refs = new LayoutRules.Refs(profileIds, LayoutRules.ids(folders), LayoutRules.ids(places),
                    LayoutRules.ids(toggles), new HashSet<>());
            result.add("rules", LayoutRules.rules(root.get("rules"), refs));
        }
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
    static JsonObject settings(JsonObject source) {
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
                if (url.length() > 200 || !LOOPBACK_URL.matcher(url).matches()) throw new IllegalArgumentException("map URL must be loopback http");
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
        if (source.has("performance")) {
            JsonObject performance = source.getAsJsonObject("performance");
            JsonObject normalized = new JsonObject();
            if (performance.has("window")) {
                int window = integer(performance.get("window"), 1, 600);
                if (!FrameStats.WINDOWS.contains(window)) throw new IllegalArgumentException("unknown performance window");
                normalized.addProperty("window", window);
            }
            result.add("performance", normalized);
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
            if (advancements.has("hiddenTabs")) {
                normalized.add("hiddenTabs", itemIds(advancements.getAsJsonArray("hiddenTabs")));
            }
            if (advancements.has("pinned")) {
                normalized.add("pinned", itemIds(advancements.getAsJsonArray("pinned")));
            }
            result.add("advancements", normalized);
        }
        if (source.has("model")) {
            JsonObject model = source.getAsJsonObject("model");
            JsonObject normalized = new JsonObject();
            if (model.has("spin")) normalized.addProperty("spin", bool(model.get("spin")));
            if (model.has("axis")) {
                String axis = text(model.get("axis"), 1);
                if (!MODEL_AXES.contains(axis)) throw new IllegalArgumentException("unknown spin axis");
                normalized.addProperty("axis", axis);
            }
            if (model.has("speed")) {
                int speed = integer(model.get("speed"), 1, 360);
                if (!MODEL_SPEEDS.contains(speed)) throw new IllegalArgumentException("unknown spin speed");
                normalized.addProperty("speed", speed);
            }
            result.add("model", normalized);
        }
        if (source.has("afk")) {
            JsonObject afk = source.getAsJsonObject("afk");
            JsonObject normalized = new JsonObject();
            if (afk.has("fontSize")) {
                int size = integer(afk.get("fontSize"), 1, 100);
                if (!AFK_FONT_SIZES.contains(size)) throw new IllegalArgumentException("unknown AFK text size");
                normalized.addProperty("fontSize", size);
            }
            if (afk.has("speed")) {
                int speed = integer(afk.get("speed"), 1, 1000);
                if (!AFK_SPEEDS.contains(speed)) throw new IllegalArgumentException("unknown AFK speed");
                normalized.addProperty("speed", speed);
            }
            if (afk.has("hidden")) normalized.add("hidden", statisticIds(afk.getAsJsonArray("hidden")));
            result.add("afk", normalized);
        }
        if (source.has("backpacks")) {
            JsonObject backpacks = source.getAsJsonObject("backpacks");
            JsonObject normalized = new JsonObject();
            if (backpacks.has("selected")) {
                String selected = text(backpacks.get("selected"), 36);
                if (!selected.equals("last") && !BACKPACK_UUID.matcher(selected).matches()) {
                    throw new IllegalArgumentException("selected backpack must be \"last\" or a UUID");
                }
                normalized.addProperty("selected", selected);
            }
            result.add("backpacks", normalized);
        }
        return result;
    }

    /**
     * The backpacks a normalized layout's Backpacks panels may show: every UUID a profile's {@code backpacks.selected}
     * setting or a rule's set action names (not "last"), at most {@value #MAX_WATCHED_BACKPACKS}.
     */
    static Set<String> backpackSelections(JsonObject layout) {
        Set<String> selected = new java.util.LinkedHashSet<>();
        java.util.function.Consumer<JsonObject> fromSettings = settings -> {
            if (settings != null && settings.has("backpacks") && settings.getAsJsonObject("backpacks").has("selected")) {
                selected.add(settings.getAsJsonObject("backpacks").get("selected").getAsString());
            }
        };
        if (layout.has("settings")) fromSettings.accept(layout.getAsJsonObject("settings"));
        if (layout.has("profiles")) {
            for (JsonElement profile : layout.getAsJsonArray("profiles")) {
                fromSettings.accept(profile.getAsJsonObject().has("settings")
                        ? profile.getAsJsonObject().getAsJsonObject("settings") : null);
            }
        }
        if (layout.has("rules")) {
            for (JsonElement rule : layout.getAsJsonArray("rules")) {
                for (String branch : List.of("then", "else")) {
                    if (!rule.getAsJsonObject().has(branch)) continue;
                    for (JsonElement action : rule.getAsJsonObject().getAsJsonArray(branch)) {
                        JsonObject value = action.getAsJsonObject();
                        // Only set actions carry a panel and setting; profile and notify actions have neither.
                        if ("set".equals(value.get("do").getAsString()) && "backpacks".equals(value.get("panel").getAsString())
                                && "selected".equals(value.get("setting").getAsString())) {
                            selected.add(value.get("value").getAsString());
                        }
                    }
                }
            }
        }
        selected.remove("last");
        return selected.stream().limit(MAX_WATCHED_BACKPACKS).collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** Version 1 rules: every group needs one matching condition. Read only, to be converted by the browser. */
    private static JsonArray rulesV1(JsonArray source, Set<String> profileIds) {
        if (source.size() > V1_MAX_RULES) throw new IllegalArgumentException("too many rules");
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
            if (groups.size() > V1_MAX_GROUPS) throw new IllegalArgumentException("too many condition groups");
            JsonArray normalizedGroups = new JsonArray();
            for (JsonElement group : groups) {
                JsonArray conditions = group.getAsJsonArray();
                if (conditions.isEmpty() || conditions.size() > V1_MAX_CONDITIONS) {
                    throw new IllegalArgumentException("a condition group needs 1 to 8 conditions");
                }
                JsonArray normalizedConditions = new JsonArray();
                for (JsonElement condition : conditions) normalizedConditions.add(conditionV1(condition.getAsJsonObject()));
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

    private static JsonObject conditionV1(JsonObject source) {
        String type = source.get("type").getAsString();
        if (!V1_CONDITION_TYPES.contains(type)) throw new IllegalArgumentException("unknown condition");
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
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException("invalid id");
        }
        String id = value.getAsString();
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
