package dev.craftyplayz.minepanel.build;

import dev.craftyplayz.minepanel.telemetry.GameplayHistory;
import dev.craftyplayz.minepanel.telemetry.InventorySnapshot;
import dev.craftyplayz.minepanel.telemetry.ItemSnapshot;
import dev.craftyplayz.minepanel.telemetry.PlayerDetails;
import dev.craftyplayz.minepanel.telemetry.PlayerSnapshot;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/** Litematica build progress without the game: classification, scanning, caching, materials and the wire format. */
public final class BuildProgressTest {
    private static final int AIR = 0;
    private static final int STONE = 1;
    private static final int DIRT = 2;
    private static final int WHEAT_YOUNG = 3;
    private static final int WHEAT_GROWN = 4;
    private static final int WATER = 5;
    private static final int SLAB_DOUBLE = 6;
    private static final long NO_LIMIT = Long.MAX_VALUE;

    public static void main(String[] args) {
        testClassification();
        testCountingAndScanning();
        testReadinessAndBudget();
        testCaching();
        testMaterials();
        testWireFormat();
        System.out.println("MinePanel build progress unit tests passed.");
    }

    private static void testClassification() {
        check(classify(STONE, STONE) == BuildRules.Result.PLACED, "matching block is placed");
        check(classify(AIR, AIR) == BuildRules.Result.NONE, "air on air counts for nothing");
        check(classify(STONE, AIR) == BuildRules.Result.MISSING, "air where a block belongs is missing");
        check(classify(STONE, DIRT) == BuildRules.Result.WRONG, "another block is wrong");
        check(classify(AIR, DIRT) == BuildRules.Result.EXTRA, "a block where the schematic has air is extra");
        check(classify(AIR, WATER) == BuildRules.Result.NONE, "ignorable fluids are not extra");
        check(classify(WHEAT_YOUNG, WHEAT_GROWN) == BuildRules.Result.PLACED, "crop age is ignored when enabled");
        check(BuildRules.classify(false, false, false, () -> false, () -> true, () -> false)
                == BuildRules.Result.PLACED, "an ignored mismatch is accepted as placed");
        check(BuildRules.classify(true, false, false, () -> false, () -> true, () -> false)
                == BuildRules.Result.NONE, "an ignored extra block is not extra");
        check(BuildRules.classify(false, false, false, () -> false, () -> false, () -> true)
                == BuildRules.Result.WRONG, "the ignore list only applies to extra blocks");
    }

    private static void testCountingAndScanning() {
        var source = new FakeSource();
        var placement = source.add("a");
        placement.region(STONE, STONE, AIR, DIRT, WHEAT_YOUNG, AIR, STONE, STONE);
        placement.chunk(0, 0, STONE, STONE, STONE, AIR, AIR, DIRT, AIR, AIR); // placed, missing, extra
        placement.chunk(1, 0, DIRT, DIRT, WHEAT_YOUNG, WHEAT_GROWN, STONE, DIRT); // placed, placed (age), wrong
        placement.chunk(2, 0, STONE, AIR); // not ready: unchecked
        placement.makeReady(0, 0);
        placement.makeReady(1, 0);
        var tracker = new BuildTracker();
        check(tracker.snapshot(null, item -> null).equals(BuildProgress.NO_PLACEMENT), "nothing selected yet");
        // A clock that runs out after every check: counting resumes across ticks without losing blocks.
        LongSupplier stopped = () -> 0;
        tracker.tick(source, 0, stopped, 10);
        check("counting".equals(tracker.snapshot(null, item -> null).reason()), "counting is reported first");
        for (int tick = 0; tick < 10; tick++) tracker.tick(source, NO_LIMIT, () -> 0, 20);
        var progress = tracker.snapshot(null, item -> null).placement();
        check(progress.total() == 6, "total counts non-air schematic blocks: " + progress);
        check(progress.placed() == 3 && progress.wrong() == 1 && progress.extra() == 1,
                "placed, wrong and extra from scanned chunks: " + progress);
        check(progress.uncheckedChunks() == 1 && !progress.scanComplete() && progress.checkedAt() == 20,
                "an unloaded chunk stays unchecked: " + progress);
        check(placement.counted == 8, "each container position is read once: " + placement.counted);
    }

