"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../client/resources/web/app.js"), "utf8");

function empty() {
  return { empty: true, itemId: null, name: null, count: 0, maxCount: 0,
    damage: null, maxDamage: null, remainingDurability: null, enchantments: [] };
}

function item(overrides = {}) {
  return { ...empty(), empty: false, itemId: "minecraft:stone", name: "Stone", count: 32, maxCount: 64, ...overrides };
}

function inventory() {
  const slots = Array.from({ length: 36 }, empty);
  slots[0] = item();
  return { slots, selectedHotbarSlot: 0,
    equipment: { head: empty(), chest: empty(), legs: empty(), feet: empty(),
      offhand: empty(), mainhand: item() } };
}

function statistics(entries = [counter()]) {
  return { entries };
}

function counter(overrides = {}) {
  return { id: "minecraft:jump", label: "Jumps", category: "Movement", unit: "count",
    cumulative: 40, session: 3, ...overrides };
}

function history(overrides = {}) {
  return { sessionId: 1, active: true, events: [
    { id: 1, timestamp: 100, category: "lifecycle", label: "Joined world", details: "Overworld" },
    { id: 2, timestamp: 90, category: "death", label: "Player died", details: "Fell from a height" }
  ], ...overrides };
}

function snapshot(overrides = {}) {
  return { schemaVersion: 2, revision: 4, capturedAt: 100, available: true,
    sessionSeconds: 3665, dimension: "minecraft:overworld", position: { x: 1, y: 64, z: -3 },
    health: 18, maxHealth: 20, absorption: 2, inventory: inventory(),
    statistics: statistics(), history: history(), ...overrides };
}

function initial(state = snapshot()) {
  return { schemaVersion: 2, type: "initial", modVersion: "0.1.0", state };
}

function update(state = {}) {
  return { schemaVersion: 2, type: "update",
    state: { schemaVersion: 2, baseRevision: 4, revision: 7, capturedAt: 101, ...state } };
}

function unavailable(overrides = {}) {
  return snapshot({ available: false, sessionSeconds: null, dimension: null,
    position: { x: null, y: null, z: null }, health: null, maxHealth: null,
    absorption: null, inventory: null, statistics: null, history: history({ active: false }), ...overrides });
}

function harness(fetchImpl = async () => ({ ok: true, json: async () => ({ websocketPort: 8765 }) })) {
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName; this.children = []; this.dataset = {}; this.className = "";
      this.writes = 0; this.text = ""; this.value = ""; this.open = false;
      this.listeners = {}; this.replacements = 0;
    }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.text = value; this.children = []; this.writes++; }
    set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; this.text = ""; this.replacements++; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type) { for (const listener of this.listeners[type] || []) listener({ target: this }); }
  }
  const elements = new Map();
  const sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = []; sockets.push(this); }
    addEventListener(type, listener, options) {
      (this.listeners[type] ||= []).push({ listener, once: options?.once });
    }
    emit(type, data) {
      const listeners = this.listeners[type] || [];
      this.listeners[type] = listeners.filter(entry => !entry.once);
      for (const entry of listeners) entry.listener(data);
    }
    message(value) { this.emit("message", { data: JSON.stringify(value) }); }
    close(...args) { this.closed.push(args); }
  }
  const timers = new Map();
  const events = {};
  let timerId = 0;
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector);
      },
      createElement: tagName => new Element(tagName)
    },
    window: {
      setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(type, callback) { events[type] = callback; }
    },
    fetch: fetchImpl, WebSocket: Socket
  });
  vm.runInContext(source, context);
  return {
    sockets, timers, elements, events,
    get(selector) { return elements.get(selector); },
    apply(previous, message) {
      context.previousTestState = previous;
      context.testMessage = message;
      return vm.runInContext("applyMessage(previousTestState, testMessage)", context);
    },
    state() { return vm.runInContext("currentPlayerState", context); },
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
    async reconnect() {
      const timer = [...timers.values()][0];
      assert.ok(timer);
      timers.clear();
      timer.callback();
      await this.flush();
    }
  };
}

const plain = value => JSON.parse(JSON.stringify(value));

test("complete snapshot preserves telemetry, all 36 slots and equipment", () => {
  const h = harness();
  assert.deepEqual(plain(h.apply(undefined, initial())), snapshot());
  assert.deepEqual(plain(h.apply(undefined, initial(unavailable()))), unavailable());
});

