# Rules v2 design

Status: **approved design. Phases 1–5 are implemented on branch `rules-v2`; phase 6 has not started.** To pick the work up again, start with [Handoff](#handoff). All open questions were answered on 2026-10-16 (see [Resolved questions](#resolved-questions)). It replaces the v1 rules in `rules.js`, `layout.js` (`normalizeRule`) and the rules dialog in `features.js`. What each phase built, and the decisions made while building it, are in [Implementation status](#implementation-status).

The model is Factorio's train wait conditions: a flat list of conditions joined by AND/OR. When it matches, a list of actions changes the dashboard: hide, show, move, resize, swap, focus, configure or notify. Every change animates, and nothing on screen jumps or flickers.

"Panel" in this document is a tile in the code (`TILE_IDS`).

## Decisions so far

| Topic | Decision |
|---|---|
| Logic | Factorio style: a flat list where each row is joined to the one above with AND or OR. AND binds tighter, so `A and B or C and D` = `(A∧B) ∨ (C∧D)`. |
| Actions | Action list. Move and resize are set by dragging a ghost of the panel on the live grid. |
| Rule ends | An optional **Else** list applies while the rule is not active. Otherwise the rule's effects undo and animate back to the base layout. |
| Hidden panel's space | Neighbouring panels grow smoothly into it automatically. A rule can override this. |
| Shown panel needs space | Neighbouring panels shrink smoothly (never below minimum size). Panels are only pushed down when that is impossible. |
| Conflicts | List order is priority. A higher rule wins per panel and per property. You reorder rules by dragging. |
| Profiles | Kept as base layouts. "Switch profile" is an action, and other actions apply on top of the profile. |
| Animation | Global default duration and easing, with an optional per-rule override. Honours `prefers-reduced-motion`. |
| Flicker | Per-condition timing modifiers, per-rule delay and linger, and a minimum dwell per panel (see [Timing](#timing-and-anti-flicker)). |
| Scope | All rules are global. A rule is limited to a world, server or profile through its conditions. |
| Customize mode | Rules pause while you edit the base layout. The rules side panel shows rules live. |
| Editor | Side panel beside the live dashboard. |
| Feedback | Green/red state on every condition with its live value, Force on/off preview, a "why is this panel here" inspector and an activity log. |
| Pickers | Searchable registry pickers with icons, plus "+ current" shortcuts. |
| Organisation | Folders (collapse, enable or disable all), duplicate, copy and paste of conditions and actions, share strings. |
| Toggles | Named toggles appear as dashboard toolbar buttons. There are no in-game keybinds for now. |
| Persistence | Toggle on/off states and folder enabled/collapsed states are saved with the layout, so they survive restarts. |
| Audio | None. No sounds anywhere in the rules system. |
| Multiple dashboards | Allowed to differ. Preview and dashboard width are per browser. |
| Templates | A template library ("Add from template"). Nothing is pre-installed. |
| Litematica | Condition types are reserved in this design and get built once the adapter exists. |
| Migration | Existing rules are converted automatically. Nothing is lost. |

## Concepts

- **Rule:** a name, an enabled flag, an optional folder, a **When** list, **Then** actions, optional **Else** actions, timing and an optional animation override.
- **Condition:** one row of When. It has a type, its parameters, `not`, an optional timing modifier, and `join` (`and`/`or`) to the row above. The first row's join is ignored.
- **Block:** the AND-chain between two ORs. A rule *matches* when any block has every condition true.
- **Active:** the rule matched, after its delay, linger and dwell are applied. An active rule applies Then. An enabled, inactive rule applies Else.
- **Claim:** what one action wants for one property of one panel, for example "XP: visible". Of the claims on the same property, only the one from the highest-priority rule takes effect.
- **Base layout:** the profile in use (Default or the winning "Switch profile" action), before any other claims.
- **Effective layout:** the base layout with the claims applied and the gaps filled. This is what is shown.
- **Place:** a saved, named location. **Toggle:** a named on/off switch that you control.

## Stored format (layout version 2)

```jsonc
{
  "version": 2,
  "tiles": [...], "settings": {...}, "profiles": [...], "pinned": [...], "updates": {...},   // unchanged
  "animation": { "durationMs": 300, "easing": "ease-out" },
  "folders": [ { "id": "combat", "name": "Combat", "enabled": true, "collapsed": false } ],
  "places":  [ { "id": "home", "name": "Home", "world": "My World", "dimension": "minecraft:overworld",
                 "x": 120, "y": 64, "z": -340 } ],
  "toggles": [ { "id": "afk", "name": "AFK", "on": false } ],
  "rules": [ {
    "id": "xp-gain", "name": "XP while gaining", "enabled": true, "folder": null,
    "when": [
      { "type": "xpGained", "compare": ">=", "value": 1, "window": 10 },
      { "join": "and", "not": true, "type": "inCombat", "within": 5 },
      { "join": "or",  "type": "toggle", "toggle": "afk" }
    ],
    "then": [ { "do": "show", "panel": "xp" },
              { "do": "set", "panel": "xp", "setting": "window", "value": 10 } ],
    "else": [],
    "timing": { "delayMs": 0, "lingerMs": 2000 },
    "animation": null
  } ]
}
```

- Rule order in `rules` is priority, with folders flattened in display order. Folder membership doesn't change priority, only what's shown.
- Every value is validated on load, in the same style as `normalizeLayout`. An invalid rule is rejected with its name, not silently dropped.
- Proposed limits: 128 rules, 32 conditions per rule, 16 actions each in Then and Else, 32 folders, 64 places and 16 toggles.

## Conditions

### Shared shapes

- **Compare:** `compare` is one of `< ≤ = ≥ > ≠ between`, with `value` (and `value2` for `between`). This replaces today's min/max.
- **Amount in window:** `[subject] [compare] [N] within [W s]`. "Any amount" is `≥ 1`. All counter-style conditions use this shape.
- **Timing modifier:** optional on any condition, and only one per condition.
  - `for: N` means true only after being true *continuously* for N s. Example: "Still, for ≥ 30 s".
  - `within: N` means true if it was true *at any point* in the last N s.
- **Not:** inverts the condition after the modifier is applied.
- **Sensor:** where the data comes from. **Existing** means already in the snapshot. **New** means new collection in the mod. **Uncertain** means it may not be knowable on the client and must be verified in game.

### Catalogue

| Family | Condition | Parameters | Sensor |
|---|---|---|---|
| World | Server / world | names | existing |
| | Dimension | list | existing |
| | Biome | picker | existing |
| | Time of day | dawn/day/dusk/night, or tick range | existing |
| | Weather | clear/rain/thunder | existing |
| | Moon phase | list | new |
| | Day count | compare | existing |
| | Game mode | list | existing |
| Position | Near place | saved place or typed X/Y/Z; radius (2D or 3D) or box (two corners) | existing position |
| | Y level | compare | existing |
| | Light level | compare (block/sky/combined) | new |
| | Distance from world spawn | compare | new (uncertain: client spawn accuracy) |
| | Looking at | block or entity picker, max distance | new |
| Player | Health, food, saturation, absorption | compare | existing |
| | Air, armor points | compare | new |
| | XP level | compare | existing |
| | Status effect | effect picker; optional amplifier compare, remaining-time compare | existing (check amplifier and duration fields) |
| | Movement mode | ground (walking) / elytra / swimming / riding / flying / falling | existing |
| | Speed | compare in blocks/s; total, horizontal or vertical | existing |
| | Still | total speed below 0.1 b/s. Speed only, so looking around never counts as moving. Use with `for` ("haven't moved for 30 s") | existing |
| | On fire, in water, in lava, in rain, sneaking, sprinting, sleeping | — | new |
| | Riding | entity picker (any, boat, minecart, horse…) | new |
| | Using item | eating/drinking, drawing a bow/crossbow/trident, blocking, fishing | new |
| Inventory | Holding | item picker; main hand, off hand or either | existing |
| | Has item | item picker, compare count (inventory; optionally plus ender chest) | existing |
| | Free slots | compare | existing |
| | Durability | held / any armor piece / any tool; compare % | existing |
| | Wearing elytra | — | existing (`glider`) |
| Amounts | Gained XP | amount in window | existing |
| | Picked up | item picker or *any item*; amount in window | existing |
| | Statistic rose | statistic picker; amount in window | existing |
| | Mined block / placed block | block picker or *any*; amount in window | existing stats / `BlockPlaceMixin` |
| | Killed mob | entity picker or *any*; amount in window | existing stats |
| | Took damage | amount (hearts) in window | existing history |
| Events | Advancement earned | any or picker; within N s | existing |
| | Died / changed dimension | within N s | existing history |
| | Joined world | within N s | existing session |
| Threats | Hostile mobs nearby | radius (max 64), compare count, optional type filter | new |
| | Mob type nearby | entity picker, radius | new |
| | Player nearby | radius, compare count | new |
| | Boss bar visible, raid active | — | new |
| Villagers | Known villagers nearby | radius, compare count | existing (`WorldStore` positions) |
| Screens | Screen open | list: chest-like, ender chest, furnace-like, crafting, anvil, enchanting, brewing, villager trading, smithing, grindstone, stonecutter, loom, cartography, beacon, own inventory | new |
| Features | Portal linking | active from a portal crossing until the matching portal is lit, you go back through, or N minutes pass | existing (`PortalTracker`) |
| | Litematica (reserved) | schematic loaded, progress compare %, materials missing | later |
| Meta | Toggle on | toggle picker | dashboard |
| | Rule active | rule picker. Cycles are rejected when saving. | dashboard |
| | Dashboard width | compare in px (phone vs monitor). Evaluated per browser. | dashboard |
| | Real-world time | between HH:MM and HH:MM, optional weekdays | dashboard |
| | Session time | compare | existing |
| | In game | connected to a world | existing |

**Sensor cost:** the mod reads the saved layout and computes only the expensive sensors that an enabled rule references. Those are entity scans, look target, light and screen type. Entity scans run at 2 Hz at most, and their radius is capped by render distance. Nothing new runs on the network thread, and the existing read-only and loopback guarantees stay as they are.

## Actions

The same action types are allowed in Then and Else.

| Action | Parameters | Notes |
|---|---|---|
| Switch profile | profile | Picks the base layout. The highest active claim wins. |
| Show / Hide panel | panel, optional fill override for Hide (auto, a specific panel, leave empty) | |
| Place panel | panel, x/y/w/h set by dragging a ghost on the live grid | Move and resize in one action. |
| Swap panels | panel A, panel B | Each panel takes the other's rectangle. |
| Focus panel | panel | See [Focus behaviour](#focus-behaviour). |
| Set panel setting | panel, setting, value | Any setting from `SETTING_RULES`, edited with the panel's own settings controls. |
| Notify | text, cooldown s | A visual toast only, with **no sound**. Fires once when its block starts applying (Then on activation, Else on deactivation). It never repeats while the rule stays active. |

### Focus behaviour

- On focus, the panel grows from its current rectangle until it covers **nearly the entire visible dashboard**, leaving a small margin. It's drawn as a layer above the grid.
- The other panels **fade out where they are and do not move or resize**. The grid underneath stays unchanged, so nothing reflows.
- On unfocus there are two cases:
  - The panel is still shown in the effective layout: it **shrinks back to its normal rectangle** and the other panels fade back in.
  - The panel is no longer shown (for example, it was only visible because of the rule that focused it): it **fades away** from the focused size while the others fade back in.
- Only one panel can be focused at a time. The highest-priority focus claim wins.

## Resolving the effective layout

This runs on every evaluation (each snapshot plus a 1 s timer for timed conditions). It's a pure function in the style of `effectiveView`.

1. **Evaluate** every enabled rule (and enabled folder): match, then delay, then linger, giving *active* or *inactive*. A "Rule active" condition reads results in dependency order.
2. **Collect claims** from Then (active rules) or Else (inactive rules), in priority order. Properties are: profile, each panel's visibility, rectangle, focus, and each setting key. The first claim on a property wins, and later ones are recorded as *overridden* for the inspector.
3. **Base layout** = the winning profile, or Default.
4. **Solve placement:**
   1. Start from the base rectangles and apply Place and Swap claims. Those rectangles are pinned.
   2. **Hidden panels:** for each freed rectangle, grow neighbours into it, in this order:
      - (a) one neighbour whose edge exactly matches the gap. Same columns above or below is preferred, then same rows left or right.
      - (b) several neighbours whose edges together cover the gap.
      - (c) otherwise the panels below slide up into the gap's columns (today's settle behaviour, animated).

      A Hide action's fill override replaces (a)–(c).
   3. **Shown or placed panels** that overlap others: the overlapped neighbours shrink away from it, down to their minimum size. Whatever still doesn't fit is pushed down.
   4. Same inputs give the same layout, so the solver is deterministic and unit-tested.
5. **Settings** = profile settings with the winning setting claims merged in.
6. **Animate:** compare old and new rectangles and visibility, then animate with FLIP (transform plus opacity). An interrupted transition starts from where the panel currently is, never from its old target.

## Timing and anti-flicker

- **Per rule:** `delayMs` (default 0) is how long the rule must match before it becomes active. `lingerMs` (default 2000, minimum 500) is how long it stays active after it stops matching. This replaces today's fixed `RULE_HOLD_MILLIS`.
- **Per condition:** the `for` / `within` modifiers (see [Shared shapes](#shared-shapes)).
- **Per panel minimum dwell** (global, default 1 s): after a panel's visibility or rectangle changes, a later change to it waits until the dwell is over. If the target goes back to what is already shown in the meantime, nothing happens. Together with linger, a value hovering at a threshold can't make a panel blink.
- **Animation:** the global `animation.durationMs` (default 300) and easing, which a rule's `animation` can override. With `prefers-reduced-motion`, panels only cross-fade and never slide.

## Editor (side panel)

- **Rule list:** folders that collapse and toggle, rules dragged to reorder (this sets priority), a live active dot, an enable switch, duplicate, delete, and "Add from template".
- **Rule detail:**
  - **When** looks like the Factorio screenshot. Each row has an AND/OR connector on the left, and OR rows start a new boxed block. "+ Add condition" opens a searchable type list grouped by family. Each row shows a green or red state and the live value ("speed 4.3 b/s"), and each block shows its own state.
  - **Then** and **Else** are action lists. For Place, "Set on grid" enters a placement mode where you drag and resize the panel's ghost on the real grid, then confirm.
  - **Advanced** (collapsed) holds delay, linger and the animation override.
- **Preview:** Force on, Force off or Auto per rule. It applies only in this browser and ends when the editor closes.
- **Inspector:** while the editor is open, clicking a panel lists every rule claiming it, what each claims, and which claim won.
- **Activity log:** the last 100 activations and deactivations with timestamps, kept in memory only.
- **Pickers:** the mod sends registry lists (items, blocks, effects, biomes, entity types, statistics, advancements, screens) once per connection, and the browser caches them. "+ current" adds the held item, current biome, current position and so on.
- **Copy and paste:** select condition or action rows, then copy and paste them into another rule.
- **Share strings:** export or import a rule or folder as compact text (versioned, validated on import, with places and toggles it references included). An import never overwrites existing rules; it adds them with new IDs.
- **Places and Toggles** are managed in their own sections of the side panel. "+ current position" creates a place bound to the current world and dimension. Toggles appear as buttons in the dashboard toolbar.

## Templates

| Template | When | Then |
|---|---|---|
| XP while gaining | Gained XP ≥ 1 within 10 s | Show XP |
| Hide idle movement | Still, for ≥ 30 s | Hide Movement (auto fill) |
| Villagers while trading | Screen open: villager trading **or** Known villagers ≥ 3 within 16 | Show Villagers |
| Portal guidance | Portal linking | Show Player, Notify "Portal target set" |
| Elytra map | Movement mode = elytra, for ≥ 3 s | Focus Map |
| Tool about to break | Durability (held) < 10 % | Notify (60 s cooldown) |
| Combat | Hostile mobs ≥ 3 within 16 | Show History, Hide Pickups |
| Pickups while looting | Picked up any ≥ 1 within 15 s | Show Pickups |
| Phone layout | Dashboard width < 700 px | Switch profile (if one exists, otherwise placeholder) |

## Migration (layout v1 → v2)

- Old `groups` (AND of OR-groups) are expanded into Factorio blocks (OR of AND-blocks). If the expansion goes over the condition limit, each old group becomes a helper rule with no actions, and the main rule refers to them with "Rule active". The logic is unchanged.
- `min`/`max` → `between`, `≥` or `≤`. `seconds` on advancement and combat → an event with `within`.
- `profile` → Switch profile, `tiles` → Show/Hide, `settings` → Set panel setting.
- The old fixed 2 s hold becomes `lingerMs: 2000`.
- "Rules only" panels stay a panel mode. While hidden, their reserved space is filled by neighbours (auto-grow), and they get it back when a rule shows them.
- Before converting, the original v1 JSON is kept beside the layout as a backup file.

## Delivery phases

1. **Done (2026-10-16).** Schema v2, evaluator (blocks, modifiers, delay, linger), migration and unit tests, using only the existing conditions.
2. **Done (2026-10-16).** Layout solver (auto-grow, shrink, swap, focus, dwell) and FLIP animation, with unit tests for the solver.
3. **Done (2026-10-16).** Editor (full screen or docked as a side panel), Factorio-style When UI, live state, preview, inspector, log, places and toggles. Registry pickers suggest only ids the dashboard has seen until phase 4 sends the lists.
4. **Done (2026-10-16).** Mod-side sensors and registry lists (player state, screens, threats, world).
5. **Done (2026-10-16).** Templates, share strings, copy and paste, folders.
6. Litematica conditions. The adapter now exists (`BuildProgressCollector`, the `build` snapshot field).

## Resolved questions

Answered by the maintainer on 2026-10-16.

1. **"Haven't moved"** goes by speed only. Head movement and looking around are ignored.
2. **Focus panel:** see [Focus behaviour](#focus-behaviour). The panel takes nearly the whole screen, and the others fade out without moving. Afterwards it shrinks back to its place, or fades away if it is no longer shown.
3. **Empty When:** the rule is never active. The editor shows a warning.
4. **"Rules only" panels:** neighbours fill their space until a rule shows them.
5. **Persistence:** all states survive restarts. That means toggle states, folder enabled/collapsed state and rule enabled state, all stored in the layout. Two things stay transient on purpose: Force on/off previews (editor-only, per browser) and the activity log (in memory).
6. **Places** are tied to the world (`world` + `dimension`) they were saved in.
7. **Audio:** none. Don't implement any audio feature.
8. **Multiple dashboards** may show different layouts. That's fine.

## Implementation notes

- **Two validators.** `LayoutStore.java` and `LayoutRules.java` validate and re-serialize the layout on the mod side, with the same rules and limits as `normalizeLayout` in `layout.js`. They read versions 1 and 2 and save only version 2. Any change to the format must be made in both places and added to the shared cases in `src/test/fixtures/layouts-v2.json`, which both test suites check.
- **Pure logic stays DOM-free.** Evaluation and the layout solver belong in `rules.js` and `layout.js`, which have no DOM access, so they can be unit-tested in `src/test/js/dashboard.test.js` (run with `node --test src/test/js/dashboard.test.js`). The editor UI goes in `features.js`, and its wiring in `app.js`.
- **Tests:** `./gradlew releaseBuild` runs `serviceTest` (Java, `main()`-based), `frontendSyntax` and `frontendTest`. See `docs/TESTING.md`. The full Gradle build may fail to resolve Loom in some sandboxes. Run the Node and `javac` checks directly in that case.
- **Protocol:** new sensors and registry lists are new snapshot fields. Follow the versioning, full-snapshot-plus-delta and bounds rules in `docs/ARCHITECTURE.md`. Everything stays read-only and loopback-only.

## Implementation status

### Phase 1 (2026-10-16)

**Where it lives**

| Piece | Code |
|---|---|
| Schema, validation, migration | `layout.js`: `normalizeLayout`, `normalizeRule`, `normalizeCondition`, `normalizeAction`, `CONDITION_TYPES`, `ruleBlocks`, `migrateLayoutV1` |
| Evaluator | `rules.js`: `evaluateCondition`, `createRuleEngine` (`evaluate`, `log`), `effectiveView` |
| Wiring | `app.js`: `evaluateView` and `updateView` (each snapshot and the 1 s timer) |
| Mod-side validator | `LayoutRules.java` (v2 rules) and `LayoutStore.java` (versions, files) |
| Tests | `dashboard.test.js` ("rules v2: …" tests) and `LayoutStoreTest.java`. Both also check the shared cases in `src/test/fixtures/layouts-v2.json`, so the two validators accept and reject the same layouts |

**Stored format as built.** It follows [Stored format](#stored-format-layout-version-2). These details were settled during implementation:

- Limits are the proposed ones: 128 rules, 32 conditions, 16 Then and 16 Else actions, 32 folders, 64 places, 16 toggles.
- Timing: `delayMs` 0–600 000 and `lingerMs` 500–600 000. `animation.durationMs` is 0–5000. `easing` is one of `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`.
- `compare` is stored as `<`, `<=`, `=`, `>=`, `>`, `!=` or `between`. `between` includes both ends. Values are limited to ±10⁹.
- Unknown keys are dropped. A rule's `join` on its first condition is dropped. Missing `then`, `else`, `timing`, `animation` and `folder` get their defaults.
- Ids match `[a-z0-9-]{1,32}`. Names are 1–64 characters, and toggle names 1–32.

**Condition types.** `values` lists hold up to 32 entries. Everything else is a fixed parameter.

| Type | Parameters | Notes |
|---|---|---|
| `world`, `dimension`, `biome` | `values` | Same matching as v1: names or kind, dimension aliases, `minecraft:` is optional |
| `time` | `values` (dawn, day, dusk, night) or `ticks: {from, to}` | Tick ranges wrap past midnight when `from > to` |
| `weather`, `gameMode`, `movement` | `values` from a fixed list | |
| `day`, `yLevel`, `health`, `food`, `saturation`, `absorption`, `xpLevel`, `freeSlots`, `width` (px), `sessionTime` (minutes) | compare | |
| `nearPlace` | `place`, or `x y z` (optionally `world`, `dimension`); then `radius` (optionally `flat`) or a box `x2 y2 z2` | A place only counts in its own world and dimension. Box corners are block coordinates and are inclusive |
| `effect` | `values`; optional `level` and `remaining` (seconds) compares | Level is 1-based. Infinite effects have infinite time remaining |
| `speed` | `axis` (total, horizontal, vertical); compare | In blocks per second. Vertical is signed (negative while falling) |
| `still` | — | Total speed below 0.1 b/s |
| `afk` | compare (minutes) | Minutes since the player last moved more than ¼ block, turned or moved the mouse cursor (tracked by the mod every tick). Unknown with an older mod |
| `holding` | `item`, `hand` (either, main, off) | |
| `hasItem` | `item`, compare, optional `enderChest` | Counts the 36 slots, armor and offhand, plus the last seen ender chest if `enderChest` is set |
| `durability` | `target` (held, armor, tool), compare (percent) | True if any matching item passes. `tool` means any damageable item in the inventory or offhand |
| `elytra`, `inGame` | — | |
| `xpGained`, `pickedUp` (`item`?), `statRose` (`stat`), `minedBlock` (`block`?), `placedBlock` (`block`?), `killedMob` (`entity`?), `tookDamage` (hearts) | compare, `window` 1–3600 s | See "Amounts" below |
| `advancement` (`advancement`?), `died`, `changedDimension`, `joinedWorld`, `inCombat` | `within` (required, 1–3600 s) | Events take `within`, not `for`. `inCombat` is damage, a kill or a death, as v1 `combat` |
| `villagersNearby` | `radius` 1–256, compare | Known villagers in the current dimension |
| `portalLinking` | `minutes` 1–120 | See "Portal linking" below |
| `toggle` | `toggle` | |
| `ruleActive` | `rule` | Loops are rejected when the layout is validated |
| `realTime` | `from`, `to` (`HH:MM`), optional `days` (0 = Sunday) | The end time is excluded. Spans wrap past midnight |

**Evaluation**

- **Unknown values.** Outside a world, every condition except the meta ones (`toggle`, `ruleActive`, `width`, `realTime`, `inGame`) is *unknown*. Missing data is unknown too, for example a statistic not synced yet or a specific advancement while the advancement list is unavailable. An unknown condition never counts as true, even with `not`, so "not in the Nether" doesn't fire on the title screen. This matches v1, where no rule matched outside a world.
- **Modifiers.** `for` and `within` are applied at each evaluation (every snapshot plus a 1 s timer), so they are accurate to about a second.
- **Delay and linger.** Delay counts from the first evaluation at which the rule matched. Linger counts from the last evaluation at which it was ready.
- **Engine results.**
  - The engine returns per-rule state (enabled, matched, active, forced, block and condition results with live values), the activations and deactivations of this evaluation, and the notifications to show.
  - `log()` keeps the last 100 activations and deactivations.
  - A Force preview is a parameter of `evaluate`. Forcing a disabled rule on applies it.
- **Amounts.**
  - `xpGained` uses the mod's exact gains for its windows (10, 30, 60, 300, 600 and 3600 s). Any other window is sampled in the browser.
  - `pickedUp` reads the recent pickups list, which holds at most 32 entries.
  - `minedBlock` and `placedBlock` for a specific block read the `minecraft:mined/<block>` and `minecraft:used/<block>` statistics.
  - `minedBlock` and `placedBlock` for any block, and `killedMob` (the entity id is the start of the event details), read history events. Coalesced events count only what they grew by, at their own timestamps.
  - `tookDamage` adds up drops in health plus absorption.
  - Sampled amounts only cover the time since the dashboard opened. Statistic-based amounts lag by up to about 10 s, because statistics are requested from the server at most every 10 s. Only counters that an enabled rule references are sampled.
- **Portal linking.** It is active from a crossing while you are in the target dimension. It ends when the target portal is lit (`portal.lit`), when `minutes` pass, or when you go back through. Going back through means the next crossing reverses the direction and lands within 16 blocks of where the previous one started. Such a return trip doesn't start linking.
- **Claims.** `effectiveView` returns the profile, visibility, settings, `rects` (Place and Swap), `focus` and every claim with `won` set.
  - It also returns `fills` (Hide fill overrides) and `animations` (per panel, the animation override of the rule whose winning claim shows, hides, moves or focuses it). Phase 2 draws all of it.
  - Show only affects panels that are on or rules-only in the base profile, as in v1. Phase 2 kept this: a panel that is off stays off, so migrated v1 rules behave the same. (Focus is the exception: it shows its panel above the grid even if that panel is hidden.)

**Migration (as built).** It follows [Migration](#migration-layout-v1--v2), plus these decisions by the maintainer:

- **Rule order is kept.** v1 applied show/hide and settings from the last active rule, but v2's first rule wins. So two v1 rules that claimed the same panel or setting now resolve the other way. Profile conflicts are unchanged, because the first rule already won in v1. Such conflicts are expected to be rare.
- **Helper rules.** They are created when the expanded When list would need more than 32 rows. They are named "<rule> (part N)", have ids ending in `-pN`, sit just above their rule, have no actions and linger 500 ms (the minimum). A converted rule can therefore turn off up to 0.5 s later than in v1.
- **More than 16 actions** continue in "<rule> (2)", which has the same When list and is placed right after the rule.
- **Values that never matched** in v1 are dropped: unknown time periods, game modes and movement modes. A `min` above `max` becomes `< 0`, which never matches, as in v1.
- **Too many rules.** If conversion would produce more than 128 rules, it fails with a message. The dashboard then shows the error, uses the default layout and doesn't save, so the stored file stays as it was. Importing a layout replaces it.
- **Where it runs.** The browser converts the layout when it loads and saves the result straight away. On that first version 2 save, the mod copies the version 1 file to `layout.v1-backup.json`, and never overwrites that backup.

**Mod side (`LayoutStore.java`)**

- Version 1 and 2 are read. Only version 2 is saved, so a stale dashboard tab can't write version 1 back.
- A stored file that fails validation loads as nothing, as before. It is now first copied to `layout.rejected.json`, so a later save can't lose it.
- The map URL setting is now also limited to 200 characters, and ids must be JSON strings. Both match `layout.js`.

### Phase 2 (2026-10-16)

| Piece | Code |
|---|---|
| Solver | `layout.js`: `solveLayout` with `fillGap`, `growInto`, `shrinkAway` (pure, no DOM) |
| Dwell | `layout.js`: `createPanelDwell`, `PANEL_DWELL_MILLIS` (1 s, not configurable) |
| Drawing | `app.js`: `evaluateView` (dwell), `applyLayout` (solved rectangles, focus), `measureTiles` / `animateTiles` / `fadeOutCopy` (FLIP) |
| Styles | `features.css`: "What rules do on the dashboard" (`.focused`, `.has-focus`, `.tile-leaving`) |
| Tests | `dashboard.test.js`: "solver: …" and "rules on the dashboard: …" |

Decisions made while building it:

- **Solver order** follows [Resolving the effective layout](#resolving-the-effective-layout). A gap is a hidden panel's base spot, or a placed panel's old spot when its new one doesn't overlap it. Gaps are filled top to bottom. Growing only has to avoid unpinned panels; overlaps with pinned panels are left to the shrink step.
- **A Hide fill panel** grows over the gap when the union is a clean rectangle. Otherwise it moves into the gap, is pinned there, and its old spot is then auto-filled.
- **A pinned panel that overlaps a higher-priority pinned one** is unpinned and settles like any other panel.
- **The final settle** is today's rule: every unpinned panel moves to the highest free row in its columns. A Hide with fill "empty" keeps its gap as an obstacle, so nothing slides into it.
- **Dwell** is applied to the solver's inputs (each panel's visibility, rectangle claim and fill, plus focus), not to its output, so a held panel can never overlap. It only paces rule-driven changes: `refreshLayout` resets it, so an edited, loaded or imported layout shows at once.
- **Customizing** shows the edited profile as stored. No solver, focus or animation, so dragging stays exact.
- **Focus** gives the tile `position: fixed` with a 16 px inset, above the grid. The other tiles fade to transparent where they are (the grid gets `.has-focus`; the fade takes `--fade`, the global duration). A focused panel that is hidden in the grid is still shown while focused, and when focus ends it fades out from the focused size.
- **FLIP** uses the Web Animations API (skipped where `animate` is missing, as in the test DOM). Each tile is measured with its running animation, which is then cancelled, so an interrupted move starts from where the tile is. Tiles that disappear fade out as a copy (no ids, no iframes) at their old spot. With `prefers-reduced-motion`, moved tiles cross-fade instead of sliding.

### Phase 3 (2026-10-16)

The editor lives in `features.js` ("Rules editor", "Pickers", "Place on grid", "Toggles and notifications"), with styles in `features.css`. It **covers nearly the whole screen** (the maintainer asked for that instead of a side panel). **Side panel** in its header docks it beside the live dashboard, which is needed for preview, the inspector and Place on grid.

- **Layout:** on the left, rules in priority order (live active dot, outlined while forced; drag or ↑/↓ to reorder; + New rule), Places, Toggles, Settings and the activity log (the last 20). On the right, the selected item.
- **Rule:** name, enabled, Preview (Auto / Force on / Force off; only in this browser, ended when the editor closes), duplicate and delete. Then:
  - The When list: AND/OR per row; OR rows start a new boxed block; each block shows green or red. There's `not`, a type picker grouped by family, parameters per kind, and the `for`/`within` modifier. Each row has a live green/red edge and value; an empty When list gets a warning.
  - Then and Else action lists.
  - Timing: delay, linger and an optional own animation.
- **Saving:** every edit is validated with `normalizeLayout` and saved at once. An edit that doesn't validate yet stays in the editor, with the error in the header until it is fixed. Value edits don't redraw the editor, so focus and clicks are never lost.
- **Customizing:** opening the editor leaves customize mode so the dashboard shows what the rules do; closing it resumes.
- **Inspector:** while docked, clicking a panel lists every rule claiming it (Then/Else, the action, Wins/Overridden). The panel's profile mode and current state are shown too.
- **Place on grid:** "Set on grid" on a Place action docks the editor and draws the panel's ghost on the live grid. Drag it to move, drag its corner to resize, then Set or Cancel (Escape cancels).
- **Pickers:** suggestions with names and icons from ids the dashboard has seen. That covers inventory and pickup items, effects, statistics, advancements, biomes, dimensions and worlds. They're kept in `localStorage` (`minepanel.knownIds`, 2000 per kind). Lists of values are chips with ×, plus a picker to add more. "+ current" fills in the world, dimension, biome and position; "+ held" fills in the item. **Entity types have no suggestions** until phase 4 (which added them, see below).
- **Toggles** are chips in the Customize toolbar's **Toggles** dropdown (`#rule-toggles`, with a note when there are none). Clicking one flips and saves it.
- **Notify** shows a message at the bottom right for 6 s, at most 4 at once, with no sound (`featureHooks.notify`, fed by `evaluateView`).
- **Settings** holds the global animation (duration and easing) and states the 1 s dwell.
- Removing a place, toggle or rule also removes the conditions that refer to it.

**Not verified.** Nothing has been run in a browser against a running Minecraft client. The tests use synthetic snapshots and a fake DOM without layout or animations, so FLIP, the focus layer, docking, the picker popups and dragging the ghost are untested in a real browser.

### Phase 4 (2026-10-16)

| Piece | Code |
|---|---|
| Snapshot fields | `Sensors`, `SensorNeeds` and `Registries` (Java, `telemetry`), in `PlayerDetails` as `sensors` and `registries`. Schema version 5 |
| Collecting | `SensorsCollector` (client; boss bars through the `BossOverlayAccessor` mixin), `RegistriesCollector`, `IconRenderer.deferredKey` |
| What the mod collects | `LayoutRules.needs` → `LayoutStore.sensorNeeds()`, updated on every load and save |
| Browser | `protocol.js` (`validateSensors`, `validateRegistries`), `rules.js` (`sensorCondition`), `layout.js` (new types), `features.js` (labels, controls, `registryIds`) |
| Tests | `dashboard.test.js` ("sensor conditions…", "sensors and registries are validated…", "every condition type starts valid…"), the shared fixtures, `WorldFeaturesTest` and `LayoutStoreTest` (`testSensorNeeds`) |

**New condition types**

| Type | Family | Parameters | Reads |
|---|---|---|---|
| `moonPhase` | world | `values`: full, waningGibbous, thirdQuarter, waningCrescent, new, waxingCrescent, firstQuarter, waxingGibbous | `sensors.moonPhase` (Minecraft's index, 0 = full) |
| `light` | position | `source` (combined, block, sky), compare | `sensors.light`. Combined is what the game uses for spawning (sky light darkened by the time of day); sky ignores the time of day |
| `spawnDistance` | position | compare (blocks) | `sensors.spawnDistance`: horizontal distance to the world spawn. Unknown outside the spawn's dimension |
| `lookingAt` | position | `target` (block, entity), optional `id`, `distance` 1–64 | `sensors.look`: the nearest block or entity along the view, up to the largest `distance` an enabled rule asks for |
| `air`, `armor` | player | compare (seconds of air; armor points) | `sensors.air` (ticks, so ÷ 20) and `sensors.armor` |
| `onFire`, `inWater`, `inLava`, `inRain`, `sneaking`, `sprinting`, `sleeping` | player | — | `sensors` flags. In rain is the game's own test (rain reaches the feet or the head) |
| `riding` | player | optional `entity` | `sensors.riding`, the vehicle's entity type |
| `usingItem` | player | `values`: eating, drinking, blocking, bow, crossbow, trident, spear, spyglass, horn, brush, bundle, fishing | `sensors.using`, from the used item's animation; fishing while a hook is out |
| `hostilesNearby` | threats | `radius` 1–64, optional `entity`, compare | `sensors.nearby`: living entities that are `Enemy` |
| `mobNearby` | threats | `entity` (required), `radius` 1–64 | true if at least one is within the radius. The live value is the nearest one's distance |
| `playersNearby` | threats | `radius` 1–64, compare | other players in `sensors.nearby` |
| `bossBar`, `raid` | threats | — | boss bars on screen. A raid's bar (name key `event.minecraft.raid…`) counts as a raid only, not as a boss bar |
| `screen` | screens | `values`: inventory (own or creative), chest (chest, barrel, shulker box, dispenser, dropper, hopper), enderChest, furnace (all three), crafting, anvil, enchanting, brewing, trading, smithing, grindstone, stonecutter, loom, cartography, beacon, other (any other screen, including chat and menus) | `sensors.screen` |

Decisions made while building it:

- **Costly sensors only on demand.** Light, the look target, the entity scan and the screen are null in the snapshot unless an enabled rule in an enabled folder uses them (`SensorNeeds`). A condition reading one of them is unknown until the mod sends it. A rule forced on in the preview while disabled therefore has no data for these. The entity scan runs at most twice a second, within the largest radius any rule asks for, capped at 64 and at the render distance. It lists at most 128 entities, nearest first, with distances in tenths of a block.
- **Everything else is always sent.** Moon phase, spawn distance, air, armor, the flags, riding, using and the boss bars cost almost nothing and change rarely.
- **Failures.** If reading the sensors throws (a game update changed something), one warning is logged and `Sensors.EMPTY` is sent: the costly sensors are unknown and the flags read as off. The rest of the snapshot is unaffected.
- **Registries** are listed once per connection (and again after a resource reload): items, blocks (not air), entity types, effects, biomes (from the connection's registry access) and general statistics, each sorted by name, at most 4096 per kind. They're about 200 KB, sent with each initial snapshot and then only if they change. Blocks use their item's icon and entity types their spawn egg's. Icons are only rendered when the dashboard asks for one (`IconRenderer.deferredKey`), since few are ever shown.
- **Pickers** suggest the registry entries first (in memory, kept after leaving the world), then ids the dashboard has seen (in `localStorage`, as in phase 3). Blocks now have their own picker instead of using items. Statistic suggestions are general statistics only; other statistics (`minecraft:mined/…` and so on) are still typed or learned from the snapshot.
- **Screen types** aren't sent as a list: the editor has them built in (`RULE_CHOICES.screen`), since they are MinePanel's own grouping.

### Phase 5 (2026-10-16)

| Piece | Code |
|---|---|
| Folders and order | `layout.js`: `ruleSegments`, `moveRuleInList`, `moveSegment`, `fileRule`, `newRuleIndex` |
| Templates | `layout.js`: `RULE_TEMPLATES`, `ruleFromTemplate` |
| Share strings | `layout.js`: `shareRules`, `importShare` |
| Editor | `features.js`: `renderRuleList` (folders), `folderDetail`, `templatesDetail`, `importDetail`, `copyPasteTools`, `rowSelect`, `shareBox` |
| Tests | `dashboard.test.js`: "folders keep their rules together…", "every template adds a valid rule", "share strings carry rules…", "rules editor: templates, folders, copy and paste, share and import" |

Decisions made while building it:

- **Folders and priority.** A folder's rules are kept next to each other in the list, so the drawn list is the priority order. ↑/↓ on a rule in a folder swaps it with the folder's own rules; on a rule without a folder it jumps past a whole folder; ↑/↓ on a folder moves its rules as a block. Choosing a folder under a rule's **Folder** puts the rule after the folder's last rule (or leaves it in place if the folder is empty); choosing None puts it just after the folder. A layout whose folder rules aren't together (hand-edited) is drawn as it is, with the folder shown once per run. Nothing reorders it on its own.
- **Folder state** (enabled, collapsed) is saved with the layout. Turning a folder off turns its rules off; a rule in a disabled folder says so. Deleting a folder keeps its rules, without a folder, where they are. Rules and folders can also be dragged (`dropRule`, `dropFolder` in `layout.js`): a rule takes the folder of the row it lands next to, the top half of a folder's row is above the folder and the bottom half is into it, an end zone puts it last outside any folder, and a dragged folder never lands inside another folder's run.
- **Templates** are the table above. Show only reveals a panel that's off or rules-only in the profile in use, so each template notes which panel to set to Rules only. Phone layout switches to the first profile, or Default if there's none, for you to change.
- **Share strings** are `minepanel-rules:1:` plus base64url of UTF-8 JSON (`version`, `folder`, `rules`, `places`, `toggles`, `profiles`). They carry the rules a shared rule reads through "Rule active" (in any folder), the places and toggles used, and profile names. Importing adds everything with fresh ids and never replaces anything:
  - A place equal in every field to an existing one is reused, and so is a toggle with the same name.
  - Switch profile goes to the profile with the same name. If there isn't one, the action is left out.
  - A condition referring to something the string doesn't carry is left out, so it can't attach to an unrelated item with the same id. The editor says how many were left out.
  - A folder comes in as a new folder (collapsed off). A single rule comes in without a folder.
  - The result is validated with `normalizeLayout`, so a bad or too-large import is refused as a whole, with the error naming the rule.
- **Rule set files** (added after phase 5): **Import / export** also reads plain JSON rule sets, pasted or from a file, can replace every rule, folder, place and toggle instead of adding, and downloads all rules as a rule set. `importRuleSet`, `exportRuleSet` and `readRuleSet` in `layout.js`; share strings go through the same importer. Ignored (misspelled or unused) fields and anything left out are listed as warnings. The format and every option are documented in [RULE_SETS.md](RULE_SETS.md), whose examples are imported by the tests. Rule sets also carry **profiles** (`importProfiles`, `panelsToTiles`, `exportProfile`): Default's and named profiles' panel positions, sizes and modes (On, Rules only, Off) and settings. A profile is matched by name: an existing one is changed, a new one is added, and with Replace the ones the file doesn't define are removed (only if it defines any). Panels settle as on the dashboard, and any that move are listed as warnings. Download all rules exports every profile, so exporting then importing with Replace gives the same layout back.
- **Copy and paste** works within this browser tab: tick rows in When, Then or Else, Copy, then Paste in any rule. Conditions paste into When, and actions into Then or Else, at the end, within the limits. A "Rule active" condition on the rule it's pasted into is left out.

## Handoff

State on 2026-10-16, branch `rules-v2`: phases 1–5 are done, and their code is uncommitted on top of `3e12f22`. `node --test src/test/js/dashboard.test.js` passes 104 of 104, and `./gradlew releaseBuild` (Java tests, both validators against the shared fixtures, the client compiled against Minecraft 26.1.2) succeeds.

**Check first, with the game running** (none of this can be tested without it):

1. Phases 1–3: FLIP moves, focus, the docked editor, Place on grid, pickers, `prefers-reduced-motion` and the toggle chips. See git history for the phase 3 list.
2. The mixin `BossOverlayAccessor` applies (the client starts at all). Then: a boss bar (wither, ender dragon) sets Boss bar visible, and a raid sets Raid active but not Boss bar.
3. Each sensor in the debug screen's terms. Light against F3's block and sky light; moon phase over a few nights; air underwater; armor points; on fire, in water, lava and rain; sneaking, sprinting, sleeping; riding a boat or horse; eating, drinking, a bow, a crossbow, a shield and fishing.
4. Looking at: a block within the distance, an entity in front of a block, and nothing (the sky).
5. Hostile mobs, a mob type and players nearby, including after changing the render distance. No noticeable frame time with a rule using radius 64 in a mob farm.
6. Screens: chest, barrel, shulker box, ender chest, furnace and smoker, crafting table, villager trading, the player's own inventory (survival and creative), and chat counted as "other".
7. Pickers: items, blocks and entities suggest names with icons. Icons render the first time they're shown, and nothing stalls when scrolling a long list.
8. Copy, Share, Import and templates in a real browser (the clipboard needs a secure context or a user gesture; the share box can always be selected by hand).

**Known gaps and ideas**

- The fixed 1 s dwell could become a setting (it would need a new stored field in both validators).
- The inspector lists claims but not why a panel moved because of a neighbour (solver steps aren't reported).
- Grow/shrink only looks at direct neighbours: a gap with no exact edge falls back to the settle step, as the design says.
- Distance from spawn uses the client's respawn data, which a server may not keep exact (marked uncertain in the design).
- Statistic pickers suggest only general statistics; per-block, per-item and per-mob statistics could be built from the block, item and entity lists.

**Next phase**

- **Phase 6: Litematica conditions.** The `build` snapshot field already has what they need: placement loaded (`placement !== null`), progress (`placed / total`) and materials missing (`materials`, with `left` and `have`). Add the condition types the usual way: `CONDITION_TYPES` and `conditionParams` (`layout.js`), `evaluateCondition` (`rules.js`), `LayoutRules.java`, the shared fixtures, and the editor's `conditionWithType` / `conditionControls` / `CONDITION_LABELS` (`features.js`).

**Docs to update with each change:** the user wiki ([Rules](wiki/Rules.md), [Rule conditions](wiki/Rule-Conditions.md), [Rule actions](wiki/Rule-Actions.md), [Templates and rule sets](wiki/Rule-Sets.md)) and [RULE_SETS.md](RULE_SETS.md). Phase 6's Litematica conditions need rows in both condition references. See [`AGENTS.md`](../AGENTS.md).

**Where to start reading:** `features.js` from "Rules editor" down; `app.js` `evaluateView` / `applyLayout`; `layout.js` "Rules (v2)" to "Share strings" and "Layout solver"; `rules.js` `evaluateCondition` / `sensorCondition` / `effectiveView`; `SensorsCollector.java`.
