"use strict";

// Pure tile-layout model: a 12-column grid of whole cells. Tiles never overlap; after a move or resize the
// other enabled tiles fall upward into the highest free space, keeping their relative order.

const LAYOUT_COLUMNS = 12;
const LAYOUT_MAX_Y = 1000;
const LAYOUT_MAX_H = 60;
const TILE_IDS = ["player", "inventory", "statistics", "history", "map", "build"];
const TILE_MINIMUMS = {
  player: { w: 2, h: 2 }, inventory: { w: 3, h: 3 }, statistics: { w: 2, h: 3 },
  history: { w: 3, h: 3 }, map: { w: 2, h: 2 }, build: { w: 2, h: 2 }
};

function defaultLayout() {
  return { version: 1, tiles: [
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
  return { version: 1, tiles: settle(tiles, null) };
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
  return { version: 1, tiles: keepPinned ? settled : settle(settled, null) };
}

function setTileEnabled(layout, id, enabled) {
  const bottom = layout.tiles.filter(tile => tile.enabled)
    .reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  const tiles = layout.tiles.map(tile => tile.id !== id ? tile
    : { ...tile, enabled, y: enabled ? bottom : tile.y });
  return { version: 1, tiles: settle(tiles, null) };
}

function layoutRows(layout) {
  return layout.tiles.filter(tile => tile.enabled).reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
}
