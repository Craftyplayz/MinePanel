package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.mixin.ClientAdvancementsAccessor;
import dev.craftyplayz.minepanel.telemetry.AdvancementsSnapshot;
import net.minecraft.advancements.AdvancementNode;
import net.minecraft.advancements.AdvancementProgress;
import net.minecraft.advancements.DisplayInfo;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the advancements overview from what the server has sent. Rebuilt only after an advancement packet (or a
 * resource reload changes icon keys), since the tree holds a hundred or more entries. Client thread only.
 */
public final class AdvancementsCollector {
    private static boolean dirty = true;
    private AdvancementsSnapshot cached;
    private int cachedEpoch = -1;

    /** Called after every advancements packet. */
    public static void markDirty() {
        dirty = true;
    }

    void reset() {
        cached = null;
        dirty = true;
    }

    AdvancementsSnapshot collect(ClientPacketListener connection, IconRenderer icons) {
        if (!dirty && cachedEpoch == icons.epoch()) return cached;
        var advancements = connection.getAdvancements();
        Map<?, AdvancementProgress> progress = ((ClientAdvancementsAccessor) advancements).minepanel$progress();
        List<AdvancementsSnapshot.Entry> entries = new ArrayList<>();
        Map<String, int[]> counts = new LinkedHashMap<>();
        Map<String, AdvancementsSnapshot.Tab> tabs = new LinkedHashMap<>();
        for (AdvancementNode node : advancements.getTree().nodes()) {
            if (entries.size() == AdvancementsSnapshot.MAX_ENTRIES) break;
            var advancement = node.advancement();
            if (advancement.display().isEmpty()) continue;
            DisplayInfo display = advancement.display().get();
            AdvancementNode root = node.root();
            if (root.advancement().display().isEmpty()) continue;
            String tab = root.holder().id().toString();
            AdvancementProgress state = progress.get(node.holder());
            boolean done = state != null && state.isDone();
            int total = Math.min(AdvancementsSnapshot.MAX_CRITERIA, Math.max(1, advancement.requirements().size()));
            int completed = done ? total : state == null ? 0 : Math.min(total, Math.round(state.getPercent() * total));
            List<String> remaining = new ArrayList<>();
            if (!done && state != null && total > 1) {
                for (String criterion : state.getRemainingCriteria()) {
                    if (remaining.size() == AdvancementsSnapshot.MAX_CRITERIA) break;
                    remaining.add(readable(criterion));
                }
                remaining.sort(Comparator.naturalOrder());
            }
            ItemStack icon = display.getIcon().create();
            entries.add(new AdvancementsSnapshot.Entry(node.holder().id().toString(), tab,
                    bounded(display.getTitle().getString()), description(display.getDescription().getString()),
                    display.getType().getSerializedName(), iconKey(icon, icons), icon.hasFoil(), display.isHidden(),
                    done, null, completed, total, remaining));
            int[] count = counts.computeIfAbsent(tab, key -> new int[2]);
            if (done) count[0]++;
            count[1]++;
            if (node == root) {
                tabs.put(tab, new AdvancementsSnapshot.Tab(tab, bounded(display.getTitle().getString()),
                        iconKey(icon, icons), icon.hasFoil(), 0, 0));
            }
        }
        List<AdvancementsSnapshot.Tab> tabList = new ArrayList<>();
        for (var tab : tabs.values()) {
            int[] count = counts.getOrDefault(tab.id(), new int[2]);
            tabList.add(new AdvancementsSnapshot.Tab(tab.id(), tab.title(), tab.icon(), tab.foil(), count[0], count[1]));
        }
        entries.sort(Comparator.comparing(AdvancementsSnapshot.Entry::tab).thenComparing(AdvancementsSnapshot.Entry::id));
        cached = new AdvancementsSnapshot(tabList, entries);
        cachedEpoch = icons.epoch();
        dirty = false;
        return cached;
    }

    private static String iconKey(ItemStack stack, IconRenderer icons) {
        if (stack.isEmpty()) return null;
        String key = icons.keyFor(stack);
        icons.request(key, stack);
        return key;
    }

    /** Criterion names are ids such as "minecraft:badlands" or "killed_something": show them as words. */
    static String readable(String criterion) {
        String path = criterion.substring(criterion.indexOf(':') + 1).replace('/', ' ').replace('_', ' ').trim();
        if (path.isEmpty()) return bounded(criterion);
        return bounded(Character.toUpperCase(path.charAt(0)) + path.substring(1));
    }

    private static String bounded(String text) {
        String value = text.isBlank() ? "Untitled" : text;
        return value.length() > 256 ? value.substring(0, 256) : value;
    }

    private static String description(String text) {
        return text.length() > 1024 ? text.substring(0, 1024) : text;
    }
}
