# Rule sets: the complete reference

A **rule set** is a JSON file that holds dashboard rules, plus the folders, places and toggles they use. It can also hold **profiles**: how panels are arranged on the Default layout and on other named layouts, and their settings. One file can therefore set up a whole dashboard. You can write one by hand or have an agent write it, then import it in the dashboard. This document describes every field, every condition and action, and how rules are evaluated. A file that follows it imports without errors.

This is the file-format reference. The user-facing guide to rules is in the [wiki](wiki/Rules.md); keep both in sync when conditions, actions, panels or settings change. The test suite imports the two ```` ```json ```` examples below, so don't add or remove `json` code blocks without updating `dashboard.test.js`.

Contents: [Quick start](#quick-start) · [How rules work](#how-rules-work) · [File format](#file-format) · [Profiles: arranging panels](#profiles-arranging-panels) · [Conditions](#conditions) · [Actions](#actions) · [Panels](#panels) · [Panel settings](#panel-settings) · [Importing and exporting](#importing-and-exporting) · [The editor](#the-editor) · [Limits](#limits) · [Writing rule sets with an agent](#writing-rule-sets-with-an-agent) · [Full example](#full-example)

## Quick start

1. Save this as `my-rules.json`:

   ```json
   {
     "format": "minepanel-rules",
     "version": 1,
     "rules": [
       {
         "name": "Map while flying",
         "when": [{ "type": "movement", "values": ["elytra"], "for": 3 }],
         "then": [{ "do": "focus", "panel": "map" }]
       }
     ]
   }
   ```

2. In the dashboard, open **Rules**, then **Import / export**.
3. Click **Choose file…** and pick the file. You can also paste its contents into the box and click **Import**.

The dashboard lists the rules it added and any warnings, and saves everything right away.

## How rules work

A rule has a **When** list of conditions, a **Then** list of actions, and an optional **Else** list of actions.

### When: conditions joined with AND and OR

- Conditions form a flat list. Each condition after the first has `"join": "and"` or `"join": "or"`, which joins it to the condition above. The default is `"and"`. The first condition's `join` is ignored.
- **AND binds tighter than OR.** `A and B or C and D` means `(A and B) or (C and D)`. Each OR starts a new **block**, and the rule **matches** when every condition in at least one block is true.
- An empty When list never matches, so a rule without conditions is never active and only its Else applies.

### What a condition's result is

Each condition is worked out in this order:

1. The condition itself is **true**, **false** or **unknown**.
   - Unknown means the data isn't available. Outside a world, every condition except `toggle`, `ruleActive`, `width`, `realTime` and `inGame` is unknown. Some sensors are also unknown until the game sends them (see [Sensors](#sensors-that-are-only-sent-when-needed)).
2. The timing modifier is applied, if there is one:
   - `"for": N`: true only once the condition has been true without a break for N seconds. Example: "still, for 30 s".
   - `"within": N`: true if the condition was true at any moment in the last N seconds.
   - A condition takes `for` or `within`, not both. Both are whole seconds from 1 to 3600.
   - [Event conditions](#events) must have `within`, and can't have `for`.
3. `"not": true` inverts the result.

An **unknown condition is never true, even with `not`**. So "not in the Nether" is false on the title screen, not true.

### Active, delay and linger

The **match** turns into the rule being **active** through the rule's `timing`:

- `delayMs` (default 0): how long the rule must match before it becomes active.
- `lingerMs` (default 2000, minimum 500): how long it stays active after it stops matching. This stops panels blinking when a value hovers around a threshold.
  - For rules that detect a farm from a kill rate (or another amount), use `"lingerMs": 20000`, so the layout stays up through short gaps in the farm.

While a rule is enabled and active, its **Then** actions apply. While it is enabled and not active, its **Else** actions apply. A disabled rule, or a rule in a disabled folder, does nothing.

Rules are evaluated every time the game sends new data (up to 20 times a second, set under Customize → Updates) and once a second in between. So `for`, `within`, delay and linger are accurate to about a second.

### Priority: higher rules win

The list order is the priority. Each action **claims** something. These are the things that can be claimed:

- the profile (from Switch profile)
- one panel's visibility (from Show and Hide)
- one panel's rectangle (from Place and Swap)
- which panel is focused (from Focus)
- one panel's setting (from Set)

When two rules claim the same thing, the rule higher in the list wins. The other claim is recorded as *overridden*, and the editor's inspector shows it. Claims on different things combine. For example, one rule can switch the profile while another hides a panel in it.

### What the dashboard then shows

1. The **base layout** is the profile from the winning Switch profile claim, or **Default**.
2. Visibility claims are applied:
   - **Hide** hides a panel.
   - **Show only affects panels that are "On" or "Rules only" in that profile.** A panel that is "Off" in the profile stays off.
   - "Rules only" panels are hidden until a rule shows them. Set a panel to "Rules only" with `"mode": "rules"` in a [profile](#profiles-arranging-panels), or in **Customize** mode.
3. Place and Swap claims move panels. Then the layout settles itself:
   - The space a hidden panel leaves is filled by a neighbour whose edge matches it exactly, or by several neighbours that together cover it. If none fit, the panels below slide up. A Hide action's `fill` can choose differently.
   - A shown or placed panel that overlaps others makes them shrink, down to their minimum size. Whatever still doesn't fit is pushed down.
4. Settings claims are merged into the profile's settings.
5. Every change animates. After a rule changes a panel, rules can't change that panel again for 1 second (the **dwell**).

**Focus** is separate from all of this. The focused panel is drawn above the grid, covering nearly the whole screen, and the other panels fade out where they are. It is shown even if it is hidden in the grid. When focus ends, it shrinks back to its place, or fades away if it isn't shown in the grid. Only one panel can be focused at a time.

While **Customize** is on, rules are paused and the edited profile is shown as it is.

## File format

```jsonc
{
  "format": "minepanel-rules",   // optional; if present it must be exactly this
  "version": 1,                  // required; must be 1
  "profiles": [ ... ],           // optional; panel arrangements and settings
  "folders": [ ... ],            // optional
  "places":  [ ... ],            // optional
  "toggles": [ ... ],            // optional
  "rules":   [ ... ]             // required; at least one rule
}
```

Any other top-level keys are ignored.

### Ids

An **id** is 1–32 characters from `a-z`, `0-9` and `-`, for example `low-health`. In a rule set, ids only link the file's own parts together:

- a rule's `folder` names a folder's `id`
- a `nearPlace` condition's `place` names a place's `id`
- a `toggle` condition names a toggle's `id`
- a `ruleActive` condition names a rule's `id`

On import, everything gets a fresh id, so it never collides with what is already on the dashboard. With **Replace**, the file's own ids are kept (see [Importing](#importing-and-exporting)).

### Folder

| Field | Required | Value |
|---|---|---|
| `id` | yes, if rules refer to it | id |
| `name` | yes | 1–64 characters |
| `enabled` | no (default `true`) | `false` turns off every rule in the folder |
| `collapsed` | no (default `false`) | Only affects the editor's list |

### Place

A saved spot that `nearPlace` conditions can use. **A place only counts in the world and dimension it was saved in.**

| Field | Required | Value |
|---|---|---|
| `id` | yes | id |
| `name` | yes | 1–64 characters |
| `world` | yes | 1–128 characters. The world's name, as the editor's **+ current** fills it in on a Server / world condition. For a server, that is the address as typed in the server list. Not case sensitive |
| `dimension` | yes | A dimension id such as `minecraft:overworld`, `minecraft:the_nether` or `minecraft:the_end` |
| `x`, `y`, `z` | yes | Numbers, −30 000 000 to 30 000 000 |

On import, a place equal in every field to one already on the dashboard is reused instead of added again.

### Toggle

A switch you flip by hand. Every toggle appears as a button at the top right of the dashboard. **All off**, next to them, turns every toggle off at once.

| Field | Required | Value |
|---|---|---|
| `id` | yes | id |
| `name` | yes | 1–32 characters |
| `on` | no (default `false`) | The starting state. Flipping a toggle is saved |

On import, a toggle with the same name as an existing one is reused, and keeps its current state.

### Rule

| Field | Required | Value |
|---|---|---|
| `id` | no | id. If missing, one is made from the name. Required if a `ruleActive` condition refers to this rule |
| `name` | yes | 1–64 characters. Names don't have to be unique |
| `enabled` | no (default `true`) | |
| `folder` | no (default `null`) | A folder `id` from this file, or `null` |
| `when` | no (default `[]`) | Up to 32 [conditions](#conditions) |
| `then` | no (default `[]`) | Up to 16 [actions](#actions), applied while active |
| `else` | no (default `[]`) | Up to 16 actions, applied while enabled but not active |
| `timing` | no | `{ "delayMs": 0–600000, "lingerMs": 500–600000 }`. Either key may be left out; the defaults are 0 and 2000 |
| `animation` | no (default `null`) | `{ "durationMs": 0–5000, "easing": "linear" \| "ease" \| "ease-in" \| "ease-out" \| "ease-in-out" }`. Used instead of the global animation for panels this rule shows, hides, moves or focuses. `null` uses the global one |

The order of `rules` is the priority order, highest first. Imported rules go after the existing ones, unless you use Replace.

## Profiles: arranging panels

A **profile** is a whole dashboard arrangement: where each panel is, how big it is, whether it is On, Rules only or Off, and the panels' settings.

- **Default** is the arrangement the dashboard uses when no rule says otherwise.
- Other profiles are named arrangements that a rule switches to with a [Switch profile](#actions) action. Other actions then apply on top of that profile.

```jsonc
"profiles": [
  {
    "name": "Default",
    "panels": {
      "player":    { "x": 0, "y": 0, "w": 4, "h": 4 },
      "inventory": { "x": 4, "y": 0, "w": 8, "h": 8 },
      "history":   { "x": 0, "y": 4, "w": 4, "h": 8, "mode": "rules" },
      "map":       "off"
    },
    "settings": { "xp": { "window": 300 } }
  },
  { "id": "mining", "name": "Mining", "panels": { "pickups": { "x": 0, "y": 0, "w": 6, "h": 8 } } }
]
```

### Profile fields

| Field | Required | Value |
|---|---|---|
| `name` | yes | 1–64 characters. **`"Default"`** (any case) means the Default arrangement |
| `id` | no | id. Lets Switch profile actions in the file name the profile by id. `"default"` also means Default |
| `panels` | no | The arrangement (see below). Left out, the profile keeps the panels it has, and a new profile gets the arrangement of a new dashboard (see [Panels](#panels)) |
| `settings` | no | Panel settings, as `{ "<panel>": { "<setting>": value } }` with the settings listed under [Panel settings](#panel-settings). Settings it leaves out get their **defaults**. Left out entirely, the profile keeps the settings it has, and a new profile gets the defaults |

On import, each profile in the file is handled by its name:

- **Default** changes the Default arrangement.
- A name that matches an existing profile (not case sensitive) **changes that profile**.
- Any other name **adds a profile**.
- With [Replace](#importing-and-exporting), every profile the file doesn't mention is removed. Default always stays. This only happens if the file defines at least one profile, so a rules-only file never touches your profiles.

An entry with only `id` and `name` (no `panels` or `settings`) defines nothing. Share strings use such entries to say which profile name an action means.

### Panels in a profile

`panels` maps [panel ids](#panels) to where each panel goes. **Panels left out are Off.**

| Value | Meaning |
|---|---|
| `{ "x": …, "y": …, "w": …, "h": … }` | The panel is **On** (always shown) at this spot |
| `{ "x": …, "y": …, "w": …, "h": …, "mode": "rules" }` | **Rules only**: the spot is kept, but the panel stays hidden until a rule's Show action shows it. While it's hidden, its neighbours fill the space |
| `{ "x": …, "y": …, "w": …, "h": …, "mode": "off" }` | **Off**, but remembers this spot for when it's turned on in Customize mode |
| `"off"` | Off, at its default spot |

The grid has **12 columns**, and rows as tall as needed:

- `x` is the column, 0–11, and `y` is the row, starting at 0. Both count from the top left.
- `w` is the width in columns and `h` the height in rows. Both must be at least the panel's minimum (see [Panels](#panels)), and `x + w` can be at most 12.
- Columns share the window's width. Rows are a fixed 40 px with 10 px gaps, so a panel `h` rows tall is `50 × h − 10` px high. A column is about 150 px wide on a 1920 px window, so a 4 × 12 panel there is roughly square.

The dashboard then **settles** the panels:

- Every shown or Rules only panel floats up to the highest row where it fits in its columns, so there are no empty gaps above a panel.
- Panels never overlap. Of two panels that would overlap, the one with the higher `y` (then lower `x`) is pushed down.
- Sizes below the minimum are raised to it, and panels that stick out to the right are moved left.

If a panel ends up somewhere other than where the file put it, the import says so, for example: `Profile "Default", panel "xp": placed at x 8, y 4, 4 × 4 instead of x 8, y 9, 4 × 4`. Plan rows from the top with no gaps, and the panels stay exactly where you put them.

## Conditions

Every condition is an object with a `type` and the type's parameters. Any condition can also have these fields:

| Field | Value |
|---|---|
| `join` | `"and"` (default) or `"or"`. Ignored on the first condition |
| `not` | `true` inverts the result (but never makes an unknown result true) |
| `for` | 1–3600: must have been true for this many seconds without a break. Not allowed on events |
| `within` | 1–3600: was true at any time in this many seconds. **Required** on events |

### Shared parameter shapes

- **compare**: `"compare"` is one of `"<"`, `"<="`, `"="`, `">="`, `">"`, `"!="` or `"between"`, with a number `"value"` (−1 000 000 000 to 1 000 000 000).
  - With `"between"`, add `"value2"`, which must be at least `value`. Both ends count.
  - `"="` compares exactly, so on values with decimals (speed, distances) use a range instead.
  - In the tables below, "compare" means these keys are required.
- **values**: a list of up to 32 strings. The condition is true if any of them matches. Duplicates are removed. An empty list never matches.
- **Registry ids** (items, blocks, entities and so on) look like `minecraft:diamond_pickaxe`: lowercase, with a namespace. Ids from mods work too.
- **Statistic ids** look like `minecraft:custom/minecraft:jump` or `minecraft:mined/minecraft:stone`. That is the statistic type, a slash, and the value.

### World

| Type | Parameters | True when |
|---|---|---|
| `world` | `values`: names (1–128 characters each) | The world's name is one of them (not case sensitive), or a value is `"server"` or `"singleplayer"` and matches the kind of world |
| `dimension` | `values` | The player is in one of these dimensions. `overworld`, `nether`, `the_nether`, `end` and `the_end` work as short names; anything without a namespace gets `minecraft:` |
| `biome` | `values` | The biome at the player's feet is one of these, e.g. `minecraft:desert`. `desert` and `Desert` work too: values are lowercased, spaces become `_` and `minecraft:` is added |
| `time` | `values`: any of `"dawn"`, `"day"`, `"dusk"`, `"night"`. **Or** instead `"ticks": { "from": 0–23999, "to": 0–23999 }` | It is that part of the day. Dawn is ticks 23000–999, day is 1000–11999, dusk is 12000–12999 and night is 13000–22999. A tick range includes both ends and wraps past midnight when `from` > `to`. Use `values` or `ticks`, not both |
| `weather` | `values`: any of `"clear"`, `"rain"`, `"thunder"` | |
| `day` | compare | The day counter (as on the F3 screen) |
| `gameMode` | `values`: any of `"survival"`, `"creative"`, `"adventure"`, `"spectator"` | |
| `moonPhase` | `values`: any of `"full"`, `"waningGibbous"`, `"thirdQuarter"`, `"waningCrescent"`, `"new"`, `"waxingCrescent"`, `"firstQuarter"`, `"waxingGibbous"` | |

### Position

| Type | Parameters | True when |
|---|---|---|
| `nearPlace` | Either `"place": "<place id>"`, or `"x"`, `"y"`, `"z"` with optional `"world"` (name) and `"dimension"`. Then either `"radius"` (above 0, up to 100 000) with optional `"flat": true`, or a box: `"x2"`, `"y2"`, `"z2"` | Within `radius` blocks (3D, or horizontally only with `flat`), or inside the box from x/y/z to x2/y2/z2. Box corners are block coordinates and both are inside the box. A saved place, or typed coordinates with a world or dimension, is false in any other world or dimension. A box can't have a radius, and a saved place can't have a box |
| `yLevel` | compare | The player's Y coordinate |
| `light` | `"source"`: `"combined"` (default), `"block"` or `"sky"`; compare | The light level 0–15 at the player's feet. Block light comes from torches and other lights. Sky light is the sky's light at full day, whatever the time. Combined is what the game uses for mob spawning: the higher of block light and the sky light dimmed by the time of day. [Sent only when needed](#sensors-that-are-only-sent-when-needed) |
| `spawnDistance` | compare | Horizontal distance in blocks to the world spawn. Unknown outside the spawn's dimension. On servers this is the spawn the server tells the client, which may not be exact |
| `lookingAt` | `"target"`: `"block"` (default) or `"entity"`; optional `"id"`; `"distance"`: whole number 1–64 | The crosshair points at a block (or entity) within `distance` blocks. With `id`, it must be that block or entity type, e.g. `minecraft:diamond_ore` or `minecraft:creeper`. An entity in front of a block counts as the entity. [Sent only when needed](#sensors-that-are-only-sent-when-needed) |

### Player

| Type | Parameters | True when |
|---|---|---|
| `health` | compare | Health in half-hearts (20 = full) |
| `food` | compare | Hunger 0–20 |
| `saturation` | compare | Saturation 0–20 |
| `absorption` | compare | Absorption (golden hearts) in half-hearts |
| `air` | compare | Seconds of air left (15 = full, 0 = drowning) |
| `armor` | compare | Armor points 0–20 (more with mods) |
| `xpLevel` | compare | Experience level |
| `effect` | `values`: effect ids such as `minecraft:speed` (or `speed`); optional `"level"`: compare; optional `"remaining"`: compare | The player has one of the effects, at a level (1 = level I) and with seconds left that pass the optional compares. Infinite effects have infinite time left |
| `movement` | `values`: any of `"ground"`, `"elytra"`, `"swimming"`, `"riding"`, `"flying"`, `"falling"` | How the player moves. Elytra wins over riding, riding over swimming, swimming over flying (creative or spectator), and flying over falling (in the air and falling faster than 1 block/s). Everything else is ground |
| `speed` | `"axis"`: `"total"` (default), `"horizontal"` or `"vertical"`; compare | Speed in blocks per second, averaged over the last half second. Vertical is negative while going down |
| `still` | — | Total speed below 0.1 blocks/s. Looking around doesn't count as moving. Combine with `for`, e.g. `"for": 30` |
| `afk` | compare | Minutes since the player last moved more than ¼ block, turned or moved the mouse cursor in game (the AFK panel's timer) |
| `onFire` | — | Burning |
| `inWater` | — | In water |
| `inLava` | — | In lava |
| `inRain` | — | Rain is falling on the player |
| `sneaking` | — | Holding sneak |
| `sprinting` | — | Sprinting |
| `sleeping` | — | In a bed |
| `riding` | optional `"entity"` | Riding anything, or that entity type, e.g. `minecraft:horse`, `minecraft:boat`, `minecraft:minecart` |
| `usingItem` | `values`: any of `"eating"`, `"drinking"`, `"blocking"`, `"bow"`, `"crossbow"`, `"trident"`, `"spear"`, `"spyglass"`, `"horn"`, `"brush"`, `"bundle"`, `"fishing"` | The player is doing that right now: eating or drinking, holding up a shield, drawing a bow, loading a crossbow, readying a trident or spear, looking through a spyglass, blowing a goat horn, brushing or using a bundle. `fishing` means the fishing hook is out |

### Inventory

| Type | Parameters | True when |
|---|---|---|
| `holding` | `"item"`: item id; `"hand"`: `"either"` (default), `"main"` or `"off"` | That item is in that hand |
| `hasItem` | `"item"`; compare; optional `"enderChest": true` | The number of that item in the 36 inventory slots, armor and offhand passes the compare. With `enderChest`, the ender chest counts too, as it was the last time you opened it |
| `freeSlots` | compare | Empty slots among the 36 inventory slots |
| `durability` | `"target"`: `"held"` (default), `"armor"` or `"tool"`; compare | Durability left, in percent, of the held item, any armor piece, or any damageable item in the inventory or offhand (`tool`). True if any of them passes. Unknown if none of them can be damaged |
| `elytra` | — | An elytra (or another glider) is equipped |

### Amounts

Amounts count how much was gained in the last `"window"` seconds. They all take compare plus `"window"`, a whole number 1–3600. "Any amount" is `"compare": ">=", "value": 1`.

| Type | Extra parameter | Counts |
|---|---|---|
| `xpGained` | — | Experience points gained (not levels). Spending levels doesn't subtract |
| `pickedUp` | optional `"item"` | Items added to the inventory (picked up, crafted, taken from containers…), of that item or any. Only the last 32 pickups are remembered |
| `statRose` | `"stat"` (required): statistic id | How much the statistic went up |
| `minedBlock` | optional `"block"` | Blocks mined, of that block or any |
| `placedBlock` | optional `"block"` | Blocks placed, of that block or any |
| `killedMob` | optional `"entity"` | Mobs killed, of that type or any |
| `tookDamage` | — | Damage taken, in **hearts** (health plus absorption lost) |

Some notes on amounts:

- Amounts the dashboard counts itself only cover the time since the page was opened.
- Statistics (`statRose`, and `minedBlock`/`placedBlock` with a specific block) are asked from the server at most every 10 seconds, so they lag by up to about 10 seconds.
- `xpGained` with a window of 10, 30, 60, 300, 600 or 3600 seconds uses the game's exact count. Other windows are counted by the dashboard.

### Events

Events need `"within": N` (1–3600) and are true if the event happened in the last N seconds. They can't have `for`.

| Type | Extra parameter | Event |
|---|---|---|
| `advancement` | optional `"advancement"`: advancement id, e.g. `minecraft:story/mine_diamond` | That advancement, or any advancement, was earned |
| `died` | — | The player died |
| `changedDimension` | — | The player changed dimension |
| `joinedWorld` | — | The player joined the world (session time is at most N seconds) |
| `inCombat` | — | The player took damage, killed something or died |

### Threats

The first three use the entity scan, which is [sent only when needed](#sensors-that-are-only-sent-when-needed). `radius` is a whole number from 1 to 64 blocks, and the scan never reaches past your render distance.

| Type | Parameters | True when |
|---|---|---|
| `hostilesNearby` | `"radius"`; optional `"entity"`; compare | The number of hostile mobs (of that type, if given) within the radius passes the compare |
| `mobNearby` | `"entity"` (required); `"radius"` | At least one entity of that type is within the radius. Any living entity counts, including passive mobs |
| `playersNearby` | `"radius"`; compare | The number of other players within the radius passes the compare |
| `bossBar` | — | A boss bar is on screen (wither, ender dragon, or a server's). A raid's bar doesn't count |
| `raid` | — | A raid's bar is on screen |

### Villagers

| Type | Parameters | True when |
|---|---|---|
| `villagersNearby` | `"radius"`: whole number 1–256; compare | The number of villagers MinePanel knows about (ones you have seen or traded with) in your dimension, within the radius |

### Screens

| Type | Parameters | True when |
|---|---|---|
| `screen` | `values`: any of `"inventory"`, `"chest"`, `"enderChest"`, `"furnace"`, `"crafting"`, `"anvil"`, `"enchanting"`, `"brewing"`, `"trading"`, `"smithing"`, `"grindstone"`, `"stonecutter"`, `"loom"`, `"cartography"`, `"beacon"`, `"other"` | That kind of screen is open. `inventory` is your own inventory (survival or creative). `chest` covers chests, barrels, shulker boxes, dispensers, droppers and hoppers. `furnace` covers furnaces, blast furnaces and smokers. `trading` is a villager or wandering trader. `other` is any other screen, including chat, the pause menu and modded screens. To match no screen open, use `"not": true` with every value. [Sent only when needed](#sensors-that-are-only-sent-when-needed) |

### Features

| Type | Parameters | True when |
|---|---|---|
| `portalLinking` | `"minutes"`: whole number 1–120 | You went through a Nether portal and are in the target dimension, and none of these has happened yet: a lit portal appeared near where the linked portal belongs, `minutes` passed, or you went back through. Going straight back through a portal pair doesn't start it |

### Dashboard

These work outside a world too, except `sessionTime`.

| Type | Parameters | True when |
|---|---|---|
| `toggle` | `"toggle"`: toggle id | That toggle is on |
| `ruleActive` | `"rule"`: rule id | That rule is active right now. Rules can't depend on themselves, directly or through other rules |
| `width` | compare | The browser window's width in pixels. Each browser works this out for itself, so a phone and a monitor can show different layouts |
| `realTime` | `"from"`, `"to"`: `"HH:MM"` (24-hour); optional `"days"`: list of weekdays 0–6 (0 = Sunday) | The computer's clock is from `from` up to, but not including, `to`, on those days (every day if `days` is left out). It wraps past midnight when `from` is later than `to`. Equal times mean all day |
| `sessionTime` | compare | Minutes since joining the world |
| `inGame` | — | Connected to a world |

### Sensors that are only sent when needed

`light`, `lookingAt`, `hostilesNearby`, `mobNearby`, `playersNearby` and `screen` need the game to do extra work. The mod only collects them while an **enabled rule in an enabled folder** uses them:

- Right after you import or turn on such a rule, they are unknown until the next update arrives.
- A disabled rule previewed with **Force on** has no data for them.
- The entity scan runs at most twice a second, within the largest radius any rule asks for.
- The look target uses the largest `distance` any rule asks for.

## Actions

Every action is an object with `"do"` and its parameters.

| `do` | Parameters | What it does |
|---|---|---|
| `profile` | `"profile"`: a profile's **name** (not case sensitive) or id, a profile `id` from the file, or `"default"` | Uses that profile as the base layout. Other actions apply on top of it. The profile can be one the same file defines. If neither the file nor the dashboard has it, the import leaves the action out and warns |
| `show` | `"panel"` | Shows the panel. It only works on a panel that is On or Rules only in the profile in use (see [above](#what-the-dashboard-then-shows)). Its neighbours shrink to make room |
| `hide` | `"panel"`; optional `"fill"`: `"auto"` (default), `"empty"`, or another panel id | Hides the panel. `auto` lets its neighbours grow into the space. `empty` leaves the space blank. A panel id makes that panel take the space: it grows over it if that makes a rectangle, and otherwise moves into it |
| `place` | `"panel"`; `"x"`, `"y"`, `"w"`, `"h"` | Moves and resizes the panel on the 12-column grid. `x` is the column (0–11) and `y` the row (0–1000), both counted from 0 at the top left. `w` is the width in columns, at least the panel's minimum and at most 12, with `x + w` ≤ 12. `h` is the height in rows, from the panel's minimum to 60. The panels it overlaps shrink away from it. Its old spot is filled |
| `swap` | `"panel"`; `"with"`: another panel id | The two panels trade places and sizes |
| `focus` | `"panel"` | Draws the panel above everything, covering nearly the whole screen. The other panels fade out without moving |
| `set` | `"panel"`; `"setting"`; `"value"` | Changes one of the panel's settings (see [Panel settings](#panel-settings)) |
| `notify` | `"text"`: 1–128 characters; `"cooldown"`: whole seconds 0–3600 (default 0) | Shows a message at the bottom right for 6 seconds, with no sound. In Then, it fires once when the rule becomes active; in Else, once when it stops being active. It doesn't repeat while the rule stays active. `cooldown` is the least time between two showings of the same message |

## Panels

`panel`, `with` and `fill` take these ids. The minimum sizes are in grid cells (columns × rows), and the default spots are in the Default profile of a new dashboard.

| Id | Panel | Minimum w × h | Default x, y, w, h |
|---|---|---|---|
| `player` | Player (health, food, effects, position) | 2 × 2 | 0, 0, 4, 4 |
| `inventory` | Inventory | 3 × 2 | 4, 0, 8, 8 |
| `statistics` | Statistics | 2 × 3 | 0, 4, 4, 9 |
| `history` | Activity log | 3 × 3 | 4, 8, 8, 9 |
| `movement` | Movement | 2 × 2 | 0, 13, 4, 4 |
| `xp` | Experience | 2 × 2 | 0, 17, 4, 4 |
| `performance` | Performance (frame rate) | 2 × 2 | 0, 21, 4, 4 |
| `pickups` | Recent pickups | 2 × 2 | 4, 17, 4, 6 |
| `advancements` | Advancements | 3 × 3 | 8, 17, 4, 8 |
| `villagers` | Villager trades | 3 × 3 | 0, 25, 8, 8 |
| `map` | JourneyMap (off by default) | 2 × 2 | 0, 33, 6, 6 |
| `build` | Build progress, from Litematica (off by default) | 2 × 2 | 6, 33, 6, 4 |
| `afk` | AFK timer over a crawl of your statistics (off by default) | 3 × 3 | 6, 37, 6, 6 |
| `model` | 3D render of your player | 2 × 3 | 8, 25, 4, 8 |

The default spots are what a profile gets when the file leaves `panels` out for a new profile, and what an `"off"` panel remembers. Your own dashboard's arrangement may differ; **Download all rules** includes it.

## Panel settings

`set` actions take these `panel` and `setting` pairs. Lists can't contain duplicates. While the rule applies, the value replaces the profile's setting.

| Panel | Setting | Value | Default |
|---|---|---|---|
| `inventory` | `showArmor` | `true` / `false`: show the armor and offhand slots | `true` |
| `statistics` | `shown` | List of up to 512 statistic ids shown on the panel | walk, sprint, jumps, deaths, mob kills, player kills, play time |
| `statistics` | `recentExcluded` | List of statistic ids never listed under Recent | timers (play time and so on) |
| `statistics` | `recentLifetime` | 0–3600: seconds a change stays under Recent (0 = until pushed out) | `60` |
| `statistics` | `recentRows` | 1–32 | `8` |
| `map` | `url` | The map's address: `http://127.0.0.1` or `http://localhost`, an optional port and path, at most 200 characters | `"http://127.0.0.1:8080/"` |
| `movement` | `showVertical` | `true` / `false`: show vertical speed | `true` |
| `movement` | `showGlider` | `true` / `false`: show the elytra's durability and flight time | `true` |
| `xp` | `window` | One of `10`, `30`, `60`, `300`, `600`, `3600`: seconds the XP per hour is averaged over | `60` |
| `xp` | `goals` | List of up to 8 target levels (1–10000) | `[]` |
| `performance` | `window` | One of `10`, `30`, `60`, `600`: seconds of frame-rate history | `60` |
| `pickups` | `lifetime` | 0–3600: seconds a pickup stays listed | `30` |
| `pickups` | `maxRows` | 1–32 | `8` |
| `pickups` | `showSource` | `true` / `false`: show how the item arrived | `true` |
| `pickups` | `ignored` | List of up to 64 item ids never listed | `[]` |
| `advancements` | `popupSeconds` | 0–300: how long a newly earned advancement pops up (0 = never) | `10` |
| `advancements` | `hiddenTabs` | List of up to 64 advancement tab ids left out | `[]` |
| `advancements` | `pinned` | List of up to 64 advancement ids listed first | `[]` |
| `model` | `spin` | `true` / `false`: turn on its own (the model still holds still when the system asks for reduced motion) | `true` |
| `model` | `axis` | `"y"` (turntable), `"x"` (head over heels) or `"z"` (cartwheel) | `"y"` |
| `model` | `speed` | One of `15`, `30`, `60`, `120`: degrees a second | `30` |

