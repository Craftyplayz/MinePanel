"use strict";

// Dashboard UI. Message validation lives in protocol.js and the tile-layout model in layout.js.

const $ = selector => document.querySelector(selector);
const connection = $("#connection-status");
const dot = $("#connection-dot");
const gameStatus = $("#game-status");
const stateMessage = $("#state-message");
const version = $("#version");
const healthValue = $("#health-value");
const healthFill = $("#health-fill");
const absorptionFill = $("#absorption-fill");
const sessionValue = $("#session-value");
const dimensionValue = $("#dimension-value");
const positionValue = $("#position-value");
const inventoryStatus = $("#inventory-status");
const heldValue = $("#held-value");
const statisticsStatus = $("#statistics-status");
const statisticsEntries = $("#statistics-entries");
const historyStatus = $("#history-status");
const historyEntries = $("#history-entries");
const historyEmpty = $("#history-empty");
const historyCategory = $("#history-category");
const historySearch = $("#history-search");
const tooltip = $("#tooltip");
const grid = $("#grid");
const editToggle = $("#edit-toggle");
const editToolbar = $("#edit-toolbar");
const layoutStatus = $("#layout-status");
const layoutFile = $("#layout-file");

const TILE_LABELS = { player: "Player", inventory: "Inventory", statistics: "Statistics",
  history: "Activity log", map: "JourneyMap", build: "Build progress" };
const CATEGORY_LABELS = { lifecycle: "Session", death: "Death", dimension: "Dimension", kill: "Kill",
  mine: "Mined", place: "Placed", container: "Opened", inventory: "Inventory", drop: "Dropped",
  damage: "Damage", heal: "Healed", advancement: "Advancement" };
const IMPORTANT_COUNTERS = new Set(["minecraft:walk_one_cm", "minecraft:sprint_one_cm", "minecraft:deaths",
  "minecraft:mob_kills", "minecraft:player_kills", "minecraft:play_time"]);
const EQUIPMENT_SLOTS = [["head", "Head"], ["chest", "Chest"], ["legs", "Legs"], ["feet", "Feet"], ["offhand", "Offhand"]];
const ROW_HEIGHT = 40;
const GRID_GAP = 10;

let activeSocket;
let reconnectTimer;
let currentPlayerState;
let generation = 0;
let pageHidden = false;
let statisticsKey;
let displayedHistory;
let historySessionId;
let historyNodes = new Map();
let historyViewKey;
let hoveredSlot;
let glintEpoch;

function writeText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

