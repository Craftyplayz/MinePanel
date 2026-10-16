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
}

[...inventorySlots, ...equipmentSlots].forEach((slot, index) => {
  slot.element.addEventListener("click", event => {
    if (Array.isArray(slot.item?.contents) && !editing) openItemWindow("inventory", index, event);
  });
});
enderChestSlot.element.addEventListener("click", event => {
  if (enderChestSlot.item && !editing) openItemWindow("enderchest", 0, event);
});

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

// ---------------------------------------------------------------------------------------------- Rules editor

// A near-full-screen editor over the dashboard: the rule list (plus places, toggles and recent activity) on the
// left, the chosen rule's When / Then / Else on the right. Every edit is checked with normalizeLayout and saved at
// once; an edit that doesn't validate yet (say a half-typed number) stays here, shown as an error, until it does.
// Values re-render the editor only when its shape changes, so typing and clicking are never interrupted.

const rulesDialog = $("#rules-dialog");
const rulesSidebar = $("#rules-sidebar");
const rulesDetail = $("#rules-detail");
const rulesError = $("#rules-error");
const CONDITION_LABELS = { world: "Server / world", dimension: "Dimension", biome: "Biome", time: "Time of day",
  weather: "Weather", day: "Day", gameMode: "Game mode", nearPlace: "Near", yLevel: "Y level", health: "Health",
  food: "Hunger", saturation: "Saturation", absorption: "Absorption", xpLevel: "XP level", effect: "Status effect",
  movement: "Moving by", speed: "Speed", still: "Standing still", holding: "Holding", hasItem: "Has item",
  freeSlots: "Free slots", durability: "Durability", elytra: "Wearing elytra", xpGained: "Gained XP",
  pickedUp: "Picked up", statRose: "Statistic rose", minedBlock: "Mined", placedBlock: "Placed",
  killedMob: "Killed", tookDamage: "Took damage (hearts)", advancement: "Advancement earned", died: "Died",
  changedDimension: "Changed dimension", joinedWorld: "Joined the world", inCombat: "In combat",
  villagersNearby: "Known villagers nearby", portalLinking: "Linking a portal", toggle: "Toggle on",
  ruleActive: "Rule active", width: "Dashboard width", realTime: "Real-world time",
  sessionTime: "Session time", inGame: "In a world" };
const FAMILY_LABELS = { world: "World", position: "Position", player: "Player", inventory: "Inventory",
  amounts: "Amounts", events: "Events", villagers: "Villagers", features: "Features", meta: "Dashboard" };
const COMPARE_LABELS = { "<": "<", "<=": "≤", "=": "=", ">=": "≥", ">": ">", "!=": "≠", between: "between" };
const COMPARE_UNITS = { width: "px", sessionTime: "min", durability: "%", speed: "blocks/s", tookDamage: "hearts" };
const ACTION_LABELS = { profile: "Switch profile", show: "Show panel", hide: "Hide panel", place: "Place panel",
  swap: "Swap panels", focus: "Focus panel", set: "Set panel setting", notify: "Notify" };