## Importing and exporting

Open **Rules → Import / export**:

- **Import** reads the box. It accepts a rule set (JSON starting with `{`) or a share string (`minepanel-rules:1:…`).
- **Choose file…** reads a `.json` file.
- **Replace all rules, folders, places and toggles (and profiles, if the file has any)**: tick it before importing to throw away every current rule, folder, place and toggle and put the file's in their place.
  - If the file defines profiles, profiles it doesn't mention are removed too; Default is changed only if the file defines it.
  - The file's own ids are kept.
  - The update rate, pinned windows and the global animation are left alone.
  - The box unticks itself after each import.
- Without Replace, imports **add** rules, folders, places, toggles and new profiles, with fresh ids. Profiles in the file named like existing ones (or "Default") change those profiles. Nothing else is replaced.
- **Download all rules** saves the whole setup as `minepanel-rules.json`, in the format described here: every profile (Default first) with all its panels and the settings it changes from the defaults, and every rule, folder, place and toggle. Its Switch profile actions name the profile. Importing it with Replace gives exactly the same dashboard back.

Importing goes through these steps:

1. Missing optional fields get their defaults.
2. Profiles are arranged, and the panels settle. Panels that end up elsewhere than the file asked are listed as warnings.
3. Ids in the file are matched up and renamed where they clash.
4. A Switch profile action whose profile is neither in the file nor on this dashboard is **left out**, with a warning.
5. A condition that refers to a place, toggle or rule the file doesn't contain is **left out**, with a warning. It is never attached to something else that happens to have the same id.
6. The result is checked as a whole. If anything is invalid, **nothing is imported**, and the error names the rule and the condition or action. For example:
   - `Rule "Low health": condition 2: compare: invalid value`
   - `Rule "Combat": Then action 1: unknown panel`
