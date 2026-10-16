"use strict";

// Pure game logic for the dashboard: rule evaluation, navigation arrows and experience maths. No DOM access here.

// ----------------------------------------------------------------------------------------------- Navigation

const COMPASS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
const COMPASS_WORDS = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west",
  W: "west", NW: "north-west" };

/** Minecraft's yaw toward {@code to}: 0 = south (+Z), 90 = west (−X), 180 = north, 270 = east. */
function bearingTo(from, to) {
  const degrees = Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI;
  return (degrees % 360 + 360) % 360;
}

/** How far to turn from facing {@code yaw} to face {@code bearing}: 0 = ahead, 90 = right, 270 = left. */
function relativeBearing(yaw, bearing) {
  return ((bearing - yaw) % 360 + 360) % 360;
}

/** The compass point for a yaw, e.g. 135 → "NW". */
function compassPoint(yaw) {
  return COMPASS[Math.round(((yaw % 360) + 360) % 360 / 45) % 8];
}

function horizontalDistance(from, to) {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** "3 E and 6 S": how to move from {@code from} to reach {@code to} along the axes (east = +X, south = +Z). */
function axisDirections(from, to) {
  const dx = Math.round(to.x - from.x);
  const dz = Math.round(to.z - from.z);
  const parts = [];
  if (dx !== 0) parts.push(`${Math.abs(dx)} ${dx > 0 ? "E" : "W"}`);
  if (dz !== 0) parts.push(`${Math.abs(dz)} ${dz > 0 ? "S" : "N"}`);
  return parts.join(" and ");
}

/** Where a portal must be built and how close the player's latest obsidian is to it (X/Z only). */
const PORTAL_TOLERANCE = 4;

function obsidianCheck(portal) {
  const crossing = portal?.crossing;
  const block = portal?.obsidian?.at(-1);
  if (!crossing || !block || block.at < crossing.at) return null;
  const distance = horizontalDistance(block, crossing.target);
  return { block, distance, ok: distance <= PORTAL_TOLERANCE, move: axisDirections(block, crossing.target) };
}

// -------------------------------------------------------------------------------------------- Experience

/** Points needed to go from {@code level} to the next level (matches the game). */
function xpForNextLevel(level) {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

/** Total points at the start of {@code level}. */
function xpAtLevel(level) {
  if (level <= 16) return level * level + 6 * level;
  if (level <= 31) return (5 * level * level - 81 * level + 720) / 2;
  return (9 * level * level - 325 * level + 4440) / 2;
}

function xpPerHour(xp, window) {
  return (xp?.gained?.[window] ?? 0) / window * 3600;
}

/** Seconds to gain {@code points} at {@code perHour}, or null when no XP is coming in. */
function secondsToGain(points, perHour) {
  return perHour > 0 ? Math.max(0, points) / perHour * 3600 : null;
}

function nextHundred(level) {
  return (Math.floor(level / 100) + 1) * 100;
}

// ------------------------------------------------------------------------------------------------ Rules

// Rules v2 (docs/RULES_V2.md; the stored format is validated in layout.js). Conditions are evaluated against the
// latest player snapshot; the engine remembers what timing needs (modifiers, delay, linger, counters), and "now" is
// always passed in so tests can drive time.

const DIMENSION_ALIASES = { overworld: "minecraft:overworld", nether: "minecraft:the_nether",
  the_nether: "minecraft:the_nether", end: "minecraft:the_end", the_end: "minecraft:the_end" };
/** Below this total speed (blocks per second) the player counts as still; looking around never counts. */
const STILL_SPEED = 0.1;
const MAX_ACTIVITY_LOG = 100;
const MAX_COUNTER_SAMPLES = 512;
/** A portal crossing that lands this close to where the previous one started went back through the same pair. */
const RETURN_TRIP_DISTANCE = 16;
const ARMOR_SLOTS = ["head", "chest", "legs", "feet"];
const SPEED_KEYS = { total: "speed", horizontal: "horizontalSpeed", vertical: "verticalSpeed" };

const namespaced = value => {
  const lower = value.trim().toLowerCase();
  return lower.includes(":") ? lower : `minecraft:${lower.replace(/\s+/g, "_")}`;
};

function timeOfDay(ticks) {
  if (ticks >= 23000 || ticks < 1000) return "dawn";
  if (ticks < 12000) return "day";
  if (ticks < 13000) return "dusk";
  return "night";
}

/** The most recent time an event of one of {@code categories} was logged, 0 if never, or null without history. */
function lastEventAt(player, categories) {
  const events = player?.history?.events;
  if (!events) return null;
  for (let index = events.length - 1; index >= 0; index--) {
    if (categories.includes(events[index].category)) return events[index].timestamp;
  }
  return 0;
}

const COMPARISONS = {
  "<": (actual, condition) => actual < condition.value,
  "<=": (actual, condition) => actual <= condition.value,
  "=": (actual, condition) => actual === condition.value,
  ">=": (actual, condition) => actual >= condition.value,
  ">": (actual, condition) => actual > condition.value,
  "!=": (actual, condition) => actual !== condition.value,
  between: (actual, condition) => actual >= condition.value && actual <= condition.value2
};

/** Whether {@code actual} passes a compare/value(/value2) check, or null when the value is unknown. */
function compareValue(actual, condition) {
  return typeof actual === "number" && !Number.isNaN(actual) ? COMPARISONS[condition.compare](actual, condition) : null;
}

const UNKNOWN = Object.freeze({ holds: null, value: null });
const outcome = (holds, value = null) => ({ holds, value });
const compared = (actual, condition) => outcome(compareValue(actual, condition), actual ?? null);

function eventWithin(at, condition, now) {
  if (at === null) return UNKNOWN;
  const seconds = at > 0 ? Math.max(0, (now - at) / 1000) : null;
  return outcome(seconds !== null && seconds <= condition.within, seconds);
}

const durabilityPercent = item => !item || item.empty || !item.maxDamage ? null
  : item.remainingDurability / item.maxDamage * 100;

/** Inventory slots, armor and offhand (mainhand is the selected slot), plus the ender chest when asked and known. */
function carriedItems(player, enderChest) {
  const { slots, equipment } = player.inventory;
  const items = [...slots, ...ARMOR_SLOTS.map(key => equipment[key]), equipment.offhand];
  if (enderChest && player.enderChest) items.push(...player.enderChest.slots);
  return items.filter(item => !item.empty);
}

function nearPlace(condition, player, places) {
  const target = condition.place ? places.get(condition.place) : condition;
  if (!target) return UNKNOWN;
  if (target.world !== undefined && target.world.toLowerCase() !== player.world.name.toLowerCase()
    || target.dimension !== undefined && target.dimension !== player.dimension) {
    return outcome(false);
  }
  const position = player.position;
  if (condition.x2 !== undefined) {
    const inside = ["x", "y", "z"].every(axis => {
      const ends = [Math.floor(target[axis]), Math.floor(condition[`${axis}2`])];
      const block = Math.floor(position[axis]);
      return block >= Math.min(...ends) && block <= Math.max(...ends);
    });
    return outcome(inside);
  }
  const distance = condition.flat ? Math.hypot(position.x - target.x, position.z - target.z)
    : Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
  return outcome(distance <= condition.radius, distance);
}

function effectCondition(condition, player, now) {
  const wanted = new Set(condition.values.map(namespaced));
  const effects = player.effects.filter(effect => wanted.has(effect.id));
  const remaining = effect => effect.endsAt === null ? Infinity : Math.max(0, (effect.endsAt - now) / 1000);
  const fits = effect => (condition.level === undefined || compareValue(effect.amplifier + 1, condition.level))
    && (condition.remaining === undefined || compareValue(remaining(effect), condition.remaining));
  return outcome(effects.some(fits), effects.map(effect => effect.name).join(", ") || null);
}

function durabilityCondition(condition, player) {
  const { slots, equipment } = player.inventory;
  const items = condition.target === "held" ? [equipment.mainhand]
    : condition.target === "armor" ? ARMOR_SLOTS.map(key => equipment[key]) : [...slots, equipment.offhand];
  const percents = items.map(durabilityPercent).filter(percent => percent !== null);
  if (percents.length === 0) return UNKNOWN;
  return outcome(percents.some(percent => compareValue(percent, condition)), Math.min(...percents));
}

const clockMinutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));

