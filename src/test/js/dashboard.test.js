"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const web = path.join(__dirname, "../../client/resources/web");
const sources = ["protocol.js", "layout.js", "app.js"].map(name => fs.readFileSync(path.join(web, name), "utf8"));

function empty() {
  return { empty: true, itemId: null, name: null, count: 0, maxCount: 0,
    damage: null, maxDamage: null, remainingDurability: null, enchantments: [],
    icon: null, foil: false, tooltip: [] };
}

function item(overrides = {}) {
  return { ...empty(), empty: false, itemId: "minecraft:stone", name: "Stone", count: 32, maxCount: 64,
    icon: "e0-1a2b", tooltip: [[{ text: "Stone", color: null, format: "" }]], ...overrides };
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
  return { id: "minecraft:custom/minecraft:jump", label: "Jumps", category: "General", value: 40, session: 3,
    display: "40", sessionDisplay: "3", changedAt: null, ...overrides };
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
    statistics: statistics(), history: history(), food: 18, saturation: 5.5, effects: [], ...overrides };
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
    absorption: null, inventory: null, statistics: null, history: history({ active: false }),
    food: null, saturation: null, effects: null, ...overrides });
}

function defaultFetch(storedLayout = null, requests = []) {
  return async (url, options = {}) => {
    requests.push({ url, ...options });
    if (url === "/api/layout") {
      return options.method === "PUT" ? { ok: true, json: async () => ({ saved: true }) }
        : { ok: true, json: async () => ({ layout: storedLayout }) };
    }
    return { ok: true, json: async () => ({ websocketPort: 8765 }) };
  };
}

function harness(fetchImpl = defaultFetch()) {
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName; this.children = []; this.dataset = {}; this.className = "";
      this.writes = 0; this.text = ""; this.value = ""; this.open = false; this.hidden = false;
      this.listeners = {}; this.replacements = 0; this.attributes = {}; this.src = "";
      const props = {};
      this.style = { setProperty: (key, value) => { props[key] = value; }, getPropertyValue: key => props[key] ?? "" };
      const owner = this;
      this.classList = {
        add(name) { if (!owner.classList.contains(name)) owner.className = `${owner.className} ${name}`.trim(); },
        remove(name) { owner.className = owner.className.split(" ").filter(part => part !== name).join(" "); },
        contains(name) { return owner.className.split(" ").includes(name); }
      };
      this.rect = { left: 0, top: 0, width: 100, height: 40 };
    }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.text = value; this.children = []; this.writes++; }
    set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; this.text = ""; this.replacements++; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getBoundingClientRect() { return this.rect; }
    setPointerCapture() {}
    click() { this.clicks = (this.clicks ?? 0) + 1; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type, event = {}) {
      for (const listener of this.listeners[type] || []) {
        listener({ target: this, currentTarget: this, preventDefault() {}, ...event });
      }
    }
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
  const downloads = [];
  let timerId = 0;
  const documentElement = new Element("html");
  const context = vm.createContext({
    document: {
      documentElement,
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector);
      },
      createElement: tagName => new Element(tagName)
    },
    window: {
      innerWidth: 1280, innerHeight: 800,
      setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(type, callback) { events[type] = callback; },
      getComputedStyle: () => ({ paddingLeft: "14px", paddingRight: "14px", paddingTop: "12px" })
    },
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options?.type; } },
    URL: { createObjectURL: blob => { downloads.push(blob); return "blob:layout"; }, revokeObjectURL() {} },
    fetch: fetchImpl, WebSocket: Socket
  });
  for (const source of sources) vm.runInContext(source, context);
  return {
    sockets, timers, elements, events, downloads, documentElement,
    get(selector) { return elements.get(selector); },
    apply(previous, message) {
      context.previousTestState = previous;
      context.testMessage = message;
      return vm.runInContext("applyMessage(previousTestState, testMessage)", context);
    },
    run(code) { return vm.runInContext(code, context); },
    state() { return vm.runInContext("currentPlayerState", context); },
    async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
    async runTimers(delay) {
      for (const [id, timer] of [...timers]) {
        if (delay === undefined || timer.delay === delay) {
          timers.delete(id);
          await timer.callback();
        }
      }
      await this.flush();
    },
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
const hotbar = h => h.get("#inventory-grid").children.slice(0, 9);
const main = h => h.get("#inventory-grid").children.slice(9, 36);
const equipment = h => h.get("#inventory-grid").children.slice(36, 41);
const slotParts = slot => {
  const [placeholder, icon, glint, fallback, count, durability] = slot.children;
  return { placeholder, icon, glint, fallback, count, durability, bar: durability.children[0] };
};

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
  assert.equal(h.get("#health-value").textContent, "18 / 20 +2");
  assert.equal(h.get("#health-fill").style.width, "90%");
  assert.equal(h.get("#absorption-fill").style.left, "90%");
  assert.equal(h.get("#absorption-fill").style.width, "10%");
  assert.equal(h.get("#session-value").textContent, "1h 1m");
  assert.equal(h.get("#dimension-value").textContent, "minecraft:overworld");
  assert.equal(h.get("#position-value").textContent, "X 1.0 · Y 64.0 · Z -3.0");
  assert.equal(h.get("#state-message").textContent, "Live");
  assert.equal(h.get("#held-value").textContent, "Holding Stone × 32");
  const slots = [...hotbar(h), ...main(h)];
  assert.equal(slots.length, 36);
  assert.equal(equipment(h).length, 5);
  const writes = slots.map(element => element.children.map(child => child.writes));
  socket.message(update({ inventory: { slots: [{ index: 9, item: item({ name: "<img onerror=attack>" }) }] } }));
  slots.forEach((element, index) => {
    if (index !== 9) assert.deepEqual(element.children.map(child => child.writes), writes[index], `slot ${index}`);
  });
  assert.equal(slots[9].attributes["aria-label"], "<img onerror=attack> × 32");
  assert.equal(slotParts(slots[9]).fallback.textContent, "<O");
  assert.equal(slots[1].attributes["aria-label"], "Empty");
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
  assert.doesNotMatch(main(h)[0].textContent, /Must not appear/);
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
  assert.equal(h.get("#connection-status").textContent, "Connected");
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

const stone = (overrides = {}) => counter({ id: "minecraft:mined/minecraft:stone", label: "Stone", category: "Mined",
  value: 12, session: 12, display: "12", sessionDisplay: "12", changedAt: 500, ...overrides });

test("statistics accept Java bounds and merge incremental updates by id", () => {
  const h = harness();
  for (const value of [0, 1, 2147483647]) {
    for (const session of [0, value]) {
      for (const changedAt of [null, 0, Number.MAX_SAFE_INTEGER]) {
        const state = snapshot({ statistics: statistics([counter({ value, session, changedAt })]) });
        assert.deepEqual(plain(h.apply(undefined, initial(state)).statistics), state.statistics);
      }
    }
  }
  assert.equal(h.apply(undefined, initial(snapshot({ statistics: null }))).statistics, null);
  const entries = Array.from({ length: 4096 }, (_, index) => counter({ id: `minecraft:custom/minecraft:c${index}` }));
  assert.equal(h.apply(undefined, initial(snapshot({ statistics: statistics(entries) }))).statistics.entries.length, 4096);
  const added = h.apply(snapshot(), update({ statistics: { upsert: [stone()] } }));
  assert.deepEqual(plain(added.statistics.entries.map(entry => entry.id)),
    ["minecraft:custom/minecraft:jump", "minecraft:mined/minecraft:stone"]);
  const changed = h.apply(added, update({ baseRevision: 7, revision: 8,
    statistics: { upsert: [counter({ value: 41, session: 4, display: "41", sessionDisplay: "4", changedAt: 900 })] } }));
  assert.equal(changed.statistics.entries[0].value, 41);
  assert.equal(changed.statistics.entries[1].label, "Stone", "omitted statistics are kept");
});

test("statistics reject malformed entries, ids, bounds and deltas", () => {
  const h = harness();
  const invalid = [undefined, {}, { entries: null },
    statistics(Array.from({ length: 4097 }, (_, index) => counter({ id: `minecraft:custom/minecraft:c${index}` }))),
    statistics([counter(), counter()])];
  for (const key of Object.keys(counter())) {
    const entry = counter();
    delete entry[key];
    invalid.push(statistics([entry]));
  }
  for (const overrides of [
    { id: "minecraft:jump" }, { id: "custom/minecraft:jump" }, { id: "minecraft:custom/jump" },
    { id: "minecraft:a/b/minecraft:jump" }, { label: "" }, { label: "x".repeat(257) }, { label: "\uD800" },
    { category: "" }, { category: null }, { value: -1 }, { value: 0.5 }, { value: "3" }, { value: 2147483648 },
    { session: -1 }, { session: 41 }, { session: 0.5 }, { display: "" }, { sessionDisplay: null },
    { changedAt: -1 }, { changedAt: "now" }
  ]) invalid.push(statistics([counter(overrides)]));
  for (const value of invalid) {
    assert.throws(() => h.apply(undefined, initial(snapshot({ statistics: value }))), JSON.stringify(value)?.slice(0, 80));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ statistics: statistics() }))));
  for (const patch of [{ upsert: [counter({ value: -1 })] }, { upsert: null }, { other: [] }]) {
    assert.throws(() => h.apply(snapshot(), update({ statistics: patch })));
  }
  assert.throws(() => h.apply(snapshot({ statistics: null }), update({ statistics: { upsert: [stone()] } })),
    "a delta needs earlier statistics to merge into");
});

