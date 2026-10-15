package dev.craftyplayz.minepanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.craftyplayz.minepanel.telemetry.VillagerSnapshot;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Remembers per-world data that outlives a session: villagers the player has traded with and the contents of their
 * ender chest. Each world (server address or singleplayer world name) has its own file under
 * {@code config/minepanel/worlds/}. Items are stored as the JSON the game's own item codec produces, so they come
 * back exactly (enchanted books keep their enchantments); this class treats them as opaque values.
 *
 * <p>The client thread changes the store, the dashboard's HTTP threads may forget a villager, and a background
 * worker saves it: every method is synchronized and file writes happen outside the lock.
 */
public final class WorldStore {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    public static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ITEM_JSON = 64 * 1024;
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");

    public record Trade(JsonElement costA, JsonElement costB, JsonElement result, int uses, int maxUses) {
        public Trade {
            Objects.requireNonNull(costA);
            Objects.requireNonNull(result);
        }
    }

    public record Villager(String uuid, String profession, int level, String name, String dimension,
                           double x, double y, double z, long seenAt, long tradedAt, List<Trade> trades) {
        public Villager {
            trades = List.copyOf(trades);
            if (uuid == null || !VillagerSnapshot.UUID.matcher(uuid).matches() || profession == null
                    || !IDENTIFIER.matcher(profession).matches() || level < 1 || level > 5
                    || name != null && name.length() > 256 || dimension == null || !IDENTIFIER.matcher(dimension).matches()
                    || !Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                    || trades.size() > VillagerSnapshot.MAX_TRADES) {
                throw new IllegalArgumentException("Invalid stored villager");
            }
        }

        public Villager withPosition(String newDimension, double newX, double newY, double newZ, long now,
                                     String newProfession, int newLevel) {
            return new Villager(uuid, newProfession, newLevel, name, newDimension, newX, newY, newZ, now, tradedAt,
                    trades);
        }
    }

    /** {@code slots} holds exactly 27 item values (JSON null for an empty slot). */
    public record EnderChest(long seenAt, List<JsonElement> slots) {
        public EnderChest {
            slots = List.copyOf(slots);
            if (slots.size() != 27) throw new IllegalArgumentException("ender chest has 27 slots");
        }
    }

    private final Path directory;
    private String worldKey;
    private Path file;
    private final Map<String, Villager> villagers = new LinkedHashMap<>();
    private EnderChest enderChest;
    private long revision;
    private boolean dirty;

    public WorldStore(Path directory) {
        this.directory = directory;
    }

