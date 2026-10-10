package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public final class InventorySnapshotTest {
    public static void main(String[] args) {
        testItems();
        testCollectionAndValidation();
        testChangesAndBaselines();
        System.out.println("MinePanel immutable inventory telemetry tests passed.");
    }

    private static void testItems() {
        ItemSnapshot empty = ItemSnapshot.emptyItem();
        check(empty.toJson().equals("{\"empty\":true,\"itemId\":null,\"name\":null,\"count\":0,\"maxCount\":0,"
                + "\"damage\":null,\"maxDamage\":null,\"remainingDurability\":null,\"enchantments\":[]}"),
                "empty items have explicit null/zero metadata");
        List<ItemSnapshot.Enchantment> enchantments = new ArrayList<>();
        enchantments.add(new ItemSnapshot.Enchantment("minecraft:unbreaking", "Unbreaking \"III\"\n", 3));
        ItemSnapshot tool = new ItemSnapshot(false, "minecraft:diamond_pickaxe", "Tool \"\\\n\t\u0001😀",
                1, 1, 15, 100, enchantments);
        enchantments.clear();
        check(tool.enchantments().size() == 1 && tool.remainingDurability() == 85,
                "enchantments copied and remaining durability derived");
        check(tool.toJson().contains("\"remainingDurability\":85")
                        && tool.toJson().contains("Tool \\\"\\\\\\n\\t\\u0001😀")
                        && tool.toJson().contains("Unbreaking \\\"III\\\"\\n"),
                "item names and enchantments are JSON escaped");
        immutable(() -> tool.enchantments().clear());
        check(item(2).remainingDurability() == null, "ordinary stacks have no durability");
        check(new ItemSnapshot(false, "minecraft:bow", "Bow", 1, 1, 100, 100, List.of())
                .remainingDurability() == 0, "exhausted durability is zero");
        invalid(() -> new ItemSnapshot(true, "minecraft:air", null, 0, 0, null, null, List.of()));
        invalid(() -> new ItemSnapshot(false, "bad id", "name", 1, 64, null, null, List.of()));
        invalid(() -> new ItemSnapshot(false, "minecraft:stone", "x".repeat(257), 1, 64, null, null, List.of()));
        invalid(() -> new ItemSnapshot(false, "minecraft:stone", "\ud800", 1, 64, null, null, List.of()));
        invalid(() -> item(0));
        invalid(() -> item(-1));
        invalid(() -> item(ItemSnapshot.MAX_COUNT + 1));
        invalid(() -> new ItemSnapshot(false, "minecraft:stone", "Stone", 1, 0, null, null, List.of()));
        invalid(() -> new ItemSnapshot(false, "minecraft:bow", "Bow", 1, 1, 1, null, List.of()));
        invalid(() -> new ItemSnapshot(false, "minecraft:bow", "Bow", 1, 1, -1, 100, List.of()));
        invalid(() -> new ItemSnapshot(false, "minecraft:bow", "Bow", 1, 1, 101, 100, List.of()));
        invalid(() -> new ItemSnapshot(false, "minecraft:bow", "Bow", 1, 1, 0, 0, List.of()));
        invalid(() -> new ItemSnapshot.Enchantment("invalid", "Enchant", 1));
        invalid(() -> new ItemSnapshot.Enchantment("minecraft:unbreaking", "Enchant", 0));
        invalid(() -> new ItemSnapshot.Enchantment("minecraft:unbreaking", "Enchant", 256));
        invalid(() -> new ItemSnapshot(false, "minecraft:stone", "Stone", 1, 64, null, null,
                Collections.nCopies(65, new ItemSnapshot.Enchantment("minecraft:unbreaking", "Unbreaking", 1))));
        invalid(() -> new ItemSnapshot(false, "minecraft:stone", "Stone", 1, 64, null, null,
                Collections.singletonList(null)));
    }

    private static void testCollectionAndValidation() {
        List<ItemSnapshot> slots = emptySlots();
        slots.set(0, item(4));
        slots.set(9, item(2));
        slots.set(35, item(3));
        Map<String, ItemSnapshot> equipment = emptyEquipment();
        equipment.put("mainhand", slots.get(0));
        InventorySnapshot snapshot = new InventorySnapshot(slots, 0, equipment);
        slots.clear();
        equipment.clear();
        check(snapshot.slots().size() == 36 && snapshot.slots().get(35).count() == 3,
                "inventory contains hotbar and main slots and copies input containers");
        check(snapshot.equipment().get("mainhand").count() == 4, "mainhand matches selection");
        immutable(() -> snapshot.slots().clear());
        immutable(() -> snapshot.equipment().clear());
        AtomicInteger reads = new AtomicInteger();
        AtomicInteger equipmentReads = new AtomicInteger();
        InventorySnapshot collected = InventorySnapshot.collect(index -> {
            check(index == reads.getAndIncrement(), "collector reads inventory indices once in order");
            return snapshot.slots().get(index);
        }, 0, key -> {
            check(!key.equals("mainhand"), "collector derives held stack without a second live read");
            equipmentReads.incrementAndGet();
            return snapshot.equipment().get(key);
        });
        check(snapshot.equals(collected) && reads.get() == 36 && equipmentReads.get() == 5,
                "pure collection adapter captures an immutable value snapshot");
        invalid(() -> new InventorySnapshot(List.of(), 0, emptyEquipment()));
        invalid(() -> new InventorySnapshot(emptySlots(), -1, emptyEquipment()));
        invalid(() -> new InventorySnapshot(emptySlots(), 9, emptyEquipment()));
        Map<String, ItemSnapshot> extra = emptyEquipment();
        extra.put("extra", ItemSnapshot.emptyItem());
        invalid(() -> new InventorySnapshot(emptySlots(), 0, extra));
        Map<String, ItemSnapshot> missing = emptyEquipment();
        missing.remove("feet");
        invalid(() -> new InventorySnapshot(emptySlots(), 0, missing));
        Map<String, ItemSnapshot> wrongHeld = emptyEquipment();
        wrongHeld.put("mainhand", item(1));
        invalid(() -> new InventorySnapshot(emptySlots(), 0, wrongHeld));
        List<ItemSnapshot> nullSlot = emptySlots();
        nullSlot.set(4, null);
        invalid(() -> new InventorySnapshot(nullSlot, 0, emptyEquipment()));
        invalid(() -> InventorySnapshot.collect(index -> ItemSnapshot.emptyItem(), 0, key -> null));
        invalid(() -> new PlayerSnapshot(0, 0, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0,
                20.0, 20.0, 0.0, null));
        invalid(() -> new PlayerSnapshot(0, 0, false, null, null, null, null, null, null, null, null, snapshot));
    }

    private static void testChangesAndBaselines() {
        TelemetryStore store = new TelemetryStore();
        PlayerSnapshot unavailable = store.player();
        check(unavailable.inventory() == null && unavailable.toJson().contains("\"inventory\":null"),
                "unavailable inventory is null");
        InventorySnapshot inventory = InventorySnapshot.empty();
        publish(store, inventory);
        PlayerSnapshot first = store.player();
        check(first.toDeltaJson(unavailable).contains("\"baseRevision\":0")
                        && first.toDeltaJson(unavailable).contains("\"inventory\":{\"slots\":[{\"empty\":true"),
                "availability transition sends full inventory and baseline");
        check(!first.toJson().contains("baseRevision") && first.toDeltaJson(null).equals(first.toJson()),
                "initial snapshots have no baseline");
        check(!publish(store, InventorySnapshot.empty()) && store.player() == first,
                "equal captured values do not advance revisions or replace snapshots");

        List<ItemSnapshot> slots = emptySlots();
        slots.set(0, item(8));
        inventory = collect(slots, 0, emptyEquipment());
        publish(store, inventory);
        PlayerSnapshot stack = store.player();
        String delta = stack.toDeltaJson(first);
        check(delta.contains("\"baseRevision\":1") && delta.contains("\"index\":0")
                        && !delta.contains("\"index\":1") && delta.contains("\"equipment\":{\"mainhand\":")
                        && !delta.contains("selectedHotbarSlot"), "stack changes include only changed slot and held equipment");

        slots.set(0, item(3));
        slots.set(9, item(5));
        inventory = collect(slots, 0, emptyEquipment());
        publish(store, inventory);
        PlayerSnapshot split = store.player();
        check(split.toDeltaJson(stack).contains("\"index\":0")
                        && split.toDeltaJson(stack).contains("\"index\":9")
                        && !split.toDeltaJson(stack).contains("\"index\":8"), "split emits two changed indices only");
        slots.set(9, ItemSnapshot.emptyItem());
        slots.set(35, item(5));
        publish(store, collect(slots, 0, emptyEquipment()));
        PlayerSnapshot moved = store.player();
        check(moved.toDeltaJson(split).contains("\"index\":9,\"item\":{\"empty\":true")
                        && moved.toDeltaJson(split).contains("\"index\":35")
                        && !moved.toDeltaJson(split).contains("\"equipment\""), "move clears source and fills destination");
        publish(store, collect(slots, 1, emptyEquipment()));
        PlayerSnapshot selected = store.player();
        check(selected.toDeltaJson(moved).contains("\"selectedHotbarSlot\":1")
                        && selected.toDeltaJson(moved).contains("\"mainhand\":{\"empty\":true")
                        && !selected.toDeltaJson(moved).contains("\"slots\""), "selection updates held item without unchanged slots");
        slots.set(1, new ItemSnapshot(false, "minecraft:bow", "Bow", 1, 1, 10, 100,
                List.of(new ItemSnapshot.Enchantment("minecraft:unbreaking", "Unbreaking", 1))));
        publish(store, collect(slots, 1, emptyEquipment()));
        PlayerSnapshot enchanted = store.player();
        slots.set(1, new ItemSnapshot(false, "minecraft:bow", "Renamed bow", 1, 1, 11, 100,
                List.of(new ItemSnapshot.Enchantment("minecraft:unbreaking", "Unbreaking", 2))));
        publish(store, collect(slots, 1, emptyEquipment()));
        PlayerSnapshot worn = store.player();
        check(worn.toDeltaJson(enchanted).contains("\"index\":1")
                        && worn.toDeltaJson(enchanted).contains("\"remainingDurability\":89")
                        && worn.toDeltaJson(enchanted).contains("\"level\":2")
                        && worn.toDeltaJson(enchanted).contains("\"name\":\"Renamed bow\"")
                        && worn.toDeltaJson(enchanted).contains("\"equipment\":{\"mainhand\":"),
                "durability, enchantment and display-name changes publish slot and held metadata");

        Map<String, ItemSnapshot> equipment = emptyEquipment();
        equipment.put("head", item(1));
        equipment.put("offhand", item(2));
        publish(store, collect(slots, 1, equipment));
        PlayerSnapshot equipped = store.player();
        check(equipped.toDeltaJson(worn).contains("\"equipment\":{\"head\":")
                        && equipped.toDeltaJson(worn).contains("\"offhand\":")
                        && !equipped.toDeltaJson(worn).contains("\"mainhand\""), "equipment delta contains changed keys only");
        publish(store, collect(slots, 1, emptyEquipment()));
        PlayerSnapshot removed = store.player();
        check(removed.toDeltaJson(equipped).contains("\"head\":{\"empty\":true"),
                "equipment removal is explicit empty item");
        store.updatePlayer(2000, 1L, "minecraft:the_nether", 1.0, 65.0, 2.0, 19.0, 20.0, 0.0, removed.inventory());
        PlayerSnapshot playerChange = store.player();
        check(!playerChange.toDeltaJson(removed).contains("\"inventory\"")
                        && playerChange.toDeltaJson(removed).contains("\"position\":{\"y\":65.0}")
                        && playerChange.toDeltaJson(removed).contains("\"health\":19.0"),
                "existing player changes remain sparse and unchanged inventory is omitted");
        store.markUnavailable(3000);
        check(store.player().toDeltaJson(playerChange).contains("\"inventory\":null")
                        && store.player().toDeltaJson(playerChange).contains("\"baseRevision\":" + playerChange.revision()),
                "disconnect clears inventory with its baseline");
        PlayerSnapshot disconnected = store.player();
        store.updatePlayer(4000, 0L, "minecraft:overworld", 1.0, 64.0, 2.0, 20.0, 20.0, 0.0);
        check(store.player().inventory().equals(InventorySnapshot.empty())
                        && store.player().toDeltaJson(disconnected).contains("\"baseRevision\":" + disconnected.revision()),
                "legacy update overload supplies an empty available inventory on reconnect");
    }

    private static boolean publish(TelemetryStore store, InventorySnapshot inventory) {
        return store.updatePlayer(1000, 0L, "minecraft:overworld", 1.0, 64.0, 2.0, 20.0, 20.0, 0.0, inventory);
    }

    private static InventorySnapshot collect(List<ItemSnapshot> slots, int selected, Map<String, ItemSnapshot> equipment) {
        return InventorySnapshot.collect(slots::get, selected, equipment::get);
    }

    public static ItemSnapshot item(int count) {
        return new ItemSnapshot(false, "minecraft:stone", "Stone", count, 64, null, null, List.of());
    }

    public static List<ItemSnapshot> emptySlots() {
        return new ArrayList<>(Collections.nCopies(36, ItemSnapshot.emptyItem()));
    }

    public static Map<String, ItemSnapshot> emptyEquipment() {
        Map<String, ItemSnapshot> result = new HashMap<>();
        InventorySnapshot.EQUIPMENT_KEYS.forEach(key -> result.put(key, ItemSnapshot.emptyItem()));
        return result;
    }

    private static void invalid(Runnable action) {
        try {
            action.run();
            throw new AssertionError("invalid immutable metadata accepted");
        } catch (IllegalArgumentException | NullPointerException expected) {
        }
    }

    private static void immutable(Runnable action) {
        try {
            action.run();
            throw new AssertionError("immutable container mutated");
        } catch (UnsupportedOperationException expected) {
        }
    }

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
}