7. Fields the dashboard doesn't use are **listed as warnings**, for example `Rule "Run": condition 2: ignored "comapre"` or `Profile "Mining": ignored settings "pickups.colour"`. A misspelled optional field is otherwise silently ignored, so read the warnings.

**Share strings** (Share on a rule or folder) carry the same data in a single line of text. A shared rule brings along the rules it reads through `ruleActive`, and the places and toggles it uses. A shared folder comes in as a new folder.

## The editor

Everything in a rule set can also be made in the editor (**Rules** at the top of the dashboard):

- **Rule list**: in priority order, with a dot for each rule that is active now. A folder's rules are kept together:
  - ↑/↓ on a rule moves it within its folder, or past a whole folder.
  - ↑/↓ on a folder moves the folder with its rules.
  - The checkbox turns a folder on or off, and ▸/▾ collapses it.
- **+ New rule**, **+ Folder**, **From template** (ten ready-made rules), and **Import / export**.
- **Rule**:
  - Name, Enabled, Folder, Duplicate, Share and Delete.
  - **Preview**: Force on or off, only in this browser, until the editor closes.
  - **When**: one row per condition, each showing its live value, with green for true and red for false. Each OR block is green or red too.
  - **Then** and **Else** action lists.
  - **Timing**: delay, linger and the rule's own animation.
