package dev.craftyplayz.minepanel.build;

import java.util.Arrays;

/** Collects one chunk's comparison results; reused between scans to avoid per-position allocation. */
public final class ChunkCounts {
    private int[] placedByState = new int[256];
    private int[] touched = new int[64];
    private int touchedCount;
    private int missing;
    private int wrong;
    private int extra;

    /** Records one position; {@code expectedState} is the schematic's state there. */
    public void add(BuildRules.Result result, int expectedState) {
        switch (result) {
            case PLACED -> placed(expectedState);
            case MISSING -> missing++;
            case WRONG -> wrong++;
            case EXTRA -> extra++;
            case NONE -> {
            }
        }
    }

    private void placed(int state) {
        if (state < 0) throw new IllegalArgumentException("state IDs are non-negative");
        if (state >= placedByState.length) {
            placedByState = Arrays.copyOf(placedByState, Math.max(state + 1, placedByState.length * 2));
        }
        if (placedByState[state]++ == 0) {
            if (touchedCount == touched.length) touched = Arrays.copyOf(touched, touched.length * 2);
            touched[touchedCount++] = state;
        }
    }

    void clear() {
        for (int index = 0; index < touchedCount; index++) placedByState[touched[index]] = 0;
        touchedCount = 0;
        missing = wrong = extra = 0;
    }

    ChunkResult freeze() {
        int[] states = Arrays.copyOf(touched, touchedCount);
        int[] counts = new int[touchedCount];
        for (int index = 0; index < touchedCount; index++) counts[index] = placedByState[states[index]];
        return new ChunkResult(states, counts, missing, wrong, extra);
    }

    /** Immutable per-chunk result kept in the placement cache. */
    record ChunkResult(int[] states, int[] placed, int missing, int wrong, int extra) {
    }
}