test("food, saturation and status effects are validated", () => {
  const h = harness();
  const speed = { id: "minecraft:speed", name: "Speed", amplifier: 1, endsAt: 1000, beacon: true };
  const state = snapshot({ food: 0, saturation: 20, effects: [speed, { ...speed, id: "minecraft:night_vision",
    name: "Night Vision", amplifier: 0, endsAt: null, beacon: false }] });
  assert.deepEqual(plain(h.apply(undefined, initial(state)).effects), state.effects);
  const next = h.apply(snapshot(), update({ food: 3, saturation: 0.5, effects: [speed] }));
  assert.deepEqual([next.food, next.saturation, next.effects.length], [3, 0.5, 1]);
  for (const overrides of [{ food: 21 }, { food: -1 }, { food: 1.5 }, { food: null }, { saturation: 20.5 },
    { saturation: -1 }, { saturation: null }, { effects: null }, { effects: [{ ...speed, id: "speed" }] },
    { effects: [{ ...speed, amplifier: 256 }] }, { effects: [{ ...speed, endsAt: -5 }] },
    { effects: [{ ...speed, beacon: "yes" }] }, { effects: [{ ...speed, name: "" }] },
    { effects: Array.from({ length: 65 }, () => speed) }]) {
    assert.throws(() => h.apply(undefined, initial(snapshot(overrides))), JSON.stringify(overrides).slice(0, 80));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ food: 20 }))));
  assert.throws(() => h.apply(undefined, initial(unavailable({ effects: [] }))));
});

const categories = ["lifecycle", "death", "dimension", "kill", "mine", "place",
  "container", "inventory", "drop", "damage", "heal", "advancement"];