test("position field deltas merge and revision gaps are valid with exact sent baseline", () => {
  const h = harness();
  const next = h.apply(snapshot(), update({ position: { x: 9 }, health: 12, sessionSeconds: 4000 }));
  assert.deepEqual(plain(next.position), { x: 9, y: 64, z: -3 });
  assert.equal(next.revision, 7);
  assert.equal(next.health, 12);
  assert.equal(next.sessionSeconds, 4000);
  assert.equal(next.dimension, "minecraft:overworld");
});

test("slot movement, stack split, counts, equipment and selection apply together", () => {
  const h = harness();
  const previous = snapshot();
  const before = JSON.stringify(previous);
  const next = h.apply(previous, update({ inventory: {
    slots: [{ index: 0, item: empty() }, { index: 9, item: item({ count: 20 }) },
      { index: 2, item: item({ count: 12 }) }],
    selectedHotbarSlot: 2, equipment: { mainhand: item({ count: 12 }), offhand: item({ count: 1 }) }
  } }));
  assert.equal(next.inventory.slots[0].empty, true);
  assert.equal(next.inventory.slots[9].count, 20);
  assert.equal(next.inventory.slots[2].count, 12);
  assert.equal(next.inventory.selectedHotbarSlot, 2);
  assert.equal(next.inventory.equipment.offhand.count, 1);
  assert.equal(JSON.stringify(previous), before);
});

test("damage, durability and enchantment changes replace a full item", () => {
  const h = harness();
  const sword = item({ itemId: "minecraft:diamond_sword", name: "Sword", count: 1, maxCount: 1,
    damage: 12, maxDamage: 1561, remainingDurability: 1549,
    enchantments: [{ id: "minecraft:sharpness", name: "Sharpness", level: 3 }] });
  const next = h.apply(snapshot(), update({ inventory: {
    slots: [{ index: 0, item: sword }], equipment: { mainhand: sword, head: sword }
  } }));
  assert.deepEqual(plain(next.inventory.slots[0]), sword);
  assert.deepEqual(plain(next.inventory.equipment.head), sword);
  const after = h.apply(next, update({ baseRevision: 7, revision: 8, inventory: {
    slots: [{ index: 0, item: item() }], equipment: { mainhand: item() }
  } }));
  assert.equal(after.inventory.slots[0].enchantments.length, 0);
  assert.equal(after.inventory.slots[0].damage, null);
});

test("selection-only and equipment-only deltas omit slots; oversized stacks remain valid", () => {
  const h = harness();
  const selected = h.apply(snapshot(), update({ inventory: {
    selectedHotbarSlot: 1, equipment: { mainhand: empty() }
  } }));
  assert.equal(selected.inventory.selectedHotbarSlot, 1);
  assert.equal(selected.inventory.slots[0].count, 32);
  const equipped = h.apply(snapshot(), update({ inventory: { equipment: { offhand: item({ count: 65 }) } } }));
  assert.equal(equipped.inventory.equipment.offhand.count, 65);
});

test("item names, empty maxCount, bounds and derived durability must be consistent", () => {
  const h = harness();
  for (const bad of [
    emptyWithMaxCount(), item({ name: null }), item({ name: "" }),
    item({ maxCount: 1000001 }), item({ damage: 1 }),
    item({ maxDamage: 10, damage: 11, remainingDurability: 0 }),
    item({ maxDamage: 10, damage: 1, remainingDurability: 8 }),
    item({ maxDamage: 10, damage: null, remainingDurability: null })
  ]) {
    const state = snapshot();
    state.inventory.slots[9] = bad;
    assert.throws(() => h.apply(undefined, initial(state)));
  }
  function emptyWithMaxCount() { return { ...empty(), maxCount: 64 }; }
});

