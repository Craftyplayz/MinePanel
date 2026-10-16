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
const saturationFill = $("#saturation-fill");
const foodFill = $("#food-fill");
const foodValue = $("#food-value");
const effectsList = $("#effects");
const sessionValue = $("#session-value");
const dimensionValue = $("#dimension-value");
const positionValue = $("#position-value");
const inventoryStatus = $("#inventory-status");
const inventoryBody = $("#inventory-body");
const inventoryGrid = $("#inventory-grid");
const armorToggle = $("#armor-toggle");
const heldValue = $("#held-value");
const statisticsStatus = $("#statistics-status");
const statisticsColumns = $("#statistics-columns");
const statisticsEntries = $("#statistics-entries");
const statisticsRecent = $("#statistics-recent");
const statisticsRecentSection = $("#statistics-recent-section");
const statisticsDialog = $("#statistics-dialog");
const statisticsOptions = $("#statistics-options");
const statisticsSearch = $("#statistics-search");
const statisticsRecentHint = $("#statistics-recent-hint");
const statisticsRecentLifetime = $("#statistics-recent-lifetime");
const statisticsRecentRows = $("#statistics-recent-rows");
const mapFrame = $("#map-frame");
const mapOffline = $("#map-offline");
const mapOfflineText = $("#map-offline-text");
const mapStatus = $("#map-status");
const mapOpen = $("#map-open");
const mapAddress = $("#map-address");
const mapUrlInput = $("#map-url");
const mapUrlError = $("#map-url-error");
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
  history: "Activity log", map: "JourneyMap", build: "Build progress", movement: "Movement", xp: "Experience",
  pickups: "Recent pickups", advancements: "Advancements", villagers: "Villager trades", performance: "Performance" };
const CATEGORY_LABELS = { lifecycle: "Session", death: "Death", dimension: "Dimension", kill: "Kill",
  mine: "Mined", place: "Placed", container: "Opened", inventory: "Inventory", drop: "Dropped",
  damage: "Damage", heal: "Healed", advancement: "Advancement", biome: "Biome", weather: "Weather", time: "Day" };
/** Feature code (features.js) registers here to render with each update, after layout changes, and every second. */
const featureHooks = { render: [], layout: [], tick: [] };
const EQUIPMENT_SLOTS = [["head", "Head"], ["chest", "Chest"], ["legs", "Legs"], ["feet", "Feet"], ["offhand", "Offhand"]];
const ROW_HEIGHT = 40;
const GRID_GAP = 10;
const HELD_LINE_HEIGHT = 22;
const RECONNECT_MILLIS = 5_000;

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
  const fallback = create("span", "fallback");
  fallback.hidden = true;
  const count = create("span", "count");
  const durability = create("span", "durability");
  const bar = create("span");
  durability.appendChild(bar);
  durability.hidden = true;
  for (const child of [placeholder, icon, fallback, count, durability]) element.appendChild(child);
  container.appendChild(element);
  const slot = { element, placeholder, icon, fallback, count, durability, bar, item: null, iconKey: null };
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
  setHidden(slot.fallback, false);
}

function initials(name) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

