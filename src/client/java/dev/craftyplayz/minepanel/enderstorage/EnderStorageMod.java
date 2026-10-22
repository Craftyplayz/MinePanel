package dev.craftyplayz.minepanel.enderstorage;

//? if neoforge {
/*import codechicken.enderstorage.api.AbstractEnderStorage;
import codechicken.enderstorage.api.Frequency;
import codechicken.enderstorage.container.ContainerEnderItemStorage;
import codechicken.enderstorage.init.EnderStorageModContent;
import codechicken.enderstorage.manager.EnderStorageManager;
import codechicken.enderstorage.storage.EnderItemStorage;
import codechicken.lib.inventory.InventoryUtils;
import dev.craftyplayz.minepanel.EnderStorage;
import net.minecraft.client.Minecraft;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// Ender Storage (checked against 2.13.0.191 for 1.21.1) keeps each ender chest's items on the server, one
// EnderItemStorage per frequency (three colours, plus an owner for a personal chest). Clients only get a chest's
// contents while its screen is open, through ContainerEnderItemStorage's slots.
//
// Singleplayer: the integrated server's manager is read on the server thread, never created or written: loaded chests
// from its storageMap, and chests only in its save data (not loaded since the world started) from its saveTag. Both
// fields are private, so they are read by reflection; any failure turns the integration off.
public final class EnderStorageMod implements EnderStorage.Source {
    private static final String ITEM_TYPE = ",type=" + EnderItemStorage.TYPE.name();
    private final Field serverManager;
    private final Field storageMap;
    private final Field saveTag;
    private ItemStack chestItem;
    // Server thread only: chests decoded from the save data, by key, with the tag they came from.
    private final Map<String, Saved> saved = new HashMap<>();

    private record Saved(CompoundTag tag, EnderStorage.Chest chest) {
    }

    public EnderStorageMod() {
        try {
            serverManager = EnderStorageManager.class.getDeclaredField("serverManager");
            storageMap = EnderStorageManager.class.getDeclaredField("storageMap");
            saveTag = EnderStorageManager.class.getDeclaredField("saveTag");
            serverManager.setAccessible(true);
            storageMap.setAccessible(true);
            saveTag.setAccessible(true);
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Unsupported Ender Storage version", failure);
        }
    }

    @Override
    public EnderStorage.Chest open(Minecraft minecraft) {
        if (minecraft.player == null || !(minecraft.player.containerMenu instanceof ContainerEnderItemStorage menu)) {
            return null;
        }
        Frequency frequency = menu.chestInv.freq;
        int size = Math.min(menu.chestInv.getContainerSize(), menu.slots.size());
        List<ItemStack> slots = new ArrayList<>(size);
        for (int slot = 0; slot < size; slot++) slots.add(menu.slots.get(slot).getItem().copy());
        return new EnderStorage.Chest(key(frequency), owner(frequency), slots);
    }

    @Override
    public String key(ItemStack stack) {
        if (!stack.is(EnderStorageModContent.ENDER_POUCH.get()) && !stack.is(EnderStorageModContent.ENDER_CHEST_ITEM.get())) {
            return null;
        }
        return key(Frequency.readFromStack(stack));
    }

    @Override
    public ItemStack chestItem() {
        if (chestItem == null) chestItem = new ItemStack(EnderStorageModContent.ENDER_CHEST_ITEM.get());
        return chestItem;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<EnderStorage.Chest> readAll(MinecraftServer server) {
        try {
            EnderStorageManager manager = (EnderStorageManager) serverManager.get(null);
            if (manager == null) return List.of();
            Map<String, AbstractEnderStorage> loaded = (Map<String, AbstractEnderStorage>) storageMap.get(manager);
            List<EnderStorage.Chest> chests = new ArrayList<>();
            List<String> loadedKeys = new ArrayList<>();
            synchronized (loaded) {
                for (Map.Entry<String, AbstractEnderStorage> entry : loaded.entrySet()) {
                    if (!(entry.getValue() instanceof EnderItemStorage storage)) continue;
                    loadedKeys.add(entry.getKey());
                    List<ItemStack> slots = new ArrayList<>(storage.getContainerSize());
                    for (int slot = 0; slot < storage.getContainerSize(); slot++) slots.add(storage.getItem(slot).copy());
                    chests.add(new EnderStorage.Chest(key(storage.freq), owner(storage.freq), slots));
                }
            }
            CompoundTag tags = (CompoundTag) saveTag.get(manager);
            if (tags == null) return chests;
            for (String key : tags.getAllKeys()) {
                if (!key.endsWith(ITEM_TYPE) || loadedKeys.contains(key)) continue;
                CompoundTag tag = tags.getCompound(key);
                Saved known = saved.get(key);
                if (known == null || known.tag() != tag) {
                    EnderStorage.Chest chest = savedChest(server, key, tag);
                    if (chest == null) continue;
                    known = new Saved(tag, chest);
                    saved.put(key, known);
                }
                chests.add(known.chest());
            }
            saved.keySet().retainAll(tags.getAllKeys());
            return chests;
        } catch (IllegalAccessException failure) {
            throw new IllegalStateException("Could not read Ender Storage's chests", failure);
        }
    }

    // A chest only in the save data. Its storage key is Frequency.toString() plus the type:
    // "left=white,middle=red,right=blue[,owner=Optional[<uuid>]],type=item".
    private static EnderStorage.Chest savedChest(MinecraftServer server, String key, CompoundTag tag) {
        Map<String, String> parts = new HashMap<>();
        for (String part : key.substring(0, key.length() - ITEM_TYPE.length()).split(",")) {
            int equals = part.indexOf('=');
            if (equals > 0) parts.put(part.substring(0, equals), part.substring(equals + 1));
        }
        String left = parts.get("left");
        String middle = parts.get("middle");
        String right = parts.get("right");
        if (left == null || middle == null || right == null) return null;
        String chestKey = left + "." + middle + "." + right;
        String owner = null;
        String ownerId = parts.get("owner");
        if (ownerId != null) {
            ownerId = ownerId.replace("Optional[", "").replace("]", "");
            try {
                UUID uuid = UUID.fromString(ownerId);
                chestKey += "." + uuid;
                var cache = server.getProfileCache();
                owner = cache == null ? null : cache.get(uuid).map(profile -> bounded(profile.getName())).orElse(null);
            } catch (IllegalArgumentException malformed) {
                return null;
            }
        }
        int sizeIndex = Math.clamp(tag.getByte("size"), 0, EnderItemStorage.sizes.length - 1);
        ItemStack[] items = new ItemStack[EnderItemStorage.sizes[sizeIndex]];
        Arrays.fill(items, ItemStack.EMPTY);
        InventoryUtils.readItemStacksFromTag(server.registryAccess(), items, tag.getList("Items", Tag.TAG_COMPOUND));
        return new EnderStorage.Chest(chestKey, owner, Arrays.asList(items));
    }

    private static String key(Frequency frequency) {
        return frequency.left().getSerializedName() + "." + frequency.middle().getSerializedName() + "."
                + frequency.right().getSerializedName() + frequency.owner().map(uuid -> "." + uuid).orElse("");
    }

    private static String owner(Frequency frequency) {
        return frequency.owner().isEmpty() ? null : frequency.ownerName().map(Component::getString)
                .map(EnderStorageMod::bounded).orElse(null);
    }

    private static String bounded(String name) {
        if (name == null || name.isEmpty()) return null;
        return name.length() > 64 ? name.substring(0, 64) : name;
    }
}
*///?}
