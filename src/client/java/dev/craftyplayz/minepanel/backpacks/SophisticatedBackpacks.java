package dev.craftyplayz.minepanel.backpacks;

//? if neoforge {
/*import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.serialization.JsonOps;
import dev.craftyplayz.minepanel.Backpacks;
import dev.craftyplayz.minepanel.service.WorldStore;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import dev.craftyplayz.minepanel.telemetry.BackpacksSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.saveddata.SavedData;
import net.p3pp3rf1y.sophisticatedbackpacks.backpack.AccessLogRecord;
import net.p3pp3rf1y.sophisticatedbackpacks.backpack.BackpackItem;
import net.p3pp3rf1y.sophisticatedbackpacks.backpack.BackpackStorage;
import net.p3pp3rf1y.sophisticatedbackpacks.common.gui.BackpackContainer;
import net.p3pp3rf1y.sophisticatedbackpacks.init.ModDataComponents;
import net.p3pp3rf1y.sophisticatedcore.init.ModCoreDataComponents;
import net.p3pp3rf1y.sophisticatedcore.util.CodecHelper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// Sophisticated Backpacks (checked against 3.25.34) keeps a backpack's items on the server, not on the stack: the
// stack holds a storage UUID (sophisticatedcore:storage_uuid, synced to clients), and BackpackStorage, the overworld
// saved data "sophisticatedbackpacks", maps it to a tag whose "inventory" holds "Items" (each with "Slot"), encoded
// with CodecHelper.OVERSIZED_ITEM_STACK_CODEC. Clients only get contents when they open the backpack.
//
// Singleplayer: the integrated server's storage is read on the server thread (an existing saved data only, through
// the side-effect-free save(); never getOrCreateBackpackContents, never a write). Anywhere: the backpack's own screen
// is recorded and remembered per world in the WorldStore. Nothing is sent to the server.
public final class SophisticatedBackpacks implements Backpacks.Source {
    private static final String SAVED_DATA = "sophisticatedbackpacks";
    // Watched backpacks (carried, and the Backpacks panels') update about four times a second; one read covers them
    // all and only wraps the stored tags. The world-wide list is rebuilt every few seconds.
    private static final long READ_INTERVAL_MILLIS = 250;
    private static final long INDEX_INTERVAL_MILLIS = 5_000;
    private static final java.util.regex.Pattern ITEM_ID = java.util.regex.Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final long READ_TIMEOUT_MILLIS = 10_000;
    private static final int RECORD_INTERVAL_TICKS = 5;
    private static final int MAX_TRACKED = 64;

    // Client thread only, like every field here.
    private final Map<UUID, Backpacks.Contents> read = bounded();
    private final Map<UUID, Remembered> remembered = bounded();
    private final Map<UUID, Padded> paddedCache = bounded();
    // Backpacks sampled since the last server read.
    private final Set<UUID> seen = new LinkedHashSet<>();
    private WorldStore store;
    private BackpackContainer openMenu;
    private int ticks;
    private boolean inFlight;
    private long requestedAt;
    private int generation;
    private Throwable failure;
    // The Backpacks panels: backpacks the layout selects, the world-wide list and the last opened backpack.
    private Set<UUID> watched = Set.of();
    private List<Indexed> index;
    private long indexedAt;
    private UUID lastOpened;
    private final Map<String, ItemStack> icons = new HashMap<>();

    private record Remembered(WorldStore.Backpack stored, Backpacks.Contents contents) {
    }

    private record Padded(Backpacks.Contents source, Backpacks.Contents contents) {
    }

    private record ReadResult(Map<UUID, List<ItemStack>> contents, List<Indexed> index, UUID last, Throwable failure) {
    }

    // A listed backpack as read on the server thread.
    private record Indexed(UUID uuid, String name, String player, Long openedAt, String item, List<String> items,
                           int filled, int slots) {
    }

    private static <V> Map<UUID, V> bounded() {
        return new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<UUID, V> eldest) {
                return size() > MAX_TRACKED;
            }
        };
    }

    @Override
    public Backpacks.Contents contents(ItemStack stack) {
        if (!(stack.getItem() instanceof BackpackItem)) return null;
        UUID uuid = stack.get(ModCoreDataComponents.STORAGE_UUID);
        if (uuid == null) {
            // The UUID is assigned when a backpack is first opened; a loot backpack fills itself then.
            return stack.get(ModDataComponents.LOOT_TABLE) != null ? Backpacks.Contents.UNKNOWN : Backpacks.Contents.EMPTY;
        }
        if (seen.size() < MAX_TRACKED) seen.add(uuid);
        Backpacks.Contents fresh = read.get(uuid);
        Backpacks.Contents known = fresh != null && fresh != Backpacks.Contents.UNKNOWN ? fresh : remembered(uuid);
        return known == null ? Backpacks.Contents.UNKNOWN
                : padded(uuid, known, ((BackpackItem) stack.getItem()).getNumberOfSlots());
    }

    // Contents are by slot (empty stacks keep their place), filled out to the backpack's size so the dashboard can
    // draw its grid. The same padded instance is returned while the contents don't change.
    private Backpacks.Contents padded(UUID uuid, Backpacks.Contents contents, int slots) {
        int size = Math.min(slots, ItemSnapshot.MAX_CONTENTS);
        if (contents.items() == null || contents.items().size() >= size) return contents;
        Padded cached = paddedCache.get(uuid);
        if (cached != null && cached.source() == contents && cached.contents().items().size() == size) {
            return cached.contents();
        }
        List<ItemStack> items = new ArrayList<>(contents.items());
        while (items.size() < size) items.add(ItemStack.EMPTY);
        Backpacks.Contents result = new Backpacks.Contents(items);
        paddedCache.put(uuid, new Padded(contents, result));
        return result;
    }

    @Override
    public void tick(Minecraft minecraft, WorldStore store) {
        if (failure != null) throw new IllegalStateException("Reading backpack contents failed", failure);
        this.store = store;
        ticks++;
        BackpackContainer menu = minecraft.player != null && minecraft.player.containerMenu instanceof BackpackContainer open
                ? open : null;
        // Recorded while open, and once more as it closes so the last changes are kept.
        if (menu != null && ticks % RECORD_INTERVAL_TICKS == 0) record(minecraft, menu);
        if (menu != openMenu && openMenu != null) record(minecraft, openMenu);
        openMenu = menu;
        requestRead(minecraft);
    }

    @Override
    public void reset() {
        read.clear();
        remembered.clear();
        paddedCache.clear();
        seen.clear();
        index = null;
        lastOpened = null;
        icons.clear();
        openMenu = null;
        inFlight = false;
        generation++;
    }

    // ------------------------------------------------------------------------------- Remembered from the screen

    private Backpacks.Contents remembered(UUID uuid) {
        Minecraft minecraft = Minecraft.getInstance();
        WorldStore.Backpack stored = store == null ? null : store.backpack(uuid.toString());
        if (stored == null || minecraft.level == null) return null;
        Remembered cached = remembered.get(uuid);
        if (cached != null && cached.stored() == stored) return cached.contents();
        var ops = minecraft.level.registryAccess().createSerializationContext(JsonOps.INSTANCE);
        List<ItemStack> items = new ArrayList<>();
        for (JsonElement json : stored.items()) {
            // An empty slot is stored as {}, which doesn't decode: it stays an empty slot.
            items.add(CodecHelper.OVERSIZED_ITEM_STACK_CODEC.parse(ops, json).result()
                    .filter(stack -> !stack.isEmpty()).map(SophisticatedBackpacks::bounded).orElse(ItemStack.EMPTY));
        }
        Backpacks.Contents contents = new Backpacks.Contents(items);
        remembered.put(uuid, new Remembered(stored, contents));
        return contents;
    }

    private void record(Minecraft minecraft, BackpackContainer menu) {
        UUID uuid = menu.getStorageWrapper().getContentsUuid().orElse(null);
        if (uuid == null || store == null || minecraft.level == null) return;
        var ops = minecraft.level.registryAccess().createSerializationContext(JsonOps.INSTANCE);
        List<JsonElement> items = new ArrayList<>();
        for (Slot slot : menu.realInventorySlots) {
            if (items.size() == ItemSnapshot.MAX_CONTENTS) break;
            ItemStack stack = slot.getItem();
            items.add(stack.isEmpty() ? new JsonObject() : CodecHelper.OVERSIZED_ITEM_STACK_CODEC.encodeStart(ops, stack)
                    .result().filter(JsonElement::isJsonObject).orElseGet(JsonObject::new));
        }
        try {
            store.putBackpack(new WorldStore.Backpack(uuid.toString(), System.currentTimeMillis(), items));
        } catch (IllegalArgumentException tooLarge) {
            // An item whose data is too large to store; keep what was remembered before.
        }
    }

    // ------------------------------------------------------------------------------- Singleplayer server reads

    private void requestRead(Minecraft minecraft) {
        MinecraftServer server = minecraft.getSingleplayerServer();
        long now = System.currentTimeMillis();
        if (inFlight && now - requestedAt > READ_TIMEOUT_MILLIS) inFlight = false;
        if (server == null || inFlight) return;
        // Carried backpacks, the ones the Backpacks panels watch, and the last opened one.
        Set<UUID> wanted = new LinkedHashSet<>(seen);
        wanted.addAll(watched);
        if (lastOpened != null) wanted.add(lastOpened);
        boolean indexDue = index == null || now - indexedAt >= INDEX_INTERVAL_MILLIS;
        boolean appeared = wanted.stream().anyMatch(uuid -> !read.containsKey(uuid));
        if (!indexDue && (wanted.isEmpty() || !appeared && now - requestedAt < READ_INTERVAL_MILLIS)) return;
        List<UUID> ids = List.copyOf(wanted);
        seen.clear();
        inFlight = true;
        requestedAt = now;
        int request = ++generation;
        server.execute(() -> {
            // execute() runs the task in place when the server no longer takes tasks; never read it off its thread.
            if (!server.isSameThread()) return;
            ReadResult result = readOnServer(server, ids, indexDue);
            minecraft.execute(() -> apply(request, ids, result));
        });
    }

    // Server thread. Copies of the stored stacks (null contents for a backpack the storage could not answer for), and
    // with withIndex, a summary of every backpack the storage knows, newest access first, and the last opened one.
    private static ReadResult readOnServer(MinecraftServer server, List<UUID> ids, boolean withIndex) {
        try {
            var registries = server.registryAccess();
            // get(), unlike computeIfAbsent(), never creates the saved data; the factory's constructor is unused.
            BackpackStorage storage = server.overworld().getDataStorage().get(new SavedData.Factory<>(() -> {
                throw new IllegalStateException("MinePanel never creates backpack storage");
            }, BackpackStorage::load), SAVED_DATA);
            Map<UUID, List<ItemStack>> contents = new HashMap<>();
            if (storage == null) return new ReadResult(contents, withIndex ? List.of() : null, null, null);
            Set<UUID> wanted = new HashSet<>(ids);
            var ops = registries.createSerializationContext(NbtOps.INSTANCE);
            // Read only: the live access log map is iterated here on the server thread and never changed.
            Map<UUID, AccessLogRecord> logs = storage.getAccessLogs();
            List<Indexed> index = withIndex ? new ArrayList<>() : null;
            Set<UUID> indexed = new HashSet<>();
            CompoundTag saved = storage.save(new CompoundTag(), registries);
            for (Tag entry : saved.getList("backpackContents", Tag.TAG_COMPOUND)) {
                CompoundTag backpack = (CompoundTag) entry;
                if (!backpack.hasUUID("uuid")) continue;
                UUID uuid = backpack.getUUID("uuid");
                boolean read = wanted.remove(uuid);
                if (!read && !withIndex) continue;
                // By slot number, with empty stacks for the slots in between.
                List<ItemStack> items = new ArrayList<>();
                Set<String> itemIds = new LinkedHashSet<>();
                int filled = 0;
                int lastSlot = -1;
                for (Tag stored : backpack.getCompound("contents").getCompound("inventory")
                        .getList("Items", Tag.TAG_COMPOUND)) {
                    CompoundTag slot = (CompoundTag) stored;
                    int position = slot.getInt("Slot");
                    if (position < 0 || position >= ItemSnapshot.MAX_CONTENTS) continue;
                    String id = slot.getString("id");
                    if (!id.isEmpty()) {
                        filled++;
                        lastSlot = Math.max(lastSlot, position);
                        if (itemIds.size() < BackpacksSnapshot.MAX_ITEM_IDS && ITEM_ID.matcher(id).matches()) itemIds.add(id);
                    }
                    if (!read) continue;
                    ItemStack stack = CodecHelper.OVERSIZED_ITEM_STACK_CODEC.parse(ops, slot).result()
                            .filter(parsed -> !parsed.isEmpty()).map(SophisticatedBackpacks::bounded).orElse(ItemStack.EMPTY);
                    while (items.size() <= position) items.add(ItemStack.EMPTY);
                    items.set(position, stack);
                }
                if (read) contents.put(uuid, items);
                if (withIndex && index.size() < BackpacksSnapshot.MAX_LIST) {
                    index.add(indexed(uuid, logs.get(uuid), List.copyOf(itemIds), filled, lastSlot));
                    indexed.add(uuid);
                }
            }
            // Backpacks without an entry hold nothing (the storage drops empty ones when it loads).
            for (UUID missing : wanted) contents.put(missing, List.of());
            UUID last = null;
            long lastTime = Long.MIN_VALUE;
            if (withIndex) {
                for (AccessLogRecord log : logs.values()) {
                    if (log.getAccessTime() > lastTime) {
                        lastTime = log.getAccessTime();
                        last = log.getBackpackUuid();
                    }
                    if (!indexed.contains(log.getBackpackUuid()) && index.size() < BackpacksSnapshot.MAX_LIST) {
                        index.add(indexed(log.getBackpackUuid(), log, List.of(), 0, -1));
                    }
                }
                index.sort(Comparator.comparing((Indexed entry) -> entry.openedAt() == null ? Long.MIN_VALUE : entry.openedAt())
                        .reversed());
            }
            return new ReadResult(contents, index, last, null);
        } catch (LinkageError | RuntimeException failed) {
            return new ReadResult(Map.of(), null, null, failed);
        }
    }

    // Server thread: one listed backpack, named and dated from its access log when it has one.
    private static Indexed indexed(UUID uuid, AccessLogRecord log, List<String> items, int filled, int lastSlot) {
        String name = log == null ? "" : bounded(log.getBackpackName(), 256);
        String player = log == null || log.getPlayerName().isEmpty() ? null : bounded(log.getPlayerName(), 64);
        String item = log == null ? null : log.getBackpackItemRegistryName().toString();
        int slots = log != null && BuiltInRegistries.ITEM.get(log.getBackpackItemRegistryName()) instanceof BackpackItem backpack
                ? backpack.getNumberOfSlots() : lastSlot + 1;
        return new Indexed(uuid, name, player, log == null ? null : log.getAccessTime(), item, items, filled,
                Math.min(ItemSnapshot.MAX_CONTENTS, slots));
    }

    private static String bounded(String text, int length) {
        return text.length() > length ? text.substring(0, length) : text;
    }

    private void apply(int request, List<UUID> ids, ReadResult result) {
        if (request != generation) return;
        inFlight = false;
        if (result.failure() != null) {
            failure = result.failure();
            return;
        }
        if (result.index() != null) {
            index = result.index();
            lastOpened = result.last();
            indexedAt = System.currentTimeMillis();
        }
        for (UUID uuid : ids) {
            List<ItemStack> items = result.contents().get(uuid);
            Backpacks.Contents old = read.get(uuid);
            // Unchanged contents keep their instance, so the dashboard's item cache stays valid.
            boolean same = items != null && old != null && old.items() != null && matches(old.items(), items);
            read.put(uuid, same ? old : items == null ? Backpacks.Contents.UNKNOWN : new Backpacks.Contents(items));
        }
    }

    // ------------------------------------------------------------------------------------ The Backpacks panels

    @Override
    public Backpacks.Library library(Set<String> watchedIds) {
        watched = watchedIds.stream().map(SophisticatedBackpacks::uuid).filter(java.util.Objects::nonNull)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        if (Minecraft.getInstance().getSingleplayerServer() != null) return worldLibrary();
        return rememberedLibrary();
    }

    // Singleplayer: every backpack in the world's backpack data, contents as last read from the integrated server.
    private Backpacks.Library worldLibrary() {
        List<Backpacks.Listed> list = new ArrayList<>();
        Map<UUID, Indexed> byUuid = new HashMap<>();
        for (Indexed entry : index == null ? List.<Indexed>of() : index) {
            byUuid.put(entry.uuid(), entry);
            list.add(new Backpacks.Listed(entry.uuid().toString(), entry.name(), entry.player(), entry.openedAt(),
                    icon(entry.item()), entry.items(), entry.filled(), entry.slots()));
        }
        Map<String, Backpacks.Named> shown = new LinkedHashMap<>();
        for (UUID uuid : shownIds()) {
            Backpacks.Contents contents = read.get(uuid);
            // Not read yet: left out, so the panel says it is loading rather than "not known".
            if (contents == null || contents == Backpacks.Contents.UNKNOWN) continue;
            Indexed entry = byUuid.get(uuid);
            shown.put(uuid.toString(), new Backpacks.Named(entry == null ? "" : entry.name(),
                    padded(uuid, contents, entry == null ? 0 : entry.slots())));
        }
        return new Backpacks.Library("world", lastOpened == null ? null : lastOpened.toString(), list, shown);
    }

    // On a server: the backpacks this player opened, as last seen in their screens.
    private Backpacks.Library rememberedLibrary() {
        List<WorldStore.Backpack> stored = store == null ? List.of() : store.backpacks();
        List<Backpacks.Listed> list = new ArrayList<>();
        for (int position = stored.size() - 1; position >= 0 && list.size() < BackpacksSnapshot.MAX_LIST; position--) {
            WorldStore.Backpack backpack = stored.get(position);
            Set<String> ids = new LinkedHashSet<>();
            int filled = 0;
            for (JsonElement item : backpack.items()) {
                if (!item.isJsonObject() || !item.getAsJsonObject().has("id")) continue;
                filled++;
                String id = item.getAsJsonObject().get("id").getAsString();
                if (ids.size() < BackpacksSnapshot.MAX_ITEM_IDS && ITEM_ID.matcher(id).matches()) ids.add(id);
            }
            list.add(new Backpacks.Listed(backpack.uuid(), "", null, backpack.seenAt(), null, List.copyOf(ids), filled,
                    backpack.items().size()));
        }
        lastOpened = list.isEmpty() ? null : uuid(list.get(0).uuid());
        Map<String, Backpacks.Named> shown = new LinkedHashMap<>();
        for (UUID uuid : shownIds()) {
            Backpacks.Contents contents = remembered(uuid);
            if (contents != null) shown.put(uuid.toString(), new Backpacks.Named("", contents));
        }
        return new Backpacks.Library("remembered", lastOpened == null ? null : lastOpened.toString(), list, shown);
    }

    private List<UUID> shownIds() {
        Set<UUID> ids = new LinkedHashSet<>();
        if (lastOpened != null) ids.add(lastOpened);
        ids.addAll(watched);
        return ids.stream().limit(BackpacksSnapshot.MAX_SHOWN).toList();
    }

    private ItemStack icon(String item) {
        if (item == null) return null;
        return icons.computeIfAbsent(item, id -> {
            Identifier parsed = Identifier.tryParse(id);
            return parsed == null ? ItemStack.EMPTY : new ItemStack(BuiltInRegistries.ITEM.get(parsed));
        });
    }

    private static UUID uuid(String text) {
        try {
            return UUID.fromString(text);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private static boolean matches(List<ItemStack> first, List<ItemStack> second) {
        if (first.size() != second.size()) return false;
        for (int index = 0; index < first.size(); index++) {
            if (!ItemStack.matches(first.get(index), second.get(index))) return false;
        }
        return true;
    }

    // Upgraded backpacks hold stacks larger than the dashboard's count limit.
    private static ItemStack bounded(ItemStack stack) {
        return stack.getCount() > ItemSnapshot.MAX_COUNT ? stack.copyWithCount(ItemSnapshot.MAX_COUNT) : stack;
    }
}
*///?}
