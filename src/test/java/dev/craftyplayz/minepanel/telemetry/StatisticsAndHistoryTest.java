package dev.craftyplayz.minepanel.telemetry;

import java.util.List;
import java.util.Map;

public final class StatisticsAndHistoryTest {
    public static void main(String[] args) {
        testStatistics();
        testEvents();
        testProtocol();
        System.out.println("MinePanel statistics and gameplay history unit tests passed.");
    }

    private static void testStatistics() {
        StatisticsTracker tracker = new StatisticsTracker();
        var unknown = tracker.sample(Map.of());
        check(unknown.entries().size() == 10 && entry(unknown, "jump").cumulative() == null,
                "no packet value means unavailable, not zero");
        check(unknown.toJson().contains("\"cumulative\":null,\"session\":null"), "explicit unavailable serialization");
        var first = tracker.sample(Map.of("minecraft:jump", 50L, "minecraft:deaths", 0L));
        check(entry(first, "jump").session() == 0 && entry(first, "deaths").cumulative() == 0,
                "first synchronized observation establishes per-stat baseline; received zero remains valid");
        var changed = tracker.sample(Map.of("minecraft:jump", 54L));
        check(entry(changed, "jump").session() == 4, "session delta uses synchronized baseline");
        check(entry(tracker.sample(Map.of("minecraft:jump", 52L)), "jump").session() == 0,
                "decrease above initial baseline also invalidates session baseline");
        var reset = tracker.sample(Map.of("minecraft:jump", 2L));
        check(entry(reset, "jump").session() == 0, "counter decrease rebases without negative values");
        tracker.reset();
        check(entry(tracker.sample(Map.of("minecraft:jump", 60L)), "jump").session() == 0, "new session rebases");
        invalid(() -> tracker.sample(Map.of("minecraft:jump", -1L)));
        invalid(() -> new StatisticsSnapshot(List.of(first.entries().getFirst(), first.entries().getFirst())));
        invalid(() -> new StatisticsSnapshot.Entry(first.entries().getFirst().definition(), null, 0L));
        invalid(() -> new StatisticsSnapshot.Entry(first.entries().getFirst().definition(), 1L, 2L));
        immutable(() -> first.entries().clear());
    }

    private static void testEvents() {
        GameplayTracker tracker = new GameplayTracker();
        tracker.start(100);
        tracker.observe(101, "minecraft:overworld", false);
        tracker.observe(102, "minecraft:overworld", true);
        tracker.observe(103, "minecraft:overworld", true);
        check(tracker.snapshot().events().size() == 2, "death detected once on transition");
        tracker.observe(104, "minecraft:the_nether", false);
        check(tracker.snapshot().events().getLast().category().equals("dimension"), "dimension change recorded");
        tracker.observeKills(105, Map.of("minecraft:mob_kills", 8L));
        check(tracker.snapshot().events().size() == 3, "initial kills are not session events");
        tracker.observeKills(106, Map.of("minecraft:mob_kills", 10L));
        check(tracker.snapshot().events().getLast().details().contains("+2"), "reported aggregate kill delta");
        tracker.observeKills(107, Map.of("minecraft:mob_kills", 10L));
        tracker.observeKills(108, Map.of("minecraft:mob_kills", 1L));
        check(tracker.snapshot().events().size() == 4, "unchanged or reset stats do not invent kills");
        for (int index = 0; index < 150; index++) tracker.observe(200 + index, "minecraft:world_" + index, false);
        var full = tracker.snapshot();
        check(full.events().size() == 100 && full.events().getFirst().id() > 1, "history bounded and oldest evicted");
        tracker.disconnect(400);
        tracker.disconnect(401);
        check(!tracker.snapshot().active() && tracker.snapshot().events().getLast().label().equals("Disconnected"),
                "disconnect once retains stale session");
        check(full.active(), "snapshots are immutable after disconnect");
        tracker.start(500);
        check(tracker.snapshot().sessionId() == 2 && tracker.snapshot().events().size() == 1,
                "new connection clears old session");
        tracker.observe(501, "minecraft:overworld", true);
        check(tracker.snapshot().events().size() == 1, "joining already dead does not fabricate a death");
        immutable(() -> full.events().clear());
        invalid(() -> new GameplayHistory.Event(0, 0, "death", "Death", ""));
        invalid(() -> new GameplayHistory(0, false, List.of(
                new GameplayHistory.Event(2, 0, "death", "Death", ""),
                new GameplayHistory.Event(1, 0, "death", "Death", ""))));
    }

    private static void testProtocol() {
        TelemetryStore store = new TelemetryStore();
        GameplayTracker history = new GameplayTracker();
        history.start(100);
        StatisticsTracker tracker = new StatisticsTracker();
        var stats = tracker.sample(Map.of("minecraft:jump", 2L));
        check(update(store, 100, stats, history.snapshot()), "initial extended snapshot");
        PlayerSnapshot first = store.player();
        check(first.toJson().contains("\"schemaVersion\":2") && first.toJson().contains("\"statistics\":{\"entries\":[")
                && first.toJson().contains("\"history\":{\"sessionId\":1"), "full fields serialized");
        check(!update(store, 101, stats, history.snapshot()), "unchanged snapshot suppressed");
        var changed = tracker.sample(Map.of("minecraft:jump", 4L));
        update(store, 102, changed, history.snapshot());
        String delta = store.player().toDeltaJson(first);
        check(delta.contains("\"statistics\":") && delta.contains("\"session\":2")
                && !delta.contains("\"history\":") && !delta.contains("\"inventory\":"),
                "statistics delta replaces changed counters only, preserving existing inventory");
        PlayerSnapshot previous = store.player();
        history.observe(103, "minecraft:overworld", false);
        history.observe(104, "minecraft:the_end", false);
        update(store, 104, changed, history.snapshot());
        check(store.player().toDeltaJson(previous).contains("\"history\":")
                && !store.player().toDeltaJson(previous).contains("\"statistics\":"), "history-only replacement");
        history.disconnect(105);
        previous = store.player();
        store.markUnavailable(105, history.snapshot());
        check(store.player().toDeltaJson(previous).contains("\"statistics\":null")
                && store.player().toJson().contains("\"active\":false")
                && store.player().history().events().size() == 3, "disconnect clears live values but retains events");
        check(!store.markUnavailable(106, history.snapshot()), "unchanged unavailable state suppressed");
        history.start(107);
        update(store, 107, tracker.sample(Map.of()), history.snapshot());
        check(store.player().history().events().size() == 1 && store.player().history().sessionId() == 2,
                "new session publishes reset history");
        var escaped = new GameplayHistory(1, true, List.of(
                new GameplayHistory.Event(1, 0, "lifecycle", "Quote \"", "Line\n\\")));
        check(escaped.toJson().contains("Quote \\\"") && escaped.toJson().contains("Line\\n\\\\"),
                "event strings JSON escaped");
    }

    private static boolean update(TelemetryStore store, long time, StatisticsSnapshot stats, GameplayHistory history) {
        return store.updatePlayer(time, 0L, "minecraft:overworld", 0.0, 64.0, 0.0,
                20.0, 20.0, 0.0, InventorySnapshot.empty(), stats, history);
    }

    private static StatisticsSnapshot.Entry entry(StatisticsSnapshot snapshot, String id) {
        return snapshot.entries().stream().filter(value -> value.definition().id().equals("minecraft:" + id))
                .findFirst().orElseThrow();
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void invalid(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid value rejection");
    }

    private static void immutable(Runnable action) {
        try { action.run(); } catch (UnsupportedOperationException expected) { return; }
        throw new AssertionError("Expected immutable collection");
    }
}