/** Between two wall-clock times (the end excluded; overnight spans wrap), optionally on some weekdays (0 = Sunday). */
function clockCondition(condition, clock) {
  if (!clock) return UNKNOWN;
  const from = clockMinutes(condition.from);
  const to = clockMinutes(condition.to);
  const now = clock.minutes;
  const inside = from === to || (from < to ? now >= from && now < to : now >= from || now < to);
  return outcome(inside && (!condition.days || condition.days.includes(clock.weekday)), clock.minutes);
}

function portalCondition(condition, player, ctx) {
  const crossing = player.portal?.crossing;
  if (!crossing) return outcome(false);
  const age = Math.max(0, (ctx.now - crossing.at) / 1000);
  return outcome(player.dimension === crossing.toDimension && player.portal.lit === null
    && !ctx.returnTrip(crossing.id) && age <= condition.minutes * 60, age);
}

/** Entities the mod saw within {@code radius} that pass {@code accept}: their count and the nearest distance. */
function nearbyCount(sensors, radius, accept) {
  if (!sensors.nearby) return null;
  const found = sensors.nearby.entities.filter(entity => entity.distance <= radius && accept(entity));
  return { count: found.length, nearest: found[0]?.distance ?? null };
}

/**
 * Conditions on the mod's rule sensors (docs/RULES_V2.md, phase 4). Light, look target, nearby entities and the
 * screen are only sent while an enabled rule reads them, so they are unknown until the mod has picked that up.
 */
