"use strict";

// Pure tile-layout model: a 12-column grid of whole cells. Tiles never overlap; after a move or resize the
// other enabled tiles fall upward into the highest free space, keeping their relative order.
//
// The top-level tiles and settings are the "Default" profile. Optional profiles are other named layouts; rules
// (evaluated in rules.js) switch profile, show or hide tiles and override settings based on what happens in game.
// A "rules-only" tile keeps its place in the grid but stays hidden until a rule shows it, so nothing moves.
// The rules format is described in docs/RULES_V2.md; LayoutStore.java validates the same format on the mod side.

const LAYOUT_VERSION = 2;
const LAYOUT_COLUMNS = 12;
const LAYOUT_MAX_Y = 1000;
const LAYOUT_MAX_H = 60;
const TILE_IDS = ["player", "inventory", "statistics", "history", "map", "build",
  "movement", "xp", "pickups", "advancements", "villagers", "performance", "afk"];
const TILE_MINIMUMS = {
  player: { w: 2, h: 2 }, inventory: { w: 3, h: 2 }, statistics: { w: 2, h: 3 },
  history: { w: 3, h: 3 }, map: { w: 2, h: 2 }, build: { w: 2, h: 2 },
  movement: { w: 2, h: 2 }, xp: { w: 2, h: 2 }, pickups: { w: 2, h: 2 }, advancements: { w: 3, h: 3 },
  villagers: { w: 3, h: 3 }, performance: { w: 2, h: 2 }, afk: { w: 3, h: 3 }
};
const MAX_STATISTIC_SETTINGS = 512;
const DEFAULT_MAP_URL = "http://127.0.0.1:8080/";
const XP_WINDOW_CHOICES = [10, 30, 60, 300, 600, 3600];
const PERFORMANCE_WINDOW_CHOICES = [10, 30, 60, 600];
const MAX_XP_GOALS = 8;
const MAX_XP_GOAL_LEVEL = 10000;
const MAX_PROFILES = 16;
const MAX_PINNED = 16;
const PIN_SOURCES = ["inventory", "enderchest", "enderchest-item"];
// How often the game samples the player, in ms; one client tick is 50 ms, so 50 is the fastest. Global, not per
// profile: the game samples at one rate whichever profile is shown.
const UPDATE_INTERVAL_CHOICES = [50, 100, 250, 500, 1000];
const DEFAULT_UPDATE_INTERVAL = 250;
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
    // Seconds of frame-rate history the graph, average and 1% low cover.
    performance: { window: 60 },
    pickups: { lifetime: 30, maxRows: 8, showSource: true, ignored: [] },
    // Tabs (advancement roots) left out, e.g. ones datapacks only use to list themselves;
    // pinned advancements are listed first, in the order they were pinned.
    advancements: { popupSeconds: 10, hiddenTabs: [], pinned: [] }
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
  ["performance", "window", value => PERFORMANCE_WINDOW_CHOICES.includes(value)],
  ["pickups", "lifetime", value => wholeIn(value, 0, 3600)],
  ["pickups", "maxRows", value => wholeIn(value, 1, 32)],
  ["pickups", "showSource", value => typeof value === "boolean"],
  ["pickups", "ignored", validItemIds],
  ["advancements", "popupSeconds", value => wholeIn(value, 0, 300)],
  ["advancements", "hiddenTabs", validItemIds],
  ["advancements", "pinned", validItemIds]
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
  return { version: LAYOUT_VERSION, settings: defaultSettings(), tiles: [
    { id: "player", enabled: true, x: 0, y: 0, w: 4, h: 4 },
    { id: "inventory", enabled: true, x: 4, y: 0, w: 8, h: 8 },
    { id: "statistics", enabled: true, x: 0, y: 4, w: 4, h: 9 },
    { id: "history", enabled: true, x: 4, y: 8, w: 8, h: 9 },
    { id: "movement", enabled: true, x: 0, y: 13, w: 4, h: 4 },
    { id: "xp", enabled: true, x: 0, y: 17, w: 4, h: 4 },
    { id: "performance", enabled: true, x: 0, y: 21, w: 4, h: 4 },
    { id: "pickups", enabled: true, x: 4, y: 17, w: 4, h: 6 },
    { id: "advancements", enabled: true, x: 8, y: 17, w: 4, h: 8 },
    { id: "villagers", enabled: true, x: 0, y: 25, w: 8, h: 8 },
    { id: "map", enabled: false, x: 0, y: 33, w: 6, h: 6 },
    { id: "build", enabled: false, x: 6, y: 33, w: 6, h: 4 },
    { id: "afk", enabled: false, x: 6, y: 37, w: 6, h: 6 }
  ], profiles: [], pinned: [], updates: { intervalMillis: DEFAULT_UPDATE_INTERVAL },
  animation: { ...DEFAULT_ANIMATION }, folders: [], places: [], toggles: [], rules: [] };
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

// ------------------------------------------------------------------------------------------- Layout version 1

// Version 1 rules: every group needs one matching condition (AND of OR-groups). Still validated strictly so a stored
// or imported v1 layout can be migrated (see migrateLayoutV1); nothing writes this format any more.
const V1_CONDITION_TYPES = {
  world: "values", dimension: "values", biome: "values", time: "values", gameMode: "values",
  health: "range", food: "range", saturation: "range", effect: "values", movement: "values",
  elytra: "none", advancement: "seconds", combat: "seconds"
};
const V1_MAX_RULES = 64;
const V1_MAX_GROUPS = 8;
const V1_MAX_GROUP_CONDITIONS = 8;