function create(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// ---------------------------------------------------------------------------------------------- Inventory slots

function createSlot(container, label) {
  const element = create("div", "slot");
  const placeholder = create("span", "placeholder-label", label);
  const icon = create("img", "icon");
  icon.alt = "";
  icon.hidden = true;
  const glint = create("span", "glint");
  glint.hidden = true;
  const fallback = create("span", "fallback");
  fallback.hidden = true;
  const count = create("span", "count");
  const durability = create("span", "durability");
  const bar = create("span");
  durability.appendChild(bar);
  durability.hidden = true;
  for (const child of [placeholder, icon, glint, fallback, count, durability]) element.appendChild(child);
  container.appendChild(element);
  const slot = { element, placeholder, icon, glint, fallback, count, durability, bar, item: null, iconKey: null };
  icon.addEventListener("error", () => {
    // Icons render on the game thread; a missing one is retried once before showing initials.
    if (!slot.iconKey || slot.retried) return showFallback(slot);
    slot.retried = true;
    window.setTimeout(() => { if (slot.iconKey) icon.src = iconUrl(slot.iconKey); }, 1500);
  });
  element.addEventListener("pointerenter", event => { hoveredSlot = slot; showTooltip(slot.item, event); });
  element.addEventListener("pointermove", event => { if (hoveredSlot === slot) positionTooltip(event); });
  element.addEventListener("pointerleave", () => { if (hoveredSlot === slot) { hoveredSlot = undefined; hideTooltip(); } });
  return slot;
}

const iconUrl = key => `/icon/${key}.png`;

function showFallback(slot) {
  setHidden(slot.icon, true);
  setHidden(slot.glint, true);
  setHidden(slot.fallback, false);
}

function initials(name) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

function updateGlintTexture(key) {
  const epoch = /^e(\d+)-/.exec(key)?.[1];
  if (epoch === undefined || epoch === glintEpoch) return;
  glintEpoch = epoch;
  document.documentElement?.style?.setProperty("--glint", `url("/glint.png?v=${epoch}")`);
}

function renderSlot(slot, item, selected) {
  const className = selected ? "slot selected" : "slot";
  if (slot.element.className !== className) slot.element.className = className;
  const changed = slot.item !== item;
  slot.item = item;
  if (!item || item.empty) {
    slot.iconKey = null;
    setHidden(slot.placeholder, false);
    for (const part of [slot.icon, slot.glint, slot.fallback, slot.durability]) setHidden(part, true);
    writeText(slot.count, "");
    slot.element.setAttribute?.("aria-label", "Empty");
  } else {
    setHidden(slot.placeholder, true);
    slot.element.setAttribute?.("aria-label", `${item.name}${item.count > 1 ? ` × ${item.count}` : ""}`);
    writeText(slot.fallback, initials(item.name));
    if (item.icon === null) {
      slot.iconKey = null;
      showFallback(slot);
    } else if (item.icon !== slot.iconKey) {
      slot.iconKey = item.icon;
      slot.retried = false;
      updateGlintTexture(item.icon);
      slot.icon.src = iconUrl(item.icon);
      slot.glint.style.maskImage = `url("${iconUrl(item.icon)}")`;
      slot.glint.style.webkitMaskImage = `url("${iconUrl(item.icon)}")`;
      setHidden(slot.icon, false);
      setHidden(slot.fallback, true);
    }
    if (slot.iconKey) setHidden(slot.glint, !item.foil);
    writeText(slot.count, item.count > 1 ? String(item.count) : "");
    const damaged = item.maxDamage !== null && item.damage > 0;
    setHidden(slot.durability, !damaged);
    if (damaged) {
      const fraction = item.remainingDurability / item.maxDamage;
      slot.bar.style.width = `${Math.round(fraction * 100)}%`;
      slot.bar.style.background = `hsl(${Math.round(fraction * 120)}, 100%, 50%)`;
    }
  }
  if (changed && hoveredSlot === slot) showTooltip(item);
}

const hotbarSlots = Array.from({ length: 9 }, () => createSlot($("#hotbar-slots")));
const mainSlots = Array.from({ length: 27 }, () => createSlot($("#main-slots")));
const inventorySlots = [...hotbarSlots, ...mainSlots];
const equipmentSlots = EQUIPMENT_SLOTS.map(([, label]) => createSlot($("#equipment-slots"), label));

function renderInventory(inventory) {
  writeText(inventoryStatus, inventory ? `Slot ${inventory.selectedHotbarSlot + 1}` : "Unavailable");
  const held = inventory?.equipment.mainhand;
  writeText(heldValue, !inventory ? "Held item unavailable"
    : held.empty ? "Holding nothing" : `Holding ${held.name}${held.count > 1 ? ` × ${held.count}` : ""}`);
  inventorySlots.forEach((slot, index) =>
    renderSlot(slot, inventory?.slots[index] ?? null, inventory !== null && index === inventory?.selectedHotbarSlot));
  equipmentSlots.forEach((slot, index) =>
    renderSlot(slot, inventory?.equipment[EQUIPMENT_SLOTS[index][0]] ?? null, false));
}

// --------------------------------------------------------------------------------------------------- Tooltips

function shadowColor(color) {
  // Minecraft draws text shadows at a quarter of the text colour's brightness.
  const value = parseInt(color.slice(1), 16);
  const channel = shift => Math.floor(((value >> shift) & 255) / 4);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function showTooltip(item, event) {
  if (!item || item.empty) return hideTooltip();
  const lines = item.tooltip.length ? item.tooltip : [[{ text: item.name, color: null, format: "" }]];
  tooltip.replaceChildren(...lines.map(line => {
    const row = create("div", "line");
    for (const segment of line) {
      const span = create("span", [...segment.format].join(" "), segment.text);
      if (segment.color) {
        span.style.color = segment.color;
        span.style.textShadow = `1px 1px 0 ${shadowColor(segment.color)}`;
      }
      row.appendChild(span);
    }
    return row;
  }));
  setHidden(tooltip, false);
  if (event) positionTooltip(event);
}

function positionTooltip(event) {
  if (tooltip.hidden || !tooltip.getBoundingClientRect) return;
  const box = tooltip.getBoundingClientRect();
  const x = event.clientX + 16 + box.width > window.innerWidth - 8 ? event.clientX - 16 - box.width : event.clientX + 16;
  const y = Math.min(Math.max(8, event.clientY - 12), window.innerHeight - box.height - 8);
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  setHidden(tooltip, true);
}

// ------------------------------------------------------------------------------------- Player and statistics

function setConnection(online) {
  connection.textContent = online ? "Connected" : "Disconnected · reconnecting";
  dot.className = online ? "dot online" : "dot offline";
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remaining}s`;
}

function formatCounter(value, unit) {
  if (value === null) return "Unavailable";
  if (unit === "cm") return `${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} m`;
  if (unit === "ticks") return formatDuration(value / 20);
  return value.toLocaleString();
}

const formatNumber = value => Number.isInteger(value) ? String(value) : value.toFixed(1);

function renderStatistics(statistics) {
  writeText(statisticsStatus, statistics ? "Client counters" : "Unavailable");
  const key = JSON.stringify(statistics);
  if (key === statisticsKey) return;
  statisticsKey = key;
  const groups = new Map();
  for (const entry of statistics?.entries ?? []) {
    if (!groups.has(entry.category)) {
      const section = create("section", "statistics-group");
      section.appendChild(create("h3", "prio-3", entry.category));
      groups.set(entry.category, section);
    }
    const row = create("div", IMPORTANT_COUNTERS.has(entry.id) ? "counter-row" : "counter-row prio-2");
    row.appendChild(create("span", "label", entry.label));
    row.appendChild(create("span", "total", formatCounter(entry.cumulative, entry.unit)));
    row.appendChild(create("span", "session prio-2", entry.session === null ? "" : `+${formatCounter(entry.session, entry.unit)}`));
    groups.get(entry.category).appendChild(row);
  }
  if (!groups.size) {
    statisticsEntries.replaceChildren(create("p", "empty-note",
      statistics ? "No counters available." : "Statistics unavailable."));
  } else {
    statisticsEntries.replaceChildren(...groups.values());
  }
}

// ------------------------------------------------------------------------------------------------ Activity log

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
}

function renderHistory(history) {
  displayedHistory = history;
  writeText(historyStatus, !history || history.sessionId === 0
    ? "No session" : `${history.active ? "Current" : "Previous"} session · ${history.events.length}`);
  if (historySessionId !== history?.sessionId) {
    historyNodes = new Map();
    historySessionId = history?.sessionId;
    historyViewKey = undefined;
  }
  const events = history?.events ?? [];
  const retained = new Set(events.map(event => event.id));
  for (const id of historyNodes.keys()) {
    if (!retained.has(id)) historyNodes.delete(id);
  }
  for (const event of events) {
    let node = historyNodes.get(event.id);
    if (!node) {
      node = create("details", "history-event");
      const summary = create("summary");
      summary.appendChild(create("span", "time"));
      summary.appendChild(create("span", "category prio-2"));
      summary.appendChild(create("span", "label"));
      node.appendChild(summary);
      node.appendChild(create("p"));
      historyNodes.set(event.id, node);
    }
    if (node.dataset.category !== event.category) node.dataset.category = event.category;
    const [time, category, label] = node.children[0].children;
    writeText(time, formatTime(event.timestamp));
    writeText(category, CATEGORY_LABELS[event.category]);
    writeText(label, event.label);
    writeText(node.children[1], event.details || "No additional details.");
  }
  const query = historySearch.value.trim().toLowerCase();
  const category = historyCategory.value;
  const visible = events.filter(event => (!category || category === "all" || event.category === category)
    && `${event.label} ${event.details} ${event.category}`.toLowerCase().includes(query)).reverse();
  const viewKey = JSON.stringify([history?.sessionId, visible.map(event => event.id)]);
  if (viewKey !== historyViewKey) {
    historyViewKey = viewKey;
    historyEntries.replaceChildren(...visible.map(event => historyNodes.get(event.id)));
  }
  writeText(historyEmpty, visible.length ? "" : events.length ? "No matching events." : "No gameplay events.");
}

historyCategory.addEventListener("change", () => renderHistory(displayedHistory));
historySearch.addEventListener("input", () => renderHistory(displayedHistory));

function renderPlayer(player) {
  renderInventory(player?.available ? player.inventory : null);
  renderStatistics(player?.available ? player.statistics : null);
  renderHistory(player?.history);
  if (!player?.available) {
    writeText(gameStatus, "No active world");
    writeText(healthValue, "—");
    writeText(sessionValue, "—");
    writeText(dimensionValue, "—");
    writeText(positionValue, "Position unavailable");
    healthFill.style.width = "0%";
    absorptionFill.style.width = "0%";
    return;
  }
  writeText(gameStatus, "In world");
  writeText(healthValue, `${formatNumber(player.health)} / ${formatNumber(player.maxHealth)}`
    + (player.absorption > 0 ? ` +${formatNumber(player.absorption)}` : ""));
  const max = Math.max(player.maxHealth, 1);
  const healthPercent = Math.min(100, player.health / max * 100);
  healthFill.style.width = `${healthPercent}%`;
  absorptionFill.style.left = `${healthPercent}%`;
  absorptionFill.style.width = `${Math.min(100 - healthPercent, player.absorption / max * 100)}%`;
  writeText(sessionValue, formatDuration(player.sessionSeconds));
  writeText(dimensionValue, player.dimension || "Unknown");
  const pos = player.position;
  writeText(positionValue, `X ${pos.x.toFixed(1)} · Y ${pos.y.toFixed(1)} · Z ${pos.z.toFixed(1)}`);
}

function clearLiveData() {
  currentPlayerState = undefined;
  renderPlayer(null);
  writeText(gameStatus, "Unavailable");
  writeText(stateMessage, "Waiting for a fresh MinePanel snapshot.");
  writeText(version, "·");
}

// ---------------------------------------------------------------------------------------------------- Layout

let layout = defaultLayout();
let layoutLoaded = false;
let layoutChanged = false;
let editing = false;
let saveTimer;
let drag;
const tileElements = Object.fromEntries(TILE_IDS.map(id => [id, $(`#tile-${id}`)]));
const tileToggles = Object.fromEntries(TILE_IDS.map(id => {
  const chip = create("button", "chip", TILE_LABELS[id]);
  chip.type = "button";
  chip.addEventListener("click", () => {
    const tile = layout.tiles.find(value => value.id === id);
    changeLayout(setTileEnabled(layout, id, !tile.enabled));
  });
  $("#tile-toggles").appendChild(chip);
  return [id, chip];
}));

function applyLayout() {
  const order = [...layout.tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const tile of layout.tiles) {
    const element = tileElements[tile.id];
    setHidden(element, !tile.enabled);
    element.style.setProperty("--grid-column", `${tile.x + 1} / span ${tile.w}`);
    element.style.setProperty("--grid-row", `${tile.y + 1} / span ${tile.h}`);
    element.style.setProperty("--grid-row-span", `span ${tile.h}`);
    element.style.setProperty("--order", String(order.indexOf(tile)));
    tileToggles[tile.id].setAttribute("aria-pressed", String(tile.enabled));
  }
}

function changeLayout(next) {
  layout = next;
  layoutChanged = true;
  applyLayout();
  scheduleSave();
}

function setLayoutStatus(text, error = false) {
  writeText(layoutStatus, text);
  layoutStatus.className = error ? "save-status error" : "save-status";
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  setLayoutStatus("Saving…");
  saveTimer = window.setTimeout(async () => {
    try {
      const response = await fetch("/api/layout", { method: "PUT", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(layout) });
      if (!response.ok) throw new Error("Layout not saved");
      setLayoutStatus("Saved to config/minepanel/layout.json");
    } catch {
      setLayoutStatus("Not saved", true);
    }
  }, 400);
}

async function loadLayout() {
  if (layoutLoaded) return;
  try {
    const response = await fetch("/api/layout", { cache: "no-store" });
    if (!response.ok) return;
    const { layout: stored } = await response.json();
    layoutLoaded = true;
    if (stored && !layoutChanged) {
      layout = normalizeLayout(stored);
      applyLayout();
    }
  } catch {
    // Keep the default layout; the next connection retries.
  }
}

function setEditing(value) {
  editing = value;
  grid.className = editing ? "grid editing" : "grid";
  setHidden(editToolbar, !editing);
  editToggle.setAttribute("aria-pressed", String(editing));
  if (!editing) setLayoutStatus("");
}

editToggle.addEventListener("click", () => setEditing(!editing));
$("#edit-done").addEventListener("click", () => setEditing(false));
$("#layout-reset").addEventListener("click", () => changeLayout(defaultLayout()));
$("#layout-export").addEventListener("click", () => {
  const link = create("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" }));
  link.download = "minepanel-layout.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$("#layout-import").addEventListener("click", () => layoutFile.click());
layoutFile.addEventListener("change", async () => {
  const file = layoutFile.files?.[0];
  layoutFile.value = "";
  if (!file) return;
  try {
    changeLayout(normalizeLayout(JSON.parse(await file.text())));
  } catch {
    setLayoutStatus("That file is not a MinePanel layout", true);
  }
});

function gridMetrics() {
  const box = grid.getBoundingClientRect();
  const style = window.getComputedStyle(grid);
  const left = box.left + parseFloat(style.paddingLeft);
  const top = box.top + parseFloat(style.paddingTop);
  const width = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const column = (width - GRID_GAP * (LAYOUT_COLUMNS - 1)) / LAYOUT_COLUMNS;
  return { left, top, columnStride: column + GRID_GAP, rowStride: ROW_HEIGHT + GRID_GAP };
}

function startDrag(event, id, mode) {
  if (!editing || event.button !== 0) return;
  const element = tileElements[id];
  const box = element.getBoundingClientRect();
  drag = { id, mode, base: layout, metrics: gridMetrics(), tile: layout.tiles.find(tile => tile.id === id),
    offsetX: event.clientX - box.left, offsetY: event.clientY - box.top, rect: null };
  event.currentTarget.setPointerCapture(event.pointerId);
  element.classList.add("dragging");
  event.preventDefault();
}

function dragTo(event) {
  if (!drag) return;
  const { metrics, tile } = drag;
  const rect = drag.mode === "move"
    ? { x: Math.round((event.clientX - metrics.left - drag.offsetX) / metrics.columnStride),
        y: Math.round((event.clientY - metrics.top - drag.offsetY) / metrics.rowStride) }
    : { w: Math.round((event.clientX - metrics.left - tile.x * metrics.columnStride + GRID_GAP) / metrics.columnStride),
        h: Math.round((event.clientY - metrics.top - tile.y * metrics.rowStride + GRID_GAP) / metrics.rowStride) };
  if (JSON.stringify(rect) === JSON.stringify(drag.rect)) return;
  drag.rect = rect;
  layout = placeTile(drag.base, drag.id, rect, true);
  applyLayout();
}

function endDrag() {
  if (!drag) return;
  tileElements[drag.id].classList.remove("dragging");
  const finished = drag;
  drag = undefined;
  if (finished.rect) changeLayout(placeTile(finished.base, finished.id, finished.rect, false));
}

for (const id of TILE_IDS) {
  const head = $(`#head-${id}`);
  const handle = create("span", "resize-handle");
  handle.setAttribute("aria-hidden", "true");
  tileElements[id].appendChild(handle);
  for (const [target, mode] of [[head, "move"], [handle, "resize"]]) {
    target.addEventListener("pointerdown", event => startDrag(event, id, mode));
    target.addEventListener("pointermove", dragTo);
    target.addEventListener("pointerup", endDrag);
    target.addEventListener("pointercancel", endDrag);
  }
}

applyLayout();
setEditing(false);

// ------------------------------------------------------------------------------------------------ Connection

function scheduleReconnect(delay) {
  if (pageHidden) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connect, delay);
}

async function connect() {
  if (pageHidden) return;
  const attempt = ++generation;
  window.clearTimeout(reconnectTimer);
  const oldSocket = activeSocket;
  activeSocket = undefined;
  if (oldSocket) oldSocket.close();
  clearLiveData();
  try {
    const session = await fetch("/api/session", { cache: "no-store" });
    if (pageHidden || attempt !== generation) return;
    if (!session.ok) throw new Error("Local session unavailable");
    const { websocketPort } = await session.json();
    if (pageHidden || attempt !== generation) return;
    if (!Number.isInteger(websocketPort) || websocketPort < 1 || websocketPort > 65535) {
      throw new Error("Invalid local session");
    }
    loadLayout();
    const socket = new WebSocket(`ws://127.0.0.1:${websocketPort}/ws`);
    activeSocket = socket;
    let rejected = false;
    const isCurrent = () => !pageHidden && attempt === generation && activeSocket === socket;
    socket.addEventListener("open", () => {
      if (isCurrent() && !rejected) setConnection(true);
    }, { once: true });
    socket.addEventListener("message", event => {
      if (!isCurrent() || rejected) return;
      try {
        const message = JSON.parse(event.data);
        currentPlayerState = applyMessage(currentPlayerState, message);
        setConnection(true);
        writeText(stateMessage, currentPlayerState.available ? "Live" : "Not in a world");
        renderPlayer(currentPlayerState);
        writeText(version, `v${message.modVersion || "0.1.0"}`);
      } catch {
        rejected = true;
        clearLiveData();
        setConnection(false);
        socket.close(1002, "Invalid dashboard message");
      }
    });
    socket.addEventListener("close", () => {
      if (!isCurrent()) return;
      activeSocket = undefined;
      clearLiveData();
      setConnection(false);
      scheduleReconnect(2000);
    }, { once: true });
    socket.addEventListener("error", () => {
      if (isCurrent()) {
        rejected = true;
        clearLiveData();
        setConnection(false);
        socket.close();
      }
    }, { once: true });
  } catch {
    if (pageHidden || attempt !== generation) return;
    clearLiveData();
    setConnection(false);
    scheduleReconnect(3000);
  }
}

window.addEventListener("pagehide", () => {
  pageHidden = true;
  generation++;
  window.clearTimeout(reconnectTimer);
  clearLiveData();
  setConnection(false);
  if (activeSocket) activeSocket.close();
  activeSocket = undefined;
});

window.addEventListener("pageshow", event => {
  if (event.persisted && pageHidden) {
    pageHidden = false;
    connect();
  }
});

connect();
