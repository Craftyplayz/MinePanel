package dev.craftyplayz.minepanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Persists the dashboard tile layout as a small, strictly validated JSON config file. */
public final class LayoutStore {
    public static final int COLUMNS = 12;
    public static final int MAX_BYTES = 16 * 1024;
    public static final List<String> TILE_IDS = List.of("player", "inventory", "statistics", "history", "map", "build");
    private final Path file;

    public LayoutStore(Path file) {
        this.file = file;
    }

    /** Returns the stored layout, or {@code null} when none is saved or the file is unreadable/invalid. */
    public synchronized String load() {
        try {
            if (!Files.isRegularFile(file) || Files.size(file) > MAX_BYTES) return null;
            return normalize(Files.readString(file, StandardCharsets.UTF_8));
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
        JsonArray tiles = root.getAsJsonArray("tiles");
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
            normalizedTiles.add(normalized);
        }
        JsonObject result = new JsonObject();
        result.addProperty("version", 1);
        result.add("tiles", normalizedTiles);
        return result.toString();
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
