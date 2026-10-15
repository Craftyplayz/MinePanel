package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemExtractor;
import net.minecraft.client.Minecraft;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.enchantment.ItemEnchantments;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

final class MinecraftInventoryCollector {
    private MinecraftInventoryCollector() {
    }

    static InventorySnapshot collect(Minecraft minecraft, Player player, IconRenderer icons) {
        var inventory = player.getInventory();
        return ItemExtractor.collect(
                index -> new MinecraftItemView(minecraft, inventory.getItem(index), icons),
                inventory.getSelectedSlot(),
                key -> new MinecraftItemView(minecraft, player.getItemBySlot(switch (key) {
                    case "head" -> EquipmentSlot.HEAD;
                    case "chest" -> EquipmentSlot.CHEST;
                    case "legs" -> EquipmentSlot.LEGS;
                    case "feet" -> EquipmentSlot.FEET;
                    case "offhand" -> EquipmentSlot.OFFHAND;
                    default -> throw new IllegalArgumentException("Unsupported equipment slot");
                }), icons));
    }

    private record MinecraftItemView(Minecraft minecraft, ItemStack stack, IconRenderer icons)
            implements ItemExtractor.ItemView {
        public boolean isEmpty() { return stack.isEmpty(); }
        public String itemId() { return BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(); }
        public String name() { return stack.getHoverName().getString(); }
        public int count() { return stack.getCount(); }
        public int maxCount() { return stack.getMaxStackSize(); }
        public boolean isDamageable() { return stack.isDamageableItem(); }
        public int damage() { return stack.getDamageValue(); }
        public int maxDamage() { return stack.getMaxDamage(); }
        public boolean foil() { return stack.hasFoil(); }

        public String iconKey() {
            String key = icons.keyFor(stack);
            icons.request(key, stack);
            return key;
        }

        public Iterable<ItemExtractor.EnchantmentView> appliedEnchantments() {
            return enchantments(stack.getOrDefault(DataComponents.ENCHANTMENTS, ItemEnchantments.EMPTY));
        }

        public Iterable<ItemExtractor.EnchantmentView> storedEnchantments() {
            return enchantments(stack.getOrDefault(DataComponents.STORED_ENCHANTMENTS, ItemEnchantments.EMPTY));
        }

        /** The same lines the game shows on hover with advanced tooltips (F3+H) enabled. */
        public List<List<ItemExtractor.TooltipSegmentView>> tooltip() {
            List<Component> lines = stack.getTooltipLines(Item.TooltipContext.of(minecraft.level), minecraft.player,
                    TooltipFlag.Default.ADVANCED);
            List<List<ItemExtractor.TooltipSegmentView>> result = new ArrayList<>(lines.size());
            for (Component line : lines) {
                List<ItemExtractor.TooltipSegmentView> segments = new ArrayList<>();
                line.visit((style, text) -> {
                    segments.add(new ItemExtractor.TooltipSegmentView(text,
                            style.getColor() == null ? null : style.getColor().getValue(), format(style)));
                    return Optional.empty();
                }, Style.EMPTY);
                result.add(segments);
            }
            return result;
        }
    }

    private static String format(Style style) {
        return (style.isBold() ? "b" : "") + (style.isItalic() ? "i" : "") + (style.isStrikethrough() ? "s" : "")
                + (style.isUnderlined() ? "u" : "") + (style.isObfuscated() ? "o" : "");
    }

    private static Iterable<ItemExtractor.EnchantmentView> enchantments(ItemEnchantments source) {
        return () -> source.keySet().stream().map(holder -> new ItemExtractor.EnchantmentView(
                holder.unwrapKey().orElseThrow().identifier().toString(),
                holder.value().description().getString(), source.getLevel(holder))).iterator();
    }
}
