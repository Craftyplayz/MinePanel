package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public final class ItemExtractorTest {
    private static final FakeItem EMPTY = new FakeItem(true, null, null, -1, -1, false, -1, -1, null, null);

    public static void main(String[] args) {
        testMetadata();
        testEnchantmentsAndBounds();
        testInventoryAndChanges();
        System.out.println("MinePanel read-only item extraction tests passed.");
    }

    private static void testMetadata() {
        check(ItemExtractor.extract(EMPTY) == ItemSnapshot.emptyItem(), "empty view ignores absent metadata");
        ItemSnapshot stack = ItemExtractor.extract(stone(17));
        check(stack.itemId().equals("minecraft:stone") && stack.name().equals("Stone")
                        && stack.count() == 17 && stack.maxCount() == 64
                        && stack.damage() == null && stack.maxDamage() == null && stack.enchantments().isEmpty(),
                "ordinary stack copies identity and counts without reading durability");
        ItemSnapshot tool = ItemExtractor.extract(tool("Pickaxe", 15, List.of()));
        check(tool.damage() == 15 && tool.maxDamage() == 100 && tool.remainingDurability() == 85,
                "damageable item copies durability");
        check(ItemExtractor.extract(tool("Pickaxe", 100, List.of())).remainingDurability() == 0,
                "fully worn item has zero durability");
        check(ItemExtractor.extract(tool("", 0, List.of())).name().equals("Unnamed"), "empty name fallback");
        String raw = "Named \"\\\n\t\u0001\ud800X\udc00😀";
        ItemSnapshot named = ItemExtractor.extract(tool(raw, 0, List.of()));
        check(named.name().equals("Named \"\\   \ufffdX\ufffd😀"), "controls and unpaired surrogates sanitized");
        check(named.toJson().contains("Named \\\"\\\\   \ufffdX\ufffd😀"), "extracted custom name JSON escaped");
        check(ItemExtractor.extract(tool("x".repeat(255) + "😀tail", 0, List.of())).name().equals("x".repeat(255)),
                "truncation does not split a supplementary character");
        check(ItemExtractor.extract(tool("x".repeat(254) + "😀tail", 0, List.of())).name()
                        .equals("x".repeat(254) + "😀"), "supplementary character fits exactly at text bound");
        check(ItemExtractor.extract(tool("x".repeat(300), 0, List.of())).name().length() == 256,
                "long custom names bounded");
        invalid(() -> ItemExtractor.extract(null));
        invalid(() -> ItemExtractor.extract(stone(0)));
        invalid(() -> ItemExtractor.extract(stone(ItemSnapshot.MAX_COUNT + 1)));
        invalid(() -> ItemExtractor.extract(new FakeItem(false, "bad id", "Stone", 1, 64,
                false, 0, 0, List.of(), List.of())));
        invalid(() -> ItemExtractor.extract(new FakeItem(false, "minecraft:stone", "Stone", 1, 0,
                false, 0, 0, List.of(), List.of())));
        invalid(() -> ItemExtractor.extract(tool("Pickaxe", -1, List.of())));
        invalid(() -> ItemExtractor.extract(tool("Pickaxe", 101, List.of())));
    }

    private static void testEnchantmentsAndBounds() {
        List<ItemExtractor.EnchantmentView> applied = new ArrayList<>(List.of(
                enchantment("unbreaking", "Applied weak", 1),
                enchantment("efficiency", "Efficiency\nV", 5),
                enchantment("mending", "Applied tie", 1)));
        List<ItemExtractor.EnchantmentView> stored = new ArrayList<>(List.of(
                enchantment("unbreaking", "Stored strong", 3),
                enchantment("mending", "Stored tie", 1)));
        FakeItem book = new FakeItem(false, "minecraft:enchanted_book", "Book", 1, 1,
                false, 0, 0, applied, stored);
        ItemSnapshot extracted = ItemExtractor.extract(book);
        check(extracted.enchantments().equals(List.of(
                new ItemSnapshot.Enchantment("minecraft:efficiency", "Efficiency V", 5),
                new ItemSnapshot.Enchantment("minecraft:mending", "Applied tie", 1),
                new ItemSnapshot.Enchantment("minecraft:unbreaking", "Stored strong", 3))),
                "applied/stored enchantments sorted, merged at highest level and applied wins ties");
        applied.clear();
        stored.clear();
        check(extracted.enchantments().size() == 3, "snapshot detached from source enchantment collections");
        try {
            extracted.enchantments().clear();
            throw new AssertionError("extracted enchantments mutable");
        } catch (UnsupportedOperationException expected) {
        }
        ItemSnapshot storedOnly = ItemExtractor.extract(new FakeItem(false, "minecraft:enchanted_book", "Book",
                1, 1, false, 0, 0, List.of(), List.of(enchantment("mending", "", 1))));
        check(storedOnly.enchantments().getFirst().name().equals("Unnamed"), "stored-only book and name fallback");
        check(ItemExtractor.extract(tool("Tool", 0, List.of(enchantment("mending", "x".repeat(255) + "😀", 1))))
                        .enchantments().getFirst().name().length() == 255,
                "enchantment names use the same safe text bound");
        List<ItemExtractor.EnchantmentView> full = enchantments(0, 64);
        check(ItemExtractor.extract(tool("Tool", 0, full)).enchantments().size() == 64,
                "maximum distinct enchantments allowed");
        invalid(() -> ItemExtractor.extract(tool("Tool", 0, enchantments(0, 65))));
        invalid(() -> ItemExtractor.extract(tool("Tool", 0,
                Collections.nCopies(65, enchantment("mending", "Mending", 1)))));
        invalid(() -> ItemExtractor.extract(new FakeItem(false, "minecraft:enchanted_book", "Book", 1, 1,
                false, 0, 0, full, enchantments(64, 1))));
        check(ItemExtractor.extract(new FakeItem(false, "minecraft:enchanted_book", "Book", 1, 1,
                false, 0, 0, full, full)).enchantments().size() == 64, "duplicate sources fit union bound");
        FakeItem appliedWins = new FakeItem(false, "minecraft:enchanted_book", "Book", 1, 1, false, 0, 0,
                List.of(enchantment("unbreaking", "Applied strong", 3)),
                List.of(enchantment("unbreaking", "Stored weak", 1)));
        check(ItemExtractor.extract(appliedWins).enchantments().getFirst().name().equals("Applied strong"),
                "lower stored level does not replace applied enchantment");
        List<ItemExtractor.EnchantmentView> reversed = new ArrayList<>(full);
        Collections.reverse(reversed);
        check(ItemExtractor.extract(tool("Tool", 0, full)).equals(ItemExtractor.extract(tool("Tool", 0, reversed))),
                "enchantment iteration order does not create spurious changes");
        invalid(() -> ItemExtractor.extract(tool("Tool", 0, List.of(enchantment("mending", "Mending", 0)))));
        invalid(() -> ItemExtractor.extract(tool("Tool", 0, List.of(enchantment("mending", "Mending", 256)))));
        invalid(() -> ItemExtractor.extract(tool("Tool", 0,
                List.of(new ItemExtractor.EnchantmentView("bad id", "Mending", 1)))));
    }

    private static void testInventoryAndChanges() {
        List<FakeItem> slots = new ArrayList<>(Collections.nCopies(36, EMPTY));
        slots.set(0, stone(8));
        slots.set(8, tool("Tool", 0, List.of()));
        slots.set(9, stone(2));
        slots.set(35, stone(3));
        Map<String, FakeItem> equipment = new HashMap<>();
        List<String> keys = List.of("head", "chest", "legs", "feet", "offhand");
        for (int index = 0; index < keys.size(); index++) equipment.put(keys.get(index), stone(index + 1));
        AtomicInteger reads = new AtomicInteger();
        List<String> equipmentReads = new ArrayList<>();
        InventorySnapshot first = ItemExtractor.collect(index -> {
            check(index == reads.getAndIncrement(), "slots read exactly once in ascending order");
            return slots.get(index);
        }, 8, key -> {
            equipmentReads.add(key);
            return equipment.get(key);
        });
        check(reads.get() == 36 && equipmentReads.equals(keys), "36 slots and five explicit equipment reads");
        check(first.slots().get(9).count() == 2 && first.slots().get(35).count() == 3
                        && first.slots().get(1).empty(), "main inventory boundaries and explicit empties");
        for (int index = 0; index < keys.size(); index++) {
            check(first.equipment().get(keys.get(index)).count() == index + 1, "equipment mapping " + keys.get(index));
        }
        check(first.equipment().get("mainhand") == first.slots().get(8), "mainhand reuses captured selection");
        check(first.equals(collect(slots, 8, equipment)), "equal reads produce equal immutable snapshots");
        check(collect(slots, 8, equipment).toDeltaJson(first).equals("{}"), "unchanged extraction has no delta");
        slots.set(0, stone(5));
        slots.set(9, stone(5));
        InventorySnapshot split = collect(slots, 8, equipment);
        check(split.toDeltaJson(first).contains("\"index\":0") && split.toDeltaJson(first).contains("\"index\":9")
                        && !split.toDeltaJson(first).contains("\"equipment\""), "split extracts only changed slots");
        slots.set(9, EMPTY);
        slots.set(35, stone(8));
        InventorySnapshot moved = collect(slots, 8, equipment);
        check(moved.toDeltaJson(split).contains("\"index\":9,\"item\":{\"empty\":true")
                        && moved.toDeltaJson(split).contains("\"index\":35"), "move emits source removal and destination");
        InventorySnapshot selected = collect(slots, 0, equipment);
        check(selected.toDeltaJson(moved).contains("\"selectedHotbarSlot\":0")
                        && selected.toDeltaJson(moved).contains("\"mainhand\":")
                        && !selected.toDeltaJson(moved).contains("\"slots\""), "selection updates held item only");
        slots.set(0, stone(4));
        InventorySnapshot consumed = collect(slots, 0, equipment);
        check(consumed.toDeltaJson(selected).contains("\"index\":0")
                        && consumed.toDeltaJson(selected).contains("\"mainhand\":"), "consumption updates slot and held item");
        slots.set(8, tool("Renamed", 11, List.of(enchantment("unbreaking", "Unbreaking", 2))));
        InventorySnapshot worn = collect(slots, 0, equipment);
        check(worn.toDeltaJson(consumed).contains("\"index\":8")
                        && worn.toDeltaJson(consumed).contains("\"remainingDurability\":89")
                        && worn.toDeltaJson(consumed).contains("\"name\":\"Renamed\"")
                        && worn.toDeltaJson(consumed).contains("\"level\":2"), "metadata changes survive extraction");
        equipment.put("head", EMPTY);
        equipment.put("offhand", stone(6));
        InventorySnapshot equipped = collect(slots, 0, equipment);
        String delta = equipped.toDeltaJson(worn);
        check(delta.contains("\"head\":{\"empty\":true") && delta.contains("\"offhand\":")
                        && !delta.contains("\"slots\"") && !delta.contains("\"chest\""), "equipment-only sparse delta");
        check(first.slots().get(0).count() == 8 && first.equipment().get("head").count() == 1
                        && first.slots().get(8).damage() == 0, "earlier snapshot unaffected by changed views");
        invalid(() -> ItemExtractor.collect(index -> { throw new AssertionError("invalid selection read"); },
                9, key -> EMPTY));
        invalid(() -> ItemExtractor.collect(index -> { throw new AssertionError("invalid selection read"); },
                -1, key -> EMPTY));
        invalid(() -> ItemExtractor.collect(index -> null, 0, key -> EMPTY));
        invalid(() -> ItemExtractor.collect(index -> EMPTY, 0, key -> null));
    }

    private static InventorySnapshot collect(List<FakeItem> slots, int selected, Map<String, FakeItem> equipment) {
        return ItemExtractor.collect(slots::get, selected, equipment::get);
    }

    private static FakeItem stone(int count) {
        return new FakeItem(false, "minecraft:stone", "Stone", count, 64, false, 0, 0, List.of(), List.of());
    }

    private static FakeItem tool(String name, int damage, List<ItemExtractor.EnchantmentView> enchantments) {
        return new FakeItem(false, "minecraft:diamond_pickaxe", name, 1, 1, true, damage, 100, enchantments, List.of());
    }

    private static ItemExtractor.EnchantmentView enchantment(String path, String name, int level) {
        return new ItemExtractor.EnchantmentView("minecraft:" + path, name, level);
    }

    private static List<ItemExtractor.EnchantmentView> enchantments(int start, int count) {
        List<ItemExtractor.EnchantmentView> result = new ArrayList<>();
        for (int index = start; index < start + count; index++) result.add(enchantment("test_" + index, "Test", 1));
        return result;
    }

    private record FakeItem(boolean isEmpty, String itemId, String name, int count, int maxCount,
                            boolean isDamageable, int damage, int maxDamage,
                            List<ItemExtractor.EnchantmentView> appliedEnchantments,
                            List<ItemExtractor.EnchantmentView> storedEnchantments) implements ItemExtractor.ItemView {
        public int damage() {
            check(isDamageable, "non-damageable metadata must not be read");
            return damage;
        }

        public int maxDamage() {
            check(isDamageable, "non-damageable metadata must not be read");
            return maxDamage;
        }
    }

    private static void invalid(Runnable action) {
        try {
            action.run();
            throw new AssertionError("invalid extracted metadata accepted");
        } catch (IllegalArgumentException | NullPointerException expected) {
        }
    }

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
}
