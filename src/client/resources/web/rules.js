"use strict";

// Pure game logic for the dashboard: layout rules, navigation arrows and experience maths. No DOM access here.

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

/** Rules stay matched this long after they stop matching, so a value hovering at a limit does not flicker. */
const RULE_HOLD_MILLIS = 2000;
const DIMENSION_ALIASES = { overworld: "minecraft:overworld", nether: "minecraft:the_nether",
  the_nether: "minecraft:the_nether", end: "minecraft:the_end", the_end: "minecraft:the_end" };

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

/** The most recent time an event of one of {@code categories} was logged, or 0. */
function lastEventAt(player, categories) {
  const events = player?.history?.events ?? [];
  for (let index = events.length - 1; index >= 0; index--) {
    if (categories.includes(events[index].category)) return events[index].timestamp;
  }
  return 0;
}

const inRange = (value, condition) => typeof value === "number"
  && (condition.min === undefined || value >= condition.min) && (condition.max === undefined || value <= condition.max);

/** Whether one condition holds (before applying its "not"). */
function conditionHolds(condition, player, now) {
  const values = condition.values ?? [];
  switch (condition.type) {
    case "world": {
      const name = player.world.name.toLowerCase();
      return values.some(value => value.trim().toLowerCase() === name
        || value.trim().toLowerCase() === player.world.kind);
    }
    case "dimension":
      return values.some(value => (DIMENSION_ALIASES[value.trim().toLowerCase()] ?? namespaced(value)) === player.dimension);
    case "biome":
      return values.some(value => namespaced(value) === player.world.biome);
    case "time":
      return values.includes(timeOfDay(player.world.time));
    case "gameMode":
      return values.includes(player.world.gameMode);
    case "health":
      return inRange(player.health, condition);
    case "food":
      return inRange(player.food, condition);
    case "saturation":
      return inRange(player.saturation, condition);
    case "effect":
      return values.some(value => player.effects.some(effect => effect.id === namespaced(value)));
    case "movement":
      return values.includes(player.motion.mode);
    case "elytra":
      return player.motion.glider !== null;
    case "advancement":
      return now - lastEventAt(player, ["advancement"]) <= (condition.seconds ?? 10) * 1000;
    case "combat":
      return now - lastEventAt(player, ["damage", "kill", "death"]) <= (condition.seconds ?? 10) * 1000;
    default:
      return false;
  }
}

function conditionMatches(condition, player, now) {
  return conditionHolds(condition, player, now) !== Boolean(condition.not);
}

/** Every group needs one matching condition: groups are joined by AND, conditions in a group by OR. */
function ruleMatches(rule, player, now) {
  if (!rule.enabled || !player?.available || rule.groups.length === 0) return false;
  return rule.groups.every(group => group.some(condition => conditionMatches(condition, player, now)));
}

/** Tracks which rules are active, holding each briefly after it stops matching. */
function createRuleEngine() {
  const lastMatched = new Map();
  return {
    active(layout, player, now) {
      const active = [];
      for (const rule of layout.rules) {
        if (ruleMatches(rule, player, now)) lastMatched.set(rule.id, now);
        const seen = lastMatched.get(rule.id);
        if (rule.enabled && player?.available && seen !== undefined && now - seen < RULE_HOLD_MILLIS) {
          active.push(rule);
        }
      }
      return active;
    },
    reset() {
      lastMatched.clear();
    }
  };
}

/**
 * What the dashboard shows: the profile picked by the first active rule that switches profile (else Default),
 * which of its tiles are visible after show/hide rules, and its settings with rule overrides applied in order.
 */
function effectiveView(layout, activeRules) {
  const profileId = activeRules.find(rule => rule.profile)?.profile ?? "default";
  const profile = getProfile(layout, profileId);
  const visible = new Set(profile.tiles.filter(tile => tile.enabled && !tile.rulesOnly).map(tile => tile.id));
  let settings = profile.settings;
  for (const rule of activeRules) {
    for (const [id, action] of Object.entries(rule.tiles ?? {})) {
      const tile = profile.tiles.find(entry => entry.id === id);
      if (action === "hide") visible.delete(id);
      else if (tile?.enabled) visible.add(id);
    }
    if (rule.settings) settings = mergeSettings(settings, rule.settings);
  }
  return { profileId, profile, visible, settings, rules: activeRules.map(rule => rule.id) };
}