function renderSlot(slot, item, selected) {
  const className = `${slot.base ?? "slot"}${selected ? " selected" : ""}`;
  if (slot.element.className !== className) slot.element.className = className;
  const changed = slot.item !== item;
  slot.item = item;
  if (!item || item.empty) {
    slot.iconKey = null;
    setHidden(slot.placeholder, false);
    for (const part of [slot.icon, slot.fallback, slot.durability]) setHidden(part, true);
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
      slot.icon.src = iconUrl(item.icon);
      setHidden(slot.icon, false);
      setHidden(slot.fallback, true);
    }
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

const hotbarSlots = Array.from({ length: 9 }, () => createSlot(inventoryGrid));
const mainSlots = Array.from({ length: 27 }, () => createSlot(inventoryGrid));
const inventorySlots = [...hotbarSlots, ...mainSlots];
const equipmentSlots = EQUIPMENT_SLOTS.map(([, label]) => createSlot(inventoryGrid, label));
// The player head and ender chest float beside the slots, without a slot frame; the ender chest opens its window.
const headSlot = createSlot(inventoryGrid);
const enderChestSlot = createSlot(inventoryGrid);
headSlot.base = enderChestSlot.base = "slot floating";
enderChestSlot.element.id = "enderchest-open";
enderChestSlot.element.title = "Ender chest contents, as last seen";
const inventoryRows = {
  hotbar: hotbarSlots, main1: mainSlots.slice(0, 9), main2: mainSlots.slice(9, 18), main3: mainSlots.slice(18, 27),
  equipment: equipmentSlots
};
let inventoryArrangementKey;

function bodySize(element) {
  const box = element.getBoundingClientRect();
  const style = window.getComputedStyle?.(element) ?? {};
  const horizontal = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const vertical = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  return { width: Math.max(0, box.width - horizontal), height: Math.max(0, box.height - vertical) };
}

/** Places slots on the grid so only rows that fully fit are shown; see inventoryArrangement in layout.js. */
function layoutInventory() {
  const { width, height } = bodySize(inventoryBody);
  const showArmor = displaySettings().inventory.showArmor;
  const withHeld = inventoryArrangement(width, height - HELD_LINE_HEIGHT, showArmor);
  const full = inventoryArrangement(width, height, showArmor);
  // The "Holding ..." line is a luxury: show it only when it costs no inventory row and no slot size.
  const showHeld = withHeld.rows.length === full.rows.length && withHeld.wide === full.wide
    && withHeld.slot >= full.slot;
  const arrangement = showHeld ? withHeld : full;
  const key = JSON.stringify([arrangement, showHeld, showArmor]);
  if (key === inventoryArrangementKey) return;
  inventoryArrangementKey = key;
  setHidden(heldValue, !showHeld);
  const visual = (arrangement.wide ? ["main1", "main2", "main3", "hotbar"]
    : ["equipment", "main1", "main2", "main3", "hotbar"]).filter(row => arrangement.rows.includes(row));
  const rowOf = name => visual.indexOf(name) + 1;
  inventoryGrid.style.setProperty("--slot", `${arrangement.slot}px`);
  inventoryGrid.style.gridTemplateColumns = !arrangement.wide ? "repeat(9, var(--slot))"
    : `${showArmor ? "var(--slot) 6px " : ""}repeat(9, var(--slot)) 6px var(--slot)`;
  const firstStorage = arrangement.wide && showArmor ? 3 : 1;
  const side = firstStorage + 10;
  const place = (slot, row, column) => {
    setHidden(slot.element, row < 1);
    if (row >= 1) {
      slot.element.style.gridRow = String(row);
      slot.element.style.gridColumn = String(column);
    }
  };
  for (const name of ["hotbar", "main1", "main2", "main3"]) {
    inventoryRows[name].forEach((slot, index) => place(slot, rowOf(name), firstStorage + index));
  }
  // In columns, armor pieces line up with the storage rows beside them; on the other side the offhand sits next
  // to the hotbar, the ender chest above it and the player head at the top. In a row, they follow each other
  // with the head at the far end. Hiding armor keeps the rest.
  const armorRows = ["main1", "main2", "main3", "hotbar"];
  const offhandColumn = showArmor ? 5 : 1;
  equipmentSlots.forEach((slot, index) => {
    if (index === 4) {
      return arrangement.wide ? place(slot, rowOf("hotbar"), side) : place(slot, rowOf("equipment"), offhandColumn);
    }
    if (!showArmor) return place(slot, 0, 0);
    place(slot, rowOf(arrangement.wide ? armorRows[index] : "equipment"), arrangement.wide ? 1 : 1 + index);
  });
  if (arrangement.wide) {
    place(enderChestSlot, rowOf("main3"), side);
    place(headSlot, rowOf("main1"), side);
  } else {
    place(enderChestSlot, rowOf("equipment"), offhandColumn + 1);
    place(headSlot, rowOf("equipment"), 9);
  }
}

if (typeof ResizeObserver === "function") new ResizeObserver(() => layoutInventory()).observe(inventoryBody);
window.addEventListener("resize", () => layoutInventory());

armorToggle.addEventListener("pointerdown", event => event.stopPropagation());
armorToggle.addEventListener("click", () =>
  changeSettings("inventory", { showArmor: !displaySettings().inventory.showArmor }));

function renderInventory(inventory, icons) {
  writeText(inventoryStatus, inventory ? `Slot ${inventory.selectedHotbarSlot + 1}` : "Unavailable");
  const held = inventory?.equipment.mainhand;
  writeText(heldValue, !inventory ? "Held item unavailable"
    : held.empty ? "Holding nothing" : `Holding ${held.name}${held.count > 1 ? ` × ${held.count}` : ""}`);
  inventorySlots.forEach((slot, index) =>
    renderSlot(slot, inventory?.slots[index] ?? null, inventory !== null && index === inventory?.selectedHotbarSlot));
  equipmentSlots.forEach((slot, index) =>
    renderSlot(slot, inventory?.equipment[EQUIPMENT_SLOTS[index][0]] ?? null, false));
  renderSlot(headSlot, icons?.head ?? null, false);
  renderSlot(enderChestSlot, icons?.enderChest ?? null, false);
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
  connection.textContent = online ? "Connected" : "Disconnected · retrying every 5 s";
  dot.className = online ? "dot online" : "dot offline";
  editToggle.title = `Customize · ${connection.textContent}`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remaining}s`;
}

const formatNumber = value => Number.isInteger(value) ? String(value) : value.toFixed(1);

let displayedStatistics = null;

function statisticRow(entry, showCategory, className = "counter-row") {
  const row = create("div", className);
  const label = create("span", "label", entry.label);
  if (showCategory && entry.category !== "General") label.appendChild(create("span", "stat-category", entry.category));
  row.appendChild(label);
  row.appendChild(create("span", "total", entry.display));
  row.appendChild(create("span", "session prio-2", entry.session > 0 ? `+${entry.sessionDisplay}` : ""));
  for (const [rate, title] of [[entry.sessionRate, "Average per hour this session"],
    [entry.recentRate, "Average per hour over the last 60 seconds"]]) {
    const cell = create("span", "rate", rate ? `${rate}/h` : "");
    cell.title = title;
    row.appendChild(cell);
  }
  return row;
}

// Labels the game has sent, so statistics keep their names while they read as zero.
const knownStatisticLabels = new Map();
const statisticLabel = id => knownStatisticLabels.get(id)
  ?? id.slice(id.lastIndexOf(":") + 1).replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

function zeroStatistic(id) {
  return { id, label: statisticLabel(id), category: "General", display: "0", session: 0, sessionDisplay: "0",
    sessionRate: null, recentRate: null };
}

/**
 * Changed statistics that are neither pinned nor excluded, newest first: those within the chosen lifetime
 * (or all of them for "until replaced"), up to the chosen number of rows.
 */
function recentStatistics(statistics, settings, now = Date.now()) {
  const hidden = new Set([...settings.shown, ...settings.recentExcluded]);
  return (statistics?.entries ?? [])
    .filter(entry => entry.changedAt !== null && !hidden.has(entry.id)
      && (settings.recentLifetime === 0 || now - entry.changedAt < settings.recentLifetime * 1000))
    .sort((a, b) => b.changedAt - a.changedAt || (a.label < b.label ? -1 : 1))
    .slice(0, settings.recentRows);
}

const RECENT_LIFETIME_HINTS = { 0: "· latest changes", 10: "· changed in the last 10 seconds",
  30: "· changed in the last 30 seconds", 60: "· changed in the last minute", 300: "· changed in the last 5 minutes" };
const recentLifetimeHint = seconds => RECENT_LIFETIME_HINTS[seconds] ?? `· changed in the last ${seconds} seconds`;

function renderStatistics(statistics, now = Date.now()) {
  displayedStatistics = statistics;
  writeText(statisticsStatus, statistics ? "Session" : "Unavailable");
  const settings = displaySettings().statistics;
  const byId = new Map((statistics?.entries ?? []).map(entry => [entry.id, entry]));
  for (const entry of byId.values()) knownStatisticLabels.set(entry.id, entry.label);
  // Chosen statistics the game has not reported (or all of them while unavailable) read as zero.
  const pinned = settings.shown.map(id => byId.get(id) ?? zeroStatistic(id));
  const recent = recentStatistics(statistics, settings, now);
  writeText(statisticsRecentHint, recentLifetimeHint(settings.recentLifetime));
  const key = JSON.stringify([pinned, recent.map(entry =>
    [entry.id, entry.display, entry.session, entry.sessionRate, entry.recentRate])]);
  if (key === statisticsKey) return;
  statisticsKey = key;
  setHidden(statisticsColumns, !pinned.length);
  if (!pinned.length) {
    statisticsEntries.replaceChildren(create("p", "empty-note", "No statistics chosen. Use ⚙ to pick some."));
  } else {
    statisticsEntries.replaceChildren(...pinned.map(entry => statisticRow(entry, true)));
  }
  setHidden(statisticsRecentSection, recent.length === 0);
  statisticsRecent.replaceChildren(...recent.map(recentRow));
  if (!statisticsDialog.hidden) renderStatisticOptions();
}

/** A recent statistic with edit-mode buttons to pin it or keep it out of Recent; CSS shows them only while editing. */
function recentRow(entry) {
  const row = statisticRow(entry, true, "counter-row recent-row");
  const actions = create("span", "recent-actions");
  for (const [key, text, title] of [["shown", "📌", `Pin ${entry.label}`], ["recentExcluded", "✕", `Hide ${entry.label} from Recent`]]) {
    const button = create("button", "icon-button", text);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => toggleStatistic(key, entry.id, true));
    actions.appendChild(button);
  }
  row.appendChild(actions);
  return row;
}

function toggleStatistic(key, id, enabled) {
  const current = displaySettings().statistics[key];
  const next = enabled ? [...current.filter(value => value !== id), id] : current.filter(value => value !== id);
  changeSettings("statistics", { [key]: next });
}

function renderStatisticOptions() {
  const settings = displaySettings().statistics;
  statisticsRecentLifetime.value = String(settings.recentLifetime);
  statisticsRecentRows.value = String(settings.recentRows);
  const known = new Map((displayedStatistics?.entries ?? []).map(entry => [entry.id, entry]));
  for (const id of [...settings.shown, ...settings.recentExcluded]) {
    if (!known.has(id)) known.set(id, { id, label: statisticLabel(id), category: "Not received yet" });
  }
  const query = statisticsSearch.value.trim().toLowerCase();
  const groups = new Map();
  const shown = new Set(settings.shown);
  // Within each category, pinned statistics come first, so pinning or unpinning one moves it.
  [...known.values()]
    .filter(entry => `${entry.label} ${entry.category}`.toLowerCase().includes(query))
    .sort((a, b) => a.category.localeCompare(b.category) || shown.has(b.id) - shown.has(a.id)
      || a.label.localeCompare(b.label))
    .forEach(entry => {
      if (!groups.has(entry.category)) {
        const group = create("section", "option-group");
        group.appendChild(create("h3", "", entry.category));
        groups.set(entry.category, group);
      }
      const row = create("div", "option-row");
      row.appendChild(create("span", "label", entry.label));
      for (const [key, text, checked] of [["shown", "Show", settings.shown.includes(entry.id)],
        ["recentExcluded", "Recent", !settings.recentExcluded.includes(entry.id)]]) {
        const label = create("label", "option-toggle");
        const input = create("input");
        input.type = "checkbox";
        input.checked = checked;
        input.addEventListener("change", () => toggleStatistic(key, entry.id, key === "shown" ? input.checked : !input.checked));
        label.appendChild(input);
        label.appendChild(create("span", "", text));
        row.appendChild(label);
      }
      groups.get(entry.category).appendChild(row);
    });
  statisticsOptions.replaceChildren(...(groups.size ? groups.values()
    : [create("p", "empty-note", known.size ? "No statistics match." : "Join a world to list its statistics.")]));
}

function setStatisticsDialog(open) {
  setHidden(statisticsDialog, !open);
  if (open) {
    statisticsSearch.value = "";
    renderStatisticOptions();
    statisticsSearch.focus?.();
  }
}

setHidden(statisticsDialog, true);
$("#statistics-settings").addEventListener("pointerdown", event => event.stopPropagation());
$("#statistics-settings").addEventListener("click", () => setStatisticsDialog(true));
$("#statistics-dialog-close").addEventListener("click", () => setStatisticsDialog(false));
statisticsDialog.addEventListener("click", event => { if (event.target === statisticsDialog) setStatisticsDialog(false); });
statisticsSearch.addEventListener("input", () => renderStatisticOptions());
statisticsRecentLifetime.addEventListener("change", () =>
  changeSettings("statistics", { recentLifetime: Number(statisticsRecentLifetime.value) }));
statisticsRecentRows.addEventListener("change", () => {
  const rows = Math.round(Number(statisticsRecentRows.value));
  if (rows >= 1 && rows <= 32) changeSettings("statistics", { recentRows: rows });
});
$("#statistics-defaults").addEventListener("click", () => {
  changeSettings("statistics", defaultSettings().statistics);
  renderStatisticOptions();
});
window.addEventListener("keydown", event => { if (event.key === "Escape" && !statisticsDialog.hidden) setStatisticsDialog(false); });

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
  updateView(player);
  for (const hook of featureHooks.render) hook(player);
  renderInventory(player?.available ? player.inventory : null, player?.available ? player.icons : null);
  renderStatistics(player?.available ? player.statistics : null);
  renderHistory(player?.history);
  if (!player?.available) {
    writeText(gameStatus, "No active world");
    writeText(healthValue, "—");
    writeText(sessionValue, "—");
    writeText(dimensionValue, "—");
    writeText(positionValue, "Position unavailable");
    writeText(foodValue, "—");
    healthFill.style.width = "0%";
    absorptionFill.style.width = "0%";
    saturationFill.style.width = "0%";
    foodFill.style.width = "0%";
    renderEffects([]);
    return;
  }
  writeText(foodValue, `${player.food}/${formatNumber(player.saturation)}`);
  saturationFill.style.width = `${Math.min(100, player.saturation / 20 * 100)}%`;
  foodFill.style.width = `${Math.min(100, player.food / 20 * 100)}%`;
  renderEffects(player.effects);
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

// ------------------------------------------------------------------------------------------------- Effects

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
let effectNodes = new Map();
let displayedEffects = [];

const effectIconUrl = id => `/effect/${id.replace(":", "/")}.png`;

function formatRemaining(endsAt, now = Date.now()) {
  if (endsAt === null) return "∞";
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function renderEffects(effects) {
  displayedEffects = effects;
  const retained = new Map();
  const nodes = effects.map(effect => {
    let node = effectNodes.get(effect.id);
    if (!node) {
      node = create("div", "effect");
      const icon = create("img", "effect-icon");
      icon.alt = "";
      icon.src = effectIconUrl(effect.id);
      icon.addEventListener("error", () => setHidden(icon, true));
      node.appendChild(icon);
      node.appendChild(create("span", "effect-level"));
      node.appendChild(create("span", "effect-source", "◆"));
      node.appendChild(create("span", "effect-timer"));
    }
    retained.set(effect.id, node);
    const [, level, source] = node.children;
    writeText(level, effect.amplifier > 0 ? ROMAN[effect.amplifier + 1] ?? String(effect.amplifier + 1) : "");
    setHidden(source, !effect.beacon);
    node.className = effect.beacon ? "effect beacon" : "effect";
    return node;
  });
  effectNodes = retained;
  if (effectsList.children.length !== nodes.length || nodes.some((node, index) => effectsList.children[index] !== node)) {
    effectsList.replaceChildren(...nodes);
  }
  tickEffects();
}

/** Counts effect timers down locally; the game only resends an effect when its end time actually changes. */
function tickEffects(now = Date.now()) {
  displayedEffects.forEach(effect => {
    const node = effectNodes.get(effect.id);
    if (!node) return;
    // A beacon keeps topping the effect up, so its countdown means nothing until the beacon stops reaching the player.
    const remaining = effect.beacon ? "" : formatRemaining(effect.endsAt, now);
    writeText(node.children[3], remaining);
    setHidden(node.children[3], effect.beacon);
    node.setAttribute?.("title", `${effect.name}${effect.amplifier > 0 ? ` ${ROMAN[effect.amplifier + 1] ?? effect.amplifier + 1}` : ""}`
      + (effect.beacon ? " · from a beacon" : ` · ${remaining}`));
  });
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
let editingProfile = "default";
let saveTimer;
let drag;
const ruleEngine = createRuleEngine();
let ruleEvaluation = null;
let view = effectiveView(layout, null);
let viewKey;
// Set when the stored layout could not be read or converted: it stays untouched on disk, so nothing is saved.
let layoutLocked = false;
const tileElements = Object.fromEntries(TILE_IDS.map(id => [id, $(`#tile-${id}`)]));
const tileToggles = Object.fromEntries(TILE_IDS.map(id => {
  const chip = create("button", "chip", TILE_LABELS[id]);
  chip.type = "button";
  chip.addEventListener("click", () => {
    const tile = getProfile(layout, editingProfile).tiles.find(value => value.id === id);
    changeProfile(profile => setTileMode(profile, id, tile.enabled ? "off" : "on"));
  });
  $("#tile-toggles").appendChild(chip);
  return [id, chip];
}));
// While customizing, each tile can be set to show always or only when a rule shows it (keeping its space).
const modeToggles = Object.fromEntries(TILE_IDS.map(id => {
  const button = create("button", "chip small mode-toggle", "Always");
  button.type = "button";
  button.title = "Rules only: the tile keeps its place but is hidden until a rule shows it";
  button.addEventListener("pointerdown", event => event.stopPropagation());
  button.addEventListener("click", () => {
    const tile = getProfile(layout, editingProfile).tiles.find(value => value.id === id);
    changeProfile(profile => setTileMode(profile, id, tile.rulesOnly ? "on" : "rules"));
  });
  $(`#head-${id}`).appendChild(button);
  return [id, button];
}));

/** The profile on screen: the one being edited while customizing, else the one the rules picked. */
const shownProfileId = () => editing ? editingProfile : view.profileId;

/** Settings the tiles use now: the edited profile's own while customizing, else with rule overrides. */
function displaySettings() {
  return editing ? getProfile(layout, editingProfile).settings : view.settings;
}

function changeProfile(update) {
  const id = shownProfileId();
  changeLayout(withProfile(layout, id, update(getProfile(layout, id))));
}

function changeSettings(tileId, changes) {
  changeProfile(profile => withSettings(profile, tileId, changes));
}

/** The local wall clock, for "real-world time" rule conditions. */
function wallClock(now) {
  const date = new Date(now);
  return { minutes: date.getHours() * 60 + date.getMinutes(), weekday: date.getDay() };
}

/** Evaluates the rules now and works out what the dashboard shows. */
function evaluateView(player, now) {
  ruleEvaluation = ruleEngine.evaluate(layout, { player, width: window.innerWidth, clock: wallClock(now) }, now);
  return effectiveView(layout, ruleEvaluation);
}

const viewKeyOf = value => JSON.stringify([value.profileId, [...value.visible].sort(), value.settings]);

/** Re-evaluates the rules; re-applies the layout only when what should be shown has changed. */
function updateView(player = currentPlayerState, now = Date.now()) {
  view = evaluateView(player, now);
  const key = viewKeyOf(view);
  if (key === viewKey) return;
  viewKey = key;
  applyLayout();
}

function applyLayout() {
  const profile = getProfile(layout, shownProfileId());
  const order = [...profile.tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const tile of profile.tiles) {
    const element = tileElements[tile.id];
    setHidden(element, editing ? !tile.enabled : !view.visible.has(tile.id));
    if (tile.rulesOnly) element.classList.add("rules-only");
    else element.classList.remove("rules-only");
    element.style.setProperty("--grid-column", `${tile.x + 1} / span ${tile.w}`);
    element.style.setProperty("--grid-row", `${tile.y + 1} / span ${tile.h}`);
    element.style.setProperty("--grid-row-span", `span ${tile.h}`);
    element.style.setProperty("--order", String(order.indexOf(tile)));
    tileToggles[tile.id].setAttribute("aria-pressed", String(tile.enabled));
    writeText(modeToggles[tile.id], tile.rulesOnly ? "Rules only" : "Always");
    modeToggles[tile.id].setAttribute("aria-pressed", String(Boolean(tile.rulesOnly)));
  }
  armorToggle.setAttribute("aria-pressed", String(displaySettings().inventory.showArmor));
  layoutInventory();
  statisticsKey = undefined;
  renderStatistics(displayedStatistics);
  updateMap();
  for (const hook of featureHooks.layout) hook();
}

// ------------------------------------------------------------------------------------------------- Map

const MAP_RETRY_MILLIS = 10_000;
const MAP_RECHECK_MILLIS = 30_000;
let mapUrl;
let mapTimer;

function updateMap() {
  const enabled = editing ? getProfile(layout, editingProfile).tiles.find(tile => tile.id === "map").enabled
    : view.visible.has("map");
  const url = displaySettings().map.url;
  mapOpen.href = url;
  if (!enabled) {
    window.clearTimeout(mapTimer);
    mapUrl = undefined;
    return;
  }
  if (url === mapUrl) return;
  mapUrl = url;
  probeMap();
}

/** JourneyMap's web server allows cross-origin requests, so a plain fetch tells whether the map is running. */
async function probeMap() {
  window.clearTimeout(mapTimer);
  const url = mapUrl;
  if (!url) return;
  let online;
  try {
    await fetch(url, { mode: "cors", cache: "no-store" });
    online = true;
  } catch {
    online = false;
  }
  if (url !== mapUrl) return;
  if (online) {
    if (mapFrame.src !== url) mapFrame.src = url;
    writeText(mapStatus, "Live");
    mapStatus.className = "badge";
  } else {
    writeText(mapOfflineText, `JourneyMap's web map isn't reachable at ${url}. Check that JourneyMap's web map is enabled; `
      + "retrying every 10 seconds.");
    writeText(mapStatus, "Offline");
    mapStatus.className = "badge muted";
  }
  setHidden(mapFrame, !online);
  setHidden(mapOffline, online);
  mapTimer = window.setTimeout(probeMap, online ? MAP_RECHECK_MILLIS : MAP_RETRY_MILLIS);
}

setHidden(mapAddress, true);
setHidden(mapFrame, true);
$("#map-settings").addEventListener("pointerdown", event => event.stopPropagation());
mapOpen.addEventListener("pointerdown", event => event.stopPropagation());
$("#map-settings").addEventListener("click", () => {
  setHidden(mapAddress, !mapAddress.hidden);
  mapUrlInput.value = displaySettings().map.url;
  writeText(mapUrlError, "");
});
mapAddress.addEventListener("submit", event => {
  event.preventDefault();
  const url = mapUrlInput.value.trim();
  if (!validMapUrl(url)) {
    writeText(mapUrlError, "Use an http://127.0.0.1:<port>/ or http://localhost:<port>/ address.");
    return;
  }
  setHidden(mapAddress, true);
  changeSettings("map", { url });
});

function changeLayout(next) {
  layout = next;
  layoutChanged = true;
  refreshLayout();
  scheduleSave();
}

/** Applies a new or reloaded layout: profiles or rules may have changed, so re-evaluate them. */
function refreshLayout() {
  if (!layout.profiles.some(profile => profile.id === editingProfile)) editingProfile = "default";
  view = evaluateView(currentPlayerState, Date.now());
  viewKey = viewKeyOf(view);
  applyLayout();
  renderProfileTools();
}

function setLayoutStatus(text, error = false) {
  writeText(layoutStatus, text);
  layoutStatus.className = error ? "save-status error" : "save-status";
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  if (layoutLocked) return;
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
      let normalized;
      try {
        // A version 1 layout is converted here; saving it back stores version 2 (the mod keeps a v1 backup).
        normalized = normalizeLayout(stored);
      } catch (error) {
        layoutLocked = true;
        setLayoutStatus(`The saved layout couldn't be loaded (${error.message}). It is kept unchanged on disk, `
          + "and changes here won't be saved.", true);
        return;
      }
      layout = normalized;
      refreshLayout();
      if (stored.version !== layout.version) scheduleSave();
    }
  } catch {
    // Keep the default layout; the next connection retries.
  }
}