test("history permits empty details, nonmonotonic timestamps, all categories and 500 ordered events", () => {
  const h = harness();
  const events = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1, timestamp: 100 - Math.min(index, 100),
    category: categories[index % categories.length],
    label: "Event", details: index % 2 ? "" : "x".repeat(1024)
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
    history({ events: Array.from({ length: 501 }, (_, index) => ({ ...history().events[0], id: index + 1 })) })];
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
    { details: null }, { details: "x".repeat(1025) }, { details: "\uDC00" }
  ]) invalid.push(history({ events: [{ ...history().events[0], ...overrides }] }));
  invalid.push(history({ events: [history().events[0], history().events[0]] }),
    history({ events: [...history().events].reverse() }),
    history({ sessionId: -1 }), history({ sessionId: 0.5 }), history({ active: "true" }));
  for (const value of invalid) {
    assert.throws(() => h.apply(undefined, initial(snapshot({ history: value }))));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ history: history() }))));
});

test("history deltas rewrite merged events, append new ones and evict below firstId", () => {
  const h = harness();
  const previous = snapshot();
  const merged = h.apply(previous, update({ history: { sessionId: 1, active: true, firstId: 1, upsert: [
    { id: 2, timestamp: 95, category: "mine", label: "Mined 3 × Stone", details: "Last at 1, 2, 3" },
    { id: 3, timestamp: 96, category: "kill", label: "Killed Zombie", details: "minecraft:zombie" }
  ] } }));
  assert.deepEqual(plain(merged.history.events.map(event => event.label)), ["Joined world", "Mined 3 × Stone", "Killed Zombie"]);
  const evicted = h.apply(merged, update({ baseRevision: 7, revision: 8, history: {
    sessionId: 1, active: false, firstId: 2, upsert: [] } }));
  assert.deepEqual(plain(evicted.history.events.map(event => event.id)), [2, 3]);
  assert.equal(evicted.history.active, false);
  for (const patch of [
    { sessionId: 2, active: true, firstId: 1, upsert: [] },
    { sessionId: 1, active: true, firstId: 0, upsert: [] },
    { sessionId: 1, active: true, firstId: 5, upsert: [] },
    { sessionId: 1, active: true, firstId: 2, upsert: [{ ...history().events[0], id: 1 }] },
    { sessionId: 1, active: true, firstId: 1, upsert: [{ ...history().events[0], category: "chat" }] },
    { sessionId: 1, active: "yes", firstId: 1, upsert: [] },
    { sessionId: 1, active: true, firstId: 1 }
  ]) {
    assert.throws(() => h.apply(previous, update({ history: patch })), JSON.stringify(patch));
  }
});

test("statistics and history deltas leave omitted fields unchanged", () => {
  const h = harness();
  const previous = snapshot();
  const before = JSON.stringify(previous);
  const value = statistics([counter({ value: 0, session: 0, display: "0", sessionDisplay: "0" })]);
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
    { statistics: { entries: [{ id: "minecraft:custom/minecraft:jump", session: 1 }] } },
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

test("chosen statistics render in order with the game's formatting; recent shows other changes from the last minute", async () => {
  const h = harness();
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ statistics: statistics([
    counter({ changedAt: now - 1000 }),
    counter({ id: "minecraft:custom/minecraft:walk_one_cm", label: "Distance Walked", value: 12345, session: 50,
      display: "123.45 m", sessionDisplay: "0.5 m", changedAt: now - 2000 }),
    counter({ id: "minecraft:custom/minecraft:play_time", label: "Time Played", display: "1.02 h",
      changedAt: now - 500 }),
    stone({ changedAt: now - 3000 }),
    stone({ id: "minecraft:used/minecraft:diamond_pickaxe", label: "Diamond Pickaxe", category: "Used",
      changedAt: now - 1000 }),
    stone({ id: "minecraft:mined/minecraft:dirt", label: "Dirt", changedAt: now - 61_000 })
  ]) })));
  const pinned = h.get("#statistics-entries").children;
  const cells = row => row.children.map(cell => cell.textContent);
  assert.deepEqual(pinned.map(cells), [["Distance Walked", "123.45 m", "+0.5 m"], ["Jumps", "40", "+3"],
    ["Time Played", "1.02 h", "+3"]], "chosen statistics follow the settings order");
  const recent = h.get("#statistics-recent").children;
  assert.deepEqual(recent.map(cells), [["Diamond PickaxeUsed", "12", "+12"], ["StoneMined", "12", "+12"]],
    "recent excludes chosen, excluded and older-than-a-minute statistics, newest first");
  assert.equal(h.get("#statistics-recent-section").hidden, false);
  const replacements = h.get("#statistics-entries").replacements;
  h.sockets[0].message(update({ health: 17 }));
  assert.equal(h.get("#statistics-entries").replacements, replacements, "unchanged statistics are not rebuilt");
  h.sockets[0].message(update({ baseRevision: 7, revision: 8, statistics: null }));
  assert.equal(h.get("#statistics-status").textContent, "Unavailable");
  assert.equal(h.get("#statistics-entries").textContent, "Statistics unavailable.");
  assert.equal(h.get("#statistics-recent-section").hidden, true);
});

test("the statistics window chooses shown statistics and what may appear under recent, and saves them", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ statistics: statistics([counter(), stone({ changedAt: now - 1000 })]) })));
  assert.equal(h.get("#statistics-dialog").hidden, true);
  h.get("#statistics-settings").emit("click");
  assert.equal(h.get("#statistics-dialog").hidden, false);
  const options = () => h.get("#statistics-options").children;
  const row = label => options().flatMap(group => group.children.slice(1))
    .find(value => value.children[0].textContent === label);
  assert.deepEqual(options().map(group => group.children[0].textContent), ["General", "Mined", "Not received yet"],
    "chosen statistics the server has not sent yet are still listed");
  const [, show, recent] = row("Stone").children;
  assert.equal(show.children[0].checked, false);
  assert.equal(recent.children[0].checked, true);
  show.children[0].checked = true;
  show.children[0].emit("change");
  assert.deepEqual(h.get("#statistics-entries").children.at(-1).children[0].textContent, "StoneMined",
    "a newly shown statistic is pinned");
  assert.equal(h.get("#statistics-recent").children.length, 0, "and no longer listed as recent");
  const jumpRecent = row("Jumps").children[2].children[0];
  jumpRecent.checked = false;
  jumpRecent.emit("change");
  assert.equal(plain(h.run("layout.settings.statistics.recentExcluded")).includes("minecraft:custom/minecraft:jump"), true);
  h.get("#statistics-search").value = "sto";
  h.get("#statistics-search").emit("input");
  assert.deepEqual(options().map(group => group.children[0].textContent), ["Mined"]);
  await h.runTimers(400);
  const saved = JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body);
  assert.equal(saved.settings.statistics.shown.at(-1), "minecraft:mined/minecraft:stone");
  h.get("#statistics-defaults").emit("click");
  assert.equal(plain(h.run("layout.settings.statistics.shown")).includes("minecraft:mined/minecraft:stone"), false);
  h.get("#statistics-dialog-close").emit("click");
  assert.equal(h.get("#statistics-dialog").hidden, true);
});

