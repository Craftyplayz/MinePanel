package dev.craftyplayz.minepanel.backpacks;

//? if neoforge {
/*import dev.craftyplayz.minepanel.telemetry.BackpacksSnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ChunkHolder;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import net.p3pp3rf1y.sophisticatedcore.util.CodecHelper;
import net.p3pp3rf1y.sophisticatedstorage.block.ChestBlockEntity;
import net.p3pp3rf1y.sophisticatedstorage.block.StorageBlockEntity;
import net.p3pp3rf1y.sophisticatedstorage.common.gui.StorageContainerMenu;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

// Placed Sophisticated Storage blocks (checked against 1.5.30): every chest, barrel, limited barrel and shulker box is
// a StorageBlockEntity whose StorageWrapper keeps the items in a contents tag, "inventory" > "Items" (each with
// "Slot", CodecHelper.OVERSIZED_ITEM_STACK_CODEC, the same format as a backpack). StorageWrapper.save(new tag) only
// copies that tag and its fields; MinePanel never calls getInventoryHandler() or getNumberOfInventorySlots() (both can
// create state or mark the block dirty) nor the block entity's own saveAdditional (it clears a render flag). The second
// half of a double chest holds nothing itself: the main half's wrapper has both halves' slots.
//
// Only chunks that are loaded and ticking are read (ChunkMap.getVisibleChunkIfPresent + ChunkHolder.getTickingChunk,
// then the chunk's block entity map); nothing is loaded, generated or promoted. Only this class touches the mod's
// storage classes, and only when Sophisticated Storage is installed.
final class SophisticatedStorage {
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");

    // A placed storage: where it is, its name and item, and a summary of what it holds.
    record Found(UUID uuid, BackpacksSnapshot.Position position, String name, String item, List<String> items,
                 int filled, int slots) {
    }

    // One server-thread read: contents of the requested storages that are loaded, and with an index, every one near players.
    record Read(Map<UUID, List<ItemStack>> contents, List<Found> index) {
    }

    // The storage whose screen is open on the client, with its slots in order.
    record Opened(Found found, List<ItemStack> stacks) {
    }

    private record Candidate(StorageBlockEntity storage, String dimension, double distance) {
    }

    private SophisticatedStorage() {
    }

    // The stable id a storage is selected by: derived from where it is.
    static UUID uuid(BackpacksSnapshot.Position position) {
        return UUID.nameUUIDFromBytes((position.dimension() + "|" + position.x() + "|" + position.y() + "|"
                + position.z()).getBytes(StandardCharsets.UTF_8));
    }

    // ------------------------------------------------------------------------------------------ Server thread

    static Read read(MinecraftServer server, Map<UUID, BackpacksSnapshot.Position> wanted, boolean withIndex) {
        var ops = server.registryAccess().createSerializationContext(NbtOps.INSTANCE);
        Map<UUID, List<ItemStack>> contents = new HashMap<>();
        wanted.forEach((uuid, position) -> {
            StorageBlockEntity storage = loaded(server, position);
            // Null when not loaded (or gone), so the last contents read stay.
            contents.put(uuid, storage == null ? null : stacks(storage.getStorageWrapper().save(new CompoundTag()), ops));
        });
        return new Read(contents, withIndex ? index(server) : null);
    }

    private static StorageBlockEntity loaded(MinecraftServer server, BackpacksSnapshot.Position position) {
        Identifier id = Identifier.tryParse(position.dimension());
        ServerLevel level = id == null ? null : server.getLevel(ResourceKey.create(Registries.DIMENSION, id));
        if (level == null) return null;
        BlockPos pos = new BlockPos(position.x(), position.y(), position.z());
        LevelChunk chunk = loadedChunk(level, ChunkPos.asLong(pos));
        return chunk != null && chunk.getBlockEntities().get(pos) instanceof StorageBlockEntity storage
                && !storage.isRemoved() ? storage : null;
    }

    // A loaded, ticking chunk or null. LevelChunk.getBlockEntity(pos) could promote a pending block entity, so callers
    // read the chunk's map directly.
    private static LevelChunk loadedChunk(ServerLevel level, long chunk) {
        ChunkHolder holder = level.getChunkSource().chunkMap.getVisibleChunkIfPresent(chunk);
        return holder == null ? null : holder.getTickingChunk();
    }

    // Every storage within view distance of a player, nearest first, at most BackpacksSnapshot.MAX_LIST.
    private static List<Found> index(MinecraftServer server) {
        int radius = server.getPlayerList().getViewDistance();
        Map<ResourceKey<Level>, Set<Long>> visited = new HashMap<>();
        List<Candidate> candidates = new ArrayList<>();
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            ServerLevel level = player.serverLevel();
            String dimension = level.dimension().location().toString();
            Set<Long> done = visited.computeIfAbsent(level.dimension(), key -> new HashSet<>());
            ChunkPos center = player.chunkPosition();
            BlockPos at = player.blockPosition();
            for (int dx = -radius; dx <= radius; dx++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    long key = ChunkPos.asLong(center.x + dx, center.z + dz);
                    if (!done.add(key)) continue;
                    LevelChunk chunk = loadedChunk(level, key);
                    if (chunk == null) continue;
                    for (BlockEntity entity : chunk.getBlockEntities().values()) {
                        if (entity instanceof StorageBlockEntity storage && !storage.isRemoved()
                                && !(storage instanceof ChestBlockEntity chest && !chest.isMainChest())) {
                            candidates.add(new Candidate(storage, dimension, storage.getBlockPos().distSqr(at)));
                        }
                    }
                }
            }
        }
        candidates.sort(Comparator.comparingDouble(Candidate::distance));
        List<Found> index = new ArrayList<>();
        for (Candidate candidate : candidates) {
            if (index.size() == BackpacksSnapshot.MAX_LIST) break;
            index.add(found(candidate.storage(), candidate.dimension(), candidate.storage().getStorageWrapper()
                    .save(new CompoundTag())));
        }
        return index;
    }

    private static Found found(StorageBlockEntity storage, String dimension, CompoundTag saved) {
        Set<String> ids = new LinkedHashSet<>();
        int filled = 0;
        for (Tag stored : items(saved)) {
            CompoundTag slot = (CompoundTag) stored;
            int position = slot.getInt("Slot");
            String id = slot.getString("id");
            if (position < 0 || position >= ItemSnapshot.MAX_CONTENTS || id.isEmpty()) continue;
            filled++;
            if (ids.size() < BackpacksSnapshot.MAX_ITEM_IDS && ITEM_ID.matcher(id).matches()) ids.add(id);
        }
        // Saved once the size is known; until then the block's default (getNumberOfInventorySlots would save it).
        int slots = saved.getInt("numberOfInventorySlots");
        if (slots <= 0) slots = storage.getStorageWrapper().getDefaultNumberOfInventorySlots();
        return found(storage, dimension, ids, filled, slots);
    }

    private static Found found(StorageBlockEntity storage, String dimension, Set<String> ids, int filled, int slots) {
        BlockPos pos = storage instanceof ChestBlockEntity chest ? chest.getMainPos() : storage.getBlockPos();
        var position = new BackpacksSnapshot.Position(dimension, pos.getX(), pos.getY(), pos.getZ());
        Item item = storage.getBlockState().getBlock().asItem();
        String name = storage.getDisplayName().getString();
        return new Found(uuid(position), position, name.length() > 256 ? name.substring(0, 256) : name,
                item == Items.AIR ? null : BuiltInRegistries.ITEM.getKey(item).toString(), List.copyOf(ids), filled,
                Math.max(0, Math.min(ItemSnapshot.MAX_CONTENTS, slots)));
    }

    private static List<Tag> items(CompoundTag saved) {
        return saved.getCompound("contents").getCompound("inventory").getList("Items", Tag.TAG_COMPOUND);
    }

    // By slot number, with empty stacks for the slots in between.
    private static List<ItemStack> stacks(CompoundTag saved, com.mojang.serialization.DynamicOps<Tag> ops) {
        List<ItemStack> stacks = new ArrayList<>();
        for (Tag stored : items(saved)) {
            int position = ((CompoundTag) stored).getInt("Slot");
            if (position < 0 || position >= ItemSnapshot.MAX_CONTENTS) continue;
            ItemStack stack = CodecHelper.OVERSIZED_ITEM_STACK_CODEC.parse(ops, stored).result().orElse(ItemStack.EMPTY);
            while (stacks.size() <= position) stacks.add(ItemStack.EMPTY);
            stacks.set(position, stack);
        }
        return stacks;
    }

    // ------------------------------------------------------------------------------------------ Client thread

    // The storage whose screen is open, or null. Its block position comes with the menu, so this works on servers.
    static Object menu(Minecraft minecraft) {
        return minecraft.player != null && minecraft.player.containerMenu instanceof StorageContainerMenu menu ? menu : null;
    }

    // Also called once with the menu that just closed: its slots still hold what was last synced.
    static Opened opened(Minecraft minecraft, Object open) {
        if (minecraft.player == null || minecraft.level == null || !(open instanceof StorageContainerMenu menu)) return null;
        List<ItemStack> stacks = new ArrayList<>();
        Set<String> ids = new LinkedHashSet<>();
        int filled = 0;
        for (Slot slot : menu.realInventorySlots) {
            if (stacks.size() == ItemSnapshot.MAX_CONTENTS) break;
            ItemStack stack = slot.getItem().copy();
            stacks.add(stack);
            if (stack.isEmpty()) continue;
            filled++;
            if (ids.size() < BackpacksSnapshot.MAX_ITEM_IDS) ids.add(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        }
        String dimension = minecraft.level.dimension().location().toString();
        return new Opened(found(menu.getStorageBlockEntity(), dimension, ids, filled, menu.realInventorySlots.size()),
                stacks);
    }
}
*///?}