function sensorCondition(condition, sensors) {
  const values = condition.values ?? [];
  switch (condition.type) {
    case "moonPhase": {
      const phase = RULE_CHOICES.moonPhase[sensors.moonPhase];
      return outcome(values.includes(phase), phase);
    }
    case "light":
      return sensors.light ? compared(sensors.light[condition.source], condition) : UNKNOWN;
    case "spawnDistance":
      return compared(sensors.spawnDistance, condition);
    case "lookingAt": {
      const look = sensors.look;
      if (!look) return UNKNOWN;
      return outcome(look.kind === condition.target && look.distance <= condition.distance
        && (!condition.id || look.id === condition.id), look.id ?? "nothing");
    }
    case "air":
      // Seconds of air left (the game counts ticks).
      return compared(Math.max(0, sensors.air) / 20, condition);
    case "armor":
      return compared(sensors.armor, condition);
    case "riding":
      return outcome(sensors.riding !== null && (!condition.entity || sensors.riding === condition.entity),
        sensors.riding);
    case "usingItem":
      return outcome(values.includes(sensors.using), sensors.using);
    case "hostilesNearby": {
      const found = nearbyCount(sensors, condition.radius, entity => entity.hostile
        && (!condition.entity || entity.type === condition.entity));
      return found ? compared(found.count, condition) : UNKNOWN;
    }
    case "mobNearby": {
      const found = nearbyCount(sensors, condition.radius, entity => entity.type === condition.entity);
      return found ? outcome(found.count > 0, found.nearest) : UNKNOWN;
    }
    case "playersNearby": {
      const found = nearbyCount(sensors, condition.radius, entity => entity.type === "minecraft:player");
      return found ? compared(found.count, condition) : UNKNOWN;
    }
    case "screen":
      return sensors.screen === null ? UNKNOWN : outcome(values.includes(sensors.screen), sensors.screen);
    default:
      // The yes/no states: onFire, inWater, inLava, inRain, sneaking, sprinting, sleeping, bossBar, raid.
      return outcome(sensors[condition.type] === true, sensors[condition.type] === true);
  }
}