function normalizeConditionV1(value) {
  if (!isObject(value) || !Object.hasOwn(V1_CONDITION_TYPES, value.type)) throw new Error("Invalid condition");
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

/** A v1 rule matches when every group has at least one matching condition: (1) and (2 or 3). */
function normalizeRuleV1(value, profileIds) {
  if (!isObject(value) || !validId(value.id) || !validName(value.name) || typeof value.enabled !== "boolean"
    || !Array.isArray(value.groups) || value.groups.length > V1_MAX_GROUPS) {
    throw new Error("Invalid rule");
  }
  const groups = value.groups.map(group => {
    if (!Array.isArray(group) || group.length === 0 || group.length > V1_MAX_GROUP_CONDITIONS) {
      throw new Error("Invalid rule group");
    }
    return group.map(normalizeConditionV1);
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

function normalizeProfiles(value) {
  if (value !== undefined && (!Array.isArray(value) || value.length > MAX_PROFILES)) throw new Error("Invalid profiles");
  const ids = new Set(["default"]);
  const profiles = (value ?? []).map(profile => {
    if (!isObject(profile) || !validId(profile.id) || ids.has(profile.id) || !validName(profile.name)) {
      throw new Error("Invalid profile");
    }
    ids.add(profile.id);
    return { id: profile.id, name: profile.name, tiles: normalizeTiles(profile.tiles),
      settings: normalizeSettings(profile.settings) };
  });
  return { profiles, ids };
}

/** Validates a version 1 layout; only used to migrate it. */
function normalizeLayoutV1(value) {
  if (!isObject(value) || value.version !== 1) throw new Error("Invalid layout");
  const tiles = normalizeTiles(value.tiles);
  const { profiles, ids: profileIds } = normalizeProfiles(value.profiles);
  if (value.rules !== undefined && (!Array.isArray(value.rules) || value.rules.length > V1_MAX_RULES)) {
    throw new Error("Invalid rules");
  }
  const ruleIds = new Set();
  const rules = (value.rules ?? []).map(rule => {
    const normalized = normalizeRuleV1(rule, profileIds);
    if (ruleIds.has(normalized.id)) throw new Error("Duplicate rule");
    ruleIds.add(normalized.id);
    return normalized;
  });
  return { version: 1, settings: normalizeSettings(value.settings), tiles, profiles, rules,
    pinned: normalizePinned(value.pinned), updates: normalizeUpdates(value.updates) };
}

/**
 * Validates untrusted layout JSON (stored config or an imported file) and fills in any missing tiles and defaults.
 * A version 1 layout is migrated to version 2 first. Throws an Error naming the problem (and the rule, if any).
 */
function normalizeLayout(value) {
  if (!isObject(value)) throw new Error("Invalid layout");
  if (value.version === 1) return normalizeLayout(migrateLayoutV1(normalizeLayoutV1(value)));
  if (value.version !== LAYOUT_VERSION) throw new Error("Invalid layout");
  const tiles = normalizeTiles(value.tiles);
  const { profiles, ids: profileIds } = normalizeProfiles(value.profiles);
  const folders = normalizeList(value.folders, MAX_FOLDERS, "folders", folder => {
    if (!isObject(folder) || !validId(folder.id) || !validName(folder.name)
      || typeof folder.enabled !== "boolean" || typeof folder.collapsed !== "boolean") {
      throw new Error("Invalid folder");
    }
    return { id: folder.id, name: folder.name, enabled: folder.enabled, collapsed: folder.collapsed };
  });
  const places = normalizeList(value.places, MAX_PLACES, "places", place => {
    if (!isObject(place) || !validId(place.id) || !validName(place.name) || !validName(place.world, 128)
      || !validRegistryId(place.dimension) || !["x", "y", "z"].every(key => coordinate(place[key]))) {
      throw new Error("Invalid place");
    }
    return { id: place.id, name: place.name, world: place.world, dimension: place.dimension,
      x: place.x, y: place.y, z: place.z };
  });
  const toggles = normalizeList(value.toggles, MAX_TOGGLES, "toggles", toggle => {
    if (!isObject(toggle) || !validId(toggle.id) || !validName(toggle.name, 32) || typeof toggle.on !== "boolean") {
      throw new Error("Invalid toggle");
    }
    return { id: toggle.id, name: toggle.name, on: toggle.on };
  });
  if (value.rules !== undefined && (!Array.isArray(value.rules) || value.rules.length > MAX_RULES)) {
    throw new Error(`Too many rules (at most ${MAX_RULES})`);
  }
  const ruleIds = new Set();
  for (const rule of value.rules ?? []) {
    if (isObject(rule) && validId(rule.id)) {
      if (ruleIds.has(rule.id)) throw new Error(`${ruleLabel(rule)}: another rule has the same id`);
      ruleIds.add(rule.id);
    }
  }
  const refs = { profiles: profileIds, folders: idSet(folders), places: idSet(places), toggles: idSet(toggles),
    rules: ruleIds };
  const rules = (value.rules ?? []).map((rule, index) => normalizeRule(rule, refs, index));
  checkRuleCycles(rules);
  return { version: LAYOUT_VERSION, settings: normalizeSettings(value.settings), tiles, profiles,
    pinned: normalizePinned(value.pinned), updates: normalizeUpdates(value.updates),
    animation: value.animation === undefined ? { ...DEFAULT_ANIMATION } : normalizeAnimation(value.animation),
    folders, places, toggles, rules };
}

/** An optional list with unique ids. */
function normalizeList(value, max, what, normalize) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`Too many ${what} (at most ${max})`);
  const result = value.map(normalize);
  if (idSet(result).size !== result.length) throw new Error(`Duplicate ${what}`);
  return result;
}

const idSet = list => new Set(list.map(entry => entry.id));

// ---------------------------------------------------------------------------------------------- Rules (v2)

// A rule's When list is flat: each condition joins the one above with "and" or "or", and AND binds tighter, so
// "A and B or C" means (A and B) or C. Then applies while the rule is active, Else while it is enabled but not.

const MAX_RULES = 128;
const MAX_CONDITIONS = 32;
const MAX_ACTIONS = 16;
const MAX_FOLDERS = 32;
const MAX_PLACES = 64;
const MAX_TOGGLES = 16;
const MAX_CONDITION_VALUES = 32;
const MAX_RULE_SECONDS = 3600;
const MAX_TIMING_MILLIS = 600000;
const MIN_LINGER_MILLIS = 500;
const DEFAULT_TIMING = { delayMs: 0, lingerMs: 2000 };
const MAX_ANIMATION_MILLIS = 5000;
const DEFAULT_ANIMATION = { durationMs: 300, easing: "ease-out" };
const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
const COMPARES = ["<", "<=", "=", ">=", ">", "!=", "between"];
const MAX_COMPARE_VALUE = 1e9;
const MAX_COORDINATE = 30000000;
const MAX_PLACE_RADIUS = 100000;
const MAX_VILLAGER_RADIUS = 256;
const MAX_PORTAL_MINUTES = 120;
const MAX_NOTIFY_TEXT = 128;
/** Entity scans and the look target reach at most this far (and entity scans no further than the render distance). */
const MAX_SENSOR_RADIUS = 64;
/** Fixed choices of the conditions and actions that pick from a list. */
const RULE_CHOICES = {
  time: ["dawn", "day", "dusk", "night"], weather: ["clear", "rain", "thunder"],
  gameMode: ["survival", "creative", "adventure", "spectator"],
  movement: ["ground", "elytra", "swimming", "riding", "flying", "falling"],
  axis: ["total", "horizontal", "vertical"], hand: ["either", "main", "off"], durability: ["held", "armor", "tool"],
  // Minecraft's moon phase order (index 0 = full moon).
  moonPhase: ["full", "waningGibbous", "thirdQuarter", "waningCrescent", "new", "waxingCrescent", "firstQuarter",
    "waxingGibbous"],
  usingItem: ["eating", "drinking", "blocking", "bow", "crossbow", "trident", "spear", "spyglass", "horn", "brush",
    "bundle", "fishing"],
  screen: ["inventory", "chest", "enderChest", "furnace", "crafting", "anvil", "enchanting", "brewing", "trading",
    "smithing", "grindstone", "stonecutter", "loom", "cartography", "beacon", "other"],
  lightSource: ["combined", "block", "sky"], lookTarget: ["block", "entity"]
};
const RULE_FAMILIES = ["world", "position", "player", "inventory", "amounts", "events", "threats", "villagers", "screens",
  "features", "meta"];
/**
 * Condition types: the family the editor lists them under and the shape of their parameters (see
 * conditionParams). "Meta" conditions don't need the player to be in a world; all others are unknown (never true,
 * even with "not") while not in one.
 */
const CONDITION_TYPES = {
  world: { family: "world", kind: "names" },
  dimension: { family: "world", kind: "names" },
  biome: { family: "world", kind: "names" },
  time: { family: "world", kind: "time" },
  weather: { family: "world", kind: "choices" },
  day: { family: "world", kind: "compare" },
  gameMode: { family: "world", kind: "choices" },
  moonPhase: { family: "world", kind: "choices" },
  nearPlace: { family: "position", kind: "place" },
  yLevel: { family: "position", kind: "compare" },
  light: { family: "position", kind: "light" },
  spawnDistance: { family: "position", kind: "compare" },
  lookingAt: { family: "position", kind: "look", subject: "id" },
  health: { family: "player", kind: "compare" },
  food: { family: "player", kind: "compare" },
  saturation: { family: "player", kind: "compare" },
  absorption: { family: "player", kind: "compare" },
  air: { family: "player", kind: "compare" },
  armor: { family: "player", kind: "compare" },
  xpLevel: { family: "player", kind: "compare" },
  effect: { family: "player", kind: "effect" },
  movement: { family: "player", kind: "choices" },
  speed: { family: "player", kind: "speed" },
  still: { family: "player", kind: "none" },
  // Minutes without moving, turning or moving the mouse cursor.
  afk: { family: "player", kind: "compare" },
  onFire: { family: "player", kind: "none" },
  inWater: { family: "player", kind: "none" },
  inLava: { family: "player", kind: "none" },
  inRain: { family: "player", kind: "none" },
  sneaking: { family: "player", kind: "none" },
  sprinting: { family: "player", kind: "none" },
  sleeping: { family: "player", kind: "none" },
  riding: { family: "player", kind: "riding", subject: "entity" },
  usingItem: { family: "player", kind: "choices" },
  holding: { family: "inventory", kind: "holding" },
  hasItem: { family: "inventory", kind: "hasItem" },
  freeSlots: { family: "inventory", kind: "compare" },
  durability: { family: "inventory", kind: "durability" },
  elytra: { family: "inventory", kind: "none" },
  xpGained: { family: "amounts", kind: "amount" },
  pickedUp: { family: "amounts", kind: "amount", subject: "item" },
  statRose: { family: "amounts", kind: "amount", subject: "stat", required: true },
  minedBlock: { family: "amounts", kind: "amount", subject: "block" },
  placedBlock: { family: "amounts", kind: "amount", subject: "block" },
  killedMob: { family: "amounts", kind: "amount", subject: "entity" },
  tookDamage: { family: "amounts", kind: "amount" },
  advancement: { family: "events", kind: "event", subject: "advancement" },
  died: { family: "events", kind: "event" },
  changedDimension: { family: "events", kind: "event" },
  joinedWorld: { family: "events", kind: "event" },
  inCombat: { family: "events", kind: "event" },
  hostilesNearby: { family: "threats", kind: "threat", subject: "entity" },
  mobNearby: { family: "threats", kind: "mob", subject: "entity", required: true },
  playersNearby: { family: "threats", kind: "players" },
  bossBar: { family: "threats", kind: "none" },
  raid: { family: "threats", kind: "none" },
  villagersNearby: { family: "villagers", kind: "villagers" },
  screen: { family: "screens", kind: "choices" },
  portalLinking: { family: "features", kind: "portal" },
  toggle: { family: "meta", kind: "toggle", meta: true },
  ruleActive: { family: "meta", kind: "rule", meta: true },
  width: { family: "meta", kind: "compare", meta: true },
  realTime: { family: "meta", kind: "clock", meta: true },
  sessionTime: { family: "meta", kind: "compare" },
  inGame: { family: "meta", kind: "none", meta: true }
};
const ACTION_TYPES = ["profile", "show", "hide", "place", "swap", "focus", "set", "notify"];

const validRegistryId = value => typeof value === "string" && value.length <= 256
  && /^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(value);
const statisticId = value => validStatisticIds([value]);
const finiteIn = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const coordinate = value => finiteIn(value, -MAX_COORDINATE, MAX_COORDINATE);
const validClock = value => typeof value === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
const ruleLabel = (rule, index) => isObject(rule) && validName(rule.name) ? `Rule "${rule.name}"`
  : `Rule ${index === undefined ? "" : index + 1}`.trim();

function ensure(valid, message) {
  if (!valid) throw new Error(message);
}

/** compare / value / value2: "< ≤ = ≥ > ≠" one value, or "between" two (inclusive). */
function normalizeCompare(value, what = "compare") {
  ensure(isObject(value) && COMPARES.includes(value.compare), `${what}: unknown comparison`);
  ensure(finiteIn(value.value, -MAX_COMPARE_VALUE, MAX_COMPARE_VALUE), `${what}: invalid value`);
  const result = { compare: value.compare, value: value.value };
  if (value.compare === "between") {
    ensure(finiteIn(value.value2, value.value, MAX_COMPARE_VALUE), `${what}: invalid upper value`);
    result.value2 = value.value2;
  }
  return result;
}

function normalizeNames(value, choices) {
  ensure(Array.isArray(value) && value.length <= MAX_CONDITION_VALUES
    && value.every(entry => choices ? choices.includes(entry) : validName(entry, 128)), "invalid values");
  return [...new Set(value)];
}

function optionalChoice(value, choices, what) {
  if (value === undefined) return choices[0];
  ensure(choices.includes(value), `invalid ${what}`);
  return value;
}

/** The parameters of one condition type; unknown keys are dropped. */
function conditionParams(value, spec, refs) {
  switch (spec.kind) {
    case "names":
      return { values: normalizeNames(value.values) };
    case "choices":
      return { values: normalizeNames(value.values, RULE_CHOICES[value.type]) };
    case "time":
      if (value.ticks === undefined) return { values: normalizeNames(value.values, RULE_CHOICES.time) };
      ensure(value.values === undefined && isObject(value.ticks) && wholeIn(value.ticks.from, 0, 23999)
        && wholeIn(value.ticks.to, 0, 23999), "invalid tick range");
      return { ticks: { from: value.ticks.from, to: value.ticks.to } };
    case "compare":
      return normalizeCompare(value);
    case "none":
      return {};
    case "effect": {
      const result = { values: normalizeNames(value.values) };
      if (value.level !== undefined) result.level = normalizeCompare(value.level, "level");
      if (value.remaining !== undefined) result.remaining = normalizeCompare(value.remaining, "remaining time");
      return result;
    }
    case "speed":
      return { axis: optionalChoice(value.axis, RULE_CHOICES.axis, "axis"), ...normalizeCompare(value) };
    case "place":
      return placeParams(value, refs);
    case "holding":
      ensure(validRegistryId(value.item), "invalid item");
      return { item: value.item, hand: optionalChoice(value.hand, RULE_CHOICES.hand, "hand") };
    case "hasItem": {
      ensure(validRegistryId(value.item), "invalid item");
      ensure(value.enderChest === undefined || typeof value.enderChest === "boolean", "invalid ender chest flag");
      const result = { item: value.item, ...normalizeCompare(value) };
      if (value.enderChest) result.enderChest = true;
      return result;
    }
    case "durability":
      return { target: optionalChoice(value.target, RULE_CHOICES.durability, "target"), ...normalizeCompare(value) };
    case "amount": {
      ensure(wholeIn(value.window, 1, MAX_RULE_SECONDS), "invalid window");
      return { ...subject(value, spec), ...normalizeCompare(value), window: value.window };
    }
    case "event":
      return subject(value, spec);
    case "villagers":
      ensure(wholeIn(value.radius, 1, MAX_VILLAGER_RADIUS), "invalid radius");
      return { radius: value.radius, ...normalizeCompare(value) };
    case "portal":
      ensure(wholeIn(value.minutes, 1, MAX_PORTAL_MINUTES), "invalid minutes");
      return { minutes: value.minutes };
    case "toggle":
      ensure(refs.toggles.has(value.toggle), "unknown toggle");
      return { toggle: value.toggle };
    case "rule":
      ensure(refs.rules.has(value.rule), "unknown rule");
      return { rule: value.rule };
    case "light":
      return { source: optionalChoice(value.source, RULE_CHOICES.lightSource, "source"), ...normalizeCompare(value) };
    case "look":
      ensure(wholeIn(value.distance, 1, MAX_SENSOR_RADIUS), "invalid distance");
      return { target: optionalChoice(value.target, RULE_CHOICES.lookTarget, "target"), ...subject(value, spec),
        distance: value.distance };
    case "riding":
      return subject(value, spec);
    case "threat":
    case "players":
      ensure(wholeIn(value.radius, 1, MAX_SENSOR_RADIUS), "invalid radius");
      return { radius: value.radius, ...subject(value, spec), ...normalizeCompare(value) };
    case "mob":
      ensure(wholeIn(value.radius, 1, MAX_SENSOR_RADIUS), "invalid radius");
      return { ...subject(value, spec), radius: value.radius };
    case "clock": {
      ensure(validClock(value.from) && validClock(value.to), "invalid time");
      const result = { from: value.from, to: value.to };
      if (value.days !== undefined) {
        ensure(Array.isArray(value.days) && value.days.length >= 1 && value.days.length <= 7
          && value.days.every(day => wholeIn(day, 0, 6)) && new Set(value.days).size === value.days.length,
        "invalid weekdays");
        result.days = [...value.days].sort((a, b) => a - b);
      }
      return result;
    }
    default:
      throw new Error("unknown condition type");
  }
}

/** The optional (or required) registry id an amount or event is about, e.g. the block for "mined block". */
function subject(value, spec) {
  if (!spec.subject) return {};
  const id = value[spec.subject];
  if (id === undefined && !spec.required) return {};
  ensure(spec.subject === "stat" ? statisticId(id) : validRegistryId(id), `invalid ${spec.subject}`);
  return { [spec.subject]: id };
}

/**
 * Near a saved place or typed X/Y/Z (optionally limited to a world and dimension): within a radius (3D, or
 * horizontal only with "flat"), or inside the box from X/Y/Z to X2/Y2/Z2.
 */
function placeParams(value, refs) {
  const box = value.x2 !== undefined || value.y2 !== undefined || value.z2 !== undefined;
  const result = {};
  if (value.place !== undefined) {
    ensure(!box && value.x === undefined && refs.places.has(value.place), "unknown place");
    result.place = value.place;
  } else {
    ensure(["x", "y", "z"].every(key => coordinate(value[key])), "invalid position");
    Object.assign(result, { x: value.x, y: value.y, z: value.z });
    if (value.world !== undefined) {
      ensure(validName(value.world, 128), "invalid world");
      result.world = value.world;
    }
    if (value.dimension !== undefined) {
      ensure(validRegistryId(value.dimension), "invalid dimension");
      result.dimension = value.dimension;
    }
  }
  if (box) {
    ensure(["x2", "y2", "z2"].every(key => coordinate(value[key])) && value.radius === undefined, "invalid box");
    return { ...result, x2: value.x2, y2: value.y2, z2: value.z2 };
  }
  ensure(finiteIn(value.radius, 0, MAX_PLACE_RADIUS) && value.radius > 0, "invalid radius");
  ensure(value.flat === undefined || typeof value.flat === "boolean", "invalid flat flag");
  result.radius = value.radius;
  if (value.flat) result.flat = true;
  return result;
}

/** One When row: its type, the join to the row above (ignored on the first row), "not" and one timing modifier. */
function normalizeCondition(value, refs, first) {
  ensure(isObject(value) && typeof value.type === "string" && Object.hasOwn(CONDITION_TYPES, value.type),
    "unknown condition type");
  const spec = CONDITION_TYPES[value.type];
  const condition = { type: value.type };
  if (!first) {
    ensure(value.join === undefined || value.join === "and" || value.join === "or", "join must be and or or");
    condition.join = value.join ?? "and";
  }
  ensure(value.not === undefined || typeof value.not === "boolean", "invalid not");
  if (value.not) condition.not = true;
  const event = spec.kind === "event";
  if (value.for !== undefined) {
    ensure(!event, "events take \"within\", not \"for\"");
    ensure(wholeIn(value.for, 1, MAX_RULE_SECONDS), "invalid \"for\" seconds");
    condition.for = value.for;
  }
  if (value.within !== undefined || event) {
    ensure(wholeIn(value.within, 1, MAX_RULE_SECONDS), "invalid \"within\" seconds");
    ensure(condition.for === undefined, "use either \"for\" or \"within\", not both");
    condition.within = value.within;
  }
  return { ...condition, ...conditionParams(value, spec, refs) };
}

function normalizeAction(value, refs) {
  ensure(isObject(value) && ACTION_TYPES.includes(value.do), "unknown action");
  const panel = () => {
    ensure(TILE_IDS.includes(value.panel), "unknown panel");
    return value.panel;
  };
  switch (value.do) {
    case "profile":
      ensure(refs.profiles.has(value.profile), "unknown profile");
      return { do: "profile", profile: value.profile };
    case "show":
    case "focus":
      return { do: value.do, panel: panel() };
    case "hide": {
      const result = { do: "hide", panel: panel() };
      if (value.fill === undefined || value.fill === "auto") return result;
      ensure(value.fill === "empty" || TILE_IDS.includes(value.fill) && value.fill !== value.panel, "invalid fill");
      return { ...result, fill: value.fill };
    }
    case "place": {
      const id = panel();
      const minimum = TILE_MINIMUMS[id];
      ensure(wholeIn(value.w, minimum.w, LAYOUT_COLUMNS) && wholeIn(value.h, minimum.h, LAYOUT_MAX_H)
        && wholeIn(value.x, 0, LAYOUT_COLUMNS - value.w) && wholeIn(value.y, 0, LAYOUT_MAX_Y), "invalid rectangle");
      return { do: "place", panel: id, x: value.x, y: value.y, w: value.w, h: value.h };
    }
    case "swap": {
      const id = panel();
      ensure(TILE_IDS.includes(value.with) && value.with !== id, "invalid panel to swap with");
      return { do: "swap", panel: id, with: value.with };
    }
    case "set": {
      const id = panel();
      const rule = SETTING_RULES.find(([tile, key]) => tile === id && key === value.setting);
      ensure(rule && rule[2](value.value), "invalid setting");
      return { do: "set", panel: id, setting: value.setting,
        value: Array.isArray(value.value) ? [...new Set(value.value)] : value.value };
    }
    case "notify": {
      ensure(validName(value.text, MAX_NOTIFY_TEXT), "invalid notification text");
      ensure(value.cooldown === undefined || wholeIn(value.cooldown, 0, MAX_RULE_SECONDS), "invalid cooldown");
      return { do: "notify", text: value.text, cooldown: value.cooldown ?? 0 };
    }
  }
}

function normalizeTiming(value) {
  if (value === undefined) return { ...DEFAULT_TIMING };
  ensure(isObject(value), "invalid timing");
  const delayMs = value.delayMs === undefined ? DEFAULT_TIMING.delayMs : value.delayMs;
  const lingerMs = value.lingerMs === undefined ? DEFAULT_TIMING.lingerMs : value.lingerMs;
  ensure(wholeIn(delayMs, 0, MAX_TIMING_MILLIS), "invalid delay");
  ensure(wholeIn(lingerMs, MIN_LINGER_MILLIS, MAX_TIMING_MILLIS), `linger must be ${MIN_LINGER_MILLIS} ms or more`);
  return { delayMs, lingerMs };
}

function normalizeAnimation(value) {
  ensure(isObject(value) && wholeIn(value.durationMs, 0, MAX_ANIMATION_MILLIS) && EASINGS.includes(value.easing),
    "invalid animation");
  return { durationMs: value.durationMs, easing: value.easing };
}

function normalizeActions(value, refs, what) {
  if (value === undefined) return [];
  ensure(Array.isArray(value) && value.length <= MAX_ACTIONS, `${what}: at most ${MAX_ACTIONS} actions`);
  return value.map((action, index) => {
    try {
      return normalizeAction(action, refs);
    } catch (error) {
      throw new Error(`${what} action ${index + 1}: ${error.message}`);
    }
  });
}

/** Validates one rule; errors name the rule. */
function normalizeRule(value, refs, index) {
  try {
    ensure(isObject(value), "not an object");
    ensure(validId(value.id), "invalid id");
    ensure(validName(value.name), "invalid name");
    ensure(typeof value.enabled === "boolean", "invalid enabled flag");
    ensure(value.folder === undefined || value.folder === null || refs.folders.has(value.folder), "unknown folder");
    ensure(Array.isArray(value.when) && value.when.length <= MAX_CONDITIONS,
      `at most ${MAX_CONDITIONS} conditions`);
    const when = value.when.map((condition, position) => {
      try {
        return normalizeCondition(condition, refs, position === 0);
      } catch (error) {
        throw new Error(`condition ${position + 1}: ${error.message}`);
      }
    });
    return { id: value.id, name: value.name, enabled: value.enabled, folder: value.folder ?? null, when,
      then: normalizeActions(value.then, refs, "Then"), else: normalizeActions(value.else, refs, "Else"),
      timing: normalizeTiming(value.timing),
      animation: value.animation === undefined || value.animation === null ? null : normalizeAnimation(value.animation) };
  } catch (error) {
    throw new Error(`${ruleLabel(value, index)}: ${error.message}`);
  }
}

/** "Rule active" conditions must not form a cycle (a rule depending on itself, directly or not). */
function checkRuleCycles(rules) {
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  const state = new Map();
  const visit = rule => {
    if (state.get(rule.id) === "done") return;
    if (state.get(rule.id) === "visiting") throw new Error(`${ruleLabel(rule)}: "Rule active" conditions form a loop`);
    state.set(rule.id, "visiting");
    for (const id of ruleDependencies(rule)) visit(byId.get(id));
    state.set(rule.id, "done");
  };
  rules.forEach(visit);
}

/** The ids of the rules a rule's "Rule active" conditions read. */
function ruleDependencies(rule) {
  return rule.when.filter(condition => condition.type === "ruleActive").map(condition => condition.rule);
}

/** Splits a When list into AND blocks (lists of condition indexes); a row joined with "or" starts a new block. */
function ruleBlocks(when) {
  const blocks = [];
  when.forEach((condition, index) => {
    if (index === 0 || condition.join === "or") blocks.push([]);
    blocks.at(-1).push(index);
  });
  return blocks;
}

// ----------------------------------------------------------------------------------------- Folders and order

// A rule's place in the list is its priority. Folders only group what the editor shows: the editor keeps a folder's
// rules next to each other (moving, adding and filing rules keep them so) and draws the folder where they are.

/**
 * The rule list as the editor draws it, in list (priority) order: each run of rules in the same folder is one
 * folder entry, and every rule without a folder is an entry of its own. Folders without rules come last. A folder
 * whose rules aren't next to each other (an imported or hand-edited layout) shows once per run, so the drawing
 * never hides the real order.
 */
function ruleSegments(rules, folders = []) {
  const segments = [];
  for (const rule of rules) {
    const last = segments.at(-1);
    if (rule.folder && last?.folder === rule.folder) last.rules.push(rule);
    else segments.push({ folder: rule.folder ?? null, rules: [rule] });
  }
  const used = new Set(rules.map(rule => rule.folder));
  for (const folder of folders) if (!used.has(folder.id)) segments.push({ folder: folder.id, rules: [] });
  return segments;
}

/**
 * Moves a rule one place up (-1) or down (1). Inside a folder it only swaps with the folder's own rules; a rule
 * without a folder moves past the whole neighbouring entry (a rule, or a folder's run). Returns a new list.
 */
function moveRuleInList(rules, id, by) {
  const index = rules.findIndex(rule => rule.id === id);
  if (index < 0) return rules;
  if (rules[index].folder) {
    const target = index + by;
    if (rules[target]?.folder !== rules[index].folder) return rules;
    const result = [...rules];
    [result[index], result[target]] = [result[target], result[index]];
    return result;
  }
  const segments = ruleSegments(rules);
  return moveSegment(rules, segments.findIndex(segment => segment.rules[0] === rules[index]), by);
}

/** Moves one entry of ruleSegments (a lone rule or a folder's run) past its neighbour. Returns a new list. */
function moveSegment(rules, segmentIndex, by) {
  const segments = ruleSegments(rules);
  const target = segmentIndex + by;
  if (!segments[segmentIndex] || !segments[target]) return rules;
  [segments[segmentIndex], segments[target]] = [segments[target], segments[segmentIndex]];
  return segments.flatMap(segment => segment.rules);
}

/**
 * Files a rule in a folder (or takes it out with null), keeping folders together: it joins the end of the folder's
 * rules, or stays where it is if the folder has none yet; taken out, it goes just after the folder's run. Sets
 * {@code rule.folder} and returns the reordered list (the same rule objects).
 */
function fileRule(rules, rule, folder) {
  const index = rules.indexOf(rule);
  const old = rule.folder;
  rule.folder = folder;
  const rest = rules.filter(other => other !== rule);
  let at = index;
  if (folder) {
    const last = rest.findLastIndex(other => other.folder === folder);
    if (last >= 0) at = last + 1;
  } else if (old) {
    while (at < rest.length && rest[at].folder === old) at++;
  }
  rest.splice(at, 0, rule);
  return rest;
}

/** Where a new rule in {@code folder} goes: after the folder's last rule, else (or without a folder) at the end. */
function newRuleIndex(rules, folder) {
  const last = folder ? rules.findLastIndex(rule => rule.folder === folder) : -1;
  return last >= 0 ? last + 1 : rules.length;
}

// ------------------------------------------------------------------------------------------------ Templates

/**
 * "Add from template" (docs/RULES_V2.md). Show only reveals a panel that is hidden or rules-only in the profile in
 * use, so {@code note} says which panel to set to Rules only.
 */
const RULE_TEMPLATES = [
  { id: "xp-gain", name: "XP while gaining", note: "Set the XP panel to Rules only.",
    when: [{ type: "xpGained", compare: ">=", value: 1, window: 10 }], then: [{ do: "show", panel: "xp" }] },
  { id: "idle-movement", name: "Hide idle movement", note: "Hides Movement after 30 s without moving.",
    when: [{ type: "still", for: 30 }], then: [{ do: "hide", panel: "movement" }] },
  { id: "afk-screen", name: "AFK screen", note: "Shows the AFK panel nearly full screen after 2 min AFK.",
    when: [{ type: "afk", compare: ">=", value: 2 }], then: [{ do: "focus", panel: "afk" }] },
  { id: "villagers-trading", name: "Villagers while trading", note: "Set the Villagers panel to Rules only.",
    when: [{ type: "screen", values: ["trading"] },
      { join: "or", type: "villagersNearby", radius: 16, compare: ">=", value: 3 }],
    then: [{ do: "show", panel: "villagers" }] },
  { id: "portal-guidance", name: "Portal guidance", note: "Set the Player panel to Rules only to see it only then.",
    when: [{ type: "portalLinking", minutes: 10 }],
    then: [{ do: "show", panel: "player" }, { do: "notify", text: "Portal target set", cooldown: 0 }] },
  { id: "elytra-map", name: "Elytra map", note: "Shows the map nearly full screen while gliding.",
    when: [{ type: "movement", values: ["elytra"], for: 3 }], then: [{ do: "focus", panel: "map" }] },
  { id: "tool-breaking", name: "Tool about to break", note: "A message at most once a minute.",
    when: [{ type: "durability", target: "held", compare: "<", value: 10 }],
    then: [{ do: "notify", text: "Your tool is about to break", cooldown: 60 }] },
  { id: "combat", name: "Combat", note: "Set the History panel to Rules only.",
    when: [{ type: "hostilesNearby", radius: 16, compare: ">=", value: 3 }],
    then: [{ do: "show", panel: "history" }, { do: "hide", panel: "pickups" }] },
  { id: "looting", name: "Pickups while looting", note: "Set the Pickups panel to Rules only.",
    when: [{ type: "pickedUp", compare: ">=", value: 1, window: 15 }], then: [{ do: "show", panel: "pickups" }] },
  { id: "phone-layout", name: "Phone layout", note: "Switches to your first profile; pick another under Then.",
    when: [{ type: "width", compare: "<", value: 700 }], then: [{ do: "profile", profile: null }] }
];

/** A new rule from a template, with an id not used yet. "Switch profile" picks the first profile (else Default). */
function ruleFromTemplate(template, layout) {
  const used = new Set(layout.rules.map(rule => rule.id));
  const then = structuredCopy(template.then).map(action => action.do === "profile"
    ? { ...action, profile: layout.profiles[0]?.id ?? "default" } : action);
  return { id: uniqueId(template.id, used), name: template.name, enabled: true, folder: null,
    when: structuredCopy(template.when), then, else: [], timing: { ...DEFAULT_TIMING }, animation: null };
}

// -------------------------------------------------------------------------------------------- Share strings

// A rule or folder as text to paste into another dashboard: "minepanel-rules:1:" and base64url JSON with the rules,
// the rules their "Rule active" conditions read, and the places, toggles and profile names they use. Importing never
// overwrites anything: rules, a folder and new places and toggles are added with fresh ids.

const SHARE_PREFIX = "minepanel-rules:1:";
const SHARE_VERSION = 1;
const MAX_SHARE_LENGTH = 512 * 1024;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(text) {
  const bytes = unescape(encodeURIComponent(text));
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = bytes.charCodeAt(index) << 16 | (bytes.charCodeAt(index + 1) || 0) << 8 | (bytes.charCodeAt(index + 2) || 0);
    const length = Math.min(3, bytes.length - index) + 1;
    for (let part = 0; part < length; part++) result += BASE64URL[chunk >> 18 - part * 6 & 63];
  }
  return result;
}

function fromBase64url(text) {
  ensure(/^[A-Za-z0-9_-]*$/.test(text) && text.length % 4 !== 1, "Not a MinePanel share string");
  let bytes = "";
  for (let index = 0; index < text.length; index += 4) {
    const part = text.slice(index, index + 4);
    const chunk = [...part.padEnd(4, "A")].reduce((value, char) => value << 6 | BASE64URL.indexOf(char), 0);
    bytes += String.fromCharCode(chunk >> 16 & 255, chunk >> 8 & 255, chunk & 255).slice(0, part.length - 1);
  }
  try {
    return decodeURIComponent(escape(bytes));
  } catch {
    throw new Error("Not a MinePanel share string");
  }
}

/** The ids of the rules and everything they read, in list order. */
function shareClosure(layout, ids) {
  const byId = new Map(layout.rules.map(rule => [rule.id, rule]));
  const wanted = new Set();
  const visit = id => {
    if (wanted.has(id) || !byId.has(id)) return;
    wanted.add(id);
    ruleDependencies(byId.get(id)).forEach(visit);
  };
  ids.forEach(visit);
  return layout.rules.filter(rule => wanted.has(rule.id));
}

/** A share string for some rules (by id), or for a folder's rules with the folder itself. */
function shareRules(layout, ids, folderId = null) {
  const folder = folderId ? layout.folders.find(entry => entry.id === folderId) : null;
  const rules = shareClosure(layout, folder ? layout.rules.filter(rule => rule.folder === folder.id).map(rule => rule.id) : ids);
  const conditions = rules.flatMap(rule => rule.when);
  const places = new Set(conditions.map(condition => condition.place).filter(Boolean));
  const toggles = new Set(conditions.filter(condition => condition.type === "toggle").map(condition => condition.toggle));
  const profiles = new Set(rules.flatMap(rule => [...rule.then, ...rule.else])
    .filter(action => action.do === "profile" && action.profile !== "default").map(action => action.profile));
  const data = { version: SHARE_VERSION,
    folder: folder ? { name: folder.name, enabled: folder.enabled } : null,
    rules: rules.map(rule => ({ ...structuredCopy(rule), folder: folder && rule.folder === folder.id ? "shared" : null })),
    places: layout.places.filter(place => places.has(place.id)),
    toggles: layout.toggles.filter(toggle => toggles.has(toggle.id)),
    profiles: layout.profiles.filter(profile => profiles.has(profile.id)).map(profile => ({ id: profile.id, name: profile.name })) };
  return SHARE_PREFIX + base64url(JSON.stringify(data));
}

const slug = (text, fallback) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
  || fallback;

// ---------------------------------------------------------------------------------------------- Rule sets

// A rule set is plain JSON (docs/RULE_SETS.md): { format: "minepanel-rules", version: 1, folders, places, toggles,
// rules }. It is what "Download all rules" saves and what Import reads, from a file or pasted; share strings carry
// the same data. Ids in it only link its own parts together: importing gives everything fresh ids, unless "replace"
// starts from no rules, folders, places or toggles, where the file's own ids are kept.

const RULE_SET_FORMAT = "minepanel-rules";
const RULE_SET_VERSION = 1;
const MAX_IMPORT_WARNINGS = 50;

/** Pasted or loaded text: a share string, or rule set JSON. */
function readRuleSet(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  ensure(trimmed.length > 0, "Paste a share string or a rule set, or choose a file");
  ensure(trimmed.length <= MAX_SHARE_LENGTH, "That is too long for a rule set");
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Not valid JSON: ${error.message}`);
    }
  }
  ensure(trimmed.startsWith(SHARE_PREFIX), "Not a MinePanel share string or rule set");
  try {
    return JSON.parse(fromBase64url(trimmed.slice(SHARE_PREFIX.length)));
  } catch {
    throw new Error("Not a MinePanel share string");
  }
}

/** Adds (or with replace, puts in place of the current ones) the rules of a share string or rule set text. */
function importShare(layout, text, options) {
  return importRuleSet(layout, readRuleSet(text), options);
}

/** A profile in a rule set: its name, every panel ("off", or where it is and its mode) and the settings it changes. */
function exportProfile(profile) {
  const panels = {};
  for (const tile of profile.tiles) {
    const id = tile.id;
    // Off panels keep their spot too: it's where they appear when turned on.
    const mode = !tile.enabled ? { mode: "off" } : tile.rulesOnly ? { mode: "rules" } : {};
    panels[id] = { x: tile.x, y: tile.y, w: tile.w, h: tile.h, ...mode };
  }
  const defaults = defaultSettings();
  const settings = {};
  for (const [panel, key] of SETTING_RULES) {
    const value = profile.settings[panel][key];
    if (JSON.stringify(value) !== JSON.stringify(defaults[panel][key])) settings[panel] = { ...settings[panel], [key]: value };
  }
  return { id: profile.id, name: profile.name, panels, settings };
}

/**
 * The tiles of a profile from a rule set's "panels": panel id → "off" or { x, y, w, h, mode: "on" | "rules" | "off" }.
 * Panels left out are off. Panels then settle as on the dashboard (up to the highest free row, no overlaps, at least
 * their minimum size, within 12 columns); a panel that ends up elsewhere than asked gets a warning.
 */
function panelsToTiles(panels, label, warnings) {
  ensure(isObject(panels), `${label}: "panels" must be an object of panel ids`);
  const defaults = defaultLayout().tiles;
  const raw = [];
  const requested = new Map();
  for (const [id, spec] of Object.entries(panels)) {
    const where = `${label}, panel "${id}"`;
    ensure(TILE_IDS.includes(id), `${label}: unknown panel "${id}"`);
    const fallback = defaults.find(tile => tile.id === id);
    if (spec === "off") {
      raw.push({ ...fallback, enabled: false });
      continue;
    }
    ensure(isObject(spec), `${where}: must be "off" or { x, y, w, h, mode }`);
    const mode = spec.mode ?? "on";
    ensure(["on", "rules", "off"].includes(mode), `${where}: mode must be "on", "rules" or "off"`);
    const keys = ["x", "y", "w", "h"];
    const placed = keys.some(key => spec[key] !== undefined);
    ensure(placed ? keys.every(key => wholeNumber(spec[key])) : mode === "off",
      `${where}: needs x, y, w and h as whole numbers`);
    const extra = ignoredKeys(spec, { x: 0, y: 0, w: 0, h: 0, mode: "" });
    if (extra.length) warnings.push(`${where}: ignored ${extra.map(key => `"${key}"`).join(", ")}`);
    const rect = placed ? { x: spec.x, y: spec.y, w: spec.w, h: spec.h }
      : { x: fallback.x, y: fallback.y, w: fallback.w, h: fallback.h };
    raw.push({ id, enabled: mode !== "off", ...rect, ...(mode === "rules" ? { rulesOnly: true } : {}) });
    if (mode !== "off") requested.set(id, rect);
  }
  const tiles = normalizeTiles(raw);
  for (const tile of tiles) {
    const want = requested.get(tile.id);
    if (want && ["x", "y", "w", "h"].some(key => want[key] !== tile[key])) {
      warnings.push(`${label}, panel "${tile.id}": placed at x ${tile.x}, y ${tile.y}, ${tile.w} × ${tile.h} instead of `
        + `x ${want.x}, y ${want.y}, ${want.w} × ${want.h} (panels move up to the highest free row, can't overlap, `
        + "keep their minimum size and stay within 12 columns)");
    }
  }
  return tiles;
}

