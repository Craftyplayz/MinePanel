package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
import java.util.List;

/** Portal linking, experience rates, pickups, world logging and the new snapshot fields. */
public final class WorldFeaturesTest {
    public static void main(String[] args) {
        testExperience();
        testPortals();
        testPickups();
        testWorldLogging();
        testContentsAndDetails();
        testFrameStats();
        testSensorsAndRegistries();
        System.out.println("MinePanel world feature unit tests passed.");
    }

    private static void testExperience() {
        for (int level = 0; level < 200; level++) {
            check(XpTracker.pointsAtLevel(level + 1) - XpTracker.pointsAtLevel(level) == XpTracker.neededForNextLevel(level),
                    "total points and per-level cost agree at level " + level);
        }
        check(XpTracker.pointsAtLevel(30) == 1395 && XpTracker.pointsAtLevel(100) == 30970, "known vanilla totals");
        XpTracker tracker = new XpTracker();
        var start = tracker.observe(1_000_000, 5, 0.0F);
        check(start.points() == 55 && start.gained().get(60) == 0, "the first observation is only a baseline");
        tracker.observe(1_010_000, 5, 0.5F);
        var later = tracker.observe(1_050_000, 6, 0.0F);
        check(later.gained().get(60) == 17 && later.gained().get(10) == 8 && later.gained().get(30) == 8,
                "gains are summed per window: " + later.gained());
        tracker.observe(1_051_000, 1, 0.0F);
        var spent = tracker.observe(1_052_000, 1, 0.5F);
        check(spent.gained().get(60) == 22, "spending levels is not a negative gain; later gains still count");
        var expired = tracker.observe(1_052_000 + 3_601_000, 1, 0.5F);
        check(expired.gained().values().stream().allMatch(value -> value == 0), "gains older than an hour expire");
        check(expired.toJson().contains("\"gained\":{\"10\":0,\"30\":0,\"60\":0,\"300\":0,\"600\":0,\"3600\":0}"),
                "every window is serialized");
    }

    private static void testPortals() {
        PortalTracker tracker = new PortalTracker();
        tracker.observe(0, PortalTracker.OVERWORLD, 803, 64, -1605, false);
        tracker.observe(10, PortalTracker.OVERWORLD, 803, 64, -1605, true);
        tracker.observe(4000, PortalTracker.NETHER, 99, 70, -200, false);
        var crossing = tracker.crossing();
        check(crossing != null && crossing.from().equals(new PortalTracker.Point(803, 64, -1605))
                        && crossing.target().equals(new PortalTracker.Point(100, 64, -201)),
                "Overworld → Nether targets the entered portal divided by 8 (rounded down)");
        tracker.obsidianPlaced(4100, 101, 70, -203);
        var state = tracker.state();
        check(state.obsidian().size() == 1 && state.toJson().contains("\"obsidian\":[{\"id\":"), "obsidian is tracked");
        tracker.observe(5000, PortalTracker.NETHER, 99, 70, -200, true);
        tracker.observe(9000, PortalTracker.OVERWORLD, 790, 64, -1600, false);
        check(tracker.crossing().target().equals(new PortalTracker.Point(792, 70, -1600))
                        && tracker.state().obsidian().isEmpty(),
                "Nether → Overworld multiplies by 8 and a new trip clears old obsidian");
        long id = tracker.crossing().id();
        tracker.observe(9100, PortalTracker.NETHER, 0, 64, 0, false);
        check(tracker.crossing().id() == id, "a dimension change without standing in a portal (respawn, /tp) is ignored");
        tracker.observe(9200, "minecraft:the_end", 0, 64, 0, false);
        check(tracker.crossing().id() == id, "End travel is not a Nether portal trip");
        tracker.lit(new PortalTracker.Point(792, 71, -1599));
        check(tracker.state().toJson().endsWith("\"lit\":{\"x\":792,\"y\":71,\"z\":-1599}}"), "a lit portal is reported");
        tracker.reset();
        check(tracker.state() == PortalTracker.State.EMPTY
                && tracker.state().toJson().equals("{\"crossing\":null,\"obsidian\":[],\"lit\":null}"), "reset clears");
    }

