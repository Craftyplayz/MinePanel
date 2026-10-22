# Integrations

[Home](Home.md) › Integrations

MinePanel works on its own. A few panels, and backpack contents in item windows, use other mods. If a mod is missing, its panel says so and everything else carries on as normal.

> These integrations are new and haven't been fully tested in game yet. If something looks wrong, see [Troubleshooting](Troubleshooting.md).

## JourneyMap

The **JourneyMap** panel embeds JourneyMap's web map, so you can see the map on your second screen. MinePanel doesn't draw a map itself.

### What you need

- **JourneyMap** and its separate **Webmap** addon (Webmap is its own download from JourneyMap 6.0 onward).
- Webmap enabled in JourneyMap's settings.

### Setting it up

1. Turn the panel on: **M** → **Tiles** → **JourneyMap**.
2. If Webmap isn't at the default address `http://127.0.0.1:8080/`, click **⚙** on the panel and enter the address Webmap shows in chat or its settings. Click **Save**.
3. The panel shows the map. While it can't reach it, it says so and keeps retrying.

Only local addresses (`http://127.0.0.1…` or `http://localhost…`) are accepted.

**↗** opens the map in its own browser tab, which also works if the map refuses to be shown inside the dashboard.

### Good rules for the map

- **Elytra map** [template](Rule-Sets.md#templates): focuses the map nearly full screen while you glide.
- Make a "Nether" [profile](Customizing.md#profiles) with a big map and a rule that switches to it in the Nether.

## Litematica build progress

The **Build progress** panel shows how far along you are with a Litematica schematic.

### What you need

- **Litematica** 0.27.14 or newer and **MaLiLib** 0.28.12 or newer on Minecraft 26.1.2.
- **Litematica** 0.19.61 or newer and **MaLiLib** 0.21.10 or newer on Fabric 1.21.1.
- **Forgematica** 0.4.3 or newer and **MaFgLib** 0.4.3 or newer on NeoForge 1.21.1 (the NeoForge versions of Litematica and MaLiLib).

### Setting it up

1. Turn the panel on: **M** → **Tiles** → **Build progress**.
2. In Litematica, load a schematic and **select its placement** (and keep the placement enabled). The panel follows whichever placement is selected.

### What it shows

- **Blocks placed / total blocks**, with a progress bar. A block only counts as placed if it matches the schematic exactly. Wrong blocks and wrong states don't count.
- **N wrong**: blocks that are there but don't match.
- **N chunks not checked yet**: parts of the schematic MinePanel hasn't been able to check. A chunk is checked once it and every chunk around it are loaded at the same time, so walk near it once. Unchecked blocks count as not placed.
- **N to clear**: blocks standing where the schematic has air (leftover terrain, scaffolding, torches). They don't affect the progress bar.
- **Material list**: for each item, how many are **Left** to place, how many you **Have**, and how many you **Still need**. *Have* counts your inventory and offhand, **including the contents of shulker boxes, bundles and [backpacks](#sophisticated-backpacks)** (backpacks only once MinePanel knows what they hold). Covered rows get a ✓ and move to the bottom.

Things to know:

- Items you carry never count as placed. Only the world counts.
- Checked chunks keep their results when you walk away.
- Progress is remembered for the last four placements while you stay in the world, and starts over when you leave. Moving, rotating or mirroring a placement starts it over too.
- MinePanel follows Litematica's own options for ignoring crop age, existing fluids and ignored blocks, so its counts should agree with Litematica's verifier. Litematica for 1.21.1 has no crop-age option, so there a crop at the wrong age always counts as wrong.
- When the panel is small it shows only the name, numbers and bar.

### Messages

| Message | Meaning |
|---|---|
| *Install Litematica…* | Litematica isn't installed |
| *This Litematica version is not supported* | Your Litematica is too old. Update it |
| *No placement selected in Litematica* | Select a placement in Litematica's placement list, and make sure it's enabled |
| *Build progress stopped after an error* | Litematica didn't behave as expected (perhaps a newer version changed something). The panel stays off until you restart the game. Your game isn't affected |

## Curios

With **Curios** installed (MinePanel for NeoForge), the items in your extra Curios slots (back, rings, necklace, belt and so on) show in a row under the [Inventory panel](Panels.md#inventory). Hover one for its tooltip; click a backpack among them to open its [item window](Dashboard.md#item-windows), the same as a backpack in your inventory. Their items also count as *Have* in [Build progress](#litematica-build-progress).

- The row appears only while you wear something in a Curios slot, and shows as many items as fit on one row (up to 32).
- Curios already tells your game what you wear, so this works the same in singleplayer and on servers.

> New and not tested in game yet.

## Sophisticated Backpacks

With **Sophisticated Backpacks** installed, a backpack in your inventory or worn in a [Curios](#curios) slot opens an [item window](Dashboard.md#item-windows) with what's inside, like a shulker box does, and its contents count as *Have* in [Build progress](#litematica-build-progress). Two panels use it too:

- [Personal backpack](Panels.md#personal-backpack) draws the backpack you wear, slot by slot.
- [Backpacks](Panels.md#backpacks) lists the backpacks MinePanel knows of, lets you search them by name or by an item inside, and draws the one you pick.

> New and not tested in game yet.

### What you need

- MinePanel for **NeoForge** on Minecraft 1.21.1, and **Sophisticated Backpacks** 3.25.34 or newer. Older versions are ignored and backpacks show as plain items.

### Where the contents come from

A backpack keeps its items on the server, so the game doesn't tell MinePanel what's inside on its own.

- **Singleplayer:** MinePanel reads the contents straight from your world while you carry or wear the backpack, so an open window follows what you put in and take out. The backpack you wear and the one the Backpacks panel shows are read about four times a second. The Backpacks panel lists **every backpack in the world**, whoever opened it, and refreshes that list about every 5 seconds. Nothing is changed.
- **On a server:** MinePanel remembers what a backpack held **the last time you opened it**. Until you open it once, its window says *Contents not known yet. Open the backpack once in game.* What you saw is kept per server, so it's still there next time you join. The Backpacks panel lists **only the backpacks you've opened**, as you last saw them.

Things to know:

- A window shows every slot of the backpack in order, empty ones included (up to 128 slots). The [Personal backpack](Panels.md#personal-backpack) and [Backpacks](Panels.md#backpacks) panels draw backpacks the same way.
- The Backpacks panel lists up to 256 backpacks, most recently opened first.
- A backpack inside a backpack shows as an item, without its own contents.
- MinePanel never sends anything to the server and never changes a backpack. If the backpack mod behaves unexpectedly, MinePanel stops showing backpack contents until you restart the game. Your game isn't affected.
