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

function setConnection(online) {
  connection.textContent = online ? "Dashboard connected" : "Disconnected · reconnecting";
  dot.className = online ? "dot online" : "dot offline";
  if (!online && gameStatus.dataset.received === "true") gameStatus.textContent = "Stale · disconnected";
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remaining}s`;
}

function renderPlayer(player) {
  if (!player?.available) {
    gameStatus.textContent = "No active world";
    healthValue.textContent = "—";
    sessionValue.textContent = "—";
    dimensionValue.textContent = "—";
    positionValue.textContent = "Position unavailable";
    return;
  }
  gameStatus.textContent = "In world";
  gameStatus.dataset.received = "true";
  healthValue.textContent = `${player.health} / ${player.maxHealth}${player.absorption > 0 ? ` (+${player.absorption})` : ""}`;
  sessionValue.textContent = formatDuration(player.sessionSeconds);
  dimensionValue.textContent = player.dimension || "Unknown";
  const pos = player.position;
  positionValue.textContent = pos ? `X ${pos.x.toFixed(1)} · Y ${pos.y.toFixed(1)} · Z ${pos.z.toFixed(1)}` : "Position unavailable";
}

async function connect() {
  try {
    const session = await fetch("/api/session", { cache: "no-store" });
    if (!session.ok) throw new Error("Local session unavailable");
    const { token } = await session.json();
    if (typeof token !== "string" || token.length !== 64) throw new Error("Invalid local session");

    const refresh = async () => {
      try {
        const response = await fetch("/api/state", {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store"
        });
        if (!response.ok) throw new Error("Local service unavailable");
        const state = await response.json();
        if (state.schemaVersion !== 1) throw new Error("Unsupported status version");
        setConnection(true);
        stateMessage.textContent = state.message;
        renderPlayer(state.player);
        version.textContent = `v${state.modVersion || "0.1.0"}`;
      } catch {
        setConnection(false);
      }
    };

    await refresh();
    window.setInterval(refresh, 500);
  } catch {
    setConnection(false);
    window.setTimeout(connect, 3000);
  }
}

connect();