    private static void testPickups() {
        PickupTracker tracker = new PickupTracker();
        var stone = item("minecraft:cobblestone", "Cobblestone");
        tracker.add(1000, "stone", "Picked up", stone, 3);
        tracker.add(2000, "stone", "Picked up", stone, 5);
        tracker.add(2500, "stone", "from Chest", stone, 64);
        check(tracker.pickups().size() == 2 && tracker.pickups().getFirst().count() == 8
                        && tracker.pickups().getLast().source().equals("from Chest"),
                "the same item and source merge; a different source is its own entry");
        tracker.add(9000, "stone", "Picked up", stone, 1);
        check(tracker.pickups().size() == 3 && tracker.pickups().getLast().count() == 1, "old entries do not merge");
        tracker.add(9100, "stone", "Picked up", stone, -2);
        check(tracker.pickups().size() == 4 && tracker.pickups().getLast().count() == -2
                && tracker.pickups().getLast().toJson().contains("\"count\":-2"), "removals are their own entry");
        tracker.add(9200, "stone", "Picked up", stone, -1);
        check(tracker.pickups().size() == 4 && tracker.pickups().getLast().count() == -3, "removals merge with removals");
        for (int index = 0; index < 40; index++) tracker.add(10_000 + index * 10_000L, "k" + index, "Crafted", stone, 1);
        check(tracker.pickups().size() == PickupTracker.MAX_PICKUPS, "the list is bounded");
        invalid(() -> new PickupTracker.Pickup(1, 0, "", stone, 1));
        invalid(() -> new PickupTracker.Pickup(1, 0, "Used", stone, 0));
    }

    private static void testWorldLogging() {
        List<GameplayHistory.Event> archived = new ArrayList<>();
        GameplayTracker tracker = new GameplayTracker(archived::add);
        tracker.start(0);
        tracker.observeWorld(100, "minecraft:plains", "Plains", "clear", 12, 0, 64, 0);
        tracker.observeWorld(1000, "minecraft:forest", "Forest", "clear", 12, 10, 64, 0);
        tracker.observeWorld(3000, "minecraft:plains", "Plains", "clear", 12, 0, 64, 0);
        tracker.observeWorld(9000, "minecraft:plains", "Plains", "clear", 12, 0, 64, 0);
        tracker.observeWorld(10_000, "minecraft:desert", "Desert", "clear", 12, 30, 70, 5);
        tracker.observeWorld(14_000, "minecraft:desert", "Desert", "rain", 12, 30, 70, 5);
        tracker.observeWorld(15_100, "minecraft:desert", "Desert", "thunder", 13, 30, 70, 5);
        tracker.observeWorld(16_000, "minecraft:desert", "Desert", "clear", 15, 30, 70, 5);
        var labels = tracker.snapshot().events().stream().map(GameplayHistory.Event::label).toList();
        check(labels.equals(List.of("Session started", "Day 12", "Rain started", "Entered Desert", "Thunderstorm started",
                "Day 13 began", "Thunderstorm ended", "Day 15 began")), "world events: " + labels);
        var desert = tracker.snapshot().events().stream().filter(event -> event.category().equals("biome")).findFirst();
        check(desert.isPresent() && desert.get().details().equals("From Plains · at 30, 70, 5"),
                "a brief biome visit is not logged; one held for 5 seconds is");
        check(tracker.snapshot().events().getLast().details().equals("Skipped 1 day"), "skipped days are noted");
    }

