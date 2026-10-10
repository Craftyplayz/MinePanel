package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

public record ItemSnapshot(boolean empty, String itemId, String name, int count, int maxCount,
                           Integer damage, Integer maxDamage, List<Enchantment> enchantments) {
    public static final int MAX_TEXT_LENGTH = 256;
    public static final int MAX_COUNT = 1_000_000;
    public static final int MAX_ENCHANTMENTS = 64;
    public static final int MAX_ENCHANTMENT_LEVEL = 255;
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final ItemSnapshot EMPTY = new ItemSnapshot(true, null, null, 0, 0, null, null, List.of());

    public ItemSnapshot {
        Objects.requireNonNull(enchantments, "enchantments");
        if (enchantments.size() > MAX_ENCHANTMENTS) {
            throw new IllegalArgumentException("too many enchantments");
        }
        enchantments = List.copyOf(enchantments);
        if (empty) {
            if (itemId != null || name != null || count != 0 || maxCount != 0
                    || damage != null || maxDamage != null || !enchantments.isEmpty()) {
                throw new IllegalArgumentException("empty item metadata must be explicitly absent");
            }
        } else {
            validateIdentifier(itemId);
            validateText(name);
            if (count <= 0 || count > MAX_COUNT || maxCount <= 0 || maxCount > MAX_COUNT) {
                throw new IllegalArgumentException("item counts must be positive and bounded");
            }
            if ((damage == null) != (maxDamage == null)
                    || (damage != null && (damage < 0 || maxDamage <= 0 || damage > maxDamage))) {
                throw new IllegalArgumentException("durability must be absent or within its maximum");
            }
        }
    }

    public static ItemSnapshot emptyItem() {
        return EMPTY;
    }

    public Integer remainingDurability() {
        return damage == null ? null : maxDamage - damage;
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"empty\":").append(empty)
                .append(",\"itemId\":").append(PlayerSnapshot.string(itemId))
                .append(",\"name\":").append(PlayerSnapshot.string(name))
                .append(",\"count\":").append(count).append(",\"maxCount\":").append(maxCount)
                .append(",\"damage\":").append(damage).append(",\"maxDamage\":").append(maxDamage)
                .append(",\"remainingDurability\":").append(remainingDurability())
                .append(",\"enchantments\":[");
        for (int index = 0; index < enchantments.size(); index++) {
            if (index > 0) json.append(',');
            json.append(enchantments.get(index).toJson());
        }
        return json.append("]}").toString();
    }

    private static void validateIdentifier(String value) {
        validateText(value);
        if (!IDENTIFIER.matcher(value).matches()) {
            throw new IllegalArgumentException("identifier must be namespaced");
        }
    }

    private static void validateText(String value) {
        Objects.requireNonNull(value, "text");
        if (value.isEmpty() || value.length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("text must be nonempty and bounded");
        }
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (Character.isHighSurrogate(character)) {
                if (++index == value.length() || !Character.isLowSurrogate(value.charAt(index))) {
                    throw new IllegalArgumentException("text must contain valid Unicode");
                }
            } else if (Character.isLowSurrogate(character)) {
                throw new IllegalArgumentException("text must contain valid Unicode");
            }
        }
    }

    public record Enchantment(String id, String name, int level) {
        public Enchantment {
            validateIdentifier(id);
            validateText(name);
            if (level <= 0 || level > MAX_ENCHANTMENT_LEVEL) {
                throw new IllegalArgumentException("enchantment level must be positive and bounded");
            }
        }

        public String toJson() {
            return "{\"id\":" + PlayerSnapshot.string(id) + ",\"name\":" + PlayerSnapshot.string(name)
                    + ",\"level\":" + level + "}";
        }
    }
}
