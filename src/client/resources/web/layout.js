"use strict";

// Pure tile-layout model: a 12-column grid of whole cells. Tiles never overlap; after a move or resize the
// other enabled tiles fall upward into the highest free space, keeping their relative order.

const LAYOUT_COLUMNS = 12;
const LAYOUT_MAX_Y = 1000;
const LAYOUT_MAX_H = 60;
const TILE_IDS = ["player", "inventory", "statistics", "history", "map", "build"];
const TILE_MINIMUMS = {
  player: { w: 2, h: 2 }, inventory: { w: 3, h: 2 }, statistics: { w: 2, h: 3 },
  history: { w: 3, h: 3 }, map: { w: 2, h: 2 }, build: { w: 2, h: 2 }
};
const MAX_STATISTIC_SETTINGS = 512;
const DEFAULT_MAP_URL = "http://127.0.0.1:8080/";
const custom = name => `minecraft:custom/minecraft:${name}`;

function defaultSettings() {
  return {
    inventory: { showArmor: true },
    statistics: {
      shown: ["walk_one_cm", "sprint_one_cm", "jump", "deaths", "mob_kills", "player_kills", "play_time"].map(custom),
      // Timers tick constantly, so they would always be "recent".
      recentExcluded: ["play_time", "total_world_time", "time_since_death", "time_since_rest", "sneak_time"].map(custom)
    },
    map: { url: DEFAULT_MAP_URL }
  };
}

const validMapUrl = value => typeof value === "string" && value.length <= 200
  && /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/.test(value);
const validStatisticIds = value => Array.isArray(value) && value.length <= MAX_STATISTIC_SETTINGS
  && value.every(id => typeof id === "string" && id.length <= 256
    && /^[a-z0-9_.-]+:[a-z0-9_.-]+\/[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(id));

/** Fills missing settings with defaults; rejects present-but-malformed ones. */
function normalizeSettings(value) {
  const settings = defaultSettings();
  if (value === undefined) return settings;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings");
  const showArmor = value.inventory?.showArmor;
  if (showArmor !== undefined) {
    if (typeof showArmor !== "boolean") throw new Error("Invalid inventory settings");
    settings.inventory.showArmor = showArmor;
  }
  for (const key of ["shown", "recentExcluded"]) {
    const ids = value.statistics?.[key];
    if (ids === undefined) continue;
    if (!validStatisticIds(ids)) throw new Error("Invalid statistics settings");
    settings.statistics[key] = [...new Set(ids)];
  }
  const url = value.map?.url;
  if (url !== undefined) {
    if (!validMapUrl(url)) throw new Error("Invalid map settings");
    settings.map.url = url;
  }
  return settings;
}

function defaultLayout() {
  return { version: 1, settings: defaultSettings(), tiles: [
    { id: "player", enabled: true, x: 0, y: 0, w: 4, h: 4 },
    { id: "inventory", enabled: true, x: 4, y: 0, w: 8, h: 8 },
    { id: "statistics", enabled: true, x: 0, y: 4, w: 4, h: 9 },
    { id: "history", enabled: true, x: 4, y: 8, w: 8, h: 9 },
    { id: "map", enabled: false, x: 0, y: 17, w: 6, h: 6 },
    { id: "build", enabled: false, x: 6, y: 17, w: 6, h: 4 }
  ] };
}

const wholeNumber = value => Number.isSafeInteger(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Validates untrusted layout JSON (stored config or an imported file) and fills in any missing tiles. */
function normalizeLayout(value) {
  if (value === null || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.tiles)
    || value.tiles.length > TILE_IDS.length) {
    throw new Error("Invalid layout");
  }
  const seen = new Set();
  const tiles = value.tiles.map(tile => {
    if (tile === null || typeof tile !== "object" || !TILE_IDS.includes(tile.id) || seen.has(tile.id)
      || typeof tile.enabled !== "boolean" || !["x", "y", "w", "h"].every(key => wholeNumber(tile[key]))) {
      throw new Error("Invalid layout tile");
    }
    seen.add(tile.id);
    return resize({ id: tile.id, enabled: tile.enabled, x: tile.x, y: tile.y, w: tile.w, h: tile.h });
  });
  const bottom = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  for (const fallback of defaultLayout().tiles) {
    if (!seen.has(fallback.id)) tiles.push({ ...fallback, enabled: false, y: bottom });
  }
  return { version: 1, settings: normalizeSettings(value.settings), tiles: settle(tiles, null) };
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
