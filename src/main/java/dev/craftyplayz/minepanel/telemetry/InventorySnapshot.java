package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.IntFunction;

public record InventorySnapshot(List<ItemSnapshot> slots, int selectedHotbarSlot,
                                Map<String, ItemSnapshot> equipment) {
    public static final int SLOT_COUNT = 36;
    public static final List<String> EQUIPMENT_KEYS = List.of("head", "chest", "legs", "feet", "offhand", "mainhand");

    public InventorySnapshot {
        Objects.requireNonNull(slots, "slots");
        Objects.requireNonNull(equipment, "equipment");
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
        return json.append("}}").toString();
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
        return json.append('}').toString();
    }
}
