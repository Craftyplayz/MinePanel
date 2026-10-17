"use strict";

// Feature tiles and tools: movement, experience, recent pickups, Litematica build progress, advancements, villager
// trades, portal linking, item windows (shulker boxes, bundles, ender chest), the player lookup menu and the layout
// rules editor. Shared helpers come from app.js; game maths and rule evaluation from rules.js; the lookup sites from
// player-links.js.

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
// What the graph shows and how far it still has to slide; animated with requestAnimationFrame where available.
let performanceGraph = null;
let performanceFrame = null;

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
 * Groups are cut at fixed sample numbers ({@code total} counts every sample ever received), so as the graph scrolls
 * finished groups keep their value and only the newest one changes. One extra group left of the window is kept so
 * the line still reaches the left edge while it slides.
 */
function performancePoints(fps, window, total = fps.length) {
  const group = Math.ceil(window / MAX_GRAPH_POINTS);
  const values = fps.slice(-(window + group));
  const first = total - values.length;
  const points = [];
  for (let end = values.length; end > 0;) {
    const start = Math.max(0, Math.floor((first + end - 1) / group) * group - first);
    const part = values.slice(start, end);
    const age = values.length - end;
    points.unshift({ x: window > 1 ? 1 - age / (window - 1) : 1, y: part.reduce((sum, value) => sum + value, 0) / part.length });
    end = start;
  }
  return points;
}

/**
 * How many samples {@code next} added after {@code previous}: the history is a sliding window, so find how far
 * {@code previous} shifted to line up with the start of {@code next}. With nothing in common, all of it is new.
 */
function newSamples(previous, next) {
  for (let shift = 0; shift <= previous.length; shift++) {
    const kept = previous.length - shift;
    if (kept > next.length) continue;
    let same = true;
    for (let index = 0; same && index < kept; index++) same = previous[shift + index] === next[index];
    if (same) return next.length - kept;
  }
  return null;
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
    performanceGraph = null;
    return;
  }
  writeText(performanceParts.status, `${performance.fps.at(-1)} FPS`);
  writeText(performanceParts.average, `${stats.average} fps`);
  writeText(performanceParts.low, `${stats.low} fps`);

  const now = Date.now();
  const previous = performanceGraph;
  const added = previous?.span === span ? newSamples(previous.fps, performance.fps) : null;
  // A reset, a new window or the first data: draw it in place rather than sliding from an unrelated graph.
  const graph = added === null
    ? { offset: 0, interval: 1000, arrived: now, total: performance.fps.length }
    : { offset: previous.offset, interval: previous.interval, arrived: previous.arrived, total: previous.total + added,
      peak: previous.peak, low: previous.low, drawn: previous.drawn };
  if (added > 0) {
    // Draw the new samples one step to the right, then slide left over about the time until the next arrives.
    graph.offset = Math.min(2, graph.offset + added);
    graph.interval = Math.min(3000, Math.max(250, (graph.interval * 3 + (now - graph.arrived) / added) / 4));
    graph.arrived = now;
  }
  graph.fps = performance.fps;
  graph.span = span;
  graph.points = performancePoints(performance.fps, span, graph.total);
  graph.targetPeak = graphPeak(graph.points.filter(point => point.x >= 0));
  graph.targetLow = stats.low;
  graph.peak ??= graph.targetPeak;
  graph.low ??= graph.targetLow;
  graph.drawn ??= now;
  performanceGraph = graph;
  writeText(performanceParts.peak, `${formatCount(graph.targetPeak)} fps`);
  if (reducedMotion?.matches || typeof window.requestAnimationFrame !== "function") {
    Object.assign(graph, { offset: 0, peak: graph.targetPeak, low: graph.targetLow });
    drawPerformance(graph);
  } else {
    drawPerformance(graph);
    if (performanceFrame === null) {
      graph.drawn = now;
      performanceFrame = window.requestAnimationFrame(animatePerformance);
    }
  }
}

/** Moves the graph one animation frame along: scrolls at a steady speed and eases the scale toward its target. */
function animatePerformance() {
  performanceFrame = null;
  const graph = performanceGraph;
  if (!graph?.points) return;
  const now = Date.now();
  const elapsed = Math.min(100, Math.max(0, now - graph.drawn));
  graph.drawn = now;
  // Constant speed reads as smooth; catch up a little faster if samples arrived quicker than the slide.
  graph.offset = Math.max(0, graph.offset - elapsed / graph.interval * Math.max(1, graph.offset));
  const ease = 1 - Math.exp(-elapsed / 250);
  graph.peak += (graph.targetPeak - graph.peak) * ease;
  graph.low += (graph.targetLow - graph.low) * ease;
  if (Math.abs(graph.targetPeak - graph.peak) < graph.targetPeak / 1000) graph.peak = graph.targetPeak;
  if (Math.abs(graph.targetLow - graph.low) < 0.05) graph.low = graph.targetLow;
  drawPerformance(graph);
  if (graph.offset > 0 || graph.peak !== graph.targetPeak || graph.low !== graph.targetLow) {
    performanceFrame = window.requestAnimationFrame(animatePerformance);
  }
}

function drawPerformance(graph) {
  const toScreen = value => GRAPH_HEIGHT - value / graph.peak * GRAPH_HEIGHT;
  const shift = graph.span > 1 ? graph.offset / (graph.span - 1) : 0;
  const screen = graph.points.map(point => ({ x: (point.x + shift) * GRAPH_WIDTH, y: toScreen(point.y) }));
  const line = smoothPath(screen);
  performanceParts.line.setAttribute("d", line);
  const f = value => Math.round(value * 10) / 10;
  performanceParts.area.setAttribute("d",
    `${line}L${f(screen.at(-1).x)},${GRAPH_HEIGHT}L${f(screen[0].x)},${GRAPH_HEIGHT}Z`);
  const lowY = String(f(toScreen(graph.low)));
  performanceParts.lowLine.setAttribute("y1", lowY);
  performanceParts.lowLine.setAttribute("y2", lowY);
  setHidden(performanceParts.lowLine, false);
}

// ---------------------------------------------------------------------------------------------- AFK

// How long the player has stood still without turning or moving the cursor (afkSeconds in rules.js), above a crawl
// of random non-zero statistics: each line enters at the top of an inset area, slides slowly down and leaves at the
// bottom. With reduced motion the lines stand still and a fresh set is shown every few seconds instead. The player can
// scroll the crawl either way with the wheel or by dragging; the crawl then eases to a stop, waits, and eases back.
const afkParts = { tile: $("#tile-afk"), status: $("#afk-status"), timer: $("#afk-timer"), crawl: $("#afk-crawl") };
/** Pixels per second: slow enough to read every line while it crosses the panel. */
const AFK_CRAWL_SPEED = 20;
/** Pixels between one line and the next. */
const AFK_CRAWL_GAP = 16;
/** Below this many seconds the badge says Active rather than AFK. */
const AFK_BADGE_SECONDS = 10;
const AFK_STATIC_MILLIS = 8000;
/** After the player scrolls: time to ease to a stop, time standing still, then time to ease back up to speed. */
const AFK_SCROLL_STOP_MILLIS = 500;
const AFK_SCROLL_HOLD_MILLIS = 3000;
const AFK_SCROLL_RESUME_MILLIS = 2000;
// Lines are kept in order from the bottom one to the top one. pending is wheel scrolling not yet shown.
const afkCrawl = { items: [], bag: [], frame: null, drawn: null, shownAt: 0, empty: null,
  scrolledAt: null, scrolledPace: 1, pending: 0, drag: null };

function formatAfk(seconds) {
  const value = Math.floor(seconds);
  const pad = number => String(number).padStart(2, "0");
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return hours ? `${hours}:${pad(minutes)}:${pad(value % 60)}` : `${minutes}:${pad(value % 60)}`;
}

const afkStatistics = player => (player?.available ? player.statistics?.entries ?? [] : [])
  .filter(entry => entry.value > 0);

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** A random statistic, without repeats until every one has been shown, and never one already on screen. */
function nextAfkStatistic(entries) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const onScreen = new Set(afkCrawl.items.map(item => item.id));
  for (let pass = 0; pass < 2; pass++) {
    while (afkCrawl.bag.length) {
      const entry = byId.get(afkCrawl.bag.pop());
      if (entry && !onScreen.has(entry.id)) return entry;
    }
    afkCrawl.bag = shuffled(byId.keys());
  }
  return null;
}

function addAfkLine(entry, y, atBottom = false) {
  const element = create("div", "afk-crawl-item");
  const label = create("span", "label");
  if (entry.category !== "General") label.appendChild(create("span", "stat-category", entry.category));
  label.appendChild(create("span", "", entry.label));
  element.appendChild(label);
  element.appendChild(create("span", "afk-crawl-leader"));
  element.appendChild(create("span", "total", entry.display));
  element.title = `${entry.label}: ${entry.display}`;
  afkParts.crawl.appendChild(element);
  const item = { id: entry.id, element, y, height: element.offsetHeight || 24 };
  if (atBottom) afkCrawl.items.unshift(item);
  else afkCrawl.items.push(item);
  return item;
}

function placeAfkLine(item) {
  item.element.style.transform = `translateY(${Math.round(item.y * 10) / 10}px)`;
}

function clearAfkCrawl(message = null) {
  afkCrawl.items = [];
  afkCrawl.pending = 0;
  afkCrawl.shownAt = 0;
  afkCrawl.empty = message;
  afkParts.crawl.replaceChildren(...message ? [create("p", "afk-crawl-empty", message)] : []);
}

/**
 * Moves every line down by {@code distance} px (up when negative), drops those that left the area, starts the next
 * above the top and, when moving up, the next below the bottom.
 */
function stepAfkCrawl(entries, distance) {
  const height = afkParts.crawl.clientHeight;
  for (const item of afkCrawl.items) item.y += distance;
  const inside = item => item.y < height && item.y + item.height >= 0;
  for (const item of afkCrawl.items) if (!inside(item)) item.element.remove?.();
  afkCrawl.items = afkCrawl.items.filter(inside);
  const top = afkCrawl.items.at(-1);
  if (!top || top.y >= AFK_CRAWL_GAP) {
    const entry = nextAfkStatistic(entries);
    if (entry) {
      const item = addAfkLine(entry, 0);
      item.y = (top ? top.y - AFK_CRAWL_GAP : 0) - item.height;
    }
  }
  const bottom = afkCrawl.items[0];
  if (distance < 0 && bottom && bottom.y + bottom.height + AFK_CRAWL_GAP < height) {
    const entry = nextAfkStatistic(entries);
    if (entry) addAfkLine(entry, bottom.y + bottom.height + AFK_CRAWL_GAP, true);
  }
}

/** Moves the lines in small steps, so a long scroll never jumps past the point where the next line should start. */
function moveAfkCrawl(entries, distance) {
  let left = distance;
  do {
    const step = clamp(left, -8, 8);
    stepAfkCrawl(entries, step);
    left -= step;
  } while (left !== 0);
  afkCrawl.items.forEach(placeAfkLine);
}

const afkEase = t => t * t * (3 - 2 * t);