test("protocol text, identifier and enchantment limits match Java validation", () => {
  const h = harness();
  const enchantment = { id: "minecraft:efficiency", name: "Efficiency", level: 1 };
  for (const bad of [
    item({ itemId: "stone" }), item({ itemId: "Minecraft:stone" }),
    item({ name: "x".repeat(257) }), item({ name: "\uD800" }), item({ name: "\uDC00" }),
    item({ enchantments: Array.from({ length: 65 }, () => enchantment) }),
    item({ enchantments: [{ ...enchantment, level: 0 }] }),
    item({ enchantments: [{ ...enchantment, level: 256 }] }),
    item({ enchantments: [{ ...enchantment, id: "efficiency" }] }),
    item({ enchantments: [{ ...enchantment, name: "\uD800" }] })
  ]) {
    const state = snapshot();
    state.inventory.slots[9] = bad;
    assert.throws(() => h.apply(undefined, initial(state)));
  }
  const state = snapshot();
  state.inventory.slots[9] = item({ name: "😀".repeat(128),
    enchantments: Array.from({ length: 64 }, () => ({ ...enchantment, level: 255 })) });
  assert.equal(h.apply(undefined, initial(state)).inventory.slots[9].name.length, 256);
});

test("availability transitions require full snapshots and baseline", () => {
  const h = harness();
  const gone = h.apply(snapshot(), update(unavailable({ revision: 7, capturedAt: 101, baseRevision: 4 })));
  assert.equal(gone.inventory, null);
  const back = h.apply(gone, update(snapshot({ revision: 8, baseRevision: 7 })));
  assert.equal(back.inventory.slots.length, 36);
  assert.throws(() => h.apply(snapshot(), update({ available: false, inventory: null })));
  const missing = unavailable({ revision: 7 });
  assert.throws(() => h.apply(snapshot(), { schemaVersion: 2, type: "update", state: missing }));
  assert.throws(() => h.apply(snapshot(), update({ inventory: null })));
  assert.throws(() => h.apply(undefined, initial(snapshot({ inventory: null }))));
});

test("schema, missing baseline, outdated and duplicate revisions are rejected", () => {
  const h = harness();
  const invalid = [
    update({ baseRevision: undefined }), update({ baseRevision: 3 }),
    update({ revision: 4 }), update({ revision: 3 }), update({ revision: 1.5 }),
    update({ schemaVersion: 1 }), { ...update(), schemaVersion: 1 },
    { ...update(), type: "other" }, update({ capturedAt: undefined })
  ];
  for (const message of invalid) assert.throws(() => h.apply(snapshot(), message));
  assert.throws(() => h.apply(undefined, update()));
  assert.throws(() => h.apply(snapshot(), initial()));
});

test("initial snapshot requires every telemetry and inventory field", () => {
  const h = harness();
  for (const key of Object.keys(snapshot())) {
    const state = snapshot();
    delete state[key];
    assert.throws(() => h.apply(undefined, initial(state)), key);
  }
  for (const state of [snapshot({ position: { x: 1, y: 2 } }),
    snapshot({ health: "20" }), snapshot({ sessionSeconds: -1 }),
    snapshot({ dimension: null }), unavailable({ inventory: inventory() })]) {
    assert.throws(() => h.apply(undefined, initial(state)));
  }
});

test("all full item fields, slot count and equipment keys are validated", () => {
  const h = harness();
  for (const key of Object.keys(item())) {
    const state = snapshot();
    delete state.inventory.slots[9][key];
    assert.throws(() => h.apply(undefined, initial(state)), key);
  }
  for (const mutate of [
    inv => inv.slots.pop(), inv => inv.slots.push(empty()),
    inv => delete inv.equipment.head, inv => { inv.equipment.unknown = empty(); },
    inv => { inv.selectedHotbarSlot = 9; }, inv => { inv.equipment.mainhand = empty(); },
    inv => { inv.slots[9] = item({ count: -1 }); },
    inv => { inv.slots[9] = item({ count: 1000001 }); },
    inv => { inv.slots[9] = item({ enchantments: [{ id: "x", level: 1 }] }); }
  ]) {
    const state = snapshot();
    mutate(state.inventory);
    assert.throws(() => h.apply(undefined, initial(state)));
  }
});

test("patch indices, duplicate slots, equipment keys and selected consistency reject atomically", () => {
  const h = harness();
  for (const patch of [
    { slots: [{ index: -1, item: empty() }] }, { slots: [{ index: 36, item: empty() }] },
    { slots: [{ index: 1.5, item: empty() }] },
    { slots: [{ index: 9, item: item() }, { index: 9, item: empty() }] },
    { slots: [{ index: 9, item: { empty: true } }] },
    { slots: [], equipment: { unknown: empty() } }, { slots: [], equipment: null },
    { slots: [], selectedHotbarSlot: 9 }, { slots: [], selectedHotbarSlot: 2 },
    { slots: [{ index: 0, item: empty() }] }
  ]) {
    const previous = snapshot();
    const before = JSON.stringify(previous);
    assert.throws(() => h.apply(previous, update({ inventory: patch })));
    assert.equal(JSON.stringify(previous), before);
  }
  assert.throws(() => h.apply(snapshot({ inventory: null }),
    update({ inventory: { slots: [{ index: 9, item: item() }] } })));
});