function setEditing(value) {
  // Customizing edits the profile that is on screen; rules are paused until done.
  if (value && !editing) editingProfile = view.profileId;
  editing = value;
  grid.className = editing ? "grid editing" : "grid";
  setHidden(editToolbar, !editing);
  editToggle.setAttribute("aria-pressed", String(editing));
  if (!editing && !layoutLocked) setLayoutStatus("");
  refreshLayout();
}

// --------------------------------------------------------------------------------------------- Profiles

const profileSelect = $("#profile-select");
const profileName = $("#profile-name");
const updateRate = $("#update-rate");

function renderProfileTools() {
  const options = [{ id: "default", name: "Default" }, ...layout.profiles].map(profile => {
    const option = create("option", "", profile.name);
    option.value = profile.id;
    return option;
  });
  profileSelect.replaceChildren(...options);
  profileSelect.value = editingProfile;
  profileName.value = getProfile(layout, editingProfile).name;
  profileName.disabled = editingProfile === "default";
  $("#profile-delete").disabled = editingProfile === "default";
  $("#profile-add").disabled = layout.profiles.length >= MAX_PROFILES;
  updateRate.value = String(layout.updates.intervalMillis);
}

updateRate.replaceChildren(...UPDATE_INTERVAL_CHOICES.map(millis => {
  const option = create("option", "", `${1000 / millis}× per second`);
  option.value = String(millis);
  return option;
}));
// The game picks up the new rate as soon as the layout is saved.
updateRate.addEventListener("change", () =>
  changeLayout({ ...layout, updates: { intervalMillis: Number(updateRate.value) } }));

