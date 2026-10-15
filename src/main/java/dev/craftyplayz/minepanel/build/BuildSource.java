package dev.craftyplayz.minepanel.build;

import java.util.List;

/**
 * Read access to a schematic mod, implemented by the Litematica adapter. Every method is called on the client thread
 * only. Block states are identified by small non-negative integers (the game's global block state IDs).
 */
public interface BuildSource {
    /** The placement selected in the schematic mod, or null when none is. */
    Placement selected();

    /** Items needed to place one block of {@code stateId}; empty for blocks that have no item. */
    List<Requirement> requirements(int stateId);

    record Requirement(String itemId, int count) {
        public Requirement {
            if (itemId == null || itemId.isEmpty() || count <= 0) throw new IllegalArgumentException("Invalid requirement");
        }
    }

    interface Placement {
        /** Stable for the life of the placement. */
        String id();

        String name();

        /** Changes whenever the expected blocks change: schematic, origin, rotation, mirror or enabled sub-regions. */
        String fingerprint();

        /** Chunks touched by the enabled sub-regions, as {@link BuildTracker#chunkKey} values. */
        long[] chunks();

        /** Enabled sub-region containers, read to count the schematic's blocks without loaded chunks. */
        int regionCount();

        long regionVolume(int region);

        /** The state at a flat index below {@link #regionVolume} of a sub-region container. */
        int stateAt(int region, long index);

        boolean isAir(int stateId);

        /** Whether the chunk can be compared now (Litematica's verifier rule). */
        boolean ready(int chunkX, int chunkZ);

        /** Compares every position of the enabled sub-regions inside a {@link #ready} chunk. */
        void scan(int chunkX, int chunkZ, ChunkCounts counts);
    }
}