/** The share of AFK_CRAWL_SPEED the crawl moves at, from 0 to 1, given when the player last scrolled it. */
function afkCrawlPace(now) {
  if (afkCrawl.scrolledAt === null) return 1;
  const since = now - afkCrawl.scrolledAt;
  if (since < AFK_SCROLL_STOP_MILLIS) return afkCrawl.scrolledPace * (1 - afkEase(since / AFK_SCROLL_STOP_MILLIS));
  // Holding the crawl keeps it still; the wait counts from letting go.
  const resumed = since - AFK_SCROLL_STOP_MILLIS - AFK_SCROLL_HOLD_MILLIS;
  if (afkCrawl.drag || resumed < 0) return 0;
  if (resumed < AFK_SCROLL_RESUME_MILLIS) return afkEase(resumed / AFK_SCROLL_RESUME_MILLIS);
  afkCrawl.scrolledAt = null;
  return 1;
}

function pauseAfkCrawl(now) {
  afkCrawl.scrolledPace = afkCrawlPace(now);
  afkCrawl.scrolledAt = now;
  // Reduced motion: keep the lines being read rather than swapping in a fresh set.
  afkCrawl.shownAt = now;
}

/** Scrolls the lines by the player's {@code distance} px; wheel scrolling glides there over a few frames. */
function scrollAfkCrawl(distance, glide) {
  const entries = afkStatistics(currentPlayerState);
  if (!entries.length || afkCrawl.empty !== null || afkParts.tile.hidden) return;
  pauseAfkCrawl(Date.now());
  if (glide && afkCrawl.frame !== null) afkCrawl.pending += distance;
  else moveAfkCrawl(entries, distance);
}

/** Reduced motion: fills the area from the top with a fresh set of lines every AFK_STATIC_MILLIS. */
function showStaticAfkLines(entries, now) {
  if (now - afkCrawl.shownAt < AFK_STATIC_MILLIS && afkCrawl.items.length) return;
  clearAfkCrawl();
  afkCrawl.shownAt = now;
  const height = afkParts.crawl.clientHeight || 0;
  let y = 0;
  for (let entry = nextAfkStatistic(entries); entry; entry = y < height ? nextAfkStatistic(entries) : null) {
    const item = addAfkLine(entry, y, true);
    placeAfkLine(item);
    y += item.height + AFK_CRAWL_GAP;
  }
}

const afkAnimating = () => !afkParts.tile.hidden && !document.hidden && afkParts.crawl.clientHeight > 0
  && !reducedMotion?.matches && typeof window.requestAnimationFrame === "function";

function animateAfk() {
  afkCrawl.frame = null;
  const entries = afkStatistics(currentPlayerState);
  if (!afkAnimating() || !entries.length) {
    afkCrawl.drawn = null;
    return;
  }
  const now = Date.now();
  // A long gap (a hidden tab) resumes where the lines were rather than jumping.
  const elapsed = afkCrawl.drawn === null ? 0 : Math.min(100, now - afkCrawl.drawn);
  const scrolled = Math.abs(afkCrawl.pending) < 0.5 ? afkCrawl.pending : afkCrawl.pending * (1 - Math.exp(-elapsed / 60));
  afkCrawl.pending -= scrolled;
  moveAfkCrawl(entries, elapsed / 1000 * AFK_CRAWL_SPEED * afkCrawlPace(now) + scrolled);
  afkCrawl.drawn = now;
  afkCrawl.frame = window.requestAnimationFrame(animateAfk);
}

afkParts.crawl.addEventListener("wheel", event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? afkParts.crawl.clientHeight : 1;
  // Scrolling down brings the lines below into view, so the lines move up.
  scrollAfkCrawl(-event.deltaY * unit, true);
}, { passive: false });
afkParts.crawl.addEventListener("pointerdown", event => {
  if (event.button > 0 || afkCrawl.empty !== null) return;
  afkParts.crawl.setPointerCapture?.(event.pointerId);
  afkCrawl.drag = { id: event.pointerId, y: event.clientY };
  pauseAfkCrawl(Date.now());
});
afkParts.crawl.addEventListener("pointermove", event => {
  const drag = afkCrawl.drag;
  if (!drag || drag.id !== event.pointerId) return;
  scrollAfkCrawl(event.clientY - drag.y, false);
  drag.y = event.clientY;
});
function endAfkDrag(event) {
  if (!afkCrawl.drag || afkCrawl.drag.id !== event.pointerId) return;
  afkCrawl.drag = null;
  pauseAfkCrawl(Date.now());
}
afkParts.crawl.addEventListener("pointerup", endAfkDrag);
afkParts.crawl.addEventListener("pointercancel", endAfkDrag);

function renderAfk(player, now = Date.now()) {
  const seconds = afkSeconds(player, now);
  writeText(afkParts.timer, seconds === null ? "—" : formatAfk(seconds));
  writeText(afkParts.status, seconds === null ? "Unavailable" : seconds >= AFK_BADGE_SECONDS ? "AFK" : "Active");
  afkParts.status.classList.toggle("muted", seconds === null || seconds < AFK_BADGE_SECONDS);
  const entries = afkStatistics(player);
  if (!entries.length) {
    const message = player?.available ? "No statistics yet." : "Unavailable";
    if (afkCrawl.empty !== message) clearAfkCrawl(message);
    return;
  }
  if (afkCrawl.empty !== null) clearAfkCrawl();
  if (afkParts.tile.hidden) return;
  if (reducedMotion?.matches || typeof window.requestAnimationFrame !== "function") {
    showStaticAfkLines(entries, now);
  } else if (afkCrawl.frame === null && afkAnimating()) {
    afkCrawl.frame = window.requestAnimationFrame(animateAfk);
  }
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
  search: $("#advancement-search"),
  form: $("#advancements-form"), seconds: $("#advancements-popup-seconds"), hiddenTabs: $("#advancements-hidden-tabs"),
  popup: $("#advancement-popup") };
const MAX_ADVANCEMENT_ROWS = 150;
let advancementKey;
let advancementNodes = new Map();
let lastAdvancementEventId;
let advancementPopupTimer;
/** The tab (category) the list is narrowed to, or null for all of them. */
let selectedAdvancementTab = null;

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
advancementParts.search.addEventListener("input", () => renderAdvancements(currentPlayerState));

function selectAdvancementTab(id) {
  selectedAdvancementTab = id;
  renderAdvancements(currentPlayerState);
}

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
  if (selectedAdvancementTab !== null && !advancements.tabs.some(tab => tab.id === selectedAdvancementTab)) {
    selectedAdvancementTab = null;
  }
  const search = advancementParts.search.value.trim().toLowerCase();
  const key = JSON.stringify([filter, selectedAdvancementTab, search, displaySettings().advancements.pinned, advancements]);
  if (key === advancementKey) return;
  advancementKey = key;
  const tabRow = (tab, id) => {
    const row = create("div", "advancement-tab");
    const selected = id === selectedAdvancementTab;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(selected));
    row.title = selected || id === null ? "Show all advancements" : `Show only ${tab.title} advancements`;
    // Clicking the selected tab again goes back to showing every tab.
    const select = () => selectAdvancementTab(selected ? null : id);
    row.addEventListener("click", select);
    row.addEventListener("keydown", event => {
      if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      select();
    });
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
    total: advancements.tabs.reduce((sum, tab) => sum + tab.total, 0) }, null);
  total.classList.add("advancement-total");
  advancementParts.tabs.replaceChildren(...(advancements.tabs.length ? [total] : []), ...advancements.tabs.map(tab => {
    const row = tabRow(tab, tab.id);
    const hide = create("button", "icon-button advancement-tab-hide", "×");
    hide.type = "button";
    hide.setAttribute("aria-label", `Hide the ${tab.title} tab`);
    hide.title = `Hide the ${tab.title} tab`;
    hide.addEventListener("click", event => {
      event.stopPropagation();
      changeSettings("advancements", { hiddenTabs: [...displaySettings().advancements.hiddenTabs, tab.id] });
    });
    row.appendChild(hide);
    return row;
  }));
  const fraction = entry => entry.criteriaTotal ? entry.criteriaDone / entry.criteriaTotal : 0;
  // Hidden advancements not made yet only match on what the list shows for them, so searching doesn't spoil them.
  const matches = entry => !search || (entry.hidden && !entry.done ? "???"
    : `${entry.title}\n${entry.description ?? ""}`).toLowerCase().includes(search);
  const inTab = advancements.entries.filter(entry => selectedAdvancementTab === null || entry.tab === selectedAdvancementTab);
  const shown = inTab.filter(matches);
  let entries;
  if (filter === "done") {
    entries = shown.filter(entry => entry.done);
  } else if (filter === "remaining") {
    entries = shown.filter(entry => !entry.done);
  } else {
    entries = shown.filter(entry => !entry.done)
      .sort((a, b) => fraction(b) - fraction(a) || b.criteriaDone - a.criteriaDone || a.title.localeCompare(b.title));
  }
  // Pinned advancements stay at the top whatever the filter, in the order they were pinned (still narrowed by tab and search).
  const pinned = displaySettings().advancements.pinned;
  const byId = new Map(shown.map(entry => [entry.id, entry]));
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
    ? `Showing ${rows.length} of ${entries.length}.` : "")
    : search && inTab.length ? "No advancements match the search."
      : filter === "done" ? "None done yet." : "All done!");
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

// ----------------------------------------------------------------------------------------------- Player lookup

// The player head opens a menu of websites about the signed-in player (player-links.js). Groups open in place with a
// Back row, as inventory tiles can be small; sites with several pages open a picker. Sites are only contacted when a
// link is followed: nothing is fetched or previewed.
const playerMenu = $("#player-menu");
const playerLinkDialog = $("#player-link-dialog");
const playerLinkParts = { title: $("#player-link-title"), note: $("#player-link-note"), pages: $("#player-link-pages") };
const OFFLINE_NOTE = "Needs a UUID, and this is an offline-mode account";
/** The open menu's group id, or null at the top level. */
let playerMenuGroup = null;

const playerIdentity = player => player?.available && player.icons
  ? { name: player.icons.name, uuid: player.icons.uuid } : null;

function copyButton(label, text) {
  const copy = create("button", "chip small", label);
  copy.type = "button";
  copy.addEventListener("click", () => {
    window.navigator?.clipboard?.writeText(text)?.catch?.(() => {});
    writeText(copy, "Copied");
    window.setTimeout(() => writeText(copy, label), 1200);
  });
  return copy;
}

/** One menu row: a name with its domain, a short description and, for rows that lead on, a trailing mark. */
function playerMenuRow(tagName, name, domain, description, mark) {
  const row = create(tagName, "player-menu-item");
  const title = create("span", "player-menu-title");
  title.appendChild(create("strong", "", name));
  if (domain) title.appendChild(create("span", "player-menu-domain", domain));
  row.appendChild(title);
  row.appendChild(create("span", "player-menu-description", description));
  if (mark) row.appendChild(create("span", "player-menu-mark", mark));
  return row;
}

/** A link that opens in a new tab and tells the site nothing about the dashboard. */
function outboundLink(row, url) {
  row.href = url;
  row.target = "_blank";
  row.rel = "noopener noreferrer";
  return row;
}