test("DOM rendering preserves telemetry and uses text-only efficient slot updates", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.emit("open");
  socket.message(initial());
  assert.equal(h.get("#health-value").textContent, "18 / 20 (+2)");
  assert.equal(h.get("#session-value").textContent, "1h 1m");
  assert.equal(h.get("#dimension-value").textContent, "minecraft:overworld");
  assert.equal(h.get("#position-value").textContent, "X 1.0 · Y 64.0 · Z -3.0");
  const slots = [...h.get("#hotbar-slots").children, ...h.get("#main-slots").children];
  const writes = slots.map(element => element.writes);
  socket.message(update({ inventory: { slots: [{ index: 9, item: item({ name: "<img onerror=attack>" }) }] } }));
  slots.forEach((element, index) => assert.equal(element.writes, writes[index] + (index === 9 ? 1 : 0)));
  assert.match(slots[9].textContent, /<img onerror=attack>/);
  assert.match(slots[0].textContent, /Selected[\s\S]*Stone · minecraft:stone · 32\/64/);
  assert.match(slots[1].textContent, /Empty/);
  assert.match(h.get("#held-value").textContent, /Held · Hotbar 1/);
});

test("durability and enchantments are visible with equipment and new selection", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const tool = item({ name: "Pickaxe", damage: 1, maxDamage: 100, remainingDurability: 99,
    enchantments: [{ id: "minecraft:efficiency", name: "Efficiency", level: 4 }] });
  socket.message(update({ inventory: { slots: [{ index: 1, item: tool }], selectedHotbarSlot: 1,
    equipment: { mainhand: tool, head: tool } } }));
  assert.equal(h.get("#hotbar-slots").children[0].className, "inventory-slot");
  assert.equal(h.get("#hotbar-slots").children[1].className, "inventory-slot selected");
  assert.match(h.get("#held-value").textContent, /Hotbar 2[\s\S]*Durability 99\/100 · damage 1[\s\S]*Efficiency \(minecraft:efficiency\) 4/);
  assert.match(h.get("#equipment-slots").children[0].textContent, /head[\s\S]*Pickaxe/);
});

test("unavailable and socket close clear all live values and reconnect needs fresh initial", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  socket.message(update(unavailable({ revision: 7, baseRevision: 4 })));
  assert.equal(h.get("#health-value").textContent, "—");
  assert.equal(h.get("#inventory-status").textContent, "Unavailable");
  assert.doesNotMatch(h.get("#held-value").textContent, /Stone/);
  socket.emit("close");
  assert.equal(h.state(), undefined);
  assert.equal(h.get("#version").textContent, "·");
  assert.equal(h.timers.size, 1);
  await h.reconnect();
  const fresh = h.sockets[1];
  fresh.message(update());
  assert.equal(fresh.closed[0][0], 1002);
  fresh.emit("close");
  await h.reconnect();
  h.sockets[2].message(initial(snapshot({ revision: 0 })));
  assert.equal(h.state().revision, 0);
});

test("invalid JSON/schema/baseline clear live data, close and reconnect", async () => {
  for (const data of ["{", JSON.stringify(update({ baseRevision: 0 })), JSON.stringify({ ...update(), schemaVersion: 1 })]) {
    const h = harness();
    await h.flush();
    const socket = h.sockets[0];
    socket.message(initial());
    socket.emit("message", { data });
    assert.equal(h.state(), undefined);
    assert.equal(h.get("#health-value").textContent, "—");
    assert.equal(h.get("#inventory-status").textContent, "Unavailable");
    assert.equal(socket.closed[0][0], 1002);
    socket.message(initial());
    assert.equal(h.state(), undefined);
    socket.emit("close");
    assert.equal(h.timers.size, 1);
  }
});