test("activity log is newest first with filters, search and safe text, without unchanged rebuilds", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  const label = "<img src=x onerror=attack>";
  const details = "<script>attack()</script>";
  const events = [...history().events, { id: 3, timestamp: 1, category: "kill", label, details }];
  socket.message(initial(snapshot({ history: history({ events }) })));
  const list = h.get("#history-entries");
  assert.equal(h.get("#history-status").textContent, "Current session · 3");
  assert.equal(list.children.length, 3);
  const newest = list.children[0];
  assert.equal(newest.tagName, "details");
  assert.equal(newest.dataset.category, "kill");
  const [time, category, text] = newest.children[0].children;
  assert.match(time.textContent, /^\d\d:\d\d:\d\d$/);
  assert.equal(category.textContent, "Kill");
  assert.equal(category.className, "category prio-2");
  assert.equal(text.textContent, label);
  assert.equal(newest.children[1].textContent, details);
  assert.equal(list.children[1].children[0].children[2].textContent, "Player died");
  newest.open = true;
  const replacements = list.replacements;
  const writes = text.writes;
  socket.message(update({ health: 16 }));
  assert.equal(list.replacements, replacements);
  assert.equal(text.writes, writes);
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

test("merged events update in place keeping expansion; session changes reset nodes", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const list = h.get("#history-entries");
  const death = list.children[0];
  death.open = true;
  socket.message(update({ history: { sessionId: 1, active: true, firstId: 1, upsert: [
    { ...history().events[1], details: "Updated details" },
    { id: 3, timestamp: 102, category: "dimension", label: "Nether", details: "" }
  ] } }));
  assert.equal(list.children[1], death);
  assert.equal(death.open, true);
  assert.equal(death.children[1].textContent, "Updated details");
  assert.equal(list.children[0].children[1].textContent, "No additional details.");
  socket.message(update({ baseRevision: 7, revision: 8, history: history({ sessionId: 2 }) }));
  assert.equal(h.get("#history-status").textContent, "Current session · 2");
  assert.notEqual(list.children[0], death);
  assert.equal(list.children[0].open, false);
});

test("history stays as previous session on world exit but clears on disconnect and resets on reconnect", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const retained = h.get("#history-entries").children[0];
  retained.open = true;
  socket.message(update(unavailable({ revision: 7, baseRevision: 4 })));
  assert.equal(h.get("#history-status").textContent, "Previous session · 2");
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

test("tooltips are validated like the Java model", () => {
  const h = harness();
  const valid = item({ tooltip: [
    [{ text: "Sword", color: "#55ffff", format: "bi" }], [],
    [{ text: "When in Main Hand:", color: "#aaaaaa", format: "" }, { text: " 7", color: null, format: "u" }]
  ], foil: true });
  const state = snapshot();
  state.inventory.slots[9] = valid;
  assert.deepEqual(plain(h.apply(undefined, initial(state)).inventory.slots[9]), valid);
  for (const bad of [
    item({ tooltip: null }), item({ tooltip: [null] }), item({ tooltip: Array.from({ length: 65 }, () => []) }),
    item({ tooltip: [Array.from({ length: 33 }, () => ({ text: "x", color: null, format: "" }))] }),
    item({ tooltip: [[{ text: "", color: null, format: "" }]] }),
    item({ tooltip: [[{ text: "x", color: "red", format: "" }]] }),
    item({ tooltip: [[{ text: "x", color: "#FFFFFF", format: "" }]] }),
    item({ tooltip: [[{ text: "x", color: null, format: "x" }]] }),
    item({ tooltip: [[{ text: "x", color: null }]] }),
    item({ icon: "../secret" }), item({ icon: "" }), item({ icon: 7 }), item({ foil: "yes" }),
    { ...empty(), icon: "e0-1" }, { ...empty(), foil: true }, { ...empty(), tooltip: [[]] }
  ]) {
    const value = snapshot();
    value.inventory.slots[9] = bad;
    assert.throws(() => h.apply(undefined, initial(value)), JSON.stringify(bad));
  }
});

test("hovering a slot shows the game's tooltip lines with Minecraft colors and formats", async () => {
  const h = harness();
  await h.flush();
  const sword = item({ name: "Sword", count: 1, maxCount: 1, tooltip: [
    [{ text: "<b>Sword</b>", color: "#55ffff", format: "bi" }], [],
    [{ text: "minecraft:diamond_sword", color: "#555555", format: "" }]
  ] });
  h.sockets[0].message(initial(snapshot({ inventory: { ...inventory(),
    slots: [sword, ...inventory().slots.slice(1)], equipment: { ...inventory().equipment, mainhand: sword } } })));
  const tooltip = h.get("#tooltip");
  const slot = hotbar(h)[0];
  slot.emit("pointerenter", { clientX: 10, clientY: 20 });
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.children.length, 3);
  const name = tooltip.children[0].children[0];
  assert.equal(name.textContent, "<b>Sword</b>");
  assert.equal(name.className, "b i");
  assert.equal(name.style.color, "#55ffff");
  assert.equal(name.style.textShadow, "1px 1px 0 rgb(21, 63, 63)");
  assert.equal(tooltip.children[1].children.length, 0);
  assert.equal(tooltip.style.left, "26px");
  h.sockets[0].message(update({ inventory: { slots: [{ index: 0, item: item({ name: "Renamed",
    tooltip: [[{ text: "Renamed", color: null, format: "" }]] }) }], equipment: { mainhand: item({ name: "Renamed",
    tooltip: [[{ text: "Renamed", color: null, format: "" }]] }) } } }));
  assert.equal(tooltip.textContent, "Renamed", "an open tooltip follows item changes");
  slot.emit("pointerleave");
  assert.equal(tooltip.hidden, true);
  hotbar(h)[1].emit("pointerenter", { clientX: 0, clientY: 0 });
  assert.equal(tooltip.hidden, true, "empty slots have no tooltip");
});

