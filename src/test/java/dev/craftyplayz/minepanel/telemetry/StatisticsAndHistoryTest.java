package dev.craftyplayz.minepanel.telemetry;

import java.util.ArrayList;
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
        List<GameplayHistory.Event> archived = new ArrayList<>();
        GameplayTracker tracker = new GameplayTracker(archived::add);
        tracker.start(100);
        tracker.observe(101, "minecraft:overworld", false);
        tracker.observe(102, "minecraft:overworld", true);
        tracker.observe(103, "minecraft:overworld", true);
        check(tracker.snapshot().events().size() == 1, "death waits briefly for the server's death message");
        tracker.observe(102 + GameplayTracker.DEATH_MESSAGE_GRACE_MILLIS, "minecraft:overworld", true);
        check(last(tracker).category().equals("death") && last(tracker).details().contains("no death message"),
                "death without a message is still logged once");
        tracker.deathMessage(2000, "Steve was slain by Zombie");
        check(tracker.snapshot().events().size() == 2, "late death message does not duplicate the death");
        tracker.observe(2001, "minecraft:overworld", false);
        check(last(tracker).label().equals("Respawned"), "respawn recorded");
        tracker.observe(2002, "minecraft:overworld", true);
        tracker.deathMessage(2003, "Steve fell from a high place");
        check(last(tracker).details().equals("Steve fell from a high place"), "death message becomes the details");
        tracker.observe(2004 + GameplayTracker.DEATH_MESSAGE_GRACE_MILLIS, "minecraft:overworld", true);
        check(count(tracker, "death") == 2, "a death with a message is not logged again by the fallback");
        tracker.observe(5000, "minecraft:the_nether", false);
        check(tracker.snapshot().events().stream().anyMatch(event -> event.category().equals("dimension")),
                "dimension change recorded");

        tracker.blockMined(6000, "minecraft:stone", "Stone", 1, 64, 2);
        tracker.blockMined(6100, "minecraft:stone", "Stone", 1, 63, 2);
        tracker.blockMined(6200, "minecraft:stone", "Stone", 1, 62, 2);
        check(last(tracker).label().equals("Mined 3 × Stone") && last(tracker).details().equals("Last at 1, 62, 2"),
                "repeated mining of one block type is merged into one event");
        long minedId = last(tracker).id();
        tracker.blockMined(6200 + GameplayTracker.COALESCE_MILLIS + 1, "minecraft:stone", "Stone", 0, 0, 0);
        check(last(tracker).id() != minedId && last(tracker).label().equals("Mined Stone"),
                "a pause starts a new mining event");
        tracker.blockPlaced(13000, "minecraft:oak_planks", "Oak Planks", 4, 65, 4);
        tracker.blockMined(13100, "minecraft:stone", "Stone", 0, 0, 0);
        check(last(tracker).label().equals("Mined Stone"), "different actions in between end merging");
        tracker.itemDropped(13200, "minecraft:dirt", "Dirt", 1);
        tracker.itemDropped(13300, "minecraft:dirt", "Dirt", 64);
        check(last(tracker).label().equals("Dropped 65 × Dirt"), "drops add up item counts");

        tracker.observe(14000, "minecraft:the_nether", false, 20.0, 20.0);
        tracker.damageSource(14001, "Zombie");
        tracker.observe(14002, "minecraft:the_nether", false, 17.0, 20.0);
        tracker.damageSource(14003, "Zombie");
        tracker.observe(14004, "minecraft:the_nether", false, 14.0, 20.0);
        check(last(tracker).label().equals("Took 3 ♥ damage") && last(tracker).details().startsWith("From Zombie · 2 hits"),
                "damage from one source is merged and shown in hearts");
        tracker.observe(14005 + GameplayTracker.DAMAGE_SOURCE_MILLIS, "minecraft:the_nether", false, 13.0, 20.0);
        check(last(tracker).details().startsWith("From Unknown source"), "stale damage source is not reused");
        tracker.observe(16000, "minecraft:the_nether", false, 19.0, 20.0);
        check(!last(tracker).category().equals("heal"), "partial healing is not logged");
        tracker.observe(17000, "minecraft:the_nether", false, 20.0, 20.0);
        check(last(tracker).label().equals("Healed to full health"), "healing logged when health returns to full");
        tracker.observe(18000, "minecraft:the_nether", false, 20.0, 20.0);
        check(count(tracker, "heal") == 1, "full health is reported once");

        tracker.killed(20000, "minecraft:zombie", "Zombie");
        tracker.killed(20100, "minecraft:zombie", "Zombie");
        check(last(tracker).label().equals("Killed 2 × Zombie"), "melee kills name the entity and merge");
        tracker.killStatistics(21000, Map.of("minecraft:zombie", 2, "minecraft:skeleton", 1),
                id -> id.equals("minecraft:skeleton") ? "Skeleton" : "Zombie");
        check(count(tracker, "kill") == 2 && last(tracker).label().equals("Killed Skeleton")
                && last(tracker).details().contains("statistics"), "statistics add only unattributed kills");
        tracker.killStatistics(21000 + GameplayTracker.KILL_ATTRIBUTION_MILLIS, Map.of("minecraft:zombie", 1),
                id -> "Zombie");
        check(last(tracker).label().equals("Killed Zombie"), "attributions are consumed once");

        tracker.containerOpened(30000, "Chest");
        tracker.inventoryChanged(30500, "Chest", Map.of("Diamond", 3, "Cobblestone", -10));
        check(last(tracker).label().equals("Inventory changed (Chest)")
                && last(tracker).details().equals("Gained 3 × Diamond · Lost 10 × Cobblestone"), "inventory diff");
        int before = tracker.snapshot().events().size();
        tracker.inventoryChanged(30600, "Chest", Map.of());
        check(tracker.snapshot().events().size() == before, "unchanged inventory is not logged");
        tracker.advancement(31000, "challenge", "Return to Sender", "Destroy a Ghast with a fireball");
        check(last(tracker).label().equals("Challenge complete: Return to Sender"), "advancement type and title");

        var archivedIds = archived.stream().map(GameplayHistory.Event::id).toList();
        check(archivedIds.size() == tracker.snapshot().events().size() - 1
                        && archivedIds.equals(archivedIds.stream().distinct().sorted().toList()),
                "every event except the newest is archived once, in order");
        check(archived.stream().anyMatch(event -> event.label().equals("Mined 3 × Stone")),
                "merged events are archived in their final form");

        for (int index = 0; index < 600; index++) tracker.observe(40000 + index, "minecraft:world_" + index, false);
        var full = tracker.snapshot();
        check(full.events().size() == GameplayHistory.MAX_EVENTS && full.events().getFirst().id() > 1,
                "history bounded and oldest evicted");
        tracker.disconnect(50000);
        tracker.disconnect(50001);
        check(!tracker.snapshot().active() && last(tracker).label().equals("Disconnected"),
                "disconnect once retains stale session");
        check(archived.getLast().label().equals("Disconnected"), "disconnect archives the final event");
        tracker.containerOpened(50002, "Chest");
        check(last(tracker).label().equals("Disconnected"), "no events are added while disconnected");
        check(full.active(), "snapshots are immutable after disconnect");
        tracker.start(60000);
        check(tracker.snapshot().sessionId() == 2 && tracker.snapshot().events().size() == 1,
                "new connection clears old session");
        tracker.observe(60001, "minecraft:overworld", true);
        tracker.observe(70000, "minecraft:overworld", true);
        check(tracker.snapshot().events().size() == 1, "joining already dead does not fabricate a death");
        immutable(() -> full.events().clear());
        invalid(() -> new GameplayHistory.Event(0, 0, "death", "Death", ""));
        invalid(() -> new GameplayHistory.Event(1, 0, "chat", "Chat", ""));
        invalid(() -> new GameplayHistory.Event(1, 0, "death", "Death", "x".repeat(1025)));
        invalid(() -> new GameplayHistory(0, false, List.of(
                new GameplayHistory.Event(2, 0, "death", "Death", ""),
                new GameplayHistory.Event(1, 0, "death", "Death", ""))));
    }

    private static GameplayHistory.Event last(GameplayTracker tracker) {
        return tracker.snapshot().events().getLast();
    }

    private static long count(GameplayTracker tracker, String category) {
        return tracker.snapshot().events().stream().filter(event -> event.category().equals(category)).count();
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
        GameplayTracker deltas = new GameplayTracker();
        deltas.start(200);
        deltas.blockMined(201, "minecraft:stone", "Stone", 0, 0, 0);
        GameplayHistory base = deltas.snapshot();
        deltas.blockMined(202, "minecraft:stone", "Stone", 0, 0, 0);
        deltas.blockPlaced(203, "minecraft:dirt", "Dirt", 0, 0, 0);
        String historyDelta = deltas.snapshot().toDeltaJson(base);
        check(historyDelta.contains("\"firstId\":1,\"upsert\":[") && historyDelta.contains("Mined 2 × Stone")
                        && historyDelta.contains("Placed Dirt") && !historyDelta.contains("Session started")
                        && !historyDelta.contains("\"events\""),
                "history deltas send only rewritten and new events");
        check(deltas.snapshot().toDeltaJson(GameplayHistory.empty()).contains("\"events\":["),
                "a new session sends the full history");
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
