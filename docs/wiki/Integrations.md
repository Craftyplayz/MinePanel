# Integrations

[Home](Home.md) › Integrations

MinePanel works on its own. Two panels use other client mods. If a mod is missing, its panel says so and everything else carries on as normal.

> Both integrations are new and haven't been fully tested in game yet. If something looks wrong, see [Troubleshooting](Troubleshooting.md).

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

- **Litematica** 0.27.14 or newer and **MaLiLib** 0.28.12 or newer.

### Setting it up

1. Turn the panel on: **M** → **Tiles** → **Build progress**.
2. In Litematica, load a schematic and **select its placement** (and keep the placement enabled). The panel follows whichever placement is selected.

### What it shows

- **Blocks placed / total blocks**, with a progress bar. A block only counts as placed if it matches the schematic exactly. Wrong blocks and wrong states don't count.
- **N wrong**: blocks that are there but don't match.
- **N chunks not checked yet**: parts of the schematic MinePanel hasn't been able to check. A chunk is checked once it and every chunk around it are loaded at the same time, so walk near it once. Unchecked blocks count as not placed.
- **N to clear**: blocks standing where the schematic has air (leftover terrain, scaffolding, torches). They don't affect the progress bar.
- **Material list**: for each item, how many are **Left** to place, how many you **Have**, and how many you **Still need**. *Have* counts your inventory and offhand, **including the contents of shulker boxes and bundles**. Covered rows get a ✓ and move to the bottom.

Things to know:

- Items you carry never count as placed. Only the world counts.
- Checked chunks keep their results when you walk away.
- Progress is remembered for the last four placements while you stay in the world, and starts over when you leave. Moving, rotating or mirroring a placement starts it over too.
- MinePanel follows Litematica's own options for ignoring crop age, existing fluids and ignored blocks, so its counts should agree with Litematica's verifier.
- When the panel is small it shows only the name, numbers and bar.

### Messages

| Message | Meaning |
|---|---|
| *Install Litematica…* | Litematica isn't installed |
| *This Litematica version is not supported* | Your Litematica is too old. Update it |
| *No placement selected in Litematica* | Select a placement in Litematica's placement list, and make sure it's enabled |
| *Build progress stopped after an error* | Litematica didn't behave as expected (perhaps a newer version changed something). The panel stays off until you restart the game. Your game isn't affected |