test("slots show game-rendered icons, counts, durability bars and an animated glint mask", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const stone = slotParts(hotbar(h)[0]);
  assert.equal(stone.icon.src, "/icon/e0-1a2b.png");
  assert.equal(stone.icon.hidden, false);
  assert.equal(stone.count.textContent, "32");
  assert.equal(stone.glint.hidden, true);
  assert.equal(stone.durability.hidden, true);
  assert.equal(stone.placeholder.hidden, true);
  assert.equal(hotbar(h)[0].className, "slot selected");
  assert.equal(hotbar(h)[0].attributes["aria-label"], "Stone × 32");
  assert.equal(h.documentElement.style.getPropertyValue("--glint"), 'url("/glint.png?v=0")');
  const empty = slotParts(hotbar(h)[1]);
  assert.equal(empty.icon.hidden, true);
  assert.equal(empty.placeholder.hidden, false);
  const tool = item({ name: "Diamond Pickaxe", count: 1, maxCount: 1, damage: 390, maxDamage: 1561,
    remainingDurability: 1171, foil: true, icon: "e3-ff" });
  socket.message(update({ inventory: { slots: [{ index: 1, item: tool }], selectedHotbarSlot: 1,
    equipment: { mainhand: tool, head: tool } } }));
  const pickaxe = slotParts(hotbar(h)[1]);
  assert.equal(pickaxe.count.textContent, "");
  assert.equal(pickaxe.glint.hidden, false);
  assert.equal(pickaxe.glint.style.maskImage, 'url("/icon/e3-ff.png")');
  assert.equal(pickaxe.durability.hidden, false);
  assert.equal(pickaxe.bar.style.width, "75%");
  assert.equal(pickaxe.bar.style.background, "hsl(90, 100%, 50%)");
  assert.equal(h.documentElement.style.getPropertyValue("--glint"), 'url("/glint.png?v=3")',
    "a resource-pack reload refreshes the glint texture");
  assert.equal(hotbar(h)[0].className, "slot");
  assert.equal(h.get("#held-value").textContent, "Holding Diamond Pickaxe");
  assert.equal(slotParts(equipment(h)[0]).icon.src, "/icon/e3-ff.png");
  const src = pickaxe.icon.src;
  socket.message(update({ baseRevision: 7, revision: 8, health: 3 }));
  assert.equal(pickaxe.icon.src, src, "unchanged icons are not reloaded");
  pickaxe.icon.emit("error");
  assert.equal([...h.timers.values()].some(timer => timer.delay === 1500), true, "a missing icon is retried");
  pickaxe.icon.emit("error");
  assert.equal(pickaxe.icon.hidden, true);
  assert.equal(pickaxe.fallback.hidden, false);
  assert.equal(pickaxe.fallback.textContent, "DP");
});

test("layout engine keeps tiles in the grid without overlaps and settles them upward", () => {
  const h = harness();
  const result = h.run(`(() => {
    const overlapping = (layout) => layout.tiles.filter(t => t.enabled).some((a, i, all) =>
      all.some((b, j) => i !== j && overlaps(a, b)));
    const base = defaultLayout();
    const moved = placeTile(base, "history", { x: 0, y: 0 }, false);
    const resized = placeTile(base, "player", { w: 12, h: 3 }, false);
    const clamped = placeTile(base, "player", { x: 11, y: -5, w: 1, h: 999 }, false);
    const dragging = placeTile(base, "player", { x: 0, y: 30 }, true);
    const hidden = setTileEnabled(base, "inventory", false);
    const shown = setTileEnabled(base, "map", true);
    return { overlapping: [base, moved, resized, clamped, dragging, hidden, shown].map(overlapping),
      moved: moved.tiles.find(t => t.id === "history"), player: moved.tiles.find(t => t.id === "player"),
      resized: resized.tiles.filter(t => t.enabled).map(t => [t.id, t.x, t.y, t.w, t.h]),
      clamped: clamped.tiles.find(t => t.id === "player"),
      dragging: dragging.tiles.find(t => t.id === "player").y,
      dropped: placeTile(base, "player", { x: 0, y: 30 }, false).tiles.find(t => t.id === "player").y,
      hiddenHistoryY: hidden.tiles.find(t => t.id === "history").y,
      shownMap: shown.tiles.find(t => t.id === "map"), rows: layoutRows(base) };
  })()`);
  assert.deepEqual(plain(result.overlapping), [false, false, false, false, false, false, false]);
  assert.deepEqual(plain(result.moved), { id: "history", enabled: true, x: 0, y: 0, w: 8, h: 9 });
  assert.equal(result.player.y, 9, "displaced tiles move below the dropped tile");
  assert.deepEqual(plain(result.resized), [["player", 0, 0, 12, 3], ["inventory", 4, 3, 8, 8],
    ["statistics", 0, 3, 4, 9], ["history", 4, 11, 8, 9]]);
  assert.deepEqual(plain(result.clamped), { id: "player", enabled: true, x: 10, y: 0, w: 2, h: 60 });
  assert.equal(result.dragging, 30, "a dragged tile stays under the pointer");
  assert.equal(result.dropped, 9, "after dropping, the tile settles just below the tiles it passed");
  assert.equal(result.hiddenHistoryY, 0, "disabling a tile lets others move up");
  assert.deepEqual(plain(result.shownMap), { id: "map", enabled: true, x: 0, y: 17, w: 6, h: 6 });
  assert.equal(result.rows, 17);
});