- **Copy and paste**: tick rows, click Copy, then Paste in any rule (conditions into When, actions into Then or Else).
- **Side panel** docks the editor beside the live dashboard. There, clicking a panel shows every rule that claims it and which claim wins (the inspector), and **Set on grid** on a Place action lets you drag the panel's outline.
- **Places**, **Toggles** and **Settings** (the global animation) each have their own section, as does the recent activity log.

## Limits

| What | Limit |
|---|---|
| Rules | 128 in total, including what is already there unless you replace |
| Conditions per rule | 32 |
| Actions | 16 in Then and 16 in Else |
| Profiles | 16 besides Default |
| Folders | 32 |
| Places | 64 |
| Toggles | 16 |
| Values in one `values` list | 32 |
| Rule set size | 512 KB |
| The whole saved layout (panels, profiles, settings and rules together) | 256 KB |

## Writing rule sets with an agent

Give the agent this file, then work in a loop:

1. **Download all rules** to give the agent your current setup: profiles, panel arrangements and rules (optional).
2. Have the agent write or edit the rule set.
3. Import it with **Replace** ticked to swap the whole setup, or without it to add rules and profiles.
4. If the import fails, the error names the rule and the condition. If it succeeds, read any warnings. Give either back to the agent.

Tips for agents:

- Always write `"format": "minepanel-rules", "version": 1`.
- Give rules ids when other rules refer to them (`ruleActive`), and put shared logic in a helper rule without actions.
- Order rules so the most important ones come first. A higher rule wins every conflict over a panel, setting, profile or focus.
- Show only works on panels that are Rules only (or On) in the profile in use. Give every panel a rule shows `"mode": "rules"` in that profile, so it is hidden until the rule shows it.
- Arrange panels row by row from the top with no gaps, and keep each panel at least its minimum size, so nothing gets moved when it settles. List every panel you want; the rest are off.
- Use a separate profile for a very different arrangement (for example a "Nether" or "Phone" layout), and a Switch profile action to use it. Use Place, Swap and Hide for small changes on top of a profile.
- Remember Focus shows a panel even if it is Off or hidden, so a panel that is only ever focused can be `"off"`.
- Use `for` or the rule's `delayMs` against flickering on noisy values. Use `within` or `lingerMs` to keep a panel up for a while after something happens. For farm detection rules (a kill rate or another amount), use `"lingerMs": 20000`.
- `"="` on decimal values (speed, distance, light combined with others) rarely matches. Use `"between"`.
- Places are tied to one world and dimension, and the world name must match exactly as the Player panel shows it.

