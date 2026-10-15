package dev.craftyplayz.minepanel.litematica;

import dev.craftyplayz.minepanel.build.BuildRules;
import dev.craftyplayz.minepanel.build.BuildSource;
import dev.craftyplayz.minepanel.build.BuildTracker;
import dev.craftyplayz.minepanel.build.ChunkCounts;
import fi.dy.masa.litematica.config.Configs;
import fi.dy.masa.litematica.data.DataManager;
import fi.dy.masa.litematica.materials.MaterialCache;
import fi.dy.masa.litematica.schematic.LitematicaSchematic;
import fi.dy.masa.litematica.schematic.container.LitematicaBlockStateContainer;
import fi.dy.masa.litematica.schematic.placement.SchematicPlacement;
import fi.dy.masa.litematica.schematic.placement.SubRegionPlacement;
import fi.dy.masa.litematica.util.BlockUtils;
import fi.dy.masa.litematica.util.IgnoreBlockRegistry;
import fi.dy.masa.litematica.util.WorldUtils;
import fi.dy.masa.litematica.world.SchematicWorldHandler;
import fi.dy.masa.litematica.world.WorldSchematic;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.chunk.ChunkAccess;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reads Litematica's selected placement for {@link BuildTracker}. Client thread only. Comparison follows
 * {@code SchematicVerifier.checkBlockStates}; Litematica's own verifier and material-list tasks are never started.
 */
public final class LitematicaBuildSource implements BuildSource {
    private LitematicaBuildSource() {
    }

    /**
     * Callers must have checked that a supported Litematica is loaded; a {@link LinkageError} here or later means
     * its API changed.
     */
    public static BuildSource create() {
        DataManager.getSchematicPlacementManager(); // fail now rather than mid-scan if the API moved
        return new LitematicaBuildSource();
    }

    @Override
    public Placement selected() {
        SchematicPlacement placement = DataManager.getSchematicPlacementManager().getSelectedSchematicPlacement();
        if (placement == null || !placement.isEnabled() || placement.getSchematic() == null) return null;
        return new SelectedPlacement(placement);
    }

    /** Mirrors {@code MaterialListUtils.convertStatesToStacks}: waterlogged blocks also need a water bucket. */
    @Override
    public List<Requirement> requirements(int stateId) {
        BlockState state = Block.stateById(stateId);
        Map<String, Integer> items = new LinkedHashMap<>();
        if (state.hasProperty(BlockStateProperties.WATERLOGGED) && state.getValue(BlockStateProperties.WATERLOGGED)) {
            add(items, new ItemStack(Items.WATER_BUCKET), 1);
            state = state.setValue(BlockStateProperties.WATERLOGGED, false);
        }
        MaterialCache cache = MaterialCache.getInstance();
        if (cache.requiresMultipleItems(state)) {
            for (ItemStack stack : cache.getItems(state)) add(items, stack, stack.getCount());
        } else {
            ItemStack stack = cache.getRequiredBuildItemForState(state);
            add(items, stack, stack.getCount());
        }
        List<Requirement> requirements = new ArrayList<>(items.size());
        items.forEach((item, count) -> requirements.add(new Requirement(item, count)));
        return requirements;
    }

    private static void add(Map<String, Integer> items, ItemStack stack, int count) {
        if (stack.isEmpty() || count <= 0) return;
        items.merge(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(), count, Integer::sum);
    }

    private static final class SelectedPlacement implements Placement {
        private static final SubRegionPlacement.RequiredEnabled ENABLED =
                SubRegionPlacement.RequiredEnabled.PLACEMENT_ENABLED;
        private final SchematicPlacement placement;
        // Litematica's comparison options, read once per tick.
        private final boolean ignoreCropAge = Configs.Visuals.IGNORE_CROP_AGE.getBooleanValue();
        private final boolean ignoreFluids = Configs.Visuals.IGNORE_EXISTING_FLUIDS.getBooleanValue();
        private IgnoreBlockRegistry ignoreBlocks;
        private List<LitematicaBlockStateContainer> containers;

        SelectedPlacement(SchematicPlacement placement) {
            this.placement = placement;
        }

        @Override
        public String id() {
            return placement.getHashId().toString();
        }

        @Override
        public String name() {
            return placement.getName();
        }

        @Override
        public String fingerprint() {
            StringBuilder fingerprint = new StringBuilder()
                    .append(System.identityHashCode(placement.getSchematic())).append('|')
                    .append(placement.getOrigin()).append('|').append(placement.getRotation()).append('|')
                    .append(placement.getMirror());
            for (var entry : placement.getEnabledRelativeSubRegionPlacements().entrySet()) {
                SubRegionPlacement region = entry.getValue();
                fingerprint.append('|').append(entry.getKey()).append('@').append(region.getPos())
                        .append(region.getRotation()).append(region.getMirror());
            }
            return fingerprint.toString();
        }