    private static void testReadinessAndBudget() {
        var source = new FakeSource();
        var placement = source.add("big");
        int chunks = BuildTracker.MAX_CHECKS_PER_TICK + 44;
        placement.region(new int[chunks]);
        java.util.Arrays.fill(placement.region, STONE);
        for (int x = 0; x < chunks; x++) placement.chunk(x, 0, STONE, STONE);
        var tracker = new BuildTracker();
        tracker.tick(source, NO_LIMIT, () -> 0, 1);
        check(placement.readyChecks == BuildTracker.MAX_CHECKS_PER_TICK, "readiness checks are capped per tick");
        placement.readyChecks = 0;
        tracker.tick(source, NO_LIMIT, () -> 0, 1);
        check(placement.readyChecks == BuildTracker.MAX_CHECKS_PER_TICK, "not-ready chunks rotate to the back");
        for (int x = 0; x < chunks; x++) placement.makeReady(x, 0);
        long[] now = {0};
        // Each clock read advances 1 ns; the deadline allows a handful of scans.
        tracker.tick(source, 5, () -> now[0]++, 2);
        int scanned = placement.scans;
        check(scanned > 0 && scanned < 6, "scanning stops at the deadline: " + scanned);
        for (int tick = 0; tick < 10; tick++) tracker.tick(source, NO_LIMIT, () -> 0, 3);
        var progress = tracker.snapshot(null, item -> null).placement();
        check(placement.scans == chunks && progress.placed() == chunks && progress.scanComplete(),
                "the cursor resumes until every chunk was scanned once: " + placement.scans);
    }

    private static void testCaching() {
        var source = new FakeSource();
        var a = source.add("a");
        a.region(STONE);
        a.chunk(0, 0, STONE, AIR);
        a.makeReady(0, 0);
        var tracker = new BuildTracker();
        tracker.tick(source, NO_LIMIT, () -> 0, 1);
        check(placed(tracker) == 0, "missing block");
        a.set(0, 0, 0, STONE);
        tracker.tick(source, NO_LIMIT, () -> 0, 2);
        check(placed(tracker) == 0 && a.scans == 1, "unmarked changes are not rescanned");
        tracker.markBlockChanged(5, 9);
        tracker.tick(source, NO_LIMIT, () -> 0, 3);
        check(placed(tracker) == 1 && a.scans == 2, "a block change rescans its chunk");
        a.makeNotReady(0, 0);
        tracker.tick(source, NO_LIMIT, () -> 0, 4);
        check(placed(tracker) == 1, "results survive the chunk unloading");
        a.set(0, 0, 0, AIR);
        tracker.markChunkLoaded(0, 0);
        tracker.tick(source, NO_LIMIT, () -> 0, 5);
        var waiting = tracker.snapshot(null, item -> null).placement();
        check(waiting.placed() == 1 && !waiting.scanComplete(), "a changed chunk keeps its last result until ready");
        a.makeReady(0, 0);
        tracker.tick(source, NO_LIMIT, () -> 0, 6);
        check(placed(tracker) == 0 && tracker.snapshot(null, item -> null).placement().scanComplete(),
                "a reloaded chunk is compared again");
        tracker.markBlockChanged(100, 100);
        tracker.tick(source, NO_LIMIT, () -> 0, 7);
        check(a.scans == 3, "changes outside the placement are ignored");

        a.set(0, 0, 0, STONE);
        a.fingerprint = "moved";
        tracker.tick(source, NO_LIMIT, () -> 0, 8);
        check(a.scans == 4 && placed(tracker) == 1, "a moved placement is counted from scratch");

        for (String id : List.of("b", "c", "d", "e")) {
            var other = source.add(id);
            other.region(STONE);
            other.chunk(0, 0, STONE, STONE);
            other.makeReady(0, 0);
            tracker.tick(source, NO_LIMIT, () -> 0, 9);
        }
        source.selected = a;
        tracker.tick(source, NO_LIMIT, () -> 0, 10);
        check(a.scans == 5, "only the last " + BuildTracker.MAX_PLACEMENTS + " placements are cached");
        source.selected = source.placements.get("e");
        tracker.tick(source, NO_LIMIT, () -> 0, 11);
        check(source.placements.get("e").scans == 1, "a recent placement is reused without rescanning");
        source.selected = null;
        tracker.tick(source, NO_LIMIT, () -> 0, 12);
        check(tracker.snapshot(null, item -> null).equals(BuildProgress.NO_PLACEMENT), "deselecting clears the tile");
        tracker.disable("error");
        tracker.tick(source, NO_LIMIT, () -> 0, 13);
        check(tracker.disabled() && tracker.snapshot(null, item -> null).equals(BuildProgress.unavailable("error")),
                "a disabled tracker stays unavailable");
    }