/**
 * The profiles of a rule set. An entry with "panels" or "settings" defines a profile: one named "Default" (or with
 * id "default") changes the Default layout, one named like an existing profile changes it, and any other is added.
 * Without "panels" a profile keeps its panels (a new one gets the default arrangement); without "settings" it keeps
 * its settings (a new one gets the defaults). With replace, profiles the rule set doesn't define are removed, if it
 * defines any. Entries with only an id and a name (as in share strings) just say which profile a name means.
 * Returns { tiles, settings (Default's), profiles, ids: rule set profile id → profile id }.
 */
function importProfiles(layout, entries, replace, warnings) {
  const definitions = entries.filter(entry => entry.panels !== undefined || entry.settings !== undefined);
  let tiles = layout.tiles;
  let settings = layout.settings;
  const profiles = replace && definitions.length ? [] : [...layout.profiles];
  const ids = new Map();
  const used = new Set(["default", ...profiles.map(profile => profile.id)]);
  const seen = new Set();
  const known = new Set(SETTING_RULES.map(([panel, key]) => `${panel}.${key}`));
  definitions.forEach((entry, index) => {
    ensure(validName(entry.name), `Profile ${index + 1}: needs a name of 1–64 characters`);
    const label = `Profile "${entry.name}"`;
    const name = entry.name.toLowerCase();
    ensure(!seen.has(name), `${label}: defined twice`);
    seen.add(name);
    const extra = ignoredKeys(entry, { id: 0, name: 0, panels: 0, settings: 0 });
    if (extra.length) warnings.push(`${label}: ignored ${extra.map(key => `"${key}"`).join(", ")}`);
    const isDefault = entry.id === "default" || name === "default";
    const existing = isDefault ? getProfile(layout, "default")
      : profiles.find(profile => profile.name.toLowerCase() === name);
    const nextTiles = entry.panels === undefined ? existing?.tiles ?? defaultLayout().tiles
      : panelsToTiles(entry.panels, label, warnings);
    let nextSettings = existing?.settings ?? defaultSettings();
    if (entry.settings !== undefined) {
      try {
        nextSettings = normalizeSettings(entry.settings);
      } catch (error) {
        throw new Error(`${label}: ${error.message}`);
      }
      const unknown = Object.entries(entry.settings).flatMap(([panel, values]) => isObject(values)
        ? Object.keys(values).filter(key => !known.has(`${panel}.${key}`)).map(key => `${panel}.${key}`) : [panel]);
      if (unknown.length) warnings.push(`${label}: ignored settings ${unknown.map(key => `"${key}"`).join(", ")}`);
    }
    if (isDefault) {
      tiles = nextTiles;
      settings = nextSettings;
      ids.set(entry.id ?? "default", "default");
    } else if (existing) {
      profiles[profiles.indexOf(existing)] = { ...existing, tiles: nextTiles, settings: nextSettings };
      if (entry.id !== undefined) ids.set(entry.id, existing.id);
    } else {
      const id = uniqueId(validId(entry.id) ? entry.id : slug(entry.name, "profile"), used);
      profiles.push({ id, name: entry.name, tiles: nextTiles, settings: nextSettings });
      if (entry.id !== undefined) ids.set(entry.id, id);
    }
  });
  ensure(profiles.length <= MAX_PROFILES, `At most ${MAX_PROFILES} profiles besides Default`);
  return { tiles, settings, profiles, ids, defined: definitions.length };
}