        @Override
        public long[] chunks() {
            Set<ChunkPos> touched = placement.getTouchedChunks(ENABLED);
            long[] keys = new long[touched.size()];
            int index = 0;
            for (ChunkPos chunk : touched) keys[index++] = BuildTracker.chunkKey(chunk.x(), chunk.z());
            return keys;
        }

        private List<LitematicaBlockStateContainer> containers() {
            if (containers == null) {
                LitematicaSchematic schematic = placement.getSchematic();
                containers = new ArrayList<>();
                for (String region : placement.getEnabledRelativeSubRegionPlacements().keySet()) {
                    LitematicaBlockStateContainer container = schematic.getSubRegionContainer(region);
                    if (container != null) containers.add(container);
                }
            }
            return containers;
        }

        @Override
        public int regionCount() {
            return containers().size();
        }

        @Override
        public long regionVolume(int region) {
            var size = containers().get(region).getSize();
            return (long) size.getX() * size.getY() * size.getZ();
        }

        @Override
        public int stateAt(int region, long index) {
            LitematicaBlockStateContainer container = containers().get(region);
            var size = container.getSize();
            int x = (int) (index % size.getX());
            long rest = index / size.getX();
            int z = (int) (rest % size.getZ());
            int y = (int) (rest / size.getZ());
            return Block.getId(container.get(x, y, z));
        }

        @Override
        public boolean isAir(int stateId) {
            return Block.stateById(stateId).isAir();
        }

        /** Litematica's verifier rule: the 3×3 client chunks are loaded and the schematic world has the chunk. */
        @Override
        public boolean ready(int chunkX, int chunkZ) {
            ClientLevel level = Minecraft.getInstance().level;
            WorldSchematic schematic = SchematicWorldHandler.getSchematicWorld();
            if (level == null || schematic == null || !schematic.getChunkSource().hasChunk(chunkX, chunkZ)) return false;
            for (int x = chunkX - 1; x <= chunkX + 1; x++) {
                for (int z = chunkZ - 1; z <= chunkZ + 1; z++) {
                    if (!WorldUtils.isClientChunkLoaded(level, x, z)) return false;
                }
            }
            return true;
        }

        @Override
        public void scan(int chunkX, int chunkZ, ChunkCounts counts) {
            ClientLevel level = Minecraft.getInstance().level;
            WorldSchematic schematic = SchematicWorldHandler.getSchematicWorld();
            if (level == null || schematic == null) throw new IllegalStateException("Chunk is no longer ready");
            ChunkAccess actualChunk = level.getChunk(chunkX, chunkZ);
            ChunkAccess expectedChunk = schematic.getChunk(chunkX, chunkZ);
            Set<Pair<BlockState, BlockState>> ignored =
                    placement.hasVerifier() ? placement.getSchematicVerifier().getIgnoredMismatches() : Set.of();
            BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
            for (var box : placement.getBoxesWithinChunk(chunkX, chunkZ, ENABLED).values()) {
                for (int y = box.minY(); y <= box.maxY(); y++) {
                    for (int z = box.minZ(); z <= box.maxZ(); z++) {
                        for (int x = box.minX(); x <= box.maxX(); x++) {
                            pos.set(x, y, z);
                            BlockState expected = expectedChunk.getBlockState(pos);
                            BlockState actual = actualChunk.getBlockState(pos);
                            counts.add(classify(expected, actual, ignored), Block.getId(expected));
                        }
                    }
                }
            }
        }

        private BuildRules.Result classify(BlockState expected, BlockState actual,
                                           Set<Pair<BlockState, BlockState>> ignored) {
            if (expected == actual) return expected.isAir() ? BuildRules.Result.NONE : BuildRules.Result.PLACED;
            return BuildRules.classify(expected.isAir(), actual.isAir(), false,
                    () -> ignoreCropAge && BlockUtils.areStatesEqualIgnoringAge(expected, actual),
                    () -> !ignored.isEmpty() && ignored.contains(Pair.of(expected, actual)),
                    () -> ignoreFluids && actual.liquid() || ignoreBlocks().hasBlock(actual.getBlock()));
        }

        private IgnoreBlockRegistry ignoreBlocks() {
            if (ignoreBlocks == null) ignoreBlocks = new IgnoreBlockRegistry();
            return ignoreBlocks;
        }
    }
}