function siteRow(site, identity) {
  const unavailable = isOfflineUuid(identity.uuid) && needsUuid(site);
  const row = playerMenuRow(unavailable ? "span" : site.url ? "a" : "button", site.name, site.domain,
    site.description, site.pages ? "⋯" : undefined);
  row.dataset.site = site.name;
  if (unavailable) {
    row.classList.add("disabled");
    row.setAttribute("aria-disabled", "true");
    row.title = OFFLINE_NOTE;
  } else if (site.url) {
    outboundLink(row, playerLinkUrl(site.url, identity));
    row.addEventListener("click", () => closePlayerMenu());
  } else {
    row.type = "button";
    row.addEventListener("click", () => openPlayerPages(site, identity));
  }
  return row;
}

function playerMenuHeader(identity) {
  const header = create("div", "player-menu-header");
  const who = create("div", "player-menu-who");
  who.appendChild(create("strong", "", identity.name));
  who.appendChild(create("span", "player-menu-uuid", identity.uuid));
  header.appendChild(who);
  const tools = create("div", "player-menu-tools");
  tools.appendChild(copyButton("Copy name", identity.name));
  tools.appendChild(copyButton("Copy UUID", identity.uuid));
  header.appendChild(tools);
  if (isOfflineUuid(identity.uuid)) {
    header.appendChild(create("p", "player-menu-note",
      "Offline-mode account: sites that need a UUID are greyed out, and name lookups may show another player."));
  }
  return header;
}

function renderPlayerMenu(identity) {
  const rows = [];
  const group = PLAYER_LINK_GROUPS.find(entry => entry.id === playerMenuGroup);
  if (group) {
    const back = playerMenuRow("button", `‹ ${group.name}`, "", "Back to all groups");
    back.type = "button";
    back.classList.add("player-menu-back");
    back.addEventListener("click", () => {
      playerMenuGroup = null;
      renderPlayerMenu(identity);
    });
    rows.push(back, ...group.sites.map(site => siteRow(site, identity)));
  } else {
    rows.push(playerMenuHeader(identity));
    const suggested = suggestedPlayerLinks(currentPlayerState?.world);
    if (suggested.length) {
      rows.push(create("p", "player-menu-label", "Suggested for this server"),
        ...suggested.map(site => siteRow(site, identity)), create("p", "player-menu-label", "All sites"));
    }
    for (const entry of PLAYER_LINK_GROUPS) {
      const row = playerMenuRow("button", entry.name, "", entry.description, "›");
      row.type = "button";
      row.dataset.group = entry.id;
      row.addEventListener("click", () => {
        playerMenuGroup = entry.id;
        renderPlayerMenu(identity);
      });
      rows.push(row);
    }
  }
  playerMenu.replaceChildren(...rows);
}

/** Opens the menu under the head, or above it when there is more room there. */
function openPlayerMenu() {
  const identity = playerIdentity(currentPlayerState);
  if (!identity) return;
  playerMenuGroup = null;
  renderPlayerMenu(identity);
  const rect = headSlot.element.getBoundingClientRect();
  const width = window.innerWidth ?? 1280;
  const height = window.innerHeight ?? 800;
  const below = height - rect.top - rect.height;
  playerMenu.style.left = `${Math.round(Math.max(8, Math.min(width - 328, rect.left)))}px`;
  if (below >= 320 || below >= rect.top) {
    playerMenu.style.top = `${Math.round(rect.top + rect.height + 6)}px`;
    playerMenu.style.bottom = "auto";
    playerMenu.style.maxHeight = `${Math.round(Math.max(160, below - 14))}px`;
  } else {
    playerMenu.style.top = "auto";
    playerMenu.style.bottom = `${Math.round(height - rect.top + 6)}px`;
    playerMenu.style.maxHeight = `${Math.round(Math.max(160, rect.top - 14))}px`;
  }
  setHidden(playerMenu, false);
}

function closePlayerMenu() {
  setHidden(playerMenu, true);
}

/** The second popup: every page of one site, each with what it shows. */
function openPlayerPages(site, identity) {
  writeText(playerLinkParts.title, site.name);
  writeText(playerLinkParts.note, `${site.description} · ${site.domain}`);
  playerLinkParts.pages.replaceChildren(...site.pages.map(page => {
    const unavailable = isOfflineUuid(identity.uuid) && needsUuid(page);
    const row = create("div", `player-page${unavailable ? " disabled" : ""}`);
    row.dataset.page = page.name;
    const text = create("div", "player-page-text");
    text.appendChild(create("strong", "", page.name));
    text.appendChild(create("span", "", unavailable ? OFFLINE_NOTE : page.description));
    row.appendChild(text);
    if (!unavailable) {
      const url = playerLinkUrl(page.url, identity);
      row.appendChild(outboundLink(create("a", "button small", "Open"), url));
      row.appendChild(copyButton("Copy link", url));
    }
    return row;
  }));
  setHidden(playerLinkDialog, false);
}

function closePlayerPages() {
  setHidden(playerLinkDialog, true);
}

headSlot.element.addEventListener("click", () => {
  if (editing) return;
  if (playerMenu.hidden) openPlayerMenu();
  else closePlayerMenu();
});
$("#player-link-close").addEventListener("click", () => closePlayerPages());
playerLinkDialog.addEventListener("click", event => { if (event.target === playerLinkDialog) closePlayerPages(); });

/**
 * Clicking elsewhere or pressing Escape closes the unpinned window (and the player lookup menu, the XP and
 * performance window menus and the toolbar's Tiles and Toggles dropdowns).
 */
function closeTransient(event) {
  const inside = element => element?.contains?.(event?.target);
  if (!event || !inside(playerMenu) && !inside(headSlot.element) && !inside(playerLinkDialog)) closePlayerMenu();
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
  if (!event || !toolbarMenus.some(entry => inside(entry.menu) || inside(entry.button))) setToolbarMenu(null);
}

window.addEventListener("pointerdown", closeTransient);
window.addEventListener("keyup", event => {
  if (event.key !== "Escape") return;
  // The page picker sits over the menu, so Escape closes just the picker first.
  if (!playerLinkDialog.hidden) closePlayerPages();
  else closeTransient();
});

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
  movement: "Moving by", speed: "Speed", still: "Standing still", afk: "AFK for", holding: "Holding", hasItem: "Has item",
  freeSlots: "Free slots", durability: "Durability", elytra: "Wearing elytra", xpGained: "Gained XP",
  pickedUp: "Picked up", statRose: "Statistic rose", minedBlock: "Mined", placedBlock: "Placed",
  killedMob: "Killed", tookDamage: "Took damage (hearts)", advancement: "Advancement earned", died: "Died",
  changedDimension: "Changed dimension", joinedWorld: "Joined the world", inCombat: "In combat",
  villagersNearby: "Known villagers nearby", portalLinking: "Linking a portal", toggle: "Toggle on",
  ruleActive: "Rule active", width: "Dashboard width", realTime: "Real-world time",
  sessionTime: "Session time", inGame: "In a world", moonPhase: "Moon phase", light: "Light level",
  spawnDistance: "Distance from spawn", lookingAt: "Looking at", air: "Air", armor: "Armor points", onFire: "On fire",
  inWater: "In water", inLava: "In lava", inRain: "In rain", sneaking: "Sneaking", sprinting: "Sprinting",
  sleeping: "Sleeping", riding: "Riding", usingItem: "Using an item", hostilesNearby: "Hostile mobs nearby",
  mobNearby: "Mob nearby", playersNearby: "Players nearby", bossBar: "Boss bar visible", raid: "Raid active",
  screen: "Screen open" };
const FAMILY_LABELS = { world: "World", position: "Position", player: "Player", inventory: "Inventory",
  amounts: "Amounts", events: "Events", threats: "Threats", villagers: "Villagers", screens: "Screens",
  features: "Features", meta: "Dashboard" };
const COMPARE_LABELS = { "<": "<", "<=": "≤", "=": "=", ">=": "≥", ">": ">", "!=": "≠", between: "between" };
const COMPARE_UNITS = { width: "px", sessionTime: "min", afk: "min", durability: "%", speed: "blocks/s", tookDamage: "hearts",
  air: "s", armor: "points", spawnDistance: "blocks" };
/** Readable names of fixed choices, by RULE_CHOICES key. */
const CHOICE_LABELS = {
  moonPhase: { full: "Full moon", waningGibbous: "Waning gibbous", thirdQuarter: "Third quarter",
    waningCrescent: "Waning crescent", new: "New moon", waxingCrescent: "Waxing crescent", firstQuarter: "First quarter",
    waxingGibbous: "Waxing gibbous" },
  usingItem: { eating: "eating", drinking: "drinking", blocking: "blocking", bow: "drawing a bow",
    crossbow: "loading a crossbow", trident: "throwing a trident", spear: "using a spear", spyglass: "spyglass",
    horn: "goat horn", brush: "brushing", bundle: "bundle", fishing: "fishing" },
  screen: { inventory: "own inventory", chest: "chest-like", enderChest: "ender chest", furnace: "furnace-like",
    crafting: "crafting", anvil: "anvil", enchanting: "enchanting", brewing: "brewing", trading: "villager trading",
    smithing: "smithing", grindstone: "grindstone", stonecutter: "stonecutter", loom: "loom",
    cartography: "cartography", beacon: "beacon", other: "any other screen" }
};
const ACTION_LABELS = { profile: "Switch profile", show: "Show panel", hide: "Hide panel", place: "Place panel",
  swap: "Swap panels", focus: "Focus panel", set: "Set panel setting", notify: "Notify" };
const NAME_HINTS = { world: "world or server names", dimension: "e.g. nether, minecraft:the_end",
  biome: "e.g. minecraft:desert", effect: "e.g. minecraft:speed" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let rulesDraft = null;
let rulesCommitted = null;
let rulesSelection = null;
let liveRefs = { rules: new Map(), conditions: [], blocks: [], log: null };
// Docked: the editor is a side panel and the dashboard beside it is live (preview, inspector, Place on grid).
let rulesDocked = false;
// Customizing is left while the editor is open, so the dashboard shows what the rules do; it resumes on close.
let customizingBeforeRules = false;
let placing = null;
const rulesDock = $("#rules-dock");

/** The editable parts of the layout, copied so edits can be half-finished without touching the live layout. */
const draftOf = value => structuredCopy({ rules: value.rules, places: value.places, toggles: value.toggles,
  folders: value.folders, animation: value.animation });

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
  if (redraw) {
    // Rows may have moved, so a selection of them no longer means the same rows.
    selectedRows = new Set();
    renderRulesEditor();
  } else {
    renderRuleList();
  }
}

// Copy and paste of When rows and of actions: rows are ticked, copied here, and pasted into any rule (this browser
// tab only). Share strings are shown under the rule or folder they were made for.
let selectedRows = new Set();
let rowClipboard = null;
let shareText = null;
let shownSelection = null;
let importMessage = null;
let importReplace = false;

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

const TIME_UNITS = [["ms", "ms", 1], ["s", "s", 1000], ["min", "min", 60000], ["h", "h", 3600000]];
const unitMillis = unit => TIME_UNITS.find(([id]) => id === unit)[2];
// The unit last picked for each duration control, kept while the value it was picked for is unchanged.
const durationUnits = new Map();