/** Everything a rule set holds: profiles (Default first), folders, places, toggles and rules. Switch profile names
 * the profile instead of its id. */
function exportRuleSet(layout) {
  const profileName = id => id === "default" ? "default" : layout.profiles.find(profile => profile.id === id)?.name ?? id;
  const actions = list => list.map(action => action.do === "profile" ? { ...action, profile: profileName(action.profile) } : action);
  return { format: RULE_SET_FORMAT, version: RULE_SET_VERSION,
    profiles: [getProfile(layout, "default"), ...layout.profiles].map(exportProfile),
    folders: structuredCopy(layout.folders), places: structuredCopy(layout.places), toggles: structuredCopy(layout.toggles),
    rules: layout.rules.map(rule => ({ ...structuredCopy(rule), then: actions(rule.then), else: actions(rule.else) })) };
}

/** Keys of {@code source} that normalizing dropped (misspelled or not used by this type), as "a", "b". */
function ignoredKeys(source, normalized, allowed = []) {
  if (!isObject(source) || !isObject(normalized)) return [];
  return Object.keys(source).filter(key => !Object.hasOwn(normalized, key) && !allowed.includes(key));
}

/** Warnings for every key the validator ignored, so a typo in a hand- or agent-written file doesn't go unnoticed. */
function ignoredKeyWarnings(sources, layout) {
  const warnings = [];
  const byId = new Map(layout.rules.map(rule => [rule.id, rule]));
  for (const source of sources) {
    const rule = byId.get(source.id);
    const label = `Rule "${rule.name}"`;
    const note = (where, keys) => {
      if (keys.length) warnings.push(`${label}${where ? `: ${where}` : ""}: ignored ${keys.map(key => `"${key}"`).join(", ")}`);
    };
    note("", ignoredKeys(source, rule));
    if (Array.isArray(source.when)) {
      source.when.forEach((condition, index) => note(`condition ${index + 1}`,
        ignoredKeys(condition, rule.when[index], index === 0 ? ["join"] : [])));
    }
    for (const [list, title] of [["then", "Then"], ["else", "Else"]]) {
      if (Array.isArray(source[list])) {
        source[list].forEach((action, index) => note(`${title} action ${index + 1}`, ignoredKeys(action, rule[list][index])));
      }
    }
    note("timing", ignoredKeys(source.timing, rule.timing));
    note("animation", ignoredKeys(source.animation, rule.animation));
  }
  return warnings;
}

