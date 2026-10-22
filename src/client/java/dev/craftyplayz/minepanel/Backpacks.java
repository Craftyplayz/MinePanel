package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.service.WorldStore;
import dev.craftyplayz.minepanel.telemetry.BackpacksSnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import net.minecraft.client.Minecraft;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Optional backpack-mod support: what a backpack in the inventory holds, for its item window and Build progress.
 * Client thread only. On NeoForge with a supported Sophisticated Backpacks installed this delegates to
 * {@code dev.craftyplayz.minepanel.backpacks}, the only package that touches that mod; otherwise it does nothing.
 * Any failure turns the integration off for the session with one warning, without affecting sampling.
 */
public final class Backpacks {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    static final String SOPHISTICATED_BACKPACKS = "sophisticatedbackpacks";
    private static Source source;
    private static boolean connected;
    // Dashboard items of shown backpacks by UUID, rebuilt only when their contents (or the icon keys) change.
    private static final Map<String, ShownCache> SHOWN = new HashMap<>();

    private record ShownCache(Contents contents, int epoch, List<ItemSnapshot> items) {
    }

    private Backpacks() {
    }

    /**
     * What is known about one backpack: its non-empty stacks, or {@code items == null} while unknown. A new instance
     * is made only when the contents change, so callers may cache by identity.
     */
    public record Contents(List<ItemStack> items) {
        public static final Contents UNKNOWN = new Contents(null);
        public static final Contents EMPTY = new Contents(List.of());

        public Contents {
            if (items != null) items = List.copyOf(items);
        }
    }

    /** A backpack mod integration. Every method runs on the client thread. */
    public interface Source {
        /** The contents of {@code stack}, or null when it is not a backpack. Must be cheap: called per sample. */
        Contents contents(ItemStack stack);

        /** Every client tick in a world. */
        void tick(Minecraft minecraft, WorldStore store);

        /** Leaving a world. */
        void reset();

        /**
         * Every known backpack, the last opened one, and the contents of the {@code watched} backpacks (UUIDs the layout
         * selects) plus the last opened one. Called once per sample.
         */
        Library library(Set<String> watched);
    }

    /** One known backpack; {@code icon} is the backpack's item, or null when unknown. */
    public record Listed(String uuid, String name, String player, Long openedAt, ItemStack icon, List<String> items,
                         int filled, int slots) {
    }

    /** What {@link Source#library} knows: {@code shown} maps a watched backpack's UUID to its name and contents. */
    public record Library(String source, String last, List<Listed> list, Map<String, Named> shown) {
    }

    public record Named(String name, Contents contents) {
    }

    /** The Backpacks panels' data, or null without a supported backpack mod. */
    static BackpacksSnapshot collect(Minecraft minecraft, IconRenderer icons, Set<String> watched) {
        if (source == null) return null;
        try {
            Library library = source.library(watched);
            List<BackpacksSnapshot.Entry> list = new ArrayList<>();
            for (Listed listed : library.list()) {
                list.add(new BackpacksSnapshot.Entry(listed.uuid(), listed.name(), listed.player(), listed.openedAt(),
                        listed.icon() == null || listed.icon().isEmpty() ? null : icons.deferredKey(listed.icon()),
                        listed.items(), listed.filled(), listed.slots()));
            }
            List<BackpacksSnapshot.Shown> shown = new ArrayList<>();
            library.shown().forEach((uuid, named) -> {
                Contents contents = named.contents();
                if (contents.items() == null) {
                    shown.add(new BackpacksSnapshot.Shown(uuid, named.name(), true, List.of()));
                    return;
                }
                ShownCache cached = SHOWN.get(uuid);
                if (cached == null || cached.contents() != contents || cached.epoch() != icons.epoch()) {
                    cached = new ShownCache(contents, icons.epoch(),
                            MinecraftInventoryCollector.contents(minecraft, contents, icons));
                    SHOWN.put(uuid, cached);
                }
                shown.add(new BackpacksSnapshot.Shown(uuid, named.name(), false, cached.items()));
            });
            SHOWN.keySet().retainAll(library.shown().keySet());
            return new BackpacksSnapshot(library.source(), library.last(), list, shown);
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return null;
        }
    }

    /** Null when {@code stack} is not a backpack (or no backpack mod is supported). */
    static Contents contents(ItemStack stack) {
        if (source == null || stack.isEmpty()) return null;
        try {
            return source.contents(stack);
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return null;
        }
    }

    static void tick(Minecraft minecraft, WorldStore store) {
        if (!connected) {
            connected = true;
            connect();
        }
        if (source == null) return;
        try {
            source.tick(minecraft, store);
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
    }

    static void reset() {
        SHOWN.clear();
        if (source == null) return;
        try {
            source.reset();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
    }

    private static void connect() {
        //? if neoforge {
        /*var mods = net.neoforged.fml.ModList.get();
        var backpacks = mods.getModContainerById(SOPHISTICATED_BACKPACKS);
        if (backpacks.isEmpty()) return;
        var version = backpacks.get().getModInfo().getVersion();
        // The oldest supported version comes from MinePanel's own mods.toml ([modproperties.minepanel]).
        Object minimum = mods.getModContainerById("minepanel")
                .map(minepanel -> minepanel.getModInfo().getModProperties().get(SOPHISTICATED_BACKPACKS + "_minimum"))
                .orElse(null);
        if (minimum == null || version.compareTo(
                new org.apache.maven.artifact.versioning.DefaultArtifactVersion(minimum.toString())) < 0) {
            LOGGER.warning("Sophisticated Backpacks " + version + " is older than " + minimum
                    + "; backpack contents are not shown.");
            return;
        }
        try {
            source = new dev.craftyplayz.minepanel.backpacks.SophisticatedBackpacks();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
        *///?}
    }

    private static void fail(Throwable failure) {
        source = null;
        LOGGER.log(Level.WARNING, "Backpack support failed; backpack contents are off for this session.", failure);
    }
}
