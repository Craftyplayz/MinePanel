"use strict";

// Validates and merges dashboard messages. Mirrors the Java telemetry limits; any violation rejects the message.

const equipmentKeys = ["head", "chest", "legs", "feet", "offhand", "mainhand"];
const historyCategories = ["lifecycle", "death", "dimension", "kill", "mine", "place",
  "container", "inventory", "drop", "damage", "heal", "advancement", "biome", "weather", "time"];
const MAX_HISTORY_EVENTS = 500;
const SCHEMA_VERSION = 3;

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === "number" && Number.isFinite(value);
const validUnicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const validText = (value, max = 256) => typeof value === "string" && value.length > 0 && value.length <= max
  && validUnicode(value);
const validIdentifier = value => validText(value) && /^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(value);

function requireValid(condition) {
  if (!condition) throw new Error("Invalid dashboard message");
}

function validateTooltip(tooltip) {
  requireValid(Array.isArray(tooltip) && tooltip.length <= 64);
  return tooltip.map(line => {
    requireValid(Array.isArray(line) && line.length <= 32);
    return line.map(segment => {
      requireValid(object(segment) && validText(segment.text)
        && (segment.color === null || typeof segment.color === "string" && /^#[0-9a-f]{6}$/.test(segment.color))
        && typeof segment.format === "string" && /^b?i?s?u?o?$/.test(segment.format));
      return { text: segment.text, color: segment.color, format: segment.format };
    });
  });
}

/** Shulker boxes and bundles list what they hold (one level deep); other items have null contents. */
function validateItem(item, nested = false) {
  requireValid(object(item) && (item.contents === null
    || !nested && Array.isArray(item.contents) && item.contents.length <= 64));
  const contents = Array.isArray(item.contents) ? item.contents.map(inner => validateItem(inner, true)) : null;
  requireValid(!item.empty || contents === null);
  return { ...validateItemFields(item), contents };
}

function validateItemFields(item) {
  requireValid(object(item) && typeof item.empty === "boolean"
    && (item.itemId === null || typeof item.itemId === "string")
    && (item.name === null || typeof item.name === "string")
    && integer(item.count) && item.count <= 1000000
    && integer(item.maxCount) && item.maxCount <= 1000000
    && ["damage", "maxDamage", "remainingDurability"].every(key =>
      item[key] === null || integer(item[key]))
    && Array.isArray(item.enchantments) && item.enchantments.length <= 64
    && (item.icon === null || typeof item.icon === "string" && /^[a-z0-9-]{1,64}$/.test(item.icon))
    && typeof item.foil === "boolean");
  const enchantments = item.enchantments.map(enchantment => {
    requireValid(object(enchantment) && validIdentifier(enchantment.id)
      && validText(enchantment.name) && integer(enchantment.level)
      && enchantment.level >= 1 && enchantment.level <= 255);
    return { id: enchantment.id, name: enchantment.name, level: enchantment.level };
  });
  const tooltip = validateTooltip(item.tooltip);
  requireValid(item.empty
    ? item.count === 0 && item.maxCount === 0 && item.itemId === null && item.name === null
      && item.damage === null && item.maxDamage === null && item.remainingDurability === null
      && enchantments.length === 0 && item.icon === null && item.foil === false && tooltip.length === 0
    : validIdentifier(item.itemId) && validText(item.name) && item.count > 0 && item.maxCount > 0);
  requireValid(item.maxDamage === null
    ? item.damage === null && item.remainingDurability === null
    : item.maxDamage > 0 && item.damage !== null && item.damage <= item.maxDamage
      && item.remainingDurability === item.maxDamage - item.damage);
  return {
    empty: item.empty, itemId: item.itemId, name: item.name, count: item.count,
    maxCount: item.maxCount, damage: item.damage, maxDamage: item.maxDamage,
    remainingDurability: item.remainingDurability, enchantments,
    icon: item.icon, foil: item.foil, tooltip
  };
}

function validateInventory(inventory) {
  if (inventory === null) return null;
  requireValid(object(inventory) && Array.isArray(inventory.slots)
    && inventory.slots.length === 36 && object(inventory.equipment)
    && Object.keys(inventory.equipment).every(key => equipmentKeys.includes(key))
    && integer(inventory.selectedHotbarSlot) && inventory.selectedHotbarSlot <= 8);
  // Not map(validateItem): map passes the slot index as validateItem's `nested` flag.
  const slots = inventory.slots.map(item => validateItem(item));
  const equipment = Object.fromEntries(equipmentKeys.map(key =>
    [key, validateItem(inventory.equipment[key])]));
  requireValid(JSON.stringify(equipment.mainhand) === JSON.stringify(slots[inventory.selectedHotbarSlot]));
  return { slots, selectedHotbarSlot: inventory.selectedHotbarSlot, equipment };
}

function patchInventory(previous, patch) {
  requireValid(object(previous) && object(patch)
    && (!has(patch, "slots") || Array.isArray(patch.slots)));
  const slots = previous.slots.slice();
  const seen = new Set();
  for (const entry of patch.slots ?? []) {
    requireValid(object(entry) && integer(entry.index) && entry.index < 36 && !seen.has(entry.index));
    seen.add(entry.index);
    slots[entry.index] = validateItem(entry.item);
  }
  const equipment = { ...previous.equipment };
  if (has(patch, "equipment")) {
    requireValid(object(patch.equipment)
      && Object.keys(patch.equipment).every(key => equipmentKeys.includes(key)));
    for (const key of Object.keys(patch.equipment)) equipment[key] = validateItem(patch.equipment[key]);
  }
  return validateInventory({
    slots, equipment,
    selectedHotbarSlot: has(patch, "selectedHotbarSlot")
      ? patch.selectedHotbarSlot : previous.selectedHotbarSlot
  });
}

const MAX_STATISTICS = 4096;
const validStatisticId = value => typeof value === "string" && value.length <= 256
  && /^[a-z0-9_.-]+:[a-z0-9_.-]+\/[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(value);

function validateStatistic(entry) {
  requireValid(object(entry) && validStatisticId(entry.id) && validText(entry.label) && validText(entry.category)
    && integer(entry.value) && entry.value <= 2147483647 && integer(entry.session) && entry.session <= entry.value
    && validText(entry.display) && validText(entry.sessionDisplay)
    && (entry.changedAt === null || integer(entry.changedAt))
    && (entry.sessionRate === null || validText(entry.sessionRate))
    && (entry.recentRate === null || validText(entry.recentRate)));
  return { id: entry.id, label: entry.label, category: entry.category, value: entry.value, session: entry.session,
    display: entry.display, sessionDisplay: entry.sessionDisplay, changedAt: entry.changedAt,
    sessionRate: entry.sessionRate, recentRate: entry.recentRate };
}

function validateStatistics(statistics) {
  if (statistics === null) return null;
  requireValid(object(statistics) && Array.isArray(statistics.entries) && statistics.entries.length <= MAX_STATISTICS);
  const ids = new Set();
  const entries = statistics.entries.map(value => {
    const entry = validateStatistic(value);
    requireValid(!ids.has(entry.id));
    ids.add(entry.id);
    return entry;
  });
  return { entries };
}

/** A statistics update is a full replacement, null, or new/changed entries merged by id. */
function applyStatistics(previous, patch) {
  if (patch === null || object(patch) && has(patch, "entries")) return validateStatistics(patch);
  requireValid(object(previous) && object(patch) && Array.isArray(patch.upsert)
    && patch.upsert.length <= MAX_STATISTICS);
  const entries = new Map(previous.entries.map(entry => [entry.id, entry]));
  for (const value of patch.upsert) {
    const entry = validateStatistic(value);
    entries.set(entry.id, entry);
  }
  return validateStatistics({ entries: [...entries.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) });
}

function validateEffects(effects) {
  if (effects === null) return null;
  requireValid(Array.isArray(effects) && effects.length <= 64);
  return effects.map(effect => {
    requireValid(object(effect) && validIdentifier(effect.id) && validText(effect.name)
      && integer(effect.amplifier) && effect.amplifier <= 255
      && (effect.endsAt === null || integer(effect.endsAt)) && typeof effect.beacon === "boolean");
    return { id: effect.id, name: effect.name, amplifier: effect.amplifier, endsAt: effect.endsAt, beacon: effect.beacon };
  });
}

function validateEvent(event) {
  requireValid(object(event) && integer(event.id) && event.id > 0 && integer(event.timestamp)
    && historyCategories.includes(event.category)
    && validText(event.label) && typeof event.details === "string"
    && (event.details === "" || validText(event.details, 1024)));
  return { id: event.id, timestamp: event.timestamp, category: event.category,
    label: event.label, details: event.details };
}

function validateHistory(history) {
  requireValid(object(history) && integer(history.sessionId) && typeof history.active === "boolean"
    && Array.isArray(history.events) && history.events.length <= MAX_HISTORY_EVENTS);
  let previousId = 0;
  const events = history.events.map(value => {
    const event = validateEvent(value);
    requireValid(event.id > previousId);
    previousId = event.id;
    return event;
  });
  return { sessionId: history.sessionId, active: history.active, events };
}

/** A history update is either a full replacement or new/rewritten events plus the oldest retained id. */
function applyHistory(previous, patch) {
  requireValid(object(patch));
  if (has(patch, "events")) return validateHistory(patch);
  requireValid(object(previous) && patch.sessionId === previous.sessionId
    && typeof patch.active === "boolean" && integer(patch.firstId) && patch.firstId > 0
    && Array.isArray(patch.upsert) && patch.upsert.length <= MAX_HISTORY_EVENTS);
  const events = new Map();
  for (const event of previous.events) if (event.id >= patch.firstId) events.set(event.id, event);
  for (const value of patch.upsert) {
    const event = validateEvent(value);
    requireValid(event.id >= patch.firstId);
    events.set(event.id, event);
  }
  const merged = [...events.values()].sort((a, b) => a.id - b.id);
  requireValid(merged.length > 0 && merged[0].id === patch.firstId);
  return validateHistory({ sessionId: patch.sessionId, active: patch.active, events: merged });
}

// ------------------------------------------------------------------------------- World, motion and other details

const DETAIL_FIELDS = ["world", "motion", "xp", "portal", "pickups", "advancements", "villagers", "enderChest"];
const WEATHER = ["clear", "rain", "thunder"];
const GAME_MODES = ["survival", "creative", "adventure", "spectator"];
const MOTION_MODES = ["ground", "elytra", "swimming", "riding", "flying", "falling"];
const XP_WINDOWS = [10, 30, 60, 300, 600, 3600];
const whole = value => Number.isSafeInteger(value);
const filledItem = value => { const item = validateItem(value); requireValid(!item.empty); return item; };

function validateWorld(world) {
  requireValid(object(world) && ["server", "singleplayer"].includes(world.kind) && validText(world.name)
    && validIdentifier(world.biome) && validText(world.biomeName) && WEATHER.includes(world.weather)
    && integer(world.day) && integer(world.time) && world.time < 24000 && GAME_MODES.includes(world.gameMode));
  return { kind: world.kind, name: world.name, biome: world.biome, biomeName: world.biomeName,
    weather: world.weather, day: world.day, time: world.time, gameMode: world.gameMode };
}

function validateMotion(motion) {
  requireValid(object(motion) && MOTION_MODES.includes(motion.mode)
    && ["speed", "horizontalSpeed"].every(key => finite(motion[key]) && motion[key] >= 0)
    && finite(motion.verticalSpeed) && finite(motion.yaw) && motion.yaw >= 0 && motion.yaw < 360
    && finite(motion.pitch) && motion.pitch >= -90 && motion.pitch <= 90);
  return { mode: motion.mode, speed: motion.speed, horizontalSpeed: motion.horizontalSpeed,
    verticalSpeed: motion.verticalSpeed, yaw: motion.yaw, pitch: motion.pitch, icon: filledItem(motion.icon),
    glider: motion.glider === null ? null : filledItem(motion.glider) };
}

function validateXp(xp) {
  requireValid(object(xp) && integer(xp.level) && finite(xp.progress) && xp.progress >= 0 && xp.progress <= 1
    && integer(xp.points) && object(xp.gained) && XP_WINDOWS.every(window => integer(xp.gained[window])));
  return { level: xp.level, progress: xp.progress, points: xp.points,
    gained: Object.fromEntries(XP_WINDOWS.map(window => [window, xp.gained[window]])) };
}

function validatePoint(point) {
  requireValid(object(point) && whole(point.x) && whole(point.y) && whole(point.z));
  return { x: point.x, y: point.y, z: point.z };
}

function validatePortal(portal) {
  const dimensions = ["minecraft:overworld", "minecraft:the_nether"];
  requireValid(object(portal) && Array.isArray(portal.obsidian) && portal.obsidian.length <= 16);
  let crossing = null;
  if (portal.crossing !== null) {
    const value = portal.crossing;
    requireValid(object(value) && integer(value.id) && value.id > 0 && integer(value.at)
      && dimensions.includes(value.fromDimension) && dimensions.includes(value.toDimension)
      && value.fromDimension !== value.toDimension);
    crossing = { id: value.id, at: value.at, fromDimension: value.fromDimension, from: validatePoint(value.from),
      toDimension: value.toDimension, to: validatePoint(value.to), target: validatePoint(value.target) };
  }
  const obsidian = portal.obsidian.map(block => {
    requireValid(object(block) && integer(block.id) && block.id > 0 && integer(block.at));
    return { id: block.id, at: block.at, ...validatePoint(block) };
  });
  return { crossing, obsidian, lit: portal.lit === null ? null : validatePoint(portal.lit) };
}

function validatePickups(pickups) {
  requireValid(Array.isArray(pickups) && pickups.length <= 32);
  return pickups.map(pickup => {
    requireValid(object(pickup) && integer(pickup.id) && pickup.id > 0 && integer(pickup.at)
      && validText(pickup.source) && Number.isSafeInteger(pickup.count) && pickup.count !== 0);
    return { id: pickup.id, at: pickup.at, source: pickup.source, item: filledItem(pickup.item), count: pickup.count };
  });
}

const validIcon = value => value === null || typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);

function validateAdvancements(advancements) {
  if (advancements === null) return null;
  requireValid(object(advancements) && Array.isArray(advancements.tabs) && advancements.tabs.length <= 2048
    && Array.isArray(advancements.entries) && advancements.entries.length <= 2048);
  const tabs = advancements.tabs.map(tab => {
    requireValid(object(tab) && validIdentifier(tab.id) && validText(tab.title) && validIcon(tab.icon)
      && typeof tab.foil === "boolean" && integer(tab.done) && integer(tab.total) && tab.done <= tab.total);
    return { id: tab.id, title: tab.title, icon: tab.icon, foil: tab.foil, done: tab.done, total: tab.total };
  });
  const entries = advancements.entries.map(entry => {
    requireValid(object(entry) && validIdentifier(entry.id) && validIdentifier(entry.tab) && validText(entry.title)
      && typeof entry.description === "string" && entry.description.length <= 1024
      && ["task", "goal", "challenge"].includes(entry.frame) && validIcon(entry.icon)
      && ["foil", "hidden", "done"].every(key => typeof entry[key] === "boolean")
      && (entry.doneAt === null || integer(entry.doneAt)) && integer(entry.criteriaDone)
      && integer(entry.criteriaTotal) && entry.criteriaDone <= entry.criteriaTotal
      && Array.isArray(entry.remaining) && entry.remaining.length <= 256
      && entry.remaining.every(name => validText(name)));
    return { id: entry.id, tab: entry.tab, title: entry.title, description: entry.description, frame: entry.frame,
      icon: entry.icon, foil: entry.foil, hidden: entry.hidden, done: entry.done, doneAt: entry.doneAt,
      criteriaDone: entry.criteriaDone, criteriaTotal: entry.criteriaTotal, remaining: [...entry.remaining] };
  });
  return { tabs, entries };
}

function validateVillagers(villagers) {
  requireValid(Array.isArray(villagers) && villagers.length <= 512);
  return villagers.map(villager => {
    requireValid(object(villager) && typeof villager.uuid === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(villager.uuid)
      && validIdentifier(villager.profession) && validText(villager.professionName)
      && integer(villager.level) && villager.level >= 1 && villager.level <= 5
      && (villager.name === null || validText(villager.name)) && validIdentifier(villager.dimension)
      && ["x", "y", "z"].every(key => finite(villager[key])) && integer(villager.seenAt) && integer(villager.tradedAt)
      && Array.isArray(villager.trades) && villager.trades.length <= 32);
    const trades = villager.trades.map(trade => {
      requireValid(object(trade) && integer(trade.uses) && integer(trade.maxUses));
      return { costA: filledItem(trade.costA), costB: trade.costB === null ? null : filledItem(trade.costB),
        result: filledItem(trade.result), uses: trade.uses, maxUses: trade.maxUses };
    });
    return { uuid: villager.uuid, profession: villager.profession, professionName: villager.professionName,
      level: villager.level, name: villager.name, dimension: villager.dimension, x: villager.x, y: villager.y,
      z: villager.z, seenAt: villager.seenAt, tradedAt: villager.tradedAt, trades };
  });
}

function validateEnderChest(chest) {
  if (chest === null) return null;
  requireValid(object(chest) && integer(chest.seenAt) && Array.isArray(chest.slots) && chest.slots.length === 27);
  return { seenAt: chest.seenAt, slots: chest.slots.map(slot => validateItem(slot)) };
}

/** Validates the detail fields: required while in a world (advancements and ender chest may be null), else null. */
function validateDetails(state) {
  requireValid(DETAIL_FIELDS.every(key => has(state, key)));
  if (!state.available) {
    requireValid(DETAIL_FIELDS.every(key => state[key] === null));
    return Object.fromEntries(DETAIL_FIELDS.map(key => [key, null]));
  }
  const validators = { world: validateWorld, motion: validateMotion, xp: validateXp, portal: validatePortal,
    pickups: validatePickups, advancements: validateAdvancements, villagers: validateVillagers,
    enderChest: validateEnderChest };
  return Object.fromEntries(DETAIL_FIELDS.map(key => {
    const value = state[key];
    // Deltas carry over unchanged fields from the previous state, which were validated when they arrived.
    if (value !== null && typeof value === "object" && validatedDetails.has(value)) return [key, value];
    const result = validators[key](value);
    if (result !== null) validatedDetails.add(result);
    return [key, result];
  }));
}

const validatedDetails = new WeakSet();

function validatePlayer(state) {
  requireValid(object(state) && state.schemaVersion === SCHEMA_VERSION && integer(state.revision)
    && integer(state.capturedAt) && typeof state.available === "boolean" && object(state.position)
    && has(state, "inventory") && has(state, "statistics") && has(state, "history")
    && has(state, "food") && has(state, "saturation") && has(state, "effects"));
  if (state.available) {
    requireValid(state.inventory !== null && integer(state.sessionSeconds) && typeof state.dimension === "string"
      && ["x", "y", "z"].every(key => finite(state.position[key]))
      && ["health", "maxHealth", "absorption"].every(key => finite(state[key]) && state[key] >= 0)
      && integer(state.food) && state.food <= 20
      && finite(state.saturation) && state.saturation >= 0 && state.saturation <= 20 && state.effects !== null);
  } else {
    requireValid(["sessionSeconds", "dimension", "health", "maxHealth", "absorption", "food", "saturation", "effects"]
      .every(key => state[key] === null)
      && ["x", "y", "z"].every(key => state.position[key] === null) && state.inventory === null
      && state.statistics === null && state.history?.active === false);
  }
  return { ...state, inventory: validateInventory(state.inventory),
    statistics: validateStatistics(state.statistics), history: validateHistory(state.history),
    effects: validateEffects(state.effects), ...validateDetails(state) };
}

function applyMessage(previous, message) {
  requireValid(object(message) && message.schemaVersion === SCHEMA_VERSION
    && ["initial", "update"].includes(message.type) && object(message.state)
    && message.state.schemaVersion === SCHEMA_VERSION);
  const state = message.state;
  if (message.type === "initial") {
    requireValid(!previous);
    return validatePlayer(state);
  }
  requireValid(previous && integer(state.baseRevision) && state.baseRevision === previous.revision
    && integer(state.revision) && state.revision > previous.revision && integer(state.capturedAt));
  // Availability changes carry a complete snapshot, not an inventory patch.
  if (has(state, "available") && state.available !== previous.available) return validatePlayer(state);
  if (has(state, "position")) requireValid(object(state.position));
  const next = {
    ...previous, ...state,
    position: { ...previous.position, ...state.position },
    inventory: has(state, "inventory") ? patchInventory(previous.inventory, state.inventory) : previous.inventory,
    statistics: has(state, "statistics") ? applyStatistics(previous.statistics, state.statistics) : previous.statistics,
    history: has(state, "history") ? applyHistory(previous.history, state.history) : previous.history
  };
  return validatePlayer(next);
}