    /** Switches to {@code key}'s data, loading it from disk; the previous world should be saved first. */
    public void open(String key) {
        Path target;
        synchronized (this) {
            if (Objects.equals(key, worldKey)) return;
            worldKey = key;
            file = key == null ? null : directory.resolve(fileName(key));
            villagers.clear();
            enderChest = null;
            dirty = false;
            revision++;
            target = file;
        }
        if (target == null) return;
        JsonObject root;
        try {
            if (!Files.isRegularFile(target) || Files.size(target) > MAX_FILE_BYTES) return;
            root = JsonParser.parseString(Files.readString(target, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (IOException | RuntimeException unreadable) {
            LOGGER.log(Level.WARNING, "MinePanel could not read its saved world data; starting fresh.", unreadable);
            return;
        }
        synchronized (this) {
            if (!target.equals(file)) return;
            read(root);
            revision++;
        }
    }

    public synchronized String worldKey() {
        return worldKey;
    }

    /** Increases whenever anything changes, so readers can cache what they build from the store. */
    public synchronized long revision() {
        return revision;
    }

    public synchronized List<Villager> villagers() {
        return List.copyOf(villagers.values());
    }

    public synchronized Villager villager(String uuid) {
        return villagers.get(uuid);
    }

    public synchronized void putVillager(Villager villager) {
        if (worldKey == null || villager.equals(villagers.get(villager.uuid()))) return;
        if (!villagers.containsKey(villager.uuid()) && villagers.size() >= VillagerSnapshot.MAX_VILLAGERS) {
            // Forget the villager traded with longest ago to make room.
            villagers.values().stream().min(java.util.Comparator.comparingLong(Villager::tradedAt))
                    .ifPresent(oldest -> villagers.remove(oldest.uuid()));
        }
        villagers.put(villager.uuid(), villager);
        changed();
    }

    /** Called by the dashboard when the player removes a villager that died or moved away. */
    public synchronized boolean forgetVillager(String uuid) {
        if (villagers.remove(uuid) == null) return false;
        changed();
        return true;
    }

    public synchronized EnderChest enderChest() {
        return enderChest;
    }

    public synchronized void enderChest(EnderChest contents) {
        if (worldKey == null || contents.slots().equals(enderChest == null ? null : enderChest.slots())) return;
        enderChest = contents;
        changed();
    }

    /** Writes pending changes; call from a background thread. */
    public void save() {
        Path target;
        String json;
        synchronized (this) {
            if (!dirty || file == null) return;
            target = file;
            json = write().toString();
            dirty = false;
        }
        try {
            Files.createDirectories(target.getParent());
            Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
            Files.writeString(temporary, json, StandardCharsets.UTF_8);
            try {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException failure) {
            synchronized (this) {
                if (target.equals(file)) dirty = true;
            }
            LOGGER.log(Level.WARNING, "MinePanel could not save its world data.", failure);
        }
    }

    private void changed() {
        dirty = true;
        revision++;
    }

    /** A readable, collision-resistant file name for a world key such as "server:play.example.net". */
    static String fileName(String key) {
        String readable = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]+", "_");
        if (readable.length() > 80) readable = readable.substring(0, 80);
        return readable + "-" + Integer.toHexString(key.hashCode()) + ".json";
    }

    private JsonObject write() {
        JsonObject root = new JsonObject();
        root.addProperty("version", 1);
        root.addProperty("world", worldKey);
        JsonArray list = new JsonArray();
        for (Villager villager : villagers.values()) {
            JsonObject entry = new JsonObject();
            entry.addProperty("uuid", villager.uuid());
            entry.addProperty("profession", villager.profession());
            entry.addProperty("level", villager.level());
            if (villager.name() != null) entry.addProperty("name", villager.name());
            entry.addProperty("dimension", villager.dimension());
            entry.addProperty("x", villager.x());
            entry.addProperty("y", villager.y());
            entry.addProperty("z", villager.z());
            entry.addProperty("seenAt", villager.seenAt());
            entry.addProperty("tradedAt", villager.tradedAt());
            JsonArray trades = new JsonArray();
            for (Trade trade : villager.trades()) {
                JsonObject value = new JsonObject();
                value.add("costA", trade.costA());
                value.add("costB", trade.costB() == null ? JsonNull.INSTANCE : trade.costB());
                value.add("result", trade.result());
                value.addProperty("uses", trade.uses());
                value.addProperty("maxUses", trade.maxUses());
                trades.add(value);
            }
            entry.add("trades", trades);
            list.add(entry);
        }
        root.add("villagers", list);
        if (enderChest != null) {
            JsonObject chest = new JsonObject();
            chest.addProperty("seenAt", enderChest.seenAt());
            JsonArray slots = new JsonArray();
            enderChest.slots().forEach(slots::add);
            chest.add("slots", slots);
            root.add("enderChest", chest);
        }
        return root;
    }

    /** Reads what it can: a malformed villager is skipped rather than discarding the whole file. */
    private void read(JsonObject root) {
        if (root.has("villagers") && root.get("villagers").isJsonArray()) {
            for (JsonElement element : root.getAsJsonArray("villagers")) {
                try {
                    JsonObject entry = element.getAsJsonObject();
                    List<Trade> trades = new ArrayList<>();
                    for (JsonElement tradeElement : entry.getAsJsonArray("trades")) {
                        JsonObject trade = tradeElement.getAsJsonObject();
                        JsonElement costB = trade.get("costB");
                        trades.add(new Trade(item(trade.get("costA")),
                                costB == null || costB.isJsonNull() ? null : item(costB), item(trade.get("result")),
                                trade.get("uses").getAsInt(), trade.get("maxUses").getAsInt()));
                    }
                    Villager villager = new Villager(entry.get("uuid").getAsString(),
                            entry.get("profession").getAsString(), entry.get("level").getAsInt(),
                            entry.has("name") ? entry.get("name").getAsString() : null,
                            entry.get("dimension").getAsString(), entry.get("x").getAsDouble(),
                            entry.get("y").getAsDouble(), entry.get("z").getAsDouble(),
                            entry.get("seenAt").getAsLong(), entry.get("tradedAt").getAsLong(), trades);
                    if (villagers.size() < VillagerSnapshot.MAX_VILLAGERS) villagers.put(villager.uuid(), villager);
                } catch (RuntimeException malformed) {
                    LOGGER.fine("Skipped a malformed saved villager.");
                }
            }
        }
        if (root.has("enderChest") && root.get("enderChest").isJsonObject()) {
            try {
                JsonObject chest = root.getAsJsonObject("enderChest");
                List<JsonElement> slots = new ArrayList<>();
                for (JsonElement slot : chest.getAsJsonArray("slots")) {
                    slots.add(slot.isJsonNull() ? JsonNull.INSTANCE : item(slot));
                }
                enderChest = new EnderChest(chest.get("seenAt").getAsLong(), slots);
            } catch (RuntimeException malformed) {
                LOGGER.fine("Skipped a malformed saved ender chest.");
            }
        }
    }

    private static JsonElement item(JsonElement value) {
        if (value == null || !value.isJsonObject() || value.toString().length() > MAX_ITEM_JSON) {
            throw new IllegalArgumentException("invalid stored item");
        }
        return value;
    }
}