/**
 * Adds a rule set (or a share string's data) to a layout, or with {@code replace} puts it in place of the current
 * rules, folders, places and toggles. Missing optional fields get their defaults (rules and folders enabled, no
 * folder, empty lists). Places equal in every field to an existing one, and toggles with the same name, are reused.
 * "Switch profile" names a profile (by name or id, or "default"); conditions that refer to a place, toggle or rule
 * the rule set doesn't have, and profiles this dashboard doesn't have, are left out with a warning. The result is
 * validated as a whole. Returns { layout, rules: the new rule ids, folders: the new folder ids, folder: the first of
 * them or null, dropped: how many conditions and actions were left out, warnings }; throws an Error saying what's
 * wrong, naming the rule if one is invalid.
 */
function importRuleSet(layout, data, { replace = false } = {}) {
  ensure(isObject(data), "A rule set is a JSON object");
  ensure(data.format === undefined || data.format === RULE_SET_FORMAT, `"format" must be "${RULE_SET_FORMAT}"`);
  ensure(data.version === RULE_SET_VERSION, typeof data.version === "number" && data.version > RULE_SET_VERSION
    ? "This rule set is from a newer MinePanel" : `"version" must be ${RULE_SET_VERSION}`);
  const list = key => {
    if (data[key] === undefined || data[key] === null) return [];
    ensure(Array.isArray(data[key]) && data[key].every(isObject), `"${key}" must be a list of objects`);
    return data[key];
  };
  const sourceRules = list("rules");
  ensure(sourceRules.length > 0, "The rule set has no rules");
  // Share strings carry one folder, as "folder", and mark its rules with folder "shared"; rule sets list folders.
  ensure(data.folder === undefined || data.folder === null || isObject(data.folder), "\"folder\" must be an object");
  const sourceFolders = isObject(data.folder) ? [{ ...data.folder, id: "shared" }] : list("folders");
  const base = replace ? { ...layout, rules: [], folders: [], places: [], toggles: [] } : layout;
  const warnings = [];
  let dropped = 0;
  const places = [...base.places];
  const placeIds = new Map();
  const usedPlaces = idSet(places);
  for (const place of list("places")) {
    const same = places.find(entry => ["name", "world", "dimension", "x", "y", "z"].every(key => entry[key] === place[key]));
    const id = same?.id ?? uniqueId(validId(place.id) ? place.id : slug(String(place.name ?? ""), "place"), usedPlaces);
    if (!same) places.push({ ...place, id });
    placeIds.set(place.id, id);
  }
  const toggles = [...base.toggles];
  const toggleIds = new Map();
  const usedToggles = idSet(toggles);
  for (const toggle of list("toggles")) {
    const same = toggles.find(entry => entry.name === toggle.name);
    const id = same?.id ?? uniqueId(validId(toggle.id) ? toggle.id : slug(String(toggle.name ?? ""), "toggle"), usedToggles);
    if (!same) toggles.push({ ...toggle, on: toggle.on ?? false, id });
    toggleIds.set(toggle.id, id);
  }
  const folders = [...base.folders];
  const folderIds = new Map();
  const usedFolders = idSet(folders);
  for (const folder of sourceFolders) {
    const id = uniqueId(folder.id !== "shared" && validId(folder.id) ? folder.id : slug(String(folder.name ?? ""), "folder"),
      usedFolders);
    folders.push({ ...folder, id, enabled: folder.enabled ?? true, collapsed: folder.collapsed ?? false });
    folderIds.set(folder.id, id);
  }
  const sourceProfiles = list("profiles");
  const arranged = importProfiles(layout, sourceProfiles, replace, warnings);
  // Share strings list the profiles they use (id and name), so their actions are matched by name.
  const profileNames = new Map(sourceProfiles.map(profile => [profile.id, profile.name]));
  const findProfile = value => {
    if (value === "default" || value === "Default") return "default";
    if (typeof value !== "string") return undefined;
    if (arranged.ids.has(value)) return arranged.ids.get(value);
    const name = profileNames.get(value);
    if (name === undefined && arranged.profiles.some(profile => profile.id === value)) return value;
    const wanted = (name ?? value).toLowerCase();
    return arranged.profiles.find(profile => profile.name.toLowerCase() === wanted)?.id;
  };
  const usedRules = idSet(base.rules);
  const newIds = sourceRules.map(rule => uniqueId(validId(rule.id) ? rule.id : slug(String(rule.name ?? ""), "rule"),
    usedRules));
  const ruleIds = new Map();
  sourceRules.forEach((rule, index) => {
    if (rule.id !== undefined && !ruleIds.has(rule.id)) ruleIds.set(rule.id, newIds[index]);
  });
  const rules = sourceRules.map((rule, index) => {
    const label = validName(rule.name) ? `Rule "${rule.name}"` : `Rule ${index + 1}`;
    ensure(rule.folder === undefined || rule.folder === null || folderIds.has(rule.folder),
      `${label}: folder "${rule.folder}" isn't in the rule set's folders`);
    const actions = (value, title) => !Array.isArray(value) ? value : value.flatMap((action, position) => {
      if (!isObject(action) || action.do !== "profile") return [action];
      const profile = findProfile(action.profile);
      if (profile !== undefined) return [{ ...action, profile }];
      dropped++;
      warnings.push(`${label}: ${title} action ${position + 1} left out: no profile "${action.profile}" on this dashboard`);
      return [];
    });
    const when = !Array.isArray(rule.when) ? rule.when ?? [] : rule.when.flatMap((condition, position) => {
      if (!isObject(condition)) return [condition];
      const [key, ids, what] = condition.place !== undefined ? ["place", placeIds, "place"]
        : condition.type === "toggle" ? ["toggle", toggleIds, "toggle"]
          : condition.type === "ruleActive" ? ["rule", ruleIds, "rule"] : [];
      if (!key) return [condition];
      // A reference the rule set doesn't carry must not land on an unrelated place, toggle or rule here.
      if (!ids.has(condition[key])) {
        dropped++;
        warnings.push(`${label}: condition ${position + 1} left out: ${what} "${condition[key]}" isn't in the rule set`);
        return [];
      }
      return [{ ...condition, [key]: ids.get(condition[key]) }];
    });
    return { ...rule, id: newIds[index], enabled: rule.enabled ?? true,
      folder: rule.folder == null ? null : folderIds.get(rule.folder), when,
      then: actions(rule.then ?? [], "Then"), else: actions(rule.else ?? [], "Else") };
  });
  const next = normalizeLayout({ ...base, tiles: arranged.tiles, settings: arranged.settings, profiles: arranged.profiles,
    places, toggles, folders, rules: [...base.rules, ...rules] });
  warnings.push(...ignoredKeyWarnings(rules, next));
  return { layout: next, rules: rules.map(rule => rule.id), profiles: arranged.defined, folders: [...folderIds.values()],
    folder: folderIds.values().next().value ?? null, dropped,
    warnings: warnings.length > MAX_IMPORT_WARNINGS
      ? [...warnings.slice(0, MAX_IMPORT_WARNINGS), `… and ${warnings.length - MAX_IMPORT_WARNINGS} more`] : warnings };
}

