package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemExtractor;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import dev.craftyplayz.minepanel.telemetry.PlayerDetails;
import net.minecraft.client.Minecraft;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.component.BundleContents;
import net.minecraft.world.item.component.ItemContainerContents;
import net.minecraft.world.item.component.ResolvableProfile;
import net.minecraft.world.item.enchantment.ItemEnchantments;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.Optional;

final class MinecraftInventoryCollector {
    private static final int SHULKER_SLOTS = 27;
    private static final int MAX_CACHED = 1024;
    /** Extracted items by stack (item, components and count): tooltips are costly and most stacks rarely change. */
    private static final Map<CachedStack, ItemSnapshot> CACHE = new HashMap<>();
    private static int cacheEpoch = -1;
    private static final ItemStack ENDER_CHEST = new ItemStack(Items.ENDER_CHEST);

    private MinecraftInventoryCollector() {
    }

    static InventorySnapshot collect(Minecraft minecraft, Player player, IconRenderer icons) {
        var inventory = player.getInventory();
        return InventorySnapshot.collect(
                index -> item(minecraft, inventory.getItem(index), icons),
                inventory.getSelectedSlot(),
                key -> item(minecraft, player.getItemBySlot(switch (key) {
                    case "head" -> EquipmentSlot.HEAD;
                    case "chest" -> EquipmentSlot.CHEST;
                    case "legs" -> EquipmentSlot.LEGS;
                    case "feet" -> EquipmentSlot.FEET;
                    case "offhand" -> EquipmentSlot.OFFHAND;
                    default -> throw new IllegalArgumentException("Unsupported equipment slot");
                }), icons));
    }

    /** The player's own head and an ender chest, drawn beside the inventory on the dashboard. */
    static PlayerDetails.Icons icons(Minecraft minecraft, Player player, IconRenderer icons) {
        // The tab-list profile carries the skin textures; the local player's own profile may not.
        var info = minecraft.getConnection() == null ? null : minecraft.getConnection().getPlayerInfo(player.getUUID());
        var profile = ResolvableProfile.createResolved(info == null ? player.getGameProfile() : info.getProfile());
        ItemSnapshot head = null;
        // Until the skin has loaded the head renders with the default skin, and its icon would be cached that way.
        if (minecraft.playerSkinRenderCache().lookup(profile).isDone()) {
            var stack = new ItemStack(Items.PLAYER_HEAD);
            stack.set(DataComponents.PROFILE, profile);
            head = item(minecraft, stack, icons);
        }
        return new PlayerDetails.Icons(head, item(minecraft, ENDER_CHEST, icons));
    }

    /** Client thread: the dashboard value of one stack, including the contents of shulker boxes and bundles. */
    static ItemSnapshot item(Minecraft minecraft, ItemStack stack, IconRenderer icons) {
        if (stack.isEmpty()) return ItemSnapshot.emptyItem();
        if (cacheEpoch != icons.epoch() || CACHE.size() >= MAX_CACHED) {
            CACHE.clear();
            cacheEpoch = icons.epoch();
        }
        CachedStack key = new CachedStack(stack);
        ItemSnapshot cached = CACHE.get(key);
        if (cached != null) return cached;
        ItemSnapshot extracted = ItemExtractor.extract(new MinecraftItemView(minecraft, stack, icons));
        // Rendering an icon may reset the icon cache, which changes every key; do not keep a value with stale keys.
        if (cacheEpoch == icons.epoch()) CACHE.put(new CachedStack(stack.copy()), extracted);
        return extracted;
    }

    private static final class CachedStack {
        private final ItemStack stack;
        private final int hash;

        CachedStack(ItemStack stack) {
            this.stack = stack;
            hash = ItemStack.hashItemAndComponents(stack) * 31 + stack.getCount();
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof CachedStack that && hash == that.hash && stack.getCount() == that.stack.getCount()
                    && ItemStack.isSameItemSameComponents(stack, that.stack);
        }

        @Override
        public int hashCode() {
            return hash;
        }
    }

    private record MinecraftItemView(Minecraft minecraft, ItemStack stack, IconRenderer icons)
            implements ItemExtractor.ItemView {
        public List<MinecraftItemView> contents() {
            ItemContainerContents container = stack.get(DataComponents.CONTAINER);
            if (container != null) {
                List<MinecraftItemView> slots = new ArrayList<>(SHULKER_SLOTS);
                container.allItemsCopyStream().limit(ItemSnapshot.MAX_CONTENTS)
                        .forEach(inner -> slots.add(new MinecraftItemView(minecraft, inner, icons)));
                // Shulker boxes keep slot positions; trailing empty slots are not stored, so pad the grid.
                while (slots.size() < SHULKER_SLOTS) slots.add(new MinecraftItemView(minecraft, ItemStack.EMPTY, icons));
                return slots;
            }
            BundleContents bundle = stack.get(DataComponents.BUNDLE_CONTENTS);
            if (bundle != null) {
                return bundle.itemCopyStream().limit(ItemSnapshot.MAX_CONTENTS)
                        .map(inner -> new MinecraftItemView(minecraft, inner, icons)).toList();
            }
            return null;
        }

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