test("a malformed late patch cannot publish partially updated state or slot text", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  socket.message(update({ health: 3, position: { x: 99 }, inventory: {
    slots: [{ index: 9, item: item({ name: "Must not appear" }) },
      { index: 36, item: item() }]
  } }));
  assert.equal(h.state(), undefined);
  assert.equal(h.get("#health-value").textContent, "—");
  assert.equal(h.get("#position-value").textContent, "Position unavailable");
  assert.doesNotMatch(h.get("#main-slots").children[0].textContent, /Must not appear/);
  assert.equal(socket.closed[0][0], 1002);
});

test("events from closed or superseded sockets never corrupt fresh data", async () => {
  const h = harness();
  await h.flush();
  const old = h.sockets[0];
  old.message(initial());
  old.emit("close");
  old.message(initial());
  assert.equal(h.state(), undefined);
  await h.reconnect();
  h.sockets[1].message(initial(snapshot({ revision: 20 })));
  old.message(update());
  old.emit("open");
  old.emit("error");
  old.emit("close");
  assert.equal(h.state().revision, 20);
  assert.equal(h.timers.size, 0);
  assert.equal(h.get("#connection-status").textContent, "Dashboard connected");
});

test("pagehide prevents reconnects, in-flight fetches and late socket events", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  h.events.pagehide();
  socket.emit("close");
  socket.emit("error");
  socket.message(initial());
  assert.equal(h.state(), undefined);
  assert.equal(h.timers.size, 0);
  assert.equal(socket.closed.length, 1);
  let resolve;
  const pending = harness(() => new Promise(callback => { resolve = callback; }));
  pending.events.pagehide();
  resolve({ ok: true, json: async () => ({ websocketPort: 8765 }) });
  await pending.flush();
  assert.equal(pending.sockets.length, 0);
  assert.equal(pending.timers.size, 0);
  let resolveJson;
  const parsing = harness(async () => ({
    ok: true, json: () => new Promise(callback => { resolveJson = callback; })
  }));
  await parsing.flush();
  parsing.events.pagehide();
  resolveJson({ websocketPort: 8765 });
  await parsing.flush();
  assert.equal(parsing.sockets.length, 0);
  assert.equal(parsing.timers.size, 0);
});

test("session failure, invalid ports and socket error clear data and retry", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false }),
    ...[0, 65536, 1.5, "8765"].map(websocketPort =>
      async () => ({ ok: true, json: async () => ({ websocketPort }) }))
  ]) {
    const h = harness(fetchImpl);
    await h.flush();
    assert.equal(h.sockets.length, 0);
    assert.equal(h.timers.size, 1);
    assert.equal(h.get("#inventory-status").textContent, "Unavailable");
    h.events.pagehide();
    assert.equal(h.timers.size, 0);
  }
  const h = harness();
  await h.flush();
  h.sockets[0].message(initial());
  h.sockets[0].emit("error");
  assert.equal(h.state(), undefined);
  assert.equal(h.get("#health-value").textContent, "—");
  h.sockets[0].emit("close");
  assert.equal(h.timers.size, 1);
});

test("persisted pageshow restores a fresh socket without accepting pre-pagehide events", async () => {
  const h = harness();
  await h.flush();
  const old = h.sockets[0];
  old.message(initial());
  h.events.pagehide();
  old.emit("close");
  assert.equal(h.timers.size, 0);
  h.events.pageshow({ persisted: false });
  await h.flush();
  assert.equal(h.sockets.length, 1);
  h.events.pageshow({ persisted: true });
  await h.flush();
  assert.equal(h.sockets.length, 2);
  const fresh = h.sockets[1];
  assert.equal(h.state(), undefined);
  fresh.message(initial(snapshot({ revision: 30 })));
  old.message(update());
  old.emit("open");
  old.emit("error");
  old.emit("close");
  assert.equal(h.state().revision, 30);
  assert.equal(h.timers.size, 0);
  h.events.pageshow({ persisted: true });
  await h.flush();
  assert.equal(h.sockets.length, 2);
  fresh.emit("close");
  assert.equal(h.timers.size, 1);
  h.events.pagehide();
  assert.equal(h.timers.size, 0);
});

