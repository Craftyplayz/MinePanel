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
- [Backpacks](Panels.md#backpacks) (and **Backpacks 2** to **4**) lists the backpacks MinePanel knows of, lets you search them by name or by an item inside, and draws the one you pick.

> New and not tested in game yet.

### What you need

- MinePanel for **NeoForge** on Minecraft 1.21.1, and **Sophisticated Backpacks** 3.25.34 or newer. Older versions are ignored and backpacks show as plain items.

### Where the contents come from

A backpack keeps its items on the server, so the game doesn't tell MinePanel what's inside on its own.

- **Singleplayer:** MinePanel reads the contents straight from your world while you carry or wear the backpack, so an open window follows what you put in and take out. The backpack you wear and the ones the Backpacks panels show are read about four times a second. The Backpacks panels list **every backpack in the world**, whoever opened it, and refresh that list about every 5 seconds. Nothing is changed.
- **On a server:** MinePanel remembers what a backpack held **the last time you opened it**. Until you open it once, its window says *Contents not known yet. Open the backpack once in game.* What you saw is kept per server, so it's still there next time you join. The Backpacks panels list **only the backpacks you've opened**, as you last saw them.

Things to know:

- A window shows every slot of the backpack in order, empty ones included (up to 128 slots). The [Personal backpack](Panels.md#personal-backpack) and [Backpacks](Panels.md#backpacks) panels draw backpacks the same way.
- The Backpacks panels list up to 256 backpacks and storages in all, most recently opened first.
- A backpack inside a backpack shows as an item, without its own contents.
- MinePanel never sends anything to the server and never changes a backpack. If the backpack mod behaves unexpectedly, MinePanel stops showing backpack contents until you restart the game. Your game isn't affected.

## Sophisticated Storage

With **Sophisticated Storage** installed too, its placed storage blocks (chests, barrels, shulker boxes and so on) show in the [Backpacks](Panels.md#backpacks) panels' list after the backpacks. Each row says **Storage** and the block's coordinates. Pick one to see its contents slot by slot, like a backpack.

> New and not tested in game yet.

- **Singleplayer only**, and only storages in **loaded chunks** (near you). Storages elsewhere aren't listed until their chunks are loaded.
- A storage shows its custom name if you gave it one, else the block's name. You can also [rename it on the dashboard](Panels.md#backpacks).
- MinePanel only reads the storage. It never changes it.

## Ender Storage

With **Ender Storage** installed, MinePanel shows its ender chests (one for each colour code):

- The [Ender Storage](Panels.md#ender-storage) panels (and **Ender Storage 2** to **4**) list the chests MinePanel knows of, with their colour codes. You can search them by colour, owner or item, and see the one you pick slot by slot with a log of its changes.
- The ender chest slot beside the [Inventory panel](Panels.md#inventory) shows Ender Storage's chest. Clicking it opens the Ender Storage chest you opened last in an [item window](Dashboard.md#item-windows).
- An **Ender Pouch** (or an Ender Storage chest item) in your inventory opens an item window with the contents of its colour code's chest.

> New and not tested in game yet.

### What you need

- MinePanel for **NeoForge** on Minecraft 1.21.1, and **Ender Storage** (with CodeChickenLib). It was built against Ender Storage 2.13.0.191. If another version doesn't fit, MinePanel stops showing Ender Storage chests and the rest carries on.
- **Ender tanks** (fluids) aren't shown.

### Where the contents come from

An Ender Storage chest keeps its items on the server, so the game only tells MinePanel what's inside while the chest is open.

- **Singleplayer:** MinePanel reads every Ender Storage chest straight from your world about twice a second, so the panels are live and list **every chest in the world**, whoever uses it. Nothing is changed.
- **On a server:** MinePanel sees a chest while you have it open (placed chest or pouch), and remembers what it held **the last time you opened it**. Until you open it once, it says *Contents not known yet. Open the chest once in game.* The panels list **only the chests you've opened**.

### The change log

Each time MinePanel sees a chest's contents change, it adds a line to that chest's **Changes** log for every kind of item that went up or down, for example **+12 Cobblestone** or **−3 Diamond**. Moving items around inside the chest doesn't count.

- **Singleplayer:** changes are noticed about twice a second, whoever makes them.
- **On a server:** changes are noticed while you have the chest open. If other players changed it while you were away, the difference is logged when you next open it, at that time.
- The last **500** changes of each chest are kept, saved per world or server, so they're still there next time you play. MinePanel remembers up to 64 chests per world; the one that changed longest ago is forgotten first.
- A chest MinePanel has only seen once has no changes yet.

## Applied Energistics 2

With **Applied Energistics 2** (AE2) installed, the [AE2 crafting](Panels.md#ae2-crafting) panel shows your autocrafting jobs and the network's crafting CPUs.

> New and not tested in game yet.

### What you need

- MinePanel for **NeoForge** on Minecraft 1.21.1, and AE2. It was built against AE2 19.2.17 (the version in All the Mods 10). If another AE2 version doesn't fit, the panel stays empty and the rest of MinePanel carries on.
- AE2 addons such as ExtendedAE, AdvancedAE and MEGA Cells don't need anything extra.

### Where the data comes from

AE2 runs crafting on the server and tells your game only a little, so MinePanel shows only that:

- **Your jobs:** AE2 tells you when a job you started begins, finishes or is cancelled. MinePanel lists these as they happen, in singleplayer and on servers. It doesn't see jobs started by other players.
- **Crafting CPUs:** AE2 sends the CPU list and the selected CPU's items only while its **Crafting Status** screen is open. MinePanel shows them live while it's open, and as last seen after you close it.
- Jobs are kept in memory only, not saved. MinePanel never sends anything to the server and never changes your network.
