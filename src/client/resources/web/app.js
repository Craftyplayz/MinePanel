"use strict";

const connection = document.querySelector("#connection-status");
const dot = document.querySelector("#connection-dot");
const gameStatus = document.querySelector("#game-status");
const stateMessage = document.querySelector("#state-message");
const version = document.querySelector("#version");

function setConnection(online) {
  connection.textContent = online ? "Dashboard connected" : "Reconnecting";
  dot.className = online ? "dot online" : "dot offline";
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
        gameStatus.textContent = state.game === "connected" ? "In world" : "Unavailable";
        stateMessage.textContent = state.message;
        version.textContent = `v${state.modVersion || "0.1.0"}`;
      } catch {
        setConnection(false);
      }
    };

    await refresh();
    window.setInterval(refresh, 3000);
  } catch {
    setConnection(false);
    window.setTimeout(connect, 3000);
  }
}

connect();
