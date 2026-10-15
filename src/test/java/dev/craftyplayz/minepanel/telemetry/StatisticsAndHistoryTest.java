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
        check(tracker.sample(1, List.of()).entries().isEmpty(), "nothing is reported before statistics arrive");
        var first = tracker.sample(10, List.of(jump(50), deaths(0)));
        check(entry(first, JUMP).session() == 0 && entry(first, JUMP).changedAt() == null
                        && entry(first, DEATHS).value() == 0 && entry(first, JUMP).display().equals("50 jumps"),
                "first observation is the baseline, formatted with the game's formatter");
        check(first.entries().getFirst().id().equals(DEATHS), "entries are sorted by id");
        var changed = tracker.sample(20, List.of(jump(54), deaths(0)));
        check(entry(changed, JUMP).session() == 4 && entry(changed, JUMP).sessionDisplay().equals("4 jumps")
                        && entry(changed, JUMP).changedAt() == 20 && entry(changed, DEATHS).changedAt() == null,
                "session delta and change time are tracked per statistic");
        var later = tracker.sample(30, List.of(jump(54), deaths(0), mined(3)));
        check(entry(later, JUMP).changedAt() == 20, "unchanged statistics keep their change time");
        check(entry(later, MINED).session() == 3 && entry(later, MINED).changedAt() == 30,
                "a statistic first seen after the baseline started from zero this session");
        String delta = later.toDeltaJson(changed);
        check(delta.startsWith("{\"upsert\":[") && delta.contains(MINED) && !delta.contains(JUMP),
                "statistics deltas only send new or changed entries");
        check(changed.toDeltaJson(later).startsWith("{\"entries\":["), "a removed statistic forces a full replacement");
        check(entry(tracker.sample(40, List.of(jump(2))), JUMP).session() == 0, "counter decrease rebases");
        tracker.reset();
        check(entry(tracker.sample(50, List.of(jump(60))), JUMP).session() == 0, "new session rebases");
        invalid(() -> tracker.sample(60, List.of(jump(-1))));
        invalid(() -> new StatisticsSnapshot(List.of(first.entries().getFirst(), first.entries().getFirst())));
        invalid(() -> new StatisticsSnapshot.Entry("minecraft:jump", "Jumps", "General", 1, 2, "1", "2", null));
        invalid(() -> new StatisticsSnapshot.Entry(JUMP, "Jumps", "General", 2, 3, "2", "3", null));
        invalid(() -> new StatisticsSnapshot.Entry(JUMP, "", "General", 2, 1, "2", "1", null));
        check(StatisticsSnapshot.validId(MINED) && !StatisticsSnapshot.validId("minecraft:mined/stone"),
                "ids pair a stat type with a namespaced value");
        immutable(() -> first.entries().clear());

        var effect = new StatusEffect("minecraft:speed", "Speed", 1, 5000L, true);
        check(effect.toJson().equals("{\"id\":\"minecraft:speed\",\"name\":\"Speed\",\"amplifier\":1,"
                + "\"endsAt\":5000,\"beacon\":true}"), "effects carry an end time and beacon source");
        check(new StatusEffect("minecraft:night_vision", "Night Vision", 0, null, false).toJson()
                .contains("\"endsAt\":null"), "infinite effects have no end time");
        invalid(() -> new StatusEffect("speed", "Speed", 0, null, false));
        invalid(() -> new StatusEffect("minecraft:speed", "Speed", 256, null, false));
    }

    private static final String JUMP = "minecraft:custom/minecraft:jump";
    private static final String DEATHS = "minecraft:custom/minecraft:deaths";
    private static final String MINED = "minecraft:mined/minecraft:stone";

    private static StatisticsTracker.Sample jump(long value) {
        return new StatisticsTracker.Sample(JUMP, "Jumps", "General", value, count -> count + " jumps");
    }

    private static StatisticsTracker.Sample deaths(long value) {
        return new StatisticsTracker.Sample(DEATHS, "Deaths", "General", value, Long::toString);
    }

    private static StatisticsTracker.Sample mined(long value) {
        return new StatisticsTracker.Sample(MINED, "Stone", "Mined", value, Long::toString);
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
        var stats = tracker.sample(100, List.of(jump(2), deaths(1)));
        check(update(store, 100, stats, history.snapshot()), "initial extended snapshot");
        PlayerSnapshot first = store.player();
        check(first.toJson().contains("\"schemaVersion\":3") && first.toJson().contains("\"statistics\":{\"entries\":[")
                && first.toJson().contains("\"history\":{\"sessionId\":1")
                && first.toJson().contains("\"food\":20,\"saturation\":5.0,\"effects\":[],\"world\":{"), "full fields serialized");
        check(!update(store, 101, stats, history.snapshot()), "unchanged snapshot suppressed");
        var changed = tracker.sample(102, List.of(jump(4), deaths(1)));
        update(store, 102, changed, history.snapshot());
        String delta = store.player().toDeltaJson(first);
        check(delta.contains("\"statistics\":{\"upsert\":[") && delta.contains("\"session\":2")
                && !delta.contains(DEATHS) && !delta.contains("\"history\":") && !delta.contains("\"inventory\":"),
                "statistics delta sends changed counters only, preserving existing inventory");
        PlayerSnapshot beforeEffects = store.player();
        store.updatePlayer(102, 0L, "minecraft:overworld", 0.0, 64.0, 0.0, 20.0, 20.0, 0.0, InventorySnapshot.empty(),
                changed, history.snapshot(), 17, 2.5, List.of(new StatusEffect("minecraft:speed", "Speed", 0, 9000L, false)));
        String effectDelta = store.player().toDeltaJson(beforeEffects);
        check(effectDelta.contains("\"food\":17,\"saturation\":2.5,\"effects\":[{\"id\":\"minecraft:speed\"")
                && !effectDelta.contains("\"statistics\""), "food, saturation and effects are sent when they change");
        invalid(() -> store.updatePlayer(103, 0L, "minecraft:overworld", 0.0, 64.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), changed, history.snapshot(), 21, 2.5, List.of()));
        invalid(() -> store.updatePlayer(103, 0L, "minecraft:overworld", 0.0, 64.0, 0.0, 20.0, 20.0, 0.0,
                InventorySnapshot.empty(), changed, history.snapshot(), 20, Double.NaN, List.of()));
        update(store, 102, changed, history.snapshot());
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
        update(store, 107, tracker.sample(107, List.of()), history.snapshot());
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
        return snapshot.entries().stream().filter(value -> value.id().equals(id)).findFirst().orElseThrow();
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