const NAME_HINTS = { world: "world or server names", dimension: "e.g. nether, minecraft:the_end",
  biome: "e.g. minecraft:desert", effect: "e.g. minecraft:speed" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let rulesDraft = null;
let rulesCommitted = null;
let rulesSelection = null;
let liveRefs = { rules: new Map(), conditions: [], log: null };

/** The editable parts of the layout, copied so edits can be half-finished without touching the live layout. */
const draftOf = value => structuredCopy({ rules: value.rules, places: value.places, toggles: value.toggles,
  folders: value.folders });

/** Validates the draft and saves it; returns whether it was valid. */
function commitRules() {
  try {
    const next = normalizeLayout({ ...layout, ...rulesDraft });
    setHidden(rulesError, true);
    rulesCommitted = next;
    changeLayout(next);
    return true;
  } catch (error) {
    writeText(rulesError, `Not saved yet: ${error.message}`);
    setHidden(rulesError, false);
    return false;
  }
}

/** Applies a change to the draft, saves it and, if its shape changed, redraws the editor. */
function editRules(change, redraw = true) {
  change(rulesDraft);
  commitRules();
  if (redraw) renderRulesEditor();
  else renderRuleList();
}

const selectedRule = () => rulesSelection?.kind === "rule"
  ? rulesDraft.rules.find(rule => rule.id === rulesSelection.id) : null;

function newRuleId(name) {
  const used = new Set(rulesDraft.rules.map(rule => rule.id));
  return uniqueId(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "rule", used);
}

// --------------------------------------------------------------------------------------------- Controls

let focusKeys;

/** Remembers a control by a stable key so it gets focus back after a redraw. */
function keyed(element, key) {
  element.dataset.key = key;
  focusKeys.set(key, element);
  return element;
}

function field(labelText, control, className = "rule-field") {
  const label = create("label", className);
  if (labelText) label.appendChild(create("span", "rule-field-label", labelText));
  label.appendChild(control);
  return label;
}

function textInput(key, value, onChange, { placeholder = "", maxLength = 64, type = "text" } = {}) {
  const input = keyed(create("input", "rule-input"), key);
  input.type = type;
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

/** A number input; empty or non-numbers pass NaN on so validation reports them. */
function numberInput(key, value, onChange, { min, max, step = 1 } = {}) {
  const input = keyed(create("input", "rule-input number"), key);
  input.type = "number";
  input.value = value === undefined || Number.isNaN(value) ? "" : String(value);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = String(step);
  input.addEventListener("change", () => onChange(input.value.trim() === "" ? NaN : Number(input.value)));
  return input;
}

function selectInput(key, options, value, onChange) {
  const select = keyed(create("select", "rule-input"), key);
  for (const option of options) {
    if (option.group) {
      const group = create("optgroup");
      group.label = option.group;
      for (const [optionValue, text] of option.options) group.appendChild(optionElement(optionValue, text));
      select.appendChild(group);
    } else {
      select.appendChild(optionElement(option[0], option[1]));
    }
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function optionElement(value, text) {
  const option = create("option", "", text);
  option.value = value;
  return option;
}

function checkInput(key, labelText, checked, onChange) {
  const input = keyed(create("input"), key);
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  const label = create("label", "rule-check");
  label.appendChild(input);
  label.appendChild(create("span", "", labelText));
  return label;
}

function button(text, onClick, className = "button quiet small") {
  const element = create("button", className, text);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

/** Chips that pick any of a fixed list of values. */
function choiceChips(key, choices, values, onChange, labels = {}) {
  const box = create("span", "rule-chips");
  choices.forEach((choice, index) => {
    const chip = keyed(button(labels[choice] ?? String(choice), () => {
      const set = new Set(values);
      if (set.has(choice)) set.delete(choice);
      else set.add(choice);
      onChange(choices.filter(entry => set.has(entry)));
    }, "chip"), `${key}.${index}`);
    chip.setAttribute("aria-pressed", String(values.includes(choice)));
    box.appendChild(chip);
  });
  return box;
}

const splitList = text => text.split(",").map(entry => entry.trim()).filter(Boolean);

/** A compare row: the comparison, the value and, for "between", the upper value. */
function compareControls(key, target, onShape, unit) {
  const row = create("span", "rule-inline");
  row.appendChild(selectInput(`${key}.compare`, Object.entries(COMPARE_LABELS), target.compare, value => {
    const between = value === "between";
    editRules(() => {
      target.compare = value;
      if (between && target.value2 === undefined) target.value2 = target.value;
      if (!between) delete target.value2;
    }, onShape ?? true);
  }));
  row.appendChild(numberInput(`${key}.value`, target.value, value => editRules(() => { target.value = value; }, false),
    { step: "any" }));
  if (target.compare === "between") {
    row.appendChild(create("span", "rule-muted", "and"));
    row.appendChild(numberInput(`${key}.value2`, target.value2,
      value => editRules(() => { target.value2 = value; }, false), { step: "any" }));
  }
  if (unit) row.appendChild(create("span", "rule-muted", unit));
  return row;
}

// ------------------------------------------------------------------------------------------- Conditions

const player = () => currentPlayerState?.available ? currentPlayerState : null;

/** Fresh parameters for a condition type, keeping the row's join, "not" and timing modifier. */
function conditionWithType(previous, type) {
  const spec = CONDITION_TYPES[type];
  const condition = { type };
  if (previous?.join) condition.join = previous.join;
  if (previous?.not) condition.not = true;
  if (spec.kind === "event") condition.within = previous?.within ?? 10;
  else if (previous?.for !== undefined) condition.for = previous.for;
  else if (previous?.within !== undefined) condition.within = previous.within;
  const at = player()?.position;
  switch (spec.kind) {
    case "names":
    case "effect":
      return { ...condition, values: [] };
    case "choices":
      return { ...condition, values: [RULE_CHOICES[type][0]] };
    case "time":
      return { ...condition, values: ["night"] };
    case "compare":
      return { ...condition, compare: ">=", value: type === "width" ? 700 : 1 };
    case "speed":
      return { ...condition, axis: "total", compare: ">=", value: 5 };
    case "place":
      return { ...condition, x: Math.floor(at?.x ?? 0), y: Math.floor(at?.y ?? 64), z: Math.floor(at?.z ?? 0),
        radius: 16 };
    case "holding":
      return { ...condition, item: "minecraft:diamond_pickaxe", hand: "either" };
    case "hasItem":
      return { ...condition, item: "minecraft:torch", compare: "<", value: 16 };
    case "durability":
      return { ...condition, target: "held", compare: "<", value: 10 };
    case "amount":
      return { ...condition, ...(spec.required ? { stat: "minecraft:custom/minecraft:jump" } : {}),
        compare: ">=", value: 1, window: 10 };
    case "villagers":
      return { ...condition, radius: 16, compare: ">=", value: 3 };
    case "portal":
      return { ...condition, minutes: 10 };
    case "toggle":
      return { ...condition, toggle: rulesDraft.toggles[0]?.id ?? "" };
    case "rule":
      return { ...condition, rule: rulesDraft.rules.find(rule => rule.id !== rulesSelection?.id)?.id ?? "" };
    case "clock":
      return { ...condition, from: "09:00", to: "17:00" };
    default:
      return condition;
  }
}

const conditionTypeOptions = () => RULE_FAMILIES.map(family => ({ group: FAMILY_LABELS[family],
  options: Object.keys(CONDITION_TYPES).filter(type => CONDITION_TYPES[type].family === family)
    .map(type => [type, CONDITION_LABELS[type]]) }));

/** "+ current" for names: the world, dimension or biome the player is in now. */
function currentName(type) {
  const now = player();
  if (!now?.world) return null;
  return { world: now.world.name, dimension: now.dimension, biome: now.world.biome }[type] ?? null;
}

/** The parameter controls of one condition. */
function conditionControls(condition, key) {
  const spec = CONDITION_TYPES[condition.type];
  const box = create("div", "rule-params");
  const set = (name, redraw = false) => value => editRules(() => { condition[name] = value; }, redraw);
  const compare = () => compareControls(key, condition, true, COMPARE_UNITS[condition.type]);
  switch (spec.kind) {
    case "names": {
      box.appendChild(field("", textInput(`${key}.values`, condition.values.join(", "),
        value => editRules(() => { condition.values = splitList(value); }, false),
        { placeholder: `${NAME_HINTS[condition.type]}, separated by commas`, maxLength: 4000 }), "rule-field grow"));
      const current = currentName(condition.type);
      if (current) {
        box.appendChild(button(`+ ${current}`, () => editRules(() => {
          if (!condition.values.includes(current)) condition.values.push(current);
        })));
      }
      break;
    }
    case "choices":
      box.appendChild(choiceChips(`${key}.values`, RULE_CHOICES[condition.type], condition.values, set("values", true)));
      break;
    case "time": {
      const ticks = condition.ticks !== undefined;
      box.appendChild(selectInput(`${key}.mode`, [["periods", "Part of day"], ["ticks", "Tick range"]],
        ticks ? "ticks" : "periods", value => editRules(() => {
          if (value === "ticks") {
            delete condition.values;
            condition.ticks = { from: 13000, to: 23000 };
          } else {
            delete condition.ticks;
            condition.values = ["night"];
          }
        })));
      if (ticks) {
        box.appendChild(field("from", numberInput(`${key}.from`, condition.ticks.from,
          value => editRules(() => { condition.ticks.from = value; }, false), { min: 0, max: 23999 })));
        box.appendChild(field("to", numberInput(`${key}.to`, condition.ticks.to,
          value => editRules(() => { condition.ticks.to = value; }, false), { min: 0, max: 23999 })));
      } else {
        box.appendChild(choiceChips(`${key}.values`, RULE_CHOICES.time, condition.values, set("values", true)));
      }
      break;
    }
    case "compare":
      box.appendChild(compare());
      break;
    case "effect": {
      box.appendChild(field("", textInput(`${key}.values`, condition.values.join(", "),
        value => editRules(() => { condition.values = splitList(value); }, false),
        { placeholder: `${NAME_HINTS.effect}, separated by commas`, maxLength: 4000 }), "rule-field grow"));
      for (const [name, text] of [["level", "Level"], ["remaining", "Seconds left"]]) {
        box.appendChild(checkInput(`${key}.${name}.on`, text, condition[name] !== undefined, on => editRules(() => {
          if (on) condition[name] = { compare: ">=", value: 1 };
          else delete condition[name];
        })));
        if (condition[name]) box.appendChild(compareControls(`${key}.${name}`, condition[name]));
      }
      break;
    }
    case "speed":
      box.appendChild(selectInput(`${key}.axis`, RULE_CHOICES.axis.map(axis => [axis, axis]), condition.axis,
        set("axis")));
      box.appendChild(compare());
      break;
    case "place":
      placeControls(condition, key, box);
      break;
    case "holding":
      box.appendChild(field("item", textInput(`${key}.item`, condition.item, set("item"),
        { placeholder: "minecraft:diamond_pickaxe", maxLength: 256 })));
      box.appendChild(field("hand", selectInput(`${key}.hand`, RULE_CHOICES.hand.map(hand => [hand, hand]),
        condition.hand, set("hand"))));
      break;
    case "hasItem":
      box.appendChild(field("item", textInput(`${key}.item`, condition.item, set("item"),
        { placeholder: "minecraft:torch", maxLength: 256 })));
      box.appendChild(compare());
      box.appendChild(checkInput(`${key}.ender`, "incl. ender chest", condition.enderChest, value => editRules(() => {
        if (value) condition.enderChest = true;
        else delete condition.enderChest;
      }, false)));
      break;
    case "durability":
      box.appendChild(selectInput(`${key}.target`, RULE_CHOICES.durability.map(target => [target, target]),
        condition.target, set("target")));
      box.appendChild(compare());
      break;
    case "amount":
      if (spec.subject) {
        box.appendChild(field(spec.subject, textInput(`${key}.subject`, condition[spec.subject], value => editRules(() => {
          if (value.trim() || spec.required) condition[spec.subject] = value.trim();
          else delete condition[spec.subject];
        }, false), { placeholder: spec.required ? "minecraft:custom/minecraft:jump" : "any", maxLength: 256 })));
      }
      box.appendChild(compare());
      box.appendChild(field("in the last", numberInput(`${key}.window`, condition.window, set("window"),
        { min: 1, max: 3600 })));
      box.appendChild(create("span", "rule-muted", "s"));
      break;
    case "event":
      if (spec.subject) {
        box.appendChild(field(spec.subject, textInput(`${key}.subject`, condition[spec.subject], value => editRules(() => {
          if (value.trim()) condition[spec.subject] = value.trim();
          else delete condition[spec.subject];
        }, false), { placeholder: "any", maxLength: 256 })));
      }
      break;
    case "villagers":
      box.appendChild(compare());
      box.appendChild(field("within", numberInput(`${key}.radius`, condition.radius, set("radius"),
        { min: 1, max: 256 })));
      box.appendChild(create("span", "rule-muted", "blocks"));
      break;
    case "portal":
      box.appendChild(field("for up to", numberInput(`${key}.minutes`, condition.minutes, set("minutes"),
        { min: 1, max: 120 })));
      box.appendChild(create("span", "rule-muted", "min"));
      break;
    case "toggle":
      if (!rulesDraft.toggles.length) box.appendChild(create("span", "rule-muted", "Add a toggle under Toggles first."));
      else box.appendChild(selectInput(`${key}.toggle`, rulesDraft.toggles.map(toggle => [toggle.id, toggle.name]),
        condition.toggle, set("toggle")));
      break;
    case "rule": {
      const others = rulesDraft.rules.filter(rule => rule.id !== rulesSelection.id);
      if (!others.length) box.appendChild(create("span", "rule-muted", "There are no other rules yet."));
      else box.appendChild(selectInput(`${key}.rule`, others.map(rule => [rule.id, rule.name]), condition.rule,
        set("rule")));
      break;
    }
    case "clock":
      box.appendChild(field("from", textInput(`${key}.from`, condition.from, set("from"), { type: "time", maxLength: 5 })));
      box.appendChild(field("to", textInput(`${key}.to`, condition.to, set("to"), { type: "time", maxLength: 5 })));
      box.appendChild(choiceChips(`${key}.days`, [0, 1, 2, 3, 4, 5, 6], condition.days ?? [0, 1, 2, 3, 4, 5, 6],
        days => editRules(() => {
          if (days.length === 7 || days.length === 0) delete condition.days;
          else condition.days = days;
        }), Object.fromEntries(WEEKDAYS.map((day, index) => [index, day]))));
      break;
  }
  return box;
}

/** Near: a saved place or typed coordinates, then a radius or a box. */
function placeControls(condition, key, box) {
  const saved = condition.place !== undefined;
  const placeOptions = [["coords", "Coordinates"], ...rulesDraft.places.map(place => [place.id, place.name])];
  box.appendChild(selectInput(`${key}.place`, placeOptions, saved ? condition.place : "coords", value => editRules(() => {
    for (const name of ["place", "x", "y", "z", "world", "dimension"]) delete condition[name];
    if (value === "coords") Object.assign(condition, { x: 0, y: 64, z: 0 });
    else condition.place = value;
    if (condition.x2 !== undefined) {
      delete condition.x2; delete condition.y2; delete condition.z2;
      condition.radius = 16;
    }
  })));
  if (!saved) {
    for (const axis of ["x", "y", "z"]) {
      box.appendChild(field(axis.toUpperCase(), numberInput(`${key}.${axis}`, condition[axis],
        value => editRules(() => { condition[axis] = value; }, false), { step: "any" })));
    }
    const at = player()?.position;
    if (at) {
      box.appendChild(button("+ here", () => editRules(() => {
        Object.assign(condition, { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) });
        if (player().world) condition.world = player().world.name;
        condition.dimension = player().dimension;
      })));
    }
  }
  const box3d = condition.x2 !== undefined;
  if (!saved) {
    box.appendChild(selectInput(`${key}.shape`, [["radius", "within a radius"], ["box", "inside a box to"]],
      box3d ? "box" : "radius", value => editRules(() => {
        if (value === "box") {
          delete condition.radius; delete condition.flat;
          Object.assign(condition, { x2: condition.x + 10, y2: condition.y + 10, z2: condition.z + 10 });
        } else {
          delete condition.x2; delete condition.y2; delete condition.z2;
          condition.radius = 16;
        }
      })));
  }
  if (box3d) {
    for (const axis of ["x2", "y2", "z2"]) {
      box.appendChild(field(axis.toUpperCase(), numberInput(`${key}.${axis}`, condition[axis],
        value => editRules(() => { condition[axis] = value; }, false), { step: "any" })));
    }
  } else {
    box.appendChild(field("radius", numberInput(`${key}.radius`, condition.radius,
      value => editRules(() => { condition.radius = value; }, false), { min: 1, step: "any" })));
    box.appendChild(checkInput(`${key}.flat`, "ignore height", condition.flat, value => editRules(() => {
      if (value) condition.flat = true;
      else delete condition.flat;
    }, false)));
  }
  if (!saved && (condition.world !== undefined || condition.dimension !== undefined)) {
    box.appendChild(create("span", "rule-muted", `in ${[condition.world, condition.dimension].filter(Boolean).join(" · ")}`));
  }
}

/** The timing modifier: right away, held for N s, or (events and states) in the last N s. */
function modifierControls(condition, key) {
  const event = CONDITION_TYPES[condition.type].kind === "event";
  const row = create("span", "rule-inline");
  const mode = condition.for !== undefined ? "for" : condition.within !== undefined ? "within" : "now";
  if (event) {
    row.appendChild(create("span", "rule-muted", "in the last"));
  } else {
    row.appendChild(selectInput(`${key}.modifier`, [["now", "right now"], ["for", "for at least"],
      ["within", "at any time in the last"]], mode, value => editRules(() => {
      const seconds = condition.for ?? condition.within ?? 10;
      delete condition.for;
      delete condition.within;
      if (value !== "now") condition[value] = seconds;
    })));
  }
  if (mode !== "now") {
    row.appendChild(numberInput(`${key}.seconds`, condition[mode], value => editRules(() => { condition[mode] = value; },
      false), { min: 1, max: 3600 }));
    row.appendChild(create("span", "rule-muted", "s"));
  }
  return row;
}

function moveItem(list, index, by) {
  const target = index + by;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

function whenSection(rule) {
  const section = create("section", "rule-section");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", "When"));
  head.appendChild(create("span", "rule-muted",
    "Each row joins the one above with AND or OR. OR starts a new block; the rule matches when any block is all green."));
  section.appendChild(head);
  if (!rule.when.length) section.appendChild(create("p", "empty-note", "No conditions yet: this rule is never active."));
  let block;
  rule.when.forEach((condition, index) => {
    if (index === 0 || condition.join === "or") {
      if (index > 0) section.appendChild(create("div", "rule-or-divider", "OR"));
      block = create("div", "rule-block");
      section.appendChild(block);
    }
    const key = `when.${index}`;
    const row = create("div", "rule-row");
    const state = create("span", "rule-state");
    liveRefs.conditions.push({ index, row, state });
    const join = index === 0 ? create("span", "rule-join first", "IF")
      : selectInput(`${key}.join`, [["and", "AND"], ["or", "OR"]], condition.join ?? "and",
        value => editRules(() => { condition.join = value; }));
    if (index > 0) join.classList.add("rule-join");
    row.appendChild(join);
    row.appendChild(checkInput(`${key}.not`, "not", condition.not, value => editRules(() => {
      if (value) condition.not = true;
      else delete condition.not;
    }, false)));
    row.appendChild(selectInput(`${key}.type`, conditionTypeOptions(), condition.type,
      value => editRules(() => { rule.when[index] = conditionWithType(condition, value); })));
    row.appendChild(conditionControls(condition, key));
    row.appendChild(modifierControls(condition, key));
    row.appendChild(state);
    row.appendChild(rowTools(rule.when, index, `${key}`));
    block.appendChild(row);
  });
  const add = create("div", "rule-add");
  add.appendChild(button("+ AND condition", () => editRules(() => {
    rule.when.push(conditionWithType({ join: "and" }, "dimension"));
  }), "button small"));
  if (rule.when.length) {
    add.appendChild(button("+ OR condition", () => editRules(() => {
      rule.when.push(conditionWithType({ join: "or" }, "dimension"));
    }), "button quiet small"));
  }
  section.appendChild(add);
  return section;
}

/** Move up / down and delete for one row of a list. */
function rowTools(list, index, key) {
  const tools = create("span", "rule-row-tools");
  const up = keyed(button("↑", () => editRules(() => moveItem(list, index, -1))), `${key}.up`);
  up.title = "Move up";
  up.disabled = index === 0;
  const down = keyed(button("↓", () => editRules(() => moveItem(list, index, 1))), `${key}.down`);
  down.title = "Move down";
  down.disabled = index === list.length - 1;
  const remove = keyed(button("✕", () => editRules(() => list.splice(index, 1))), `${key}.remove`);
  remove.title = "Remove";
  tools.appendChild(up);
  tools.appendChild(down);
  tools.appendChild(remove);
  return tools;
}

// ---------------------------------------------------------------------------------------------- Actions

const panelOptions = (exclude) => TILE_IDS.filter(id => id !== exclude).map(id => [id, TILE_LABELS[id]]);
const settingKeys = panel => SETTING_RULES.filter(([tile]) => tile === panel).map(([, key]) => key);
const firstSettingPanel = () => TILE_IDS.find(id => settingKeys(id).length);

function actionWithType(type, previous) {
  const panel = previous?.panel && TILE_IDS.includes(previous.panel) ? previous.panel : "xp";
  switch (type) {
    case "profile":
      return { do: "profile", profile: layout.profiles[0]?.id ?? "default" };
    case "place": {
      const minimum = TILE_MINIMUMS[panel];
      return { do: "place", panel, x: 0, y: 0, w: Math.max(4, minimum.w), h: Math.max(4, minimum.h) };
    }
    case "swap":
      return { do: "swap", panel, with: TILE_IDS.find(id => id !== panel) };
    case "set": {
      const tile = settingKeys(panel).length ? panel : firstSettingPanel();
      return settingAction(tile, settingKeys(tile)[0]);
    }
    case "notify":
      return { do: "notify", text: "Rule active", cooldown: 0 };
    default:
      return { do: type, panel };
  }
}

/** A "set" action with the setting's default value. */
function settingAction(panel, setting) {
  return { do: "set", panel, setting, value: structuredCopy(defaultSettings()[panel][setting]) };
}

function settingValueControl(action, key) {
  const value = action.value;
  const change = next => editRules(() => { action.value = next; }, false);
  const choices = { xp: { window: XP_WINDOW_CHOICES }, performance: { window: PERFORMANCE_WINDOW_CHOICES } }
    [action.panel]?.[action.setting];
  if (choices) return selectInput(`${key}.value`, choices.map(choice => [String(choice), `${choice} s`]),
    String(value), next => change(Number(next)));
  if (typeof value === "boolean") return checkInput(`${key}.value`, "on", value, change);
  if (typeof value === "number") return numberInput(`${key}.value`, value, change, { min: 0 });
  if (Array.isArray(value)) {
    const numbers = action.panel === "xp";
    return textInput(`${key}.value`, value.join(", "), text => change(splitList(text)
      .map(entry => numbers ? Number(entry) : entry)), { placeholder: "comma separated", maxLength: 8000 });
  }
  return textInput(`${key}.value`, value, change, { maxLength: 200 });
}

function actionParams(action, key) {
  const box = create("div", "rule-params");
  const set = (name, redraw = false) => value => editRules(() => { action[name] = value; }, redraw);
  const panel = (onChange = set("panel")) => selectInput(`${key}.panel`, panelOptions(), action.panel, onChange);
  switch (action.do) {
    case "profile":
      box.appendChild(selectInput(`${key}.profile`, [["default", "Default"],
        ...layout.profiles.map(profile => [profile.id, profile.name])], action.profile, set("profile")));
      break;
    case "show":
    case "focus":
      box.appendChild(panel());
      break;
    case "hide":
      box.appendChild(panel(value => editRules(() => {
        action.panel = value;
        if (action.fill === value) delete action.fill;
      })));
      box.appendChild(field("space", selectInput(`${key}.fill`, [["auto", "neighbours fill it"],
        ["empty", "leave empty"], ...panelOptions(action.panel).map(([id, label]) => [id, `${label} fills it`])],
      action.fill ?? "auto", value => editRules(() => {
        if (value === "auto") delete action.fill;
        else action.fill = value;
      }, false))));
      break;
    case "place":
      box.appendChild(panel(value => editRules(() => {
        action.panel = value;
        action.w = Math.max(action.w, TILE_MINIMUMS[value].w);
        action.h = Math.max(action.h, TILE_MINIMUMS[value].h);
      })));
      for (const [name, label, offset] of [["x", "column", 1], ["y", "row", 1], ["w", "width", 0], ["h", "height", 0]]) {
        box.appendChild(field(label, numberInput(`${key}.${name}`, action[name] + offset,
          value => editRules(() => { action[name] = value - offset; }, false), { min: 1 })));
      }
      break;
    case "swap":
      box.appendChild(panel(value => editRules(() => {
        action.panel = value;
        if (action.with === value) action.with = TILE_IDS.find(id => id !== value);
      })));
      box.appendChild(create("span", "rule-muted", "with"));
      box.appendChild(selectInput(`${key}.with`, panelOptions(action.panel), action.with, set("with")));
      break;
    case "set":
      box.appendChild(selectInput(`${key}.panel`, TILE_IDS.filter(id => settingKeys(id).length)
        .map(id => [id, TILE_LABELS[id]]), action.panel,
      value => editRules(list => { Object.assign(action, settingAction(value, settingKeys(value)[0])); })));
      box.appendChild(selectInput(`${key}.setting`, settingKeys(action.panel).map(setting => [setting, setting]),
        action.setting, value => editRules(() => { Object.assign(action, settingAction(action.panel, value)); })));
      box.appendChild(create("span", "rule-muted", "to"));
      box.appendChild(settingValueControl(action, key));
      break;
    case "notify":
      box.appendChild(field("", textInput(`${key}.text`, action.text, set("text"), { maxLength: 128 }), "rule-field grow"));
      box.appendChild(field("at most every", numberInput(`${key}.cooldown`, action.cooldown, set("cooldown"),
        { min: 0, max: 3600 })));
      box.appendChild(create("span", "rule-muted", "s"));
      break;
  }
  return box;
}

function actionSection(rule, list, title, note) {
  const section = create("section", "rule-section");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", title));
  head.appendChild(create("span", "rule-muted", note));
  section.appendChild(head);
  if (!rule[list].length) section.appendChild(create("p", "empty-note", "No actions."));
  rule[list].forEach((action, index) => {
    const key = `${list}.${index}`;
    const row = create("div", "rule-row");
    row.appendChild(selectInput(`${key}.do`, ACTION_TYPES.map(type => [type, ACTION_LABELS[type]]), action.do,
      value => editRules(() => { rule[list][index] = actionWithType(value, action); })));
    row.appendChild(actionParams(action, key));
    row.appendChild(rowTools(rule[list], index, key));
    section.appendChild(row);
  });
  const add = create("div", "rule-add");
  add.appendChild(button("+ Action", () => editRules(() => { rule[list].push(actionWithType("show")); }),
    "button small"));
  section.appendChild(add);
  return section;
}

// ------------------------------------------------------------------------------------------------ Panels

function ruleDetail(rule) {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-detail-head");
  head.appendChild(field("Name", textInput("rule.name", rule.name, value => editRules(() => {
    rule.name = value.trim().slice(0, 64);
  }, false)), "rule-field grow"));
  head.appendChild(checkInput("rule.enabled", "Enabled", rule.enabled, value => editRules(() => {
    rule.enabled = value;
  }, false)));
  const index = rulesDraft.rules.indexOf(rule);
  head.appendChild(button("Duplicate", () => editRules(() => {
    const copy = { ...structuredCopy(rule), id: newRuleId(`${rule.name} copy`), name: `${rule.name} (copy)`.slice(0, 64) };
    rulesDraft.rules.splice(index + 1, 0, copy);
    rulesSelection = { kind: "rule", id: copy.id };
  })));
  head.appendChild(button("Delete", () => editRules(() => {
    rulesDraft.rules.splice(index, 1);
    for (const other of rulesDraft.rules) {
      other.when = other.when.filter(condition => !(condition.type === "ruleActive" && condition.rule === rule.id));
    }
    const next = rulesDraft.rules[Math.min(index, rulesDraft.rules.length - 1)];
    rulesSelection = next ? { kind: "rule", id: next.id } : null;
  }), "button quiet small danger"));
  box.appendChild(head);
  box.appendChild(whenSection(rule));
  box.appendChild(actionSection(rule, "then", "Then", "Applies while the rule is active."));
  box.appendChild(actionSection(rule, "else", "Else", "Applies while the rule is enabled but not active."));
  const timing = create("section", "rule-section");
  const timingHead = create("div", "rule-section-head");
  timingHead.appendChild(create("h3", "", "Timing"));
  timingHead.appendChild(create("span", "rule-muted",
    "Delay: how long the When list must match first. Linger: how long the rule stays active after it stops matching."));
  timing.appendChild(timingHead);
  const row = create("div", "rule-row");
  for (const [name, label, min] of [["delayMs", "Delay", 0], ["lingerMs", "Linger", 0.5]]) {
    row.appendChild(field(label, numberInput(`rule.${name}`, rule.timing[name] / 1000,
      value => editRules(() => { rule.timing[name] = Math.round(value * 1000); }, false),
      { min, max: 600, step: 0.1 })));
    row.appendChild(create("span", "rule-muted", "s"));
  }
  timing.appendChild(row);
  box.appendChild(timing);
  return box;
}

function placesDetail() {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", "Places"));
  head.appendChild(create("span", "rule-muted", "Saved spots for “Near” conditions. A place only counts in the world and dimension it was saved in."));
  box.appendChild(head);
  if (!rulesDraft.places.length) box.appendChild(create("p", "empty-note", "No places yet."));
  rulesDraft.places.forEach((place, index) => {
    const key = `place.${index}`;
    const row = create("div", "rule-row");
    row.appendChild(field("Name", textInput(`${key}.name`, place.name, value => editRules(() => { place.name = value.trim(); }, false))));
    for (const axis of ["x", "y", "z"]) {
      row.appendChild(field(axis.toUpperCase(), numberInput(`${key}.${axis}`, place[axis],
        value => editRules(() => { place[axis] = value; }, false), { step: "any" })));
    }
    row.appendChild(create("span", "rule-muted", `${place.world} · ${place.dimension}`));
    const remove = button("✕", () => editRules(() => {
      rulesDraft.places.splice(index, 1);
      for (const rule of rulesDraft.rules) {
        rule.when = rule.when.filter(condition => condition.place !== place.id);
      }
    }));
    remove.title = "Remove (and the conditions that use it)";
    row.appendChild(remove);
    box.appendChild(row);
  });
  const now = player();
  const add = create("div", "rule-add");
  const addButton = button("+ Current position", () => editRules(() => {
    const used = new Set(rulesDraft.places.map(place => place.id));
    const name = `Place ${rulesDraft.places.length + 1}`;
    rulesDraft.places.push({ id: uniqueId(`place-${rulesDraft.places.length + 1}`, used), name,
      world: now.world.name.slice(0, 128), dimension: now.dimension,
      x: Math.floor(now.position.x), y: Math.floor(now.position.y), z: Math.floor(now.position.z) });
  }), "button small");
  addButton.disabled = !now?.world || !now.position;
  if (addButton.disabled) addButton.title = "Join a world first";
  add.appendChild(addButton);
  box.appendChild(add);
  return box;
}

function togglesDetail() {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", "Toggles"));
  head.appendChild(create("span", "rule-muted", "Switches you flip by hand, for “Toggle on” conditions."));
  box.appendChild(head);
  if (!rulesDraft.toggles.length) box.appendChild(create("p", "empty-note", "No toggles yet."));
  rulesDraft.toggles.forEach((toggle, index) => {
    const key = `toggle.${index}`;
    const row = create("div", "rule-row");
    row.appendChild(field("Name", textInput(`${key}.name`, toggle.name, value => editRules(() => {
      toggle.name = value.trim().slice(0, 32);
    }, false), { maxLength: 32 })));
    row.appendChild(checkInput(`${key}.on`, "On", toggle.on, value => editRules(() => { toggle.on = value; }, false)));
    const remove = button("✕", () => editRules(() => {
      rulesDraft.toggles.splice(index, 1);
      for (const rule of rulesDraft.rules) {
        rule.when = rule.when.filter(condition => !(condition.type === "toggle" && condition.toggle === toggle.id));
      }
    }));
    remove.title = "Remove (and the conditions that use it)";
    row.appendChild(remove);
    box.appendChild(row);
  });
  const add = create("div", "rule-add");
  const addButton = button("+ Toggle", () => editRules(() => {
    const used = new Set(rulesDraft.toggles.map(toggle => toggle.id));
    const number = rulesDraft.toggles.length + 1;
    rulesDraft.toggles.push({ id: uniqueId(`toggle-${number}`, used), name: `Toggle ${number}`, on: false });
  }), "button small");
  addButton.disabled = rulesDraft.toggles.length >= MAX_TOGGLES;
  add.appendChild(addButton);
  box.appendChild(add);
  return box;
}

/** The left column: rules in priority order, then places, toggles and recent activity. */
function renderRuleList() {
  liveRefs.rules = new Map();
  const list = create("div", "rules-nav");
  const head = create("div", "rules-nav-head");
  head.appendChild(create("span", "rule-label", "Rules"));
  const add = button("+ New rule", () => editRules(() => {
    const id = newRuleId(`rule-${rulesDraft.rules.length + 1}`);
    rulesDraft.rules.push({ id, name: `Rule ${rulesDraft.rules.length + 1}`, enabled: true, folder: null, when: [],
      then: [], else: [], timing: { ...DEFAULT_TIMING }, animation: null });
    rulesSelection = { kind: "rule", id };
  }), "button small");
  add.disabled = rulesDraft.rules.length >= MAX_RULES;
  head.appendChild(add);
  list.appendChild(head);
  list.appendChild(create("p", "rule-muted", "Higher rules win when two change the same thing."));
  if (!rulesDraft.rules.length) list.appendChild(create("p", "empty-note", "No rules yet."));
  rulesDraft.rules.forEach((rule, index) => {
    const selected = rulesSelection?.kind === "rule" && rulesSelection.id === rule.id;
    const item = create("div", selected ? "rules-nav-item selected" : "rules-nav-item");
    const dot = create("span", "rule-dot");
    liveRefs.rules.set(rule.id, dot);
    const name = keyed(button(rule.name || "(unnamed)", () => {
      rulesSelection = { kind: "rule", id: rule.id };
      renderRulesEditor();
    }, "rules-nav-name"), `nav.${rule.id}`);
    if (!rule.enabled) name.classList.add("disabled");
    const up = button("↑", () => editRules(() => moveItem(rulesDraft.rules, index, -1)), "button quiet tiny");
    up.title = "Higher priority";
    up.disabled = index === 0;
    const down = button("↓", () => editRules(() => moveItem(rulesDraft.rules, index, 1)), "button quiet tiny");
    down.title = "Lower priority";
    down.disabled = index === rulesDraft.rules.length - 1;
    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(up);
    item.appendChild(down);
    list.appendChild(item);
  });
  for (const [kind, label, count] of [["places", "Places", rulesDraft.places.length],
    ["toggles", "Toggles", rulesDraft.toggles.length]]) {
    const item = create("div", rulesSelection?.kind === kind ? "rules-nav-item selected section" : "rules-nav-item section");
    item.appendChild(keyed(button(`${label} (${count})`, () => {
      rulesSelection = { kind };
      renderRulesEditor();
    }, "rules-nav-name"), `nav.${kind}`));
    list.appendChild(item);
  }
  list.appendChild(create("span", "rule-label log", "Recent activity"));
  liveRefs.log = create("div", "rules-log");
  list.appendChild(liveRefs.log);
  rulesSidebar.replaceChildren(list);
  updateRulesLive();
}

/** Redraws the whole editor, keeping focus on the control that had it. */
function renderRulesEditor() {
  if (rulesDialog.hidden) return;
  const focused = document.activeElement?.dataset?.key;
  focusKeys = new Map();
  liveRefs.conditions = [];
  if (rulesSelection?.kind === "rule" && !selectedRule()) rulesSelection = null;
  if (!rulesSelection && rulesDraft.rules.length) rulesSelection = { kind: "rule", id: rulesDraft.rules[0].id };
  const rule = selectedRule();
  rulesDetail.replaceChildren(rule ? ruleDetail(rule) : rulesSelection?.kind === "places" ? placesDetail()
    : rulesSelection?.kind === "toggles" ? togglesDetail()
      : create("p", "empty-note", "Add a rule with “+ New rule”."));
  renderRuleList();
  if (focused) focusKeys.get(focused)?.focus?.();
}

function formatClock(at) {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
}

function liveValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** Refreshes the live dots and values without redrawing anything. */
function updateRulesLive() {
  if (rulesDialog.hidden) return;
  for (const [id, dot] of liveRefs.rules) {
    const state = ruleEvaluation?.states.get(id);
    dot.className = state?.active ? "rule-dot active" : state?.enabled === false ? "rule-dot off" : "rule-dot";
    dot.title = state?.active ? "Active now" : state?.enabled === false ? "Disabled" : "Not active";
  }
  const state = rulesSelection?.kind === "rule" ? ruleEvaluation?.states.get(rulesSelection.id) : null;
  for (const { index, row, state: label } of liveRefs.conditions) {
    const result = state?.conditions[index];
    row.classList.toggle("ok", result?.ok === true);
    row.classList.toggle("bad", Boolean(result) && result.ok !== true);
    writeText(label, !result ? "" : result.holds === null ? "unknown" : liveValue(result.value));
  }
  if (liveRefs.log) {
    const entries = ruleEngine.log().slice(-20).reverse();
    liveRefs.log.replaceChildren(...(entries.length ? entries.map(entry => create("p", "rules-log-entry",
      `${formatClock(entry.at)} ${entry.name} ${entry.active ? "on" : "off"}`))
      : [create("p", "empty-note", "Nothing yet.")]));
  }
}

function setRulesDialog(open) {
  if (open) {
    rulesDraft = draftOf(layout);
    rulesCommitted = layout;
    setHidden(rulesError, true);
  }
  setHidden(rulesDialog, !open);
  if (open) renderRulesEditor();
}

$("#rules-open").addEventListener("click", () => setRulesDialog(true));
$("#rules-dialog-close").addEventListener("click", () => setRulesDialog(false));
rulesDialog.addEventListener("keydown", event => { if (event.key === "Escape") setRulesDialog(false); });

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
  // The layout changed from elsewhere (loaded, imported, reset): start the open editor over from it, unless it
  // holds an edit that isn't valid yet.
  if (!rulesDialog.hidden && layout !== rulesCommitted && rulesError.hidden) setRulesDialog(true);
});
featureHooks.tick.push(() => {
  renderPickups(currentPlayerState);
  if (rulesDialog.hidden) return;
  // Rules are paused while customizing, but the editor still shows them live.
  if (editing) evaluateView(currentPlayerState, Date.now());
  updateRulesLive();
});

// Panels that only appear on demand start hidden (the markup says so too).
for (const element of [xpParts.menu, performanceParts.menu, xpParts.form, pickupParts.form, advancementParts.form, advancementParts.popup, portalBox,
  villagerParts.nav, rulesDialog, portalLink]) {
  setHidden(element, true);
}
featureHooks.layout.forEach(hook => hook());
