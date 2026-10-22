package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.IntFunction;

/**
 * The player's inventory: 36 slots, the selected hotbar slot, worn equipment, and {@code accessories}: non-empty items
 * in a mod's extra slots (Curios on NeoForge), in slot order, at most {@value #MAX_ACCESSORIES}.
 */
public record InventorySnapshot(List<ItemSnapshot> slots, int selectedHotbarSlot,
                                Map<String, ItemSnapshot> equipment, List<ItemSnapshot> accessories) {
    public static final int SLOT_COUNT = 36;
    public static final int MAX_ACCESSORIES = 32;
    public static final List<String> EQUIPMENT_KEYS = List.of("head", "chest", "legs", "feet", "offhand", "mainhand");

    public InventorySnapshot {
        Objects.requireNonNull(slots, "slots");
        Objects.requireNonNull(equipment, "equipment");
        Objects.requireNonNull(accessories, "accessories");
        if (accessories.size() > MAX_ACCESSORIES || accessories.stream().anyMatch(ItemSnapshot::empty)) {
            throw new IllegalArgumentException("at most " + MAX_ACCESSORIES + " accessories, none empty");
        }
        accessories = List.copyOf(accessories);
        if (slots.size() != SLOT_COUNT || selectedHotbarSlot < 0 || selectedHotbarSlot > 8
                || !equipment.keySet().equals(java.util.Set.copyOf(EQUIPMENT_KEYS))) {
            throw new IllegalArgumentException("inventory requires 36 slots, a hotbar selection and exactly six equipment keys");
        }
        slots = List.copyOf(slots);
        Map<String, ItemSnapshot> copiedEquipment = new LinkedHashMap<>();
        for (String key : EQUIPMENT_KEYS) {
            copiedEquipment.put(key, Objects.requireNonNull(equipment.get(key), key));
        }
        equipment = Collections.unmodifiableMap(copiedEquipment);
        if (!slots.get(selectedHotbarSlot).equals(equipment.get("mainhand"))) {
            throw new IllegalArgumentException("mainhand must match the selected inventory slot");
        }
    }

    public InventorySnapshot(List<ItemSnapshot> slots, int selectedHotbarSlot, Map<String, ItemSnapshot> equipment) {
        this(slots, selectedHotbarSlot, equipment, List.of());
    }

    public InventorySnapshot withAccessories(List<ItemSnapshot> worn) {
        return new InventorySnapshot(slots, selectedHotbarSlot, equipment, worn);
    }

    public static InventorySnapshot empty() {
        return collect(index -> ItemSnapshot.emptyItem(), 0, key -> ItemSnapshot.emptyItem());
    }

    public static InventorySnapshot collect(IntFunction<ItemSnapshot> slots, int selectedHotbarSlot,
                                            Function<String, ItemSnapshot> equipment) {
        Objects.requireNonNull(slots, "slots");
        Objects.requireNonNull(equipment, "equipment");
        if (selectedHotbarSlot < 0 || selectedHotbarSlot > 8) {
            throw new IllegalArgumentException("selected slot must be in the hotbar");
        }
        List<ItemSnapshot> copiedSlots = new ArrayList<>(SLOT_COUNT);
        for (int index = 0; index < SLOT_COUNT; index++) {
            copiedSlots.add(Objects.requireNonNull(slots.apply(index), "slot"));
        }
        Map<String, ItemSnapshot> copiedEquipment = new LinkedHashMap<>();
        for (String key : EQUIPMENT_KEYS) {
            copiedEquipment.put(key, key.equals("mainhand")
                    ? copiedSlots.get(selectedHotbarSlot) : equipment.apply(key));
        }
        return new InventorySnapshot(copiedSlots, selectedHotbarSlot, copiedEquipment);
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"slots\":[");
        for (int index = 0; index < SLOT_COUNT; index++) {
            if (index > 0) json.append(',');
            json.append(slots.get(index).toJson());
        }
        json.append("],\"selectedHotbarSlot\":").append(selectedHotbarSlot).append(",\"equipment\":{");
        for (int index = 0; index < EQUIPMENT_KEYS.size(); index++) {
            if (index > 0) json.append(',');
            String key = EQUIPMENT_KEYS.get(index);
            json.append('"').append(key).append("\":").append(equipment.get(key).toJson());
        }
        json.append("},\"accessories\":");
        appendItems(json, accessories);
        return json.append('}').toString();
    }

    private static void appendItems(StringBuilder json, List<ItemSnapshot> items) {
        json.append('[');
        for (int index = 0; index < items.size(); index++) {
            if (index > 0) json.append(',');
            json.append(items.get(index).toJson());
        }
        json.append(']');
    }

    public String toDeltaJson(InventorySnapshot previous) {
        if (previous == null) return toJson();
        StringBuilder changedSlots = new StringBuilder();
        for (int index = 0; index < SLOT_COUNT; index++) {
            if (!slots.get(index).equals(previous.slots.get(index))) {
                if (!changedSlots.isEmpty()) changedSlots.append(',');
                changedSlots.append("{\"index\":").append(index).append(",\"item\":")
                        .append(slots.get(index).toJson()).append('}');
            }
        }
        StringBuilder json = new StringBuilder("{");
        if (!changedSlots.isEmpty()) json.append("\"slots\":[").append(changedSlots).append(']');
        if (selectedHotbarSlot != previous.selectedHotbarSlot) {
            if (json.length() > 1) json.append(',');
            json.append("\"selectedHotbarSlot\":").append(selectedHotbarSlot);
        }
        StringBuilder changedEquipment = new StringBuilder();
        for (String key : EQUIPMENT_KEYS) {
            if (!equipment.get(key).equals(previous.equipment.get(key))) {
                if (!changedEquipment.isEmpty()) changedEquipment.append(',');
                changedEquipment.append('"').append(key).append("\":").append(equipment.get(key).toJson());
            }
        }
        if (!changedEquipment.isEmpty()) {
            if (json.length() > 1) json.append(',');
            json.append("\"equipment\":{").append(changedEquipment).append('}');
        }
        if (!accessories.equals(previous.accessories)) {
            if (json.length() > 1) json.append(',');
            json.append("\"accessories\":");
            appendItems(json, accessories);
        }
        return json.append('}').toString();
    }
}
