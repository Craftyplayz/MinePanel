package dev.craftyplayz.minepanel;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.mojang.serialization.JsonOps;
import dev.craftyplayz.minepanel.service.WorldStore;
import dev.craftyplayz.minepanel.telemetry.EnderStorageSnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.core.RegistryAccess;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Optional Ender Storage support: its ender chests (one per colour frequency), for the Ender Storage panels, the
 * inventory's ender chest slot and the item windows of pouches. Client thread only. On NeoForge with Ender Storage
 * installed this delegates to {@code dev.craftyplayz.minepanel.enderstorage}, the only package that touches that mod;
 * otherwise it does nothing. Any failure turns the integration off for the session with one warning.
 *
 * <p>A chest is seen while its screen is open (anywhere) and, in singleplayer, read from the integrated server twice a
 * second. Every change to a chest's contents is logged per item and remembered per world in the {@link WorldStore},
 * with the chest as last seen. Nothing is sent to the server.
 */
public final class EnderStorage {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    static final String ENDER_STORAGE = "enderstorage";
    private static final long READ_INTERVAL_MILLIS = 500;
    private static final long READ_TIMEOUT_MILLIS = 10_000;
    private static Source source;
    private static boolean connected;
    private static WorldStore store;
    // The last contents seen of each chest (live in singleplayer), and the chest whose screen was open.
    private static final Map<String, Chest> KNOWN = new HashMap<>();
    private static String openKey;
    private static String lastOpened;
    private static boolean inFlight;
    private static long requestedAt;
    private static int generation;
    private static boolean live;
    // Built dashboard values, rebuilt only when a chest (or the icon keys) changes.
    private static final Map<Object, Built> BUILT = new IdentityHashMap<>();
    private static final Map<String, Backpacks.Contents> POUCHES = new HashMap<>();

    private EnderStorage() {
    }

    /** One chest: its key (see {@link EnderStorageSnapshot}), owner name (null for a public chest) and every slot. */
    public record Chest(String key, String owner, List<ItemStack> slots) {
        public Chest {
            slots = List.copyOf(slots);
        }
    }

    /** The Ender Storage integration. */
    public interface Source {
        /** Client thread: the Ender Storage chest whose screen is open, or null. */
        Chest open(Minecraft minecraft);

        /** The key of an Ender Storage chest or pouch item's frequency, or null for any other item. */
        String key(ItemStack stack);

        /** Ender Storage's ender chest item. */
        ItemStack chestItem();

        /** Server thread: copies of every item chest the integrated server knows. */
        List<Chest> readAll(MinecraftServer server);
    }

    private record Built(int epoch, Object value) {
    }

    /** Whether Ender Storage is installed and working. */
    static boolean active() {
        return source != null;
    }

    /** Ender Storage's ender chest item, for the inventory's ender chest slot; null without the mod. */
    static ItemStack chestItem() {
        if (source == null) return null;
        try {
            return source.chestItem();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return null;
        }
    }

    /**
     * The contents of an Ender Storage pouch or chest item's frequency, as last seen (UNKNOWN before), or null for any
     * other item. The same instance is returned while the contents don't change.
     */
    static Backpacks.Contents contents(ItemStack stack) {
        if (source == null || stack.isEmpty()) return null;
        try {
            String key = source.key(stack);
            if (key == null) return null;
            Chest chest = chest(key);
            if (chest == null) return Backpacks.Contents.UNKNOWN;
            Backpacks.Contents cached = POUCHES.get(key);
            if (cached == null || !same(cached.items(), chest.slots())) {
                cached = new Backpacks.Contents(chest.slots());
                POUCHES.put(key, cached);
            }
            return cached;
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return null;
        }
    }

