# Panels

[Home](Home.md) › Panels

Every panel, what it shows and how to configure it. Settings marked **⚙** are changed with the panel's own settings button; all settings can also be changed by a rule's [Set panel setting](Rule-Actions.md#set-panel-setting) action, and are saved per [profile](Customizing.md#profiles).

## Overview

| Panel | Id | On by default | Minimum size (w × h) | Settings |
|---|---|---|---|---|
| [Player](#player) | `player` | yes | 2 × 2 | — |
| [Inventory](#inventory) | `inventory` | yes | 3 × 2 | Armor |
| [Statistics](#statistics) | `statistics` | yes | 2 × 3 | ⚙ |
| [Activity log](#activity-log) | `history` | yes | 3 × 3 | — |
| [Movement](#movement) | `movement` | yes | 2 × 2 | rules only |
| [Experience](#experience) | `xp` | yes | 2 × 2 | ⚙, window |
| [Performance](#performance) | `performance` | yes | 2 × 2 | window |
| [Recent pickups](#recent-pickups) | `pickups` | yes | 2 × 2 | ⚙ |
| [Advancements](#advancements) | `advancements` | yes | 3 × 3 | ⚙ |
| [Villager trades](#villager-trades) | `villagers` | yes | 3 × 3 | — |
| [3D render](#3d-render) | `model` | yes | 2 × 3 | ⚙ |
| [AFK](#afk) | `afk` | no | 3 × 3 | — |
| [JourneyMap](#journeymap) | `map` | no | 2 × 2 | ⚙ |
| [Build progress](#build-progress) | `build` | no | 2 × 2 | — |

Sizes are in grid cells: the grid is 12 columns wide and each row is 40 px. The **id** is what rules and rule set files use.

---

## Player

Your vitals and where you are.

- **Health bar** with absorption (golden hearts) on top of it.
- **Hunger bar** with a gold **saturation** bar above it, and the hunger / saturation numbers.
- **Position** (X, Y, Z).
- **Status effects**: each with its icon, level and a countdown. Effects kept up by a beacon or conduit are marked with ◆ and have no countdown (the beacon keeps topping them up). Hover an effect for its full name.
- **Dimension** and **session** time (how long you've been in this world).
- The badge says **In world**, **No active world** or **Unavailable**.

Click your **player head** for the [player menu](Dashboard.md#player-menu).

## Inventory

A read-only copy of your inventory: the hotbar (selected slot highlighted), the 27 main slots, armour, offhand and an ender chest slot. The line at the top names the item you're holding.

- **Armor** (chip in the title bar) shows or hides the armour and offhand slots. Setting: `showArmor` (default on).
- **Hover** an item for its tooltip; **click** a shulker box, bundle or the ender chest to open an [item window](Dashboard.md#item-windows).
- When the panel is small it shows only the whole rows that fit, hotbar first, instead of scrolling or cutting rows in half.

## Statistics

Vanilla statistics, as the server reports them.

| Column | Meaning |
|---|---|
| **Total** | Your total on this server or world |
| **Session** | Change since MinePanel first received that statistic this session |
| **Avg/h** | Average per hour this session |
| **60s/h** | Rate per hour over the last 60 seconds |

Below the statistics you picked, a **Recent** section lists any other statistic that changed recently, for example blocks mined while you mine.

**⚙ Choose statistics** opens a list of every statistic, with a search box:

- **Show** pins a statistic to the panel. Default: walked, sprinted, jumps, deaths, mob kills, player kills, play time.
- **Recent** lets a statistic appear under Recent when it changes. Timers like play time are excluded by default.
- **Keep recent for** 10 seconds, 30 seconds, 1 minute (default), 5 minutes or *Until replaced*.
- **Rows**: how many Recent rows (1–32, default 8).
- **Defaults** restores the default choices.

| Setting | Values | Default |
|---|---|---|
| `shown` | up to 512 statistic ids | the seven above |
| `recentExcluded` | statistic ids | timers |
| `recentLifetime` | 0–3600 seconds (0 = until replaced) | 60 |
| `recentRows` | 1–32 | 8 |

Notes:

- MinePanel asks the server for statistics when you join and then every few seconds. Restrictive servers may not answer; statistics then show **Unavailable**, never a made-up zero.
- Distances are shown in metres or kilometres and times as durations.

## Activity log

A running log of what happened this session, newest first:

- blocks **mined** and **placed**
- **containers** opened, and the net change to your inventory while they were open
- items **dropped**
- **damage** taken, with its source, and **healing** back to full health
- **deaths** with the death message, and respawns
- **mobs killed**, by exact type (including bow and other indirect kills)
- **advancements**
- **dimension** changes, **biome** changes (after 5 seconds in the new biome), **weather** changes and each new **day**
- joining and leaving the world

Repeated actions within five seconds are merged, for example "Mined 12 × Stone". Click an entry to expand its details, for example the damage source or the full death message.

- **Category** filters to one kind of event; **Search** filters by text.
- The panel keeps the newest 500 events. Every event is also saved to a file (see [Files and privacy](Files-and-Privacy.md)).

### Link portal

After you go through a **Nether portal**, a **Link portal** button appears in the title bar. It opens a guide to building the portal that links back:

- where the matching portal must be (the portal you entered, ÷ 8 or × 8)
- an arrow that turns as you turn, and the distance
- whether your last placed obsidian is within 4 blocks of that spot (height ignored)
- when a lit portal is close enough to link

## Movement

How you're moving right now.

- An **icon** and badge for the mode: On foot, Elytra, Swimming, Riding, Flying or Falling.
- **Speed** in blocks per second and km/h, and a compass showing which way you face.
- **Vertical speed** (setting `showVertical`, default on).
- With an elytra: its **durability and flight time left** (setting `showGlider`, default on).

This panel has no ⚙ button; `showVertical` and `showGlider` can be set by rules or [rule set](Rule-Sets.md) profiles.

## Experience

- Your **level** and progress bar.
- **XP per hour**, averaged over a window. Click the window chip (for example **60 s**) to pick 10 s, 30 s, 1 min, 5 min, 10 min or 1 h. Setting `window`, default 60 seconds.
- How much XP you gained in that window.
- Time to the **next level** and to the next multiple of 100 levels, at the current rate.
- **⚙ Level goals**: add up to 8 goal levels (1–10000) to see the time to each. Setting `goals`.

## Performance

A graph of the game's **frames per second**.

- Click the window chip to show the last **10 s**, **30 s**, **1 min** (default) or **10 min**. Setting `window`.
- **Average**: the average frame rate over that window.
- **1% low**: the frame rate that 99% of frames beat. It shows how bad the worst stutters get.
- **Graph peak**: the top of the graph's scale.

Frame time is measured over whole frames, including menus, loading screens and frame-limiter waits.

## Recent pickups

Items that were added to or removed from your inventory, and how: picked up, mined (including mods that put drops straight into your inventory), crafted, traded, taken from or put into a chest, placed, dropped, used, and so on.

- **×** on a row hides that item from the list for good. Hidden items are listed in ⚙, where you can bring them back.
- **⚙ settings:**

| Setting | Control | Values | Default |
|---|---|---|---|
| `lifetime` | Keep for | 10 s, 30 s, 1 min, 5 min, Until replaced (any 0–3600 s in rules) | 30 |
| `maxRows` | Rows | 1–32 | 8 |
| `showSource` | Show where items came from | on / off | on |
| `ignored` | × on a row | up to 64 item ids | none |

## Advancements

Your progress through every advancement tab.

- **Tabs** show progress per tab, with a total. **×** on a tab hides it; hidden tabs are listed in ⚙, where you can bring them back.
- **Show**: *Closest to done* (default; the ones with the fewest criteria left first), *Not done yet* or *Done*. **Search** by title or description.
- Each entry lists the criteria still missing. Hidden advancements show as **???** until you earn them.
- **📌** pins an advancement to the top of the list.
- **⚙ Pop up when you make one for N seconds** (0 = never). New advancements pop up over the dashboard.

| Setting | Values | Default |
|---|---|---|
| `popupSeconds` | 0–300 | 10 |
| `hiddenTabs` | up to 64 tab ids | none |
| `pinned` | up to 64 advancement ids | none |

## Villager trades

Every villager you've traded with, with its profession, level, name and trades. The list is sorted nearest first.

- **Search** matches professions, names and trade items, for example `mending`, `emerald` or `librarian`.
- Trades that are used up say **Out of stock**.
- **Navigate** shows directions to that villager: distance and an arrow that turns as you turn, plus an up or down arrow when it's more than 5 blocks above or below you. Close the directions with ×.
- **×** on a villager forgets it.

Villagers are remembered per world or server, so they're still listed next time you play.

## 3D render

Your player in 3D, using your own skin, wearing your armour (without the enchantment glint) and holding what you hold.

- **Drag** to turn it, **scroll** to zoom, **double-click** to reset.
- **⚙ settings:**

| Setting | Control | Values | Default |
|---|---|---|---|
| `spin` | Spin automatically | on / off | on |
| `axis` | Around | `y` turntable, `x` head over heels, `z` cartwheel | `y` |
| `speed` | Speed | 15, 30, 60 or 120 degrees per second | 30 |

After you drag it while spinning is on, it waits a moment, then eases back upright and starts spinning again. If your system asks for reduced motion, it doesn't spin or bob.

## AFK

How long you've been away, over a slow crawl of your statistics.

- **AFK for**: time since you last moved more than ¼ block, turned, or moved the mouse cursor in game.
- The badge says **Active** for the first 10 seconds, then **AFK**.
- Below it, random statistics with non-zero values drift slowly down the panel. With reduced motion, they stand still and change every few seconds.

The panel is off by default. A good way to use it is the **AFK screen** template, which shows it nearly full screen after two minutes AFK (see [Templates](Rule-Sets.md#templates)).

## JourneyMap

Embeds JourneyMap's web map. Needs JourneyMap and its Webmap addon: see [Integrations](Integrations.md#journeymap). Off by default.

- **⚙ Map address** sets where the web map is. Default `http://127.0.0.1:8080/`. Only `http://127.0.0.1` or `http://localhost` addresses are allowed. Setting `url`.
- **↗** opens the map in its own tab.
- While the map isn't reachable, the panel says so and keeps retrying.

## Build progress

Progress on the schematic placement selected in Litematica: blocks placed out of the total, how many are wrong, blocks to clear, and a material list. Needs Litematica: see [Integrations](Integrations.md#litematica-build-progress). Off by default.
