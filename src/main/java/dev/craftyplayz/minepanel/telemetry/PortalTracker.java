package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayDeque;
import java.util.List;
import java.util.Objects;

/**
 * Remembers the last Nether portal trip so the dashboard can guide the player to where a matching portal must be
 * built: the portal they entered, with X and Z divided by 8 (Overworld → Nether) or multiplied by 8 (Nether →
 * Overworld). A dimension change only counts when the player stood in a portal just before it, so respawning or
 * being teleported by a command is ignored. Client thread only.
 */
public final class PortalTracker {
    public static final String OVERWORLD = "minecraft:overworld";
    public static final String NETHER = "minecraft:the_nether";
    /** Portals are entered for up to 4 seconds in survival; allow a little more before treating a change as a jump. */
    static final long PORTAL_MEMORY_MILLIS = 6_000;
    static final int MAX_OBSIDIAN = 16;

    public record Point(int x, int y, int z) {
        String toJson() {
            return "{\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + "}";
        }
    }

    /** {@code target} is in the arrival dimension; its Y is unknown and is reported as the portal's Y. */
    public record Crossing(long id, long at, String fromDimension, Point from, String toDimension, Point to,
                           Point target) {
        public Crossing {
            Objects.requireNonNull(from);
            Objects.requireNonNull(to);
            Objects.requireNonNull(target);
            if (!List.of(OVERWORLD, NETHER).contains(fromDimension) || !List.of(OVERWORLD, NETHER).contains(toDimension)
                    || fromDimension.equals(toDimension)) {
                throw new IllegalArgumentException("Invalid portal crossing");
            }
        }

        String toJson() {
            return "{\"id\":" + id + ",\"at\":" + at + ",\"fromDimension\":" + PlayerSnapshot.string(fromDimension)
                    + ",\"from\":" + from.toJson() + ",\"toDimension\":" + PlayerSnapshot.string(toDimension)
                    + ",\"to\":" + to.toJson() + ",\"target\":" + target.toJson() + "}";
        }
    }

    public record Placement(long id, long at, Point position) {
        String toJson() {
            return "{\"id\":" + id + ",\"at\":" + at + ",\"x\":" + position.x + ",\"y\":" + position.y
                    + ",\"z\":" + position.z + "}";
        }
    }

    /** {@code lit} is a lit portal block near the target, once the player has built and lit the new portal. */
    public record State(Crossing crossing, List<Placement> obsidian, Point lit) {
        public static final State EMPTY = new State(null, List.of(), null);

        public State {
            obsidian = List.copyOf(obsidian);
        }

        public String toJson() {
            StringBuilder json = new StringBuilder("{\"crossing\":")
                    .append(crossing == null ? "null" : crossing.toJson()).append(",\"obsidian\":[");
            for (int index = 0; index < obsidian.size(); index++) {
                if (index > 0) json.append(',');
                json.append(obsidian.get(index).toJson());
            }
            return json.append("],\"lit\":").append(lit == null ? "null" : lit.toJson()).append('}').toString();
        }
    }

    private String dimension;
    private Point portal;
    private long portalSeenAt;
    private long nextId;
    private Crossing crossing;
    private final ArrayDeque<Placement> obsidian = new ArrayDeque<>();
    private Point lit;

    public void reset() {
        dimension = null;
        portal = null;
        crossing = null;
        obsidian.clear();
        lit = null;
    }

    public void observe(long now, String currentDimension, int x, int y, int z, boolean inPortal) {
        Point current = new Point(x, y, z);
        if (dimension != null && !dimension.equals(currentDimension)) {
            boolean viaPortal = portal != null && now - portalSeenAt <= PORTAL_MEMORY_MILLIS;
            if (viaPortal && isPortalPair(dimension, currentDimension)) {
                crossing = new Crossing(++nextId, now, dimension, portal, currentDimension, current,
                        convert(portal, currentDimension));
                obsidian.clear();
                lit = null;
            }
            portal = null;
        }
        if (inPortal) {
            portal = current;
            portalSeenAt = now;
        }
        dimension = currentDimension;
    }

    /** Records an obsidian block the player placed, for checking it is near the target. */
    public void obsidianPlaced(long now, int x, int y, int z) {
        if (crossing == null) return;
        if (obsidian.size() == MAX_OBSIDIAN) obsidian.removeFirst();
        obsidian.addLast(new Placement(++nextId, now, new Point(x, y, z)));
    }

    /** The target and the dimension it is in, or null when there is nothing to look for. */
    public Crossing crossing() {
        return crossing;
    }

    public void lit(Point portalBlock) {
        lit = portalBlock;
    }

    public State state() {
        return crossing == null ? State.EMPTY : new State(crossing, List.copyOf(obsidian), lit);
    }

    static boolean isPortalPair(String from, String to) {
        return OVERWORLD.equals(from) && NETHER.equals(to) || NETHER.equals(from) && OVERWORLD.equals(to);
    }

    /** The point in {@code dimension} that corresponds to a portal in the other dimension. */
    static Point convert(Point portal, String dimension) {
        if (NETHER.equals(dimension)) {
            return new Point(Math.floorDiv(portal.x, 8), portal.y, Math.floorDiv(portal.z, 8));
        }
        return new Point(portal.x * 8, portal.y, portal.z * 8);
    }
}
