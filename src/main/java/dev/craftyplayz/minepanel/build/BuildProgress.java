package dev.craftyplayz.minepanel.build;

import dev.craftyplayz.minepanel.telemetry.PlayerSnapshot;

import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * The {@code build} snapshot field: progress of the schematic placement selected in Litematica.
 * {@code reason} explains a missing placement: {@code missing}, {@code version} or {@code error} when the integration
 * is unavailable, {@code none} when nothing is selected and {@code counting} while the schematic's blocks are counted.
 */
public record BuildProgress(boolean available, String reason, Placement placement, List<Material> materials) {
    public static final int MAX_MATERIALS = 128;
    public static final int MAX_TEXT_LENGTH = 256;
    public static final Set<String> UNAVAILABLE_REASONS = Set.of("missing", "version", "error");
    public static final Set<String> EMPTY_REASONS = Set.of("none", "counting");
    public static final BuildProgress MISSING = unavailable("missing");
    public static final BuildProgress NO_PLACEMENT = new BuildProgress(true, "none", null, List.of());

    public BuildProgress {
        materials = List.copyOf(materials);
        if (available) {
            if (placement == null ? !EMPTY_REASONS.contains(reason) : reason != null) {
                throw new IllegalArgumentException("a placement or a known reason is required");
            }
        } else if (!UNAVAILABLE_REASONS.contains(reason) || placement != null) {
            throw new IllegalArgumentException("unavailable progress needs a known reason and no placement");
        }
        if ((placement == null && !materials.isEmpty()) || materials.size() > MAX_MATERIALS) {
            throw new IllegalArgumentException("materials need a placement and are bounded");
        }
    }

    public static BuildProgress unavailable(String reason) {
        return new BuildProgress(false, reason, null, List.of());
    }

    /**
     * Counts for one placement. {@code placed}, {@code wrong} and the rest of {@code total} (missing or unchecked) are
     * schematic blocks; {@code extra} counts positions where the schematic has air but the world does not.
     */
    public record Placement(String id, String name, long total, long placed, long wrong, long extra,
                            int uncheckedChunks, boolean scanComplete, long checkedAt) {
        public Placement {
            text(id);
            text(name);
            if (total < 0 || placed < 0 || wrong < 0 || extra < 0 || placed + wrong > total
                    || uncheckedChunks < 0 || checkedAt < 0) {
                throw new IllegalArgumentException("placement counts must be non-negative and within the total");
            }
        }

        String toJson() {
            return "{\"id\":" + PlayerSnapshot.string(id) + ",\"name\":" + PlayerSnapshot.string(name)
                    + ",\"total\":" + total + ",\"placed\":" + placed + ",\"wrong\":" + wrong + ",\"extra\":" + extra
                    + ",\"uncheckedChunks\":" + uncheckedChunks + ",\"scanComplete\":" + scanComplete
                    + ",\"checkedAt\":" + checkedAt + "}";
        }
    }

    /** One material row: {@code left} items still to place, {@code have} carried (including shulker/bundle contents). */
    public record Material(String itemId, String name, String icon, long left, long have) {
        public Material {
            text(itemId);
            text(name);
            if (left <= 0 || have < 0) throw new IllegalArgumentException("material counts out of range");
        }

        String toJson() {
            return "{\"itemId\":" + PlayerSnapshot.string(itemId) + ",\"name\":" + PlayerSnapshot.string(name)
                    + ",\"icon\":" + PlayerSnapshot.string(icon) + ",\"left\":" + left + ",\"have\":" + have + "}";
        }
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"available\":").append(available)
                .append(",\"reason\":").append(PlayerSnapshot.string(reason))
                .append(",\"placement\":").append(placement == null ? "null" : placement.toJson())
                .append(",\"materials\":[");
        for (int index = 0; index < materials.size(); index++) {
            if (index > 0) json.append(',');
            json.append(materials.get(index).toJson());
        }
        return json.append("]}").toString();
    }

    private static void text(String value) {
        Objects.requireNonNull(value, "text");
        if (value.isEmpty() || value.length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("text must be nonempty and bounded");
        }
    }
}