/** The unit a duration is shown in: the one picked for it, else the largest that shows it as a whole number. */
function durationUnit(key, millis) {
  const picked = durationUnits.get(key);
  if (picked && picked.millis === millis) return picked.unit;
  if (!Number.isFinite(millis) || millis === 0) return "s";
  return TIME_UNITS.findLast(([, , size]) => millis % size === 0)?.[0] ?? "ms";
}

/**
 * A number with a unit picker (ms, s, min, h). The value is stored in {@code base} (a unit id) as a whole number;
 * min and max are in that unit too.
 */
function durationInput(key, value, base, onChange, { min, max } = {}) {
  const row = create("span", "rule-inline");
  const baseMillis = unitMillis(base);
  let millis = value * baseMillis;
  let unit = durationUnit(key, millis);
  const input = numberInput(key, NaN, number => {
    const stored = Number.isFinite(number) ? Math.round(number * unitMillis(unit) / baseMillis) : NaN;
    millis = stored * baseMillis;
    durationUnits.set(key, { unit, millis });
    onChange(stored);
  }, { step: "any" });
  const show = () => {
    const size = unitMillis(unit);
    input.value = Number.isFinite(millis) ? String(Number((millis / size).toPrecision(6))) : "";
    if (min !== undefined) input.min = String(min * baseMillis / size);
    if (max !== undefined) input.max = String(max * baseMillis / size);
  };
  show();
  row.appendChild(input);
  row.appendChild(selectInput(`${key}.unit`, TIME_UNITS.map(([id, label]) => [id, label]), unit, next => {
    unit = next;
    durationUnits.set(key, { unit, millis });
    show();
  }));
  return row;
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

// ---------------------------------------------------------------------------------------------- Pickers

// Suggestions as you type, with names and icons where known: the game's registries (items, blocks, entity types,
// effects, biomes, general statistics), which the mod sends once per connection and are kept in memory, plus ids
// the dashboard has seen (also advancements, dimensions and worlds), which are kept in this browser so the editor
// still suggests them outside a world.

const PICKER_KINDS = ["item", "block", "entity", "effect", "stat", "advancement", "biome", "dimension", "world"];
const REGISTRY_PICKERS = { item: "items", block: "blocks", entity: "entities", effect: "effects", biome: "biomes",
  stat: "stats" };
const registryIds = Object.fromEntries(Object.keys(REGISTRY_PICKERS).map(kind => [kind, new Map()]));
const PICKER_LIMIT = 2000;
const PICKER_STORAGE = "minepanel.knownIds";
const knownIds = Object.fromEntries(PICKER_KINDS.map(kind => [kind, new Map()]));
let knownIdsDirty = false;
try {
  const saved = JSON.parse(window.localStorage?.getItem(PICKER_STORAGE) ?? "null");
  for (const kind of PICKER_KINDS) {
    for (const [id, entry] of Array.isArray(saved?.[kind]) ? saved[kind].slice(0, PICKER_LIMIT) : []) {
      if (typeof id === "string" && id.length <= 256) {
        knownIds[kind].set(id, { name: typeof entry?.name === "string" ? entry.name : null,
          icon: typeof entry?.icon === "string" && /^[a-z0-9-]{1,64}$/.test(entry.icon) ? entry.icon : null });
      }
    }
  }
} catch {
  // Suggestions start empty.
}
for (const [id, name] of [["minecraft:overworld", "Overworld"], ["minecraft:the_nether", "The Nether"],
  ["minecraft:the_end", "The End"]]) {
  if (!knownIds.dimension.has(id)) knownIds.dimension.set(id, { name, icon: null });
}

function learnId(kind, id, name = null, icon = null) {
  if (typeof id !== "string" || !id) return;
  const map = knownIds[kind];
  const old = map.get(id);
  if (old ? old.name === (name ?? old.name) && old.icon === (icon ?? old.icon) : map.size >= PICKER_LIMIT) return;
  map.set(id, { name: name ?? old?.name ?? null, icon: icon ?? old?.icon ?? null });
  knownIdsDirty = true;
}

// The parts of the state last learned from; updates replace a part only when it changed.
const learnedFrom = {};

function learnIds(player) {
  if (!player?.available) return;
  const changed = name => {
    if (learnedFrom[name] === player[name]) return false;
    learnedFrom[name] = player[name];
    return true;
  };
  const inventoryChanged = changed("inventory");
  if (changed("pickups") || inventoryChanged) {
    const items = [...player.inventory?.slots ?? [], ...Object.values(player.inventory?.equipment ?? {}),
      ...(player.pickups ?? []).map(pickup => pickup.item)];
    for (const item of items) if (item && !item.empty) learnId("item", item.itemId, item.name, item.icon);
  }
  if (changed("effects")) for (const effect of player.effects ?? []) learnId("effect", effect.id, effect.name);
  if (changed("statistics")) for (const entry of player.statistics?.entries ?? []) learnId("stat", entry.id, entry.label);
  if (changed("advancements")) {
    for (const entry of player.advancements?.entries ?? []) learnId("advancement", entry.id, entry.title, entry.icon);
  }
  learnId("biome", player.world?.biome);
  learnId("dimension", player.dimension);
  learnId("world", player.world?.name);
  // Kept after leaving the world, so rules can still be edited with suggestions.
  if (changed("registries") && player.registries) {
    for (const [kind, list] of Object.entries(REGISTRY_PICKERS)) {
      registryIds[kind] = new Map(player.registries[list].map(entry => [entry.id, { name: entry.name, icon: entry.icon }]));
    }
  }
}

/** What the picker knows about an id: from the registries, else from what the dashboard has seen. */
const knownId = (kind, id) => registryIds[kind]?.get(id) ?? knownIds[kind]?.get(id);

/** The suggestions of one kind: registry entries (sorted by name), then seen ids the registries don't have. */
function pickerEntries(kind) {
  const registry = registryIds[kind] ?? new Map();
  return [...registry, ...[...knownIds[kind] ?? []].filter(([id]) => !registry.has(id))];
}

function saveKnownIds() {
  if (!knownIdsDirty) return;
  knownIdsDirty = false;
  try {
    window.localStorage?.setItem(PICKER_STORAGE, JSON.stringify(Object.fromEntries(PICKER_KINDS.map(kind =>
      [kind, [...knownIds[kind]]]))));
  } catch {
    // Not kept; suggestions are relearned next time.
  }
}

/** A text input suggesting known ids of one kind (with icons where known) as you type. */
function idPicker(key, value, onChange, kind, { placeholder = "", maxLength = 256 } = {}) {
  const wrap = create("span", "id-picker");
  const input = textInput(key, value, onChange, { placeholder, maxLength });
  const list = create("div", "id-picker-list");
  setHidden(list, true);
  const show = () => {
    const query = input.value.trim().toLowerCase();
    const matches = pickerEntries(kind).filter(([id, entry]) => !query || id.includes(query)
      || entry.name?.toLowerCase().includes(query)).slice(0, 40);
    list.replaceChildren(...matches.map(([id, entry]) => {
      const option = create("button", "id-picker-option");
      option.type = "button";
      if (entry.icon) {
        const icon = create("img", "icon");
        icon.alt = "";
        icon.src = iconUrl(entry.icon);
        option.appendChild(icon);
      }
      option.appendChild(create("span", "", entry.name ?? id));
      if (entry.name) option.appendChild(create("span", "rule-muted", id));
      // Keep focus in the input so choosing doesn't count as leaving it first.
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => {
        input.value = id;
        setHidden(list, true);
        onChange(id);
      });
      return option;
    }));
    setHidden(list, matches.length === 0);
  };
  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("blur", () => setHidden(list, true));
  input.addEventListener("keydown", event => { if (event.key === "Escape") setHidden(list, true); });
  wrap.appendChild(input);
  wrap.appendChild(list);
  return wrap;
}

/** A list of values as removable chips, plus a picker to add more (several at once, separated by commas). */
function valueList(key, values, onChange, kind, placeholder) {
  const box = create("span", "rule-values");
  values.forEach((value, index) => {
    const chip = create("span", "value-chip", knownId(kind, value)?.name ?? value);
    chip.title = value;
    const remove = keyed(button("×", () => onChange(values.filter((_, other) => other !== index)), "value-chip-remove"),
      `${key}.remove.${index}`);
    remove.title = `Remove ${value}`;
    remove.setAttribute("aria-label", `Remove ${value}`);
    chip.appendChild(remove);
    box.appendChild(chip);
  });
  box.appendChild(idPicker(`${key}.add`, "", text => {
    const added = splitList(text).filter(value => !values.includes(value));
    if (added.length) onChange([...values, ...added]);
  }, kind, { placeholder: values.length ? "add…" : placeholder, maxLength: 4000 }));
  return box;
}

// ------------------------------------------------------------------------------------------- Conditions

const player = () => currentPlayerState?.available ? currentPlayerState : null;

/** A new compare row's comparison, where ">= 1" doesn't fit. */
const COMPARE_DEFAULTS = { width: { compare: ">=", value: 700 }, air: { compare: "<", value: 5 },
  armor: { compare: ">=", value: 10 }, spawnDistance: { compare: "<", value: 100 } };

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
      return { ...condition, ...(COMPARE_DEFAULTS[type] ?? { compare: ">=", value: 1 }) };
    case "light":
      return { ...condition, source: "combined", compare: "<", value: 8 };
    case "look":
      return { ...condition, target: "block", distance: 5 };
    case "threat":
      return { ...condition, radius: 16, compare: ">=", value: 3 };
    case "players":
      return { ...condition, radius: 32, compare: ">=", value: 1 };
    case "mob":
      return { ...condition, entity: "minecraft:creeper", radius: 16 };
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

const SUBJECT_PICKERS = { item: "item", block: "block", stat: "stat", advancement: "advancement", entity: "entity" };

/** "+ held": the item in the main hand. */
function heldButton(condition, box) {
  const held = player()?.inventory?.equipment.mainhand;
  if (!held || held.empty || held.itemId === condition.item) return;
  box.appendChild(button(`+ held (${held.name})`, () => editRules(() => { condition.item = held.itemId; })));
}

/** A picker for an optional id (a type filter); left empty, it means any. */
function optionalSubject(condition, key, name, kind, placeholder) {
  return field(name === "id" ? "" : name, idPicker(`${key}.${name}`, condition[name], value => editRules(() => {
    if (value.trim()) condition[name] = value.trim();
    else delete condition[name];
  }, false), kind, { placeholder }));
}