## Full example

This file sets up a whole dashboard:

- **Default** has the player, inventory and experience panels, with pickups beside them. The activity log is Rules only, and the map is Off.
- **Nether** is a second arrangement with a big map.
- **Combat** (a folder) shows the activity log and hides pickups while three or more hostile mobs are near. It also warns when health is low during a fight.
- **Travel** (a folder) focuses the map while flying with an elytra, and switches to the Nether profile in the Nether, unless the "Building" toggle is on.

```json
{
  "format": "minepanel-rules",
  "version": 1,
  "profiles": [
    {
      "name": "Default",
      "panels": {
        "player":    { "x": 0, "y": 0, "w": 4, "h": 4 },
        "inventory": { "x": 4, "y": 0, "w": 8, "h": 8 },
        "xp":        { "x": 0, "y": 4, "w": 4, "h": 4 },
        "history":   { "x": 0, "y": 8, "w": 6, "h": 8, "mode": "rules" },
        "pickups":   { "x": 6, "y": 8, "w": 6, "h": 6 },
        "map":       "off"
      },
      "settings": { "xp": { "window": 300 } }
    },
    {
      "id": "nether",
      "name": "Nether",
      "panels": {
        "player":   { "x": 0, "y": 0, "w": 6, "h": 4 },
        "movement": { "x": 6, "y": 0, "w": 6, "h": 4 },
        "map":      { "x": 0, "y": 4, "w": 12, "h": 10 }
      }
    }
  ],
  "folders": [
    { "id": "combat", "name": "Combat" },
    { "id": "travel", "name": "Travel" }
  ],
  "toggles": [
    { "id": "building", "name": "Building" }
  ],
  "places": [
    { "id": "base", "name": "Base", "world": "My World", "dimension": "minecraft:overworld", "x": 120, "y": 64, "z": -340 }
  ],
  "rules": [
    {
      "id": "fighting",
      "name": "Fighting",
      "folder": "combat",
      "when": [
        { "type": "hostilesNearby", "radius": 16, "compare": ">=", "value": 3 },
        { "join": "or", "type": "inCombat", "within": 10 }
      ],
      "then": [
        { "do": "show", "panel": "history" },
        { "do": "hide", "panel": "pickups" }
      ],
      "timing": { "lingerMs": 5000 }
    },
    {
      "name": "Low health warning",
      "folder": "combat",
      "when": [
        { "type": "ruleActive", "rule": "fighting" },
        { "join": "and", "type": "health", "compare": "<=", "value": 6 }
      ],
      "then": [
        { "do": "focus", "panel": "player" },
        { "do": "notify", "text": "Low health!", "cooldown": 30 }
      ]
    },
    {
      "name": "Elytra map",
      "folder": "travel",
      "when": [
        { "type": "movement", "values": ["elytra"], "for": 3 },
        { "join": "and", "type": "nearPlace", "place": "base", "radius": 200, "flat": true, "not": true }
      ],
      "then": [{ "do": "focus", "panel": "map" }],
      "animation": { "durationMs": 500, "easing": "ease-in-out" }
    },
    {
      "name": "Nether layout",
      "folder": "travel",
      "when": [
        { "type": "dimension", "values": ["nether"] },
        { "join": "and", "type": "toggle", "toggle": "building", "not": true }
      ],
      "then": [{ "do": "profile", "profile": "Nether" }],
      "else": [{ "do": "set", "panel": "xp", "setting": "window", "value": 300 }]
    }
  ]
}
```

In this example, "Low health warning" focuses the Player panel even when "Elytra map" would focus the map, because it comes first. "Nether layout" switches to the Nether profile the same file defines. The Fighting rule's Show works because the activity log is Rules only in Default. The map is Off in Default, but Focus still shows it while flying. Every panel is placed row by row with no gaps, so the import has no warnings.