/** The counter an "amount within W s" condition reads (see createCounters), or null when it needs none. */
function counterKey(condition) {
  switch (condition.type) {
    case "xpGained":
      // The mod reports gains over its fixed windows exactly; other windows are sampled here.
      return XP_WINDOW_CHOICES.includes(condition.window) ? null : "xp";
    case "tookDamage":
      return "health";
    case "statRose":
      return `stat:${condition.stat}`;
    case "minedBlock":
      return condition.block ? `stat:minecraft:mined/${condition.block}` : "history:mine";
    case "placedBlock":
      return condition.block ? `stat:minecraft:used/${condition.block}` : "history:place";
    case "killedMob":
      return "history:kill";
    default:
      return null;
  }
}

/**
 * Whether one condition holds, before its timing modifier and "not", and the live value it looked at (for the
 * editor). {@code holds} is null when unknown: the player isn't in a world (except for meta conditions) or the
 * data isn't available, and an unknown condition never counts as true, even with "not".
 */
function evaluateCondition(condition, ctx) {
  const { player, now } = ctx;
  if (!CONDITION_TYPES[condition.type].meta && !player?.available) return UNKNOWN;
  const values = condition.values ?? [];
  switch (condition.type) {
    case "world": {
      const name = player.world.name.toLowerCase();
      return outcome(values.some(value => [name, player.world.kind].includes(value.trim().toLowerCase())),
        player.world.name);
    }
    case "dimension":
      return outcome(values.some(value =>
        (DIMENSION_ALIASES[value.trim().toLowerCase()] ?? namespaced(value)) === player.dimension), player.dimension);
    case "biome":
      return outcome(values.some(value => namespaced(value) === player.world.biome), player.world.biome);
    case "time": {
      const ticks = player.world.time;
      if (!condition.ticks) return outcome(values.includes(timeOfDay(ticks)), timeOfDay(ticks));
      const { from, to } = condition.ticks;
      return outcome(from <= to ? ticks >= from && ticks <= to : ticks >= from || ticks <= to, ticks);
    }
    case "weather":
      return outcome(values.includes(player.world.weather), player.world.weather);
    case "day":
      return compared(player.world.day, condition);
    case "gameMode":
      return outcome(values.includes(player.world.gameMode), player.world.gameMode);
    case "nearPlace":
      return nearPlace(condition, player, ctx.places);
    case "yLevel":
      return compared(player.position.y, condition);
    case "health":
    case "food":
    case "saturation":
    case "absorption":
      return compared(player[condition.type], condition);
    case "xpLevel":
      return compared(player.xp?.level, condition);
    case "effect":
      return effectCondition(condition, player, now);
    case "movement":
      return outcome(values.includes(player.motion.mode), player.motion.mode);
    case "speed":
      return compared(player.motion[SPEED_KEYS[condition.axis]], condition);
    case "still":
      return outcome(player.motion.speed < STILL_SPEED, player.motion.speed);
    case "holding": {
      const { mainhand, offhand } = player.inventory.equipment;
      const hands = condition.hand === "main" ? [mainhand] : condition.hand === "off" ? [offhand] : [mainhand, offhand];
      return outcome(hands.some(item => !item.empty && item.itemId === condition.item),
        mainhand.empty ? null : mainhand.itemId);
    }
    case "hasItem":
      return compared(carriedItems(player, condition.enderChest).filter(item => item.itemId === condition.item)
        .reduce((sum, item) => sum + item.count, 0), condition);
    case "freeSlots":
      return compared(player.inventory.slots.filter(slot => slot.empty).length, condition);
    case "durability":
      return durabilityCondition(condition, player);
    case "elytra":
      return outcome(player.motion.glider !== null, player.motion.glider?.name ?? null);
    case "xpGained":
      return compared(counterKey(condition) ? ctx.amount("xp", condition.window)
        : player.xp?.gained[condition.window], condition);
    case "pickedUp": {
      if (!Array.isArray(player.pickups)) return UNKNOWN;
      const since = now - condition.window * 1000;
      return compared(player.pickups.filter(pickup => pickup.count > 0 && pickup.at >= since
        && (!condition.item || pickup.item.itemId === condition.item)).reduce((sum, pickup) => sum + pickup.count, 0),
      condition);
    }
    case "statRose":
    case "minedBlock":
    case "placedBlock":
    case "killedMob":
      return compared(ctx.amount(counterKey(condition), condition.window, condition.entity), condition);
    case "tookDamage": {
      const health = ctx.amount("health", condition.window);
      return compared(health === null ? null : health / 2, condition);
    }
    case "advancement": {
      const entries = player.advancements?.entries;
      if (condition.advancement) {
        const entry = entries?.find(value => value.id === condition.advancement);
        return entry ? eventWithin(entry.doneAt ?? 0, condition, now) : UNKNOWN;
      }
      const earned = (entries ?? []).reduce((latest, entry) => Math.max(latest, entry.doneAt ?? 0), 0);
      const logged = lastEventAt(player, ["advancement"]);
      return eventWithin(logged === null && !entries ? null : Math.max(earned, logged ?? 0), condition, now);
    }
    case "died":
      return eventWithin(lastEventAt(player, ["death"]), condition, now);
    case "changedDimension":
      return eventWithin(lastEventAt(player, ["dimension"]), condition, now);
    case "inCombat":
      return eventWithin(lastEventAt(player, ["damage", "kill", "death"]), condition, now);
    case "joinedWorld":
      return outcome(player.sessionSeconds <= condition.within, player.sessionSeconds);
    case "villagersNearby": {
      const { x, y, z } = player.position;
      return compared((player.villagers ?? []).filter(villager => villager.dimension === player.dimension
        && Math.hypot(villager.x - x, villager.y - y, villager.z - z) <= condition.radius).length, condition);
    }
    case "portalLinking":
      return portalCondition(condition, player, ctx);
    case "moonPhase":
    case "light":
    case "spawnDistance":
    case "lookingAt":
    case "air":
    case "armor":
    case "onFire":
    case "inWater":
    case "inLava":
    case "inRain":
    case "sneaking":
    case "sprinting":
    case "sleeping":
    case "riding":
    case "usingItem":
    case "hostilesNearby":
    case "mobNearby":
    case "playersNearby":
    case "bossBar":
    case "raid":
    case "screen":
      return player.sensors ? sensorCondition(condition, player.sensors) : UNKNOWN;
    case "toggle":
      return outcome(ctx.toggles.get(condition.toggle) === true);
    case "ruleActive":
      return outcome(ctx.ruleActive(condition.rule));
    case "width":
      return compared(ctx.width, condition);
    case "realTime":
      return clockCondition(condition, ctx.clock);
    case "sessionTime":
      return compared(player.sessionSeconds / 60, condition);
    case "inGame":
      return outcome(Boolean(player?.available));
    default:
      return UNKNOWN;
  }
}