/** The parameter controls of one condition. */
function conditionControls(condition, key) {
  const spec = CONDITION_TYPES[condition.type];
  const box = create("div", "rule-params");
  const set = (name, redraw = false) => value => editRules(() => { condition[name] = value; }, redraw);
  const compare = () => compareControls(key, condition, true, COMPARE_UNITS[condition.type]);
  switch (spec.kind) {
    case "names": {
      box.appendChild(valueList(`${key}.values`, condition.values, set("values", true), condition.type,
        NAME_HINTS[condition.type]));
      const current = currentName(condition.type);
      if (current) {
        box.appendChild(button(`+ ${current}`, () => editRules(() => {
          if (!condition.values.includes(current)) condition.values.push(current);
        })));
      }
      break;
    }
    case "choices":
      box.appendChild(choiceChips(`${key}.values`, RULE_CHOICES[condition.type], condition.values, set("values", true),
        CHOICE_LABELS[condition.type]));
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
      box.appendChild(valueList(`${key}.values`, condition.values, set("values", true), "effect", NAME_HINTS.effect));
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
      box.appendChild(field("item", idPicker(`${key}.item`, condition.item, set("item"), "item",
        { placeholder: "minecraft:diamond_pickaxe" })));
      heldButton(condition, box);
      box.appendChild(field("hand", selectInput(`${key}.hand`, RULE_CHOICES.hand.map(hand => [hand, hand]),
        condition.hand, set("hand"))));
      break;
    case "hasItem":
      box.appendChild(field("item", idPicker(`${key}.item`, condition.item, set("item"), "item",
        { placeholder: "minecraft:torch" })));
      heldButton(condition, box);
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
        box.appendChild(field(spec.subject, idPicker(`${key}.subject`, condition[spec.subject], value => editRules(() => {
          if (value.trim() || spec.required) condition[spec.subject] = value.trim();
          else delete condition[spec.subject];
        }, false), SUBJECT_PICKERS[spec.subject], { placeholder: spec.required ? "minecraft:custom/minecraft:jump" : "any" })));
      }
      box.appendChild(compare());
      box.appendChild(field("in the last", durationInput(`${key}.window`, condition.window, "s", set("window"),
        { min: 1, max: 3600 })));
      break;
    case "event":
      if (spec.subject) {
        box.appendChild(field(spec.subject, idPicker(`${key}.subject`, condition[spec.subject], value => editRules(() => {
          if (value.trim()) condition[spec.subject] = value.trim();
          else delete condition[spec.subject];
        }, false), SUBJECT_PICKERS[spec.subject], { placeholder: "any" })));
      }
      break;
    case "villagers":
      box.appendChild(compare());
      box.appendChild(field("within", numberInput(`${key}.radius`, condition.radius, set("radius"),
        { min: 1, max: 256 })));
      box.appendChild(create("span", "rule-muted", "blocks"));
      break;
    case "light":
      box.appendChild(selectInput(`${key}.source`, RULE_CHOICES.lightSource.map(source => [source, `${source} light`]),
        condition.source, set("source")));
      box.appendChild(compare());
      break;
    case "look":
      box.appendChild(selectInput(`${key}.target`, [["block", "a block"], ["entity", "an entity"]], condition.target,
        value => editRules(() => {
          condition.target = value;
          delete condition.id;
        })));
      box.appendChild(optionalSubject(condition, key, "id", condition.target, "any"));
      box.appendChild(field("within", numberInput(`${key}.distance`, condition.distance, set("distance"),
        { min: 1, max: MAX_SENSOR_RADIUS })));
      box.appendChild(create("span", "rule-muted", "blocks"));
      break;
    case "riding":
      box.appendChild(optionalSubject(condition, key, "entity", "entity", "anything"));
      break;
    case "threat":
    case "players":
      box.appendChild(compare());
      box.appendChild(field("within", numberInput(`${key}.radius`, condition.radius, set("radius"),
        { min: 1, max: MAX_SENSOR_RADIUS })));
      box.appendChild(create("span", "rule-muted", "blocks"));
      if (spec.kind === "threat") box.appendChild(optionalSubject(condition, key, "entity", "entity", "any hostile mob"));
      break;
    case "mob":
      box.appendChild(field("entity", idPicker(`${key}.entity`, condition.entity, set("entity"), "entity",
        { placeholder: "minecraft:creeper" })));
      box.appendChild(field("within", numberInput(`${key}.radius`, condition.radius, set("radius"),
        { min: 1, max: MAX_SENSOR_RADIUS })));
      box.appendChild(create("span", "rule-muted", "blocks"));
      break;
    case "portal":
      box.appendChild(field("for up to", durationInput(`${key}.minutes`, condition.minutes, "min", set("minutes"),
        { min: 1, max: 120 })));
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
    row.appendChild(durationInput(`${key}.seconds`, condition[mode], "s",
      value => editRules(() => { condition[mode] = value; }, false), { min: 1, max: 3600 }));
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
  head.appendChild(copyPasteTools(rule, "when"));
  section.appendChild(head);
  if (!rule.when.length) section.appendChild(create("p", "empty-note", "No conditions yet: this rule is never active."));
  let block;
  rule.when.forEach((condition, index) => {
    if (index === 0 || condition.join === "or") {
      if (index > 0) section.appendChild(create("div", "rule-or-divider", "OR"));
      block = create("div", "rule-block");
      liveRefs.blocks.push(block);
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
    row.appendChild(rowSelect(key));
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

/** A tick box that selects a row for copying. */
function rowSelect(key) {
  const input = keyed(create("input", "row-select"), `${key}.select`);
  input.type = "checkbox";
  input.checked = selectedRows.has(key);
  input.title = "Select to copy";
  input.setAttribute("aria-label", "Select to copy");
  input.addEventListener("change", () => {
    if (input.checked) selectedRows.add(key);
    else selectedRows.delete(key);
    renderRulesEditor();
  });
  return input;
}

/**
 * Copy (the ticked rows of this list) and Paste (rows copied from any rule; conditions into When, actions into Then
 * or Else). A "Rule active" condition on the rule itself is left out, as it can't depend on itself.
 */
function copyPasteTools(rule, list) {
  const tools = create("span", "rule-section-tools");
  const kind = list === "when" ? "conditions" : "actions";
  const picked = rule[list].filter((_, index) => selectedRows.has(`${list}.${index}`));
  const copy = keyed(button(picked.length ? `Copy ${picked.length}` : "Copy", () => {
    rowClipboard = { kind, rows: structuredCopy(picked) };
    selectedRows = new Set();
    renderRulesEditor();
  }), `${list}.copy`);
  copy.disabled = picked.length === 0;
  copy.title = picked.length ? "Copy the ticked rows" : "Tick rows to copy them";
  tools.appendChild(copy);
  if (rowClipboard?.kind === kind) {
    const rows = rowClipboard.rows.filter(row => !(row.type === "ruleActive" && row.rule === rule.id));
    const limit = list === "when" ? MAX_CONDITIONS : MAX_ACTIONS;
    const paste = keyed(button(`Paste ${rows.length}`, () => editRules(() => {
      rule[list].push(...structuredCopy(rows));
    })), `${list}.paste`);
    paste.disabled = rows.length === 0 || rule[list].length + rows.length > limit;
    paste.title = rows.length && paste.disabled ? `At most ${limit} here` : "Add the copied rows at the end";
    tools.appendChild(paste);
  }
  return tools;
}

/** A share string, ready to copy. */
function shareBox(text, what) {
  const box = create("div", "share-box");
  const input = keyed(create("input", "rule-input"), "share.text");
  input.readOnly = true;
  input.value = text;
  input.addEventListener("focus", () => input.select?.());
  box.appendChild(input);
  box.appendChild(button("Copy", () => {
    input.select?.();
    window.navigator?.clipboard?.writeText(text)?.catch?.(() => {});
  }, "button small"));
  box.appendChild(create("span", "rule-muted", `Share string for ${what}. Paste it under Import on any MinePanel dashboard.`));
  return box;
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
  const choices = { xp: { window: XP_WINDOW_CHOICES }, performance: { window: PERFORMANCE_WINDOW_CHOICES },
    model: { speed: MODEL_SPEED_CHOICES } }[action.panel]?.[action.setting];
  const unit = action.panel === "model" ? "°/s" : " s";
  if (choices) return selectInput(`${key}.value`, choices.map(choice => [String(choice), `${choice}${unit}`]),
    String(value), next => change(Number(next)));
  if (action.panel === "model" && action.setting === "axis") {
    return selectInput(`${key}.value`, MODEL_AXIS_CHOICES.map(axis => [axis, MODEL_AXIS_LABELS[axis]]), value, change);
  }
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
      box.appendChild(keyed(button("Set on grid", () => startPlacing(action), "button small"), `${key}.grid`));
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
      box.appendChild(field("at most every", durationInput(`${key}.cooldown`, action.cooldown, "s", set("cooldown"),
        { min: 0, max: 3600 })));
      break;
  }
  return box;
}

function actionSection(rule, list, title, note) {
  const section = create("section", "rule-section");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", title));
  head.appendChild(create("span", "rule-muted", note));
  head.appendChild(copyPasteTools(rule, list));
  section.appendChild(head);
  if (!rule[list].length) section.appendChild(create("p", "empty-note", "No actions."));
  rule[list].forEach((action, index) => {
    const key = `${list}.${index}`;
    const row = create("div", "rule-row");
    row.appendChild(rowSelect(key));
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
  const preview = field("Preview", selectInput("rule.preview", [["auto", "Auto"], ["on", "Force on"],
    ["off", "Force off"]], rulePreview[rule.id] ?? "auto", value => setPreview(rule.id, value)));
  preview.title = "Only in this browser, until the editor closes. Use Side panel to watch the dashboard.";
  head.appendChild(preview);
  if (rulesDraft.folders.length) {
    head.appendChild(field("Folder", selectInput("rule.folder", [["", "None"],
      ...rulesDraft.folders.map(folder => [folder.id, folder.name])], rule.folder ?? "",
    value => editRules(() => { rulesDraft.rules = fileRule(rulesDraft.rules, rule, value || null); }))));
  }
  const index = rulesDraft.rules.indexOf(rule);
  head.appendChild(button("Duplicate", () => editRules(() => {
    const copy = { ...structuredCopy(rule), id: newRuleId(`${rule.name} copy`), name: `${rule.name} (copy)`.slice(0, 64) };
    rulesDraft.rules.splice(index + 1, 0, copy);
    rulesSelection = { kind: "rule", id: copy.id };
  })));
  const share = keyed(button("Share", () => {
    shareText = shareRules(layout, [rule.id]);
    renderRulesEditor();
  }), "rule.share");
  // Shared from the saved layout, which has the rule once its edits are valid.
  share.disabled = !layout.rules.some(saved => saved.id === rule.id);
  head.appendChild(share);
  head.appendChild(button("Delete", () => editRules(() => {
    rulesDraft.rules.splice(index, 1);
    for (const other of rulesDraft.rules) {
      other.when = other.when.filter(condition => !(condition.type === "ruleActive" && condition.rule === rule.id));
    }
    const next = rulesDraft.rules[Math.min(index, rulesDraft.rules.length - 1)];
    rulesSelection = next ? { kind: "rule", id: next.id } : null;
  }), "button quiet small danger"));
  box.appendChild(head);
  if (shareText) box.appendChild(shareBox(shareText, "this rule (and any rule it reads)"));
  const folder = rule.folder && rulesDraft.folders.find(entry => entry.id === rule.folder);
  if (folder && !folder.enabled) {
    box.appendChild(create("p", "rule-muted", `Its folder “${folder.name}” is turned off, so this rule is off too.`));
  }
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
  for (const [name, label, min] of [["delayMs", "Delay", 0], ["lingerMs", "Linger", MIN_LINGER_MILLIS]]) {
    row.appendChild(field(label, durationInput(`rule.${name}`, rule.timing[name], "ms",
      value => editRules(() => { rule.timing[name] = value; }, false), { min, max: MAX_TIMING_MILLIS })));
  }
  timing.appendChild(row);
  const animation = create("div", "rule-row");
  animation.appendChild(checkInput("rule.animation", "Own animation", rule.animation !== null, value => editRules(() => {
    rule.animation = value ? { ...rulesDraft.animation } : null;
  })));
  if (rule.animation) animationControls("rule.animation", rule.animation, animation);
  else animation.appendChild(create("span", "rule-muted", "Panels this rule moves, shows or hides use the global animation (Settings)."));
  timing.appendChild(animation);
  box.appendChild(timing);
  return box;
}

/** Duration and easing of an animation (the global one or a rule's override). */
function animationControls(key, animation, row) {
  row.appendChild(field("Duration", durationInput(`${key}.duration`, animation.durationMs, "ms",
    value => editRules(() => { animation.durationMs = value; }, false), { min: 0, max: MAX_ANIMATION_MILLIS })));
  row.appendChild(field("Easing", selectInput(`${key}.easing`, EASINGS.map(easing => [easing, easing]),
    animation.easing, value => editRules(() => { animation.easing = value; }, false))));
}

function setPreview(id, value) {
  const next = { ...rulePreview };
  if (value === "on" || value === "off") next[id] = value;
  else delete next[id];
  rulePreview = next;
  updateView();
  updateRulesLive();
}

function settingsDetail() {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", "Animation"));
  head.appendChild(create("span", "rule-muted",
    "How panels move, grow, shrink, fade and focus when rules change the layout. A rule can override it under Timing. With reduced motion turned on in your system, panels only cross-fade."));
  box.appendChild(head);
  const row = create("div", "rule-row");
  animationControls("animation", rulesDraft.animation, row);
  box.appendChild(row);
  const dwell = create("p", "rule-muted",
    `After a rule changes a panel, rules can't change that panel again for ${PANEL_DWELL_MILLIS / 1000} s, so nothing blinks.`);
  box.appendChild(dwell);
  return box;
}

function describeAction(action) {
  const panel = TILE_LABELS[action.panel];
  switch (action.do) {
    case "profile":
      return `Switch to ${action.profile === "default" ? "Default" : layout.profiles.find(profile =>
        profile.id === action.profile)?.name ?? action.profile}`;
    case "hide":
      return `Hide ${panel}${action.fill === "empty" ? " (leave empty)" : action.fill ? ` (${TILE_LABELS[action.fill]} fills)` : ""}`;
    case "place":
      return `Place ${panel} at column ${action.x + 1}, row ${action.y + 1}, ${action.w} × ${action.h}`;
    case "swap":
      return `Swap ${panel} and ${TILE_LABELS[action.with]}`;
    case "set":
      return `Set ${panel} ${action.setting} to ${JSON.stringify(action.value)}`;
    case "notify":
      return `Notify “${action.text}”`;
    default:
      return `${ACTION_LABELS[action.do].replace("panel", "")}${panel}`.replace("  ", " ");
  }
}

/** Every rule claiming a panel now, what it claims and which claim won. */
function inspectorDetail(panel) {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", `Inspector: ${TILE_LABELS[panel]}`));
  head.appendChild(create("span", "rule-muted", "Click any panel on the dashboard to inspect it."));
  box.appendChild(head);
  const tile = view.profile.tiles.find(entry => entry.id === panel);
  const mode = { off: "off", on: "shown", rules: "rules only" }[tileMode(tile)];
  box.appendChild(create("p", "", `In the ${view.profile.name} profile it is ${mode}. Now it is `
    + `${view.focus === panel ? "focused" : view.visible.has(panel) ? "shown" : "hidden"}.`));
  const claims = view.claims.filter(claim => claim.property === `visible:${panel}` || claim.property === `rect:${panel}`
    || claim.property.startsWith(`setting:${panel}.`) || claim.property === "focus" && claim.value === panel);
  if (!claims.length) box.appendChild(create("p", "empty-note", "No rule changes this panel right now."));
  for (const claim of claims) {
    const rule = layout.rules.find(entry => entry.id === claim.rule);
    const row = create("div", claim.won ? "rule-row ok" : "rule-row bad");
    row.appendChild(button(rule.name, () => {
      rulesSelection = { kind: "rule", id: rule.id };
      renderRulesEditor();
    }, "rules-nav-name inline"));
    row.appendChild(create("span", "rule-muted", claim.list === "then" ? "Then" : "Else"));
    row.appendChild(create("span", "", describeAction(rule[claim.list][claim.index])));
    row.appendChild(create("span", claim.won ? "badge" : "badge muted", claim.won ? "Wins" : "Overridden"));
    box.appendChild(row);
  }
  return box;
}

function folderDetail(folder) {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-detail-head");
  head.appendChild(field("Folder", textInput("folder.name", folder.name, value => editRules(() => {
    folder.name = value.trim().slice(0, 64);
  }, false)), "rule-field grow"));
  head.appendChild(checkInput("folder.enabled", "Enabled", folder.enabled, value => editRules(() => {
    folder.enabled = value;
  }, false)));
  const add = button("+ New rule here", () => addRule(blankRule(), folder.id), "button small");
  add.disabled = rulesDraft.rules.length >= MAX_RULES;
  head.appendChild(add);
  const rules = rulesDraft.rules.filter(rule => rule.folder === folder.id);
  const share = keyed(button("Share", () => {
    shareText = shareRules(layout, [], folder.id);
    renderRulesEditor();
  }), "folder.share");
  share.disabled = !layout.rules.some(rule => rule.folder === folder.id);
  head.appendChild(share);
  head.appendChild(button("Delete folder", () => editRules(() => {
    for (const rule of rulesDraft.rules) if (rule.folder === folder.id) rule.folder = null;
    rulesDraft.folders = rulesDraft.folders.filter(entry => entry !== folder);
    rulesSelection = null;
  }), "button quiet small danger"));
  box.appendChild(head);
  if (shareText) box.appendChild(shareBox(shareText, "this folder and its rules"));
  box.appendChild(create("p", "rule-muted", rules.length
    ? "Turning the folder off turns all its rules off. Deleting it keeps its rules, outside any folder. Its rules keep their place in the priority order."
    : "No rules in it yet. Add one here, or choose this folder under a rule's Folder."));
  for (const rule of rules) {
    box.appendChild(button(rule.name, () => {
      rulesSelection = { kind: "rule", id: rule.id };
      renderRulesEditor();
    }, "rules-nav-name inline block"));
  }
  return box;
}

/** "Add from template": each template adds an ordinary rule to change as you like. */
function templatesDetail() {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", "Add from template"));
  head.appendChild(create("span", "rule-muted", "Each adds a new rule at the end of the list, to change as you like."));
  box.appendChild(head);
  const draftLayout = { rules: rulesDraft.rules, profiles: layout.profiles };
  for (const template of RULE_TEMPLATES) {
    const preview = ruleFromTemplate(template, draftLayout);
    const row = create("div", "rule-row template");
    const text = create("div", "template-text");
    text.appendChild(create("strong", "", template.name));
    const when = preview.when.map((condition, index) => `${index === 0 ? "" : condition.join === "or" ? " or " : " and "}`
      + `${CONDITION_LABELS[condition.type]}${condition.for ? ` for ${condition.for} s` : ""}`).join("");
    text.appendChild(create("span", "rule-muted", `When ${when}: ${preview.then.map(describeAction).join(", ")}.`));
    text.appendChild(create("span", "rule-muted", template.note));
    row.appendChild(text);
    const add = keyed(button("Add", () => addRule(ruleFromTemplate(template, draftLayout)), "button small"),
      `template.${template.id}`);
    add.disabled = rulesDraft.rules.length >= MAX_RULES;
    row.appendChild(add);
    box.appendChild(row);
  }
  return box;
}

/**
 * Import and export: a share string or rule set (pasted, or from a file) is added, or with "Replace" put in place
 * of every rule, folder, place and toggle; the result lists the rules to open and any warnings. "Download all
 * rules" saves them as a rule set file (docs/RULE_SETS.md).
 */
function importDetail() {
  const box = create("div", "rule-detail");
  const head = create("div", "rule-section-head");
  head.appendChild(create("h3", "", "Import and export"));
  head.appendChild(create("span", "rule-muted",
    "Paste a share string (Share on a rule or folder) or a rule set file's JSON, or choose a .json file. The format is described in docs/RULE_SETS.md."));
  box.appendChild(head);
  const text = keyed(create("textarea", "rule-input share-input"), "import.text");
  text.rows = 6;
  text.placeholder = "minepanel-rules:1:…  or  { \"format\": \"minepanel-rules\", \"version\": 1, \"rules\": [ … ] }";
  box.appendChild(text);
  const replace = checkInput("import.replace", "Replace all rules, folders, places and toggles (and profiles, if the file has any)", importReplace,
    value => { importReplace = value; });
  replace.title = "Without this, imported rules are added at the end and nothing is replaced";
  const run = source => {
    try {
      const result = importShare({ ...layout, ...rulesDraft }, source, { replace: importReplace });
      // The whole layout, since a rule set can also arrange profiles.
      rulesCommitted = result.layout;
      rulesDraft = draftOf(result.layout);
      setHidden(rulesError, true);
      changeLayout(result.layout);
      const count = result.rules.length === 1 ? "1 rule" : `${result.rules.length} rules`;
      const folders = result.folders.length === 1 ? " in a new folder"
        : result.folders.length > 1 ? ` in ${result.folders.length} new folders` : "";
      importMessage = { ok: true, rules: result.rules, warnings: result.warnings,
        text: `${importReplace ? "Replaced everything with" : "Added"} ${count}${folders}.`
          + (result.profiles ? ` Arranged ${result.profiles === 1 ? "1 profile" : `${result.profiles} profiles`}.` : "") };
      importReplace = false;
    } catch (error) {
      importMessage = { ok: false, rules: [], warnings: [], text: error.message };
    }
    renderRulesEditor();
  };
  const file = keyed(create("input"), "import.file");
  file.type = "file";
  file.accept = "application/json,.json";
  setHidden(file, true);
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (chosen) run(await chosen.text());
  });
  const tools = create("div", "rule-add");
  tools.appendChild(button("Import", () => run(text.value), "button small"));
  tools.appendChild(button("Choose file…", () => file.click(), "button quiet small"));
  tools.appendChild(replace);
  tools.appendChild(file);
  box.appendChild(tools);
  if (importMessage) {
    box.appendChild(create("p", importMessage.ok ? "" : "rules-error", importMessage.text));
    if (importMessage.warnings.length) {
      const list = create("ul", "import-warnings");
      for (const warning of importMessage.warnings) list.appendChild(create("li", "", warning));
      box.appendChild(list);
    }
    for (const id of importMessage.rules) {
      const rule = rulesDraft.rules.find(entry => entry.id === id);
      if (rule) box.appendChild(button(rule.name, () => {
        rulesSelection = { kind: "rule", id };
        renderRulesEditor();
      }, "rules-nav-name inline block"));
    }
  }
  const exportHead = create("div", "rule-section-head rule-section");
  exportHead.appendChild(create("h3", "", "Export"));
  exportHead.appendChild(create("span", "rule-muted",
    "Every profile's panel arrangement, and every rule, folder, place and toggle, as a rule set file to keep, edit, or import on another dashboard."));
  box.appendChild(exportHead);
  const download = keyed(button("Download all rules", () => {
    const link = create("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(exportRuleSet(layout), null, 2)], { type: "application/json" }));
    link.download = "minepanel-rules.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "button small"), "export.download");
  download.disabled = layout.rules.length === 0;
  box.appendChild(download);
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

/** Adds a rule (into {@code folder}, after its rules) and selects it. */
function addRule(rule, folder = null) {
  editRules(() => {
    rule.folder = folder;
    rulesDraft.rules.splice(newRuleIndex(rulesDraft.rules, folder), 0, rule);
    rulesSelection = { kind: "rule", id: rule.id };
  });
}

function blankRule() {
  return { id: newRuleId(`rule-${rulesDraft.rules.length + 1}`), name: `Rule ${rulesDraft.rules.length + 1}`,
    enabled: true, folder: null, when: [], then: [], else: [], timing: { ...DEFAULT_TIMING }, animation: null };
}

/** Up / down buttons that are disabled when the move would change nothing. */
function moveButtons(item, move, what) {
  for (const [text, by, title] of [["↑", -1, `Higher priority${what}`], ["↓", 1, `Lower priority${what}`]]) {
    const moved = move(by);
    const control = button(text, () => editRules(() => { rulesDraft.rules = move(by); }), "button quiet tiny");
    control.title = title;
    control.disabled = moved === rulesDraft.rules;
    item.appendChild(control);
  }
}

function ruleNavItem(rule, inFolder) {
  const selected = rulesSelection?.kind === "rule" && rulesSelection.id === rule.id;
  const item = create("div", `rules-nav-item${selected ? " selected" : ""}${inFolder ? " in-folder" : ""}`);
  const dot = create("span", "rule-dot");
  liveRefs.rules.set(rule.id, dot);
  const name = keyed(button(rule.name || "(unnamed)", () => {
    rulesSelection = { kind: "rule", id: rule.id };
    renderRulesEditor();
  }, "rules-nav-name"), `nav.${rule.id}`);
  if (!rule.enabled) name.classList.add("disabled");
  item.appendChild(dot);
  item.appendChild(name);
  moveButtons(item, by => moveRuleInList(rulesDraft.rules, rule.id, by), inFolder ? " (within the folder)" : "");
  const next = rulesDraft.rules[rulesDraft.rules.indexOf(rule) + 1]?.id ?? null;
  navDraggable(item, { rule: rule.id }, (top, drag) => drag.rule
    ? { mark: top ? "before" : "after", drop: rules => dropRule(rules, drag.rule, top ? rule.id : next, rule.folder) }
    : { mark: top ? "before" : "after", drop: rules => dropFolder(rules, drag.folder, top ? rule.id : next) });
  return item;
}

function folderNavItem(folder, segmentIndex, segment) {
  const empty = segment.rules.length === 0;
  const selected = rulesSelection?.kind === "folder" && rulesSelection.id === folder.id;
  const item = create("div", `rules-nav-item folder${selected ? " selected" : ""}`);
  const caret = keyed(button(folder.collapsed ? "▸" : "▾", () => editRules(() => { folder.collapsed = !folder.collapsed; }),
    "button quiet tiny folder-caret"), `nav.folder.${folder.id}.${segmentIndex}.caret`);
  caret.title = folder.collapsed ? "Show its rules" : "Hide its rules";
  caret.setAttribute("aria-expanded", String(!folder.collapsed));
  const name = keyed(button(folder.name, () => {
    rulesSelection = { kind: "folder", id: folder.id };
    renderRulesEditor();
  }, "rules-nav-name"), `nav.folder.${folder.id}.${segmentIndex}`);
  if (!folder.enabled) name.classList.add("disabled");
  const enabled = keyed(create("input"), `nav.folder.${folder.id}.${segmentIndex}.enabled`);
  enabled.type = "checkbox";
  enabled.checked = folder.enabled;
  enabled.title = "Turn every rule in this folder on or off";
  enabled.addEventListener("change", () => editRules(() => { folder.enabled = enabled.checked; }));
  item.appendChild(caret);
  item.appendChild(enabled);
  item.appendChild(name);
  if (!empty) moveButtons(item, by => moveSegment(rulesDraft.rules, segmentIndex, by), " (the whole folder)");
  const first = segment.rules[0]?.id ?? null;
  const after = empty ? null : rulesDraft.rules[rulesDraft.rules.indexOf(segment.rules.at(-1)) + 1]?.id ?? null;
  // A rule dropped on the top half goes above the folder; on the bottom half, into it at the top.
  navDraggable(item, empty ? null : { folder: folder.id }, (top, drag) => drag.rule
    ? { mark: top ? "before" : "into", drop: rules => dropRule(rules, drag.rule, first, top ? null : folder.id) }
    : { mark: top ? "before" : "after", drop: rules => dropFolder(rules, drag.folder, top ? first : after) });
  return item;
}

// Dragging in the rule list: a rule (into or out of folders) or a folder with its rules. The ↑ / ↓ buttons do the
// same one step at a time.
let navDrag = null;
let navList = null;
let dropMark = null;

function markDrop(element, mark) {
  if (dropMark?.element === element && dropMark.mark === mark) return;
  clearDropMark();
  element.classList.add(`drop-${mark}`);
  dropMark = { element, mark };
}

function clearDropMark() {
  dropMark?.element.classList.remove(`drop-${dropMark.mark}`);
  dropMark = null;
}

/**
 * Makes a rule list row draggable (as {@code drag}, or not at all if null) and a drop target: {@code target(top,
 * drag)} gives the mark to draw and the function that reorders the rule list, for a drop on its top or bottom half.
 */
function navDraggable(item, drag, target) {
  if (drag) {
    item.draggable = true;
    item.classList.add("draggable");
    item.prepend(create("span", "rules-nav-grip", "⠿"));
    item.title = "Drag to reorder";
    item.addEventListener("dragstart", event => {
      navDrag = drag;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "");
      item.classList.add("dragged");
      navList?.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      navDrag = null;
      item.classList.remove("dragged");
      clearDropMark();
      navList?.classList.remove("dragging");
    });
  }
  navDropTarget(item, (event, dragged) => {
    const box = item.getBoundingClientRect();
    return target(event.clientY < box.top + box.height / 2, dragged);
  });
}

/** Lets the dragged rule or folder be dropped on {@code element}; {@code place(event, drag)} says where. */
function navDropTarget(element, place) {
  element.addEventListener("dragover", event => {
    if (!navDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    markDrop(element, place(event, navDrag).mark);
  });
  element.addEventListener("dragleave", event => {
    if (dropMark?.element === element && !element.contains(event.relatedTarget)) clearDropMark();
  });
  element.addEventListener("drop", event => {
    if (!navDrag) return;
    event.preventDefault();
    const { drop } = place(event, navDrag);
    navDrag = null;
    dropMark = null;
    editRules(() => { rulesDraft.rules = drop(rulesDraft.rules); });
  });
}

/** The left column: rules in priority order (grouped in folders), then places, toggles and recent activity. */
function renderRuleList() {
  liveRefs.rules = new Map();
  const list = create("div", "rules-nav");
  navList = list;
  const head = create("div", "rules-nav-head");
  head.appendChild(create("span", "rule-label", "Rules"));
  const add = button("+ New rule", () => addRule(blankRule()), "button small");
  add.disabled = rulesDraft.rules.length >= MAX_RULES;
  head.appendChild(add);
  list.appendChild(head);
  const more = create("div", "rules-nav-tools");
  const addFolder = button("+ Folder", () => editRules(() => {
    const number = rulesDraft.folders.length + 1;
    const id = uniqueId(`folder-${number}`, new Set(rulesDraft.folders.map(folder => folder.id)));
    rulesDraft.folders.push({ id, name: `Folder ${number}`, enabled: true, collapsed: false });
    rulesSelection = { kind: "folder", id };
  }), "button quiet small");
  addFolder.disabled = rulesDraft.folders.length >= MAX_FOLDERS;
  more.appendChild(addFolder);
  for (const [kind, label] of [["templates", "From template"], ["import", "Import / export"]]) {
    more.appendChild(keyed(button(label, () => {
      rulesSelection = { kind };
      renderRulesEditor();
    }, rulesSelection?.kind === kind ? "button small" : "button quiet small"), `nav.${kind}`));
  }
  list.appendChild(more);
  list.appendChild(create("p", "rule-muted", "Higher rules win when two change the same thing."));
  if (!rulesDraft.rules.length && !rulesDraft.folders.length) list.appendChild(create("p", "empty-note", "No rules yet."));
  ruleSegments(rulesDraft.rules, rulesDraft.folders).forEach((segment, index) => {
    const folder = segment.folder && rulesDraft.folders.find(entry => entry.id === segment.folder);
    if (!folder) {
      list.appendChild(ruleNavItem(segment.rules[0], false));
      return;
    }
    list.appendChild(folderNavItem(folder, index, segment));
    if (!folder.collapsed) segment.rules.forEach(rule => list.appendChild(ruleNavItem(rule, true)));
  });
  if (rulesDraft.rules.length) {
    const end = create("div", "rules-nav-end", "Drop here to put it last, outside any folder");
    navDropTarget(end, (event, drag) => ({ mark: "into",
      drop: rules => drag.rule ? dropRule(rules, drag.rule, null, null) : dropFolder(rules, drag.folder, null) }));
    list.appendChild(end);
  }
  for (const [kind, label] of [["places", `Places (${rulesDraft.places.length})`],
    ["toggles", `Toggles (${rulesDraft.toggles.length})`], ["settings", "Settings"]]) {
    const item = create("div", rulesSelection?.kind === kind ? "rules-nav-item selected section" : "rules-nav-item section");
    item.appendChild(keyed(button(label, () => {
      rulesSelection = { kind };
      renderRulesEditor();
    }, "rules-nav-name"), `nav.${kind}`));
    list.appendChild(item);
  }
  list.appendChild(create("p", "rule-muted", rulesDocked
    ? "Click a panel on the dashboard to see which rules change it."
    : "Use Side panel to watch the dashboard while you preview rules or inspect panels."));
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
  liveRefs.blocks = [];
  if (rulesSelection?.kind === "rule" && !selectedRule()) rulesSelection = null;
  const folder = rulesSelection?.kind === "folder" ? rulesDraft.folders.find(entry => entry.id === rulesSelection.id) : null;
  if (rulesSelection?.kind === "folder" && !folder) rulesSelection = null;
  if (!rulesSelection && rulesDraft.rules.length) rulesSelection = { kind: "rule", id: rulesDraft.rules[0].id };
  const rule = selectedRule();
  const kind = rulesSelection?.kind;
  // Selected rows and a shown share string belong to what was selected when they were made.
  const shown = `${kind}:${rulesSelection?.id ?? ""}`;
  if (shown !== shownSelection) {
    shownSelection = shown;
    selectedRows = new Set();
    shareText = null;
    importMessage = null;
  }
  rulesDetail.replaceChildren(rule ? ruleDetail(rule) : folder ? folderDetail(folder) : kind === "places" ? placesDetail()
    : kind === "toggles" ? togglesDetail() : kind === "settings" ? settingsDetail()
      : kind === "templates" ? templatesDetail() : kind === "import" ? importDetail()
        : kind === "inspect" ? inspectorDetail(rulesSelection.panel)
          : create("p", "empty-note", "Add a rule with “+ New rule”."));
  for (const id of TILE_IDS) tileElements[id].classList.toggle("inspected", kind === "inspect" && rulesSelection.panel === id);
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
    dot.className = `rule-dot${state?.active ? " active" : state?.enabled === false ? " off" : ""}${state?.forced ? " forced" : ""}`;
    dot.title = `${state?.active ? "Active now" : state?.enabled === false ? "Disabled" : "Not active"}`
      + `${state?.forced ? ` (forced ${state.forced} in this browser)` : ""}`;
  }
  const state = rulesSelection?.kind === "rule" ? ruleEvaluation?.states.get(rulesSelection.id) : null;
  liveRefs.blocks.forEach((block, index) => {
    const ok = state?.blocks[index];
    block.classList.toggle("ok", ok === true);
    block.classList.toggle("bad", ok === false);
  });
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

/** Starts the editor over from the current layout. */
function resyncRules() {
  stopPlacing();
  rulesDraft = draftOf(layout);
  rulesCommitted = layout;
  setHidden(rulesError, true);
  renderRulesEditor();
}

function setRulesDialog(open) {
  if (open === !rulesDialog.hidden) return;
  if (open) {
    // The dashboard shows what the rules do while the editor is open; customizing resumes when it closes.
    customizingBeforeRules = editing;
    if (editing) setEditing(false);
    setHidden(rulesDialog, false);
    resyncRules();
    return;
  }
  stopPlacing();
  setRulesDocked(false);
  setHidden(rulesDialog, true);
  for (const id of TILE_IDS) tileElements[id].classList.remove("inspected");
  if (rulesSelection?.kind === "inspect") rulesSelection = null;
  saveKnownIds();
  const previewing = Object.keys(rulePreview).length > 0;
  rulePreview = {};
  if (customizingBeforeRules) setEditing(true);
  else if (previewing) updateView();
}

function setRulesDocked(docked) {
  rulesDocked = docked;
  rulesDialog.classList.toggle("docked", docked);
  document.documentElement.classList.toggle("rules-docked", docked);
  writeText(rulesDock, docked ? "Full screen" : "Side panel");
  rulesDock.setAttribute("aria-pressed", String(docked));
  if (!docked) stopPlacing();
  if (!rulesDialog.hidden) renderRuleList();
}

$("#rules-open").addEventListener("click", () => setRulesDialog(true));
$("#rules-dialog-close").addEventListener("click", () => setRulesDialog(false));
rulesDock.addEventListener("click", () => setRulesDocked(!rulesDocked));
rulesDialog.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (placing) stopPlacing();
  else setRulesDialog(false);
});

// While docked, clicking a panel inspects it instead of using it.
grid.addEventListener("click", event => {
  if (rulesDialog.hidden || !rulesDocked || placing) return;
  const tile = event.target.closest?.(".tile");
  if (!tile?.dataset.tile) return;
  event.preventDefault();
  event.stopPropagation();
  rulesSelection = { kind: "inspect", panel: tile.dataset.tile };
  renderRulesEditor();
}, true);

// ------------------------------------------------------------------------------------------- Place on grid

/**
 * "Set on grid" for a Place action: docks the editor and shows the panel's ghost over the live dashboard, to drag
 * (move) and resize by its corner, then Set or Cancel.
 */
function startPlacing(action) {
  stopPlacing();
  setRulesDocked(true);
  const ghost = create("div", "place-ghost");
  const rect = { x: action.x, y: action.y, w: action.w, h: action.h };
  const label = create("span", "place-ghost-label");
  const tools = create("span", "place-ghost-tools");
  tools.appendChild(button("Set", () => {
    const { x, y, w, h } = placing.rect;
    editRules(() => Object.assign(action, { x, y, w, h }));
    stopPlacing();
  }, "button small"));
  tools.appendChild(button("Cancel", stopPlacing, "button quiet small"));
  const handle = create("span", "resize-handle");
  ghost.appendChild(label);
  ghost.appendChild(tools);
  ghost.appendChild(handle);
  const draw = () => {
    ghost.style.setProperty("--grid-column", `${rect.x + 1} / span ${rect.w}`);
    ghost.style.setProperty("--grid-row", `${rect.y + 1} / span ${rect.h}`);
    writeText(label, `${TILE_LABELS[action.panel]} · column ${rect.x + 1}, row ${rect.y + 1}, ${rect.w} × ${rect.h}`);
  };
  let dragging = null;
  const start = (event, mode) => {
    if (event.button !== 0 || event.target.closest?.(".place-ghost-tools")) return;
    const box = ghost.getBoundingClientRect();
    dragging = { mode, metrics: gridMetrics(), offsetX: event.clientX - box.left, offsetY: event.clientY - box.top };
    ghost.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  ghost.addEventListener("pointerdown", event => start(event, "move"));
  handle.addEventListener("pointerdown", event => start(event, "resize"));
  ghost.addEventListener("pointermove", event => {
    if (!dragging) return;
    const { metrics } = dragging;
    const minimum = TILE_MINIMUMS[action.panel];
    if (dragging.mode === "move") {
      rect.x = clamp(Math.round((event.clientX - metrics.left - dragging.offsetX) / metrics.columnStride), 0,
        LAYOUT_COLUMNS - rect.w);
      rect.y = clamp(Math.round((event.clientY - metrics.top - dragging.offsetY) / metrics.rowStride), 0, LAYOUT_MAX_Y);
    } else {
      rect.w = clamp(Math.round((event.clientX - metrics.left - rect.x * metrics.columnStride + GRID_GAP)
        / metrics.columnStride), minimum.w, LAYOUT_COLUMNS - rect.x);
      rect.h = clamp(Math.round((event.clientY - metrics.top - rect.y * metrics.rowStride + GRID_GAP)
        / metrics.rowStride), minimum.h, LAYOUT_MAX_H);
    }
    draw();
  });
  const end = () => { dragging = null; };
  ghost.addEventListener("pointerup", end);
  ghost.addEventListener("pointercancel", end);
  draw();
  grid.appendChild(ghost);
  placing = { ghost, rect, action };
}

function stopPlacing() {
  if (!placing) return;
  placing.ghost.remove?.();
  placing = null;
}

// ------------------------------------------------------------------------------------ Toggles and notifications

const toggleBar = $("#rule-toggles");
const togglesButton = $("#toggles-menu-button");
const toastList = $("#rule-toasts");
const TOAST_MILLIS = 6000;
const MAX_TOASTS = 4;

/**
 * Named toggles in the toolbar's Toggles dropdown; clicking one flips it (saved with the layout). "All off" turns
 * every toggle off, so the dashboard goes back to what the other rules (or Default) show.
 */
function renderToggleBar() {
  const on = layout.toggles.filter(toggle => toggle.on).length;
  writeText(togglesButton, on ? `Toggles (${on} on) ▾` : "Toggles ▾");
  if (!layout.toggles.length) {
    toggleBar.replaceChildren(create("span", "dropdown-note", "No toggles yet. Make them in Rules… → Toggles."));
    return;
  }
  const chips = layout.toggles.map(toggle => {
    const chip = button(toggle.name, () => changeLayout({ ...layout, toggles: layout.toggles.map(entry =>
      entry.id === toggle.id ? { ...entry, on: !entry.on } : entry) }), "chip small");
    chip.setAttribute("aria-pressed", String(toggle.on));
    chip.title = `Toggle “${toggle.name}” (used by rule conditions)`;
    return chip;
  });
  const reset = button("All off", () => changeLayout({ ...layout,
    toggles: layout.toggles.map(entry => ({ ...entry, on: false })) }), "chip small toggle-reset");
  reset.disabled = !layout.toggles.some(toggle => toggle.on);
  reset.title = "Turn every toggle off";
  toggleBar.replaceChildren(...chips, reset);
}

/** Notify actions: a short message that fades away. No sound. */
function showRuleToasts(notifications) {
  for (const notification of notifications) {
    const toast = create("div", "rule-toast", notification.text);
    toast.setAttribute("role", "status");
    toastList.appendChild(toast);
    while (toastList.children.length > MAX_TOASTS) {
      const oldest = toastList.children[0];
      if (oldest.remove) oldest.remove();
      else toastList.children.splice(0, 1);
    }
    window.setTimeout(() => {
      toast.classList.add("leaving");
      window.setTimeout(() => toast.remove?.(), 400);
    }, TOAST_MILLIS);
  }
}

// ------------------------------------------------------------------------------------------------- Wiring

featureHooks.render.push(player => {
  renderPortal(player);
  renderMovement(player);
  renderXp(player);
  renderPerformance(player);
  renderAfk(player);
  renderPickups(player);
  renderBuild(player);
  renderAdvancements(player);
  checkAdvancementPopup(player);
  renderVillagers(player);
  renderWindows(player);
  learnIds(player);
});
featureHooks.notify.push(showRuleToasts);
featureHooks.layout.push(() => {
  renderMovement(currentPlayerState);
  renderXp(currentPlayerState);
  renderXpSettings();
  renderPerformance(currentPlayerState);
  renderAfk(currentPlayerState);
  renderPickups(currentPlayerState);
  renderPickupSettings();
  renderBuild(currentPlayerState);
  renderAdvancements(currentPlayerState);
  renderAdvancementSettings();
  syncPinnedWindows();
  renderToggleBar();
  // The layout changed from elsewhere (loaded, imported, reset, a toggle flipped): start the open editor over
  // from it, unless it holds an edit that isn't valid yet.
  if (!rulesDialog.hidden && layout !== rulesCommitted && rulesError.hidden) resyncRules();
});
featureHooks.tick.push(() => {
  renderAfk(currentPlayerState);
  renderPickups(currentPlayerState);
  saveKnownIds();
  if (rulesDialog.hidden) return;
  // Customizing pauses the rules (it can be started while the editor is docked), but the editor stays live.
  if (editing) evaluateView(currentPlayerState, Date.now());
  updateRulesLive();
  // The inspector has no inputs, so it can simply be redrawn with the latest claims.
  if (rulesSelection?.kind === "inspect") rulesDetail.replaceChildren(inspectorDetail(rulesSelection.panel));
});

// Panels that only appear on demand start hidden (the markup says so too).
for (const element of [xpParts.menu, performanceParts.menu, xpParts.form, pickupParts.form, advancementParts.form, advancementParts.popup, portalBox,
  villagerParts.nav, rulesDialog, portalLink, playerMenu, playerLinkDialog]) {
  setHidden(element, true);
}
featureHooks.layout.forEach(hook => hook());