// ------------------------------------------------------------------------------------------------ Migration

/** A fresh id from {@code base} that isn't in {@code used}; adds it to {@code used}. */
function uniqueId(base, used) {
  let id = base.slice(0, 32);
  for (let index = 2; used.has(id); index++) {
    const suffix = `-${index}`;
    id = base.slice(0, 32 - suffix.length) + suffix;
  }
  used.add(id);
  return id;
}

/** The start of an id, without a trailing dash, to build derived ids from. */
const idPrefix = (id, length) => id.slice(0, length).replace(/-+$/, "");

/** v1 min/max as a comparison. Health, food and saturation are never negative, so "< 0" is v1's empty range. */
function v1Compare(condition) {
  const { min, max } = condition;
  if (min !== undefined && max !== undefined) {
    return min <= max ? { compare: "between", value: min, value2: max } : { compare: "<", value: 0 };
  }
  return max !== undefined ? { compare: "<=", value: max } : { compare: ">=", value: min ?? 0 };
}

/** One v1 condition as a v2 condition (without its join). Values that never matched in v1 are dropped. */
function migrateConditionV1(condition) {
  const result = { type: condition.type };
  if (condition.not) result.not = true;
  switch (condition.type) {
    case "time":
    case "gameMode":
    case "movement":
      return { ...result, values: (condition.values ?? []).filter(value => RULE_CHOICES[condition.type].includes(value)) };
    case "health":
    case "food":
    case "saturation":
      return { ...result, ...v1Compare(condition) };
    case "elytra":
      return result;
    case "advancement":
      return { ...result, within: condition.seconds ?? 10 };
    case "combat":
      return { ...result, type: "inCombat", within: condition.seconds ?? 10 };
    default:
      return { ...result, values: [...(condition.values ?? [])] };
  }
}

