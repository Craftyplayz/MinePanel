package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.ItemEnchantments;

import java.util.ArrayList;
import java.util.Map;
import java.util.TreeMap;

final class MinecraftInventoryCollector {
    private MinecraftInventoryCollector() {
    }

    static InventorySnapshot collect(Player player) {
        var inventory = player.getInventory();
        return InventorySnapshot.collect(
                index -> snapshotItem(inventory.getItem(index)),
                inventory.getSelectedSlot(),
                key -> snapshotItem(player.getItemBySlot(switch (key) {
                    case "head" -> EquipmentSlot.HEAD;
                    case "chest" -> EquipmentSlot.CHEST;
                    case "legs" -> EquipmentSlot.LEGS;
                    case "feet" -> EquipmentSlot.FEET;
                    case "offhand" -> EquipmentSlot.OFFHAND;
                    default -> throw new IllegalArgumentException("Unsupported equipment slot");
                })));
    }

    private static ItemSnapshot snapshotItem(ItemStack stack) {
        if (stack.isEmpty()) {
            return ItemSnapshot.emptyItem();
        }
        Map<String, ItemSnapshot.Enchantment> enchantments = new TreeMap<>();
        collectEnchantments(stack.getOrDefault(DataComponents.ENCHANTMENTS, ItemEnchantments.EMPTY), enchantments);
        collectEnchantments(stack.getOrDefault(DataComponents.STORED_ENCHANTMENTS, ItemEnchantments.EMPTY), enchantments);
        boolean damageable = stack.isDamageableItem();
        return new ItemSnapshot(false, BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
                readableText(stack.getHoverName().getString()), stack.getCount(), stack.getMaxStackSize(),
                damageable ? stack.getDamageValue() : null, damageable ? stack.getMaxDamage() : null,
                new ArrayList<>(enchantments.values()));
    }

    private static void collectEnchantments(ItemEnchantments source,
                                            Map<String, ItemSnapshot.Enchantment> target) {
        if (source.keySet().size() > ItemSnapshot.MAX_ENCHANTMENTS) {
            throw new IllegalArgumentException("Too many enchantments");
        }
        for (var holder : source.keySet()) {
            String id = holder.unwrapKey().orElseThrow().identifier().toString();
            var enchantment = new ItemSnapshot.Enchantment(id,
                    readableText(holder.value().description().getString()), source.getLevel(holder));
            target.merge(id, enchantment, (first, second) -> first.level() >= second.level() ? first : second);
            if (target.size() > ItemSnapshot.MAX_ENCHANTMENTS) {
                throw new IllegalArgumentException("Too many enchantments");
            }
        }
    }

    private static String readableText(String text) {
        StringBuilder result = new StringBuilder(ItemSnapshot.MAX_TEXT_LENGTH);
        for (int index = 0; index < text.length() && result.length() < ItemSnapshot.MAX_TEXT_LENGTH;) {
            int point = text.codePointAt(index);
            index += Character.charCount(point);
            if (point >= Character.MIN_SURROGATE && point <= Character.MAX_SURROGATE) {
                point = 0xfffd;
            } else if (Character.isISOControl(point)) {
                point = ' ';
            }
            if (result.length() + Character.charCount(point) > ItemSnapshot.MAX_TEXT_LENGTH) {
                break;
            }
            result.appendCodePoint(point);
        }
        return result.isEmpty() ? "Unnamed" : result.toString();
    }
}
