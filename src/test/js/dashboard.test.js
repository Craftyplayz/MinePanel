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

function snapshot(overrides = {}) {
  return { schemaVersion: 1, revision: 4, capturedAt: 100, available: true,
    sessionSeconds: 3665, dimension: "minecraft:overworld", position: { x: 1, y: 64, z: -3 },
    health: 18, maxHealth: 20, absorption: 2, inventory: inventory(), ...overrides };
}

function initial(state = snapshot()) {
  return { schemaVersion: 1, type: "initial", modVersion: "0.1.0", state };
}

function update(state = {}) {
  return { schemaVersion: 1, type: "update",
    state: { schemaVersion: 1, baseRevision: 4, revision: 7, capturedAt: 101, ...state } };
}

function unavailable(overrides = {}) {
  return snapshot({ available: false, sessionSeconds: null, dimension: null,
    position: { x: null, y: null, z: null }, health: null, maxHealth: null,
    absorption: null, inventory: null, ...overrides });
}

function harness(fetchImpl = async () => ({ ok: true, json: async () => ({ websocketPort: 8765 }) })) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.className = ""; this.writes = 0; this.text = ""; }
    get textContent() { return this.text; }
    set textContent(value) { this.text = value; this.writes++; }
    set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`); }
    appendChild(child) { this.children.push(child); }
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
      createElement: () => new Element()
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
  assert.throws(() => h.apply(snapshot(), { schemaVersion: 1, type: "update", state: missing }));
  assert.throws(() => h.apply(snapshot(), update({ inventory: null })));
  assert.throws(() => h.apply(undefined, initial(snapshot({ inventory: null }))));
});

test("schema, missing baseline, outdated and duplicate revisions are rejected", () => {
  const h = harness();
  const invalid = [
    update({ baseRevision: undefined }), update({ baseRevision: 3 }),
    update({ revision: 4 }), update({ revision: 3 }), update({ revision: 1.5 }),
    update({ schemaVersion: 2 }), { ...update(), schemaVersion: 2 },
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
  for (const data of ["{", JSON.stringify(update({ baseRevision: 0 })), JSON.stringify({ ...update(), schemaVersion: 2 })]) {
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
