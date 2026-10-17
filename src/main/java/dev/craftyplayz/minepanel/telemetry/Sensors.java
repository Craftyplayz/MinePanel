package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.regex.Pattern;

/**
 * What rule conditions read beyond the other snapshot fields (docs/RULES_V2.md, phase 4). The cheap values are always
 * sent. {@code light}, {@code look}, {@code nearby} and {@code screen} cost more and are null unless an enabled rule
 * reads them (see {@link SensorNeeds}).
 *
 * <p>{@code moonPhase} is Minecraft's index (0 = full moon … 4 = new moon … 7 = waxing gibbous).
 * {@code spawnDistance} is the horizontal distance in blocks to the world spawn, or null outside the spawn's dimension.
 * {@code air} and {@code maxAir} are in ticks. {@code riding} is the vehicle's entity type, {@code using} what the
 * player is doing with an item (see {@link #USING}). {@code bossBar} is any boss bar other than a raid's.
 */
public record Sensors(int moonPhase, Integer spawnDistance, int air, int maxAir, int armor, boolean onFire,
                      boolean inWater, boolean inLava, boolean inRain, boolean sneaking, boolean sprinting,
                      boolean sleeping, String riding, String using, boolean bossBar, boolean raid, Light light,
                      Look look, Nearby nearby, String screen) {
    public static final List<String> USING = List.of("eating", "drinking", "blocking", "bow", "crossbow", "trident",
            "spear", "spyglass", "horn", "brush", "bundle", "fishing");
    public static final List<String> SCREENS = List.of("none", "inventory", "chest", "enderChest", "furnace",
            "crafting", "anvil", "enchanting", "brewing", "trading", "smithing", "grindstone", "stonecutter", "loom",
            "cartography", "beacon", "other");
    public static final List<String> LOOK_KINDS = List.of("none", "block", "entity");
    public static final int MAX_NEARBY = 128;
    /** Entity scans never reach further than this, nor past the render distance. */
    public static final int MAX_RADIUS = 64;
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z0-9_.-]+:[a-z0-9/._-]+");
    public static final Sensors EMPTY = new Sensors(0, null, 300, 300, 0, false, false, false, false, false, false,
            false, null, null, false, false, null, null, null, null);

    /** Block light, sky light (ignoring the time of day) and what the game uses for mob spawning, 0–15. */
    public record Light(int block, int sky, int combined) {
        public Light {
            if (!level(block) || !level(sky) || !level(combined)) throw new IllegalArgumentException("Invalid light");
        }

        private static boolean level(int value) {
            return value >= 0 && value <= 15;
        }

        String toJson() {
            return "{\"block\":" + block + ",\"sky\":" + sky + ",\"combined\":" + combined + "}";
        }
    }

    /** The block or entity under the crosshair within the furthest distance a rule asks for; kind "none" if nothing. */
    public record Look(String kind, String id, Double distance) {
        public Look {
            boolean none = "none".equals(kind);
            if (!LOOK_KINDS.contains(kind) || none != (id == null) || none != (distance == null)
                    || id != null && !identifier(id)
                    || distance != null && (!Double.isFinite(distance) || distance < 0 || distance > MAX_RADIUS + 1)) {
                throw new IllegalArgumentException("Invalid look target");
            }
        }

        String toJson() {
            return "{\"kind\":" + PlayerSnapshot.string(kind) + ",\"id\":" + PlayerSnapshot.string(id)
                    + ",\"distance\":" + (distance == null ? "null" : distance.toString()) + "}";
        }
    }

    /** Living entities (other players included, the player excluded) within {@code radius}, nearest first. */
    public record Nearby(int radius, List<Entity> entities) {
        public Nearby {
            entities = List.copyOf(entities);
            if (radius < 0 || radius > MAX_RADIUS || entities.size() > MAX_NEARBY) {
                throw new IllegalArgumentException("Invalid nearby entities");
            }
        }

        String toJson() {
            StringBuilder json = new StringBuilder("{\"radius\":").append(radius).append(",\"entities\":[");
            for (int index = 0; index < entities.size(); index++) {
                if (index > 0) json.append(',');
                json.append(entities.get(index).toJson());
            }
            return json.append("]}").toString();
        }
    }

    /** One nearby entity: its type, whether it is a hostile mob, and its distance in blocks (tenths). */
    public record Entity(String type, boolean hostile, double distance) {
        public Entity {
            if (!identifier(type) || !Double.isFinite(distance) || distance < 0
                    || distance > MAX_RADIUS + 1) {
                throw new IllegalArgumentException("Invalid nearby entity");
            }
        }

        String toJson() {
            return "{\"type\":" + PlayerSnapshot.string(type) + ",\"hostile\":" + hostile + ",\"distance\":" + distance
                    + "}";
        }
    }

    public Sensors {
        if (moonPhase < 0 || moonPhase > 7 || spawnDistance != null && spawnDistance < 0 || air < -20 || maxAir < 0
                || air > Math.max(maxAir, 300) || armor < 0 || armor > 1000
                || riding != null && !identifier(riding)
                || using != null && !USING.contains(using) || screen != null && !SCREENS.contains(screen)) {
            throw new IllegalArgumentException("Invalid sensors");
        }
    }

    static boolean identifier(String value) {
        return value != null && value.length() <= 256 && IDENTIFIER.matcher(value).matches();
    }

    /** Rounds a distance to tenths of a block, so tiny movements don't produce an update every sample. */
    public static double tenths(double value) {
        return Math.round(value * 10) / 10.0;
    }

    public String toJson() {
        return "{\"moonPhase\":" + moonPhase + ",\"spawnDistance\":" + spawnDistance + ",\"air\":" + air
                + ",\"maxAir\":" + maxAir + ",\"armor\":" + armor + ",\"onFire\":" + onFire
                + ",\"inWater\":" + inWater + ",\"inLava\":" + inLava + ",\"inRain\":" + inRain
                + ",\"sneaking\":" + sneaking + ",\"sprinting\":" + sprinting + ",\"sleeping\":" + sleeping
                + ",\"riding\":" + PlayerSnapshot.string(riding) + ",\"using\":" + PlayerSnapshot.string(using)
                + ",\"bossBar\":" + bossBar + ",\"raid\":" + raid
                + ",\"light\":" + (light == null ? "null" : light.toJson())
                + ",\"look\":" + (look == null ? "null" : look.toJson())
                + ",\"nearby\":" + (nearby == null ? "null" : nearby.toJson())
                + ",\"screen\":" + PlayerSnapshot.string(screen) + "}";
    }
}