test("statistics accepts nullable values, zero, Java integer bounds and all units", () => {
  const h = harness();
  for (const unit of ["count", "cm", "ticks"]) {
    for (const cumulative of [null, 0, 2147483647]) {
      for (const session of [null, 0, 2147483647].filter(value =>
        value === null || cumulative !== null && value <= cumulative)) {
        const state = snapshot({ statistics: statistics([counter({ unit, cumulative, session })]) });
        assert.deepEqual(plain(h.apply(undefined, initial(state)).statistics), state.statistics);
      }
    }
  }
  assert.equal(h.apply(undefined, initial(snapshot({ statistics: null }))).statistics, null);
  assert.equal(h.apply(undefined, initial(snapshot({ statistics: statistics([]) }))).statistics.entries.length, 0);
  const entries = Array.from({ length: 32 }, (_, index) => counter({ id: `minecraft:counter_${index}` }));
  assert.equal(h.apply(undefined, initial(snapshot({ statistics: statistics(entries) }))).statistics.entries.length, 32);
});

test("statistics validates required entry fields, unique ids, bounded entries and numeric values", () => {
  const h = harness();
  const invalid = [undefined, {}, { entries: null },
    statistics(Array.from({ length: 33 }, (_, index) => counter({ id: `minecraft:counter_${index}` }))),
    statistics([counter(), counter()])];
  for (const key of Object.keys(counter())) {
    const entry = counter();
    delete entry[key];
    invalid.push(statistics([entry]));
  }
  for (const overrides of [
    { id: "not-an-identifier" }, { id: "minecraft:😀" }, { label: "" },
    { label: "x".repeat(257) }, { label: "\uD800" }, { category: "" },
    { category: "x".repeat(257) }, { category: null }, { category: "movement" },
    { category: "Other" }, { unit: "seconds" },
    { unit: null }, { cumulative: -1 }, { cumulative: 0.5 }, { cumulative: "3" },
    { cumulative: 2147483648 }, { cumulative: Number.MAX_SAFE_INTEGER },
    { cumulative: Number.MAX_SAFE_INTEGER + 1 }, { cumulative: null, session: 0 },
    { cumulative: null, session: 1 }, { cumulative: 0, session: 1 },
    { cumulative: 40, session: 41 }, { session: -1 }, { session: 0.5 },
    { session: "3" }, { session: Number.MAX_SAFE_INTEGER + 1 }
  ]) invalid.push(statistics([counter(overrides)]));
  for (const value of invalid) {
    assert.throws(() => h.apply(undefined, initial(snapshot({ statistics: value }))));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ statistics: statistics() }))));
});

test("history permits empty details, nonmonotonic timestamps, all categories and 100 ordered events", () => {
  const h = harness();
  const events = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, timestamp: 100 - index,
    category: ["lifecycle", "death", "dimension", "kill"][index % 4],
    label: "Event", details: index % 2 ? "" : "Details"
  }));
  const value = history({ events });
  assert.deepEqual(plain(h.apply(undefined, initial(snapshot({ history: value }))).history), value);
  assert.deepEqual(plain(h.apply(undefined, initial(snapshot({
    history: history({ sessionId: 0, active: false, events: [] })
  }))).history), { sessionId: 0, active: false, events: [] });
  assert.equal(h.apply(undefined, initial(snapshot({
    history: history({ sessionId: Number.MAX_SAFE_INTEGER, events: [{
      id: Number.MAX_SAFE_INTEGER, timestamp: Number.MAX_SAFE_INTEGER,
      category: "kill", label: "Kill", details: ""
    }] })
  }))).history.sessionId, Number.MAX_SAFE_INTEGER);
});

test("history rejects null, missing fields, oversized arrays, unordered ids and malformed events", () => {
  const h = harness();
  const invalid = [null, undefined, {}, history({ events: null }),
    history({ events: Array.from({ length: 101 }, (_, index) => ({ ...history().events[0], id: index + 1 })) })];
  for (const key of Object.keys(history())) {
    const value = history();
    delete value[key];
    invalid.push(value);
  }
  for (const key of Object.keys(history().events[0])) {
    const event = { ...history().events[0] };
    delete event[key];
    invalid.push(history({ events: [event] }));
  }
  for (const overrides of [
    { id: 0 }, { id: -1 }, { id: 0.5 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { timestamp: -1 }, { timestamp: 0.5 }, { timestamp: "2" },
    { timestamp: Number.MAX_SAFE_INTEGER + 1 }, { category: "chat" },
    { label: "" }, { label: null }, { label: "x".repeat(257) },
    { details: null }, { details: "x".repeat(257) }, { details: "\uDC00" }
  ]) invalid.push(history({ events: [{ ...history().events[0], ...overrides }] }));
  invalid.push(history({ events: [history().events[0], history().events[0]] }),
    history({ events: [...history().events].reverse() }),
    history({ sessionId: -1 }), history({ sessionId: 0.5 }), history({ active: "true" }));
  for (const value of invalid) {
    assert.throws(() => h.apply(undefined, initial(snapshot({ history: value }))));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ history: history() }))));
});

