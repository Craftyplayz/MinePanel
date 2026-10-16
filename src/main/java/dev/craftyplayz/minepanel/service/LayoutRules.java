package dev.craftyplayz.minepanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import dev.craftyplayz.minepanel.telemetry.SensorNeeds;
import dev.craftyplayz.minepanel.telemetry.Sensors;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Validates the rules part of a version 2 layout: animation, folders, places, toggles and rules (docs/RULES_V2.md).
 *
 * <p>Mirrors {@code normalizeLayout} and {@code normalizeRule} in layout.js: both must accept and reject exactly the
 * same layouts, which the shared cases in {@code src/test/fixtures/layouts-v2.json} check from both sides. Only
 * known fields are kept; the browser fills in defaults. Errors name the rule they are about.
 */
final class LayoutRules {
    static final int MAX_RULES = 128;
    static final int MAX_CONDITIONS = 32;
    static final int MAX_ACTIONS = 16;
    static final int MAX_FOLDERS = 32;
    static final int MAX_PLACES = 64;
    static final int MAX_TOGGLES = 16;
    static final int MAX_VALUES = 32;
    static final int MAX_SECONDS = 3600;
    static final int MAX_TIMING_MILLIS = 600_000;
    static final int MIN_LINGER_MILLIS = 500;
    static final int MAX_ANIMATION_MILLIS = 5000;
    static final double MAX_COMPARE_VALUE = 1e9;
    static final double MAX_COORDINATE = 30_000_000;
    static final double MAX_PLACE_RADIUS = 100_000;
    static final int MAX_VILLAGER_RADIUS = 256;
    static final int MAX_PORTAL_MINUTES = 120;
    static final int MAX_NOTIFY_TEXT = 128;
    static final int LAYOUT_COLUMNS = 12;
    static final int LAYOUT_MAX_Y = 1000;
    static final int LAYOUT_MAX_H = 60;
    static final List<String> EASINGS = List.of("linear", "ease", "ease-in", "ease-out", "ease-in-out");
    static final List<String> COMPARES = List.of("<", "<=", "=", ">=", ">", "!=", "between");
    static final List<String> ACTIONS = List.of("profile", "show", "hide", "place", "swap", "focus", "set", "notify");
    static final int MAX_SENSOR_RADIUS = Sensors.MAX_RADIUS;
    static final Map<String, List<String>> CHOICES = Map.ofEntries(
            Map.entry("time", List.of("dawn", "day", "dusk", "night")),
            Map.entry("weather", List.of("clear", "rain", "thunder")),
            Map.entry("gameMode", List.of("survival", "creative", "adventure", "spectator")),
            Map.entry("movement", List.of("ground", "elytra", "swimming", "riding", "flying", "falling")),
            Map.entry("axis", List.of("total", "horizontal", "vertical")),
            Map.entry("hand", List.of("either", "main", "off")),
            Map.entry("durability", List.of("held", "armor", "tool")),
            Map.entry("moonPhase", List.of("full", "waningGibbous", "thirdQuarter", "waningCrescent", "new",
                    "waxingCrescent", "firstQuarter", "waxingGibbous")),
            Map.entry("usingItem", Sensors.USING),
            Map.entry("screen", Sensors.SCREENS.subList(1, Sensors.SCREENS.size())),
            Map.entry("lightSource", List.of("combined", "block", "sky")),
            Map.entry("lookTarget", List.of("block", "entity")));
    /** Minimum width and height of each panel, as TILE_MINIMUMS in layout.js. */
    static final Map<String, int[]> TILE_MINIMUMS = Map.ofEntries(
            Map.entry("player", new int[] {2, 2}), Map.entry("inventory", new int[] {3, 2}),
            Map.entry("statistics", new int[] {2, 3}), Map.entry("history", new int[] {3, 3}),
            Map.entry("map", new int[] {2, 2}), Map.entry("build", new int[] {2, 2}),
            Map.entry("movement", new int[] {2, 2}), Map.entry("xp", new int[] {2, 2}),
            Map.entry("pickups", new int[] {2, 2}), Map.entry("advancements", new int[] {3, 3}),
            Map.entry("villagers", new int[] {3, 3}), Map.entry("performance", new int[] {2, 2}),
            Map.entry("afk", new int[] {3, 3}));
    private static final Pattern ID = Pattern.compile("[a-z0-9-]{1,32}");
    private static final Pattern REGISTRY_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final Pattern STATISTIC_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_.-]+/[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final Pattern CLOCK = Pattern.compile("([01][0-9]|2[0-3]):[0-5][0-9]");

    /** A condition type: how its parameters are shaped and, for amounts and events, what they can be about. */
    private record Spec(String kind, String subject, boolean required) {
        Spec(String kind) {
            this(kind, null, false);
        }
    }

    private static final Map<String, Spec> CONDITIONS = conditionTypes();

    private static Map<String, Spec> conditionTypes() {
        Map<String, Spec> types = new HashMap<>();
        for (String type : List.of("world", "dimension", "biome")) types.put(type, new Spec("names"));
        for (String type : List.of("weather", "gameMode", "movement", "moonPhase", "usingItem", "screen")) {
            types.put(type, new Spec("choices"));
        }
        for (String type : List.of("day", "yLevel", "health", "food", "saturation", "absorption", "xpLevel",
                "freeSlots", "width", "sessionTime", "spawnDistance", "air", "armor", "afk")) {
            types.put(type, new Spec("compare"));
        }
        for (String type : List.of("still", "elytra", "inGame", "onFire", "inWater", "inLava", "inRain", "sneaking",
                "sprinting", "sleeping", "bossBar", "raid")) types.put(type, new Spec("none"));
        types.put("time", new Spec("time"));
        types.put("nearPlace", new Spec("place"));
        types.put("effect", new Spec("effect"));
        types.put("speed", new Spec("speed"));
        types.put("holding", new Spec("holding"));
        types.put("hasItem", new Spec("hasItem"));
        types.put("durability", new Spec("durability"));
        types.put("xpGained", new Spec("amount"));
        types.put("tookDamage", new Spec("amount"));
        types.put("pickedUp", new Spec("amount", "item", false));
        types.put("statRose", new Spec("amount", "stat", true));
        types.put("minedBlock", new Spec("amount", "block", false));
        types.put("placedBlock", new Spec("amount", "block", false));
        types.put("killedMob", new Spec("amount", "entity", false));
        types.put("advancement", new Spec("event", "advancement", false));
        for (String type : List.of("died", "changedDimension", "joinedWorld", "inCombat")) types.put(type, new Spec("event"));
        types.put("villagersNearby", new Spec("villagers"));
        types.put("portalLinking", new Spec("portal"));
        types.put("toggle", new Spec("toggle"));
        types.put("ruleActive", new Spec("rule"));
        types.put("realTime", new Spec("clock"));
        types.put("light", new Spec("light"));
        types.put("lookingAt", new Spec("look", "id", false));
        types.put("riding", new Spec("riding", "entity", false));
        types.put("hostilesNearby", new Spec("threat", "entity", false));
        types.put("mobNearby", new Spec("mob", "entity", true));
        types.put("playersNearby", new Spec("players"));
        return Map.copyOf(types);
    }

    /** The ids that conditions and actions may refer to. */
    record Refs(Set<String> profiles, Set<String> folders, Set<String> places, Set<String> toggles, Set<String> rules) {
    }

    private LayoutRules() {
    }

    static JsonObject animation(JsonElement value) {
        JsonObject source = object(value, "invalid animation");
        String easing = string(source.get("easing"), "invalid animation");
        if (!EASINGS.contains(easing)) throw new IllegalArgumentException("invalid animation");
        JsonObject result = new JsonObject();
        result.addProperty("durationMs", whole(source.get("durationMs"), 0, MAX_ANIMATION_MILLIS, "invalid animation"));
        result.addProperty("easing", easing);
        return result;
    }

    static JsonArray folders(JsonElement value) {
        return list(value, MAX_FOLDERS, "folders", element -> {
            JsonObject folder = object(element, "invalid folder");
            JsonObject result = new JsonObject();
            result.addProperty("id", id(folder.get("id"), "invalid folder"));
            result.addProperty("name", text(folder.get("name"), 64, "invalid folder"));
            result.addProperty("enabled", bool(folder.get("enabled"), "invalid folder"));
            result.addProperty("collapsed", bool(folder.get("collapsed"), "invalid folder"));
            return result;
        });
    }

    static JsonArray places(JsonElement value) {
        return list(value, MAX_PLACES, "places", element -> {
            JsonObject place = object(element, "invalid place");
            JsonObject result = new JsonObject();
            result.addProperty("id", id(place.get("id"), "invalid place"));
            result.addProperty("name", text(place.get("name"), 64, "invalid place"));
            result.addProperty("world", text(place.get("world"), 128, "invalid place"));
            result.addProperty("dimension", registryId(place.get("dimension"), "invalid place"));
            for (String axis : List.of("x", "y", "z")) {
                result.add(axis, number(place.get(axis), -MAX_COORDINATE, MAX_COORDINATE, "invalid place"));
            }
            return result;
        });
    }

    static JsonArray toggles(JsonElement value) {
        return list(value, MAX_TOGGLES, "toggles", element -> {
            JsonObject toggle = object(element, "invalid toggle");
            JsonObject result = new JsonObject();
            result.addProperty("id", id(toggle.get("id"), "invalid toggle"));
            result.addProperty("name", text(toggle.get("name"), 32, "invalid toggle"));
            result.addProperty("on", bool(toggle.get("on"), "invalid toggle"));
            return result;
        });
    }

    /** The ids of a list made by {@link #folders}, {@link #places} or {@link #toggles}. */
    static Set<String> ids(JsonArray list) {
        Set<String> ids = new HashSet<>();
        for (JsonElement element : list) ids.add(element.getAsJsonObject().get("id").getAsString());
        return ids;
    }

    /** Validates the rules; {@code refs.rules()} is filled with their ids. */
    static JsonArray rules(JsonElement value, Refs refs) {
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > MAX_RULES) {
            throw new IllegalArgumentException("too many rules (at most " + MAX_RULES + ")");
        }
        JsonArray source = value.getAsJsonArray();
        for (JsonElement element : source) {
            if (!element.isJsonObject()) continue;
            JsonElement id = element.getAsJsonObject().get("id");
            if (validId(id) && !refs.rules().add(id.getAsString())) {
                throw new IllegalArgumentException(label(element, -1) + ": another rule has the same id");
            }
        }
        JsonArray result = new JsonArray();
        for (int index = 0; index < source.size(); index++) result.add(rule(source.get(index), refs, index));
        checkCycles(result);
        return result;
    }

    private static JsonObject rule(JsonElement element, Refs refs, int index) {
        try {
            JsonObject source = object(element, "not an object");
            JsonObject result = new JsonObject();
            result.addProperty("id", id(source.get("id"), "invalid id"));
            result.addProperty("name", text(source.get("name"), 64, "invalid name"));
            result.addProperty("enabled", bool(source.get("enabled"), "invalid enabled flag"));
            JsonElement folder = source.get("folder");
            if (folder != null && !folder.isJsonNull()) {
                String id = string(folder, "unknown folder");
                if (!refs.folders().contains(id)) throw new IllegalArgumentException("unknown folder");
                result.addProperty("folder", id);
            }
            JsonElement when = source.get("when");
            if (when == null || !when.isJsonArray() || when.getAsJsonArray().size() > MAX_CONDITIONS) {
                throw new IllegalArgumentException("at most " + MAX_CONDITIONS + " conditions");
            }
            JsonArray conditions = new JsonArray();
            for (int position = 0; position < when.getAsJsonArray().size(); position++) {
                try {
                    conditions.add(condition(when.getAsJsonArray().get(position), refs, position == 0));
                } catch (RuntimeException invalid) {
                    throw new IllegalArgumentException("condition " + (position + 1) + ": " + message(invalid), invalid);
                }
            }
            result.add("when", conditions);
            for (String list : List.of("then", "else")) {
                if (source.has(list)) result.add(list, actions(source.get(list), refs, list.equals("then") ? "Then" : "Else"));
            }
            if (source.has("timing")) result.add("timing", timing(source.get("timing")));
            JsonElement animation = source.get("animation");
            if (animation != null && !animation.isJsonNull()) result.add("animation", animation(animation));
            return result;
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException(label(element, index) + ": " + message(invalid), invalid);
        }
    }

    private static JsonArray actions(JsonElement value, Refs refs, String what) {
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > MAX_ACTIONS) {
            throw new IllegalArgumentException(what + ": at most " + MAX_ACTIONS + " actions");
        }
        JsonArray result = new JsonArray();
        JsonArray source = value.getAsJsonArray();
        for (int index = 0; index < source.size(); index++) {
            try {
                result.add(action(source.get(index), refs));
            } catch (RuntimeException invalid) {
                throw new IllegalArgumentException(what + " action " + (index + 1) + ": " + message(invalid), invalid);
            }
        }
        return result;
    }

    private static JsonObject timing(JsonElement value) {
        JsonObject source = object(value, "invalid timing");
        JsonObject result = new JsonObject();
        if (source.has("delayMs")) {
            result.addProperty("delayMs", whole(source.get("delayMs"), 0, MAX_TIMING_MILLIS, "invalid delay"));
        }
        if (source.has("lingerMs")) {
            result.addProperty("lingerMs", whole(source.get("lingerMs"), MIN_LINGER_MILLIS, MAX_TIMING_MILLIS,
                    "linger must be " + MIN_LINGER_MILLIS + " ms or more"));
        }
        return result;
    }

    /** One When row: type, join (ignored on the first row), "not", at most one of "for"/"within", parameters. */
    private static JsonObject condition(JsonElement element, Refs refs, boolean first) {
        JsonObject source = object(element, "unknown condition type");
        JsonElement typeElement = source.get("type");
        Spec spec = isString(typeElement) ? CONDITIONS.get(typeElement.getAsString()) : null;
        if (spec == null) throw new IllegalArgumentException("unknown condition type");
        String type = typeElement.getAsString();
        JsonObject result = new JsonObject();
        result.addProperty("type", type);
        if (!first) {
            String join = source.has("join") ? string(source.get("join"), "join must be and or or") : "and";
            if (!join.equals("and") && !join.equals("or")) throw new IllegalArgumentException("join must be and or or");
            result.addProperty("join", join);
        }
        if (source.has("not") && bool(source.get("not"), "invalid not")) result.addProperty("not", true);
        boolean event = spec.kind().equals("event");
        if (source.has("for")) {
            if (event) throw new IllegalArgumentException("events take \"within\", not \"for\"");
            result.addProperty("for", whole(source.get("for"), 1, MAX_SECONDS, "invalid \"for\" seconds"));
        }
        if (source.has("within") || event) {
            int within = whole(source.get("within"), 1, MAX_SECONDS, "invalid \"within\" seconds");
            if (result.has("for")) throw new IllegalArgumentException("use either \"for\" or \"within\", not both");
            result.addProperty("within", within);
        }
        parameters(source, type, spec, refs, result);
        return result;
    }

    private static void parameters(JsonObject source, String type, Spec spec, Refs refs, JsonObject result) {
        switch (spec.kind()) {
            case "names" -> result.add("values", names(source.get("values"), null));
            case "choices" -> result.add("values", names(source.get("values"), CHOICES.get(type)));
            case "time" -> {
                if (!source.has("ticks")) {
                    result.add("values", names(source.get("values"), CHOICES.get("time")));
                } else {
                    JsonObject ticks = object(source.get("ticks"), "invalid tick range");
                    if (source.has("values")) throw new IllegalArgumentException("invalid tick range");
                    JsonObject range = new JsonObject();
                    range.addProperty("from", whole(ticks.get("from"), 0, 23999, "invalid tick range"));
                    range.addProperty("to", whole(ticks.get("to"), 0, 23999, "invalid tick range"));
                    result.add("ticks", range);
                }
            }
            case "compare" -> compare(source, result, "compare");
            case "none" -> {
            }
            case "effect" -> {
                result.add("values", names(source.get("values"), null));
                if (source.has("level")) result.add("level", compare(object(source.get("level"), "level"), new JsonObject(), "level"));
                if (source.has("remaining")) {
                    result.add("remaining", compare(object(source.get("remaining"), "remaining time"), new JsonObject(),
                            "remaining time"));
                }
            }
            case "speed" -> {
                result.addProperty("axis", choice(source, "axis", CHOICES.get("axis")));
                compare(source, result, "compare");
            }
            case "place" -> place(source, refs, result);
            case "holding" -> {
                result.addProperty("item", registryId(source.get("item"), "invalid item"));
                result.addProperty("hand", choice(source, "hand", CHOICES.get("hand")));
            }
            case "hasItem" -> {
                result.addProperty("item", registryId(source.get("item"), "invalid item"));
                if (source.has("enderChest") && bool(source.get("enderChest"), "invalid ender chest flag")) {
                    result.addProperty("enderChest", true);
                }
                compare(source, result, "compare");
            }
            case "durability" -> {
                result.addProperty("target", choice(source, "target", CHOICES.get("durability")));
                compare(source, result, "compare");
            }
            case "amount" -> {
                int window = whole(source.get("window"), 1, MAX_SECONDS, "invalid window");
                subject(source, spec, result);
                compare(source, result, "compare");
                result.addProperty("window", window);
            }
            case "event" -> subject(source, spec, result);
            case "villagers" -> {
                result.addProperty("radius", whole(source.get("radius"), 1, MAX_VILLAGER_RADIUS, "invalid radius"));
                compare(source, result, "compare");
            }
            case "portal" -> result.addProperty("minutes", whole(source.get("minutes"), 1, MAX_PORTAL_MINUTES, "invalid minutes"));
            case "toggle" -> result.addProperty("toggle", reference(source.get("toggle"), refs.toggles(), "unknown toggle"));
            case "rule" -> result.addProperty("rule", reference(source.get("rule"), refs.rules(), "unknown rule"));
            case "clock" -> clock(source, result);
            case "light" -> {
                result.addProperty("source", choice(source, "source", CHOICES.get("lightSource")));
                compare(source, result, "compare");
            }
            case "look" -> {
                result.addProperty("target", choice(source, "target", CHOICES.get("lookTarget")));
                subject(source, spec, result);
                result.addProperty("distance", whole(source.get("distance"), 1, MAX_SENSOR_RADIUS, "invalid distance"));
            }
            case "riding" -> subject(source, spec, result);
            case "threat", "players" -> {
                result.addProperty("radius", whole(source.get("radius"), 1, MAX_SENSOR_RADIUS, "invalid radius"));
                subject(source, spec, result);
                compare(source, result, "compare");
            }
            case "mob" -> {
                subject(source, spec, result);
                result.addProperty("radius", whole(source.get("radius"), 1, MAX_SENSOR_RADIUS, "invalid radius"));
            }
            default -> throw new IllegalArgumentException("unknown condition type");
        }
    }

    /** compare / value / value2, copying the numbers as written. */
    private static JsonObject compare(JsonObject source, JsonObject result, String what) {
        String compare = string(source.get("compare"), what + ": unknown comparison");
        if (!COMPARES.contains(compare)) throw new IllegalArgumentException(what + ": unknown comparison");
        JsonPrimitive value = number(source.get("value"), -MAX_COMPARE_VALUE, MAX_COMPARE_VALUE, what + ": invalid value");
        result.addProperty("compare", compare);
        result.add("value", value);
        if (compare.equals("between")) {
            result.add("value2", number(source.get("value2"), value.getAsDouble(), MAX_COMPARE_VALUE,
                    what + ": invalid upper value"));
        }
        return result;
    }

    private static JsonArray names(JsonElement value, List<String> choices) {
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > MAX_VALUES) {
            throw new IllegalArgumentException("invalid values");
        }
        Set<String> names = new LinkedHashSet<>();
        for (JsonElement element : value.getAsJsonArray()) {
            String name = choices == null ? text(element, 128, "invalid values") : string(element, "invalid values");
            if (choices != null && !choices.contains(name)) throw new IllegalArgumentException("invalid values");
            names.add(name);
        }
        JsonArray result = new JsonArray();
        names.forEach(result::add);
        return result;
    }

    private static String choice(JsonObject source, String key, List<String> choices) {
        if (!source.has(key)) return choices.get(0);
        String value = string(source.get(key), "invalid " + key);
        if (!choices.contains(value)) throw new IllegalArgumentException("invalid " + key);
        return value;
    }

    /** The optional (or required) registry id an amount or event is about. */
    private static void subject(JsonObject source, Spec spec, JsonObject result) {
        if (spec.subject() == null || !source.has(spec.subject()) && !spec.required()) return;
        String message = "invalid " + spec.subject();
        JsonElement value = source.get(spec.subject());
        String id = string(value, message);
        boolean valid = id.length() <= 256 && (spec.subject().equals("stat") ? STATISTIC_ID : REGISTRY_ID).matcher(id).matches();
        if (!valid) throw new IllegalArgumentException(message);
        result.addProperty(spec.subject(), id);
    }

    /** Near a saved place or X/Y/Z (optionally in a world and dimension): within a radius, or inside a box. */
    private static void place(JsonObject source, Refs refs, JsonObject result) {
        boolean box = source.has("x2") || source.has("y2") || source.has("z2");
        if (source.has("place")) {
            if (box || source.has("x")) throw new IllegalArgumentException("unknown place");
            result.addProperty("place", reference(source.get("place"), refs.places(), "unknown place"));
        } else {
            for (String axis : List.of("x", "y", "z")) {
                result.add(axis, number(source.get(axis), -MAX_COORDINATE, MAX_COORDINATE, "invalid position"));
            }
            if (source.has("world")) result.addProperty("world", text(source.get("world"), 128, "invalid world"));
            if (source.has("dimension")) result.addProperty("dimension", registryId(source.get("dimension"), "invalid dimension"));
        }
        if (box) {
            if (source.has("radius")) throw new IllegalArgumentException("invalid box");
            for (String axis : List.of("x2", "y2", "z2")) {
                result.add(axis, number(source.get(axis), -MAX_COORDINATE, MAX_COORDINATE, "invalid box"));
            }
            return;
        }
        JsonPrimitive radius = number(source.get("radius"), 0, MAX_PLACE_RADIUS, "invalid radius");
        if (radius.getAsDouble() <= 0) throw new IllegalArgumentException("invalid radius");
        result.add("radius", radius);
        if (source.has("flat") && bool(source.get("flat"), "invalid flat flag")) result.addProperty("flat", true);
    }

    private static void clock(JsonObject source, JsonObject result) {
        for (String key : List.of("from", "to")) {
            String time = string(source.get(key), "invalid time");
            if (!CLOCK.matcher(time).matches()) throw new IllegalArgumentException("invalid time");
            result.addProperty(key, time);
        }
        if (!source.has("days")) return;
        JsonElement days = source.get("days");
        if (days == null || !days.isJsonArray() || days.getAsJsonArray().isEmpty() || days.getAsJsonArray().size() > 7) {
            throw new IllegalArgumentException("invalid weekdays");
        }
        Set<Integer> sorted = new TreeSet<>();
        for (JsonElement day : days.getAsJsonArray()) {
            if (!sorted.add(whole(day, 0, 6, "invalid weekdays"))) throw new IllegalArgumentException("invalid weekdays");
        }
        JsonArray normalized = new JsonArray();
        sorted.forEach(normalized::add);
        result.add("days", normalized);
    }

    private static JsonObject action(JsonElement element, Refs refs) {
        JsonObject source = object(element, "unknown action");
        JsonElement kindElement = source.get("do");
        String kind = isString(kindElement) ? kindElement.getAsString() : null;
        if (!ACTIONS.contains(kind)) throw new IllegalArgumentException("unknown action");
        JsonObject result = new JsonObject();
        result.addProperty("do", kind);
        if (kind.equals("profile")) {
            result.addProperty("profile", reference(source.get("profile"), refs.profiles(), "unknown profile"));
            return result;
        }
        if (kind.equals("notify")) {
            result.addProperty("text", text(source.get("text"), MAX_NOTIFY_TEXT, "invalid notification text"));
            result.addProperty("cooldown", source.has("cooldown")
                    ? whole(source.get("cooldown"), 0, MAX_SECONDS, "invalid cooldown") : 0);
            return result;
        }
        String panel = string(source.get("panel"), "unknown panel");
        if (!LayoutStore.TILE_IDS.contains(panel)) throw new IllegalArgumentException("unknown panel");
        result.addProperty("panel", panel);
        switch (kind) {
            case "hide" -> {
                if (!source.has("fill")) break;
                String fill = string(source.get("fill"), "invalid fill");
                if (fill.equals("auto")) break;
                if (!fill.equals("empty") && (!LayoutStore.TILE_IDS.contains(fill) || fill.equals(panel))) {
                    throw new IllegalArgumentException("invalid fill");
                }
                result.addProperty("fill", fill);
            }
            case "place" -> {
                int[] minimum = TILE_MINIMUMS.get(panel);
                int w = whole(source.get("w"), minimum[0], LAYOUT_COLUMNS, "invalid rectangle");
                int h = whole(source.get("h"), minimum[1], LAYOUT_MAX_H, "invalid rectangle");
                result.addProperty("x", whole(source.get("x"), 0, LAYOUT_COLUMNS - w, "invalid rectangle"));
                result.addProperty("y", whole(source.get("y"), 0, LAYOUT_MAX_Y, "invalid rectangle"));
                result.addProperty("w", w);
                result.addProperty("h", h);
            }
            case "swap" -> {
                String other = string(source.get("with"), "invalid panel to swap with");
                if (!LayoutStore.TILE_IDS.contains(other) || other.equals(panel)) {
                    throw new IllegalArgumentException("invalid panel to swap with");
                }
                result.addProperty("with", other);
            }
            case "set" -> {
                String setting = string(source.get("setting"), "invalid setting");
                if (!source.has("value")) throw new IllegalArgumentException("invalid setting");
                JsonObject values = new JsonObject();
                values.add(setting, source.get("value"));
                JsonObject wrapper = new JsonObject();
                wrapper.add(panel, values);
                JsonObject normalized = LayoutStore.settings(wrapper).getAsJsonObject(panel);
                if (normalized == null || !normalized.has(setting)) throw new IllegalArgumentException("invalid setting");
                result.addProperty("setting", setting);
                result.add("value", normalized.get(setting));
            }
            default -> {
                // show and focus take only the panel
            }
        }
        return result;
    }

    /**
     * The costlier sensors that enabled rules (in enabled folders) of a normalized layout read, so the mod collects
     * only those. A version 1 layout reads none.
     */
    static SensorNeeds needs(JsonObject layout) {
        if (layout.get("version").getAsInt() != 2 || !layout.has("rules")) return SensorNeeds.NONE;
        Set<String> disabled = new HashSet<>();
        if (layout.has("folders")) {
            for (JsonElement folder : layout.getAsJsonArray("folders")) {
                if (!folder.getAsJsonObject().get("enabled").getAsBoolean()) {
                    disabled.add(folder.getAsJsonObject().get("id").getAsString());
                }
            }
        }
        boolean light = false;
        boolean screen = false;
        int look = 0;
        int radius = 0;
        for (JsonElement element : layout.getAsJsonArray("rules")) {
            JsonObject rule = element.getAsJsonObject();
            boolean inDisabledFolder = rule.has("folder") && disabled.contains(rule.get("folder").getAsString());
            if (!rule.get("enabled").getAsBoolean() || inDisabledFolder) {
                continue;
            }
            for (JsonElement row : rule.getAsJsonArray("when")) {
                JsonObject condition = row.getAsJsonObject();
                switch (condition.get("type").getAsString()) {
                    case "light" -> light = true;
                    case "screen" -> screen = true;
                    case "lookingAt" -> look = Math.max(look, condition.get("distance").getAsInt());
                    case "hostilesNearby", "mobNearby", "playersNearby" ->
                            radius = Math.max(radius, condition.get("radius").getAsInt());
                    default -> {
                    }
                }
            }
        }
        return new SensorNeeds(light, look, radius, screen);
    }

    /** "Rule active" conditions must not form a loop. */
    private static void checkCycles(JsonArray rules) {
        Map<String, JsonObject> byId = new HashMap<>();
        for (JsonElement rule : rules) byId.put(rule.getAsJsonObject().get("id").getAsString(), rule.getAsJsonObject());
        Map<String, Boolean> done = new HashMap<>();
        for (JsonObject rule : byId.values()) visit(rule, byId, done);
    }

    private static void visit(JsonObject rule, Map<String, JsonObject> byId, Map<String, Boolean> done) {
        String id = rule.get("id").getAsString();
        Boolean state = done.get(id);
        if (Boolean.TRUE.equals(state)) return;
        if (Boolean.FALSE.equals(state)) {
            throw new IllegalArgumentException(label(rule, -1) + ": \"Rule active\" conditions form a loop");
        }
        done.put(id, false);
        for (JsonElement condition : rule.getAsJsonArray("when")) {
            JsonObject row = condition.getAsJsonObject();
            if (row.get("type").getAsString().equals("ruleActive")) visit(byId.get(row.get("rule").getAsString()), byId, done);
        }
        done.put(id, true);
    }

    // ------------------------------------------------------------------------------------------- Strict JSON

    private interface Normalizer {
        JsonObject apply(JsonElement element);
    }

    private static JsonArray list(JsonElement value, int max, String what, Normalizer normalizer) {
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > max) {
            throw new IllegalArgumentException("too many " + what + " (at most " + max + ")");
        }
        JsonArray result = new JsonArray();
        for (JsonElement element : value.getAsJsonArray()) result.add(normalizer.apply(element));
        if (ids(result).size() != result.size()) throw new IllegalArgumentException("duplicate " + what);
        return result;
    }

    private static String label(JsonElement rule, int index) {
        JsonElement name = rule != null && rule.isJsonObject() ? rule.getAsJsonObject().get("name") : null;
        if (isString(name) && !name.getAsString().isEmpty() && name.getAsString().length() <= 64) {
            return "Rule \"" + name.getAsString() + "\"";
        }
        return index < 0 ? "Rule" : "Rule " + (index + 1);
    }

    private static String message(RuntimeException error) {
        return error instanceof IllegalArgumentException && error.getMessage() != null ? error.getMessage() : "malformed";
    }

    private static boolean isString(JsonElement value) {
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString();
    }

    private static boolean validId(JsonElement value) {
        return isString(value) && ID.matcher(value.getAsString()).matches();
    }

    private static JsonObject object(JsonElement value, String message) {
        if (value == null || !value.isJsonObject()) throw new IllegalArgumentException(message);
        return value.getAsJsonObject();
    }

    private static String string(JsonElement value, String message) {
        if (!isString(value)) throw new IllegalArgumentException(message);
        return value.getAsString();
    }

    private static String text(JsonElement value, int maxLength, String message) {
        String text = string(value, message);
        if (text.isEmpty() || text.length() > maxLength) throw new IllegalArgumentException(message);
        return text;
    }

    private static String id(JsonElement value, String message) {
        if (!validId(value)) throw new IllegalArgumentException(message);
        return value.getAsString();
    }

    private static String registryId(JsonElement value, String message) {
        String id = string(value, message);
        if (id.length() > 256 || !REGISTRY_ID.matcher(id).matches()) throw new IllegalArgumentException(message);
        return id;
    }

    private static String reference(JsonElement value, Set<String> known, String message) {
        String id = string(value, message);
        if (!known.contains(id)) throw new IllegalArgumentException(message);
        return id;
    }

    private static boolean bool(JsonElement value, String message) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
            throw new IllegalArgumentException(message);
        }
        return value.getAsBoolean();
    }

    /** A finite number within [min, max], returned as written. */
    private static JsonPrimitive number(JsonElement value, double min, double max, String message) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException(message);
        }
        double number = value.getAsDouble();
        if (!Double.isFinite(number) || number < min || number > max) throw new IllegalArgumentException(message);
        return value.getAsJsonPrimitive();
    }

    private static int whole(JsonElement value, int min, int max, String message) {
        double number = number(value, min, max, message).getAsDouble();
        if (number != Math.rint(number)) throw new IllegalArgumentException(message);
        return (int) number;
    }
}
