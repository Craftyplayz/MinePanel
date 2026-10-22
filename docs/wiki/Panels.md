# Panels

[Home](Home.md) › Panels

Every panel, what it shows and how to configure it. Settings marked **⚙** are changed with the panel's own settings button; all settings can also be changed by a rule's [Set panel setting](Rule-Actions.md#set-panel-setting) action, and are saved per [profile](Customizing.md#profiles) (except Recent pickups, whose settings every profile shares).

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
| [AFK](#afk) | `afk` | no | 3 × 3 | ⚙ |
| [JourneyMap](#journeymap) | `map` | no | 2 × 2 | ⚙ |
| [Build progress](#build-progress) | `build` | no | 2 × 2 | — |
| [Personal backpack](#personal-backpack) | `backpack` | no | 3 × 3 | — |
| [Backpacks](#backpacks) | `backpacks` | no | 4 × 4 | selected backpack |
| [Backpacks 2](#backpacks) | `backpacks2` | no | 4 × 4 | selected backpack |
| [Backpacks 3](#backpacks) | `backpacks3` | no | 4 × 4 | selected backpack |
| [Backpacks 4](#backpacks) | `backpacks4` | no | 4 × 4 | selected backpack |
| [AE2 crafting](#ae2-crafting) | `crafting` | no | 3 × 3 | — |
| [Ender Storage](#ender-storage) | `enderStorage` | no | 4 × 4 | selected chest |
| [Ender Storage 2](#ender-storage) | `enderStorage2` | no | 4 × 4 | selected chest |
| [Ender Storage 3](#ender-storage) | `enderStorage3` | no | 4 × 4 | selected chest |
| [Ender Storage 4](#ender-storage) | `enderStorage4` | no | 4 × 4 | selected chest |

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
- **Hover** an item for its tooltip; **click** a shulker box, bundle, [backpack](Integrations.md#sophisticated-backpacks), [Ender Storage pouch](Integrations.md#ender-storage) or the ender chest to open an [item window](Dashboard.md#item-windows).
- With [Ender Storage](Integrations.md#ender-storage), the ender chest slot shows Ender Storage's chest and opens the Ender Storage chest you opened last.
- When the panel is small it shows only the whole rows that fit, hotbar first, instead of scrolling or cutting rows in half.
- With [Curios](Integrations.md#curios) (NeoForge), items in your extra slots (back, rings, belt and so on) show in a row under the inventory, only while you wear something there. Click a backpack there to open it.

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

The game keeps one list for the whole session, whichever profile is on screen. This panel's settings, hidden items included, are shared by every [profile](Customizing.md#profiles), so a rule that switches profile doesn't change which pickups you see.

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

## Personal backpack

The backpack you're wearing, laid out slot by slot like its screen in game. Only on **Minecraft 1.21.1**: on other versions it isn't in the **Tiles** list.

- It shows the first backpack in your [Curios](Integrations.md#curios) slots, or else a backpack worn in your chest slot. The title bar names it, or says **None worn**.
- Every slot is drawn, empty ones included, 9 to a row (12 for backpacks bigger than 81 slots, as in game). Slots shrink so the whole backpack fits the panel.
- Hover an item for its tooltip.
- Contents come from [Sophisticated Backpacks](Integrations.md#sophisticated-backpacks): about four times a second in singleplayer, and from the last time you opened the backpack on a server. Until then the panel says *Contents not known yet. Open the backpack once in game.*

> New and not tested in game yet.

## Backpacks

Every backpack MinePanel knows of, and the contents of the one you pick. Only on **Minecraft 1.21.1** with [Sophisticated Backpacks](Integrations.md#sophisticated-backpacks): on other versions it isn't in the **Tiles** list, and without the mod it says *Needs Sophisticated Backpacks.*

There are four of these panels: **Backpacks**, **Backpacks 2**, **Backpacks 3** and **Backpacks 4**. They share the same list, but each one picks, searches and folds on its own, so you can watch up to four backpacks side by side. All four are off until you turn them on in the **Tiles** list.

- **Which backpacks are listed:** in singleplayer, every backpack in your world, whoever opened it. On a server, only the backpacks you've opened yourself, as you last saw them; the panel says so under the search box.
- **The list** shows each backpack's name (**Backpack** if it has none), who opened it last and how long ago, and how many of its slots hold something (for example **12/54**). The most recently opened is at the top.
- **Placed storages:** with [Sophisticated Storage](Integrations.md#sophisticated-storage), its chests, barrels and other storage blocks are listed too, after the backpacks. Their row says **Storage** and where the block is, for example **Storage · 120, 64, -340**. You pick and view them like a backpack.
- **Search backpacks, storage or items** narrows the list by name, by who opened it, or by an item inside (its name or id, such as `diamond` or `minecraft:diamond`). Type `storage` to list only placed storages, or part of their coordinates (`64, -340`) to find one.
- **Click a backpack** in the list to show it below. **Last opened** goes back to showing whichever backpack was opened most recently, and stays pressed while it's chosen. The title bar names the backpack shown, or says **None**.
- Once a backpack is shown, the search box and list fold away so the backpack gets the space. Click **☰** in the title bar to bring them back (and again to hide them).
- **Rename:** click **✎** in the title bar to give the shown backpack or storage your own name. Press **Enter** (or click away) to keep it, **Escape** to cancel. Clear the name to get the game's name back. The new name shows in every Backpacks panel's list and title bar, and search finds it as well as the game's name. It only changes the name on the dashboard: the backpack keeps its name in game. Nicknames are saved with your layout, for all profiles. The [Personal backpack](#personal-backpack) panel always shows the game's name.
- The chosen backpack is drawn slot by slot like the [Personal backpack](#personal-backpack) panel, and follows changes about four times a second in singleplayer. Hover an item for its tooltip.
- Just after you pick a backpack, the panel says *Loading…* until the game sends its contents. *Contents not known yet. Open the backpack once in game.* means MinePanel hasn't seen inside it yet. *No backpacks found yet.* means it knows of none.
- Nothing here changes a backpack: you can only look.

| Setting | Id | What it does | Default |
|---|---|---|---|
| Selected backpack | `selected` | `last` shows the backpack opened most recently; a backpack's UUID (lowercase) always shows that backpack | `last` |

Each panel has its own setting. The choice is saved per [profile](Customizing.md#profiles), so a rule can switch to a profile, or use [Set panel setting](Rule-Actions.md#set-panel-setting), to show a particular backpack. At most 7 chosen backpacks (plus the last opened) are read in full at once, across all panels and profiles.

> New and not tested in game yet.

## AE2 crafting

Your [Applied Energistics 2](Integrations.md#applied-energistics-2) autocrafting: the jobs you start and the network's crafting CPUs. Only on **Minecraft 1.21.1**; it shows anything only on NeoForge with AE2 installed (otherwise it says *Needs Applied Energistics 2.*).

- **Your jobs** lists the crafting jobs you start, running ones first, then the most recently ended. Each row shows the item and amount, and:
  - **Crafting**, with how far along it is (when the CPU crafting it is known) and how long it has been running.
  - **Done**, how long ago, and how long it took.
  - **Cancelled**, and how long ago.
- Jobs show from the moment you start them, without any screen open. MinePanel keeps your last 16 jobs until you leave the world. Jobs that were already running when you joined appear when they end.
- **Crafting CPUs** lists every crafting CPU on the network. A busy CPU shows the item, amount, percent done and time running, with a progress bar. An idle one shows **Idle**, its storage in bytes and its co-processors.
- **Selected CPU** shows the CPU picked in AE2's Crafting Status screen: overall percent done (with **paused** if the job is suspended) and, for each item, how many are **crafting**, **scheduled** and **stored**. The busiest items come first, up to 64.
- The CPUs and the selected CPU come from AE2's **Crafting Status** screen. Open it in game (from an ME terminal, also a wireless one) to fill them in. While it's open the title bar says **Live**. After you close it, the panel keeps what it last saw and the title bar says how long ago (**Seen 2m ago**).
- Until you open Crafting Status, the panel says *Open Crafting Status in an ME terminal to see your crafting CPUs here.*
- Nothing here changes your AE2 network: you can only look.

> New and not tested in game yet.

## Ender Storage

Every [Ender Storage](Integrations.md#ender-storage) chest MinePanel knows of, the contents of the one you pick, and a log of what was put in and taken out. Only on **Minecraft 1.21.1**: on other versions it isn't in the **Tiles** list. It shows anything only on NeoForge with Ender Storage installed; otherwise it says *Needs Ender Storage.*

There are four of these panels: **Ender Storage**, **Ender Storage 2**, **Ender Storage 3** and **Ender Storage 4**. They share the same list, but each one picks, searches and folds on its own, so you can watch up to four chests side by side. All four are off until you turn them on in the **Tiles** list.

An Ender Storage chest is one colour code: the three colours on its lid, left to right. Every chest, pouch and tank with the same colours shares the same items. A chest can also be personal (owned by one player).

- **Which chests are listed:** in singleplayer, every Ender Storage chest in your world, whoever uses it. On a server, only the chests you've opened yourself, as you last saw them; the panel says so under the search box.
- **The list** shows each chest's colour code as three coloured squares, then its colours in words (for example **White / Red / Light Blue**), then **public** or **personal** with the owner's name, and when you last saw it change or opened it. On the right, how many of its slots hold something (for example **12/27**). The chests you've seen most recently are at the top.
- **Search colours, owners or items** narrows the list by colour (`light blue` or `light_blue`), by owner, or by an item inside (its name or id, such as `diamond` or `minecraft:diamond`).
- **Click a chest** in the list to show it below. **Last opened** goes back to showing whichever chest you opened most recently, and stays pressed while it's chosen. The title bar shows the chest's colour code and name, or says **None**.
- Once a chest is shown, the search box and list fold away so the chest gets the space. Click **☰** in the title bar to bring them back (and again to hide them).
- **Rename:** click **✎** in the title bar to give the shown chest your own name, the same way as in the [Backpacks](#backpacks) panels. It only changes the name on the dashboard.
- The chosen chest is drawn slot by slot (9, 27 or 54 slots, depending on how the server set up Ender Storage). In singleplayer it follows changes about twice a second; on a server, while you have it open in game. Hover an item for its tooltip.
- **Changes**, under the slots, lists what went in and out, newest first: for example **+12 Cobblestone** or **−3 Diamond**, with how long ago. Items taken out are in red. See [Ender Storage](Integrations.md#ender-storage) for when changes are noticed.
- Just after you pick a chest, the panel says *Loading…* until the game sends its contents. *Contents not known yet. Open the chest once in game.* means MinePanel hasn't seen inside it yet. *No ender chests found yet. Open one in game.* means it knows of none.
- Nothing here changes a chest: you can only look.

| Setting | Id | What it does | Default |
|---|---|---|---|
| Selected chest | `selected` | `last` shows the chest opened most recently; a colour code shows that chest | `last` |

A colour code is the three colours in lowercase, left to right, joined with dots, such as `white.red.light_blue`. Colours are `white`, `orange`, `magenta`, `light_blue`, `yellow`, `lime`, `pink`, `gray`, `light_gray`, `cyan`, `purple`, `blue`, `brown`, `green`, `red` and `black`. A personal chest adds a dot and the owner's UUID in lowercase: `white.red.light_blue.8667ba71-b85a-4004-af54-457a9734eed7`.

Each panel has its own setting. The choice is saved per [profile](Customizing.md#profiles), so a rule can switch to a profile, or use [Set panel setting](Rule-Actions.md#set-panel-setting), to show a particular chest. At most 7 chosen chests (plus the last opened) are watched at once, across all panels and profiles.

> New and not tested in game yet.

## AFK

How long you've been away, over a slow crawl of your statistics.

- **AFK for**: time since you last moved more than ¼ block, turned, or moved the mouse cursor in game.
- The badge says **Active** for the first 10 seconds, then **AFK**.
- Below it, random statistics with non-zero values drift slowly down the panel. Each one sits on its own small card, with a dotted line joining its name to its number. With reduced motion, they stand still and change every few seconds.
- Scroll the list up or down with the mouse wheel, or drag it. It glides to a stop, stays still for about 3 seconds after you stop scrolling (or let go), then speeds back up over 2 seconds.
- Hover over a statistic and click **×** to stop showing it. The statistic is added to the **Hidden** list in the settings.
- **⚙ settings:**

| Setting | Control | Values | Default |
|---|---|---|---|
| `fontSize` | Text size | 11, 13, 16, 20, 24 or 32 px | 13 |
| `speed` | Speed | **Slow**, **Normal**, **Fast** or **Very fast** (`10`, `20`, `40`, `80`) | **Normal** (`20`) |
| `hidden` | Hidden | statistics the panel never shows; click one to show it again | none |

If you hide every statistic you have, the panel says *Every statistic is hidden.*

The panel is off by default. A good way to use it is the **AFK screen** template, which shows it nearly full screen after two minutes AFK (see [Templates](Rule-Sets.md#templates)).

## JourneyMap

Embeds JourneyMap's web map. Needs JourneyMap and its Webmap addon: see [Integrations](Integrations.md#journeymap). Off by default.

- **⚙ Map address** sets where the web map is. Default `http://127.0.0.1:8080/`. Only `http://127.0.0.1` or `http://localhost` addresses are allowed. Setting `url`.
- **↗** opens the map in its own tab.
- While the map isn't reachable, the panel says so and keeps retrying.

## Build progress

Progress on the schematic placement selected in Litematica: blocks placed out of the total, how many are wrong, blocks to clear, and a material list. Needs Litematica: see [Integrations](Integrations.md#litematica-build-progress). Off by default.
