"use strict";

// Feature tiles and tools: movement, experience, recent pickups, Litematica build progress, advancements, villager
// trades, portal linking, item windows (shulker boxes, bundles, ender chest) and the layout rules editor. Shared
// helpers come from app.js; game maths and rule evaluation from rules.js.

const storage = {
  get(key) { try { return window.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set(key, value) { try { window.localStorage?.setItem(key, value); } catch { /* private mode */ } }
};

const formatCount = value => Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const DIMENSION_NAMES = { "minecraft:overworld": "the Overworld", "minecraft:the_nether": "the Nether",
  "minecraft:the_end": "the End" };
const dimensionName = id => DIMENSION_NAMES[id] ?? id;
const stopDrag = element => element.addEventListener("pointerdown", event => event.stopPropagation());

function formatAgo(millis) {
  const seconds = Math.max(0, Math.round(millis / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/** A duration estimate, e.g. "45 s", "12 min", "3 h 20 min"; "—" when unknown. */
function formatEta(seconds) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds > 999 * 3600) return "over 999 h";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round(seconds % 3600 / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

const formatWindow = seconds => seconds >= 3600 ? `${seconds / 3600} h` : seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`;
const playerPosition = player => player.position;

/**
 * Rotates an element to an angle by the shortest turn from where it points now, so the CSS transition swings
 * 359° → 1° across north instead of spinning all the way round.
 */
function rotateTo(element, degrees) {
  const current = element.rotation ?? degrees;
  element.rotation = current + ((degrees - current) % 360 + 540) % 360 - 180;
  element.style.transform = `rotate(${Math.round(element.rotation)}deg)`;
}

// ----------------------------------------------------------------------------------------------- Navigator

/**
 * Directions to a point: an arrow that turns as the player turns, the distance, and (optionally) whether the
 * target is above or below. Built once per container, then updated in place.
 */
function renderNavigator(container, { title, target, dimension, player, verticalThreshold, onClose }) {
  if (!container.navigator) {
    const head = create("div", "nav-head");
    const name = create("strong", "nav-title");
    const close = create("button", "icon-button", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close directions");
    close.addEventListener("click", () => container.navigator.onClose?.());
    head.appendChild(name);
    head.appendChild(close);
    const body = create("div", "nav-body");
    const dial = create("div", "nav-dial");
    const arrow = create("span", "nav-arrow");
    dial.appendChild(arrow);
    const info = create("div", "nav-info");
    const distance = create("span", "nav-distance");
    const vertical = create("span", "nav-vertical");
    const coordinates = create("span", "nav-coords");
    for (const part of [distance, vertical, coordinates]) info.appendChild(part);
    body.appendChild(dial);
    body.appendChild(info);
    container.replaceChildren(head, body);
    container.navigator = { name, arrow, distance, vertical, coordinates, dial };
  }
  const nav = container.navigator;
  nav.onClose = onClose;
  writeText(nav.name, title);
  writeText(nav.coordinates, `X ${Math.round(target.x)} · Z ${Math.round(target.z)}`
    + (verticalThreshold ? ` · Y ${Math.round(target.y)}` : ""));
  if (!player?.available || player.dimension !== dimension) {
    setHidden(nav.dial, true);
    writeText(nav.distance, player?.available ? `Go to ${dimensionName(dimension)} first` : "Not in a world");
    writeText(nav.vertical, "");
    return;
  }
  setHidden(nav.dial, false);
  const position = playerPosition(player);
  const distance = horizontalDistance(position, target);
  const bearing = bearingTo(position, target);
  rotateTo(nav.arrow, relativeBearing(player.motion.yaw, bearing));
  writeText(nav.distance, distance < 1.5 ? "You're here"
    : `${formatCount(distance)} blocks ${COMPASS_WORDS[compassPoint(bearing)]}`);
  const dy = target.y - position.y;
  const showVertical = verticalThreshold !== undefined && Math.abs(dy) > verticalThreshold;
  writeText(nav.vertical, showVertical ? `${dy > 0 ? "▲" : "▼"} ${Math.round(Math.abs(dy))} blocks ${dy > 0 ? "up" : "down"}` : "");
  nav.vertical.className = showVertical ? `nav-vertical ${dy > 0 ? "up" : "down"}` : "nav-vertical";
}

// ------------------------------------------------------------------------------------------- Portal linking

const portalLink = $("#portal-link");
const portalBox = $("#portal-box");
let portalOpenId = Number(storage.get("minepanel.portal")) || null;
let portalParts;

stopDrag(portalLink);
portalLink.addEventListener("click", () => {
  const crossing = currentPlayerState?.portal?.crossing;
  if (!crossing) return;
  portalOpenId = crossing.id;
  storage.set("minepanel.portal", String(portalOpenId));
  renderPortal(currentPlayerState);
});

function closePortal() {
  portalOpenId = null;
  storage.set("minepanel.portal", "");
  renderPortal(currentPlayerState);
}

function renderPortal(player) {
  const crossing = player?.available ? player.portal.crossing : null;
  const arrived = crossing !== null && player.dimension === crossing.toDimension;
  // A new portal trip replaces the old target, so a box opened for an older trip closes.
  const open = arrived && portalOpenId === crossing.id;
  setHidden(portalLink, !arrived || open);
  setHidden(portalBox, !open);
  if (!open) return;
  if (!portalParts) {
    const navigator = create("div", "navigator");
    const details = create("p", "portal-details");
    const status = create("p", "portal-status");
    portalBox.replaceChildren(navigator, details, status);
    portalParts = { navigator, details, status };
  }
  const { target, from, fromDimension, toDimension } = crossing;
  renderNavigator(portalParts.navigator, { title: `Build the portal in ${dimensionName(toDimension)}`, target,
    dimension: toDimension, player, onClose: closePortal });
  writeText(portalParts.details, `Matches the portal you entered in ${dimensionName(fromDimension)} at `
    + `X ${from.x} · Z ${from.z} (${fromDimension === "minecraft:overworld" ? "÷ 8" : "× 8"}). Height doesn't matter.`);
  const lit = player.portal.lit;
  const check = obsidianCheck(player.portal);
  let text;
  let state;
  if (lit) {
    text = `✓ A lit portal is within ${PORTAL_TOLERANCE} blocks of the target (X ${lit.x}, Y ${lit.y}, Z ${lit.z}). `
      + "It will link back to the portal you came through.";
    state = "ok";
  } else if (check) {
    text = check.ok
      ? `✓ Your last obsidian (X ${check.block.x}, Z ${check.block.z}) is ${check.distance.toFixed(1)} blocks from the target. Good spot.`
      : `✗ Your last obsidian (X ${check.block.x}, Z ${check.block.z}) is ${check.distance.toFixed(1)} blocks away. `
        + `Build it ${check.move} of there.`;
    state = check.ok ? "ok" : "bad";
  } else {
    text = `Place obsidian within ${PORTAL_TOLERANCE} blocks of the target and this checks it.`;
    state = "";
  }
  writeText(portalParts.status, text);
  portalParts.status.className = `portal-status ${state}`.trim();
}

// ------------------------------------------------------------------------------------------------ Movement

const movementSlot = createSlot($("#movement-icon"));
const movementParts = { mode: $("#movement-mode"), speed: $("#movement-speed"), facing: $("#movement-facing"),
  vertical: $("#movement-vertical"), glider: $("#movement-glider"), needle: $("#movement-needle") };
const MOVEMENT_LABELS = { ground: "On foot", elytra: "Elytra", swimming: "Swimming", riding: "Riding",
  flying: "Flying", falling: "Falling" };

function renderMovement(player) {
  const motion = player?.available ? player.motion : null;
  if (!motion) {
    renderSlot(movementSlot, null, false);
    writeText(movementParts.mode, "Unavailable");
    writeText(movementParts.speed, "—");
    writeText(movementParts.facing, "—");
    writeText(movementParts.vertical, "");
    writeText(movementParts.glider, "");
    return;
  }
  const settings = displaySettings().movement;
  renderSlot(movementSlot, motion.icon, false);
  writeText(movementParts.mode, MOVEMENT_LABELS[motion.mode]);
  writeText(movementParts.speed, `${motion.speed.toFixed(1)} blocks/s · ${(motion.speed * 3.6).toFixed(1)} km/h`);
  // Compass degrees: 0 = north, 90 = east (Minecraft's yaw has 0 = south).
  const heading = (motion.yaw + 180) % 360;
  writeText(movementParts.facing, `Facing ${COMPASS_WORDS[compassPoint(motion.yaw)]} · ${Math.round(heading)}°`);
  rotateTo(movementParts.needle, heading);
  const vertical = motion.verticalSpeed;
  writeText(movementParts.vertical, settings.showVertical && Math.abs(vertical) >= 0.1
    ? `${vertical > 0 ? "↑ Rising" : "↓ Falling"} ${Math.abs(vertical).toFixed(1)} blocks/s` : "");
  const glider = motion.glider;
  let gliderText = "";
  if (settings.showGlider && glider) {
    if (glider.maxDamage !== null) {
      // Elytra lose one durability per second of flight and stop working at 1 left.
      const seconds = Math.max(0, glider.remainingDurability - 1);
      gliderText = `${glider.name}: ${glider.remainingDurability}/${glider.maxDamage}`
        + (motion.mode === "elytra" ? ` · about ${formatEta(seconds)} of flight left` : "");
    } else {
      gliderText = glider.name;
    }
  }
  writeText(movementParts.glider, gliderText);
}

// -------------------------------------------------------------------------------------------------- Experience

const xpParts = { status: $("#xp-status"), level: $("#xp-level"), fill: $("#xp-fill"), rate: $("#xp-rate"),
  gained: $("#xp-gained"), next: $("#xp-next"), hundredLabel: $("#xp-hundred-label"), hundred: $("#xp-hundred"),
  window: $("#xp-window"), menu: $("#xp-window-menu"), form: $("#xp-form"), goal: $("#xp-goal"),
  goalError: $("#xp-goal-error"), goalList: $("#xp-goal-list"), goals: $("#xp-goals") };
let xpGoalNodes = [];
let xpGoalKey;

xpParts.menu.replaceChildren(...XP_WINDOW_CHOICES.map(seconds => {
  const choice = create("button", "chip small", formatWindow(seconds));
  choice.type = "button";
  choice.setAttribute("role", "menuitemradio");
  choice.dataset.window = String(seconds);
  stopDrag(choice);
  choice.addEventListener("click", () => {
    setHidden(xpParts.menu, true);
    changeSettings("xp", { window: seconds });
  });
  return choice;
}));
stopDrag(xpParts.window);
xpParts.window.addEventListener("click", () => setHidden(xpParts.menu, !xpParts.menu.hidden));

stopDrag($("#xp-settings"));
$("#xp-settings").addEventListener("click", () => {
  setHidden(xpParts.form, !xpParts.form.hidden);
  writeText(xpParts.goalError, "");
  renderXpSettings();
});
xpParts.form.addEventListener("submit", event => {
  event.preventDefault();
  const level = Number(xpParts.goal.value);
  const goals = displaySettings().xp.goals;
  if (!Number.isInteger(level) || level < 1 || level > MAX_XP_GOAL_LEVEL) {
    writeText(xpParts.goalError, `Enter a whole level from 1 to ${formatCount(MAX_XP_GOAL_LEVEL)}.`);
    return;
  }
  if (!goals.includes(level) && goals.length >= MAX_XP_GOALS) {
    writeText(xpParts.goalError, `At most ${MAX_XP_GOALS} goals; remove one first.`);
    return;
  }
  writeText(xpParts.goalError, "");
  xpParts.goal.value = "";
  changeSettings("xp", { goals: [...new Set([...goals, level])].sort((a, b) => a - b) });
});

function renderXpSettings() {
  const chips = displaySettings().xp.goals.map(level => {
    const chip = create("button", "chip small", `Level ${level} ×`);
    chip.type = "button";
    chip.title = "Remove this goal";
    chip.addEventListener("click", () =>
      changeSettings("xp", { goals: displaySettings().xp.goals.filter(value => value !== level) }));
    return chip;
  });
  xpParts.goalList.replaceChildren(...(chips.length ? [create("span", "", "Goals: "), ...chips] : []));
}

/** One fact row per custom goal level, rebuilt only when the goals change. */
function renderXpGoals(xp, perHour) {
  const goals = displaySettings().xp.goals;
  const key = goals.join(",");
  if (key !== xpGoalKey) {
    xpGoalKey = key;
    xpGoalNodes = goals.map(level => {
      const row = create("div");
      const value = create("dd", "", "—");
      row.appendChild(create("dt", "", `Goal · level ${level}`));
      row.appendChild(value);
      return { level, value, row };
    });
    xpParts.goals.replaceChildren(...xpGoalNodes.map(node => node.row));
    setHidden(xpParts.goals, !goals.length);
  }
  for (const { level, value } of xpGoalNodes) {
    if (!xp) {
      writeText(value, "—");
      continue;
    }
    const remaining = Math.max(0, xpAtLevel(level) - xp.points);
    writeText(value, remaining === 0 ? "Reached"
      : `${formatCount(remaining)} XP · ${formatEta(secondsToGain(remaining, perHour))}`);
  }
}

function renderXp(player) {
  const xp = player?.available ? player.xp : null;
  const span = displaySettings().xp.window;
  writeText(xpParts.window, formatWindow(span));
  for (const choice of xpParts.menu.children) {
    choice.setAttribute("aria-checked", String(choice.dataset.window === String(span)));
  }
  if (!xp) {
    writeText(xpParts.status, "Unavailable");
    writeText(xpParts.level, "—");
    xpParts.fill.style.width = "0%";
    writeText(xpParts.rate, "— XP/h");
    writeText(xpParts.gained, "");
    writeText(xpParts.next, "—");
    writeText(xpParts.hundred, "—");
    renderXpGoals(null, 0);
    return;
  }
  const perHour = xpPerHour(xp, span);
  writeText(xpParts.status, perHour > 0 ? "Gaining" : "Idle");
  writeText(xpParts.level, `Level ${xp.level}`);
  xpParts.fill.style.width = `${Math.round(xp.progress * 100)}%`;
  writeText(xpParts.rate, `${formatCount(perHour)} XP/h`);
  writeText(xpParts.gained, `+${formatCount(xp.gained[span])} XP in the last ${formatWindow(span)}`);
  const toNext = Math.max(0, Math.ceil(xpForNextLevel(xp.level) * (1 - xp.progress)));
  writeText(xpParts.next, `${formatCount(toNext)} XP · ${formatEta(secondsToGain(toNext, perHour))}`);
  const target = nextHundred(xp.level);
  const toHundred = Math.max(0, xpAtLevel(target) - xp.points);
  writeText(xpParts.hundredLabel, `Level ${target}`);
  writeText(xpParts.hundred, `${formatCount(toHundred)} XP · ${formatEta(secondsToGain(toHundred, perHour))}`);
  renderXpGoals(xp, perHour);
}

// ------------------------------------------------------------------------------------------------- Performance

const performanceParts = { status: $("#performance-status"), window: $("#performance-window"),
  menu: $("#performance-window-menu"), average: $("#performance-average"), low: $("#performance-low"),
  peak: $("#performance-peak"), line: $("#performance-line"), area: $("#performance-area"),
  lowLine: $("#performance-low-line") };
// The graph is drawn in a 1000 × 100 box stretched to the tile; the line keeps its width (non-scaling stroke).
const GRAPH_WIDTH = 1000;
const GRAPH_HEIGHT = 100;
const MAX_GRAPH_POINTS = 120;
let performanceKey;

performanceParts.menu.replaceChildren(...PERFORMANCE_WINDOW_CHOICES.map(seconds => {
  const choice = create("button", "chip small", formatWindow(seconds));
  choice.type = "button";
  choice.setAttribute("role", "menuitemradio");
  choice.dataset.window = String(seconds);
  stopDrag(choice);
  choice.addEventListener("click", () => {
    setHidden(performanceParts.menu, true);
    changeSettings("performance", { window: seconds });
  });
  return choice;
}));
stopDrag(performanceParts.window);
performanceParts.window.addEventListener("click", () => setHidden(performanceParts.menu, !performanceParts.menu.hidden));

/**
 * The last {@code window} seconds of frames per second as graph points, newest at x = 1. Long windows are averaged
 * into at most 120 points (10 minutes → one per 5 s), which keeps the line readable rather than a solid band.
 */
function performancePoints(fps, window) {
  const values = fps.slice(-window);
  const group = Math.ceil(window / MAX_GRAPH_POINTS);
  const points = [];
  for (let end = values.length; end > 0; end -= group) {
    const part = values.slice(Math.max(0, end - group), end);
    const age = values.length - end;
    points.unshift({ x: window > 1 ? 1 - age / (window - 1) : 1, y: part.reduce((sum, value) => sum + value, 0) / part.length });
  }
  return points;
}

/** A rounded graph ceiling just above the highest point: 60, 75, 150, 300... so the line rarely touches the top. */
function graphPeak(points) {
  const highest = Math.max(10, ...points.map(point => point.y)) * 1.1;
  const step = 10 ** Math.floor(Math.log10(highest));
  const nice = [1, 1.5, 2, 3, 5, 7.5, 10].find(factor => factor * step >= highest);
  return nice * step;
}

/**
 * A smooth SVG path through screen points (x increasing) using monotone cubic interpolation: curves between points
 * but never overshoots them, so the line cannot dip below 0 fps or invent peaks that did not happen.
 */
function smoothPath(points) {
  const f = value => Math.round(value * 10) / 10;
  if (points.length === 0) return "";
  if (points.length === 1) return `M${f(points[0].x)},${f(points[0].y)}h0`;
  const last = points.length - 1;
  const dx = [];
  const slope = [];
  for (let index = 0; index < last; index++) {
    dx.push(points[index + 1].x - points[index].x);
    slope.push((points[index + 1].y - points[index].y) / dx[index]);
  }
  const tangent = [slope[0]];
  for (let index = 1; index < last; index++) {
    const [before, after] = [slope[index - 1], slope[index]];
    tangent.push(before * after <= 0 ? 0 : 3 * (dx[index - 1] + dx[index])
      / ((2 * dx[index] + dx[index - 1]) / before + (dx[index] + 2 * dx[index - 1]) / after));
  }
  tangent.push(slope[last - 1]);
  let path = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let index = 0; index < last; index++) {
    const third = dx[index] / 3;
    const [from, to] = [points[index], points[index + 1]];
    path += `C${f(from.x + third)},${f(from.y + third * tangent[index])},${f(to.x - third)},`
      + `${f(to.y - third * tangent[index + 1])},${f(to.x)},${f(to.y)}`;
  }
  return path;
}

function renderPerformance(player) {
  const performance = player?.available ? player.performance : null;
  const span = displaySettings().performance.window;
  // Data arrives once a second; skip the redraw for updates that carried other fields.
  if (performanceKey?.performance === performance && performanceKey.span === span) return;
  performanceKey = { performance, span };
  writeText(performanceParts.window, formatWindow(span));
  for (const choice of performanceParts.menu.children) {
    choice.setAttribute("aria-checked", String(choice.dataset.window === String(span)));
  }
  const stats = performance?.windows[span] ?? null;
  if (!stats) {
    writeText(performanceParts.status, performance ? "Measuring" : "Unavailable");
    for (const part of [performanceParts.average, performanceParts.low, performanceParts.peak]) writeText(part, "—");
    performanceParts.line.setAttribute("d", "");
    performanceParts.area.setAttribute("d", "");
    setHidden(performanceParts.lowLine, true);
    return;
  }
  writeText(performanceParts.status, `${performance.fps.at(-1)} FPS`);
  writeText(performanceParts.average, `${stats.average} fps`);
  writeText(performanceParts.low, `${stats.low} fps`);
  const points = performancePoints(performance.fps, span);
  const peak = graphPeak(points);
  writeText(performanceParts.peak, `${formatCount(peak)} fps`);
  const toScreen = value => GRAPH_HEIGHT - value / peak * GRAPH_HEIGHT;
  const line = smoothPath(points.map(point => ({ x: point.x * GRAPH_WIDTH, y: toScreen(point.y) })));
  performanceParts.line.setAttribute("d", line);
  const start = Math.round(points[0].x * GRAPH_WIDTH * 10) / 10;
  performanceParts.area.setAttribute("d", `${line}L${GRAPH_WIDTH},${GRAPH_HEIGHT}L${start},${GRAPH_HEIGHT}Z`);
  const lowY = String(Math.round(toScreen(stats.low) * 10) / 10);
  performanceParts.lowLine.setAttribute("y1", lowY);
  performanceParts.lowLine.setAttribute("y2", lowY);
  setHidden(performanceParts.lowLine, false);
}

// ---------------------------------------------------------------------------------------------- Pickups

const pickupParts = { list: $("#pickups-list"), empty: $("#pickups-empty"), form: $("#pickups-form"),
  lifetime: $("#pickups-lifetime"), rows: $("#pickups-rows"), source: $("#pickups-source"),
  ignored: $("#pickups-ignored") };
let pickupNodes = new Map();
let pickupViewKey;

stopDrag($("#pickups-settings"));
$("#pickups-settings").addEventListener("click", () => {
  setHidden(pickupParts.form, !pickupParts.form.hidden);
  renderPickupSettings();
});
pickupParts.lifetime.addEventListener("change", () =>
  changeSettings("pickups", { lifetime: Number(pickupParts.lifetime.value) }));
pickupParts.rows.addEventListener("change", () => {
  const rows = Math.round(Number(pickupParts.rows.value));
  if (rows >= 1 && rows <= 32) changeSettings("pickups", { maxRows: rows });
});
pickupParts.source.addEventListener("change", () => changeSettings("pickups", { showSource: pickupParts.source.checked }));

function renderPickupSettings() {
  const settings = displaySettings().pickups;
  pickupParts.lifetime.value = String(settings.lifetime);
  pickupParts.rows.value = String(settings.maxRows);
  pickupParts.source.checked = settings.showSource;
  const chips = settings.ignored.map(id => {
    const chip = create("button", "chip small", `${id.replace(/^minecraft:/, "").replaceAll("_", " ")} ×`);
    chip.type = "button";
    chip.title = "Show this item again";
    chip.addEventListener("click", () =>
      changeSettings("pickups", { ignored: displaySettings().pickups.ignored.filter(value => value !== id) }));
    return chip;
  });
  pickupParts.ignored.replaceChildren(...(chips.length ? [create("span", "", "Hidden: "), ...chips] : []));
}

function renderPickups(player, now = Date.now()) {
  const settings = displaySettings().pickups;
  const visible = (player?.available ? player.pickups : []).slice().reverse()
    .filter(pickup => !settings.ignored.includes(pickup.item.itemId)
      && (settings.lifetime === 0 || now - pickup.at <= settings.lifetime * 1000))
    .slice(0, settings.maxRows);
  const retained = new Map();
  const rows = visible.map(pickup => {
    let node = pickupNodes.get(pickup.id);
    if (!node) {
      const row = create("div", "pickup-row");
      const slot = createSlot(row);
      const text = create("div", "pickup-text");
      const name = create("span", "pickup-name");
      const meta = create("span", "pickup-meta");
      text.appendChild(name);
      text.appendChild(meta);
      row.appendChild(text);
      const hide = create("button", "icon-button pickup-hide", "×");
      hide.type = "button";
      hide.setAttribute("aria-label", `Stop showing ${pickup.item.name}`);
      hide.title = `Stop showing ${pickup.item.name}`;
      hide.addEventListener("click", () => changeSettings("pickups",
        { ignored: [...displaySettings().pickups.ignored, pickup.item.itemId] }));
      row.appendChild(hide);
      node = { row, slot, name, meta };
    }
    retained.set(pickup.id, node);
    renderSlot(node.slot, { ...pickup.item, count: 1 }, false);
    writeText(node.name, `${pickup.count > 0 ? "+" : "−"}${formatCount(Math.abs(pickup.count))} ${pickup.item.name}`);
    node.row.classList.toggle("loss", pickup.count < 0);
    writeText(node.meta, (settings.showSource ? `${pickup.source} · ` : "") + formatAgo(now - pickup.at));
    return node.row;
  });
  pickupNodes = retained;
  const key = visible.map(pickup => pickup.id).join(",");
  if (key !== pickupViewKey) {
    pickupViewKey = key;
    pickupParts.list.replaceChildren(...rows);
  }
  writeText(pickupParts.empty, rows.length ? "" : "No inventory changes yet.");
}

// ------------------------------------------------------------------------------------------- Build progress

const buildParts = { status: $("#build-status"), name: $("#build-name"), progress: $("#build-progress"),
  count: $("#build-count"), bar: $("#build-bar"), fill: $("#build-fill"), notes: $("#build-notes"),
  message: $("#build-message"), materials: $("#build-materials"), list: $("#build-material-list") };
const BUILD_MESSAGES = {
  missing: "Install Litematica to see the progress of a schematic placement.",
  version: "This Litematica version is not supported; see the game log.",
  error: "Build progress stopped after an error; see the game log.",
  none: "No placement selected in Litematica.",
  counting: "Counting the schematic's blocks…"
};
let materialNodes = new Map();
let materialViewKey;

/** An item-shaped value for the shared slot renderer; kept per row so hovering keeps its tooltip. */
function materialItem(row, previous) {
  if (previous && previous.itemId === row.itemId && previous.name === row.name && previous.icon === row.icon) return previous;
  return { empty: false, itemId: row.itemId, name: row.name, count: 1, maxCount: 1, damage: null, maxDamage: null,
    remainingDurability: null, enchantments: [], icon: row.icon, foil: false,
    tooltip: [[{ text: row.name, color: null, format: "" }]], contents: null };
}

function renderMaterials(rows) {
  const retained = new Map();
  const nodes = rows.map(row => {
    let node = materialNodes.get(row.itemId);
    if (!node) {
      const element = create("div", "material-row");
      const slot = createSlot(element);
      node = { element, slot, name: create("span", "material-name"), left: create("span"), have: create("span"),
        need: create("span", "material-need") };
      for (const part of [node.name, node.left, node.have, node.need]) element.appendChild(part);
    }
    retained.set(row.itemId, node);
    node.item = materialItem(row, node.item);
    renderSlot(node.slot, node.item, false);
    const need = Math.max(0, row.left - row.have);
    writeText(node.name, row.name);
    writeText(node.left, formatCount(row.left));
    writeText(node.have, formatCount(row.have));
    writeText(node.need, need === 0 ? "✓" : formatCount(need));
    node.element.classList.toggle("covered", need === 0);
    node.element.setAttribute("aria-label",
      `${row.name}: ${formatCount(row.left)} left, ${formatCount(row.have)} carried, ${need === 0 ? "covered" : `${formatCount(need)} still needed`}`);
    return node.element;
  });
  materialNodes = retained;
  const key = rows.map(row => row.itemId).join(",");
  if (key !== materialViewKey) {
    materialViewKey = key;
    buildParts.list.replaceChildren(...nodes);
  }
}

function renderBuild(player) {
  const build = player?.available ? player.build : null;
  const placement = build?.placement ?? null;
  setHidden(buildParts.name, placement === null);
  setHidden(buildParts.progress, placement === null);
  setHidden(buildParts.materials, placement === null || build.materials.length === 0);
  if (placement === null) {
    writeText(buildParts.status, !build ? "Unavailable" : !build.available ? "Unavailable"
      : build.reason === "counting" ? "Counting" : "Idle");
    writeText(buildParts.message, build ? BUILD_MESSAGES[build.reason] : "Join a world to see build progress.");
    writeText(buildParts.notes, "");
    renderMaterials([]);
    return;
  }
  const { total, placed, wrong, extra, uncheckedChunks, scanComplete } = placement;
  const percent = total === 0 ? 100 : Math.floor(placed / total * 1000) / 10;
  writeText(buildParts.status, scanComplete ? (placed === total ? "Complete" : "Up to date") : "Scanning");
  writeText(buildParts.name, placement.name);
  writeText(buildParts.count, `${formatCount(placed)} / ${formatCount(total)} blocks · ${percent}%`);
  buildParts.fill.style.width = `${percent}%`;
  buildParts.bar.setAttribute("aria-valuenow", String(percent));
  const notes = [];
  if (wrong > 0) notes.push(`${formatCount(wrong)} wrong`);
  if (uncheckedChunks > 0) notes.push(`${formatCount(uncheckedChunks)} ${uncheckedChunks === 1 ? "chunk" : "chunks"} not checked yet (out of range)`);
  if (extra > 0) notes.push(`${formatCount(extra)} to clear`);
  writeText(buildParts.notes, notes.join(" · "));
  writeText(buildParts.message, placed === total ? "Nothing left to place." : "");
  renderMaterials(build.materials);
}

// --------------------------------------------------------------------------------------------- Advancements

const advancementParts = { status: $("#advancements-status"), tabs: $("#advancement-tabs"),
  list: $("#advancement-list"), empty: $("#advancements-empty"), filter: $("#advancement-filter"),
  form: $("#advancements-form"), seconds: $("#advancements-popup-seconds"), hiddenTabs: $("#advancements-hidden-tabs"),
  popup: $("#advancement-popup") };
const MAX_ADVANCEMENT_ROWS = 150;
let advancementKey;
let advancementNodes = new Map();
let lastAdvancementEventId;
let advancementPopupTimer;

stopDrag($("#advancements-settings"));
$("#advancements-settings").addEventListener("click", () => {
  setHidden(advancementParts.form, !advancementParts.form.hidden);
  renderAdvancementSettings();
});
advancementParts.seconds.addEventListener("change", () => {
  const seconds = Math.round(Number(advancementParts.seconds.value));
  if (seconds >= 0 && seconds <= 300) changeSettings("advancements", { popupSeconds: seconds });
});
advancementParts.filter.addEventListener("change", () => {
  advancementKey = undefined;
  renderAdvancements(currentPlayerState);
});

function renderAdvancementSettings() {
  const settings = displaySettings().advancements;
  advancementParts.seconds.value = String(settings.popupSeconds);
  const titles = new Map((currentPlayerState?.advancements?.tabs ?? []).map(tab => [tab.id, tab.title]));
  const chips = settings.hiddenTabs.map(id => {
    const chip = create("button", "chip small", `${titles.get(id) ?? id} ×`);
    chip.type = "button";
    chip.title = "Show this tab again";
    chip.addEventListener("click", () => changeSettings("advancements",
      { hiddenTabs: displaySettings().advancements.hiddenTabs.filter(value => value !== id) }));
    return chip;
  });
  advancementParts.hiddenTabs.replaceChildren(...(chips.length ? [create("span", "", "Hidden tabs: "), ...chips] : []));
}

/** An advancement shown like an item slot: its icon, with the title and description as the tooltip. */
function advancementItem(entry, secret) {
  return { empty: false, itemId: "minecraft:stone", name: secret ? "???" : entry.title, count: 1, maxCount: 1,
    damage: null, maxDamage: null, remainingDurability: null, enchantments: [], icon: secret ? null : entry.icon,
    foil: !secret && entry.foil, contents: null, tooltip: [[{ text: secret ? "???" : entry.title, color: null, format: "" }],
      [{ text: secret ? "Hidden advancement" : entry.description || " ", color: "#aaaaaa", format: "" }]] };
}

function renderAdvancements(player) {
  const all = player?.available ? player.advancements : null;
  if (!all) {
    writeText(advancementParts.status, "Unavailable");
    advancementParts.tabs.replaceChildren();
    advancementParts.list.replaceChildren();
    advancementKey = undefined;
    writeText(advancementParts.empty, player?.available ? "Waiting for the server to send advancements." : "");
    return;
  }
  const hiddenTabs = displaySettings().advancements.hiddenTabs;
  const advancements = { tabs: all.tabs.filter(tab => !hiddenTabs.includes(tab.id)),
    entries: all.entries.filter(entry => !hiddenTabs.includes(entry.tab)) };
  const done = advancements.entries.filter(entry => entry.done).length;
  writeText(advancementParts.status, `${done} / ${advancements.entries.length}`);
  const filter = advancementParts.filter.value || "closest";
  const key = JSON.stringify([filter, displaySettings().advancements.pinned, advancements]);
  if (key === advancementKey) return;
  advancementKey = key;
  const tabRow = tab => {
    const row = create("div", "advancement-tab");
    row.appendChild(create("span", "label", tab.title));
    const bar = create("span", "progress");
    const fill = create("span");
    fill.style.width = `${tab.total ? Math.round(tab.done / tab.total * 100) : 0}%`;
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(create("span", "count", `${tab.done}/${tab.total}`));
    return row;
  };
  const total = tabRow({ title: "All", done: advancements.tabs.reduce((sum, tab) => sum + tab.done, 0),
    total: advancements.tabs.reduce((sum, tab) => sum + tab.total, 0) });
  total.classList.add("advancement-total");
  advancementParts.tabs.replaceChildren(...(advancements.tabs.length ? [total] : []), ...advancements.tabs.map(tab => {
    const row = tabRow(tab);
    const hide = create("button", "icon-button advancement-tab-hide", "×");
    hide.type = "button";
    hide.setAttribute("aria-label", `Hide the ${tab.title} tab`);
    hide.title = `Hide the ${tab.title} tab`;
    hide.addEventListener("click", () => changeSettings("advancements",
      { hiddenTabs: [...displaySettings().advancements.hiddenTabs, tab.id] }));
    row.appendChild(hide);
    return row;
  }));
  const fraction = entry => entry.criteriaTotal ? entry.criteriaDone / entry.criteriaTotal : 0;
  let entries;
  if (filter === "done") {
    entries = advancements.entries.filter(entry => entry.done);
  } else if (filter === "remaining") {
    entries = advancements.entries.filter(entry => !entry.done);
  } else {
    entries = advancements.entries.filter(entry => !entry.done)
      .sort((a, b) => fraction(b) - fraction(a) || b.criteriaDone - a.criteriaDone || a.title.localeCompare(b.title));
  }
  // Pinned advancements stay at the top whatever the filter, in the order they were pinned.
  const pinned = displaySettings().advancements.pinned;
  const byId = new Map(advancements.entries.map(entry => [entry.id, entry]));
  entries = [...pinned.map(id => byId.get(id)).filter(Boolean), ...entries.filter(entry => !pinned.includes(entry.id))];
  const retained = new Map();
  const rows = entries.slice(0, MAX_ADVANCEMENT_ROWS).map(entry => {
    let node = advancementNodes.get(entry.id);
    if (!node) {
      const details = create("details", "advancement");
      const summary = create("summary");
      const slot = createSlot(summary);
      const text = create("span", "advancement-title");
      const progress = create("span", "advancement-progress");
      const pin = create("button", "icon-button advancement-pin", "📌");
      pin.type = "button";
      pin.addEventListener("click", event => {
        event.preventDefault();
        const current = displaySettings().advancements.pinned;
        changeSettings("advancements", { pinned: current.includes(entry.id)
          ? current.filter(id => id !== entry.id) : [...current, entry.id] });
      });
      summary.appendChild(text);
      summary.appendChild(progress);
      summary.appendChild(pin);
      details.appendChild(summary);
      const description = create("p", "advancement-description");
      const remaining = create("div", "advancement-remaining");
      details.appendChild(description);
      details.appendChild(remaining);
      node = { details, slot, text, progress, pin, description, remaining };
    }
    retained.set(entry.id, node);
    const secret = entry.hidden && !entry.done;
    const isPinned = pinned.includes(entry.id);
    node.details.dataset.frame = entry.frame;
    node.details.dataset.done = String(entry.done);
    node.details.dataset.pinned = String(isPinned);
    node.pin.setAttribute("aria-pressed", String(isPinned));
    node.pin.setAttribute("aria-label", isPinned ? "Unpin" : "Pin to the top");
    node.pin.title = isPinned ? "Unpin" : "Pin to the top";
    renderSlot(node.slot, advancementItem(entry, secret), false);
    writeText(node.text, secret ? "???" : entry.title);
    writeText(node.progress, entry.done ? "Done" : entry.criteriaTotal > 1 ? `${entry.criteriaDone}/${entry.criteriaTotal}` : "");
    writeText(node.description, secret ? "Hidden advancement: keep playing to reveal it." : entry.description);
    node.remaining.replaceChildren(...(secret ? [] : entry.remaining.map(name => create("span", "chip small static", name))));
    return node.details;
  });
  advancementNodes = retained;
  advancementParts.list.replaceChildren(...rows);
  writeText(advancementParts.empty, rows.length ? (entries.length > rows.length
    ? `Showing ${rows.length} of ${entries.length}.` : "") : filter === "done" ? "None done yet." : "All done!");
}

/** Pops up newly made advancements (not ones already in the log when the dashboard connected). */
function checkAdvancementPopup(player) {
  const events = player?.history?.events ?? [];
  const latest = events.length ? events.at(-1).id : 0;
  if (lastAdvancementEventId === undefined || player?.history?.sessionId !== checkAdvancementPopup.session) {
    checkAdvancementPopup.session = player?.history?.sessionId;
    lastAdvancementEventId = latest;
    return;
  }
  const fresh = events.filter(event => event.id > lastAdvancementEventId && event.category === "advancement");
  lastAdvancementEventId = Math.max(lastAdvancementEventId, latest);
  const seconds = displaySettings().advancements.popupSeconds;
  if (!fresh.length || seconds === 0) return;
  const event = fresh.at(-1);
  const title = create("strong", "", event.label);
  const details = create("span", "", event.details);
  advancementParts.popup.replaceChildren(title, details);
  setHidden(advancementParts.popup, false);
  window.clearTimeout(advancementPopupTimer);
  advancementPopupTimer = window.setTimeout(() => setHidden(advancementParts.popup, true), seconds * 1000);
}

// ------------------------------------------------------------------------------------------------ Villagers

const villagerParts = { status: $("#villagers-status"), list: $("#villager-list"), empty: $("#villagers-empty"),
  search: $("#villager-search"), nav: $("#villager-nav") };
const VILLAGER_LEVELS = ["Novice", "Apprentice", "Journeyman", "Expert", "Master"];
let villagerKey;
let villagerCards = new Map();
let villagerTarget = null;

villagerParts.search.addEventListener("input", () => renderVillagers(currentPlayerState));

const itemText = item => item === null ? "" : [item.name, item.itemId, ...item.enchantments.map(e => e.name),
  ...item.tooltip.map(line => line.map(segment => segment.text).join(""))].join(" ").toLowerCase();

function tradeRow(trade) {
  const row = create("div", trade.uses >= trade.maxUses ? "trade out" : "trade");
  const costs = create("span", "trade-costs");
  renderSlot(createSlot(costs), trade.costA, false);
  if (trade.costB) renderSlot(createSlot(costs), trade.costB, false);
  row.appendChild(costs);
  row.appendChild(create("span", "trade-arrow", "→"));
  renderSlot(createSlot(row), trade.result, false);
  row.appendChild(create("span", "trade-name", trade.result.enchantments.length
    ? trade.result.enchantments.map(e => `${e.name} ${ROMAN[e.level] ?? e.level}`).join(", ") : trade.result.name));
  if (trade.uses >= trade.maxUses) row.appendChild(create("span", "trade-stock", "Out of stock"));
  return row;
}

async function forgetVillager(uuid) {
  try {
    await fetch(`/api/villagers/${uuid}`, { method: "DELETE", cache: "no-store" });
  } catch {
    // The next snapshot shows whether it worked.
  }
  if (villagerTarget === uuid) villagerTarget = null;
  renderVillagers(currentPlayerState);
}

function renderVillagers(player) {
  const villagers = player?.available ? player.villagers : [];
  writeText(villagerParts.status, player?.available ? `${villagers.length} known` : "Unavailable");
  const query = villagerParts.search.value.trim().toLowerCase();
  const matching = villagers.map(villager => {
    const own = `${villager.professionName} ${villager.name ?? ""} ${VILLAGER_LEVELS[villager.level - 1]}`.toLowerCase();
    const trades = !query || own.includes(query) ? villager.trades
      : villager.trades.filter(trade => [trade.costA, trade.costB, trade.result].some(item => itemText(item).includes(query)));
    return { villager, trades };
  }).filter(entry => !query || entry.trades.length > 0);
  const position = player?.available ? player.position : null;
  const distanceTo = villager => position && villager.dimension === player.dimension
    ? horizontalDistance(position, villager) : Infinity;
  matching.sort((a, b) => distanceTo(a.villager) - distanceTo(b.villager) || b.villager.tradedAt - a.villager.tradedAt);
  const key = JSON.stringify([query, matching.map(entry => [entry.villager, entry.trades.length])]);
  if (key !== villagerKey) {
    villagerKey = key;
    const cards = new Map();
    villagerParts.list.replaceChildren(...matching.map(({ villager, trades }) => {
      const card = create("article", "villager");
      const head = create("div", "villager-head");
      const title = create("strong", "", `${villager.professionName} · ${VILLAGER_LEVELS[villager.level - 1]}`
        + (villager.name ? ` · “${villager.name}”` : ""));
      const where = create("span", "villager-where");
      const navigate = create("button", "chip small", "Navigate");
      navigate.type = "button";
      navigate.addEventListener("click", () => {
        villagerTarget = villager.uuid;
        renderVillagers(currentPlayerState);
      });
      const forget = create("button", "icon-button", "×");
      forget.type = "button";
      forget.title = "Forget this villager (it died or moved away)";
      forget.setAttribute("aria-label", "Forget this villager");
      forget.addEventListener("click", () => forgetVillager(villager.uuid));
      for (const part of [title, where, navigate, forget]) head.appendChild(part);
      card.appendChild(head);
      const list = create("div", "trades");
      list.replaceChildren(...trades.map(tradeRow));
      card.appendChild(list);
      cards.set(villager.uuid, { card, where });
      return card;
    }));
    villagerCards = cards;
  }
  for (const { villager } of matching) {
    const parts = villagerCards.get(villager.uuid);
    if (!parts) continue;
    const distance = distanceTo(villager);
    writeText(parts.where, Number.isFinite(distance)
      ? `${formatCount(distance)} m ${compassPoint(bearingTo(position, villager))} · seen ${formatAgo(Date.now() - villager.seenAt)}`
      : `In ${dimensionName(villager.dimension)}`);
  }
  writeText(villagerParts.empty, !player?.available ? "" : villagers.length === 0
    ? "Trade with a villager to remember its trades." : matching.length === 0 ? "No villager sells that." : "");
  const target = villagers.find(villager => villager.uuid === villagerTarget);
  if (!target) villagerTarget = null;
  setHidden(villagerParts.nav, !target);
  if (target) {
    renderNavigator(villagerParts.nav, { title: `${target.professionName}${target.name ? ` “${target.name}”` : ""}`,
      target, dimension: target.dimension, player, verticalThreshold: 5,
      onClose: () => { villagerTarget = null; renderVillagers(currentPlayerState); } });
  }
}

// ----------------------------------------------------------------------------------------------- Item windows

const windowsLayer = $("#windows");
const EQUIPMENT_INDEX = { 36: "head", 37: "chest", 38: "legs", 39: "feet", 40: "offhand" };
const enderChestButton = $("#enderchest-open");
/** Open item windows: {source, slot, pinned, x, y, element, parts}. One unpinned window at a time. */
let openWindows = [];

/** The item a window shows, or null when it is gone (moved, dropped, or not seen yet). */
function windowItem(player, source, slot) {
  if (!player?.available) return null;
  if (source === "enderchest") {
    return player.enderChest ? { name: "Ender Chest", contents: player.enderChest.slots, enderChest: true } : null;
  }
  if (source === "enderchest-item") return player.enderChest?.slots[slot] ?? null;
  return slot < 36 ? player.inventory.slots[slot] : player.inventory.equipment[EQUIPMENT_INDEX[slot]] ?? null;
}

function openItemWindow(source, slot, near) {
  const existing = openWindows.find(entry => entry.source === source && entry.slot === slot);
  if (existing) return renderWindows(currentPlayerState);
  openWindows = openWindows.filter(entry => entry.pinned);
  const x = Math.round(Math.max(8, Math.min((window.innerWidth ?? 1280) - 340, (near?.clientX ?? 120) + 12)));
  const y = Math.round(Math.max(52, Math.min((window.innerHeight ?? 800) - 200, (near?.clientY ?? 120) + 12)));
  openWindows.push({ source, slot, pinned: false, x, y });
  renderWindows(currentPlayerState);
}

function closeWindow(entry) {
  openWindows = openWindows.filter(value => value !== entry);
  if (entry.pinned) savePinned();
  renderWindows(currentPlayerState);
}

function savePinned() {
  changeLayout({ ...layout, pinned: openWindows.filter(entry => entry.pinned)
    .map(({ source, slot, x, y }) => ({ source, slot, x: Math.max(0, x), y: Math.max(0, y) })) });
}

/** Pinned windows come from the saved layout (on load, or after importing one). */
function syncPinnedWindows() {
  const saved = layout.pinned ?? [];
  const same = (a, b) => a.source === b.source && a.slot === b.slot;
  openWindows = [
    ...openWindows.filter(entry => !entry.pinned && !saved.some(pin => same(pin, entry))),
    ...saved.map(pin => {
      const open = openWindows.find(entry => entry.pinned && same(entry, pin));
      return open ? { ...open, x: pin.x, y: pin.y } : { ...pin, pinned: true };
    })
  ];
  renderWindows(currentPlayerState);
}

function buildWindow(entry) {
  const element = create("section", "float-window");
  const head = create("header", "float-head");
  const title = create("strong", "float-title");
  const pin = create("button", "icon-button", "📌");
  pin.type = "button";
  const close = create("button", "icon-button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  for (const part of [title, pin, close]) head.appendChild(part);
  const note = create("p", "float-note");
  const grid = create("div", "float-grid");
  element.appendChild(head);
  element.appendChild(note);
  element.appendChild(grid);
  pin.addEventListener("click", () => {
    entry.pinned = !entry.pinned;
    savePinned();
    renderWindows(currentPlayerState);
  });
  close.addEventListener("click", () => closeWindow(entry));
  let dragging;
  head.addEventListener("pointerdown", event => {
    if (event.target !== head && event.target !== title) return;
    dragging = { dx: event.clientX - entry.x, dy: event.clientY - entry.y };
    head.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
  head.addEventListener("pointermove", event => {
    if (!dragging) return;
    entry.x = Math.max(0, Math.round(event.clientX - dragging.dx));
    entry.y = Math.max(0, Math.round(event.clientY - dragging.dy));
    element.style.left = `${entry.x}px`;
    element.style.top = `${entry.y}px`;
  });
  const drop = () => {
    if (!dragging) return;
    dragging = undefined;
    if (entry.pinned) savePinned();
  };
  head.addEventListener("pointerup", drop);
  head.addEventListener("pointercancel", drop);
  entry.element = element;
  entry.parts = { title, pin, note, grid, slots: [] };
}

function renderWindows(player) {
  for (const entry of openWindows) {
    if (!entry.element) buildWindow(entry);
    const { title, pin, note, grid, slots } = entry.parts;
    const item = windowItem(player, entry.source, entry.slot);
    const current = item && !item.empty && Array.isArray(item.contents) ? item : null;
    if (current) entry.last = current;
    const shown = current ?? entry.last;
    writeText(title, shown?.name ?? (entry.source === "enderchest" ? "Ender Chest" : "Container"));
    pin.setAttribute("aria-pressed", String(entry.pinned));
    pin.title = entry.pinned ? "Unpin" : "Pin: keep this window open";
    entry.element.className = `float-window${entry.pinned ? " pinned" : ""}${current ? "" : " stale"}`;
    writeText(note, current ? (entry.source === "enderchest" ? `As of ${formatAgo(Date.now() - player.enderChest.seenAt)}` : "")
      : entry.source === "enderchest" ? "Open your ender chest in game to see its contents."
        : "Not in your inventory any more; showing what it last held.");
    const contents = shown?.contents ?? [];
    while (slots.length < contents.length) {
      const index = slots.length;
      const slot = createSlot(grid);
      slot.element.addEventListener("click", event => {
        // Shulker boxes inside the ender chest open their own window.
        if (entry.source === "enderchest" && Array.isArray(slot.item?.contents)) openItemWindow("enderchest-item", index, event);
      });
      slots.push(slot);
    }
    slots.forEach((slot, index) => {
      setHidden(slot.element, index >= contents.length);
      if (index < contents.length) renderSlot(slot, contents[index], false);
    });
    entry.element.style.left = `${entry.x}px`;
    entry.element.style.top = `${entry.y}px`;
  }
  const elements = openWindows.map(entry => entry.element);
  if (windowsLayer.children.length !== elements.length || elements.some((element, index) => windowsLayer.children[index] !== element)) {
    windowsLayer.replaceChildren(...elements);
  }
  setHidden(enderChestButton, !player?.available || !player.enderChest);
}

[...inventorySlots, ...equipmentSlots].forEach((slot, index) => {
  slot.element.addEventListener("click", event => {
    if (Array.isArray(slot.item?.contents) && !editing) openItemWindow("inventory", index, event);
  });
});
stopDrag(enderChestButton);
enderChestButton.addEventListener("click", event => openItemWindow("enderchest", 0, event));

/** Clicking elsewhere or pressing Escape closes the unpinned window (and the XP and performance window menus). */
function closeTransient(event) {
  const inside = element => element?.contains?.(event?.target);
  if (!event || !openWindows.some(entry => inside(entry.element)) && !event.target?.closest?.(".slot")) {
    if (openWindows.some(entry => !entry.pinned)) {
      openWindows = openWindows.filter(entry => entry.pinned);
      renderWindows(currentPlayerState);
    }
  }
  if (!event || !inside(xpParts.menu) && event.target !== xpParts.window) setHidden(xpParts.menu, true);
  if (!event || !inside(performanceParts.menu) && event.target !== performanceParts.window) {
    setHidden(performanceParts.menu, true);
  }
}

window.addEventListener("pointerdown", closeTransient);
window.addEventListener("keyup", event => { if (event.key === "Escape") closeTransient(); });

// ----------------------------------------------------------------------------------------------- Rules list

// Read-only until the rules side panel (docs/RULES_V2.md, phase 3) replaces this dialog.

const rulesDialog = $("#rules-dialog");
const rulesList = $("#rules-list");
const CONDITION_LABELS = { world: "Server / world", dimension: "Dimension", biome: "Biome", time: "Time of day",
  weather: "Weather", day: "Day", gameMode: "Game mode", nearPlace: "Near", yLevel: "Y level", health: "Health",
  food: "Hunger", saturation: "Saturation", absorption: "Absorption", xpLevel: "XP level", effect: "Status effect",
  movement: "Moving by", speed: "Speed", still: "Standing still", holding: "Holding", hasItem: "Has item",
  freeSlots: "Free slots", durability: "Durability", elytra: "Wearing elytra", xpGained: "Gained XP",
  pickedUp: "Picked up", statRose: "Statistic rose", minedBlock: "Mined", placedBlock: "Placed",
  killedMob: "Killed", tookDamage: "Took damage (hearts)", advancement: "Advancement earned", died: "Died",
  changedDimension: "Changed dimension", joinedWorld: "Joined the world", inCombat: "In combat",
  villagersNearby: "Known villagers nearby", portalLinking: "Linking a portal", toggle: "Toggle on",
  ruleActive: "Rule active", width: "Dashboard width (px)", realTime: "Real-world time",
  sessionTime: "Session time (min)", inGame: "In a world" };
const COMPARE_SYMBOLS = { "<": "<", "<=": "≤", "=": "=", ">=": "≥", ">": ">", "!=": "≠" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const describeCompare = value => value.compare === "between" ? `${value.value}–${value.value2}`
  : `${COMPARE_SYMBOLS[value.compare]} ${value.value}`;
const nameOf = (list, id) => list.find(entry => entry.id === id)?.name ?? id;

/** A When row's parameters as text, e.g. "≥ 3 within 16 blocks". */
function describeConditionParams(condition) {
  const parts = [];
  if (condition.values) parts.push(condition.values.join(", ") || "(none chosen)");
  if (condition.ticks) parts.push(`ticks ${condition.ticks.from}–${condition.ticks.to}`);
  for (const key of ["item", "stat", "block", "entity", "advancement"]) if (condition[key]) parts.push(condition[key]);
  if (condition.type === "nearPlace") {
    const where = condition.place ? nameOf(layout.places, condition.place)
      : `X ${condition.x} Y ${condition.y} Z ${condition.z}`;
    parts.push(condition.x2 === undefined ? `${condition.radius} blocks of ${where}${condition.flat ? " (flat)" : ""}`
      : `the box ${where} to X ${condition.x2} Y ${condition.y2} Z ${condition.z2}`);
  }
  if (condition.axis && condition.axis !== "total") parts.push(condition.axis);
  if (condition.target) parts.push(condition.target);
  if (condition.hand && condition.hand !== "either") parts.push(`${condition.hand} hand`);
  if (condition.compare) parts.push(describeCompare(condition));
  if (condition.level) parts.push(`level ${describeCompare(condition.level)}`);
  if (condition.remaining) parts.push(`${describeCompare(condition.remaining)} s left`);
  if (condition.enderChest) parts.push("incl. ender chest");
  if (condition.window) parts.push(`in the last ${condition.window} s`);
  if (condition.radius && condition.type === "villagersNearby") parts.push(`within ${condition.radius} blocks`);
  if (condition.minutes) parts.push(`for up to ${condition.minutes} min`);
  if (condition.toggle) parts.push(nameOf(layout.toggles, condition.toggle));
  if (condition.rule) parts.push(nameOf(layout.rules, condition.rule));
  if (condition.from) {
    parts.push(`${condition.from}–${condition.to}`);
    if (condition.days) parts.push(condition.days.map(day => WEEKDAYS[day]).join(", "));
  }
  return parts.join(" · ");
}

/** One When row as text, e.g. "not Dimension: nether · for ≥ 30 s". */
function describeCondition(condition) {
  const params = describeConditionParams(condition);
  let text = `${condition.not ? "not " : ""}${CONDITION_LABELS[condition.type]}${params ? `: ${params}` : ""}`;
  if (condition.for) text += ` · for ≥ ${condition.for} s`;
  if (condition.within) text += CONDITION_TYPES[condition.type].kind === "event"
    ? ` · in the last ${condition.within} s` : ` · within ${condition.within} s`;
  return text;
}

function describeAction(action) {
  const panel = TILE_LABELS[action.panel];
  switch (action.do) {
    case "profile":
      return `Switch to ${action.profile === "default" ? "Default" : nameOf(layout.profiles, action.profile)}`;
    case "show":
      return `Show ${panel}`;
    case "hide":
      return `Hide ${panel}${action.fill === "empty" ? " (leave empty)" : action.fill ? ` (${TILE_LABELS[action.fill]} fills)` : ""}`;
    case "place":
      return `Place ${panel} at column ${action.x + 1}, row ${action.y + 1}, ${action.w} × ${action.h}`;
    case "swap":
      return `Swap ${panel} and ${TILE_LABELS[action.with]}`;
    case "focus":
      return `Focus ${panel}`;
    case "set":
      return `Set ${panel} ${action.setting} to ${JSON.stringify(action.value)}`;
    case "notify":
      return `Notify “${action.text}”${action.cooldown ? ` (at most every ${action.cooldown} s)` : ""}`;
    default:
      return action.do;
  }
}

function actionList(title, actions) {
  const section = create("div", "rule-actions");
  section.appendChild(create("span", "rule-label", title));
  for (const action of actions) section.appendChild(create("p", "rule-condition", describeAction(action)));
  return section;
}

function ruleCard(rule) {
  const state = ruleEvaluation?.states.get(rule.id);
  const card = create("article", state?.active ? "rule active" : "rule");
  const head = create("div", "rule-head");
  head.appendChild(create("strong", "rule-name", rule.name));
  head.appendChild(create("span", state?.active ? "badge" : "badge muted",
    !rule.enabled ? "Disabled" : state?.active ? "Active now" : "Not active"));
  card.appendChild(head);
  const when = create("div", "rule-groups");
  when.appendChild(create("span", "rule-label", "When"));
  if (rule.when.length === 0) when.appendChild(create("p", "empty-note", "No conditions: this rule is never active."));
  rule.when.forEach((condition, index) => {
    if (index > 0) when.appendChild(create("span", condition.join === "or" ? "rule-or" : "rule-and", condition.join.toUpperCase()));
    const row = create("p", "rule-condition", describeCondition(condition));
    if (state?.conditions[index]) row.classList.add(state.conditions[index].ok ? "ok" : "bad");
    when.appendChild(row);
  });
  card.appendChild(when);
  card.appendChild(actionList("Then", rule.then));
  if (rule.else.length) card.appendChild(actionList("Else", rule.else));
  return card;
}

function setRulesDialog(open) {
  setHidden(rulesDialog, !open);
  if (open) renderRules();
}

function renderRules() {
  if (rulesDialog.hidden) return;
  rulesList.replaceChildren(...(layout.rules.length ? layout.rules.map(ruleCard)
    : [create("p", "empty-note", "No rules yet.")]));
}

$("#rules-open").addEventListener("click", () => setRulesDialog(true));
$("#rules-dialog-close").addEventListener("click", () => setRulesDialog(false));
rulesDialog.addEventListener("click", event => { if (event.target === rulesDialog) setRulesDialog(false); });

// ------------------------------------------------------------------------------------------------- Wiring

featureHooks.render.push(player => {
  renderPortal(player);
  renderMovement(player);
  renderXp(player);
  renderPerformance(player);
  renderPickups(player);
  renderBuild(player);
  renderAdvancements(player);
  checkAdvancementPopup(player);
  renderVillagers(player);
  renderWindows(player);
});
featureHooks.layout.push(() => {
  renderMovement(currentPlayerState);
  renderXp(currentPlayerState);
  renderXpSettings();
  renderPerformance(currentPlayerState);
  renderPickups(currentPlayerState);
  renderPickupSettings();
  renderBuild(currentPlayerState);
  renderAdvancements(currentPlayerState);
  renderAdvancementSettings();
  syncPinnedWindows();
});
featureHooks.tick.push(() => {
  renderPickups(currentPlayerState);
  renderRules();
});

// Panels that only appear on demand start hidden (the markup says so too).
for (const element of [xpParts.menu, performanceParts.menu, xpParts.form, pickupParts.form, advancementParts.form, advancementParts.popup, portalBox,
  villagerParts.nav, rulesDialog, enderChestButton, portalLink]) {
  setHidden(element, true);
}
featureHooks.layout.forEach(hook => hook());