/**
 * Applies a condition's "for" / "within" modifier, then "not". {@code memory} holds when it became true ("for")
 * or was last true ("within"). Events evaluate "within" themselves, against their own timestamps.
 */
function applyModifier(condition, result, memory, now) {
  let holds = result.holds;
  if (holds === null) {
    memory.trueSince = null;
  } else if (condition.for !== undefined) {
    if (!holds) memory.trueSince = null;
    else if (memory.trueSince === null) memory.trueSince = now;
    holds = holds && now - memory.trueSince >= condition.for * 1000;
  } else if (condition.within !== undefined && CONDITION_TYPES[condition.type].kind !== "event") {
    if (holds) memory.lastTrue = now;
    holds = holds || memory.lastTrue !== null && now - memory.lastTrue <= condition.within * 1000;
  }
  return { holds: result.holds, value: result.value, ok: holds !== null && holds !== Boolean(condition.not) };
}

/** Rules in evaluation order: each after the rules its "Rule active" conditions read, otherwise in list order. */
function ruleOrder(rules) {
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  const seen = new Set();
  const order = [];
  const visit = rule => {
    if (!rule || seen.has(rule.id)) return;
    seen.add(rule.id);
    ruleDependencies(rule).forEach(id => visit(byId.get(id)));
    order.push(rule);
  };
  rules.forEach(visit);
  return order;
}