profileSelect.addEventListener("change", () => {
  editingProfile = profileSelect.value;
  refreshLayout();
});
profileName.addEventListener("change", () => {
  if (editingProfile !== "default") changeLayout(renameProfile(layout, editingProfile, profileName.value.trim()));
});
$("#profile-add").addEventListener("click", () => {
  const added = addProfile(layout, `Profile ${layout.profiles.length + 1}`, editingProfile);
  editingProfile = added.id;
  changeLayout(added.layout);
});
$("#profile-delete").addEventListener("click", () => {
  if (editingProfile === "default") return;
  const removed = editingProfile;
  editingProfile = "default";
  changeLayout(removeProfile(layout, removed));
});

editToggle.addEventListener("click", () => setEditing(!editing));
$("#edit-done").addEventListener("click", () => setEditing(false));
$("#layout-reset").addEventListener("click", () => changeProfile(() => {
  const defaults = defaultLayout();
  return { tiles: defaults.tiles, settings: defaults.settings };
}));
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
  let imported;
  try {
    imported = normalizeLayout(JSON.parse(await file.text()));
  } catch (error) {
    setLayoutStatus(`That file is not a MinePanel layout (${error.message})`, true);
    return;
  }
  // Importing replaces a stored layout that couldn't be loaded; the mod keeps a copy of that file.
  layoutLocked = false;
  changeLayout(imported);
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
  const base = getProfile(layout, editingProfile);
  drag = { id, mode, base, metrics: gridMetrics(), tile: base.tiles.find(tile => tile.id === id),
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
  layout = withProfile(layout, editingProfile, placeTile(drag.base, drag.id, rect, true));
  applyLayout();
}

function endDrag() {
  if (!drag) return;
  tileElements[drag.id].classList.remove("dragging");
  const finished = drag;
  drag = undefined;
  if (finished.rect) {
    changeLayout(withProfile(layout, editingProfile, placeTile(finished.base, finished.id, finished.rect, false)));
  }
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

function scheduleReconnect() {
  if (pageHidden) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connect, RECONNECT_MILLIS);
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
      scheduleReconnect();
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
    scheduleReconnect();
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

// Effect timers count down and "recent" statistics expire between server updates.
window.setInterval?.(() => {
  tickEffects();
  if (displayedStatistics) renderStatistics(displayedStatistics);
  // Timed rule conditions ("advancement in the last 10 s", "in combat") expire without a game update.
  if (!editing) updateView();
  for (const hook of featureHooks.tick) hook();
}, 1000);

connect();