    private static void testMaterials() {
        var source = new FakeSource();
        var placement = source.add("m");
        placement.region(STONE, STONE, STONE, DIRT, SLAB_DOUBLE, SLAB_DOUBLE, WHEAT_YOUNG);
        placement.chunk(0, 0, STONE, STONE, STONE, AIR, STONE, AIR, DIRT, DIRT, SLAB_DOUBLE, AIR, SLAB_DOUBLE, AIR);
        // WHEAT_YOUNG stays unchecked in chunk 1, which is never ready.
        placement.chunk(1, 0, WHEAT_YOUNG, AIR);
        placement.makeReady(0, 0);
        var tracker = new BuildTracker();
        tracker.tick(source, NO_LIMIT, () -> 0, 1);
        var stone = item("minecraft:stone", "Stone", 1, null);
        var shulker = item("minecraft:shulker_box", "Shulker Box", 1,
                List.of(item("minecraft:stone_slab", "Stone Slab", 3, null), ItemSnapshot.emptyItem()));
        var inventory = InventorySnapshot.collect(index -> switch (index) {
            case 0 -> stone;
            case 1 -> shulker;
            default -> ItemSnapshot.emptyItem();
        }, 0, key -> key.equals("offhand") ? item("minecraft:stone", "Stone", 5, null) : ItemSnapshot.emptyItem());
        var progress = tracker.snapshot(inventory, id -> id.equals("minecraft:wheat_seeds") ? null
                : item(id, id.substring(10).toUpperCase(), 1, null));
        Map<String, BuildProgress.Material> rows = new HashMap<>();
        for (var row : progress.materials()) rows.put(row.itemId(), row);
        check(rows.get("minecraft:stone").left() == 2 && rows.get("minecraft:stone").have() == 6,
                "left is schematic minus placed; have counts slots and offhand: " + rows);
        check(rows.get("minecraft:stone_slab").left() == 4 && rows.get("minecraft:stone_slab").have() == 3,
                "multi-item states and shulker contents: " + rows);
        check(!rows.containsKey("minecraft:dirt"), "fully placed items are not listed");
        check(rows.get("minecraft:wheat_seeds").left() == 1 && rows.get("minecraft:wheat_seeds").name()
                .equals("minecraft:wheat_seeds") && rows.get("minecraft:wheat_seeds").icon() == null,
                "unchecked blocks are still needed; unknown items fall back to their ID");
        check(progress.materials().get(0).itemId().equals("minecraft:stone_slab")
                        && progress.materials().get(progress.materials().size() - 1).itemId().equals("minecraft:stone"),
                "sorted by still needed, then left, covered rows last: " + progress.materials());
        check(BuildTracker.carried(null).isEmpty(), "no inventory, nothing carried");

        var many = new FakeSource();
        var big = many.add("big");
        int[] states = new int[200];
        for (int index = 0; index < states.length; index++) states[index] = 100 + index;
        big.region(states);
        var crowded = new BuildTracker();
        crowded.tick(many, NO_LIMIT, () -> 0, 1);
        check(crowded.snapshot(null, id -> null).materials().size() == BuildProgress.MAX_MATERIALS,
                "the material list is bounded");
    }