test("statistics and history deltas replace whole fields and leave omitted fields unchanged", () => {
  const h = harness();
  const previous = snapshot();
  const before = JSON.stringify(previous);
  const value = statistics([counter({ cumulative: null, session: null })]);
  const events = history({ events: [] });
  const next = h.apply(previous, update({ statistics: value, history: events }));
  assert.deepEqual(plain(next.statistics), value);
  assert.deepEqual(plain(next.history), events);
  assert.equal(JSON.stringify(previous), before);
  const healthOnly = h.apply(next, update({ baseRevision: 7, revision: 8, health: 1 }));
  assert.deepEqual(plain(healthOnly.statistics), value);
  assert.deepEqual(plain(healthOnly.history), events);
  assert.equal(h.apply(previous, update({ statistics: null })).statistics, null);
  for (const fields of [
    { statistics: { entries: [{ id: "minecraft:jump", session: 1 }] } },
    { history: { events: [] } }, { history: null }, { history: { active: false } }
  ]) assert.throws(() => h.apply(previous, update(fields)));
});

test("availability transition snapshots require statistics and history even with an existing baseline", () => {
  const h = harness();
  for (const key of ["statistics", "history"]) {
    const gone = unavailable({ revision: 7, baseRevision: 4 });
    delete gone[key];
    assert.throws(() => h.apply(snapshot(), update(gone)));
    const back = snapshot({ revision: 8, baseRevision: 7 });
    delete back[key];
    assert.throws(() => h.apply(unavailable({ revision: 7 }), update(back)));
  }
});

test("statistics renders categorized cumulative and session counters with units and unavailable values", async () => {
  const h = harness();
  await h.flush();
  h.sockets[0].message(initial(snapshot({ statistics: statistics([
    counter(), counter({ id: "minecraft:walk_one_cm", label: "Distance", unit: "cm", cumulative: 12345, session: 50 }),
    counter({ id: "minecraft:play_time", label: "Play time", category: "General", unit: "ticks",
      cumulative: 73200, session: 1220 }),
    counter({ id: "minecraft:deaths", label: "Deaths", category: "Combat", cumulative: null, session: null }),
    counter({ id: "minecraft:mob_kills", label: "Kills", category: "Combat", cumulative: 0, session: 0 })
  ]) })));
  const rendered = h.get("#statistics-entries");
  assert.equal(rendered.children.length, 3);
  assert.match(rendered.textContent, /Movement[\s\S]*Jumps\nCumulative: 40 · Session: 3/);
  assert.match(rendered.textContent, /Distance\nCumulative: 123.45 m · Session: 0.5 m/);
  assert.match(rendered.textContent, /General[\s\S]*Play time\nCumulative: 1h 1m · Session: 1m 1s/);
  assert.match(rendered.textContent, /Deaths\nCumulative: Unavailable · Session: Unavailable/);
  assert.match(rendered.textContent, /Kills\nCumulative: 0 · Session: 0/);
  const replacements = rendered.replacements;
  h.sockets[0].message(update({ health: 17 }));
  assert.equal(rendered.replacements, replacements);
  h.sockets[0].message(update({ baseRevision: 7, revision: 8, statistics: null }));
  assert.equal(h.get("#statistics-status").textContent, "Unavailable");
  assert.equal(rendered.textContent, "Statistics unavailable.");
});

