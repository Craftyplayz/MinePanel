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
        // Through item(), so a backpack worn in an accessory slot gets its contents like one in the inventory.
        List<ItemSnapshot> accessories = Accessories.worn(player).stream().map(stack -> item(minecraft, stack, icons))
                .toList();
        return InventorySnapshot.collect(
                index -> item(minecraft, inventory.getItem(index), icons),
                //? if >=26.1 {
                inventory.getSelectedSlot(),
                //?} else {
                /*inventory.selected,
                *///?}
                key -> item(minecraft, player.getItemBySlot(switch (key) {
                    case "head" -> EquipmentSlot.HEAD;
                    case "chest" -> EquipmentSlot.CHEST;
                    case "legs" -> EquipmentSlot.LEGS;
                    case "feet" -> EquipmentSlot.FEET;
                    case "offhand" -> EquipmentSlot.OFFHAND;
                    default -> throw new IllegalArgumentException("Unsupported equipment slot");
                }), icons)).withAccessories(accessories);
    }

    /** The player's own head and an ender chest, drawn beside the inventory on the dashboard. */
    static PlayerDetails.Icons icons(Minecraft minecraft, Player player, IconRenderer icons) {
        // The tab-list profile carries the skin textures; the local player's own profile may not.
        var info = minecraft.getConnection() == null ? null : minecraft.getConnection().getPlayerInfo(player.getUUID());
        //? if >=26.1 {
        var profile = ResolvableProfile.createResolved(info == null ? player.getGameProfile() : info.getProfile());
        boolean skinLoaded = minecraft.playerSkinRenderCache().lookup(profile).isDone();
        //?} else {
        /*var gameProfile = info == null ? player.getGameProfile() : info.getProfile();
        var profile = new ResolvableProfile(gameProfile);
        boolean skinLoaded = minecraft.getSkinManager().getOrLoad(gameProfile).isDone();
        *///?}
        ItemSnapshot head = null;
        // Until the skin has loaded the head renders with the default skin, and its icon would be cached that way.
        if (skinLoaded) {
            var stack = new ItemStack(Items.PLAYER_HEAD);
            stack.set(DataComponents.PROFILE, profile);
            head = item(minecraft, stack, icons);
        }
        // The signed-in account rather than the in-game profile: offline-mode servers hand out stand-in UUIDs.
        var user = minecraft.getUser();
        return new PlayerDetails.Icons(user.getName(), user.getProfileId().toString(), head,
                item(minecraft, ENDER_CHEST, icons));
    }

    /** Client thread: the dashboard value of one stack, including the contents of shulker boxes, bundles, backpacks. */
    static ItemSnapshot item(Minecraft minecraft, ItemStack stack, IconRenderer icons) {
        if (stack.isEmpty()) return ItemSnapshot.emptyItem();
        if (cacheEpoch != icons.epoch() || CACHE.size() >= MAX_CACHED) {
            CACHE.clear();
            cacheEpoch = icons.epoch();
        }
        // Backpack contents live outside the stack, so they are part of the key (by identity).
        Backpacks.Contents backpack = Backpacks.contents(stack);
        CachedStack key = new CachedStack(stack, backpack);
        ItemSnapshot cached = CACHE.get(key);
        if (cached != null) return cached;
        ItemSnapshot extracted = ItemExtractor.extract(new MinecraftItemView(minecraft, stack, icons, backpack));
        // Rendering an icon may reset the icon cache, which changes every key; do not keep a value with stale keys.
        if (cacheEpoch == icons.epoch()) CACHE.put(new CachedStack(stack.copy(), backpack), extracted);
        return extracted;
    }

    private static final ItemStack HOLDER = new ItemStack(Items.CHEST);

    /** The dashboard items of a container the player doesn't carry (a backpack elsewhere), one level deep. */
    static List<ItemSnapshot> contents(Minecraft minecraft, Backpacks.Contents contents, IconRenderer icons) {
        return ItemExtractor.extract(new MinecraftItemView(minecraft, HOLDER, icons, contents)).contents();
    }

    private static final class CachedStack {
        private final ItemStack stack;
        private final Backpacks.Contents backpack;
        private final int hash;

        CachedStack(ItemStack stack, Backpacks.Contents backpack) {
            this.stack = stack;
            this.backpack = backpack;
            hash = ItemStack.hashItemAndComponents(stack) * 31 + stack.getCount();
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof CachedStack that && hash == that.hash && stack.getCount() == that.stack.getCount()
                    && backpack == that.backpack && ItemStack.isSameItemSameComponents(stack, that.stack);
        }

        @Override
        public int hashCode() {
            return hash;
        }
    }

    /** {@code backpack} is null unless the stack is a backpack whose contents should be listed. */
    private record MinecraftItemView(Minecraft minecraft, ItemStack stack, IconRenderer icons,
                                     Backpacks.Contents backpack)
            implements ItemExtractor.ItemView {
        public boolean contentsUnknown() {
            return backpack != null && backpack.items() == null;
        }

        public List<MinecraftItemView> contents() {
            if (backpack != null && backpack.items() != null) {
                return backpack.items().stream().limit(ItemSnapshot.MAX_CONTENTS)
                        .map(inner -> new MinecraftItemView(minecraft, inner, icons, null)).toList();
            }
            ItemContainerContents container = stack.get(DataComponents.CONTAINER);
            if (container != null) {
                List<MinecraftItemView> slots = new ArrayList<>(SHULKER_SLOTS);
                //? if >=26.1 {
                container.allItemsCopyStream().limit(ItemSnapshot.MAX_CONTENTS)
                //?} else {
                /*container.stream().limit(ItemSnapshot.MAX_CONTENTS)
                *///?}
                        .forEach(inner -> slots.add(new MinecraftItemView(minecraft, inner, icons, null)));
                // Shulker boxes keep slot positions; trailing empty slots are not stored, so pad the grid.
                while (slots.size() < SHULKER_SLOTS) slots.add(new MinecraftItemView(minecraft, ItemStack.EMPTY, icons, null));
                return slots;
            }
            BundleContents bundle = stack.get(DataComponents.BUNDLE_CONTENTS);
            if (bundle != null) {
                return bundle.itemCopyStream().limit(ItemSnapshot.MAX_CONTENTS)
                        .map(inner -> new MinecraftItemView(minecraft, inner, icons, null)).toList();
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
