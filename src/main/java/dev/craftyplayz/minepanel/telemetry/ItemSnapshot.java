package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

public record ItemSnapshot(boolean empty, String itemId, String name, int count, int maxCount,
                           Integer damage, Integer maxDamage, List<Enchantment> enchantments,
                           String icon, boolean foil, List<List<TooltipSegment>> tooltip,
                           List<ItemSnapshot> contents, boolean contentsUnknown) {
    public static final int MAX_TEXT_LENGTH = 256;
    /** Shulker boxes hold 27 slots; bundles hold at most 64 separate stacks. */
    public static final int MAX_CONTENTS = 128;
    public static final int MAX_COUNT = 1_000_000;
    public static final int MAX_ENCHANTMENTS = 64;
    public static final int MAX_ENCHANTMENT_LEVEL = 255;
    public static final int MAX_TOOLTIP_LINES = 64;
    public static final int MAX_TOOLTIP_SEGMENTS = 32;
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    private static final Pattern ICON = Pattern.compile("[a-z0-9-]{1,64}");
    private static final Pattern COLOR = Pattern.compile("#[0-9a-f]{6}");
    private static final Pattern FORMAT = Pattern.compile("b?i?s?u?o?");
    private static final ItemSnapshot EMPTY = new ItemSnapshot(true, null, null, 0, 0, null, null, List.of());

    public ItemSnapshot(boolean empty, String itemId, String name, int count, int maxCount,
                        Integer damage, Integer maxDamage, List<Enchantment> enchantments) {
        this(empty, itemId, name, count, maxCount, damage, maxDamage, enchantments, null, false, List.of());
    }

    public ItemSnapshot(boolean empty, String itemId, String name, int count, int maxCount,
                        Integer damage, Integer maxDamage, List<Enchantment> enchantments,
                        String icon, boolean foil, List<List<TooltipSegment>> tooltip) {
        this(empty, itemId, name, count, maxCount, damage, maxDamage, enchantments, icon, foil, tooltip, null);
    }

    public ItemSnapshot(boolean empty, String itemId, String name, int count, int maxCount,
                        Integer damage, Integer maxDamage, List<Enchantment> enchantments,
                        String icon, boolean foil, List<List<TooltipSegment>> tooltip, List<ItemSnapshot> contents) {
        this(empty, itemId, name, count, maxCount, damage, maxDamage, enchantments, icon, foil, tooltip, contents,
                false);
    }

    /**
     * {@code contents} is null for items that hold nothing; for shulker boxes, bundles and backpacks it lists the held
     * items (shulker slots in order, including empty ones). Nested containers are listed without their own contents.
     * {@code contentsUnknown} marks a backpack whose contents MinePanel has not seen yet; its contents list is empty.
     */
    public ItemSnapshot {
        Objects.requireNonNull(enchantments, "enchantments");
        Objects.requireNonNull(tooltip, "tooltip");
        if (enchantments.size() > MAX_ENCHANTMENTS) {
            throw new IllegalArgumentException("too many enchantments");
        }
        enchantments = List.copyOf(enchantments);
        if (tooltip.size() > MAX_TOOLTIP_LINES) {
            throw new IllegalArgumentException("too many tooltip lines");
        }
        List<List<TooltipSegment>> copiedTooltip = new ArrayList<>(tooltip.size());
        for (List<TooltipSegment> line : tooltip) {
            if (line.size() > MAX_TOOLTIP_SEGMENTS) {
                throw new IllegalArgumentException("too many tooltip segments");
            }
            copiedTooltip.add(List.copyOf(line));
        }
        tooltip = List.copyOf(copiedTooltip);
        if (contents != null) {
            if (contents.size() > MAX_CONTENTS) throw new IllegalArgumentException("too many contained items");
            for (ItemSnapshot inner : contents) {
                if (Objects.requireNonNull(inner, "contained item").contents() != null) {
                    throw new IllegalArgumentException("contained items cannot list their own contents");
                }
            }
            contents = List.copyOf(contents);
        }
        if (contentsUnknown && (contents == null || !contents.isEmpty())) {
            throw new IllegalArgumentException("unknown contents must be an empty list");
        }
        if (empty) {
            if (itemId != null || name != null || count != 0 || maxCount != 0
                    || damage != null || maxDamage != null || !enchantments.isEmpty()
                    || icon != null || foil || !tooltip.isEmpty() || contents != null) {
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
            if (icon != null && !ICON.matcher(icon).matches()) {
                throw new IllegalArgumentException("icon key must be a short lowercase token");
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
        json.append("],\"icon\":").append(PlayerSnapshot.string(icon))
                .append(",\"foil\":").append(foil).append(",\"tooltip\":[");
        for (int line = 0; line < tooltip.size(); line++) {
            if (line > 0) json.append(',');
            json.append('[');
            List<TooltipSegment> segments = tooltip.get(line);
            for (int index = 0; index < segments.size(); index++) {
                if (index > 0) json.append(',');
                json.append(segments.get(index).toJson());
            }
            json.append(']');
        }
        json.append("],\"contentsUnknown\":").append(contentsUnknown).append(",\"contents\":");
        if (contents == null) return json.append("null}").toString();
        json.append('[');
        for (int index = 0; index < contents.size(); index++) {
            if (index > 0) json.append(',');
            json.append(contents.get(index).toJson());
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

    /** One styled run of tooltip text; format letters are bold, italic, strikethrough, underlined, obfuscated. */
    public record TooltipSegment(String text, String color, String format) {
        public TooltipSegment {
            validateText(text);
            Objects.requireNonNull(format, "format");
            if (color != null && !COLOR.matcher(color).matches() || !FORMAT.matcher(format).matches()) {
                throw new IllegalArgumentException("tooltip style must be a hex color and known format letters");
            }
        }

        public String toJson() {
            return "{\"text\":" + PlayerSnapshot.string(text) + ",\"color\":" + PlayerSnapshot.string(color)
                    + ",\"format\":" + PlayerSnapshot.string(format) + "}";
        }
    }
}