test("imported or stored layouts are validated and completed", () => {
  const h = harness();
  const normalize = value => h.run(`normalizeLayout(${JSON.stringify(value)})`);
  const partial = normalize({ version: 1, tiles: [{ id: "history", enabled: true, x: 0, y: 5, w: 12, h: 2 }] });
  assert.deepEqual(plain(partial.tiles[0]), { id: "history", enabled: true, x: 0, y: 0, w: 12, h: 3 });
  assert.equal(partial.tiles.length, 6);
  assert.equal(partial.tiles.filter(tile => tile.enabled).length, 1, "missing tiles are added disabled");
  for (const bad of [null, [], { version: 2, tiles: [] }, { version: 1 },
    { version: 1, tiles: [{ id: "chat", enabled: true, x: 0, y: 0, w: 1, h: 1 }] },
    { version: 1, tiles: [{ id: "player", enabled: 1, x: 0, y: 0, w: 4, h: 4 }] },
    { version: 1, tiles: [{ id: "player", enabled: true, x: 0.5, y: 0, w: 4, h: 4 }] },
    { version: 1, tiles: [{ id: "player", enabled: true, x: 0, y: 0, w: 4, h: 4 },
      { id: "player", enabled: true, x: 4, y: 0, w: 4, h: 4 }] }]) {
    assert.throws(() => normalize(bad), JSON.stringify(bad));
  }
});

test("the saved layout is loaded after the session and applied to tile grid placement", async () => {
  const stored = { version: 1, tiles: [
    { id: "inventory", enabled: true, x: 0, y: 0, w: 12, h: 6 },
    { id: "player", enabled: false, x: 0, y: 6, w: 4, h: 4 }] };
  const requests = [];
  const h = harness(defaultFetch(stored, requests));
  assert.equal(h.get("#tile-player").hidden, false, "defaults render before the saved layout arrives");
  await h.flush();
  assert.deepEqual(requests.map(request => request.url), ["/api/session", "/api/layout"]);
  assert.equal(h.get("#tile-player").hidden, true);
  assert.equal(h.get("#tile-inventory").style.getPropertyValue("--grid-column"), "1 / span 12");
  assert.equal(h.get("#tile-inventory").style.getPropertyValue("--grid-row"), "1 / span 6");
  assert.equal(h.get("#tile-history").hidden, true, "tiles missing from a saved layout start hidden");
  const toggles = h.get("#tile-toggles").children;
  assert.deepEqual(toggles.map(chip => [chip.textContent, chip.attributes["aria-pressed"]]),
    [["Player", "false"], ["Inventory", "true"], ["Statistics", "false"], ["Activity log", "false"],
      ["JourneyMap", "false"], ["Build progress", "false"]]);
  h.sockets[0].emit("close");
  await h.reconnect();
  assert.equal(requests.filter(request => request.url === "/api/layout").length, 1, "layout loads once");
});

test("customize mode toggles tiles, saves to the config file, resets, exports and imports", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  assert.equal(h.get("#edit-toolbar").hidden, true);
  h.get("#edit-toggle").emit("click");
  assert.equal(h.get("#edit-toolbar").hidden, false);
  assert.equal(h.get("#grid").className, "grid editing");
  assert.equal(h.get("#edit-toggle").attributes["aria-pressed"], "true");
  h.get("#tile-toggles").children[4].emit("click");
  assert.equal(h.get("#tile-map").hidden, false);
  assert.equal(h.get("#layout-status").textContent, "Saving…");
  h.get("#tile-toggles").children[0].emit("click");
  await h.runTimers(400);
  const saves = requests.filter(request => request.method === "PUT");
  assert.equal(saves.length, 1, "rapid changes are saved once");
  const saved = JSON.parse(saves[0].body);
  assert.equal(saved.tiles.find(tile => tile.id === "map").enabled, true);
  assert.equal(saved.tiles.find(tile => tile.id === "player").enabled, false);
  assert.equal(saves[0].headers["Content-Type"], "application/json");
  assert.equal(h.get("#layout-status").textContent, "Saved to config/minepanel/layout.json");

  h.get("#layout-export").emit("click");
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(JSON.parse(h.downloads[0].parts[0]), saved);

  h.get("#layout-reset").emit("click");
  assert.equal(h.get("#tile-player").hidden, false);
  assert.equal(h.get("#tile-map").hidden, true);

  const file = h.get("#layout-file");
  file.files = [{ text: async () => JSON.stringify({ version: 1, tiles: [
    { id: "statistics", enabled: true, x: 2, y: 0, w: 10, h: 5 }] }) }];
  file.emit("change");
  await h.flush();
  assert.equal(h.get("#tile-statistics").style.getPropertyValue("--grid-column"), "3 / span 10");
  assert.equal(h.get("#tile-player").hidden, true);
  file.files = [{ text: async () => "{\"version\":9}" }];
  file.emit("change");
  await h.flush();
  assert.equal(h.get("#layout-status").textContent, "That file is not a MinePanel layout");
  assert.equal(h.get("#layout-status").className, "save-status error");
  assert.equal(h.get("#tile-statistics").style.getPropertyValue("--grid-column"), "3 / span 10",
    "a rejected import leaves the layout unchanged");

  h.get("#edit-done").emit("click");
  assert.equal(h.get("#edit-toolbar").hidden, true);
  assert.equal(h.get("#grid").className, "grid");
});

