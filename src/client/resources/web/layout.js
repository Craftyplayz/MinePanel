"use strict";

// Pure tile-layout model: a 12-column grid of whole cells. Tiles never overlap; after a move or resize the
// other enabled tiles fall upward into the highest free space, keeping their relative order.
//
// The top-level tiles and settings are the "Default" profile. Optional profiles are other named layouts; rules
// (evaluated in rules.js) switch profile, show or hide tiles and override settings based on what happens in game.
// A "rules-only" tile keeps its place in the grid but stays hidden until a rule shows it, so nothing moves.

const LAYOUT_COLUMNS = 12;
const LAYOUT_MAX_Y = 1000;
const LAYOUT_MAX_H = 60;
const TILE_IDS = ["player", "inventory", "statistics", "history", "map", "build",
  "movement", "xp", "pickups", "advancements", "villagers"];
const TILE_MINIMUMS = {
  player: { w: 2, h: 2 }, inventory: { w: 3, h: 2 }, statistics: { w: 2, h: 3 },
  history: { w: 3, h: 3 }, map: { w: 2, h: 2 }, build: { w: 2, h: 2 },
  movement: { w: 2, h: 2 }, xp: { w: 2, h: 2 }, pickups: { w: 2, h: 2 }, advancements: { w: 3, h: 3 },
  villagers: { w: 3, h: 3 }
};
const MAX_STATISTIC_SETTINGS = 512;
const DEFAULT_MAP_URL = "http://127.0.0.1:8080/";
const XP_WINDOW_CHOICES = [10, 30, 60, 300, 600, 3600];
const MAX_XP_GOALS = 8;
const MAX_XP_GOAL_LEVEL = 10000;
const MAX_PROFILES = 16;
const MAX_RULES = 64;
const MAX_RULE_GROUPS = 8;
const MAX_GROUP_CONDITIONS = 8;
const MAX_CONDITION_VALUES = 32;
const MAX_PINNED = 16;
const PIN_SOURCES = ["inventory", "enderchest", "enderchest-item"];
// How often the game samples the player, in ms; one client tick is 50 ms, so 50 is the fastest. Global, not per
// profile: the game samples at one rate whichever profile is shown.
const UPDATE_INTERVAL_CHOICES = [50, 100, 250, 500, 1000];
const DEFAULT_UPDATE_INTERVAL = 250;
/** Condition types and what they take: a list of values, a min/max range, a duration, or nothing. */
const CONDITION_TYPES = {
  world: "values", dimension: "values", biome: "values", time: "values", gameMode: "values",
  health: "range", food: "range", saturation: "range", effect: "values", movement: "values",
  elytra: "none", advancement: "seconds", combat: "seconds"
};
const custom = name => `minecraft:custom/minecraft:${name}`;

function defaultSettings() {
  return {
    inventory: { showArmor: true },
    statistics: {
      shown: ["walk_one_cm", "sprint_one_cm", "jump", "deaths", "mob_kills", "player_kills", "play_time"].map(custom),
      // Timers tick constantly, so they would always be "recent".
      recentExcluded: ["play_time", "total_world_time", "time_since_death", "time_since_rest", "sneak_time"].map(custom),
      // Seconds a change stays under Recent; 0 keeps it until newer changes push it out.
      recentLifetime: 60,
      recentRows: 8
    },
    map: { url: DEFAULT_MAP_URL },
    movement: { showVertical: true, showGlider: true },
    // Custom target levels, each shown with the XP and time still needed.
    xp: { window: 60, goals: [] },
    pickups: { lifetime: 30, maxRows: 8, showSource: true, ignored: [] },
    advancements: { popupSeconds: 10 }
  };
}

const validMapUrl = value => typeof value === "string" && value.length <= 200
  && /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/.test(value);