/** A v1 rule's profile, tile and setting changes as v2 actions, in that order. */
function migrateActionsV1(rule) {
  const actions = [];
  if (rule.profile) actions.push({ do: "profile", profile: rule.profile });
  for (const [panel, action] of Object.entries(rule.tiles ?? {})) actions.push({ do: action, panel });
  for (const [tile, key] of SETTING_RULES) {
    const value = rule.settings?.[tile]?.[key];
    if (value !== undefined) actions.push({ do: "set", panel: tile, setting: key, value });
  }
  return actions;
}

/** Joins conditions into a When list: {@code blocks} is a list of AND-blocks, joined with OR. */
function joinBlocks(blocks) {
  return blocks.flatMap((block, blockIndex) => block.map((condition, index) =>
    blockIndex === 0 && index === 0 ? condition : { ...condition, join: index === 0 ? "or" : "and" }));
}

/** Every way of picking one condition from each group: (A or B) and C → (A and C) or (B and C). */
function expandGroups(groups) {
  return groups.reduce((blocks, group) => blocks.flatMap(block => group.map(condition => [...block, condition])), [[]]);
}

/**
 * Converts a validated v1 layout to v2 without changing what the rules do:
 * - AND of OR-groups becomes OR of AND-blocks. If that needs more than MAX_CONDITIONS rows, each group becomes a
 *   helper rule without actions (500 ms linger, the minimum) and the rule requires "Rule active" for all of them.
 * - min/max become compare; "seconds" becomes "within"; "combat" becomes "In combat".
 * - Profile, tiles and settings become actions; more than MAX_ACTIONS continue in extra rules with the same When.
 * - The fixed 2 s hold becomes lingerMs 2000. Rule order (priority) is kept.
 */