test("failed layout saves are reported", async () => {
  const h = harness(async (url, options = {}) => options.method === "PUT" ? { ok: false }
    : url === "/api/layout" ? { ok: true, json: async () => ({ layout: null }) }
      : { ok: true, json: async () => ({ websocketPort: 8765 }) });
  await h.flush();
  h.get("#layout-reset").emit("click");
  await h.runTimers(400);
  assert.equal(h.get("#layout-status").textContent, "Not saved");
  assert.equal(h.get("#layout-status").className, "save-status error");
});

test("tiles move and resize by dragging only in customize mode, snapping to grid cells", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  const grid = h.get("#grid");
  grid.rect = { left: 0, top: 0, width: 1218, height: 2000 };
  const player = h.get("#tile-player");
  player.rect = { left: 14, top: 12, width: 390, height: 190 };
  const head = h.get("#head-player");
  const layout = () => plain(h.run("layout")).tiles.find(tile => tile.id === "player");
  head.emit("pointerdown", { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
  head.emit("pointermove", { clientX: 520, clientY: 220 });
  assert.deepEqual(layout(), { id: "player", enabled: true, x: 0, y: 0, w: 4, h: 4 }, "no dragging outside customize mode");

  h.get("#edit-toggle").emit("click");
  head.emit("pointerdown", { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
  assert.equal(player.className, "dragging");
  head.emit("pointermove", { clientX: 520, clientY: 220 });
  assert.deepEqual(layout(), { id: "player", enabled: true, x: 5, y: 4, w: 4, h: 4 });
  head.emit("pointerup");
  assert.equal(player.className, "");
  const dropped = plain(h.run("layout")).tiles;
  assert.equal(dropped.find(tile => tile.id === "player").y, 0, "dropped tiles settle upward");
  assert.equal(dropped.find(tile => tile.id === "player").x, 5);

  const handle = player.children.at(-1);
  assert.equal(handle.className, "resize-handle");
  player.rect = { left: 514, top: 12, width: 390, height: 190 };
  handle.emit("pointerdown", { button: 0, clientX: 900, clientY: 200, pointerId: 2 });
  handle.emit("pointermove", { clientX: 1100, clientY: 300 });
  handle.emit("pointerup");
  const resized = plain(h.run("layout")).tiles.find(tile => tile.id === "player");
  assert.deepEqual([resized.w, resized.h], [6, 6]);
  await h.runTimers(400);
  assert.equal(requests.filter(request => request.method === "PUT").length, 1);
});

test("inventory arrangement shows only whole rows that fit, preferring rows, then slot size, then armor", () => {
  const h = harness();
  const arrange = (width, height, armor) => plain(h.run(`inventoryArrangement(${width}, ${height}, ${armor})`));
  assert.deepEqual(arrange(500, 300, true), { wide: false, slot: 52,
    rows: ["hotbar", "main3", "main2", "main1", "equipment"], height: 272 });
  assert.deepEqual(arrange(700, 250, true), { wide: true, slot: 52, rows: ["hotbar", "main3", "main2", "main1"],
    height: 217 }, "with room for an armor column, armor sits beside the storage rows");
  assert.equal(arrange(700, 250, false).wide, false);
  assert.deepEqual(arrange(500, 110, true), { wide: false, slot: 52, rows: ["hotbar", "main3"], height: 107 },
    "too short for everything: keep full-size slots and add only rows that fully fit");
  assert.deepEqual(arrange(500, 60, true).rows, ["hotbar"]);
  assert.deepEqual(arrange(200, 300, false), { wide: false, slot: 19, rows: ["hotbar", "main3", "main2", "main1"],
    height: 85 }, "narrow tiles shrink slots instead of dropping rows");
  for (const width of [60, 150, 333, 480, 900]) {
    for (const height of [20, 45, 100, 170, 260, 500]) {
      for (const armor of [true, false]) {
        const result = arrange(width, height, armor);
        const columns = result.wide ? 11 : 9;
        assert.ok(result.height <= height, `fits height ${width}x${height}`);
        assert.ok(columns * result.slot + (columns - 1) * 3 + (result.wide ? 6 : 0) <= width, `fits width ${width}x${height}`);
        assert.equal(result.rows[0], "hotbar", "the hotbar is always the first row kept");
      }
    }
  }
});

test("inventory grid places rows and armor, toggles armor and drops rows as the tile shrinks", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  h.sockets[0].message(initial());
  const body = h.get("#inventory-body");
  const grid = h.get("#inventory-grid");
  const resize = rect => { body.rect = rect; h.events.resize(); };
  resize({ left: 0, top: 0, width: 524, height: 340 });
  assert.equal(grid.style.getPropertyValue("--slot"), "52px");
  assert.equal(grid.style.gridTemplateColumns, "repeat(9, var(--slot))");
  assert.deepEqual([hotbar(h)[0].style.gridRow, main(h)[0].style.gridRow, main(h)[26].style.gridRow,
    equipment(h)[4].style.gridRow, equipment(h)[4].style.gridColumn], ["5", "2", "4", "1", "5"]);
  assert.equal(h.get("#held-value").hidden, false);

  resize({ left: 0, top: 0, width: 728, height: 280 });
  assert.equal(grid.style.gridTemplateColumns, "var(--slot) 6px repeat(9, var(--slot)) 6px var(--slot)");
  assert.deepEqual(equipment(h).map(slot => [slot.style.gridRow, slot.style.gridColumn]),
    [["1", "1"], ["2", "1"], ["3", "1"], ["4", "1"], ["4", "13"]], "armor column beside rows, offhand by the hotbar");
  assert.equal(hotbar(h)[0].style.gridColumn, "3");

  h.get("#armor-toggle").emit("click");
  assert.equal(h.get("#armor-toggle").attributes["aria-pressed"], "false");
  assert.equal(equipment(h).every(slot => slot.hidden), true);
  assert.equal(grid.style.gridTemplateColumns, "repeat(9, var(--slot))");
  await h.runTimers(400);
  assert.equal(JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body).settings.inventory.showArmor,
    false, "the armor choice is saved with the layout");

  resize({ left: 0, top: 0, width: 524, height: 100 });
  assert.equal(main(h).every(slot => slot.hidden), true);
  assert.equal(hotbar(h).every(slot => !slot.hidden && slot.style.gridRow === "1"), true);
  assert.equal(grid.style.getPropertyValue("--slot"), "52px");
  assert.equal(h.get("#held-value").hidden, false, "spare height shows the held item");
  resize({ left: 0, top: 0, width: 524, height: 80 });
  assert.equal(h.get("#held-value").hidden, true, "the held-item line gives way before slots shrink");
  assert.equal(grid.style.getPropertyValue("--slot"), "52px");
  resize({ left: 0, top: 0, width: 524, height: 128 });
  assert.deepEqual(main(h).map(slot => slot.hidden), [...Array(18).fill(true), ...Array(9).fill(false)],
    "the main row next to the hotbar appears first");
});

test("player tile shows saturation above health, food, and status effects with timers and beacon markers", async () => {
  const h = harness();
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ saturation: 5, food: 17, effects: [
    { id: "minecraft:haste", name: "Haste", amplifier: 1, endsAt: now + 12_400, beacon: true },
    { id: "minecraft:night_vision", name: "Night Vision", amplifier: 0, endsAt: null, beacon: false },
    { id: "minecraft:speed", name: "Speed", amplifier: 0, endsAt: now + 3_725_000, beacon: false }
  ] })));
  assert.equal(h.get("#saturation-fill").style.width, "25%");
  assert.equal(h.get("#food-value").textContent, "17 / 20 · saturation 5");
  const effects = h.get("#effects").children;
  assert.equal(effects.length, 3);
  const [icon, level, source, timer] = effects[0].children;
  assert.equal(icon.src, "/effect/minecraft/haste.png");
  assert.equal(level.textContent, "II");
  assert.equal(source.hidden, false);
  assert.equal(effects[0].className, "effect beacon");
  assert.equal(timer.textContent, "0:13");
  assert.equal(effects[0].attributes.title, "Haste II · 0:13 · from a beacon");
  assert.equal(effects[1].children[3].textContent, "∞");
  assert.equal(effects[1].children[2].hidden, true);
  assert.equal(effects[2].children[3].textContent, "1:02:05");
  h.run(`tickEffects(${now + 10_000})`);
  assert.equal(timer.textContent, "0:03", "timers count down locally");
  h.run(`tickEffects(${now + 20_000})`);
  assert.equal(timer.textContent, "0:00");
  h.sockets[0].message(update({ effects: [{ id: "minecraft:haste", name: "Haste", amplifier: 1,
    endsAt: now + 30_000, beacon: true }] }));
  assert.equal(h.get("#effects").children[0], effects[0], "a refreshed effect keeps its element");
  assert.equal(h.get("#effects").children.length, 1);
  h.sockets[0].message(update(unavailable({ revision: 8, baseRevision: 7 })));
  assert.equal(h.get("#effects").children.length, 0);
  assert.equal(h.get("#saturation-fill").style.width, "0%");
  assert.equal(h.get("#food-value").textContent, "—");
});