    static void tick(Minecraft minecraft, WorldStore worldStore) {
        if (!connected) {
            connected = true;
            connect();
        }
        if (source == null || minecraft.level == null) return;
        store = worldStore;
        try {
            Chest open = source.open(minecraft);
            if (open != null) {
                boolean opened = !open.key().equals(openKey);
                observe(minecraft.level.registryAccess(), open, System.currentTimeMillis(), opened);
                lastOpened = open.key();
            }
            openKey = open == null ? null : open.key();
            requestRead(minecraft);
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
    }

    static void reset() {
        KNOWN.clear();
        BUILT.clear();
        POUCHES.clear();
        openKey = null;
        lastOpened = null;
        inFlight = false;
        live = false;
        generation++;
    }

    // ----------------------------------------------------------------------------------------- Changes and the log

    /**
     * Records what a chest holds now: a change to known contents is logged per item and remembered; a chest seen for
     * the first time is remembered only when the player opened it (singleplayer reads every chest, and needs no
     * memory of the ones nobody touched).
     */
    private static void observe(RegistryAccess registries, Chest chest, long now, boolean opened) {
        Chest known = KNOWN.get(chest.key());
        WorldStore.EnderStorage stored = store == null ? null : store.enderStorage(chest.key());
        if (known == null && stored != null) known = decode(registries, stored);
        KNOWN.put(chest.key(), known != null && same(known.slots(), chest.slots()) ? known : chest);
        boolean changed = known != null && !same(known.slots(), chest.slots());
        if (store == null || !changed && !opened) return;
        List<WorldStore.EnderChange> log = new ArrayList<>(stored == null ? List.of() : stored.log());
        if (changed) log.addAll(changes(registries, known.slots(), chest.slots(), now));
        if (log.size() > WorldStore.MAX_ENDER_LOG) log = log.subList(log.size() - WorldStore.MAX_ENDER_LOG, log.size());
        List<JsonElement> slots = chest.slots().stream().map(stack -> encode(registries, stack)).toList();
        try {
            store.putEnderStorage(new WorldStore.EnderStorage(chest.key(), chest.owner(), now, slots, log));
        } catch (IllegalArgumentException tooLarge) {
            // An item whose data is too large to store; keep what was remembered before.
        }
    }

    /** One change per distinct item (same item and components) whose total count differs, removals first. */
    static List<WorldStore.EnderChange> changes(RegistryAccess registries, List<ItemStack> before, List<ItemStack> after,
                                                long now) {
        List<ItemStack> kinds = new ArrayList<>();
        Map<Integer, long[]> counts = new HashMap<>();
        for (int side = 0; side < 2; side++) {
            for (ItemStack stack : side == 0 ? before : after) {
                if (stack.isEmpty()) continue;
                int kind = 0;
                while (kind < kinds.size() && !ItemStack.isSameItemSameComponents(kinds.get(kind), stack)) kind++;
                if (kind == kinds.size()) kinds.add(stack.copyWithCount(1));
                counts.computeIfAbsent(kind, ignored -> new long[2])[side] += stack.getCount();
            }
        }
        List<WorldStore.EnderChange> removed = new ArrayList<>();
        List<WorldStore.EnderChange> added = new ArrayList<>();
        for (int kind = 0; kind < kinds.size(); kind++) {
            long[] count = counts.get(kind);
            long delta = count[1] - count[0];
            if (delta == 0) continue;
            JsonElement item = encode(registries, kinds.get(kind));
            if (item.isJsonNull()) continue;
            (delta < 0 ? removed : added).add(new WorldStore.EnderChange(now,
                    (int) Math.clamp(delta, -Integer.MAX_VALUE, Integer.MAX_VALUE), item));
        }
        removed.addAll(added);
        return removed;
    }

    private static boolean same(List<ItemStack> a, List<ItemStack> b) {
        if (a == null || a.size() != b.size()) return false;
        for (int slot = 0; slot < a.size(); slot++) {
            if (!ItemStack.matches(a.get(slot), b.get(slot))) return false;
        }
        return true;
    }

    private static JsonElement encode(RegistryAccess registries, ItemStack stack) {
        if (stack.isEmpty()) return JsonNull.INSTANCE;
        return ItemStack.CODEC.encodeStart(registries.createSerializationContext(JsonOps.INSTANCE), stack)
                .result().filter(JsonElement::isJsonObject).orElse(JsonNull.INSTANCE);
    }

    private static ItemStack decode(RegistryAccess registries, JsonElement json) {
        if (json.isJsonNull()) return ItemStack.EMPTY;
        return ItemStack.CODEC.parse(registries.createSerializationContext(JsonOps.INSTANCE), json).result()
                .orElse(ItemStack.EMPTY);
    }

    private static Chest decode(RegistryAccess registries, WorldStore.EnderStorage stored) {
        return new Chest(stored.key(), stored.owner(), stored.slots().stream().map(json -> decode(registries, json))
                .toList());
    }

    /** What is known of a chest now: live or last seen this session, else remembered; null when never seen. */
    private static Chest chest(String key) {
        Chest known = KNOWN.get(key);
        if (known != null) return known;
        Minecraft minecraft = Minecraft.getInstance();
        WorldStore.EnderStorage stored = store == null ? null : store.enderStorage(key);
        if (stored == null || minecraft.level == null) return null;
        Chest chest = decode(minecraft.level.registryAccess(), stored);
        KNOWN.put(key, chest);
        return chest;
    }

    // ------------------------------------------------------------------------------- Singleplayer server reads

    private static void requestRead(Minecraft minecraft) {
        MinecraftServer server = minecraft.getSingleplayerServer();
        long now = System.currentTimeMillis();
        if (inFlight && now - requestedAt > READ_TIMEOUT_MILLIS) inFlight = false;
        if (server == null || inFlight || now - requestedAt < READ_INTERVAL_MILLIS) return;
        inFlight = true;
        requestedAt = now;
        int request = ++generation;
        Source reader = source;
        server.execute(() -> {
            // execute() runs the task in place when the server no longer takes tasks; never read it off its thread.
            if (!server.isSameThread()) return;
            List<Chest> chests;
            try {
                chests = reader.readAll(server);
            } catch (LinkageError | RuntimeException failure) {
                minecraft.execute(() -> {
                    if (request == generation) fail(failure);
                });
                return;
            }
            minecraft.execute(() -> {
                if (request != generation || minecraft.level == null) return;
                inFlight = false;
                live = true;
                long at = System.currentTimeMillis();
                for (Chest chest : chests) observe(minecraft.level.registryAccess(), chest, at, false);
                // Chests the server no longer knows (none should vanish, but the list stays true to the server).
                Set<String> keys = new java.util.HashSet<>();
                chests.forEach(chest -> keys.add(chest.key()));
                KNOWN.keySet().retainAll(keys);
            });
        });
    }

    // ------------------------------------------------------------------------------- Dashboard values

    /** The Ender Storage panels' data, or null without Ender Storage. */
    static EnderStorageSnapshot collect(Minecraft minecraft, IconRenderer icons, Set<String> watched) {
        if (source == null || minecraft.level == null) return null;
        try {
            RegistryAccess registries = minecraft.level.registryAccess();
            Map<String, WorldStore.EnderStorage> stored = new LinkedHashMap<>();
            if (store != null) store.enderStorages().forEach(chest -> stored.put(chest.key(), chest));
            String last = lastOpened != null ? lastOpened : stored.values().stream()
                    .max(Comparator.comparingLong(WorldStore.EnderStorage::seenAt)).map(WorldStore.EnderStorage::key)
                    .orElse(null);
            // Singleplayer lists every chest live; elsewhere, the remembered ones.
            Map<String, Chest> chests = new LinkedHashMap<>();
            if (live) {
                KNOWN.forEach(chests::put);
            } else {
                stored.values().forEach(chest -> chests.put(chest.key(), chest(chest.key())));
            }
            List<EnderStorageSnapshot.Entry> list = new ArrayList<>();
            List<String> order = new ArrayList<>(chests.keySet());
            // Most recently seen first, then never-seen chests by key.
            order.sort(Comparator.<String>comparingLong(key -> stored.containsKey(key) ? -stored.get(key).seenAt() : 1)
                    .thenComparing(Comparator.naturalOrder()));
            for (String key : order) {
                if (list.size() == EnderStorageSnapshot.MAX_LIST) break;
                Chest chest = chests.get(key);
                if (chest != null) list.add(entry(chest, stored.get(key)));
            }
            Set<String> shownKeys = new LinkedHashSet<>();
            if (last != null) shownKeys.add(last);
            for (String key : watched) {
                if (shownKeys.size() == EnderStorageSnapshot.MAX_SHOWN) break;
                shownKeys.add(key);
            }
            List<EnderStorageSnapshot.Shown> shown = new ArrayList<>();
            Set<Object> used = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
            for (String key : shownKeys) {
                Chest chest = chests.containsKey(key) ? chests.get(key) : chest(key);
                WorldStore.EnderStorage memory = stored.get(key);
                shown.add(shown(minecraft, registries, icons, key, chest, memory, used));
            }
            BUILT.keySet().retainAll(used);
            return new EnderStorageSnapshot(live ? "world" : "remembered", last, list, shown);
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return null;
        }
    }

    private static EnderStorageSnapshot.Entry entry(Chest chest, WorldStore.EnderStorage memory) {
        Set<String> items = new LinkedHashSet<>();
        int filled = 0;
        for (ItemStack stack : chest.slots()) {
            if (stack.isEmpty()) continue;
            filled++;
            if (items.size() < EnderStorageSnapshot.MAX_ITEM_IDS) {
                items.add(net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            }
        }
        int slots = Math.min(chest.slots().size(), ItemSnapshot.MAX_CONTENTS);
        return new EnderStorageSnapshot.Entry(chest.key(), chest.owner(), memory == null ? null : memory.seenAt(),
                List.copyOf(items), Math.min(filled, slots), slots);
    }

    @SuppressWarnings("unchecked")
    private static EnderStorageSnapshot.Shown shown(Minecraft minecraft, RegistryAccess registries, IconRenderer icons,
                                                    String key, Chest chest, WorldStore.EnderStorage memory,
                                                    Set<Object> used) {
        String owner = chest != null ? chest.owner() : memory == null ? null : memory.owner();
        Long seenAt = memory == null ? null : memory.seenAt();
        List<ItemSnapshot> contents = List.of();
        if (chest != null) {
            used.add(chest);
            Built built = BUILT.get(chest);
            if (built == null || built.epoch() != icons.epoch()) {
                built = new Built(icons.epoch(), MinecraftInventoryCollector.contents(minecraft,
                        new Backpacks.Contents(chest.slots()), icons));
                BUILT.put(chest, built);
            }
            contents = (List<ItemSnapshot>) built.value();
        }
        List<EnderStorageSnapshot.Change> log = List.of();
        if (memory != null && !memory.log().isEmpty()) {
            used.add(memory);
            Built built = BUILT.get(memory);
            if (built == null || built.epoch() != icons.epoch()) {
                List<EnderStorageSnapshot.Change> changes = new ArrayList<>();
                // Newest first.
                for (int index = memory.log().size() - 1; index >= 0; index--) {
                    WorldStore.EnderChange change = memory.log().get(index);
                    ItemStack stack = decode(registries, change.item());
                    if (stack.isEmpty()) continue;
                    changes.add(new EnderStorageSnapshot.Change(change.at(), change.delta(),
                            MinecraftInventoryCollector.item(minecraft, stack, icons)));
                }
                built = new Built(icons.epoch(), List.copyOf(changes));
                BUILT.put(memory, built);
            }
            log = (List<EnderStorageSnapshot.Change>) built.value();
        }
        return new EnderStorageSnapshot.Shown(key, owner, seenAt, chest == null, contents, log);
    }

    // ------------------------------------------------------------------------------- Setup

    private static void connect() {
        //? if neoforge {
        /*if (!net.neoforged.fml.ModList.get().isLoaded(ENDER_STORAGE)) return;
        try {
            source = new dev.craftyplayz.minepanel.enderstorage.EnderStorageMod();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
        *///?}
    }

    private static void fail(Throwable failure) {
        source = null;
        reset();
        LOGGER.log(Level.WARNING, "Ender Storage support failed; ender storage chests are off for this session.",
                failure);
    }
}
