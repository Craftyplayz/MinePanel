"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const web = path.join(__dirname, "../../client/resources/web");
const sources = ["protocol.js", "layout.js", "rules.js", "app.js", "features.js"].map(name => fs.readFileSync(path.join(web, name), "utf8"));

function empty() {
  return { empty: true, itemId: null, name: null, count: 0, maxCount: 0,
    damage: null, maxDamage: null, remainingDurability: null, enchantments: [],
    icon: null, foil: false, tooltip: [], contents: null };
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
    display: "40", sessionDisplay: "3", changedAt: null, sessionRate: "6", recentRate: null, ...overrides };
}

function history(overrides = {}) {
  return { sessionId: 1, active: true, events: [
    { id: 1, timestamp: 100, category: "lifecycle", label: "Joined world", details: "Overworld" },
    { id: 2, timestamp: 90, category: "death", label: "Player died", details: "Fell from a height" }
  ], ...overrides };
}

function details() {
  return {
    world: { kind: "singleplayer", name: "Test World", biome: "minecraft:plains", biomeName: "Plains",
      weather: "clear", day: 3, time: 6000, gameMode: "survival" },
    motion: { mode: "ground", speed: 4.3, horizontalSpeed: 4.3, verticalSpeed: 0, yaw: 180, pitch: 0,
      icon: item({ itemId: "minecraft:netherite_boots", name: "Netherite Boots", count: 1, maxCount: 1 }),
      glider: null },
    xp: { level: 5, progress: 0.5, points: 63, gained: { 10: 0, 30: 0, 60: 12, 300: 40, 600: 40, 3600: 90 } },
    portal: { crossing: null, obsidian: [], lit: null },
    pickups: [], advancements: null, villagers: [], enderChest: null, performance: performance(),
    build: { available: false, reason: "missing", placement: null, materials: [] },
    icons: { head: item({ itemId: "minecraft:player_head", name: "Steve's Head", count: 1, icon: "e0-head" }),
      enderChest: item({ itemId: "minecraft:ender_chest", name: "Ender Chest", count: 1, icon: "e0-ender" }) }
  };
}

function performance(fps = [58, 60, 61, 60, 59, 30, 60, 62, 60, 60, 61, 60]) {
  return { fps, windows: { 10: { seconds: 10, average: 57, low: 24 }, 30: { seconds: 12, average: 57, low: 24 },
    60: { seconds: 12, average: 57, low: 24 }, 600: { seconds: 12, average: 57, low: 24 } } };
}

function snapshot(overrides = {}) {
  return { schemaVersion: 4, revision: 4, capturedAt: 100, available: true,
    sessionSeconds: 3665, dimension: "minecraft:overworld", position: { x: 1, y: 64, z: -3 },
    health: 18, maxHealth: 20, absorption: 2, inventory: inventory(),
    statistics: statistics(), history: history(), food: 18, saturation: 5.5, effects: [], ...details(), ...overrides };
}

function initial(state = snapshot()) {
  return { schemaVersion: 4, type: "initial", modVersion: "0.1.0", state };
}

function update(state = {}) {
  return { schemaVersion: 4, type: "update",
    state: { schemaVersion: 4, baseRevision: 4, revision: 7, capturedAt: 101, ...state } };
}

function unavailable(overrides = {}) {
  return snapshot({ available: false, sessionSeconds: null, dimension: null,
    position: { x: null, y: null, z: null }, health: null, maxHealth: null,
    absorption: null, inventory: null, statistics: null, history: history({ active: false }),
    food: null, saturation: null, effects: null, world: null, motion: null, xp: null, portal: null, pickups: null,
    advancements: null, villagers: null, enderChest: null, performance: null, build: null, icons: null, ...overrides });
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
        contains(name) { return owner.className.split(" ").includes(name); },
        toggle(name, force) { if (force ?? !owner.classList.contains(name)) owner.classList.add(name); else owner.classList.remove(name); }
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
const findAll = (element, match, found = []) => {
  if (match(element)) found.push(element);
  for (const child of element.children) findAll(child, match, found);
  return found;
};
const byKey = (element, key) => findAll(element, child => child.dataset.key === key)[0];
const savedLayout = requests => JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body);
/** Sets a control's value (or checked state) and fires its change event, as a person would. */
const setValue = (element, value) => {
  if (typeof value === "boolean") element.checked = value;
  else element.value = value;
  element.emit("change");
};
const hotbar = h => h.get("#inventory-grid").children.slice(0, 9);
const main = h => h.get("#inventory-grid").children.slice(9, 36);
const equipment = h => h.get("#inventory-grid").children.slice(36, 41);
const extras = h => h.get("#inventory-grid").children.slice(41, 43);
const slotParts = slot => {
  const [placeholder, icon, fallback, count, durability] = slot.children;
  return { placeholder, icon, fallback, count, durability, bar: durability.children[0] };
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

test("shulker boxes and bundles are accepted in any inventory slot", () => {
  const h = harness();
  const shulker = item({ itemId: "minecraft:shulker_box", name: "Shulker Box", count: 1, maxCount: 1,
    contents: [item(), ...Array.from({ length: 26 }, empty)] });
  const bundle = item({ itemId: "minecraft:bundle", name: "Bundle", count: 1, maxCount: 1, contents: [item()] });
  const next = h.apply(snapshot(), update({ inventory: {
    slots: [{ index: 5, item: shulker }, { index: 20, item: bundle }] } }));
  assert.equal(next.inventory.slots[5].contents.length, 27);
  assert.equal(next.inventory.slots[20].contents[0].itemId, "minecraft:stone");
  const nested = item({ contents: [item({ contents: [] })] });
  assert.throws(() => h.apply(snapshot(), update({ inventory: { slots: [{ index: 5, item: nested }] } })));
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
  assert.throws(() => h.apply(snapshot(), { schemaVersion: 4, type: "update", state: missing }));
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
    { changedAt: -1 }, { changedAt: "now" }, { sessionRate: "" }, { recentRate: 5 }
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
      display: "123.45 m", sessionDisplay: "0.5 m", changedAt: now - 2000, sessionRate: "1.2 m", recentRate: "3 m" }),
    counter({ id: "minecraft:custom/minecraft:play_time", label: "Time Played", display: "1.02 h",
      changedAt: now - 500 }),
    stone({ changedAt: now - 3000 }),
    stone({ id: "minecraft:used/minecraft:diamond_pickaxe", label: "Diamond Pickaxe", category: "Used",
      changedAt: now - 1000 }),
    stone({ id: "minecraft:mined/minecraft:dirt", label: "Dirt", changedAt: now - 61_000 })
  ]) })));
  const pinned = h.get("#statistics-entries").children;
  const cells = row => row.children.map(cell => cell.textContent);
  assert.deepEqual(pinned.map(cells), [["Distance Walked", "123.45 m", "+0.5 m", "1.2 m/h", "3 m/h"],
    ["Sprint One Cm", "0", "", "", ""], ["Jumps", "40", "+3", "6/h", ""], ["Deaths", "0", "", "", ""],
    ["Mob Kills", "0", "", "", ""], ["Player Kills", "0", "", "", ""], ["Time Played", "1.02 h", "+3", "6/h", ""]],
    "chosen statistics follow the settings order, with hourly rates; ones not received read as zero");
  assert.equal(h.get("#statistics-columns").hidden, false, "column headings show above chosen statistics");
  const recent = h.get("#statistics-recent").children;
  assert.deepEqual(recent.map(row => cells(row).slice(0, 3)), [["Diamond PickaxeUsed", "12", "+12"], ["StoneMined", "12", "+12"]],
    "recent excludes chosen, excluded and older-than-a-minute statistics, newest first");
  assert.equal(h.get("#statistics-recent-section").hidden, false);
  const replacements = h.get("#statistics-entries").replacements;
  h.sockets[0].message(update({ health: 17 }));
  assert.equal(h.get("#statistics-entries").replacements, replacements, "unchanged statistics are not rebuilt");
  h.sockets[0].message(update({ baseRevision: 7, revision: 8, statistics: null }));
  assert.equal(h.get("#statistics-status").textContent, "Unavailable");
  assert.deepEqual(h.get("#statistics-entries").children.map(row => cells(row).slice(0, 3)), [["Distance Walked", "0", ""],
    ["Sprint One Cm", "0", ""], ["Jumps", "0", ""], ["Deaths", "0", ""], ["Mob Kills", "0", ""],
    ["Player Kills", "0", ""], ["Time Played", "0", ""]], "unavailable statistics read as zero under their last known labels");
  assert.equal(h.get("#statistics-recent-section").hidden, true);
});

test("recent statistics have buttons to pin them or hide them from recent", async () => {
  const h = harness();
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ statistics: statistics([
    stone({ changedAt: now - 3000 }),
    stone({ id: "minecraft:used/minecraft:diamond_pickaxe", label: "Diamond Pickaxe", category: "Used", changedAt: now - 1000 })
  ]) })));
  const recent = () => h.get("#statistics-recent").children;
  const [, hide] = recent()[0].children.at(-1).children;
  hide.emit("click");
  assert.equal(plain(h.run("layout.settings.statistics.recentExcluded")).includes("minecraft:used/minecraft:diamond_pickaxe"), true,
    "hiding keeps a statistic out of recent");
  assert.deepEqual(recent().map(row => row.children[0].textContent), ["StoneMined"]);
  const [pin] = recent()[0].children.at(-1).children;
  pin.emit("click");
  assert.equal(plain(h.run("layout.settings.statistics.shown")).at(-1), "minecraft:mined/minecraft:stone",
    "pinning adds a statistic to the permanent list");
  assert.equal(h.get("#statistics-entries").children.at(-1).children[0].textContent, "StoneMined");
  assert.equal(h.get("#statistics-recent-section").hidden, true);
});

test("recent statistics can be kept until replaced, limited to the chosen number of rows", async () => {
  const h = harness();
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ statistics: statistics([
    stone({ changedAt: now - 1000 }),
    stone({ id: "minecraft:mined/minecraft:dirt", label: "Dirt", changedAt: now - 120_000 }),
    stone({ id: "minecraft:mined/minecraft:sand", label: "Sand", changedAt: now - 600_000 })
  ]) })));
  assert.equal(h.get("#statistics-recent").children.length, 1, "the one-minute default hides older changes");
  assert.equal(h.get("#statistics-recent-hint").textContent, "· changed in the last minute");
  h.get("#statistics-settings").emit("click");
  assert.equal(h.get("#statistics-recent-lifetime").value, "60");
  assert.equal(h.get("#statistics-recent-rows").value, "8");
  h.get("#statistics-recent-lifetime").value = "0";
  h.get("#statistics-recent-lifetime").emit("change");
  assert.equal(plain(h.run("layout.settings.statistics.recentLifetime")), 0);
  assert.equal(h.get("#statistics-recent").children.length, 3, "until replaced keeps every change");
  assert.equal(h.get("#statistics-recent-hint").textContent, "· latest changes");
  h.get("#statistics-recent-rows").value = "2";
  h.get("#statistics-recent-rows").emit("change");
  assert.equal(h.get("#statistics-recent").children.length, 2, "newer changes push the oldest out");
  assert.equal(h.get("#statistics-recent").children[1].children[0].textContent.startsWith("Dirt"), true);
});

test("the statistics window chooses shown statistics and what may appear under recent, and saves them", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ statistics: statistics([counter(), stone({ changedAt: now - 1000 }),
    stone({ id: "minecraft:mined/minecraft:sand", label: "Sand", changedAt: null })]) })));
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
  const labels = category => options().find(group => group.children[0].textContent === category)
    .children.slice(1).map(value => value.children[0].textContent);
  assert.deepEqual(labels("Mined"), ["Stone", "Sand"], "pinned statistics sort first in their category");
  show.children[0].checked = false;
  show.children[0].emit("change");
  assert.deepEqual(labels("Mined"), ["Sand", "Stone"], "and unpinning sorts them back");
  show.children[0].checked = true;
  show.children[0].emit("change");
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
  assert.equal(h.get("#statistics-entries").children.every(row => row.children[1].textContent === "0"), true);
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

