package dev.craftyplayz.minepanel.telemetry;

import dev.craftyplayz.minepanel.build.BuildProgress;

import java.util.List;
import java.util.Objects;

/**
 * Everything beyond the core vitals and inventory: the world around the player, movement, experience, the last
 * portal trip, recent pickups, advancements, known villagers, the last-seen ender chest, the client frame rate and
 * Litematica build progress, and the icons the inventory tile shows beside the slots. Each part is sent as a top-level snapshot field and replaced whole when it changes.
 * {@code advancements} is null until the server has sent them; {@code enderChest} is null until the player opens
 * their ender chest in this world.
 */
public record PlayerDetails(WorldInfo world, Motion motion, XpTracker.Experience xp, PortalTracker.State portal,
                            List<PickupTracker.Pickup> pickups, AdvancementsSnapshot advancements,
                            List<VillagerSnapshot> villagers, EnderChest enderChest,
                            FrameStats.Performance performance, BuildProgress build, Icons icons) {
    public static final List<String> FIELDS = List.of("world", "motion", "xp", "portal", "pickups", "advancements",
            "villagers", "enderChest", "performance", "build", "icons");

    /** The 27 slots of the player's ender chest, as of {@code seenAt}. */
    public record EnderChest(long seenAt, List<ItemSnapshot> slots) {
        public static final int SLOT_COUNT = 27;

        public EnderChest {
            slots = List.copyOf(slots);
            if (seenAt < 0 || slots.size() != SLOT_COUNT) throw new IllegalArgumentException("Invalid ender chest");
        }

        String toJson() {
            StringBuilder json = new StringBuilder("{\"seenAt\":").append(seenAt).append(",\"slots\":[");
            for (int index = 0; index < slots.size(); index++) {
                if (index > 0) json.append(',');
                json.append(slots.get(index).toJson());
            }
            return json.append("]}").toString();
        }
    }

    /**
     * Items drawn beside the inventory: the player's own head ({@code null} until their skin has loaded, so its icon
     * never shows the default skin) and an ender chest.
     */
    public record Icons(ItemSnapshot head, ItemSnapshot enderChest) {
        public Icons {
            Objects.requireNonNull(enderChest, "enderChest");
            if (head != null && head.empty() || enderChest.empty()) throw new IllegalArgumentException("Invalid icons");
        }

        String toJson() {
            return "{\"head\":" + (head == null ? "null" : head.toJson()) + ",\"enderChest\":" + enderChest.toJson()
                    + "}";
        }
    }

    public PlayerDetails {
        Objects.requireNonNull(world, "world");
        Objects.requireNonNull(motion, "motion");
        Objects.requireNonNull(xp, "xp");
        Objects.requireNonNull(portal, "portal");
        Objects.requireNonNull(performance, "performance");
        Objects.requireNonNull(build, "build");
        Objects.requireNonNull(icons, "icons");
        pickups = List.copyOf(pickups);
        villagers = List.copyOf(villagers);
        if (pickups.size() > PickupTracker.MAX_PICKUPS || villagers.size() > VillagerSnapshot.MAX_VILLAGERS) {
            throw new IllegalArgumentException("Too many pickups or villagers");
        }
    }

    /** Placeholder details for code paths (and tests) that only care about the core fields. */
    public static PlayerDetails placeholder() {
        var boots = new ItemSnapshot(false, "minecraft:netherite_boots", "Netherite Boots", 1, 1, null, null,
                List.of());
        var enderChest = new ItemSnapshot(false, "minecraft:ender_chest", "Ender Chest", 1, 64, null, null,
                List.of());
        var xp = new XpTracker().observe(0, 0, 0);
        return new PlayerDetails(new WorldInfo("singleplayer", "World", "minecraft:plains", "Plains", "clear", 0, 0,
                "survival"), Motion.rounded("ground", 0, 0, 0, 0, 0, boots, null), xp, PortalTracker.State.EMPTY,
                List.of(), null, List.of(), null, FrameStats.Performance.EMPTY, BuildProgress.MISSING,
                new Icons(null, enderChest));
    }

    /** The JSON value of one {@link #FIELDS field}; {@code details} is null while the player is unavailable. */
    static String fieldJson(PlayerDetails details, String field) {
        if (details == null) return "null";
        return switch (field) {
            case "world" -> details.world.toJson();
            case "motion" -> details.motion.toJson();
            case "xp" -> details.xp.toJson();
            case "portal" -> details.portal.toJson();
            case "pickups" -> list(details.pickups.stream().map(PickupTracker.Pickup::toJson).toList());
            case "advancements" -> details.advancements == null ? "null" : details.advancements.toJson();
            case "villagers" -> list(details.villagers.stream().map(VillagerSnapshot::toJson).toList());
            case "enderChest" -> details.enderChest == null ? "null" : details.enderChest.toJson();
            case "performance" -> details.performance.toJson();
            case "build" -> details.build.toJson();
            case "icons" -> details.icons.toJson();
            default -> throw new IllegalArgumentException(field);
        };
    }

    static Object field(PlayerDetails details, String field) {
        if (details == null) return null;
        return switch (field) {
            case "world" -> details.world;
            case "motion" -> details.motion;
            case "xp" -> details.xp;
            case "portal" -> details.portal;
            case "pickups" -> details.pickups;
            case "advancements" -> details.advancements;
            case "villagers" -> details.villagers;
            case "enderChest" -> details.enderChest;
            case "performance" -> details.performance;
            case "build" -> details.build;
            case "icons" -> details.icons;
            default -> throw new IllegalArgumentException(field);
        };
    }

    private static String list(List<String> values) {
        return "[" + String.join(",", values) + "]";
    }
}
