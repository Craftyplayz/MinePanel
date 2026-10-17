package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * What the 3D render panel draws: the player's skin, the armor layers they wear and the items in each hand.
 * {@code skin} and layer {@code texture} values are texture keys the dashboard loads from {@code /texture/<key>.png};
 * held items reuse inventory icon keys ({@code /icon/<key>.png}). {@code skin} is null when the skin can't be read.
 * Enchantment glint is never part of a texture or icon.
 */
public record Appearance(String skin, boolean slim, List<ArmorLayer> armor, Held rightHand, Held leftHand) {
    public static final int MAX_LAYERS = 16;
    public static final List<String> SLOTS = List.of("head", "chest", "legs", "feet");
    /** The armor models a layer is drawn on, named as the game's equipment layer types. */
    public static final List<String> MODELS = List.of("humanoid", "humanoid_leggings", "wings");
    public static final Appearance EMPTY = new Appearance(null, false, List.of(), null, null);
    private static final Pattern KEY = Pattern.compile("[a-z0-9-]{1,64}");
    private static final Pattern COLOR = Pattern.compile("#[0-9a-f]{6}");

    public Appearance {
        Objects.requireNonNull(armor, "armor");
        if (skin != null && !KEY.matcher(skin).matches() || armor.size() > MAX_LAYERS) {
            throw new IllegalArgumentException("Invalid appearance");
        }
        armor = List.copyOf(armor);
    }

    /**
     * One textured layer of worn armor, drawn on {@code model}'s parts for {@code slot}; {@code color} tints it
     * (dyed leather), or is null for an untinted layer.
     */
    public record ArmorLayer(String slot, String model, String texture, String color) {
        public ArmorLayer {
            if (!SLOTS.contains(slot) || !MODELS.contains(model) || texture == null || !KEY.matcher(texture).matches()
                    || color != null && !COLOR.matcher(color).matches()) {
                throw new IllegalArgumentException("Invalid armor layer");
            }
        }

        String toJson() {
            return "{\"slot\":" + PlayerSnapshot.string(slot) + ",\"model\":" + PlayerSnapshot.string(model)
                    + ",\"texture\":" + PlayerSnapshot.string(texture) + ",\"color\":" + PlayerSnapshot.string(color)
                    + "}";
        }
    }

    /**
     * An item held in one hand: its icon, whether the icon is a flat sprite (rather than a drawing of a block), and
     * the item model's third-person display transform for that hand, already mirrored for the left hand as the game
     * mirrors it. Rotation is in degrees (applied X, then Y, then Z as the game does), translation in model pixels.
     */
    public record Held(String icon, boolean flat, double rotationX, double rotationY, double rotationZ,
                       double translationX, double translationY, double translationZ,
                       double scaleX, double scaleY, double scaleZ) {
        public Held {
            if (icon == null || !KEY.matcher(icon).matches()) throw new IllegalArgumentException("Invalid held item");
            for (double value : new double[] {rotationX, rotationY, rotationZ, translationX, translationY, translationZ,
                    scaleX, scaleY, scaleZ}) {
                if (!Double.isFinite(value) || Math.abs(value) > 1000) throw new IllegalArgumentException("Invalid held item");
            }
        }

        /** Rounds the transform so float noise doesn't resend an unchanged item. */
        public static Held rounded(String icon, boolean flat, double[] rotation, double[] translation, double[] scale) {
            return new Held(icon, flat, round(rotation[0]), round(rotation[1]), round(rotation[2]),
                    round(translation[0]), round(translation[1]), round(translation[2]),
                    round(scale[0]), round(scale[1]), round(scale[2]));
        }

        private static double round(double value) {
            double rounded = Math.round(value * 1000) / 1000.0;
            return rounded == 0 ? 0 : rounded;
        }

        String toJson() {
            return "{\"icon\":" + PlayerSnapshot.string(icon) + ",\"flat\":" + flat
                    + ",\"rotation\":[" + rotationX + "," + rotationY + "," + rotationZ + "]"
                    + ",\"translation\":[" + translationX + "," + translationY + "," + translationZ + "]"
                    + ",\"scale\":[" + scaleX + "," + scaleY + "," + scaleZ + "]}";
        }
    }

    String toJson() {
        StringBuilder json = new StringBuilder("{\"skin\":").append(PlayerSnapshot.string(skin))
                .append(",\"slim\":").append(slim).append(",\"armor\":[");
        for (int index = 0; index < armor.size(); index++) {
            if (index > 0) json.append(',');
            json.append(armor.get(index).toJson());
        }
        return json.append("],\"rightHand\":").append(rightHand == null ? "null" : rightHand.toJson())
                .append(",\"leftHand\":").append(leftHand == null ? "null" : leftHand.toJson()).append('}').toString();
    }
}