    private static void testWireFormat() {
        var placement = new BuildProgress.Placement("id-1", "House \"A\"", 10, 4, 1, 2, 3, false, 99);
        var material = new BuildProgress.Material("minecraft:stone", "Stone", "s1", 6, 2);
        var build = new BuildProgress(true, null, placement, List.of(material));
        check(build.toJson().equals("{\"available\":true,\"reason\":null,\"placement\":{\"id\":\"id-1\","
                        + "\"name\":\"House \\\"A\\\"\",\"total\":10,\"placed\":4,\"wrong\":1,\"extra\":2,"
                        + "\"uncheckedChunks\":3,\"scanComplete\":false,\"checkedAt\":99},\"materials\":[{\"itemId\":"
                        + "\"minecraft:stone\",\"name\":\"Stone\",\"icon\":\"s1\",\"left\":6,\"have\":2}]}"),
                "build JSON: " + build.toJson());
        check(BuildProgress.MISSING.toJson().equals(
                "{\"available\":false,\"reason\":\"missing\",\"placement\":null,\"materials\":[]}"), "unavailable JSON");
        invalid(() -> new BuildProgress(true, null, null, List.of()));
        invalid(() -> new BuildProgress(true, "missing", null, List.of()));
        invalid(() -> new BuildProgress(false, "none", null, List.of()));
        invalid(() -> new BuildProgress(false, "error", placement, List.of()));
        invalid(() -> new BuildProgress(true, "none", null, List.of(material)));
        invalid(() -> new BuildProgress.Placement("id", "n", 3, 3, 1, 0, 0, true, 0));
        invalid(() -> new BuildProgress.Placement("id", "", 3, 1, 0, 0, 0, true, 0));
        invalid(() -> new BuildProgress.Material("minecraft:stone", "Stone", null, 0, 0));

        var details = PlayerDetails.placeholder();
        var before = new PlayerSnapshot(1, 1, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), details);
        check(before.toJson().contains("\"schemaVersion\":4") && before.toJson().contains("\"build\":{\"available\":false"),
                "schema version 4 carries the build field");
        var withBuild = new PlayerDetails(details.world(), details.motion(), details.xp(), details.portal(),
                details.pickups(), null, List.of(), null, details.performance(), build);
        var after = new PlayerSnapshot(2, 2, true, 0L, "minecraft:overworld", 0.0, 0.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), null, GameplayHistory.empty(), 20, 5.0, List.of(), withBuild);
        String delta = after.toDeltaJson(before);
        check(delta.contains(",\"build\":" + build.toJson()) && !delta.contains("\"motion\""),
                "a build change is sent whole on its own: " + delta);
        check(!after.toDeltaJson(after).contains("\"build\""), "an unchanged build field is not resent");
    }

    private static BuildRules.Result classify(int expected, int actual) {
        return FakePlacement.classify(expected, actual);
    }

    private static long placed(BuildTracker tracker) {
        return tracker.snapshot(null, item -> null).placement().placed();
    }

    private static ItemSnapshot item(String id, String name, int count, List<ItemSnapshot> contents) {
        return new ItemSnapshot(false, id, name, count, 64, null, null, List.of(), "i" + count, false, List.of(),
                contents);
    }

    private static final class FakeSource implements BuildSource {
        final Map<String, FakePlacement> placements = new HashMap<>();
        FakePlacement selected;

        FakePlacement add(String id) {
            var placement = new FakePlacement(id);
            placements.put(id, placement);
            selected = placement;
            return placement;
        }

        @Override
        public Placement selected() {
            return selected;
        }

        @Override
        public List<Requirement> requirements(int stateId) {
            return switch (stateId) {
                case STONE -> List.of(new Requirement("minecraft:stone", 1));
                case DIRT -> List.of(new Requirement("minecraft:dirt", 1));
                case WHEAT_YOUNG, WHEAT_GROWN -> List.of(new Requirement("minecraft:wheat_seeds", 1));
                case SLAB_DOUBLE -> List.of(new Requirement("minecraft:stone_slab", 2));
                case WATER -> List.of(new Requirement("minecraft:water_bucket", 1));
                default -> stateId >= 100 ? List.of(new Requirement("minecraft:item_" + stateId, 1)) : List.of();
            };
        }
    }

    /** One region container plus chunks of (expected, actual) state pairs. */
    private static final class FakePlacement implements BuildSource.Placement {
        final String id;
        String fingerprint = "origin";
        int[] region = new int[0];
        final Map<Long, int[]> chunks = new java.util.LinkedHashMap<>();
        final Set<Long> ready = new HashSet<>();
        int counted;
        int scans;
        int readyChecks;

        FakePlacement(String id) {
            this.id = id;
        }

        void region(int... states) {
            region = states;
        }

        void chunk(int x, int z, int... pairs) {
            chunks.put(BuildTracker.chunkKey(x, z), pairs);
        }

        void set(int x, int z, int pair, int actual) {
            chunks.get(BuildTracker.chunkKey(x, z))[pair * 2 + 1] = actual;
        }

        void makeReady(int x, int z) {
            ready.add(BuildTracker.chunkKey(x, z));
        }

        void makeNotReady(int x, int z) {
            ready.remove(BuildTracker.chunkKey(x, z));
        }

        static BuildRules.Result classify(int expected, int actual) {
            return BuildRules.classify(expected == AIR, actual == AIR, expected == actual,
                    () -> expected == WHEAT_YOUNG && actual == WHEAT_GROWN, () -> false, () -> actual == WATER);
        }

        @Override
        public String id() {
            return id;
        }

        @Override
        public String name() {
            return "Placement " + id;
        }

        @Override
        public String fingerprint() {
            return fingerprint;
        }

        @Override
        public long[] chunks() {
            return chunks.keySet().stream().mapToLong(Long::longValue).toArray();
        }

        @Override
        public int regionCount() {
            return 1;
        }

        @Override
        public long regionVolume(int index) {
            return region.length;
        }

        @Override
        public int stateAt(int index, long position) {
            counted++;
            return region[(int) position];
        }

        @Override
        public boolean isAir(int stateId) {
            return stateId == AIR;
        }

        @Override
        public boolean ready(int chunkX, int chunkZ) {
            readyChecks++;
            return ready.contains(BuildTracker.chunkKey(chunkX, chunkZ));
        }

        @Override
        public void scan(int chunkX, int chunkZ, ChunkCounts counts) {
            scans++;
            int[] pairs = chunks.get(BuildTracker.chunkKey(chunkX, chunkZ));
            for (int index = 0; index < pairs.length; index += 2) {
                counts.add(classify(pairs[index], pairs[index + 1]), pairs[index]);
            }
        }
    }

    private static void invalid(Runnable constructor) {
        try {
            constructor.run();
        } catch (IllegalArgumentException | NullPointerException expected) {
            return;
        }
        throw new AssertionError("Expected rejection");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