const validStatisticIds = value => Array.isArray(value) && value.length <= MAX_STATISTIC_SETTINGS
  && value.every(id => typeof id === "string" && id.length <= 256
    && /^[a-z0-9_.-]+:[a-z0-9_.-]+\/[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(id));
const validItemIds = value => Array.isArray(value) && value.length <= 64
  && value.every(id => typeof id === "string" && id.length <= 256 && /^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(id));
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const wholeIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Each known setting: its tile, key and validity check. */
const SETTING_RULES = [
  ["inventory", "showArmor", value => typeof value === "boolean"],
  ["statistics", "shown", validStatisticIds],
  ["statistics", "recentExcluded", validStatisticIds],
  ["statistics", "recentLifetime", value => wholeIn(value, 0, 3600)],
  ["statistics", "recentRows", value => wholeIn(value, 1, 32)],
  ["map", "url", validMapUrl],
  ["movement", "showVertical", value => typeof value === "boolean"],
  ["movement", "showGlider", value => typeof value === "boolean"],
  ["xp", "window", value => XP_WINDOW_CHOICES.includes(value)],
  ["xp", "goals", value => Array.isArray(value) && value.length <= MAX_XP_GOALS
    && value.every(level => wholeIn(level, 1, MAX_XP_GOAL_LEVEL))],
  ["pickups", "lifetime", value => wholeIn(value, 0, 3600)],
  ["pickups", "maxRows", value => wholeIn(value, 1, 32)],
  ["pickups", "showSource", value => typeof value === "boolean"],
  ["pickups", "ignored", validItemIds],
  ["advancements", "popupSeconds", value => wholeIn(value, 0, 300)]
];

/** Copies only known, valid settings out of {@code value}; rejects present-but-malformed ones. */
function partialSettings(value) {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error("Invalid settings");
  const result = {};
  for (const [tile, key, valid] of SETTING_RULES) {
    if (value[tile] !== undefined && !isObject(value[tile])) throw new Error(`Invalid ${tile} settings`);
    const setting = value[tile]?.[key];
    if (setting === undefined) continue;
    if (!valid(setting)) throw new Error(`Invalid ${tile} settings`);
    result[tile] = { ...result[tile], [key]: Array.isArray(setting) ? [...new Set(setting)] : setting };
  }
  return result;
}

/** Fills missing settings with defaults; rejects present-but-malformed ones. */
function normalizeSettings(value) {
  return mergeSettings(defaultSettings(), partialSettings(value));
}

/** Applies partial overrides (from a rule) on top of complete settings. */
function mergeSettings(settings, overrides) {
  const result = { ...settings };
  for (const [tile, values] of Object.entries(overrides ?? {})) result[tile] = { ...result[tile], ...values };
  return result;
}

function defaultLayout() {
  return { version: 1, settings: defaultSettings(), tiles: [
    { id: "player", enabled: true, x: 0, y: 0, w: 4, h: 4 },
    { id: "inventory", enabled: true, x: 4, y: 0, w: 8, h: 8 },
    { id: "statistics", enabled: true, x: 0, y: 4, w: 4, h: 9 },
    { id: "history", enabled: true, x: 4, y: 8, w: 8, h: 9 },
    { id: "movement", enabled: true, x: 0, y: 13, w: 4, h: 4 },
    { id: "xp", enabled: true, x: 0, y: 17, w: 4, h: 4 },
    { id: "pickups", enabled: true, x: 4, y: 17, w: 4, h: 6 },
    { id: "advancements", enabled: true, x: 8, y: 17, w: 4, h: 8 },
    { id: "villagers", enabled: true, x: 0, y: 25, w: 8, h: 8 },
    { id: "map", enabled: false, x: 0, y: 33, w: 6, h: 6 },
    { id: "build", enabled: false, x: 6, y: 33, w: 6, h: 4 }
  ], profiles: [], rules: [], pinned: [], updates: { intervalMillis: DEFAULT_UPDATE_INTERVAL } };
}

const wholeNumber = value => Number.isSafeInteger(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validId = value => typeof value === "string" && /^[a-z0-9-]{1,32}$/.test(value);
const validName = (value, max = 64) => typeof value === "string" && value.length > 0 && value.length <= max;

/** Validates a profile's tile list and fills in any missing tiles (disabled, below the others). */
function normalizeTiles(value) {
  if (!Array.isArray(value) || value.length > TILE_IDS.length) throw new Error("Invalid layout");
  const seen = new Set();
  const tiles = value.map(tile => {
    if (tile === null || typeof tile !== "object" || !TILE_IDS.includes(tile.id) || seen.has(tile.id)
      || typeof tile.enabled !== "boolean" || !["x", "y", "w", "h"].every(key => wholeNumber(tile[key]))
      || tile.rulesOnly !== undefined && typeof tile.rulesOnly !== "boolean") {
      throw new Error("Invalid layout tile");
    }
    seen.add(tile.id);
    const result = { id: tile.id, enabled: tile.enabled, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    if (tile.rulesOnly) result.rulesOnly = true;
    return resize(result);
  });
  const bottom = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  for (const fallback of defaultLayout().tiles) {
    if (!seen.has(fallback.id)) tiles.push({ ...fallback, enabled: false, y: bottom });
  }
  return settle(tiles, null);
}

function normalizeCondition(value) {
  if (!isObject(value) || !Object.hasOwn(CONDITION_TYPES, value.type)) throw new Error("Invalid condition");
  const condition = { type: value.type };
  if (value.not !== undefined && typeof value.not !== "boolean") throw new Error("Invalid condition");
  if (value.not) condition.not = true;
  if (value.values !== undefined) {
    if (!Array.isArray(value.values) || value.values.length > MAX_CONDITION_VALUES
      || !value.values.every(entry => validName(entry, 128))) {
      throw new Error("Invalid condition values");
    }
    condition.values = [...value.values];
  }
  for (const key of ["min", "max"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1024) {
      throw new Error("Invalid condition range");
    }
    condition[key] = value[key];
  }
  if (value.seconds !== undefined) {
    if (!wholeIn(value.seconds, 1, 3600)) throw new Error("Invalid condition duration");
    condition.seconds = value.seconds;
  }
  return condition;
}

/** A rule matches when every group has at least one matching condition: (1) and (2 or 3). */
function normalizeRule(value, profileIds) {
  if (!isObject(value) || !validId(value.id) || !validName(value.name) || typeof value.enabled !== "boolean"
    || !Array.isArray(value.groups) || value.groups.length > MAX_RULE_GROUPS) {
    throw new Error("Invalid rule");
  }
  const groups = value.groups.map(group => {
    if (!Array.isArray(group) || group.length === 0 || group.length > MAX_GROUP_CONDITIONS) {
      throw new Error("Invalid rule group");
    }
    return group.map(normalizeCondition);
  });
  const rule = { id: value.id, name: value.name, enabled: value.enabled, groups };
  if (value.profile !== undefined && value.profile !== null) {
    if (!profileIds.has(value.profile)) throw new Error("Rule names an unknown profile");
    rule.profile = value.profile;
  }
  if (value.tiles !== undefined) {
    if (!isObject(value.tiles) || !Object.entries(value.tiles)
      .every(([id, action]) => TILE_IDS.includes(id) && ["show", "hide"].includes(action))) {
      throw new Error("Invalid rule tiles");
    }
    rule.tiles = { ...value.tiles };
  }
  if (value.settings !== undefined) rule.settings = partialSettings(value.settings);
  return rule;
}

function normalizePinned(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PINNED) throw new Error("Invalid pinned windows");
  return value.map(window => {
    if (!isObject(window) || !PIN_SOURCES.includes(window.source) || !wholeIn(window.slot, 0, 40)
      || !wholeIn(window.x, 0, 10000) || !wholeIn(window.y, 0, 10000)) {
      throw new Error("Invalid pinned window");
    }
    return { source: window.source, slot: window.slot, x: window.x, y: window.y };
  });
}

function normalizeUpdates(value) {
  if (value === undefined) return { intervalMillis: DEFAULT_UPDATE_INTERVAL };
  if (!isObject(value)) throw new Error("Invalid update settings");
  const interval = value.intervalMillis ?? DEFAULT_UPDATE_INTERVAL;
  if (!UPDATE_INTERVAL_CHOICES.includes(interval)) throw new Error("Invalid update interval");
  return { intervalMillis: interval };
}

/** Validates untrusted layout JSON (stored config or an imported file) and fills in any missing tiles. */
function normalizeLayout(value) {
  if (value === null || typeof value !== "object" || value.version !== 1) throw new Error("Invalid layout");
  const tiles = normalizeTiles(value.tiles);
  const profileIds = new Set(["default"]);
  if (value.profiles !== undefined && (!Array.isArray(value.profiles) || value.profiles.length > MAX_PROFILES)) {
    throw new Error("Invalid profiles");
  }
  const profiles = (value.profiles ?? []).map(profile => {
    if (!isObject(profile) || !validId(profile.id) || profileIds.has(profile.id) || !validName(profile.name)) {
      throw new Error("Invalid profile");
    }
    profileIds.add(profile.id);
    return { id: profile.id, name: profile.name, tiles: normalizeTiles(profile.tiles),
      settings: normalizeSettings(profile.settings) };
  });
  if (value.rules !== undefined && (!Array.isArray(value.rules) || value.rules.length > MAX_RULES)) {
    throw new Error("Invalid rules");
  }
  const ruleIds = new Set();
  const rules = (value.rules ?? []).map(rule => {
    const normalized = normalizeRule(rule, profileIds);
    if (ruleIds.has(normalized.id)) throw new Error("Duplicate rule");
    ruleIds.add(normalized.id);
    return normalized;
  });
  return { version: 1, settings: normalizeSettings(value.settings), tiles, profiles, rules,
    pinned: normalizePinned(value.pinned), updates: normalizeUpdates(value.updates) };
}

// ------------------------------------------------------------------------------------------------- Profiles

/** The tiles and settings of a profile; "default" is the top-level layout. */
function getProfile(layout, id) {
  if (id === "default") return { id: "default", name: "Default", tiles: layout.tiles, settings: layout.settings };
  return layout.profiles.find(profile => profile.id === id) ?? getProfile(layout, "default");
}

/** Replaces a profile's tiles and/or settings. */
function withProfile(layout, id, profile) {
  if (id === "default") return { ...layout, tiles: profile.tiles, settings: profile.settings };
  return { ...layout, profiles: layout.profiles.map(entry => entry.id === id
    ? { ...entry, tiles: profile.tiles, settings: profile.settings } : entry) };
}

/** Copies a profile under a new name; returns the layout and the new profile's id. */
function addProfile(layout, name, fromId) {
  const used = new Set(["default", ...layout.profiles.map(profile => profile.id)]);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "profile";
  let id = base;
  for (let index = 2; used.has(id); index++) id = `${base}-${index}`;
  const source = getProfile(layout, fromId);
  const profile = { id, name: name.slice(0, 64) || "Profile", tiles: source.tiles.map(tile => ({ ...tile })),
    settings: structuredCopy(source.settings) };
  return { layout: { ...layout, profiles: [...layout.profiles, profile] }, id };
}

function renameProfile(layout, id, name) {
  return { ...layout, profiles: layout.profiles.map(profile => profile.id === id
    ? { ...profile, name: name.slice(0, 64) || profile.name } : profile) };
}

/** Removes a profile; rules that switched to it no longer switch profile. */
function removeProfile(layout, id) {
  return { ...layout, profiles: layout.profiles.filter(profile => profile.id !== id),
    rules: layout.rules.map(rule => {
      if (rule.profile !== id) return rule;
      const { profile, ...rest } = rule;
      return rest;
    }) };
}

const structuredCopy = value => JSON.parse(JSON.stringify(value));

/** Sets a tile to "off", "on" or "rules" (kept in place, shown only by rules). */
function setTileMode(profile, id, mode) {
  const current = profile.tiles.find(tile => tile.id === id);
  const enabled = mode !== "off";
  // Switching between "on" and "rules" keeps the tile exactly where it is.
  const next = current.enabled === enabled ? profile : setTileEnabled(profile, id, enabled);
  return { ...next, tiles: next.tiles.map(tile => {
    if (tile.id !== id) return tile;
    const { rulesOnly, ...rest } = tile;
    return mode === "rules" ? { ...rest, rulesOnly: true } : rest;
  }) };
}

function tileMode(tile) {
  return !tile.enabled ? "off" : tile.rulesOnly ? "rules" : "on";
}


/** Clamps a tile's size and position into the grid, respecting its minimum size. */
function resize(tile) {
  const minimum = TILE_MINIMUMS[tile.id];
  const w = clamp(tile.w, minimum.w, LAYOUT_COLUMNS);
  const h = clamp(tile.h, minimum.h, LAYOUT_MAX_H);
  return { ...tile, w, h, x: clamp(tile.x, 0, LAYOUT_COLUMNS - w), y: clamp(tile.y, 0, LAYOUT_MAX_Y) };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Places every enabled tile, highest first. A pinned tile keeps its exact position (the one being dragged);
 * the rest move to the highest row where they fit in their columns.
 */
function settle(tiles, pinnedId) {
  const placed = [];
  const pinned = tiles.find(tile => tile.id === pinnedId && tile.enabled);
  if (pinned) placed.push(pinned);
  const order = tiles.filter(tile => tile.enabled && tile !== pinned)
    .sort((a, b) => a.y - b.y || a.x - b.x || TILE_IDS.indexOf(a.id) - TILE_IDS.indexOf(b.id));
  const result = new Map(pinned ? [[pinned.id, pinned]] : []);
  for (const tile of order) {
    let y = 0;
    while (placed.some(other => overlaps({ ...tile, y }, other))) y++;
    const moved = { ...tile, y };
    placed.push(moved);
    result.set(tile.id, moved);
  }
  return tiles.map(tile => result.get(tile.id) ?? tile);
}

/** Moves and/or resizes one tile, then settles the others around it. */
function placeTile(layout, id, rect, keepPinned) {
  const tiles = layout.tiles.map(tile => tile.id === id ? resize({ ...tile, ...rect }) : tile);
  const settled = settle(tiles, id);
  return { ...layout, tiles: keepPinned ? settled : settle(settled, null) };
}

function setTileEnabled(layout, id, enabled) {
  const bottom = layout.tiles.filter(tile => tile.enabled)
    .reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  const tiles = layout.tiles.map(tile => tile.id !== id ? tile
    : { ...tile, enabled, y: enabled ? bottom : tile.y });
  return { ...layout, tiles: settle(tiles, null) };
}

function withSettings(layout, tileId, changes) {
  return { ...layout, settings: { ...layout.settings, [tileId]: { ...layout.settings[tileId], ...changes } } };
}

const SLOT_MAX = 52;
const SLOT_GAP = 3;
const SLOT_COMFORTABLE = 32;

/**
 * Decides how the inventory fits a tile body of the given size. Slots never scroll or get clipped: if every row
 * cannot fit at a comfortable size, slots keep the size the width allows and only whole rows that fit are shown,
 * added in order hotbar, bottom main row, middle, top, then the armor row.
 * With armor shown and enough width, armor sits in a column beside the storage rows (offhand next to the hotbar).
 */
function inventoryArrangement(width, height, showArmor) {
  const rowsHeight = (count, size) => count * size + (count - 1) * SLOT_GAP;
  const fit = (columns, count) => {
    const byWidth = Math.floor((width - (columns - 1) * SLOT_GAP - (columns > 9 ? 2 * SLOT_GAP : 0)) / columns);
    const byHeight = Math.floor((height - (count - 1) * SLOT_GAP) / count);
    return { byWidth: Math.min(SLOT_MAX, byWidth), all: Math.min(SLOT_MAX, byWidth, byHeight) };
  };
  const order = ["hotbar", "main3", "main2", "main1"];
  const candidates = [{ wide: false, rows: showArmor ? [...order, "equipment"] : order, columns: 9 }];
  if (showArmor) candidates.push({ wide: true, rows: order, columns: 11 });
  let best;
  for (const candidate of candidates) {
    const size = fit(candidate.columns, candidate.rows.length);
    if (size.byWidth < 1) continue;
    let slot = size.all;
    let rows = candidate.rows;
    if (slot < Math.min(SLOT_COMFORTABLE, size.byWidth)) {
      slot = Math.max(1, Math.min(size.byWidth, height));
      let count = 0;
      while (count < candidate.rows.length && rowsHeight(count + 1, slot) <= height) count++;
      rows = candidate.rows.slice(0, Math.max(1, count));
      if (rowsHeight(rows.length, slot) > height) slot = Math.max(1, height);
    }
    const option = { wide: candidate.wide, slot, rows, height: rowsHeight(rows.length, slot) };
    // Prefer more inventory rows, then bigger slots, then more armor (in the armor column, one piece per
    // visible row plus the offhand next to the hotbar).
    const storage = rows.filter(row => row !== "equipment").length;
    const armor = candidate.wide ? rows.length + (rows.includes("hotbar") ? 1 : 0) : rows.includes("equipment") ? 5 : 0;
    // On a tie the armor column wins: it matches the game's inventory and leaves height for other content.
    const score = storage * 100000 + option.slot * 100 + armor * 2 + (candidate.wide ? 1 : 0);
    if (!best || score > best.score) best = { ...option, score };
  }
  if (!best) return { wide: false, slot: 1, rows: ["hotbar"], height: 1 };
  const { score, ...result } = best;
  return result;
}

function layoutRows(layout) {
  return layout.tiles.filter(tile => tile.enabled).reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
}