test("slots show game-rendered icons, counts and durability bars without a glint", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial());
  const stone = slotParts(hotbar(h)[0]);
  assert.equal(stone.icon.src, "/icon/e0-1a2b.png");
  assert.equal(stone.icon.hidden, false);
  assert.equal(stone.count.textContent, "32");
  assert.equal(stone.durability.hidden, true);
  assert.equal(stone.placeholder.hidden, true);
  assert.equal(hotbar(h)[0].className, "slot selected");
  assert.equal(hotbar(h)[0].attributes["aria-label"], "Stone × 32");
  const empty = slotParts(hotbar(h)[1]);
  assert.equal(empty.icon.hidden, true);
  assert.equal(empty.placeholder.hidden, false);
  const tool = item({ name: "Diamond Pickaxe", count: 1, maxCount: 1, damage: 390, maxDamage: 1561,
    remainingDurability: 1171, foil: true, icon: "e3-ff" });
  socket.message(update({ inventory: { slots: [{ index: 1, item: tool }], selectedHotbarSlot: 1,
    equipment: { mainhand: tool, head: tool } } }));
  const pickaxe = slotParts(hotbar(h)[1]);
  assert.equal(pickaxe.count.textContent, "");
  assert.equal(pickaxe.icon.src, "/icon/e3-ff.png");
  assert.equal(hotbar(h)[1].children.some(child => child.className === "glint"), false,
    "enchanted items get no glint overlay");
  assert.equal(pickaxe.durability.hidden, false);
  assert.equal(pickaxe.bar.style.width, "75%");
  assert.equal(pickaxe.bar.style.background, "hsl(90, 100%, 50%)");
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
    // The original four tiles only, so the expected positions stay readable.
    const fresh = defaultLayout();
    const base = { ...fresh, tiles: fresh.tiles.map(t => ["player", "inventory", "statistics", "history"].includes(t.id)
      ? t : { ...t, enabled: false }) };
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
  assert.equal(partial.tiles.length, 12);
  assert.equal(partial.tiles.filter(tile => tile.enabled).length, 1, "missing tiles are added disabled");
  for (const bad of [null, [], { version: 3, tiles: [] }, { version: 1 }, { version: 2 },
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
      ["JourneyMap", "false"], ["Build progress", "false"], ["Movement", "false"], ["Experience", "false"],
      ["Recent pickups", "false"], ["Advancements", "false"], ["Villager trades", "false"], ["Performance", "false"]]);
  await h.runTimers(400);
  const saves = requests.filter(request => request.url === "/api/layout" && request.method === "PUT");
  assert.equal(saves.length, 1, "a version 1 layout is saved back converted");
  assert.equal(JSON.parse(saves[0].body).version, 2);
  h.sockets[0].emit("close");
  await h.reconnect();
  assert.equal(requests.filter(request => request.url === "/api/layout" && !request.method).length, 1, "layout loads once");
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
  assert.equal(h.get("#layout-status").textContent, "That file is not a MinePanel layout (Invalid layout)");
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