test("history newest-first filters and search preserve expandable safe text details without unchanged rebuilds", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  const label = "<img src=x onerror=attack>";
  const details = "<script>attack()</script>";
  const events = [...history().events, { id: 3, timestamp: 1, category: "kill", label, details }];
  socket.message(initial(snapshot({ history: history({ events }) })));
  const list = h.get("#history-entries");
  assert.equal(h.get("#history-status").textContent, "Current session 1");
  assert.equal(list.children.length, 3);
  const newest = list.children[0];
  assert.equal(newest.tagName, "details");
  assert.equal(newest.children[0].tagName, "summary");
  assert.match(newest.children[0].textContent, /kill · <img src=x onerror=attack>/);
  assert.equal(newest.children[1].textContent, details);
  assert.match(list.children[1].children[0].textContent, /death · Player died/);
  newest.open = true;
  const replacements = list.replacements;
  const writes = newest.children[0].writes;
  socket.message(update({ health: 16 }));
  assert.equal(list.replacements, replacements);
  assert.equal(newest.children[0].writes, writes);
  assert.equal(newest.open, true);
  h.get("#history-category").value = "death";
  h.get("#history-category").emit("change");
  assert.equal(list.children.length, 1);
  assert.match(list.textContent, /Player died/);
  h.get("#history-search").value = "HEIGHT";
  h.get("#history-search").emit("input");
  assert.equal(list.children.length, 1);
  assert.equal(h.get("#history-empty").textContent, "");
  const filteredReplacements = list.replacements;
  h.get("#history-search").value = " height ";
  h.get("#history-search").emit("input");
  assert.equal(list.replacements, filteredReplacements);
  h.get("#history-search").value = "no match";
  h.get("#history-search").emit("input");
  assert.equal(list.children.length, 0);
  assert.equal(h.get("#history-empty").textContent, "No matching events.");
  h.get("#history-category").value = "all";
  h.get("#history-search").value = "attack()";
  h.get("#history-search").emit("input");
  assert.equal(list.children[0], newest);
  assert.equal(newest.open, true);
});

test("history changed events retain expansion, evict old nodes, and session changes reset expansion", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const list = h.get("#history-entries");
  const death = list.children[0];
  death.open = true;
  socket.message(update({ history: history({ events: [
    { ...history().events[1], details: "Updated details" },
    { id: 3, timestamp: 102, category: "dimension", label: "Nether", details: "" }
  ] }) }));
  assert.equal(list.children[1], death);
  assert.equal(death.open, true);
  assert.equal(death.children[1].textContent, "Updated details");
  assert.equal(list.children[0].children[1].textContent, "No additional details.");
  socket.message(update({ baseRevision: 7, revision: 8, history: history({ sessionId: 2 }) }));
  assert.equal(h.get("#history-status").textContent, "Current session 2");
  assert.notEqual(list.children[0], death);
  assert.equal(list.children[0].open, false);
});

test("history stays stale on world exit but clears with counters on disconnect and resets on reconnect", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const retained = h.get("#history-entries").children[0];
  retained.open = true;
  socket.message(update(unavailable({ revision: 7, baseRevision: 4 })));
  assert.equal(h.get("#history-status").textContent, "Stale session 1");
  assert.equal(h.get("#history-entries").children[0], retained);
  assert.equal(retained.open, true);
  assert.equal(h.get("#statistics-status").textContent, "Unavailable");
  socket.emit("close");
  assert.equal(h.get("#history-status").textContent, "No session");
  assert.equal(h.get("#history-entries").children.length, 0);
  assert.equal(h.get("#history-empty").textContent, "No gameplay events.");
  assert.equal(h.get("#statistics-entries").textContent, "Statistics unavailable.");
  await h.reconnect();
  h.sockets[1].message(initial(snapshot({ history: history({ sessionId: 0, active: false, events: [] }) })));
  assert.equal(h.get("#history-status").textContent, "No session");
  h.sockets[1].message(update());
  assert.equal(h.get("#history-entries").children.length, 0);
});

test("statistics and history unsafe labels use only text and malformed replacements clear live data atomically", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial(snapshot({ statistics: statistics([
    counter({ label: "<img onerror=attack>", category: "Combat" })
  ]) })));
  assert.match(h.get("#statistics-entries").textContent, /Combat/);
  assert.match(h.get("#statistics-entries").textContent, /<img onerror=attack>/);
  socket.message(update({ statistics: statistics([counter({ label: "Must not appear" })]),
    history: history({ events: [{ ...history().events[0], id: 0 }] }) }));
  assert.equal(h.state(), undefined);
  assert.equal(h.get("#statistics-status").textContent, "Unavailable");
  assert.doesNotMatch(h.get("#statistics-entries").textContent, /Must not appear/);
  assert.equal(h.get("#history-entries").children.length, 0);
  assert.equal(socket.closed[0][0], 1002);
});
