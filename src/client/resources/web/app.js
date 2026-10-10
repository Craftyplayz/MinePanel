"use strict";

const connection = document.querySelector("#connection-status");
const dot = document.querySelector("#connection-dot");
const gameStatus = document.querySelector("#game-status");
const stateMessage = document.querySelector("#state-message");
const version = document.querySelector("#version");
const healthValue = document.querySelector("#health-value");
const sessionValue = document.querySelector("#session-value");
const dimensionValue = document.querySelector("#dimension-value");
const positionValue = document.querySelector("#position-value");
const inventoryStatus = document.querySelector("#inventory-status");
const heldValue = document.querySelector("#held-value");
const equipmentKeys = ["head", "chest", "legs", "feet", "offhand", "mainhand"];
const slotElements = Array.from({ length: 36 }, (_, index) => {
  const element = document.createElement("div");
  element.className = "inventory-slot";
  document.querySelector(index < 9 ? "#hotbar-slots" : "#main-slots").appendChild(element);
  return element;
});
const equipmentElements = equipmentKeys.map(key => {
  const element = document.createElement("div");
  element.className = "equipment-slot";
  document.querySelector("#equipment-slots").appendChild(element);
  return element;
});
let activeSocket;
let reconnectTimer;
let currentPlayerState;
let generation = 0;
let pageHidden = false;

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === "number" && Number.isFinite(value);
const validText = value => typeof value === "string" && value.length > 0 && value.length <= 256
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const validIdentifier = value => validText(value) && /^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(value);

function requireValid(condition) {
  if (!condition) throw new Error("Invalid dashboard message");
}

function validateItem(item) {
  requireValid(object(item) && typeof item.empty === "boolean"
    && (item.itemId === null || typeof item.itemId === "string")
    && (item.name === null || typeof item.name === "string")
    && integer(item.count) && item.count <= 1000000
    && integer(item.maxCount) && item.maxCount <= 1000000
    && ["damage", "maxDamage", "remainingDurability"].every(key =>
      item[key] === null || integer(item[key]))
    && Array.isArray(item.enchantments) && item.enchantments.length <= 64);
  const enchantments = item.enchantments.map(enchantment => {
    requireValid(object(enchantment) && validIdentifier(enchantment.id)
      && validText(enchantment.name) && integer(enchantment.level)
      && enchantment.level >= 1 && enchantment.level <= 255);
    return { id: enchantment.id, name: enchantment.name, level: enchantment.level };
  });
  requireValid(item.empty
    ? item.count === 0 && item.maxCount === 0 && item.itemId === null && item.name === null
      && item.damage === null && item.maxDamage === null && item.remainingDurability === null
      && enchantments.length === 0
    : validIdentifier(item.itemId) && validText(item.name) && item.count > 0 && item.maxCount > 0);
  requireValid(item.maxDamage === null
    ? item.damage === null && item.remainingDurability === null
    : item.maxDamage > 0 && item.damage !== null && item.damage <= item.maxDamage
      && item.remainingDurability === item.maxDamage - item.damage);
  return {
    empty: item.empty, itemId: item.itemId, name: item.name, count: item.count,
    maxCount: item.maxCount, damage: item.damage, maxDamage: item.maxDamage,
    remainingDurability: item.remainingDurability, enchantments
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

function validatePlayer(state) {
  requireValid(object(state) && state.schemaVersion === 1 && integer(state.revision)
    && integer(state.capturedAt) && typeof state.available === "boolean" && object(state.position)
    && has(state, "inventory"));
  if (state.available) {
    requireValid(state.inventory !== null && integer(state.sessionSeconds) && typeof state.dimension === "string"
      && ["x", "y", "z"].every(key => finite(state.position[key]))
      && ["health", "maxHealth", "absorption"].every(key => finite(state[key]) && state[key] >= 0));
  } else {
    requireValid(["sessionSeconds", "dimension", "health", "maxHealth", "absorption"]
      .every(key => state[key] === null)
      && ["x", "y", "z"].every(key => state.position[key] === null) && state.inventory === null);
  }
  return { ...state, inventory: validateInventory(state.inventory) };
}

function applyMessage(previous, message) {
  requireValid(object(message) && message.schemaVersion === 1
    && ["initial", "update"].includes(message.type) && object(message.state)
    && message.state.schemaVersion === 1);
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
    inventory: has(state, "inventory") ? patchInventory(previous.inventory, state.inventory) : previous.inventory
  };
  return validatePlayer(next);
}

function writeText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function itemText(item) {
  if (!item) return "Unavailable";
  if (item.empty) return "Empty";
  let text = `${item.name || item.itemId} · ${item.itemId} · ${item.count}/${item.maxCount}`;
  if (item.damage !== null || item.maxDamage !== null || item.remainingDurability !== null) {
    text += `\nDurability ${item.remainingDurability ?? "?"}/${item.maxDamage ?? "?"} · damage ${item.damage ?? "?"}`;
  }
  if (item.enchantments.length) {
    text += "\n" + item.enchantments.map(value => `${value.name} (${value.id}) ${value.level}`).join(" · ");
  }
  return text;
}

function renderInventory(inventory) {
  writeText(inventoryStatus, inventory ? `Slot ${inventory.selectedHotbarSlot + 1} selected` : "Unavailable");
  writeText(heldValue, inventory
    ? `Held · Hotbar ${inventory.selectedHotbarSlot + 1}: ${itemText(inventory.equipment.mainhand)}`
    : "Held item unavailable");
  slotElements.forEach((element, index) => {
    const selected = inventory && index === inventory.selectedHotbarSlot;
    const className = selected ? "inventory-slot selected" : "inventory-slot";
    if (element.className !== className) element.className = className;
    writeText(element, `${index < 9 ? "Hotbar" : "Main"} ${index < 9 ? index + 1 : index - 8}${selected ? " · Selected" : ""}\n${itemText(inventory?.slots[index])}`);
  });
  equipmentElements.forEach((element, index) =>
    writeText(element, `${equipmentKeys[index]}\n${itemText(inventory?.equipment[equipmentKeys[index]])}`));
}

function setConnection(online) {
  connection.textContent = online ? "Dashboard connected" : "Disconnected · reconnecting";
  dot.className = online ? "dot online" : "dot offline";
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remaining}s`;
}

function renderPlayer(player) {
  renderInventory(player?.available ? player.inventory : null);
  if (!player?.available) {
    gameStatus.textContent = "No active world";
    healthValue.textContent = "—";
    sessionValue.textContent = "—";
    dimensionValue.textContent = "—";
    positionValue.textContent = "Position unavailable";
    return;
  }
  gameStatus.textContent = "In world";
  healthValue.textContent = `${player.health} / ${player.maxHealth}${player.absorption > 0 ? ` (+${player.absorption})` : ""}`;
  sessionValue.textContent = formatDuration(player.sessionSeconds);
  dimensionValue.textContent = player.dimension || "Unknown";
  const pos = player.position;
  positionValue.textContent = pos ? `X ${pos.x.toFixed(1)} · Y ${pos.y.toFixed(1)} · Z ${pos.z.toFixed(1)}` : "Position unavailable";
}

function clearLiveData() {
  currentPlayerState = undefined;
  renderPlayer(null);
  gameStatus.textContent = "Unavailable";
  stateMessage.textContent = "Waiting for a fresh MinePanel snapshot.";
  version.textContent = "·";
}

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
        stateMessage.textContent = "Live read-only client telemetry.";
        renderPlayer(currentPlayerState);
        version.textContent = `v${message.modVersion || "0.1.0"}`;
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