const ruleEnabled = (rule, folders) => rule.enabled && folders.get(rule.folder) !== false;

/** The counters that enabled rules read; nothing else is sampled. */
function referencedCounters(layout) {
  const folders = new Map(layout.folders.map(folder => [folder.id, folder.enabled]));
  const keys = new Set();
  for (const rule of layout.rules) {
    if (!ruleEnabled(rule, folders)) continue;
    for (const condition of rule.when) {
      const key = counterKey(condition);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/** How many a history label counts: "Mined 3 × Stone" is 3, "Mined Stone" is 1. */
function eventCount(label) {
  const match = /^\S+ (\d+) × /.exec(label);
  return match ? Number(match[1]) : 1;
}

/**
 * Bounded increases of counters over the last hour, for "amount within W s" conditions. Keys: "xp" (experience
 * points), "health" (health plus absorption lost), "stat:<id>" (a statistic) and "history:<category>" (history
 * events, counted from their labels and attributed to their own timestamps; coalesced events count only what they
 * grew by). The first value seen is a baseline, so sampled amounts only cover the time since the dashboard opened.
 */
function createCounters() {
  const stores = new Map();
  const rise = (store, value, now) => {
    if (typeof value !== "number") return;
    if (store.last !== null && value > store.last) store.samples.push({ at: now, amount: value - store.last });
    store.last = value;
    store.ready = true;
  };
  const drop = (store, value, now) => {
    if (store.last !== null && value < store.last) store.samples.push({ at: now, amount: store.last - value });
    store.last = value;
    store.ready = true;
  };
  const events = (store, history, category) => {
    if (!history) return;
    if (history.sessionId !== store.session) {
      store.session = history.sessionId;
      store.seen = new Map();
    }
    const seen = new Map();
    for (const event of history.events) {
      if (event.category !== category) continue;
      const count = eventCount(event.label);
      const before = store.seen.get(event.id) ?? 0;
      // Kill details start with the entity type id.
      if (count > before) store.samples.push({ at: event.timestamp, amount: count - before, tag: event.details.split(" ")[0] });
      seen.set(event.id, Math.max(count, before));
    }
    store.seen = seen;
    store.ready = true;
  };
  return {
    update(player, now, keys) {
      for (const key of [...stores.keys()]) if (!keys.has(key)) stores.delete(key);
      for (const key of keys) {
        if (!stores.has(key)) stores.set(key, { ready: false, last: null, samples: [], seen: new Map(), session: null });
        const store = stores.get(key);
        if (key.startsWith("history:")) events(store, player?.history, key.slice("history:".length));
        else if (!player?.available) store.last = null;
        else if (key === "xp") rise(store, player.xp?.points, now);
        else if (key === "health") drop(store, player.health + player.absorption, now);
        else rise(store, player.statistics?.entries.find(entry => entry.id === key.slice("stat:".length))?.value, now);
        const since = now - MAX_RULE_SECONDS * 1000;
        store.samples = store.samples.filter(sample => sample.at >= since).slice(-MAX_COUNTER_SAMPLES);
      }
    },
    /** The total increase within the last {@code window} seconds (only samples tagged {@code tag}, if given). */
    amount(key, window, now, tag) {
      const store = stores.get(key);
      if (!store?.ready) return null;
      const since = now - window * 1000;
      return store.samples.reduce((sum, sample) => sample.at >= since && (tag === undefined || sample.tag === tag)
        ? sum + sample.amount : sum, 0);
    },
    clear() {
      stores.clear();
    }
  };
}

/** Remembers whether the current portal crossing went straight back through the pair used by the previous one. */
function trackPortal(memory, player) {
  const crossing = player?.available ? player.portal?.crossing : null;
  if (!crossing || crossing.id === memory.id) return;
  const previous = memory.previous;
  memory.returnTrip = Boolean(previous && crossing.fromDimension === previous.toDimension
    && crossing.toDimension === previous.fromDimension
    && horizontalDistance(crossing.to, previous.from) <= RETURN_TRIP_DISTANCE);
  memory.previous = crossing;
  memory.id = crossing.id;
}

/**
 * Evaluates rules over time. {@code evaluate(layout, env, now, force)} takes the normalized layout,
 * {@code env = { player, width, clock: { minutes, weekday } }}, the current time and optional previews
 * ({ ruleId: "on" | "off" }), and returns:
 * - {@code states}: per rule id { enabled, matched, active, forced, blocks: [bool], conditions: [{ holds, value, ok }] }
 * - {@code events}: rules that turned on or off now; also kept in {@code log()} (the last MAX_ACTIVITY_LOG)
 * - {@code notifications}: Notify actions that fire now (Then on activation, Else on deactivation, with cooldown)
 * A rule becomes active once it has matched for its delay and stays active for its linger after it stops matching.
 */
function createRuleEngine() {
  let rules = new Map();
  let modifiers = new Map();
  let notified = new Map();
  let log = [];
  const counters = createCounters();
  const portal = { id: null, previous: null, returnTrip: false };
  return {
    evaluate(layout, env = {}, now = Date.now(), force = {}) {
      const player = env.player;
      counters.update(player, now, referencedCounters(layout));
      trackPortal(portal, player);
      const folders = new Map(layout.folders.map(folder => [folder.id, folder.enabled]));
      const states = new Map();
      const ctx = { player, now, width: env.width, clock: env.clock,
        toggles: new Map(layout.toggles.map(toggle => [toggle.id, toggle.on])),
        places: new Map(layout.places.map(place => [place.id, place])),
        ruleActive: id => states.get(id)?.active === true,
        amount: (key, window, tag) => counters.amount(key, window, now, tag),
        returnTrip: id => portal.id === id && portal.returnTrip };
      const nextRules = new Map();
      const nextModifiers = new Map();
      const events = [];
      const notifications = [];
      const notify = (rule, list) => rule[list].forEach((action, index) => {
        if (action.do !== "notify") return;
        const key = `${rule.id}|${list}|${index}|${action.text}`;
        const last = notified.get(key);
        if (last !== undefined && now - last < action.cooldown * 1000) return;
        notified.set(key, now);
        notifications.push({ at: now, rule: rule.id, text: action.text });
      });
      for (const rule of ruleOrder(layout.rules)) {
        const memory = rules.get(rule.id) ?? { matchedSince: null, lastReady: null, active: false };
        const forced = force[rule.id] === "on" || force[rule.id] === "off" ? force[rule.id] : null;
        const enabled = ruleEnabled(rule, folders) || forced !== null;
        let conditions = [];
        let blocks = [];
        let matched = false;
        let active = false;
        if (enabled) {
          conditions = rule.when.map((condition, index) => {
            const key = `${rule.id}|${index}|${JSON.stringify(condition)}`;
            const state = modifiers.get(key) ?? { trueSince: null, lastTrue: null };
            nextModifiers.set(key, state);
            return applyModifier(condition, evaluateCondition(condition, ctx), state, now);
          });
          blocks = ruleBlocks(rule.when).map(block => block.every(index => conditions[index].ok));
          matched = blocks.some(Boolean);
          if (!matched) memory.matchedSince = null;
          else if (memory.matchedSince === null) memory.matchedSince = now;
          if (matched && now - memory.matchedSince >= rule.timing.delayMs) memory.lastReady = now;
          active = memory.lastReady !== null && now - memory.lastReady < rule.timing.lingerMs;
        } else {
          memory.matchedSince = null;
          memory.lastReady = null;
        }
        if (forced) active = forced === "on";
        if (active !== memory.active) {
          const event = { at: now, rule: rule.id, name: rule.name, active };
          events.push(event);
          log = [...log, event].slice(-MAX_ACTIVITY_LOG);
          if (active) notify(rule, "then");
          else if (enabled) notify(rule, "else");
        }
        memory.active = active;
        nextRules.set(rule.id, memory);
        states.set(rule.id, { enabled, matched, active, forced, blocks, conditions });
      }
      rules = nextRules;
      modifiers = nextModifiers;
      const ruleIds = new Set(layout.rules.map(rule => rule.id));
      notified = new Map([...notified].filter(([key]) => ruleIds.has(key.slice(0, key.indexOf("|")))));
      return { at: now, states, events, notifications };
    },
    log() {
      return [...log];
    },
    reset() {
      rules = new Map();
      modifiers = new Map();
      notified = new Map();
      log = [];
      counters.clear();
      Object.assign(portal, { id: null, previous: null, returnTrip: false });
    }
  };
}

/** The properties one action claims, as [property, value] pairs; Notify claims nothing. */
function actionClaims(action) {
  switch (action.do) {
    case "profile":
      return [["profile", action.profile]];
    case "show":
      return [[`visible:${action.panel}`, true]];
    case "hide":
      return [[`visible:${action.panel}`, false]];
    case "place":
      return [[`rect:${action.panel}`, { x: action.x, y: action.y, w: action.w, h: action.h }]];
    case "swap":
      return [[`rect:${action.panel}`, { swap: action.with }], [`rect:${action.with}`, { swap: action.panel }]];
    case "focus":
      return [["focus", action.panel]];
    case "set":
      return [[`setting:${action.panel}.${action.setting}`, action.value]];
    default:
      return [];
  }
}

/**
 * What the dashboard shows. Active rules claim through Then and enabled inactive rules through Else; per property
 * (profile, a panel's visibility or rectangle, focus, a setting) the claim of the highest rule in the list wins and
 * the others are kept as overridden for the inspector. The winning profile (else Default) is the base layout:
 * its tiles shown (rules-only ones hidden), then visibility and setting claims applied. Rectangles, focus, Hide
 * fill overrides and animation overrides (per panel, from the rule whose claim shows, hides, moves or focuses it)
 * are reported for solveLayout. {@code evaluation} is the result of the engine's evaluate, or null for none.
 */
function effectiveView(layout, evaluation) {
  const claims = [];
  const winners = new Map();
  for (const rule of layout.rules) {
    const state = evaluation?.states.get(rule.id);
    if (!state?.enabled) continue;
    const list = state.active ? "then" : "else";
    rule[list].forEach((action, index) => {
      for (const [property, value] of actionClaims(action)) {
        const claim = { property, value, rule: rule.id, list, index, won: !winners.has(property) };
        if (claim.won) winners.set(property, claim);
        claims.push(claim);
      }
    });
  }
  const profile = getProfile(layout, winners.get("profile")?.value ?? "default");
  const visible = new Set(profile.tiles.filter(tile => tile.enabled && !tile.rulesOnly).map(tile => tile.id));
  let settings = profile.settings;
  const rects = {};
  const fills = {};
  const animations = {};
  const ruleById = new Map(layout.rules.map(rule => [rule.id, rule]));
  for (const [property, claim] of winners) {
    const [kind, target] = property.split(":");
    const rule = ruleById.get(claim.rule);
    const panel = kind === "focus" ? claim.value : target;
    if (rule.animation && kind !== "setting" && kind !== "profile" && !animations[panel]) {
      animations[panel] = rule.animation;
    }
    if (kind === "visible") {
      if (!claim.value) {
        visible.delete(target);
        const fill = rule[claim.list][claim.index].fill;
        if (fill) fills[target] = fill;
      } else if (profile.tiles.find(tile => tile.id === target)?.enabled) {
        visible.add(target);
      }
    } else if (kind === "setting") {
      const [panel, key] = target.split(".");
      settings = mergeSettings(settings, { [panel]: { [key]: claim.value } });
    } else if (kind === "rect") {
      rects[target] = claim.value;
    }
  }
  return { profileId: profile.id, profile, visible, settings, rects, fills, animations,
    focus: winners.get("focus")?.value ?? null, claims, rules: layout.rules.filter(rule => evaluation?.states.get(rule.id)?.active).map(rule => rule.id) };
}
