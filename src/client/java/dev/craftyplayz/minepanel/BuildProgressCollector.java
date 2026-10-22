package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.build.BuildProgress;
import dev.craftyplayz.minepanel.build.BuildSource;
import dev.craftyplayz.minepanel.build.BuildTracker;
import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
//? if fabric {
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.metadata.ModDependency;
//?} else {
/*import net.neoforged.fml.ModList;
import org.apache.maven.artifact.versioning.DefaultArtifactVersion;
*///?}
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;

import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Litematica build progress for the dashboard. Client thread only. Litematica classes are reached only through
 * {@code dev.craftyplayz.minepanel.litematica}, and only after the installed version was checked against MinePanel's
 * {@code suggests} entry (Fabric) or {@code litematica_minimum} mod property (NeoForge); any failure turns the tile unavailable for the session without affecting gameplay.
 */
public final class BuildProgressCollector {
    private static final Logger LOGGER = Logger.getLogger("MinePanel");
    private static final String LITEMATICA = "litematica";
    /** Time per client tick spent counting and comparing blocks. */
    private static final long BUDGET_NANOS = 2_000_000L;
    private static volatile BuildProgressCollector instance;
    private final BuildTracker tracker = new BuildTracker();
    private BuildSource source;
    private boolean initialized;

    BuildProgressCollector() {
        instance = this;
    }

    /** For mixins; null before the client initialized. */
    public static BuildProgressCollector get() {
        return instance;
    }

    void tick() {
        if (!initialized) {
            initialized = true;
            connect();
        }
        if (source == null || tracker.disabled()) return;
        try {
            long start = System.nanoTime();
            tracker.tick(source, start + BUDGET_NANOS, System::nanoTime, System.currentTimeMillis());
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
    }

    private void connect() {
        //? if fabric {
        var litematica = FabricLoader.getInstance().getModContainer(LITEMATICA);
        if (litematica.isEmpty()) {
            tracker.disable("missing");
            return;
        }
        var version = litematica.get().getMetadata().getVersion();
        boolean supported = FabricLoader.getInstance().getModContainer("minepanel").stream()
                .flatMap(minepanel -> minepanel.getMetadata().getDependencies().stream())
                .filter(dependency -> dependency.getKind() == ModDependency.Kind.SUGGESTS
                        && dependency.getModId().equals(LITEMATICA))
                .allMatch(dependency -> dependency.matches(version));
        String installed = version.getFriendlyString();
        //?} else {
        /*// Forgematica, the NeoForge port, also registers the mod id "litematica" (with its own version number).
        var litematica = ModList.get().getModContainerById(LITEMATICA);
        if (litematica.isEmpty()) {
            tracker.disable("missing");
            return;
        }
        var version = litematica.get().getModInfo().getVersion();
        boolean supported = ModList.get().getModContainerById("minepanel").stream()
                .map(minepanel -> minepanel.getModInfo().getModProperties().get("litematica_minimum"))
                .filter(minimum -> minimum != null)
                .allMatch(minimum -> version.compareTo(new DefaultArtifactVersion(minimum.toString())) >= 0);
        String installed = version.toString();
        *///?}
        if (!supported) {
            LOGGER.warning("Litematica " + installed
                    + " is not supported; the Build progress tile is unavailable.");
            tracker.disable("version");
            return;
        }
        try {
            source = dev.craftyplayz.minepanel.litematica.LitematicaBuildSource.create();
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
        }
    }

    private void fail(Throwable failure) {
        source = null;
        tracker.disable("error");
        LOGGER.log(Level.WARNING, "Litematica build progress failed; the Build progress tile is off for this session.",
                failure);
    }

    BuildProgress snapshot(Minecraft minecraft, InventorySnapshot inventory, IconRenderer icons) {
        try {
            return tracker.snapshot(inventory, itemId -> describe(minecraft, itemId, icons));
        } catch (LinkageError | RuntimeException failure) {
            fail(failure);
            return tracker.snapshot(null, itemId -> null);
        }
    }

    private static ItemSnapshot describe(Minecraft minecraft, String itemId, IconRenderer icons) {
        Identifier id = Identifier.tryParse(itemId);
        if (id == null) return null;
        return BuiltInRegistries.ITEM.getOptional(id)
                .map(item -> MinecraftInventoryCollector.item(minecraft, new ItemStack(item), icons))
                .orElse(null);
    }

    public void blockChanged(int x, int z) {
        tracker.markBlockChanged(x, z);
    }

    void chunkLoaded(int chunkX, int chunkZ) {
        tracker.markChunkLoaded(chunkX, chunkZ);
    }

    /** Leaving a world forgets every placement's progress; an unavailable tile stays unavailable. */
    void reset() {
        tracker.reset();
    }
}
