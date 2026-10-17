package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.regex.Pattern;

/**
 * The game's registries, for the rule editor's pickers: items, blocks, entity types, status effects, biomes and
 * general ("custom") statistics, each with its readable name and, where it has one, an icon key (blocks and entity
 * types use their item and spawn egg). Built once per connection and replaced whole when it changes, so the
 * dashboard receives it with the initial snapshot and almost never again. Statistic ids have the snapshot's
 * {@code <type>/<value>} form, e.g. {@code minecraft:custom/minecraft:jump}.
 */
public record Registries(List<Entry> items, List<Entry> blocks, List<Entry> entities, List<Entry> effects,
                         List<Entry> biomes, List<Entry> stats) {
    public static final int MAX_ENTRIES = 4096;
    public static final Registries EMPTY = new Registries(List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of());
    // Statistic ids have a second namespace after the slash.
    private static final Pattern ID = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._:-]+");
    private static final Pattern ICON = Pattern.compile("[a-z0-9-]{1,64}");

    public record Entry(String id, String name, String icon) {
        public Entry {
            if (id == null || id.length() > 256 || !ID.matcher(id).matches() || name == null
                    || name.isEmpty() || name.length() > 256 || icon != null && !ICON.matcher(icon).matches()) {
                throw new IllegalArgumentException("Invalid registry entry");
            }
        }

        String toJson() {
            return "{\"id\":" + PlayerSnapshot.string(id) + ",\"name\":" + PlayerSnapshot.string(name)
                    + ",\"icon\":" + PlayerSnapshot.string(icon) + "}";
        }
    }

    public Registries {
        items = List.copyOf(items);
        blocks = List.copyOf(blocks);
        entities = List.copyOf(entities);
        effects = List.copyOf(effects);
        biomes = List.copyOf(biomes);
        stats = List.copyOf(stats);
        for (List<Entry> list : List.of(items, blocks, entities, effects, biomes, stats)) {
            if (list.size() > MAX_ENTRIES) throw new IllegalArgumentException("Too many registry entries");
        }
    }

    public String toJson() {
        return "{\"items\":" + list(items) + ",\"blocks\":" + list(blocks) + ",\"entities\":" + list(entities)
                + ",\"effects\":" + list(effects) + ",\"biomes\":" + list(biomes) + ",\"stats\":" + list(stats) + "}";
    }

    private static String list(List<Entry> entries) {
        StringBuilder json = new StringBuilder("[");
        for (int index = 0; index < entries.size(); index++) {
            if (index > 0) json.append(',');
            json.append(entries.get(index).toJson());
        }
        return json.append(']').toString();
    }
}