    private static void testContentsAndDetails() {
        var inner = item("minecraft:diamond", "Diamond");
        var shulker = new ItemSnapshot(false, "minecraft:shulker_box", "Shulker Box", 1, 1, null, null, List.of(),
                null, false, List.of(), List.of(inner, ItemSnapshot.emptyItem()));
        check(shulker.toJson().endsWith("\"contents\":[" + inner.toJson() + "," + ItemSnapshot.emptyItem().toJson() + "]}"),
                "contents are serialized in slot order");
        invalid(() -> new ItemSnapshot(false, "minecraft:bundle", "Bundle", 1, 1, null, null, List.of(), null, false,
                List.of(), List.of(shulker)));
        invalid(() -> new ItemSnapshot(true, null, null, 0, 0, null, null, List.of(), null, false, List.of(), List.of()));
        var details = PlayerDetails.placeholder();
        var snapshot = new PlayerSnapshot(1, 1, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), details);
        String json = snapshot.toJson();
        for (String field : PlayerDetails.FIELDS) check(json.contains("\"" + field + "\":"), field + " is serialized");
        var moved = new PlayerDetails(details.world(), Motion.rounded("elytra", 30.04, 29.96, -1.2, 359.6, 12.3,
                details.motion().icon(), null), details.xp(), details.portal(), details.pickups(), null, List.of(), null,
                details.performance(), details.build(), details.icons());
        var next = new PlayerSnapshot(2, 2, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), moved);
        String delta = next.toDeltaJson(snapshot);
        check(delta.contains("\"motion\":{\"mode\":\"elytra\",\"speed\":30.0,\"horizontalSpeed\":30.0,"
                        + "\"verticalSpeed\":-1.2,\"yaw\":0.0,\"pitch\":12.0") && !delta.contains("\"world\""),
                "only changed detail fields are sent, rounded: " + delta);
        invalid(() -> new WorldInfo("server", "x", "minecraft:plains", "Plains", "snow", 0, 0, "survival"));
        invalid(() -> new VillagerSnapshot("not-a-uuid", "minecraft:librarian", "Librarian", 1, null,
                "minecraft:overworld", 0, 0, 0, 0, 0, List.of()));
    }

    private static void testFrameStats() {
        check(FrameStats.Performance.EMPTY.toJson().equals(
                "{\"fps\":[],\"windows\":{\"10\":null,\"30\":null,\"60\":null,\"600\":null}}"), "nothing measured yet");
        long ms = 1_000_000L;
        long start = 5_000 * ms;
        FrameStats steady = new FrameStats();
        steady.frame(start);
        for (int frame = 1; frame <= 2000; frame++) steady.frame(start + frame * 10 * ms);
        var performance = steady.snapshot();
        check(performance == steady.snapshot(), "the snapshot is reused until another second closes");
        check(performance.fps().size() == 20 && performance.fps().get(0) == 99
                && performance.fps().subList(1, 20).stream().allMatch(fps -> fps == 100),
                "frames are counted in the second they ended: " + performance.fps());
        var ten = performance.windows().get(10);
        check(ten.seconds() == 10 && ten.average() == 100 && ten.low() >= 98 && ten.low() <= 100,
                "a steady 100 fps: " + ten);
        check(performance.windows().get(60).seconds() == 20 && performance.windows().get(600).seconds() == 20,
                "longer windows hold what has been measured so far");

        // A 3.5 s stall: the second it began in has one frame, the next two have none.
        steady.frame(start + 23_500 * ms);
        var stalled = steady.snapshot().fps();
        check(stalled.size() == 23 && stalled.subList(20, 23).equals(List.of(1, 0, 0)), "a stall shows as 0 fps: " + stalled);

        FrameStats stutter = new FrameStats();
        long now = start;
        stutter.frame(now);
        for (int frame = 1; now < start + 12_000 * ms; frame++) {
            now += (frame % 50 == 0 ? 50 : 10) * ms;
            stutter.frame(now);
        }
        var stutters = stutter.snapshot().windows().get(10);
        check(stutters.low() >= 19 && stutters.low() <= 21 && stutters.average() > 85 && stutters.average() < 100,
                "the 1% low is the slowest frames' rate, not the average: " + stutters);

        steady.frame(start + 800_000 * ms);
        var idle = steady.snapshot();
        check(idle.fps().size() == FrameStats.HISTORY_SECONDS && idle.fps().stream().allMatch(fps -> fps == 0)
                && idle.windows().values().stream().allMatch(window -> window.average() == 0 && window.low() == 0),
                "a stall longer than the history empties every window");
        check(idle.windows().get(600).seconds() == 600, "the longest window is full");
        invalid(() -> new FrameStats.Window(10, 50, 60));
    }

    private static ItemSnapshot item(String id, String name) {
        return new ItemSnapshot(false, id, name, 1, 64, null, null, List.of());
    }

    private static void testSensorsAndRegistries() {
        var nearby = new Sensors.Nearby(16, List.of(new Sensors.Entity("minecraft:zombie", true, Sensors.tenths(3.04))));
        var sensors = new Sensors(4, 120, 280, 300, 12, true, false, false, true, false, false, false, "minecraft:boat",
                "fishing", false, true, new Sensors.Light(3, 15, 12), new Sensors.Look("none", null, null), nearby, "chest");
        check(sensors.toJson().equals("{\"moonPhase\":4,\"spawnDistance\":120,\"air\":280,\"maxAir\":300,\"armor\":12,"
                + "\"onFire\":true,\"inWater\":false,\"inLava\":false,\"inRain\":true,\"sneaking\":false,"
                + "\"sprinting\":false,\"sleeping\":false,\"riding\":\"minecraft:boat\",\"using\":\"fishing\","
                + "\"bossBar\":false,\"raid\":true,\"light\":{\"block\":3,\"sky\":15,\"combined\":12},"
                + "\"look\":{\"kind\":\"none\",\"id\":null,\"distance\":null},\"nearby\":{\"radius\":16,"
                + "\"entities\":[{\"type\":\"minecraft:zombie\",\"hostile\":true,\"distance\":3.0}]},"
                + "\"screen\":\"chest\"}"), "sensors serialize every field: " + sensors.toJson());
        check(Sensors.EMPTY.toJson().contains("\"light\":null,\"look\":null,\"nearby\":null,\"screen\":null"),
                "costly sensors are null until a rule reads them");
        invalid(() -> new Sensors(8, null, 300, 300, 0, false, false, false, false, false, false, false, null, null,
                false, false, null, null, null, null));
        invalid(() -> new Sensors(0, null, 300, 300, 0, false, false, false, false, false, false, false, null, "napping",
                false, false, null, null, null, null));
        invalid(() -> new Sensors(0, null, 300, 300, 0, false, false, false, false, false, false, false, null, null,
                false, false, null, null, null, "chat"));
        invalid(() -> new Sensors.Light(16, 0, 0));
        invalid(() -> new Sensors.Look("block", null, 2.0));
        invalid(() -> new Sensors.Look("none", "minecraft:stone", null));
        invalid(() -> new Sensors.Nearby(65, List.of()));
        invalid(() -> new Sensors.Entity("Zombie", true, 1));
        invalid(() -> new SensorNeeds(false, 65, 0, false));

        var registries = new Registries(List.of(new Registries.Entry("minecraft:stone", "Stone", "e0-1a")), List.of(),
                List.of(), List.of(), List.of(), List.of(new Registries.Entry("minecraft:custom/minecraft:jump", "Jumps", null)));
        check(registries.toJson().equals("{\"items\":[{\"id\":\"minecraft:stone\",\"name\":\"Stone\",\"icon\":\"e0-1a\"}],"
                + "\"blocks\":[],\"entities\":[],\"effects\":[],\"biomes\":[],\"stats\":[{\"id\":"
                + "\"minecraft:custom/minecraft:jump\",\"name\":\"Jumps\",\"icon\":null}]}"), "registries serialize: "
                + registries.toJson());
        invalid(() -> new Registries.Entry("Stone", "Stone", null));
        invalid(() -> new Registries.Entry("minecraft:stone", "", null));
        invalid(() -> new Registries.Entry("minecraft:stone", "Stone", "Bad Icon"));

        var details = PlayerDetails.placeholder();
        var before = new PlayerSnapshot(1, 1, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), details);
        var withSensors = new PlayerDetails(details.world(), details.motion(), details.xp(), details.portal(),
                details.pickups(), null, List.of(), null, details.performance(), details.build(), details.icons(), sensors,
                registries);
        var after = new PlayerSnapshot(2, 2, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), withSensors);
        String delta = after.toDeltaJson(before);
        check(delta.contains(",\"sensors\":" + sensors.toJson()) && delta.contains(",\"registries\":" + registries.toJson())
                && !delta.contains("\"motion\""), "sensors and registries are sent whole when they change: " + delta);
        var resent = new PlayerSnapshot(3, 3, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), withSensors);
        check(!resent.toDeltaJson(after).contains("\"registries\""), "unchanged registries are not resent");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void invalid(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid value rejection");
    }
}
