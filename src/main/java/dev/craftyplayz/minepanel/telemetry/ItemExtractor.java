package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.function.IntFunction;

/** Copies read-only live item metadata into bounded, immutable telemetry values. */
public final class ItemExtractor {
    private ItemExtractor() {
    }

    public interface ItemView {
        boolean isEmpty();
        String itemId();
        String name();
        int count();
        int maxCount();
        boolean isDamageable();
        int damage();
        int maxDamage();
        Iterable<EnchantmentView> appliedEnchantments();
        Iterable<EnchantmentView> storedEnchantments();
    }

    public record EnchantmentView(String id, String name, int level) {
    }

    public static InventorySnapshot collect(IntFunction<? extends ItemView> slots, int selectedHotbarSlot,
                                            Function<String, ? extends ItemView> equipment) {
        Objects.requireNonNull(slots, "slots");
        Objects.requireNonNull(equipment, "equipment");
        return InventorySnapshot.collect(index -> extract(slots.apply(index)), selectedHotbarSlot,
                key -> extract(equipment.apply(key)));
    }

    public static ItemSnapshot extract(ItemView item) {
        Objects.requireNonNull(item, "item");
        if (item.isEmpty()) {
            return ItemSnapshot.emptyItem();
        }
        Map<String, ItemSnapshot.Enchantment> enchantments = new TreeMap<>();
        collectEnchantments(item.appliedEnchantments(), enchantments);
        collectEnchantments(item.storedEnchantments(), enchantments);
        boolean damageable = item.isDamageable();
        return new ItemSnapshot(false, item.itemId(), readableText(item.name()), item.count(), item.maxCount(),
                damageable ? item.damage() : null, damageable ? item.maxDamage() : null,
                new ArrayList<>(enchantments.values()));
    }

    private static void collectEnchantments(Iterable<EnchantmentView> source,
                                             Map<String, ItemSnapshot.Enchantment> target) {
        int count = 0;
        for (EnchantmentView entry : source) {
            if (++count > ItemSnapshot.MAX_ENCHANTMENTS) {
                throw new IllegalArgumentException("Too many enchantments");
            }
            var enchantment = new ItemSnapshot.Enchantment(entry.id(), readableText(entry.name()), entry.level());
            target.merge(entry.id(), enchantment,
                    (first, second) -> first.level() >= second.level() ? first : second);
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