test("the update rate is a global layout setting saved for the game to pick up", async () => {
  const requests = [];
  const stored = { ...plain(harness().run("defaultLayout()")), updates: { intervalMillis: 100 } };
  const h = harness(defaultFetch(stored, requests));
  await h.flush();
  const select = h.get("#update-rate");
  assert.deepEqual(select.children.map(option => option.textContent),
    ["20× per second", "10× per second", "4× per second", "2× per second", "1× per second"]);
  assert.equal(select.value, "100", "the stored rate is shown");

  select.value = "50";
  select.emit("change");
  await h.runTimers(400);
  const saved = JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body);
  assert.deepEqual(saved.updates, { intervalMillis: 50 });

  const normalize = value => h.run(`normalizeLayout(${JSON.stringify(value)})`);
  assert.deepEqual(plain(normalize({ version: 1, tiles: [] }).updates), { intervalMillis: 250 }, "defaults to 4/s");
  for (const bad of [{ intervalMillis: 16 }, { intervalMillis: "50" }, []]) {
    assert.throws(() => normalize({ version: 1, tiles: [], updates: bad }), JSON.stringify(bad));
  }
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

test("inventory arrangement shows only whole rows that fit, preferring rows, then slot size, then equipment", () => {
  const h = harness();
  const arrange = (width, height, armor) => plain(h.run(`inventoryArrangement(${width}, ${height}, ${armor})`));
  assert.deepEqual(arrange(500, 300, true), { wide: false, slot: 52,
    rows: ["hotbar", "main3", "main2", "main1", "equipment"], height: 272 });
  assert.deepEqual(arrange(700, 250, true), { wide: true, slot: 52, rows: ["hotbar", "main3", "main2", "main1"],
    height: 217 }, "with room for an armor column, armor sits beside the storage rows");
  assert.deepEqual(arrange(700, 250, false), { wide: true, slot: 52, rows: ["hotbar", "main3", "main2", "main1"],
    height: 217 }, "with armor hidden, the offhand, ender chest and head column still sits beside the rows");
  assert.deepEqual(arrange(500, 110, true), { wide: false, slot: 52, rows: ["hotbar", "main3"], height: 107 },
    "too short for everything: keep full-size slots and add only rows that fully fit");
  assert.deepEqual(arrange(500, 60, true).rows, ["hotbar"]);
  assert.deepEqual(arrange(200, 300, false), { wide: false, slot: 19,
    rows: ["hotbar", "main3", "main2", "main1", "equipment"], height: 107 },
    "narrow tiles shrink slots instead of dropping rows");
  for (const width of [60, 150, 333, 480, 900]) {
    for (const height of [20, 45, 100, 170, 260, 500]) {
      for (const armor of [true, false]) {
        const result = arrange(width, height, armor);
        const columns = !result.wide ? 9 : armor ? 11 : 10;
        assert.ok(result.height <= height, `fits height ${width}x${height}`);
        assert.ok(columns * result.slot + (columns - 1) * 3 + (columns - 9) * 9 <= width, `fits width ${width}x${height}`);
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
  assert.deepEqual(extras(h).map(slot => [slot.style.gridRow, slot.style.gridColumn]), [["1", "9"], ["1", "6"]],
    "the ender chest follows the offhand and the head ends the equipment row");
  assert.equal(h.get("#held-value").hidden, false);

  resize({ left: 0, top: 0, width: 728, height: 280 });
  assert.equal(grid.style.gridTemplateColumns, "var(--slot) 6px repeat(9, var(--slot)) 6px var(--slot)");
  assert.deepEqual(equipment(h).map(slot => [slot.style.gridRow, slot.style.gridColumn]),
    [["1", "1"], ["2", "1"], ["3", "1"], ["4", "1"], ["4", "13"]], "armor column beside rows, offhand by the hotbar");
  assert.deepEqual(extras(h).map(slot => [slot.style.gridRow, slot.style.gridColumn]), [["1", "13"], ["3", "13"]],
    "the head tops the offhand column with the ender chest above the offhand");
  assert.equal(hotbar(h)[0].style.gridColumn, "3");

  h.get("#armor-toggle").emit("click");
  assert.equal(h.get("#armor-toggle").attributes["aria-pressed"], "false");
  assert.deepEqual(equipment(h).map(slot => slot.hidden), [true, true, true, true, false], "only armor hides");
  assert.equal(grid.style.gridTemplateColumns, "repeat(9, var(--slot)) 6px var(--slot)");
  assert.deepEqual([equipment(h)[4], ...extras(h)].map(slot => [slot.style.gridRow, slot.style.gridColumn]),
    [["4", "11"], ["1", "11"], ["3", "11"]], "the offhand, head and ender chest stay beside the rows");
  assert.equal(hotbar(h)[0].style.gridColumn, "1");
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

test("player tile shows saturation and hunger above health, food, and status effects with timers and beacon markers", async () => {
  const h = harness();
  await h.flush();
  const now = Date.now();
  h.sockets[0].message(initial(snapshot({ saturation: 5, food: 17, effects: [
    { id: "minecraft:haste", name: "Haste", amplifier: 1, endsAt: now + 12_400, beacon: true },
    { id: "minecraft:night_vision", name: "Night Vision", amplifier: 0, endsAt: null, beacon: false },
    { id: "minecraft:speed", name: "Speed", amplifier: 0, endsAt: now + 3_725_000, beacon: false }
  ] })));
  assert.equal(h.get("#saturation-fill").style.width, "25%");
  assert.equal(h.get("#food-fill").style.width, "85%");
  assert.equal(h.get("#food-value").textContent, "17/5");
  const effects = h.get("#effects").children;
  assert.equal(effects.length, 3);
  const [icon, level, source, timer] = effects[0].children;
  assert.equal(icon.src, "/effect/minecraft/haste.png");
  assert.equal(level.textContent, "II");
  assert.equal(source.hidden, false);
  assert.equal(effects[0].className, "effect beacon");
  assert.equal(timer.textContent, "", "an active beacon effect hides its countdown");
  assert.equal(timer.hidden, true);
  assert.equal(effects[0].attributes.title, "Haste II · from a beacon");
  assert.equal(effects[1].children[3].textContent, "∞");
  assert.equal(effects[1].children[2].hidden, true);
  assert.equal(effects[2].children[3].textContent, "1:02:05");
  h.run(`tickEffects(${now + 10_000})`);
  assert.equal(effects[2].children[3].textContent, "1:01:55", "timers count down locally");
  h.run(`tickEffects(${now + 20_000})`);
  assert.equal(effects[2].children[3].textContent, "1:01:45");
  h.sockets[0].message(update({ effects: [{ id: "minecraft:haste", name: "Haste", amplifier: 1,
    endsAt: now + 30_000, beacon: false }] }));
  assert.equal(h.get("#effects").children[0], effects[0], "a refreshed effect keeps its element");
  assert.equal(timer.hidden, false, "the countdown returns once the beacon stops reaching the player");
  assert.equal(effects[0].className, "effect");
  assert.match(effects[0].attributes.title, /^Haste II · 0:\d\d$/);
  assert.equal(h.get("#effects").children.length, 1);
  h.sockets[0].message(update(unavailable({ revision: 8, baseRevision: 7 })));
  assert.equal(h.get("#effects").children.length, 0);
  assert.equal(h.get("#saturation-fill").style.width, "0%");
  assert.equal(h.get("#food-fill").style.width, "0%");
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

// ------------------------------------------------------------------------------------- World features

const now = () => Date.now();
const shulker = (overrides = {}) => item({ itemId: "minecraft:shulker_box", name: "Shulker Box", count: 1, maxCount: 1,
  icon: "e0-5b", contents: [item({ name: "Diamond", itemId: "minecraft:diamond" }), ...Array.from({ length: 26 }, empty)],
  ...overrides });
const crossing = (overrides = {}) => ({ id: 3, at: 1000, fromDimension: "minecraft:overworld",
  from: { x: 803, y: 64, z: -1605 }, toDimension: "minecraft:the_nether", to: { x: 99, y: 70, z: -200 },
  target: { x: 100, y: 64, z: -201 }, ...overrides });
const inNether = (overrides = {}) => snapshot({ dimension: "minecraft:the_nether", position: { x: 100, y: 70, z: -191 },
  ...overrides });
const villager = (overrides = {}) => ({ uuid: "123e4567-e89b-12d3-a456-426614174000", profession: "minecraft:librarian",
  professionName: "Librarian", level: 3, name: null, dimension: "minecraft:overworld", x: 1, y: 80, z: 23,
  seenAt: 100, tradedAt: 100, trades: [{ costA: item({ name: "Emerald", itemId: "minecraft:emerald", count: 17 }),
    costB: item({ name: "Book", itemId: "minecraft:book", count: 1 }),
    result: item({ name: "Enchanted Book", itemId: "minecraft:enchanted_book", count: 1, maxCount: 1,
      enchantments: [{ id: "minecraft:mending", name: "Mending", level: 1 }] }), uses: 0, maxUses: 12 }],
  ...overrides });

test("navigation, portal and experience maths match the game", () => {
  const h = harness();
  const result = h.run(`({
    south: bearingTo({ x: 0, z: 0 }, { x: 0, z: 10 }), west: bearingTo({ x: 0, z: 0 }, { x: -10, z: 0 }),
    north: bearingTo({ x: 0, z: 0 }, { x: 0, z: -10 }), east: bearingTo({ x: 0, z: 0 }, { x: 10, z: 0 }),
    right: relativeBearing(0, 90), behind: relativeBearing(270, 90), left: relativeBearing(10, 280),
    points: [0, 45, 90, 180, 225, 315].map(compassPoint),
    directions: axisDirections({ x: 97, z: -207 }, { x: 100, z: -201 }),
    close: obsidianCheck({ crossing: { at: 1, target: { x: 100, y: 64, z: -201 } }, obsidian: [{ at: 2, x: 103, y: 70, z: -199 }] }),
    far: obsidianCheck({ crossing: { at: 1, target: { x: 100, y: 64, z: -201 } }, obsidian: [{ at: 2, x: 97, y: 70, z: -207 }] }),
    stale: obsidianCheck({ crossing: { at: 5, target: { x: 0, y: 0, z: 0 } }, obsidian: [{ at: 2, x: 0, y: 0, z: 0 }] }),
    levels: [0, 15, 16, 30, 31, 100].map(xpAtLevel), costs: [0, 15, 30].map(xpForNextLevel),
    rate: xpPerHour({ gained: { 60: 50 } }, 60), eta: secondsToGain(100, 3600), idle: secondsToGain(5, 0),
    hundred: [nextHundred(5), nextHundred(100), nextHundred(250)]
  })`);
  assert.deepEqual(plain(result), { south: 0, west: 90, north: 180, east: 270, right: 90, behind: 180, left: 270,
    points: ["S", "SW", "W", "N", "NE", "SE"], directions: "3 E and 6 S",
    close: { block: { at: 2, x: 103, y: 70, z: -199 }, distance: Math.hypot(3, 2), ok: true, move: "3 W and 2 N" },
    far: { block: { at: 2, x: 97, y: 70, z: -207 }, distance: Math.hypot(3, 6), ok: false, move: "3 E and 6 S" },
    stale: null, levels: [0, 315, 352, 1395, 1507, 30970], costs: [7, 37, 112], rate: 3000, eta: 100, idle: null,
    hundred: [100, 200, 300] });
});

// ------------------------------------------------------------------------------------------------ Rules v2

/** The example layout from docs/RULES_V2.md. */
const docLayout = () => ({ version: 2, tiles: [], profiles: [{ id: "nether", name: "Nether", tiles: [] }],
  pinned: [{ source: "inventory", slot: 9, x: 10, y: 20 }],
  animation: { durationMs: 300, easing: "ease-out" },
  folders: [{ id: "combat", name: "Combat", enabled: true, collapsed: false }],
  places: [{ id: "home", name: "Home", world: "Test World", dimension: "minecraft:overworld", x: 120, y: 64, z: -340 }],
  toggles: [{ id: "afk", name: "AFK", on: false }],
  rules: [{ id: "xp-gain", name: "XP while gaining", enabled: true, folder: null,
    when: [{ type: "xpGained", compare: ">=", value: 1, window: 10 },
      { join: "and", not: true, type: "inCombat", within: 5 },
      { join: "or", type: "toggle", toggle: "afk" }],
    then: [{ do: "show", panel: "xp" }, { do: "set", panel: "xp", setting: "window", value: 10 }],
    else: [], timing: { delayMs: 0, lingerMs: 2000 }, animation: null }] });

/** The pure rules and layout functions, from a fresh dashboard context. */
function rulesApi() {
  return harness().run(`({ normalizeLayout, migrateLayoutV1, normalizeLayoutV1, createRuleEngine, effectiveView,
    evaluateCondition, ruleBlocks, defaultLayout, removeProfile })`);
}

const ruleLayout = (R, rules, extra = {}) => R.normalizeLayout({ version: 2, tiles: [], ...extra, rules });
const rule = (id, when, then = [], more = {}) => ({ id, name: id, enabled: true, when, then, ...more });
const ruleEnv = (player = snapshot(), more = {}) => ({ player, width: 1280, clock: { minutes: 600, weekday: 1 }, ...more });
const toggleRow = (id, join) => join ? { join, type: "toggle", toggle: id } : { type: "toggle", toggle: id };
const toggleList = on => ["a", "b", "c", "d"].map(id => ({ id, name: id.toUpperCase(), on: on.includes(id) }));

test("rules v2: the documented layout round-trips and missing parts get defaults", () => {
  const R = rulesApi();
  const layout = plain(R.normalizeLayout(docLayout()));
  for (const key of ["rules", "folders", "places", "toggles", "animation", "pinned"]) {
    assert.deepEqual(layout[key], docLayout()[key], key);
  }
  assert.equal(layout.profiles[0].tiles.length, 12);
  assert.equal(layout.profiles[0].settings.xp.window, 60, "profile settings are completed with defaults");
  assert.deepEqual(plain(R.normalizeLayout(layout)), layout, "normalizing is idempotent");
  assert.deepEqual(plain(R.normalizeLayout(plain(R.defaultLayout()))), plain(R.defaultLayout()));
  const minimal = plain(R.normalizeLayout({ version: 2, tiles: [], rules: [{ id: "r", name: "R", enabled: false,
    when: [{ type: "inGame", join: "or" }, { type: "still" }, { type: "elytra", join: "or", not: false }] }] }));
  assert.deepEqual(minimal.rules[0], { id: "r", name: "R", enabled: false, folder: null,
    when: [{ type: "inGame" }, { type: "still", join: "and" }, { type: "elytra", join: "or" }],
    then: [], else: [], timing: { delayMs: 0, lingerMs: 2000 }, animation: null });
  assert.deepEqual(minimal.animation, { durationMs: 300, easing: "ease-out" });
  assert.deepEqual([minimal.folders, minimal.places, minimal.toggles], [[], [], []]);
  const removed = plain(R.removeProfile(R.normalizeLayout({ ...docLayout(), rules: [{ ...docLayout().rules[0],
    then: [{ do: "profile", profile: "nether" }, { do: "show", panel: "xp" }] }] }), "nether"));
  assert.deepEqual(removed.rules[0].then, [{ do: "show", panel: "xp" }], "removing a profile drops actions switching to it");
});

test("rules v2: invalid layouts are rejected, naming the rule", () => {
  const R = rulesApi();
  const withRule = change => {
    const value = docLayout();
    value.rules[0] = { ...value.rules[0], ...change };
    return value;
  };
  const withCondition = (index, change) => withRule({ when: docLayout().rules[0].when.map((condition, position) =>
    position === index ? { ...condition, ...change } : condition) });
  const then = action => withRule({ then: [action] });
  const named = [
    withCondition(0, { type: "weather2" }), withCondition(0, { compare: "~" }), withCondition(0, { compare: "between" }),
    withCondition(0, { compare: "between", value: 5, value2: 4 }), withCondition(0, { value: "1" }),
    withCondition(0, { window: 0 }), withCondition(0, { window: 3601 }), withCondition(0, { for: 5, within: 5 }),
    withCondition(0, { for: 0 }), withCondition(1, { within: undefined }), withCondition(1, { for: 3 }),
    withCondition(1, { join: "xor" }), withCondition(1, { not: "yes" }), withCondition(2, { toggle: "missing" }),
    withRule({ when: Array(33).fill({ type: "inGame" }) }), withRule({ when: "inGame" }),
    withRule({ then: Array(17).fill({ do: "show", panel: "xp" }) }), withRule({ else: [{ do: "hide", panel: "xp", fill: "xp" }] }),
    then({ do: "set", panel: "xp", setting: "window", value: 45 }), then({ do: "set", panel: "xp", setting: "colour", value: 1 }),
    then({ do: "place", panel: "history", x: 0, y: 0, w: 2, h: 3 }), then({ do: "place", panel: "xp", x: 11, y: 0, w: 2, h: 2 }),
    then({ do: "swap", panel: "xp", with: "xp" }), then({ do: "show", panel: "chat" }),
    then({ do: "profile", profile: "missing" }), then({ do: "notify", text: "x".repeat(129) }),
    then({ do: "notify", text: "" }), then({ do: "explode" }),
    withRule({ timing: { lingerMs: 499 } }), withRule({ timing: { delayMs: -1 } }), withRule({ folder: "missing" }),
    withRule({ animation: { durationMs: 300, easing: "bounce" } }), withRule({ enabled: "yes" }),
    withRule({ when: [{ type: "realTime", from: "24:00", to: "06:00" }] }),
    withRule({ when: [{ type: "realTime", from: "22:00", to: "06:00", days: [1, 1] }] }),
    withRule({ when: [{ type: "nearPlace", place: "home", radius: 5, x2: 1, y2: 1, z2: 1 }] }),
    withRule({ when: [{ type: "nearPlace", place: "away", radius: 5 }] }),
    withRule({ when: [{ type: "nearPlace", x: 0, y: 0, z: 0, radius: 0 }] }),
    withRule({ when: [{ type: "time", values: ["noon"] }] }),
    withRule({ when: [{ type: "time", ticks: { from: 0, to: 24000 } }] }),
    withRule({ when: [{ type: "statRose", stat: "minecraft:stone", compare: ">=", value: 1, window: 10 }] }),
    withRule({ when: [{ type: "holding", item: "Stone" }] }),
    withRule({ when: [{ type: "portalLinking" }] }),
    withRule({ when: [{ type: "ruleActive", rule: "xp-gain" }] })];
  for (const bad of named) {
    assert.throws(() => R.normalizeLayout(bad), /Rule "XP while gaining": /, JSON.stringify(bad.rules[0]).slice(0, 160));
  }
  const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
  const loop = ["a", "b", "c"].map((id, index, all) =>
    rule(id, [{ type: "ruleActive", rule: all[(index + 1) % 3] }]));
  for (const [bad, message] of [
    [{ ...docLayout(), rules: [docLayout().rules[0], docLayout().rules[0]] }, /same id/],
    [{ ...docLayout(), rules: loop }, /form a loop/],
    [{ ...docLayout(), rules: many(129, index => rule(`r${index}`, [])) }, /Too many rules/],
    [{ ...docLayout(), folders: many(33, index => ({ id: `f${index}`, name: "F", enabled: true, collapsed: false })) }, /folders/],
    [{ ...docLayout(), places: many(65, index => ({ ...docLayout().places[0], id: `p${index}` })) }, /places/],
    [{ ...docLayout(), toggles: many(17, index => ({ id: `t${index}`, name: "T", on: false })) }, /toggles/],
    [{ ...docLayout(), toggles: [docLayout().toggles[0], docLayout().toggles[0]] }, /Duplicate toggles/],
    [{ ...docLayout(), toggles: [{ id: "afk", name: "x".repeat(33), on: false }] }, /Invalid toggle/],
    [{ ...docLayout(), places: [{ ...docLayout().places[0], dimension: "Overworld" }] }, /Invalid place/],
    [{ ...docLayout(), places: [{ ...docLayout().places[0], x: 3e7 + 1 }] }, /Invalid place/],
    [{ ...docLayout(), folders: [{ id: "combat", name: "Combat", enabled: true }] }, /Invalid folder/],
    [{ ...docLayout(), animation: { durationMs: 5001, easing: "ease" } }, /animation/],
    [{ ...docLayout(), version: 3 }, /Invalid layout/]]) {
    assert.throws(() => R.normalizeLayout(bad), message);
  }
});

test("rules v2: the shared validator cases are accepted and rejected as LayoutStore.java does", () => {
  const R = rulesApi();
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/layouts-v2.json"), "utf8"));
  assert.ok(cases.valid.length >= 10 && cases.invalid.length >= 90);
  for (const { name, layout } of cases.valid) {
    const normalized = plain(R.normalizeLayout(layout));
    assert.deepEqual(plain(R.normalizeLayout(normalized)), normalized, name);
  }
  for (const { name, layout } of cases.invalid) assert.throws(() => R.normalizeLayout(layout), /./, name);
});

test("rules v2: AND binds tighter than OR, and an empty When never matches", () => {
  const R = rulesApi();
  const when = [toggleRow("a"), toggleRow("b", "and"), toggleRow("c", "or"), toggleRow("d", "and")];
  assert.deepEqual(plain(R.ruleBlocks(when)), [[0, 1], [2, 3]]);
  for (let bits = 0; bits < 16; bits++) {
    const on = ["a", "b", "c", "d"].filter((_, index) => bits & (1 << index));
    const layout = ruleLayout(R, [rule("r", when)], { toggles: toggleList(on) });
    const state = R.createRuleEngine().evaluate(layout, ruleEnv(), 0).states.get("r");
    const [a, b, c, d] = ["a", "b", "c", "d"].map(id => on.includes(id));
    assert.equal(state.matched, a && b || c && d, `toggles on: ${on}`);
    assert.equal(state.active, a && b || c && d);
    assert.deepEqual(plain(state.blocks), [a && b, c && d]);
  }
  const empty = ruleLayout(R, [rule("e", [], [{ do: "show", panel: "xp" }], { else: [{ do: "hide", panel: "xp" }] })]);
  const evaluation = R.createRuleEngine().evaluate(empty, ruleEnv(), 0);
  assert.equal(evaluation.states.get("e").active, false);
  assert.equal(R.effectiveView(empty, evaluation).visible.has("xp"), false, "Else applies to a rule that never matches");
});

test("rules v2: for/within modifiers, not, delay and linger follow the clock", () => {
  const R = rulesApi();
  const run = (when, timing, steps, player = () => snapshot()) => {
    const engine = R.createRuleEngine();
    return steps.map(([at, on]) => {
      const layout = ruleLayout(R, [rule("r", when, [], timing ? { timing } : {})], { toggles: toggleList(on ? ["a"] : []) });
      const state = engine.evaluate(layout, ruleEnv(player()), at).states.get("r");
      return [state.conditions[0].ok, state.active];
    });
  };
  const ok = results => results.map(([value]) => value);
  const active = results => results.map(([, value]) => value);
  assert.deepEqual(ok(run([{ ...toggleRow("a"), for: 30 }], null,
    [[0, true], [29999, true], [30000, true], [31000, false], [32000, true], [61999, true], [62000, true]])),
  [false, false, true, false, false, false, true], "for: continuously true for N s; resets when false");
  assert.deepEqual(ok(run([{ ...toggleRow("a"), within: 5 }], null, [[0, true], [1000, false], [5000, false], [5001, false]])),
    [true, true, true, false], "within: true if true at any point in the last N s");
  assert.deepEqual(ok(run([{ ...toggleRow("a"), for: 10, not: true }], null, [[0, true], [10000, true]])),
    [true, false], "not applies after the modifier");
  assert.deepEqual(active(run([toggleRow("a")], { delayMs: 3000, lingerMs: 2000 },
    [[0, true], [2999, true], [3000, true], [4000, true], [4500, false], [5999, false], [6000, false]])),
  [false, false, true, true, true, true, false], "delay before activating, linger after the last match");
  const offline = run([{ type: "dimension", values: ["nether"], not: true }], null, [[0, true]], () => unavailable());
  assert.deepEqual(offline, [[false, false]], "unknown never counts as true, even with not");
  assert.deepEqual(run([{ type: "inGame", not: true }, toggleRow("a", "and")], null, [[0, true]], () => unavailable()),
    [[true, true]], "meta conditions still evaluate outside a world");
});

test("rules v2: list order wins per property; Else, folders, previews and notifications", () => {
  const R = rulesApi();
  const tiles = plain(R.defaultLayout().tiles);
  const layout = (on, folderEnabled = true) => ruleLayout(R, [
    rule("first", [toggleRow("a")], [{ do: "hide", panel: "movement" },
      { do: "set", panel: "inventory", setting: "showArmor", value: false }]),
    rule("second", [toggleRow("b")], [{ do: "show", panel: "movement" }, { do: "profile", profile: "nether" },
      { do: "notify", text: "Second on", cooldown: 10 }], { else: [{ do: "notify", text: "Second off" },
      { do: "hide", panel: "statistics" }] }),
    rule("needs-third", [{ type: "ruleActive", rule: "third" }], [{ do: "focus", panel: "map" }]),
    rule("third", [toggleRow("c")], [{ do: "place", panel: "xp", x: 0, y: 0, w: 4, h: 4 },
      { do: "swap", panel: "player", with: "history" }], { folder: "f" })
  ], { profiles: [{ id: "nether", name: "Nether", tiles, settings: { inventory: { showArmor: true }, xp: { window: 300 } } }],
    folders: [{ id: "f", name: "F", enabled: folderEnabled, collapsed: false }], toggles: toggleList(on), tiles });
  const engine = R.createRuleEngine();
  const step = (on, at, options = {}) => {
    const value = layout(on, options.folder);
    const evaluation = engine.evaluate(value, ruleEnv(), at, options.force);
    return { evaluation, view: R.effectiveView(value, evaluation) };
  };
  const all = step(["a", "b", "c"], 0);
  assert.equal(all.view.profileId, "nether");
  assert.equal(all.view.visible.has("movement"), false, "the higher rule's Hide beats the lower rule's Show");
  assert.deepEqual(plain(all.view.claims.filter(claim => claim.property === "visible:movement")
    .map(claim => [claim.rule, claim.won])), [["first", true], ["second", false]]);
  assert.equal(all.view.settings.inventory.showArmor, false, "setting claims apply on top of the switched profile");
  assert.equal(all.view.settings.xp.window, 300);
  assert.equal(all.view.focus, "map", "Rule active reads a rule listed below it");
  assert.deepEqual(plain(all.view.rects), { xp: { x: 0, y: 0, w: 4, h: 4 }, player: { swap: "history" },
    history: { swap: "player" } });
  assert.deepEqual(plain(all.evaluation.notifications.map(entry => entry.text)), ["Second on"]);
  assert.deepEqual(plain(all.evaluation.events.map(event => [event.rule, event.active])),
    [["first", true], ["second", true], ["third", true], ["needs-third", true]]);
  assert.deepEqual(plain(all.view.rules), ["first", "second", "needs-third", "third"]);

  const later = step(["a"], 5000);
  assert.equal(later.evaluation.states.get("second").active, false);
  assert.deepEqual(plain(later.evaluation.notifications.map(entry => entry.text)), ["Second off"],
    "Else notifies when the rule turns off");
  assert.equal(later.view.visible.has("statistics"), false, "an inactive rule applies Else");
  assert.equal(later.view.profileId, "default");
  assert.deepEqual(plain(step(["a", "b"], 6000).evaluation.notifications), [], "a notification waits for its cooldown");
  assert.deepEqual(plain(step(["a", "b"], 20000).evaluation.notifications), [], "and fires only when the rule turns on");
  const folderOff = step(["c"], 30000, { folder: false });
  assert.equal(folderOff.evaluation.states.get("third").enabled, false, "a disabled folder disables its rules");
  assert.equal(folderOff.evaluation.states.get("needs-third").active, false);
  const forced = step([], 40000, { force: { first: "on", second: "off" } });
  assert.equal(forced.evaluation.states.get("first").active, true);
  assert.equal(forced.evaluation.states.get("first").forced, "on");
  assert.equal(forced.view.visible.has("movement"), false);
  assert.ok(engine.log().length >= 8 && engine.log().every(event => typeof event.at === "number"));
});

test("rules v2: every condition type reads the snapshot", () => {
  const R = rulesApi();
  const now = 1_000_000;
  const refs = { places: [{ id: "home", name: "Home", world: "Test World", dimension: "minecraft:overworld",
    x: 120, y: 64, z: -340 }], toggles: [{ id: "afk", name: "AFK", on: true }] };
  const evaluate = (condition, player = snapshot(), extra = {}) => {
    const normalized = R.normalizeLayout({ version: 2, tiles: [], ...refs,
      rules: [rule("r", [condition]), rule("on", [])] }).rules[0].when[0];
    const ctx = { player, now, width: 1280, clock: { minutes: 23 * 60, weekday: 6 },
      toggles: new Map([["afk", true]]), places: new Map([["home", refs.places[0]]]), ruleActive: id => id === "on",
      amount: () => null, returnTrip: () => false, ...extra };
    return R.evaluateCondition(normalized, ctx).holds;
  };
  const damaged = item({ itemId: "minecraft:iron_pickaxe", count: 1, maxCount: 1, damage: 95, maxDamage: 100,
    remainingDurability: 5 });
  const withHeld = held => snapshot({ inventory: { ...inventory(), slots: [held, ...inventory().slots.slice(1)],
    equipment: { ...inventory().equipment, mainhand: held } } });
  const effect = (endsAt, amplifier = 1) => snapshot({ effects: [{ id: "minecraft:speed", name: "Speed", amplifier,
    endsAt, beacon: false }] });
  const event = (category, at) => history({ events: [{ id: 9, timestamp: at, category, label: category, details: "" }] });
  const enderStone = { seenAt: 1, slots: [item({ count: 10 }), ...Array.from({ length: 26 }, empty)] };
  const pickups = [{ id: 1, at: now - 5000, source: "Ground", item: item({ itemId: "minecraft:diamond", name: "Diamond" }), count: 3 }];
  const cases = [
    [{ type: "world", values: ["test world"] }, undefined, true],
    [{ type: "world", values: ["singleplayer"] }, undefined, true],
    [{ type: "world", values: ["Other"] }, undefined, false],
    [{ type: "dimension", values: ["overworld"] }, undefined, true],
    [{ type: "dimension", values: ["nether"] }, undefined, false],
    [{ type: "biome", values: ["Plains"] }, undefined, true],
    [{ type: "time", values: ["day"] }, undefined, true],
    [{ type: "time", ticks: { from: 23000, to: 1000 } }, undefined, false],
    [{ type: "time", ticks: { from: 5000, to: 7000 } }, undefined, true],
    [{ type: "weather", values: ["rain", "thunder"] }, undefined, false],
    [{ type: "day", compare: ">=", value: 3 }, undefined, true],
    [{ type: "day", compare: "between", value: 4, value2: 10 }, undefined, false],
    [{ type: "gameMode", values: ["survival"] }, undefined, true],
    [{ type: "nearPlace", place: "home", radius: 3 }, snapshot({ position: { x: 121, y: 64, z: -341 } }), true],
    [{ type: "nearPlace", place: "home", radius: 3 }, snapshot({ position: { x: 121, y: 64, z: -341 },
      world: { ...details().world, name: "Other" } }), false],
    [{ type: "nearPlace", place: "home", radius: 5, flat: true }, snapshot({ position: { x: 120, y: 200, z: -340 } }), true],
    [{ type: "nearPlace", place: "home", radius: 5 }, snapshot({ position: { x: 120, y: 200, z: -340 } }), false],
    [{ type: "nearPlace", x: 0, y: 60, z: -5, x2: 2, y2: 70, z2: 0 }, undefined, true],
    [{ type: "nearPlace", x: 0, y: 60, z: -5, x2: 2, y2: 70, z2: 0, dimension: "minecraft:the_nether" }, undefined, false],
    [{ type: "yLevel", compare: "<", value: 0 }, undefined, false],
    [{ type: "health", compare: "between", value: 15, value2: 18 }, undefined, true],
    [{ type: "food", compare: "=", value: 18 }, undefined, true],
    [{ type: "saturation", compare: ">", value: 6 }, undefined, false],
    [{ type: "absorption", compare: "!=", value: 0 }, undefined, true],
    [{ type: "xpLevel", compare: ">=", value: 5 }, undefined, true],
    [{ type: "effect", values: ["speed"], level: { compare: ">=", value: 2 }, remaining: { compare: ">", value: 30 } },
      effect(now + 60000), true],
    [{ type: "effect", values: ["speed"], remaining: { compare: ">", value: 90 } }, effect(now + 60000), false],
    [{ type: "effect", values: ["speed"], remaining: { compare: ">", value: 90 } }, effect(null), true],
    [{ type: "effect", values: ["speed"], level: { compare: ">=", value: 2 } }, effect(null, 0), false],
    [{ type: "movement", values: ["ground"] }, undefined, true],
    [{ type: "speed", axis: "horizontal", compare: ">", value: 4 }, undefined, true],
    [{ type: "speed", axis: "vertical", compare: "<", value: 0 }, undefined, false],
    [{ type: "still" }, undefined, false],
    [{ type: "still" }, snapshot({ motion: { ...details().motion, speed: 0.05 } }), true],
    [{ type: "holding", item: "minecraft:stone", hand: "main" }, undefined, true],
    [{ type: "holding", item: "minecraft:stone", hand: "off" }, undefined, false],
    [{ type: "hasItem", item: "minecraft:stone", compare: "=", value: 32 }, undefined, true],
    [{ type: "hasItem", item: "minecraft:stone", compare: ">=", value: 42 }, snapshot({ enderChest: enderStone }), false],
    [{ type: "hasItem", item: "minecraft:stone", compare: ">=", value: 42, enderChest: true }, snapshot({ enderChest: enderStone }), true],
    [{ type: "freeSlots", compare: "=", value: 35 }, undefined, true],
    [{ type: "durability", target: "held", compare: "<", value: 10 }, withHeld(damaged), true],
    [{ type: "durability", target: "tool", compare: "<", value: 10 }, withHeld(damaged), true],
    [{ type: "durability", target: "armor", compare: "<", value: 10 }, withHeld(damaged), null],
    [{ type: "elytra" }, undefined, false],
    [{ type: "elytra" }, snapshot({ motion: { ...details().motion, glider: item({ name: "Elytra" }) } }), true],
    [{ type: "xpGained", compare: ">=", value: 12, window: 60 }, undefined, true],
    [{ type: "xpGained", compare: ">=", value: 1, window: 10 }, undefined, false],
    [{ type: "pickedUp", item: "minecraft:diamond", compare: ">=", value: 3, window: 10 }, snapshot({ pickups }), true],
    [{ type: "pickedUp", compare: ">=", value: 1, window: 4 }, snapshot({ pickups }), false],
    [{ type: "pickedUp", item: "minecraft:stone", compare: ">=", value: 1, window: 10 }, snapshot({ pickups }), false],
    [{ type: "statRose", stat: "minecraft:custom/minecraft:jump", compare: ">=", value: 1, window: 10 }, undefined, null],
    [{ type: "advancement", within: 10 }, snapshot({ history: event("advancement", now - 5000) }), true],
    [{ type: "advancement", within: 10 }, snapshot({ history: event("advancement", now - 15000) }), false],
    [{ type: "advancement", advancement: "minecraft:story/mine_stone", within: 10 },
      snapshot({ advancements: { tabs: [], entries: [{ id: "minecraft:story/mine_stone", doneAt: now - 2000 }] } }), true],
    [{ type: "advancement", advancement: "minecraft:story/mine_stone", within: 10 }, undefined, null],
    [{ type: "died", within: 10 }, snapshot({ history: event("death", now - 9000) }), true],
    [{ type: "died", within: 10 }, undefined, false],
    [{ type: "changedDimension", within: 60 }, snapshot({ history: event("dimension", now - 1000) }), true],
    [{ type: "joinedWorld", within: 60 }, undefined, false],
    [{ type: "joinedWorld", within: 60 }, snapshot({ sessionSeconds: 10 }), true],
    [{ type: "inCombat", within: 5 }, snapshot({ history: event("damage", now - 1000) }), true],
    [{ type: "inCombat", within: 5 }, snapshot({ history: event("heal", now - 1000) }), false],
    [{ type: "villagersNearby", radius: 32, compare: ">=", value: 1 }, snapshot({ villagers: [villager()] }), true],
    [{ type: "villagersNearby", radius: 30, compare: ">=", value: 1 }, snapshot({ villagers: [villager()] }), false],
    [{ type: "villagersNearby", radius: 32, compare: ">=", value: 1 }, inNether({ villagers: [villager()] }), false],
    [{ type: "toggle", toggle: "afk" }, undefined, true],
    [{ type: "ruleActive", rule: "on" }, undefined, true],
    [{ type: "width", compare: "<", value: 700 }, undefined, false],
    [{ type: "realTime", from: "22:00", to: "06:00" }, undefined, true],
    [{ type: "realTime", from: "22:00", to: "06:00", days: [1, 2, 3, 4, 5] }, undefined, false],
    [{ type: "realTime", from: "08:00", to: "17:00" }, undefined, false],
    [{ type: "sessionTime", compare: ">=", value: 60 }, undefined, true],
    [{ type: "inGame" }, undefined, true],
    [{ type: "inGame" }, unavailable(), false],
    [{ type: "toggle", toggle: "afk" }, unavailable(), true],
    [{ type: "world", values: ["test world"] }, unavailable(), null]];
  for (const [condition, player, expected] of cases) {
    assert.equal(evaluate(condition, player), expected, JSON.stringify(condition));
  }
  assert.equal(evaluate({ type: "width", compare: "<", value: 700 }, undefined, { width: 500 }), true);
  assert.equal(evaluate({ type: "realTime", from: "22:00", to: "06:00" }, undefined,
    { clock: { minutes: 6 * 60, weekday: 0 } }), false, "the end time is excluded");
});

test("rules v2: amounts count only what was gained inside their window", () => {
  const R = rulesApi();
  const ids = ["xp", "damage", "stat", "mined", "zombies", "placed"];
  const layout = ruleLayout(R, [
    rule("xp", [{ type: "xpGained", compare: ">=", value: 5, window: 20 }]),
    rule("damage", [{ type: "tookDamage", compare: ">=", value: 2, window: 10 }]),
    rule("stat", [{ type: "statRose", stat: "minecraft:custom/minecraft:jump", compare: ">=", value: 2, window: 30 }]),
    rule("mined", [{ type: "minedBlock", compare: ">=", value: 3, window: 10 }]),
    rule("zombies", [{ type: "killedMob", entity: "minecraft:zombie", compare: ">=", value: 2, window: 10 }]),
    rule("placed", [{ type: "placedBlock", block: "minecraft:stone", compare: ">=", value: 1, window: 10 }])]);
  const engine = R.createRuleEngine();
  const matched = (player, at) => {
    const states = engine.evaluate(layout, ruleEnv(player), at).states;
    return ids.filter(id => states.get(id).matched);
  };
  const t0 = 1_000_000;
  const kill = (id, label, details) => ({ id, timestamp: t0 + 1000, category: "kill", label, details });
  const player = (points, health, jumps, events, used = 0) => snapshot({ xp: { ...details().xp, points }, health,
    absorption: 0, history: history({ events }), statistics: statistics([counter({ value: jumps }),
      counter({ id: "minecraft:used/minecraft:stone", label: "Stone used", value: used, session: used })]) });
  assert.deepEqual(matched(player(100, 20, 40, [], 5), t0), [], "the first values are only a baseline");
  const events = [{ id: 5, timestamp: t0 + 1000, category: "mine", label: "Mined 2 × Stone", details: "Last at 1, 2, 3" },
    kill(6, "Killed 2 × Zombie", "minecraft:zombie"),
    kill(7, "Killed Skeleton", "minecraft:skeleton · counted from statistics (ranged or indirect kill)")];
  assert.deepEqual(matched(player(106, 16, 42, events, 6), t0 + 1000), ["xp", "damage", "stat", "zombies", "placed"]);
  const coalesced = [{ ...events[0], timestamp: t0 + 2000, label: "Mined 3 × Stone" }, ...events.slice(1)];
  assert.deepEqual(matched(player(106, 16, 42, coalesced, 6), t0 + 2000), ["xp", "damage", "stat", "mined", "zombies", "placed"],
    "a coalesced history event counts what it grew by");
  assert.deepEqual(matched(player(106, 16, 42, coalesced, 6), t0 + 11500), ["xp", "stat"],
    "older increases leave the window");
  assert.deepEqual(matched(unavailable(), t0 + 12000), [], "amounts are unknown outside a world");
});

test("rules v2: portal linking lasts until the portal is lit, you go back through, or time runs out", () => {
  const R = rulesApi();
  const layout = ruleLayout(R, [rule("link", [{ type: "portalLinking", minutes: 10 }])]);
  const engine = R.createRuleEngine();
  const t0 = 1_000_000;
  const matched = (player, at) => engine.evaluate(layout, ruleEnv(player), at).states.get("link").matched;
  const portal = (value, lit = null) => ({ crossing: value, obsidian: [], lit });
  assert.equal(matched(snapshot(), t0), false, "no crossing yet");
  assert.equal(matched(inNether({ portal: portal(crossing({ at: t0 })) }), t0 + 1000), true);
  assert.equal(matched(inNether({ portal: portal(crossing({ at: t0 }), { x: 100, y: 64, z: -201 }) }), t0 + 2000), false);
  assert.equal(matched(inNether({ portal: portal(crossing({ at: t0 })) }), t0 + 600001), false, "ends after N minutes");
  const back = crossing({ id: 4, at: t0 + 5000, fromDimension: "minecraft:the_nether", from: { x: 99, y: 70, z: -200 },
    toDimension: "minecraft:overworld", to: { x: 804, y: 64, z: -1604 }, target: { x: 792, y: 64, z: -1600 } });
  assert.equal(matched(snapshot({ portal: portal(back) }), t0 + 6000), false, "going back through the same portals");
  const elsewhere = crossing({ id: 5, at: t0 + 7000, from: { x: 2000, y: 64, z: 2000 }, to: { x: 250, y: 70, z: 250 },
    target: { x: 250, y: 64, z: 250 } });
  assert.equal(matched(inNether({ portal: portal(elsewhere) }), t0 + 8000), true, "a trip through a new portal");
});

/** A small deterministic random generator for the migration property test. */
function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

test("rules v2: migrating v1 rules keeps their logic, actions and order", () => {
  const R = rulesApi();
  const random = seeded(42);
  const pick = count => Math.floor(random() * count);
  // Each v1 condition is a distinct atom ("world: atom-N"); compare both logics over random atom values.
  for (let round = 0; round < 60; round++) {
    let atoms = 0;
    const groups = Array.from({ length: 1 + pick(5) }, () => Array.from({ length: 1 + pick(round % 3 === 0 ? 8 : 3) },
      () => ({ type: "world", values: [`atom-${atoms++}`], ...(random() < 0.3 ? { not: true } : {}) })));
    const v1 = { version: 1, tiles: [], rules: [{ id: "r", name: "R", enabled: true, groups }] };
    const migrated = plain(R.normalizeLayout(v1));
    const byId = new Map(migrated.rules.map(entry => [entry.id, entry]));
    const truth = (values, condition) => condition.type === "ruleActive"
      ? matches(values, byId.get(condition.rule)) : values[Number(condition.values[0].slice(5))] !== Boolean(condition.not);
    const matches = (values, entry) => R.ruleBlocks(entry.when).some(block => block.every(index => truth(values, entry.when[index])));
    for (let sample = 0; sample < 40; sample++) {
      const values = Array.from({ length: atoms }, () => random() < 0.5);
      const expected = groups.every(group => group.some(condition => values[Number(condition.values[0].slice(5))] !== Boolean(condition.not)));
      assert.equal(matches(values, byId.get("r")), expected, JSON.stringify({ groups, values }));
    }
    const helpers = migrated.rules.filter(entry => entry.id !== "r");
    const expanded = groups.reduce((count, group) => count * group.length, 1) * groups.length;
    assert.equal(helpers.length, expanded > 32 ? groups.length : 0);
    assert.ok(migrated.rules.every(entry => entry.when.length <= 32 && /^[a-z0-9-]{1,32}$/.test(entry.id)));
    if (helpers.length) assert.equal(migrated.rules.at(-1).id, "r", "helpers are listed above the rule using them");
  }
});

test("rules v2: v1 conditions, actions and limits convert as documented", () => {
  const R = rulesApi();
  const settings = { inventory: { showArmor: false }, statistics: { recentRows: 4, recentLifetime: 10 },
    movement: { showVertical: false, showGlider: false }, xp: { window: 300, goals: [40] },
    performance: { window: 30 }, pickups: { lifetime: 5, maxRows: 4, showSource: false } };
  const v1 = { version: 1, tiles: [{ id: "movement", enabled: true, x: 0, y: 0, w: 4, h: 4, rulesOnly: true }],
    profiles: [{ id: "nether", name: "Nether", tiles: [] }], pinned: [{ source: "inventory", slot: 9, x: 10, y: 20 }],
    updates: { intervalMillis: 100 }, rules: [
      { id: "a-very-long-rule-id-that-is-32ch", name: "Nether", enabled: true,
        groups: [[{ type: "dimension", values: ["nether"] }, { type: "health", min: 2, max: 5, not: true }],
          [{ type: "food", max: 6 }, { type: "saturation", min: 1 }, { type: "health" }, { type: "health", min: 9, max: 3 }],
          [{ type: "advancement", seconds: 30 }, { type: "combat" }, { type: "elytra" },
            { type: "time", values: ["night", "noon"] }]],
        profile: "nether", tiles: Object.fromEntries(["player", "inventory", "statistics", "history", "map", "build",
          "movement", "xp"].map((id, index) => [id, index % 2 ? "hide" : "show"])), settings },
      { id: "plain", name: "Plain", enabled: false, groups: [[{ type: "gameMode", values: ["creative", "hardcore"] }]] }] };
  const layout = plain(R.normalizeLayout(v1));
  assert.equal(layout.version, 2);
  assert.equal(layout.tiles.find(tile => tile.id === "movement").rulesOnly, true, "rules-only panels stay rules-only");
  assert.deepEqual([layout.pinned, layout.updates], [v1.pinned, v1.updates]);
  // 2 × 4 × 4 blocks × 3 rows = 96 rows: each group becomes a helper rule.
  assert.deepEqual(layout.rules.map(entry => entry.id), ["a-very-long-rule-id-that-i-p1", "a-very-long-rule-id-that-i-p2",
    "a-very-long-rule-id-that-i-p3", "a-very-long-rule-id-that-is-32ch", "a-very-long-rule-id-that-is-2", "plain"]);
  const [part1, part2, part3, main, rest, plainRule] = layout.rules;
  assert.deepEqual(part1.when, [{ type: "dimension", values: ["nether"] },
    { type: "health", join: "or", not: true, compare: "between", value: 2, value2: 5 }]);
  assert.deepEqual(part2.when.map(({ join, ...condition }) => condition), [{ type: "food", compare: "<=", value: 6 },
    { type: "saturation", compare: ">=", value: 1 }, { type: "health", compare: ">=", value: 0 },
    { type: "health", compare: "<", value: 0 }]);
  assert.deepEqual(part3.when.map(({ join, ...condition }) => condition), [{ type: "advancement", within: 30 },
    { type: "inCombat", within: 10 }, { type: "elytra" }, { type: "time", values: ["night"] }]);
  assert.deepEqual([part1.timing, part1.then, part1.enabled, part1.name], [{ delayMs: 0, lingerMs: 500 }, [], true, "Nether (part 1)"]);
  assert.deepEqual(main.when, [{ type: "ruleActive", rule: part1.id }, { type: "ruleActive", rule: part2.id, join: "and" },
    { type: "ruleActive", rule: part3.id, join: "and" }]);
  assert.deepEqual(main.timing, { delayMs: 0, lingerMs: 2000 }, "the old 2 s hold becomes the linger");
  const actions = [...main.then, ...rest.then];
  assert.equal(main.then.length, 16, "at most 16 actions per rule");
  assert.deepEqual([rest.name, rest.when, rest.enabled], ["Nether (2)", main.when, true], "the rest share the When list");
  assert.deepEqual(actions.slice(0, 3), [{ do: "profile", profile: "nether" }, { do: "show", panel: "player" },
    { do: "hide", panel: "inventory" }]);
  assert.equal(actions.length, 1 + 8 + 11);
  assert.deepEqual(actions.find(action => action.setting === "goals"), { do: "set", panel: "xp", setting: "goals", value: [40] });
  assert.deepEqual([plainRule.when, plainRule.enabled], [[{ type: "gameMode", values: ["creative"] }], false],
    "values that could never match are dropped");
  const v1Small = { version: 1, tiles: [], rules: [{ id: "s", name: "S", enabled: true,
    groups: [[{ type: "elytra" }, { type: "movement", values: ["swimming"] }], [{ type: "biome", values: ["desert"] }]] }] };
  assert.deepEqual(plain(R.normalizeLayout(v1Small)).rules[0].when, [{ type: "elytra" },
    { type: "biome", values: ["desert"], join: "and" }, { type: "movement", values: ["swimming"], join: "or" },
    { type: "biome", values: ["desert"], join: "and" }], "(A or B) and C becomes A and C or B and C");
  const tooMany = { version: 1, tiles: [], rules: Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`, name: "R",
    enabled: true, groups: [0, 1, 2].map(() => [{ type: "elytra" }, { type: "elytra" }, { type: "elytra" }, { type: "elytra" }]) })) };
  assert.throws(() => R.normalizeLayout(tooMany), /more than the limit of 128/);
});

test("rules v2: migrated helper rules behave like the v1 rule in the engine", () => {
  const R = rulesApi();
  const v1 = { version: 1, tiles: plain(R.defaultLayout().tiles), rules: [{ id: "big", name: "Big", enabled: true, tiles: { xp: "hide" }, groups: [
    [{ type: "health", max: 5 }, { type: "food", max: 5 }, { type: "saturation", max: 1 }],
    [{ type: "dimension", values: ["nether"] }, { type: "biome", values: ["desert"] }, { type: "elytra" }],
    [{ type: "time", values: ["night"] }, { type: "gameMode", values: ["creative"] }, { type: "movement", values: ["swimming"] }]] }] };
  const layout = R.normalizeLayout(v1);
  assert.equal(layout.rules.length, 4);
  const engine = R.createRuleEngine();
  const xpShown = (player, at) => R.effectiveView(layout, engine.evaluate(layout, ruleEnv(player), at)).visible.has("xp");
  assert.equal(xpShown(inNether({ health: 4 }), 0), true, "two of three groups match");
  const all = inNether({ health: 4, world: { ...details().world, time: 15000 } });
  assert.equal(xpShown(all, 1000), false, "all three groups match");
  assert.equal(xpShown(inNether({ health: 4 }), 3000), true, "and it turns off after the linger");
});

test("detail fields and item contents are validated", () => {
  const h = harness();
  assert.equal(h.apply(undefined, initial(snapshot({ inventory: { ...inventory(),
    slots: [shulker(), ...inventory().slots.slice(1)], equipment: { ...inventory().equipment, mainhand: shulker() } } })))
    .inventory.slots[0].contents.length, 27);
  for (const bad of [{ world: null }, { world: { ...details().world, weather: "snow" } },
    { motion: { ...details().motion, yaw: 360 } }, { xp: { ...details().xp, gained: { 60: 1 } } },
    { portal: { crossing: crossing({ toDimension: "minecraft:overworld", fromDimension: "minecraft:overworld" }),
      obsidian: [], lit: null } },
    { pickups: [{ id: 1, at: 1, source: "", item: item(), count: 1 }] },
    { villagers: [villager({ uuid: "nope" })] }, { enderChest: { seenAt: 1, slots: [] } },
    { performance: performance([-1]) }, { performance: performance(Array(601).fill(60)) },
    { performance: { ...performance(), windows: { ...performance().windows, 10: { seconds: 10, average: 50, low: 51 } } } },
    { performance: { ...performance(), windows: { 10: null, 30: null, 60: null } } },
    { inventory: { ...inventory(), slots: [shulker({ contents: [shulker()] }), ...inventory().slots.slice(1)] } }]) {
    assert.throws(() => h.apply(undefined, initial(snapshot(bad))), JSON.stringify(bad).slice(0, 100));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ world: details().world }))));
});

test("link portal appears after a Nether trip, guides the player and checks obsidian", async () => {
  const h = harness();
  await h.flush();
  const socket = h.sockets[0];
  socket.message(initial(inNether()));
  assert.equal(h.get("#portal-link").hidden, true, "no button without a portal trip");
  socket.message(update({ revision: 5, baseRevision: 4, portal: { crossing: crossing(), obsidian: [], lit: null } }));
  assert.equal(h.get("#portal-link").hidden, false);
  assert.equal(h.get("#portal-box").hidden, true);
  h.get("#portal-link").emit("click");
  assert.equal(h.get("#portal-box").hidden, false);
  assert.equal(h.get("#portal-link").hidden, true);
  const box = h.get("#portal-box");
  assert.match(box.textContent, /X 100 · Z -201/);
  assert.match(box.textContent, /10 blocks north/, "player at z -191 must go north 10 blocks");
  assert.match(box.textContent, /X 803 · Z -1605 \(÷ 8\)/);
  const arrow = box.children[0].navigator.arrow;
  assert.equal(arrow.style.transform, "rotate(0deg)", "facing north (yaw 180) with the target north: straight ahead");
  socket.message(update({ revision: 6, baseRevision: 5, motion: { ...details().motion, yaw: 270 } }));
  assert.equal(arrow.style.transform, "rotate(-90deg)", "facing east, the target is to the left: a quarter turn back, not three quarters forward");
  socket.message(update({ revision: 7, baseRevision: 6,
    portal: { crossing: crossing(), obsidian: [{ id: 9, at: 2000, x: 97, y: 70, z: -207 }], lit: null } }));
  assert.match(box.children[2].textContent, /✗ .*6\.7 blocks away\. Build it 3 E and 6 S/);
  socket.message(update({ revision: 8, baseRevision: 7,
    portal: { crossing: crossing(), obsidian: [{ id: 10, at: 2100, x: 102, y: 70, z: -200 }], lit: null } }));
  assert.match(box.children[2].textContent, /✓ Your last obsidian .*2\.2 blocks/);
  socket.message(update({ revision: 9, baseRevision: 8,
    portal: { crossing: crossing(), obsidian: [], lit: { x: 101, y: 66, z: -201 } } }));
  assert.match(box.children[2].textContent, /✓ A lit portal is within 4 blocks/);
  socket.message(update({ revision: 10, baseRevision: 9, portal: { crossing: crossing({ id: 4 }), obsidian: [], lit: null } }));
  assert.equal(h.get("#portal-box").hidden, true, "a new trip closes the old box and offers a new link");
  assert.equal(h.get("#portal-link").hidden, false);
  socket.message(update({ revision: 11, baseRevision: 10, dimension: "minecraft:overworld" }));
  assert.equal(h.get("#portal-link").hidden, true, "the link is only offered in the arrival dimension");
});

test("movement shows mode icon, 3D speed in blocks/s and km/h, facing and elytra time", async () => {
  const h = harness();
  await h.flush();
  const elytra = item({ itemId: "minecraft:elytra", name: "Elytra", count: 1, maxCount: 1, damage: 132,
    maxDamage: 432, remainingDurability: 300, icon: "e0-e1" });
  h.sockets[0].message(initial(snapshot({ motion: { mode: "elytra", speed: 34.2, horizontalSpeed: 33, verticalSpeed: -8.9,
    yaw: 225, pitch: 10, icon: elytra, glider: elytra } })));
  assert.equal(h.get("#movement-mode").textContent, "Elytra");
  assert.equal(h.get("#movement-speed").textContent, "34.2 blocks/s · 123.1 km/h");
  assert.equal(h.get("#movement-facing").textContent, "Facing north-east · 45°");
  assert.equal(h.get("#movement-needle").style.transform, "rotate(45deg)");
  assert.equal(h.get("#movement-vertical").textContent, "↓ Falling 8.9 blocks/s");
  assert.equal(h.get("#movement-glider").textContent, "Elytra: 300/432 · about 5 min of flight left");
  assert.equal(slotParts(h.get("#movement-icon").children[0]).icon.src, "/icon/e0-e1.png");
});

test("experience shows XP/h for the chosen window and the time to the next level and next hundred", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  assert.equal(h.get("#xp-level").textContent, "Level 5");
  assert.equal(h.get("#xp-rate").textContent, "720 XP/h");
  assert.equal(h.get("#xp-gained").textContent, "+12 XP in the last 1 min");
  assert.equal(h.get("#xp-next").textContent, "9 XP · 45 s");
  assert.equal(h.get("#xp-hundred-label").textContent, "Level 100");
  assert.equal(h.get("#xp-hundred").textContent, "30,907 XP · 42 h 56 min");
  assert.equal(h.get("#xp-window").textContent, "1 min");
  h.get("#xp-window").emit("click");
  assert.equal(h.get("#xp-window-menu").hidden, false);
  const choices = h.get("#xp-window-menu").children;
  assert.deepEqual(choices.map(choice => choice.textContent), ["10 s", "30 s", "1 min", "5 min", "10 min", "1 h"]);
  choices[5].emit("click");
  assert.equal(h.get("#xp-window-menu").hidden, true);
  assert.equal(h.get("#xp-rate").textContent, "90 XP/h");
  assert.equal(h.get("#xp-window").textContent, "1 h");
  await h.runTimers(400);
  assert.equal(JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body).settings.xp.window, 3600);
});

test("performance shows the average and 1% low with a graph over the chosen window, and saves the window", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  assert.equal(h.get("#performance-status").textContent, "60 FPS", "the badge shows the newest second");
  assert.equal(h.get("#performance-average").textContent, "57 fps");
  assert.equal(h.get("#performance-low").textContent, "24 fps");
  assert.equal(h.get("#performance-peak").textContent, "75 fps", "a rounded ceiling above the highest second");
  assert.equal(h.get("#performance-window").textContent, "1 min");
  const line = h.get("#performance-line").attributes.d;
  assert.match(line, /^M[\d.]+,[\d.]+(C[\d.,]+)+$/, "a smooth curve");
  assert.ok(line.endsWith(",1000,20"), `the newest point, 60 of 75 fps, is at the right edge: ${line.slice(-40)}`);
  assert.ok(h.get("#performance-area").attributes.d.endsWith("L1000,100L813.6,100Z"),
    "12 of 60 seconds fill the right fifth of the graph");
  assert.equal(h.get("#performance-low-line").hidden, false);
  assert.equal(h.get("#performance-low-line").attributes.y1, "68");

  const writes = h.get("#performance-line").attributes.d;
  h.sockets[0].message(update({ revision: 5, baseRevision: 4, motion: { ...details().motion, yaw: 90 } }));
  assert.equal(h.get("#performance-line").attributes.d, writes, "updates without new frame data keep the graph");

  h.get("#performance-window").emit("click");
  const choices = h.get("#performance-window-menu").children;
  assert.deepEqual(choices.map(choice => choice.textContent), ["10 s", "30 s", "1 min", "10 min"]);
  choices[0].emit("click");
  assert.equal(h.get("#performance-window-menu").hidden, true);
  assert.equal(h.get("#performance-window").textContent, "10 s");
  assert.ok(h.get("#performance-area").attributes.d.endsWith("L1000,100L0,100Z"), "10 s fills the graph");
  await h.runTimers(400);
  assert.equal(JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body).settings.performance.window, 10);

  h.sockets[0].message(update({ revision: 6, baseRevision: 5, performance: { fps: [], windows:
    { 10: null, 30: null, 60: null, 600: null } } }));
  assert.equal(h.get("#performance-status").textContent, "Measuring");
  assert.equal(h.get("#performance-average").textContent, "—");
  assert.equal(h.get("#performance-line").attributes.d, "");
  h.sockets[0].message(update({ revision: 7, baseRevision: 6, ...unavailable() }));
  assert.equal(h.get("#performance-status").textContent, "Unavailable");
});

test("the performance graph averages long windows and its curve never overshoots the data", () => {
  const h = harness();
  const points = h.run(`performancePoints(Array.from({ length: 600 }, (_, i) => i % 2 ? 50 : 70), 600)`);
  assert.equal(points.length, 120, "10 minutes become one point per 5 seconds");
  assert.equal(points.at(-1).x, 1);
  assert.ok(points.every(point => point.y > 50 && point.y < 70), "noise is averaged out");
  assert.equal(JSON.stringify(h.run("performancePoints([30, 60], 10)")), '[{"x":0.8888888888888888,"y":30},{"x":1,"y":60}]');
  // A spike between flat runs: a plain cubic would dip below the flat part; the monotone curve stays within it.
  const path = h.run(`smoothPath([{ x: 0, y: 90 }, { x: 10, y: 90 }, { x: 20, y: 10 }, { x: 30, y: 90 }, { x: 40, y: 90 }])`);
  const ys = path.slice(1).split(/[MC]/).join(",").split(",").filter((_, index) => index % 2).map(Number);
  assert.ok(ys.every(y => y >= 10 && y <= 90), `control points stay inside the data range: ${path}`);
  assert.equal(h.run("smoothPath([])"), "");
  assert.equal(h.run("graphPeak([{ x: 1, y: 144 }])"), 200);
  assert.equal(h.run("graphPeak([{ x: 1, y: 0 }])"), 15);
});

test("experience goals take a custom level and show the XP and time still needed", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  assert.equal(h.get("#xp-goals").hidden, true, "no goals by default");
  h.get("#xp-settings").emit("click");
  assert.equal(h.get("#xp-form").hidden, false);
  for (const value of ["0", "2.5", "10001"]) {
    h.get("#xp-goal").value = value;
    h.get("#xp-form").emit("submit");
    assert.match(h.get("#xp-goal-error").textContent, /whole level/);
  }
  for (const value of ["10", "3", "10"]) {
    h.get("#xp-goal").value = value;
    h.get("#xp-form").emit("submit");
  }
  assert.equal(h.get("#xp-goal-error").textContent, "");
  assert.equal(h.get("#xp-goal").value, "");
  assert.deepEqual(plain(h.run("layout.settings.xp.goals")), [3, 10], "sorted without duplicates");
  const rows = () => h.get("#xp-goals").children.map(row => row.textContent);
  assert.equal(h.get("#xp-goals").hidden, false);
  assert.deepEqual(rows(), ["Goal · level 3Reached", "Goal · level 1097 XP · 8 min"]);
  assert.equal(h.get("#xp-goal-list").textContent, "Goals: Level 3 ×Level 10 ×");
  h.get("#xp-goal-list").children[1].emit("click");
  assert.deepEqual(rows(), ["Goal · level 1097 XP · 8 min"]);
  await h.runTimers(400);
  assert.deepEqual(JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body).settings.xp.goals, [10]);
});

test("recent pickups list newest first with source, expire, and can hide an item", async () => {
  const h = harness();
  await h.flush();
  const pickup = (id, name, source, count, at = now()) => ({ id, at, source, count,
    item: item({ name, itemId: `minecraft:${name.toLowerCase()}`, count: 1 }) });
  h.sockets[0].message(initial(snapshot({ pickups: [pickup(1, "Dirt", "Picked up", 3, now() - 60_000),
    pickup(2, "Cobblestone", "Picked up", 23), pickup(3, "Diamond", "from Chest", 2), pickup(4, "Torch", "Placed", -3)] })));
  const rows = () => h.get("#pickups-list").children;
  assert.deepEqual(rows().map(row => row.children[1].textContent),
    ["−3 TorchPlaced · now", "+2 Diamondfrom Chest · now", "+23 CobblestonePicked up · now"],
    "older than the 30 s default lifetime is hidden");
  assert.deepEqual(rows().map(row => row.classList.contains("loss")), [true, false, false], "removed items are marked");
  rows()[1].children[2].emit("click");
  assert.deepEqual(rows().map(row => row.children[1].children[0].textContent), ["−3 Torch", "+23 Cobblestone"]);
  assert.deepEqual(plain(h.run("layout.settings.pickups.ignored")), ["minecraft:diamond"]);
});

test("shulker boxes open a window over the dashboard that can be pinned and saved", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  const slots = [shulker(), ...inventory().slots.slice(1)];
  h.sockets[0].message(initial(snapshot({ inventory: { ...inventory(), slots,
    equipment: { ...inventory().equipment, mainhand: slots[0] } } })));
  const placement = h.get("#tile-inventory").style.getPropertyValue("--grid-row");
  hotbar(h)[0].emit("click", { clientX: 50, clientY: 60 });
  const windows = () => h.get("#windows").children;
  assert.equal(windows().length, 1);
  const [head, , grid] = windows()[0].children;
  assert.equal(head.children[0].textContent, "Shulker Box");
  assert.equal(grid.children.length, 27);
  assert.equal(slotParts(grid.children[0]).fallback.textContent, "DI");
  assert.equal(h.get("#tile-inventory").style.getPropertyValue("--grid-row"), placement, "tiles do not move");
  h.events.pointerdown({ target: {} });
  assert.equal(windows().length, 0, "clicking elsewhere closes an unpinned window");
  hotbar(h)[0].emit("click", { clientX: 50, clientY: 60 });
  windows()[0].children[0].children[1].emit("click");
  h.events.pointerdown({ target: {} });
  assert.equal(windows().length, 1, "a pinned window stays");
  await h.runTimers(400);
  assert.deepEqual(JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body).pinned,
    [{ source: "inventory", slot: 0, x: 62, y: 72 }]);
  h.sockets[0].message(update({ inventory: { slots: [{ index: 0, item: empty() }], equipment: { mainhand: empty() } } }));
  assert.match(windows()[0].children[1].textContent, /Not in your inventory/);
  assert.equal(windows()[0].children[2].children.length, 27, "the last contents stay visible");
});

test("villager trades are searchable, navigable with height arrows and can be forgotten", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  const farmer = villager({ uuid: "223e4567-e89b-12d3-a456-426614174000", profession: "minecraft:farmer",
    professionName: "Farmer", x: 500, z: 500, trades: [{ costA: item({ name: "Wheat", count: 20 }), costB: null,
      result: item({ name: "Emerald", count: 1 }), uses: 12, maxUses: 12 }] });
  h.sockets[0].message(initial(snapshot({ villagers: [farmer, villager()] })));
  const list = h.get("#villager-list");
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].textContent, /Librarian · Journeyman.*26 m S/, "nearest first");
  assert.match(list.children[0].textContent, /Mending I/);
  assert.match(list.children[1].textContent, /Out of stock/);
  h.get("#villager-search").value = "mending";
  h.get("#villager-search").emit("input");
  assert.equal(list.children.length, 1);
  list.children[0].children[0].children[2].emit("click");
  const nav = h.get("#villager-nav");
  assert.equal(nav.hidden, false);
  assert.match(nav.textContent, /▲ 16 blocks up/, "more than 5 blocks above shows an up arrow");
  list.children[0].children[0].children[3].emit("click");
  await h.flush();
  assert.equal(requests.at(-1).url, "/api/villagers/123e4567-e89b-12d3-a456-426614174000");
  assert.equal(requests.at(-1).method, "DELETE");
  assert.equal(nav.hidden, true);
});

test("a new advancement pops up for the configured time, but old ones do not", async () => {
  const h = harness();
  await h.flush();
  h.sockets[0].message(initial(snapshot({ history: history({ events: [
    { id: 1, timestamp: 100, category: "advancement", label: "Advancement made: Old", details: "" }] }) })));
  assert.equal(h.get("#advancement-popup").hidden, true);
  h.sockets[0].message(update({ history: { sessionId: 1, active: true, firstId: 1, upsert: [
    { id: 2, timestamp: 200, category: "advancement", label: "Goal reached: Hot Stuff", details: "Fill a bucket with lava" }] } }));
  assert.equal(h.get("#advancement-popup").hidden, false);
  assert.match(h.get("#advancement-popup").textContent, /Hot Stuff/);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 10_000), true);
});

test("advancements list shows tab progress, closest first, and hides secrets as ???", async () => {
  const h = harness();
  await h.flush();
  const entry = (id, overrides) => ({ id: `minecraft:adventure/${id}`, tab: "minecraft:adventure/root", title: id,
    description: `Do ${id}`, frame: "task", icon: "e0-aa", foil: false, hidden: false, done: false, doneAt: null,
    criteriaDone: 0, criteriaTotal: 1, remaining: [], ...overrides });
  h.sockets[0].message(initial(snapshot({ advancements: { tabs: [{ id: "minecraft:adventure/root", title: "Adventure",
    icon: "e0-aa", foil: false, done: 1, total: 4 }], entries: [
    entry("done", { done: true, criteriaDone: 1 }), entry("adventuring_time", { criteriaDone: 40, criteriaTotal: 53,
      remaining: ["Badlands", "Cherry grove"] }), entry("monster_hunter", { criteriaDone: 10, criteriaTotal: 35 }),
    entry("secret", { hidden: true })] } })));
  assert.equal(h.get("#advancements-status").textContent, "1 / 4");
  assert.match(h.get("#advancement-tabs").textContent, /Adventure1\/4/);
  const rows = h.get("#advancement-list").children;
  assert.deepEqual(rows.map(row => row.children[0].children[1].textContent), ["adventuring_time", "monster_hunter", "???"]);
  assert.equal(rows[0].children[2].textContent, "BadlandsCherry grove");
  assert.equal(rows[2].children[1].textContent, "Hidden advancement: keep playing to reveal it.");
});

test("advancements show an All total above the tabs, and pinned ones go to the top of the list", async () => {
  const h = harness();
  await h.flush();
  const entry = (tab, id, overrides) => ({ id: `minecraft:${tab}/${id}`, tab: `minecraft:${tab}/root`, title: id,
    description: "", frame: "task", icon: "e0-aa", foil: false, hidden: false, done: false, doneAt: null,
    criteriaDone: 0, criteriaTotal: 1, remaining: [], ...overrides });
  h.sockets[0].message(initial(snapshot({ advancements: { tabs: [
    { id: "minecraft:adventure/root", title: "Adventure", icon: "e0-aa", foil: false, done: 1, total: 2 },
    { id: "minecraft:nether/root", title: "Nether", icon: "e0-aa", foil: false, done: 0, total: 2 }], entries: [
    entry("adventure", "done", { done: true, criteriaDone: 1 }), entry("adventure", "close", { criteriaDone: 3, criteriaTotal: 4 }),
    entry("nether", "far", { criteriaDone: 1, criteriaTotal: 10 }), entry("nether", "start")] } })));
  const tabs = h.get("#advancement-tabs").children;
  assert.equal(tabs.length, 3);
  assert.match(tabs[0].textContent, /^All1\/4$/);
  const titles = () => h.get("#advancement-list").children.map(row => row.children[0].children[1].textContent);
  assert.deepEqual(titles(), ["close", "far", "start"]);
  h.get("#advancement-list").children[2].children[0].children[3].emit("click");
  await h.flush();
  assert.deepEqual(titles(), ["start", "close", "far"]);
  assert.equal(h.get("#advancement-list").children[0].dataset.pinned, "true");
});

test("a rules-only tile keeps its space and appears when a converted v1 rule matches", async () => {
  const requests = [];
  const tiles = plain(harness().run("defaultLayout().tiles"))
    .map(tile => tile.id === "movement" ? { ...tile, rulesOnly: true } : tile);
  const stored = { version: 1, tiles, rules: [{ id: "rule-1", name: "Nether", enabled: true,
    groups: [[{ type: "dimension", values: ["minecraft:the_nether"] }]], tiles: { movement: "show" } }] };
  const h = harness(defaultFetch(stored, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  const movement = h.get("#tile-movement");
  const position = movement.style.getPropertyValue("--grid-row");
  assert.equal(movement.hidden, true, "rules-only tiles are hidden until a rule shows them");
  h.get("#edit-toggle").emit("click");
  assert.equal(movement.hidden, false, "still shown while customizing");
  assert.equal(h.get("#head-movement").children.at(-1).textContent, "Rules only");
  h.get("#edit-done").emit("click");
  h.sockets[0].message(update({ dimension: "minecraft:the_nether" }));
  assert.equal(movement.hidden, false, "the rule shows the tile in the Nether");
  assert.equal(movement.style.getPropertyValue("--grid-row"), position, "and it keeps its place");
  assert.equal(h.get("#tile-statistics").style.getPropertyValue("--grid-row"), "5 / span 9", "nothing else moves");
  h.get("#rules-open").emit("click");
  assert.equal(byKey(h.get("#rules-sidebar"), "nav.rule-1").textContent, "Nether");
  assert.equal(findAll(h.get("#rules-sidebar"), element => element.className === "rule-dot active").length, 1);
  assert.equal(byKey(h.get("#rules-detail"), "when.0.values").value, "minecraft:the_nether");
  assert.equal(byKey(h.get("#rules-detail"), "then.0.panel").value, "movement");
  await h.runTimers(400);
  const saved = JSON.parse(requests.filter(request => request.method === "PUT").at(-1).body);
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.rules[0].then, [{ do: "show", panel: "movement" }]);
  assert.equal(saved.tiles.find(tile => tile.id === "movement").rulesOnly, true);
});

test("a stored layout that can't be converted is kept and not overwritten until a layout is imported", async () => {
  const requests = [];
  const stored = { version: 1, tiles: [], rules: Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`,
    name: "R", enabled: true, groups: [0, 1, 2].map(() => Array(4).fill({ type: "elytra" })) })) };
  const h = harness(defaultFetch(stored, requests));
  await h.flush();
  assert.match(h.get("#layout-status").textContent,
    /^The saved layout couldn't be loaded \(Converting the rules needs 160 rules, more than the limit of 128\)/);
  h.get("#layout-reset").emit("click");
  h.get("#edit-toggle").emit("click");
  h.get("#edit-done").emit("click");
  await h.runTimers(400);
  const saves = () => requests.filter(request => request.method === "PUT").length;
  assert.equal(saves(), 0);
  assert.equal(h.get("#layout-status").className, "save-status error", "the warning stays");
  h.get("#layout-file").files = [{ text: async () => JSON.stringify({ version: 2, tiles: [] }) }];
  h.get("#layout-file").emit("change");
  await h.flush();
  await h.runTimers(400);
  assert.equal(saves(), 1, "importing a layout replaces it");
});

const buttonNamed = (element, text) => findAll(element, child => child.tagName === "button"
  && child.textContent === text)[0];

test("rules editor: a new rule's When and Then are edited and saved", async () => {
  const requests = [];
  const h = harness(defaultFetch(null, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  h.get("#rules-open").emit("click");
  const sidebar = h.get("#rules-sidebar");
  const detail = h.get("#rules-detail");
  buttonNamed(sidebar, "+ New rule").emit("click");
  setValue(byKey(detail, "rule.name"), "Low health");
  buttonNamed(detail, "+ AND condition").emit("click");
  setValue(byKey(detail, "when.0.type"), "health");
  setValue(byKey(detail, "when.0.compare"), "<");
  setValue(byKey(detail, "when.0.value"), "6");
  buttonNamed(detail, "+ OR condition").emit("click");
  setValue(byKey(detail, "when.1.values"), "nether, the_end");
  buttonNamed(detail, "+ Action").emit("click");
  setValue(byKey(detail, "then.0.panel"), "player");
  setValue(byKey(detail, "then.0.do"), "focus");
  await h.runTimers(400);
  const rule = savedLayout(requests).rules[0];
  assert.equal(rule.name, "Low health");
  assert.deepEqual(rule.when, [{ type: "health", compare: "<", value: 6 },
    { type: "dimension", join: "or", values: ["nether", "the_end"] }]);
  assert.deepEqual(rule.then, [{ do: "focus", panel: "player" }]);
  assert.equal(byKey(sidebar, `nav.${rule.id}`).textContent, "Low health");
  assert.equal(findAll(detail, element => element.className === "rule-block").length, 2, "OR starts a new block");
});

test("rules editor: an invalid value is reported and not saved until it is fixed", async () => {
  const requests = [];
  const stored = { version: 2, tiles: [], rules: [{ id: "r", name: "R", enabled: true,
    when: [{ type: "dimension", values: ["minecraft:overworld"] }, { type: "yLevel", compare: ">", value: 100 }] }] };
  const h = harness(defaultFetch(stored, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  h.get("#rules-open").emit("click");
  const detail = h.get("#rules-detail");
  const rows = findAll(detail, element => element.className === "rule-block").flatMap(block => block.children);
  assert.deepEqual(rows.map(row => row.className), ["rule-row ok", "rule-row bad"], "live state on each condition");
  const redraws = detail.replacements;
  const saves = () => requests.filter(request => request.method === "PUT").length;
  const before = saves();
  setValue(byKey(detail, "when.1.value"), "");
  await h.runTimers(400);
  assert.equal(saves(), before);
  assert.equal(h.get("#rules-error").hidden, false);
  assert.match(h.get("#rules-error").textContent, /^Not saved yet: Rule "R": condition 2: /);
  setValue(byKey(detail, "when.1.value"), "50");
  await h.runTimers(400);
  assert.equal(h.get("#rules-error").hidden, true);
  assert.equal(savedLayout(requests).rules[0].when[1].value, 50);
  assert.equal(detail.replacements, redraws, "typing a value never redraws (and so never steals focus)");
});

test("rules editor: places and toggles are managed, and removing one drops the conditions that use it", async () => {
  const requests = [];
  const stored = { version: 2, tiles: [], toggles: [{ id: "afk", name: "AFK", on: false }],
    rules: [{ id: "r", name: "R", enabled: true, when: [{ type: "toggle", toggle: "afk" }] }] };
  const h = harness(defaultFetch(stored, requests));
  await h.flush();
  h.sockets[0].message(initial(snapshot()));
  h.get("#rules-open").emit("click");
  const sidebar = h.get("#rules-sidebar");
  const detail = h.get("#rules-detail");
  byKey(sidebar, "nav.toggles").emit("click");
  setValue(byKey(detail, "toggle.0.on"), true);
  await h.runTimers(400);
  assert.equal(savedLayout(requests).toggles[0].on, true);
  findAll(detail, element => element.title?.startsWith("Remove"))[0].emit("click");
  byKey(sidebar, "nav.places").emit("click");
  buttonNamed(detail, "+ Current position").emit("click");
  await h.runTimers(400);
  const saved = savedLayout(requests);
  assert.deepEqual(saved.toggles, []);
  assert.deepEqual(saved.rules[0].when, []);
  assert.equal(saved.places.length, 1);
  assert.equal(saved.places[0].dimension, "minecraft:overworld");
});

function buildPlacement(overrides = {}) {
  return { id: "5f0c1a2b-0000-4000-8000-000000000001", name: "Starter House", total: 1200, placed: 300, wrong: 4,
    extra: 7, uncheckedChunks: 2, scanComplete: false, checkedAt: 99, ...overrides };
}

function material(name, left, have) {
  return { itemId: `minecraft:${name.toLowerCase().replace(/ /g, "_")}`, name, icon: null, left, have };
}

test("build progress is validated like the Java model", () => {
  const h = harness();
  const valid = [
    { available: false, reason: "missing", placement: null, materials: [] },
    { available: false, reason: "version", placement: null, materials: [] },
    { available: true, reason: "none", placement: null, materials: [] },
    { available: true, reason: "counting", placement: null, materials: [] },
    { available: true, reason: null, placement: buildPlacement(), materials: [material("Stone", 5, 0)] },
    { available: true, reason: null, placement: buildPlacement({ total: 0, placed: 0, wrong: 0 }), materials: [] }
  ];
  for (const build of valid) {
    assert.deepEqual(plain(h.apply(undefined, initial(snapshot({ build }))).build), build);
  }
  const many = Array.from({ length: 129 }, (_, index) => material(`Item ${index}`, 1, 0));
  for (const build of [null, {},
    { available: false, reason: "none", placement: null, materials: [] },
    { available: true, reason: "missing", placement: null, materials: [] },
    { available: true, reason: null, placement: null, materials: [] },
    { available: false, reason: "error", placement: buildPlacement(), materials: [] },
    { available: true, reason: "none", placement: null, materials: [material("Stone", 1, 0)] },
    { available: true, reason: null, placement: buildPlacement({ placed: 1200 }), materials: [] },
    { available: true, reason: null, placement: buildPlacement({ name: "" }), materials: [] },
    { available: true, reason: null, placement: buildPlacement({ uncheckedChunks: -1 }), materials: [] },
    { available: true, reason: null, placement: buildPlacement(), materials: [material("Stone", 0, 0)] },
    { available: true, reason: null, placement: buildPlacement(), materials: [{ ...material("Stone", 1, 0), itemId: "stone" }] },
    { available: true, reason: null, placement: buildPlacement(), materials: many }]) {
    assert.throws(() => h.apply(undefined, initial(snapshot({ build }))), JSON.stringify(build)?.slice(0, 100));
  }
  assert.throws(() => h.apply(undefined, initial(unavailable({ build: valid[0] }))));
});

test("build progress shows placed / total, a bar, notes and the materials still needed", async () => {
  const h = harness();
  await h.flush();
  const build = { available: true, reason: null, placement: buildPlacement(),
    materials: [material("Oak Planks", 600, 64), material("Glass Pane", 40, 8), material("Stone", 30, 128)] };
  h.sockets[0].message(initial(snapshot({ build })));
  assert.equal(h.get("#build-status").textContent, "Scanning");
  assert.equal(h.get("#build-name").textContent, "Starter House");
  assert.equal(h.get("#build-count").textContent, "300 / 1,200 blocks · 25%");
  assert.equal(h.get("#build-fill").style.width, "25%");
  assert.equal(h.get("#build-notes").textContent, "4 wrong · 2 chunks not checked yet (out of range) · 7 to clear");
  assert.equal(h.get("#build-materials").hidden, false);
  const rows = () => h.get("#build-material-list").children;
  assert.deepEqual(rows().map(row => row.children.slice(1).map(cell => cell.textContent)),
    [["Oak Planks", "600", "64", "536"], ["Glass Pane", "40", "8", "32"], ["Stone", "30", "128", "✓"]]);
  assert.deepEqual(rows().map(row => row.classList.contains("covered")), [false, false, true]);
  const first = rows()[0];
  h.sockets[0].message(update({ build: { ...build, placement: buildPlacement({ placed: 1200, wrong: 0, extra: 0,
    uncheckedChunks: 0, scanComplete: true }), materials: [] } }));
  assert.equal(h.get("#build-status").textContent, "Complete");
  assert.equal(h.get("#build-count").textContent, "1,200 / 1,200 blocks · 100%");
  assert.equal(h.get("#build-notes").textContent, "");
  assert.equal(h.get("#build-materials").hidden, true);
  assert.equal(h.get("#build-message").textContent, "Nothing left to place.");
  assert.notEqual(rows()[0], first);
});

test("build progress explains why there is nothing to show", async () => {
  const h = harness();
  await h.flush();
  const message = () => [h.get("#build-status").textContent, h.get("#build-message").textContent];
  h.sockets[0].message(initial(snapshot()));
  assert.deepEqual(message(), ["Unavailable", "Install Litematica to see the progress of a schematic placement."]);
  assert.equal(h.get("#build-progress").hidden, true);
  h.sockets[0].message(update({ build: { available: true, reason: "none", placement: null, materials: [] } }));
  assert.deepEqual(message(), ["Idle", "No placement selected in Litematica."]);
  h.sockets[0].message(update({ revision: 8, baseRevision: 7,
    build: { available: true, reason: "counting", placement: null, materials: [] } }));
  assert.deepEqual(message(), ["Counting", "Counting the schematic's blocks…"]);
  h.sockets[0].message(update({ revision: 9, baseRevision: 8,
    build: { available: false, reason: "error", placement: null, materials: [] } }));
  assert.deepEqual(message(), ["Unavailable", "Build progress stopped after an error; see the game log."]);
  h.sockets[0].message(update({ ...unavailable(), revision: 10, baseRevision: 9 }));
  assert.deepEqual(message(), ["Unavailable", "Join a world to see build progress."]);
});
