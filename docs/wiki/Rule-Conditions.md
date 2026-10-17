# Rule conditions

[Home](Home.md) › [Rules](Rules.md) › Rule conditions

Every condition a rule's **When** list can use, grouped as in the editor's type list. Each entry gives the name shown in the editor, the **type** id used in [rule set files](Rule-Sets.md), and when it's true.

Any condition can also use **Not**, **For** or **Within** (see [How a rule decides](Rules.md#how-a-rule-decides)).

**Compare** means you pick `<`, `≤`, `=`, `≥`, `>`, `≠` or *between* (both ends included) and a number. *between* is the safe choice for values with decimals.

Contents: [World](#world) · [Position](#position) · [Player](#player) · [Inventory](#inventory) · [Amounts](#amounts) · [Events](#events) · [Threats](#threats) · [Villagers](#villagers) · [Screens](#screens) · [Features](#features) · [Dashboard](#dashboard) · [On-demand sensors](#on-demand-sensors)

## World

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Server / world | `world` | names | The world or server is one of these (not case sensitive). For a server, the name is the address as typed in the server list. The values `server` and `singleplayer` match any world of that kind. **+ current** fills in the current one |
| Dimension | `dimension` | list | You're in one of these dimensions. `overworld`, `nether` and `end` work as short names |
| Biome | `biome` | picker | The biome at your feet is one of these |
| Time of day | `time` | dawn / day / dusk / night, **or** a tick range | Dawn is ticks 23000–999, day 1000–11999, dusk 12000–12999, night 13000–22999. A tick range wraps past midnight if *from* is later than *to* |
| Weather | `weather` | clear / rain / thunder | |
| Day | `day` | compare | The day counter, as on the F3 screen |
| Game mode | `gameMode` | survival / creative / adventure / spectator | |
| Moon phase | `moonPhase` | the eight phases | |

## Position

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Near | `nearPlace` | a saved [place](Rules.md#places), or typed X/Y/Z; then a radius (optionally flat, ignoring height) **or** a box with a second corner | You're within the radius, or inside the box (both corners included). A place only counts in its own world and dimension |
| Y level | `yLevel` | compare | Your Y coordinate |
| Light level | `light` | combined / block / sky; compare | Light level 0–15 at your feet. *Block* is torches and other lights. *Sky* is the sky's light at full day, whatever the time. *Combined* is what the game uses for mob spawning. [On demand](#on-demand-sensors) |
| Distance from spawn | `spawnDistance` | compare (blocks) | Horizontal distance to the world spawn. Unknown in other dimensions. On servers, this is the spawn the server tells the client, which may not be exact |
| Looking at | `lookingAt` | block or entity; optional type; distance 1–64 | Your crosshair is on a block (or entity) within that distance, of that type if given. An entity in front of a block counts as the entity. [On demand](#on-demand-sensors) |

## Player

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Health | `health` | compare | Health in half-hearts (20 = full) |
| Hunger | `food` | compare | Hunger 0–20 |
| Saturation | `saturation` | compare | Saturation 0–20 |
| Absorption | `absorption` | compare | Golden hearts, in half-hearts |
| Air | `air` | compare (seconds) | Air left: 15 is full, 0 is drowning |
| Armor points | `armor` | compare | Armour points 0–20 (more with mods) |
| XP level | `xpLevel` | compare | Your experience level |
| Status effect | `effect` | effects; optional level compare; optional time-left compare (seconds) | You have one of these effects, at that level (1 = level I) and with that much time left. Infinite effects have infinite time left |
| Moving by | `movement` | on foot / elytra / swimming / riding / flying / falling | How you're moving. Elytra beats riding, riding beats swimming, swimming beats flying (creative/spectator), flying beats falling (in the air, falling faster than 1 block/s). Anything else is on foot |
| Speed | `speed` | total / horizontal / vertical; compare (blocks/s) | Your speed, averaged over half a second. Vertical is negative going down |
| Standing still | `still` | — | Speed below 0.1 blocks/s. Looking around doesn't count as moving. Use with **For**, e.g. for 30 s |
| AFK for | `afk` | compare (minutes) | Minutes since you last moved more than ¼ block, turned, or moved the mouse cursor in game. Same timer as the [AFK panel](Panels.md#afk) |
| On fire / In water / In lava / In rain / Sneaking / Sprinting / Sleeping | `onFire`, `inWater`, `inLava`, `inRain`, `sneaking`, `sprinting`, `sleeping` | — | That's happening right now. *In rain* means rain is actually falling on you |
| Riding | `riding` | optional entity | You're riding anything, or that kind of entity (horse, boat, minecart, …) |
| Using an item | `usingItem` | eating, drinking, blocking, drawing a bow, loading a crossbow, throwing a trident, using a spear, spyglass, goat horn, brushing, bundle, fishing | You're doing that right now. *Fishing* means your hook is out |

## Inventory

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Holding | `holding` | item; either hand / main / off | That item is in that hand. **+ held** fills in what you're holding |
| Has item | `hasItem` | item; compare; optionally include the ender chest | How many of that item you carry (36 slots, armour and offhand) passes the compare. With the ender chest, its contents count too, as they were when you last opened it |
| Free slots | `freeSlots` | compare | Empty slots among your 36 inventory slots |
| Durability | `durability` | held / armor / tool; compare (%) | Durability left on the held item, any armour piece, or any damageable item you carry (*tool*). True if any of them passes. Unknown if none can be damaged |
| Wearing elytra | `elytra` | — | An elytra (or other glider) is equipped |

## Amounts

Amounts count how much happened in the last **window** seconds (1–3600). "Any at all" is `≥ 1`.

| Editor name | Type | Settings | Counts |
|---|---|---|---|
| Gained XP | `xpGained` | compare; window | Experience points gained. Spending levels doesn't subtract |
| Picked up | `pickedUp` | optional item; compare; window | Items added to your inventory (picked up, crafted, taken from containers, …). Only the last 32 pickups are remembered |
| Statistic rose | `statRose` | statistic; compare; window | How much a statistic went up |
| Mined | `minedBlock` | optional block; compare; window | Blocks mined |
| Placed | `placedBlock` | optional block; compare; window | Blocks placed |
| Killed | `killedMob` | optional mob; compare; window | Mobs killed |
| Took damage (hearts) | `tookDamage` | compare; window | Damage taken in **hearts**, including absorption |

Notes:

- Amounts the dashboard counts itself only cover the time since the dashboard was opened.
- Statistic-based amounts (*Statistic rose*, and *Mined*/*Placed* with a specific block) can lag by about 10 seconds, because statistics come from the server.
- *Gained XP* with a window of 10, 30, 60, 300, 600 or 3600 seconds uses the game's exact count.

## Events

Events are true if the event happened in the last **N** seconds. They always use **Within** (1–3600 s) and can't use For.

| Editor name | Type | Settings | Event |
|---|---|---|---|
| Advancement earned | `advancement` | optional advancement | That advancement, or any, was earned |
| Died | `died` | — | You died |
| Changed dimension | `changedDimension` | — | You changed dimension |
| Joined the world | `joinedWorld` | — | You joined the world |
| In combat | `inCombat` | — | You took damage, killed something or died |

## Threats

The radius is 1–64 blocks and never reaches past your render distance.

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Hostile mobs nearby | `hostilesNearby` | radius; optional mob; compare | The number of hostile mobs (of that type, if given) within the radius passes the compare. [On demand](#on-demand-sensors) |
| Mob nearby | `mobNearby` | mob; radius | At least one of that mob is within the radius. Passive mobs count too. [On demand](#on-demand-sensors) |
| Players nearby | `playersNearby` | radius; compare | The number of other players within the radius passes the compare. [On demand](#on-demand-sensors) |
| Boss bar visible | `bossBar` | — | A boss bar is on screen (wither, ender dragon, or a server's). A raid's bar doesn't count |
| Raid active | `raid` | — | A raid's bar is on screen |

## Villagers

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Known villagers nearby | `villagersNearby` | radius 1–256; compare | The number of villagers MinePanel knows (ones you've traded with) within the radius, in your dimension |

## Screens

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Screen open | `screen` | own inventory, chest-like, ender chest, furnace-like, crafting, anvil, enchanting, brewing, villager trading, smithing, grindstone, stonecutter, loom, cartography, beacon, any other screen | That kind of screen is open. *Chest-like* covers chests, barrels, shulker boxes, dispensers, droppers and hoppers. *Furnace-like* covers furnaces, blast furnaces and smokers. *Any other screen* includes chat, the pause menu and modded screens. For "no screen open", tick every value and use **Not**. [On demand](#on-demand-sensors) |

## Features

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Linking a portal | `portalLinking` | minutes 1–120 | You went through a Nether portal and haven't yet: built a lit portal near where the linking one belongs, gone back through, or waited that many minutes. Going straight back through doesn't start it. Same as the [Link portal](Panels.md#link-portal) guide |

## Dashboard

These work outside a world too, except Session time.

| Editor name | Type | Settings | True when |
|---|---|---|---|
| Toggle on | `toggle` | toggle | That [toggle](Rules.md#toggles) is on |
| Rule active | `ruleActive` | rule | That rule is active. A rule can't depend on itself, directly or through other rules |
| Dashboard width | `width` | compare (px) | The browser window's width. Worked out per browser, so a narrow window and a wide one can differ |
| Real-world time | `realTime` | from and to (HH:MM, 24-hour); optional weekdays | Your computer's clock is from *from* up to (not including) *to*, on those days. Wraps past midnight. Equal times mean all day |
| Session time | `sessionTime` | compare (minutes) | Minutes since you joined the world |
| In a world | `inGame` | — | You're connected to a world |

## On-demand sensors

**Light level**, **Looking at**, **Hostile mobs nearby**, **Mob nearby**, **Players nearby** and **Screen open** make the game do extra work, so MinePanel only collects them while an **enabled rule in an enabled folder** uses them.

- Right after you add or enable such a rule, the condition is unknown until the next update arrives.
- A disabled rule previewed with **Force on** has no data for them.
- The mob scan runs at most twice a second, out to the largest radius any rule asks for.