test("the JourneyMap tile embeds the local web map when it answers and retries while it is offline", async () => {
  let mapOnline = false;
  const requests = [];
  const h = harness(async (url, options = {}) => {
    requests.push({ url, ...options });
    if (url.startsWith("http://")) {
      if (!mapOnline) throw new TypeError("Failed to fetch");
      return { ok: true };
    }
    return defaultFetch(null)(url, options);
  });
  await h.flush();
  assert.equal(requests.some(request => request.url.startsWith("http://")), false, "a hidden map tile is not probed");
  h.get("#tile-toggles").children[4].emit("click");
  await h.flush();
  assert.equal(h.get("#tile-map").hidden, false);
  assert.equal(h.get("#map-frame").hidden, true);
  assert.equal(h.get("#map-offline").hidden, false);
  assert.match(h.get("#map-offline-text").textContent, /reachable at http:\/\/127\.0\.0\.1:8080\//);
  assert.equal(h.get("#map-status").textContent, "Offline");
  assert.equal(h.get("#map-open").href, "http://127.0.0.1:8080/");
  mapOnline = true;
  await h.runTimers(10_000);
  assert.equal(h.get("#map-frame").src, "http://127.0.0.1:8080/");
  assert.equal(h.get("#map-frame").hidden, false);
  assert.equal(h.get("#map-offline").hidden, true);
  assert.equal(h.get("#map-status").textContent, "Live");
  assert.equal([...h.timers.values()].some(timer => timer.delay === 30_000), true, "an online map is rechecked");

  h.get("#map-settings").emit("click");
  assert.equal(h.get("#map-address").hidden, false);
  assert.equal(h.get("#map-url").value, "http://127.0.0.1:8080/");
  h.get("#map-url").value = "https://example.com/";
  h.get("#map-address").emit("submit");
  assert.match(h.get("#map-url-error").textContent, /127\.0\.0\.1/);
  h.get("#map-url").value = "http://localhost:8181/";
  h.get("#map-address").emit("submit");
  await h.flush();
  assert.equal(h.get("#map-address").hidden, true);
  assert.equal(h.get("#map-frame").src, "http://localhost:8181/");
  assert.equal(plain(h.run("layout.settings.map")).url, "http://localhost:8181/");

  h.get("#tile-toggles").children[4].emit("click");
  assert.equal([...h.timers.values()].some(timer => timer.delay === 30_000 || timer.delay === 10_000), false,
    "hiding the map stops probing");
});
