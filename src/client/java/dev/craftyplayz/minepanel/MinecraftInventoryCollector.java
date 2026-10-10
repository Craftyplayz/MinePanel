package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemExtractor;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.ItemEnchantments;

final class MinecraftInventoryCollector {
    private MinecraftInventoryCollector() {
    }

    static InventorySnapshot collect(Player player) {
        var inventory = player.getInventory();
        return ItemExtractor.collect(
                index -> new MinecraftItemView(inventory.getItem(index)),
                inventory.getSelectedSlot(),
                key -> new MinecraftItemView(player.getItemBySlot(switch (key) {
                    case "head" -> EquipmentSlot.HEAD;
                    case "chest" -> EquipmentSlot.CHEST;
                    case "legs" -> EquipmentSlot.LEGS;
                    case "feet" -> EquipmentSlot.FEET;
                    case "offhand" -> EquipmentSlot.OFFHAND;
                    default -> throw new IllegalArgumentException("Unsupported equipment slot");
                })));
    }

    private record MinecraftItemView(ItemStack stack) implements ItemExtractor.ItemView {
        public boolean isEmpty() { return stack.isEmpty(); }
        public String itemId() { return BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(); }
        public String name() { return stack.getHoverName().getString(); }
        public int count() { return stack.getCount(); }
        public int maxCount() { return stack.getMaxStackSize(); }
        public boolean isDamageable() { return stack.isDamageableItem(); }
        public int damage() { return stack.getDamageValue(); }
        public int maxDamage() { return stack.getMaxDamage(); }

        public Iterable<ItemExtractor.EnchantmentView> appliedEnchantments() {
            return enchantments(stack.getOrDefault(DataComponents.ENCHANTMENTS, ItemEnchantments.EMPTY));
        }

        public Iterable<ItemExtractor.EnchantmentView> storedEnchantments() {
            return enchantments(stack.getOrDefault(DataComponents.STORED_ENCHANTMENTS, ItemEnchantments.EMPTY));
        }
    }

    private static Iterable<ItemExtractor.EnchantmentView> enchantments(ItemEnchantments source) {
        return () -> source.keySet().stream().map(holder -> new ItemExtractor.EnchantmentView(
                holder.unwrapKey().orElseThrow().identifier().toString(),
                holder.value().description().getString(), source.getLevel(holder))).iterator();
    }
}
