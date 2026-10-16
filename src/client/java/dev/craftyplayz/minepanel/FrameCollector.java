package dev.craftyplayz.minepanel;

import dev.craftyplayz.minepanel.telemetry.FrameStats;

/**
 * Times every rendered frame, from the end of one {@code Minecraft.runTick} to the end of the next, including
 * menus and loading screens. Render thread only; MinePanel's client tick runs on the same thread.
 */
public final class FrameCollector {
    private static final FrameStats STATS = new FrameStats();

    private FrameCollector() {
    }

    public static void frame() {
        STATS.frame(System.nanoTime());
    }

    static FrameStats.Performance snapshot() {
        return STATS.snapshot();
    }
}
