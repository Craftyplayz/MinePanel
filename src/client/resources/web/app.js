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
let activeSocket;
let reconnectTimer;
let currentPlayerState;

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
    const { websocketPort } = await session.json();
    if (!Number.isInteger(websocketPort) || websocketPort < 1 || websocketPort > 65535) {
      throw new Error("Invalid local session");
    }
    const socket = new WebSocket(`ws://127.0.0.1:${websocketPort}/ws`);
    activeSocket = socket;
    socket.addEventListener("open", () => setConnection(true), { once: true });
    socket.addEventListener("message", event => {
      try {
        const message = JSON.parse(event.data);
        if (message.schemaVersion !== 1 || !["initial", "update"].includes(message.type)
            || message.state?.schemaVersion !== 1) return;
        if (message.type === "initial") {
          currentPlayerState = message.state;
        } else {
          if (!currentPlayerState) return;
          currentPlayerState = {
            ...currentPlayerState,
            ...message.state,
            position: { ...currentPlayerState.position, ...message.state.position }
          };
        }
        setConnection(true);
        stateMessage.textContent = "Live read-only client telemetry.";
        renderPlayer(currentPlayerState);
        version.textContent = `v${message.modVersion || "0.1.0"}`;
      } catch {
        socket.close(1002, "Invalid dashboard message");
      }
    });
    socket.addEventListener("close", () => {
      setConnection(false);
      if (activeSocket === socket) {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    }, { once: true });
    socket.addEventListener("error", () => socket.close(), { once: true });
  } catch {
    setConnection(false);
    reconnectTimer = window.setTimeout(connect, 3000);
  }
}

window.addEventListener("pagehide", () => {
  window.clearTimeout(reconnectTimer);
  if (activeSocket) activeSocket.close();
});

connect();