function migrateLayoutV1(layout) {
  const used = new Set(layout.rules.map(rule => rule.id));
  const rules = [];
  for (const rule of layout.rules) {
    const groups = rule.groups.map(group => group.map(migrateConditionV1));
    // Counted before expanding: eight groups of eight would be 16 million blocks.
    const rows = groups.reduce((count, group) => count * group.length, 1) * groups.length;
    let when;
    if (groups.length === 0) {
      when = [];
    } else if (rows <= MAX_CONDITIONS) {
      when = joinBlocks(expandGroups(groups));
    } else {
      when = groups.map((group, index) => {
        const id = uniqueId(`${idPrefix(rule.id, 26)}-p${index + 1}`, used);
        rules.push({ id, name: `${rule.name.slice(0, 52)} (part ${index + 1})`, enabled: true, folder: null,
          when: group.map((condition, position) => position === 0 ? condition : { ...condition, join: "or" }),
          then: [], else: [], timing: { delayMs: 0, lingerMs: MIN_LINGER_MILLIS }, animation: null });
        return index === 0 ? { type: "ruleActive", rule: id } : { type: "ruleActive", rule: id, join: "and" };
      });
    }
    const actions = migrateActionsV1(rule);
    for (let start = 0, part = 1; start === 0 || start < actions.length; start += MAX_ACTIONS, part++) {
      rules.push({ id: part === 1 ? rule.id : uniqueId(`${idPrefix(rule.id, 28)}-${part}`, used),
        name: part === 1 ? rule.name : `${rule.name.slice(0, 56)} (${part})`, enabled: rule.enabled, folder: null,
        when, then: actions.slice(start, start + MAX_ACTIONS), else: [], timing: { ...DEFAULT_TIMING },
        animation: null });
    }
  }
  if (rules.length > MAX_RULES) {
    throw new Error(`Converting the rules needs ${rules.length} rules, more than the limit of ${MAX_RULES}`);
  }
  const { rules: ignored, version, ...rest } = layout;
  return { ...rest, version: LAYOUT_VERSION, animation: { ...DEFAULT_ANIMATION }, folders: [], places: [],
    toggles: [], rules };
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

/** Removes a profile; rules lose their "switch profile" actions that pointed at it. */
function removeProfile(layout, id) {
  const keep = action => !(action.do === "profile" && action.profile === id);
  return { ...layout, profiles: layout.profiles.filter(profile => profile.id !== id),
    rules: layout.rules.map(rule => ({ ...rule, then: rule.then.filter(keep), else: rule.else.filter(keep) })) };
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

// ------------------------------------------------------------------------------------------- Layout solver

/** After a panel's visibility, rectangle, fill or focus changes, rules can't change it again for this long. */
const PANEL_DWELL_MILLIS = 1000;

const rectOf = value => ({ x: value.x, y: value.y, w: value.w, h: value.h });
const area = rect => rect.w * rect.h;
const tileOrder = (a, b) => a.y - b.y || a.x - b.x || TILE_IDS.indexOf(a.id) - TILE_IDS.indexOf(b.id);

/**
 * Where each visible panel goes once the rules are applied (docs/RULES_V2.md, "Resolving the effective layout").
 * {@code tiles} are the base profile's tiles; {@code view} comes from effectiveView ({ visible, rects, fills }).
 * Returns { id: {x, y, w, h} } for the visible panels. The same inputs always give the same layout.
 * 1. Panels start at their base rectangles. Place claims give a panel a rectangle and Swap claims trade two base
 *    rectangles; those panels are pinned. A moved panel's old spot is a gap unless its new one overlaps it.
 * 2. Each gap (a hidden panel's spot, top to bottom) is filled by neighbours growing into it: (a) one neighbour
 *    whose edge matches the gap exactly (above, below, left, right), else (b) several neighbours on one side whose
 *    edges together cover it exactly, else (c) the panels below slide up when the grid settles. A Hide fill
 *    override replaces this: "empty" keeps the gap, a panel takes it (it grows over the gap when that makes a
 *    rectangle, otherwise it moves into the gap and is pinned there).
 * 3. Panels overlapping a pinned panel shrink away from it, keeping the largest part that is at least their minimum
 *    size. If no part is big enough they are pushed down. A pinned panel overlapping a higher pinned one is unpinned.
 * 4. The grid settles: pinned panels (and kept-empty gaps) stay, the rest move up to the highest free row in their
 *    columns, as when laying out a profile.
 */
function solveLayout(tiles, view) {
  const base = new Map(tiles.filter(tile => tile.enabled).map(tile => [tile.id, rectOf(tile)]));
  const rects = new Map([...base].filter(([id]) => view.visible.has(id)).map(([id, rect]) => [id, { ...rect }]));
  const pinned = [];
  const gaps = [...base].filter(([id]) => !rects.has(id)).map(([id, rect]) => ({ id, ...rect }));
  for (const [id, claim] of Object.entries(view.rects ?? {})) {
    const target = claim.swap === undefined ? claim : base.get(claim.swap);
    if (!rects.has(id) || !target) continue;
    const rect = rectOf(resize({ id, ...target }));
    if (claim.swap === undefined && !overlaps(rect, base.get(id))) gaps.push({ id, ...base.get(id), moved: true });
    rects.set(id, rect);
    pinned.push(id);
  }
  const kept = [];
  // Growing only has to avoid unpinned panels and kept gaps: overlaps with pinned panels are resolved in step 3.
  const free = (rect, except) => [...rects].every(([id, other]) => except.includes(id) || pinned.includes(id)
    || !overlaps(rect, other)) && kept.every(other => !overlaps(rect, other));
  const movable = () => [...rects.keys()].filter(id => !pinned.includes(id))
    .sort((a, b) => TILE_IDS.indexOf(a) - TILE_IDS.indexOf(b));
  for (const gap of gaps.sort(tileOrder)) {
    const fill = gap.moved ? undefined : view.fills?.[gap.id];
    if (fill === "empty") {
      kept.push(rectOf(gap));
    } else if (fill && rects.has(fill) && !pinned.includes(fill)) {
      const left = fillGap(rects, pinned, fill, gap, free);
      if (left) growInto(rects, movable(), left, free);
    } else {
      growInto(rects, movable(), gap, free);
    }
  }
  const fixed = [];
  for (const id of pinned) {
    if (!fixed.some(other => overlaps(rects.get(id), rects.get(other)))) fixed.push(id);
  }
  for (const id of fixed) shrinkAway(rects, fixed, id);
  const placed = [...fixed.map(id => rects.get(id)), ...kept];
  const rest = [...rects].filter(([id]) => !fixed.includes(id)).map(([id, rect]) => ({ id, ...rect })).sort(tileOrder);
  for (const tile of rest) {
    let y = 0;
    while (placed.some(other => overlaps({ ...tile, y }, other))) y++;
    rects.set(tile.id, { ...rectOf(tile), y });
    placed.push(rects.get(tile.id));
  }
  return Object.fromEntries([...rects].sort(([a], [b]) => TILE_IDS.indexOf(a) - TILE_IDS.indexOf(b)));
}

/**
 * A Hide fill override: the fill panel grows over the gap if that makes a rectangle, otherwise moves into it and
 * is pinned there. Returns the spot a moved panel left, which neighbours then grow into, or null.
 */
function fillGap(rects, pinned, id, gap, free) {
  const rect = rects.get(id);
  const union = { x: Math.min(rect.x, gap.x), y: Math.min(rect.y, gap.y) };
  union.w = Math.max(rect.x + rect.w, gap.x + gap.w) - union.x;
  union.h = Math.max(rect.y + rect.h, gap.y + gap.h) - union.y;
  if (area(union) === area(rect) + area(gap) && union.h <= LAYOUT_MAX_H && free(union, [id])) {
    rects.set(id, union);
    return null;
  }
  rects.set(id, rectOf(resize({ id, ...rectOf(gap) })));
  pinned.push(id);
  return overlaps(rect, rects.get(id)) ? null : { id, ...rect };
}

/** Auto-grow: one neighbour with exactly the gap's edge, else several on one side that together cover it exactly. */
function growInto(rects, movable, gap, free) {
  const sides = [
    { touches: r => r.y + r.h === gap.y, within: r => r.x >= gap.x && r.x + r.w <= gap.x + gap.w, span: r => r.w,
      size: gap.w, grow: r => ({ ...r, h: r.h + gap.h }) },
    { touches: r => r.y === gap.y + gap.h, within: r => r.x >= gap.x && r.x + r.w <= gap.x + gap.w, span: r => r.w,
      size: gap.w, grow: r => ({ ...r, y: gap.y, h: r.h + gap.h }) },
    { touches: r => r.x + r.w === gap.x, within: r => r.y >= gap.y && r.y + r.h <= gap.y + gap.h, span: r => r.h,
      size: gap.h, grow: r => ({ ...r, w: r.w + gap.w }) },
    { touches: r => r.x === gap.x + gap.w, within: r => r.y >= gap.y && r.y + r.h <= gap.y + gap.h, span: r => r.h,
      size: gap.h, grow: r => ({ ...r, x: gap.x, w: r.w + gap.w }) }
  ];
  const fits = (id, rect) => rect.h <= LAYOUT_MAX_H && free(rect, [id]);
  for (const side of sides) {
    for (const id of movable) {
      const rect = rects.get(id);
      if (side.touches(rect) && side.within(rect) && side.span(rect) === side.size && fits(id, side.grow(rect))) {
        rects.set(id, side.grow(rect));
        return;
      }
    }
  }
  for (const side of sides) {
    const members = movable.filter(id => side.touches(rects.get(id)) && side.within(rects.get(id)));
    if (members.length < 2 || members.reduce((sum, id) => sum + side.span(rects.get(id)), 0) !== side.size) continue;
    if (!members.every(id => fits(id, side.grow(rects.get(id))))) continue;
    for (const id of members) rects.set(id, side.grow(rects.get(id)));
    return;
  }
}

/** Panels overlapping the pinned panel {@code id} keep their largest part beside it that is still big enough. */
function shrinkAway(rects, fixed, id) {
  const pin = rects.get(id);
  for (const [other, rect] of rects) {
    if (fixed.includes(other) || !overlaps(rect, pin)) continue;
    const minimum = TILE_MINIMUMS[other];
    const parts = [
      { ...rect, w: pin.x - rect.x },
      { ...rect, x: pin.x + pin.w, w: rect.x + rect.w - pin.x - pin.w },
      { ...rect, h: pin.y - rect.y },
      { ...rect, y: pin.y + pin.h, h: rect.y + rect.h - pin.y - pin.h }
    ].filter(part => part.w >= minimum.w && part.h >= minimum.h
      && fixed.every(pinnedId => !overlaps(part, rects.get(pinnedId))));
    const best = parts.reduce((winner, part) => !winner || area(part) > area(winner) ? part : winner, null);
    if (best) rects.set(other, best);
  }
}

/**
 * Minimum dwell per panel: after a panel's visibility, rectangle claim or fill changes (or focus moves), another
 * change to it waits until {@code millis} have passed. If the target goes back to what is shown in the meantime,
 * nothing happens. Together with linger, a value hovering at a threshold can't make a panel blink.
 * {@code apply(view, now)} returns the view with visible, rects, fills and focus held as needed.
 */
function createPanelDwell(millis = PANEL_DWELL_MILLIS) {
  let shown = null;
  const changedAt = new Map();
  const panelKey = (value, id) => JSON.stringify([value.visible.has(id), value.rects[id] ?? null,
    value.fills[id] ?? null]);
  return {
    apply(view, now) {
      const target = { visible: view.visible, rects: view.rects ?? {}, fills: view.fills ?? {},
        focus: view.focus ?? null };
      if (!shown) shown = target;
      const ready = key => now - (changedAt.get(key) ?? -Infinity) >= millis;
      const pick = id => {
        if (panelKey(shown, id) === panelKey(target, id)) return target;
        if (!ready(id)) return shown;
        changedAt.set(id, now);
        return target;
      };
      const sources = new Map(TILE_IDS.map(id => [id, pick(id)]));
      const next = { visible: new Set(TILE_IDS.filter(id => sources.get(id).visible.has(id))), rects: {}, fills: {} };
      // Rectangle claims keep their priority order (target's first), which the solver relies on.
      for (const id of [...Object.keys(target.rects), ...Object.keys(shown.rects)]) {
        const rect = sources.get(id).rects[id];
        if (rect && !next.rects[id]) next.rects[id] = rect;
      }
      for (const id of TILE_IDS) if (sources.get(id).fills[id]) next.fills[id] = sources.get(id).fills[id];
      next.focus = shown.focus === target.focus || !ready("focus") ? shown.focus : target.focus;
      if (next.focus !== shown.focus) changedAt.set("focus", now);
      shown = next;
      return { ...view, ...next };
    },
    reset() {
      shown = null;
      changedAt.clear();
    }
  };
}

function withSettings(layout, tileId, changes) {
  return { ...layout, settings: { ...layout.settings, [tileId]: { ...layout.settings[tileId], ...changes } } };
}

const SLOT_MAX = 52;
const SLOT_GAP = 3;
const SLOT_DIVIDER = 6;
const SLOT_COMFORTABLE = 32;

/**
 * Decides how the inventory fits a tile body of the given size. Slots never scroll or get clipped: if every row
 * cannot fit at a comfortable size, slots keep the size the width allows and only whole rows that fit are shown,
 * added in order hotbar, bottom main row, middle, top, then the equipment row (armor, offhand, ender chest and
 * player head). With enough width these sit in columns instead: armor left of the storage rows, and right of
 * them the offhand next to the hotbar, the ender chest above it and the player head at the top.
 */
function inventoryArrangement(width, height, showArmor) {
  const rowsHeight = (count, size) => count * size + (count - 1) * SLOT_GAP;
  const fit = (columns, count) => {
    // Each extra column beyond the nine storage columns is set apart by a divider track.
    const dividers = (columns - 9) * (SLOT_DIVIDER + SLOT_GAP);
    const byWidth = Math.floor((width - (columns - 1) * SLOT_GAP - dividers) / columns);
    const byHeight = Math.floor((height - (count - 1) * SLOT_GAP) / count);
    return { byWidth: Math.min(SLOT_MAX, byWidth), all: Math.min(SLOT_MAX, byWidth, byHeight) };
  };
  const order = ["hotbar", "main3", "main2", "main1"];
  const candidates = [{ wide: false, rows: [...order, "equipment"], columns: 9 },
    { wide: true, rows: order, columns: showArmor ? 11 : 10 }];
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
    // Prefer more inventory rows, then bigger slots, then more equipment (in the columns, one armor piece per
    // visible row; the offhand, ender chest and head beside the hotbar, bottom and top main rows).
    const storage = rows.filter(row => row !== "equipment").length;
    const pieces = (showArmor ? 4 : 0) + 3;
    const equipment = candidate.wide
      ? (showArmor ? rows.length : 0) + rows.filter(row => row !== "main2").length
      : rows.includes("equipment") ? pieces : 0;
    // On a tie the columns win: they match the game's inventory and leave height for other content.
    const score = storage * 100000 + option.slot * 100 + equipment * 2 + (candidate.wide ? 1 : 0);
    if (!best || score > best.score) best = { ...option, score };
  }
  if (!best) return { wide: false, slot: 1, rows: ["hotbar"], height: 1 };
  const { score, ...result } = best;
  return result;
}

function layoutRows(layout) {
  return layout.tiles.filter(tile => tile.enabled).reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
}
