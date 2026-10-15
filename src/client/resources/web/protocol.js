"use strict";

// Validates and merges dashboard messages. Mirrors the Java telemetry limits; any violation rejects the message.

const equipmentKeys = ["head", "chest", "legs", "feet", "offhand", "mainhand"];
const historyCategories = ["lifecycle", "death", "dimension", "kill", "mine", "place",
  "container", "inventory", "drop", "damage", "heal", "advancement"];
const MAX_HISTORY_EVENTS = 500;

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

function validateItem(item) {
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
  const slots = inventory.slots.map(validateItem);
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

function validateStatistics(statistics) {
  if (statistics === null) return null;
  requireValid(object(statistics) && Array.isArray(statistics.entries) && statistics.entries.length <= 32);
  const ids = new Set();
  const entries = statistics.entries.map(entry => {
    requireValid(object(entry) && validIdentifier(entry.id) && !ids.has(entry.id)
      && validText(entry.label) && ["Movement", "Combat", "General"].includes(entry.category)
      && ["count", "cm", "ticks"].includes(entry.unit)
      && (entry.cumulative === null || integer(entry.cumulative) && entry.cumulative <= 2147483647)
      && (entry.session === null || integer(entry.session) && entry.cumulative !== null
        && entry.session <= entry.cumulative));
    ids.add(entry.id);
    return { id: entry.id, label: entry.label, category: entry.category, unit: entry.unit,
      cumulative: entry.cumulative, session: entry.session };
  });
  return { entries };
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

function validatePlayer(state) {
  requireValid(object(state) && state.schemaVersion === 2 && integer(state.revision)
    && integer(state.capturedAt) && typeof state.available === "boolean" && object(state.position)
    && has(state, "inventory") && has(state, "statistics") && has(state, "history"));
  if (state.available) {
    requireValid(state.inventory !== null && integer(state.sessionSeconds) && typeof state.dimension === "string"
      && ["x", "y", "z"].every(key => finite(state.position[key]))
      && ["health", "maxHealth", "absorption"].every(key => finite(state[key]) && state[key] >= 0));
  } else {
    requireValid(["sessionSeconds", "dimension", "health", "maxHealth", "absorption"]
      .every(key => state[key] === null)
      && ["x", "y", "z"].every(key => state.position[key] === null) && state.inventory === null
      && state.statistics === null && state.history?.active === false);
  }
  return { ...state, inventory: validateInventory(state.inventory),
    statistics: validateStatistics(state.statistics), history: validateHistory(state.history) };
}

function applyMessage(previous, message) {
  requireValid(object(message) && message.schemaVersion === 2
    && ["initial", "update"].includes(message.type) && object(message.state)
    && message.state.schemaVersion === 2);
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
    history: has(state, "history") ? applyHistory(previous.history, state.history) : previous.history
  };
  return validatePlayer(next);
}
