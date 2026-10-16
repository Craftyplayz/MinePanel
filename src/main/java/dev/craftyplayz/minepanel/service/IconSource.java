package dev.craftyplayz.minepanel.service;

/** Item icons rendered by the game, looked up by the icon keys published in item snapshots. */
public interface IconSource {
    /** Returns PNG bytes, waiting briefly for a pending render, or {@code null} for an unknown key. */
    byte[] icon(String key) throws InterruptedException;

    /** Returns the active resource pack's icon for a status effect such as {@code minecraft:speed}, or {@code null}. */
    default byte[] effectIcon(String effectId) {
        return null;
    }
}
