# MinePanel

**Using MinePanel? See the [wiki](https://github.com/Craftyplayz/MinePanel/wiki)** for every panel, setting and rule. This README covers building and releasing. The wiki is published automatically from [`docs/wiki/`](docs/wiki/Home.md); edit it there.

MinePanel is a client-side Fabric companion dashboard targeting Minecraft Java Edition 26.1.2. It includes a bundled offline dashboard, lifecycle-managed loopback service, player position/health/session telemetry, read-only inventory/equipment, vanilla statistics counters, and bounded session event history over authenticated WebSocket updates. Minecraft compilation and runtime compatibility are still **unverified**, not release-ready claims.

## Requirements and build

MinePanel builds with Java 25, Fabric Loader 0.19.3, Fabric API 0.154.0+26.1.2, Loom 1.18-SNAPSHOT, and Gradle 9.7.1, and requires at least that Loader and Fabric API at runtime. Build and test the release with:

```sh
./gradlew releaseBuild
```

Windows:

```bat
gradlew.bat releaseBuild
```

The configured release artifact is `build/release/minepanel-0.1.jar`. This is an expected output, not a claim that it has been generated here. Node.js is also required for frontend syntax and regression checks. Static assets are copied by Gradle into the JAR; there is no framework, transpilation step, or CDN. The build requires access to the configured Gradle/Fabric repositories the first time.

## Testing locally

- `./gradlew runClient` starts a development Minecraft client with MinePanel loaded, without copying anything anywhere.
- `./gradlew installMod` builds the JAR (without running tests) and copies it into a real instance's `mods` folder, first deleting any other `minepanel-*.jar` there. Set the folder once in `~/.gradle/gradle.properties`, for example `minepanelModsDir=D:/Minecraft/Instances/26.1.2/minecraft/mods`, or pass `-PminepanelModsDir=...` or set `MINEPANEL_MODS_DIR`. Close Minecraft first; Windows locks loaded JARs.
- To run `installMod` automatically after every commit, enable the repo's hook once with `git config core.hooksPath .githooks`. It builds in the background as version `<mod_version>-<commit>` (for example `minepanel-0.1-4144bfd.jar`) and writes the result to `build/install-mod.log`. If the log ends in `FAILED`, Minecraft was probably running; close it and run `./gradlew installMod`.
- `scripts/download-latest-release.ps1 -ModsDir <mods folder>` downloads the newest GitHub release JAR into a mods folder and removes older MinePanel JARs. It does nothing if that version is already there. `-ModsDir` defaults to `MINEPANEL_MODS_DIR`.

## GitHub Releases

The [build workflow](.github/workflows/build.yml) runs on Ubuntu 24.04 with Java 25 and Node 22 and runs `./gradlew releaseBuild` (which includes `check`, service tests and frontend tests). It then checks the JAR's integrity and that the packaged `fabric.mod.json` has the expected id and version.

**Every push to `main` publishes a release.** The version counts up by one per push: `v0.1`, `v0.2`, … `v0.9`, `v0.10`, `v0.11` and so on. The workflow finds the highest existing `v0.N` tag, adds one, builds with `-Pmod_version=0.N`, and creates the release and its tag on the pushed commit. Nothing is tagged or edited by hand; `mod_version` in `gradle.properties` is only used for local builds.

- One push is one release, however many commits it contains.
- Pushes to other branches and pull requests only build; the JAR (`MinePanel-v<mod_version>-<sha>.jar`) is kept as a workflow artifact for 30 days.
- Release runs queue instead of cancelling each other, so two quick pushes can't take the same number. GitHub keeps only one queued run per group, so a third push while one is queued replaces the queued one.
- Re-running the workflow for a commit that already has a version tag rebuilds it without publishing again. An existing release with the same tag is never overwritten.
- The release stays a draft until the JAR has uploaded; a failed upload may leave a draft to remove by hand.
- Only the release job has `contents: write`; the build job has read-only repository access. `build-diagnostics` keeps Gradle reports and test results when a build fails.

Download the compiled `MinePanel-v<version>.jar` under **Assets** on the [GitHub Releases page](https://github.com/Craftyplayz/MinePanel/releases), not GitHub's automatically generated source archives. Release notes include generated change notes, the build commit, SHA-256, and Minecraft/Fabric/Java requirements read from the packaged `fabric.mod.json`. Install the JAR in the appropriate Fabric client's `mods` directory.

**Verification status:** automatic publication, release notes generation, hosted-runner dependency access, and the actual packaged JAR have not yet been verified by a successful workflow run. Local full builds have been blocked by DNS/firewall access to `maven.fabricmc.net` (see [testing](docs/TESTING.md)); a successful agent run is not a successful mod release. The existing Loom SNAPSHOT and wrapper versions remain unchanged: byte-for-byte reproducibility across changing upstream SNAPSHOT dependencies is not guaranteed. This workflow does not run Minecraft or certify in-game compatibility.

## Run

Once a real release JAR has been built, install it in a Fabric 26.1.2 instance's `mods` directory and start the client. MinePanel serves the dashboard at **http://127.0.0.1:57262/** (loopback only; if that port is busy it falls back to a random port) and posts a clickable link in chat whenever you join a world. Open it on the same PC.

The inventory tile shows the hotbar, 27 main slots, armour and offhand with icons rendered by the game itself, so resource packs, block models and tinted items look exactly as they do in game. Icons are shown without the enchantment glint. Hovering an item shows its full in-game tooltip (with advanced F3+H details: ID, durability and component count). No dashboard action can change inventory.

Statistics are grouped into Movement, Combat and General counters, with server/world cumulative totals and changes since each counter's first synchronized observation. Absent vanilla packet values display **Unavailable**, never fabricated zero. Requests use vanilla's statistics action on join and every three seconds; restrictive servers may not respond.

The activity log records blocks mined and placed, containers opened and the net inventory change while they were open, items dropped, damage taken (with its source), healing back to full health, deaths with the death message, respawns, mobs killed (by exact entity type, including ranged/indirect kills reconciled from kill statistics), advancements, dimension changes and session joins/disconnects. Repeated actions within five seconds are merged (e.g. "Mined 12 × Stone"). The dashboard keeps the newest 500 events; every event is also appended to `minepanel/history/<session start>.jsonl` in the game directory as a complete log.

The player tile shows health with a gold saturation bar above it, food, and active status effects with their icon, level and a countdown; effects kept up by a beacon (or conduit) are marked. The inventory tile can show or hide armour and, when made small, shows only whole rows that fit (hotbar first) instead of scrolling or clipping. The statistics tile shows the statistics you pick (⚙) plus a **Recent** section of any other statistic that changed recently, such as blocks mined while mining. Like Recent pickups, Recent can keep changes for 10 seconds to 5 minutes (default 1 minute) or until newer changes replace them, with a chosen number of rows; statistics can be excluded from Recent. The JourneyMap tile embeds JourneyMap's web map (default `http://127.0.0.1:8080/`, changeable with ⚙) and retries while it is not running.

The log also notes biome changes (once you have spent 5 seconds in the new biome), weather changes and each new day. After going through a Nether portal, **Link portal** appears in the Activity log: it shows where the matching portal must be built (the portal you entered, ÷ 8 or × 8), an arrow that turns as you turn, whether your last obsidian is within 4 blocks of that spot (height ignored), and when a lit portal is close enough to link.

More tiles: **3D render** (your player drawn in 3D from your own skin, wearing your armor (without the enchantment glint) and holding what you hold; drag to turn it, scroll to zoom and double-click to reset. With **Spin automatically** (⚙) it turns about the vertical, head over heels or cartwheeling at a chosen speed, and after a drag it waits a moment, then eases back upright and back to spinning), **Movement** (an icon for how you are moving, 3D speed in blocks/s and km/h, facing, elytra durability and flight time left), **Experience** (XP/h averaged over 10 s to 1 h, chosen by clicking the window, and the time to the next level, the next multiple of 100 levels and any goal levels you add with ⚙), **Performance** (a smooth graph of the client's frames per second over the last 10 s, 30 s, 1 min or 10 min, chosen by clicking the window, with the average and 1% low frame rate for that window; the 1% low is the rate 99% of frames beat, so it shows how bad stutters get), **Recent pickups** (items added to or removed from your inventory and how: picked up, mined (including mods that put drops straight into your inventory), crafted, traded, taken from or put in a chest, placed, dropped, used, …), **Advancements** (progress per tab, closest-to-done first with the criteria still missing; hidden ones show as ???, and new ones pop up for a configurable time) and **Villager trades** (searchable trades of villagers you have traded with, with directions to them including an up/down arrow when they are more than 5 blocks above or below). Clicking a shulker box or bundle in the inventory opens a window with its contents over the dashboard; windows can be pinned. Your ender chest's contents are shown once you have opened it. Clicking your player head opens a menu of websites about your account (name history, servers recently played on, skin renders, Hypixel and other server stats, raw profile data and web searches), grouped by kind and with a line on what each one shows; sites with several pages, such as the Mojang API, ask which one you want. Nothing is sent to these sites until you click a link. Villagers and the ender chest are remembered per server/world in `config/minepanel/worlds/`.

**Customize** also manages profiles (complete layouts) and **Rules**: a rule's conditions (server/world, dimension, biome, time of day, game mode, health, hunger, saturation, status effects, movement, wearing elytra, an advancement in the last N seconds, combat) combine as AND groups of OR choices, and an active rule can switch profile, show or hide tiles and change tile settings. A tile set to *Rules only* keeps its place and appears only when a rule shows it, so nothing else moves.

Tiles can be rearranged, resized on a 12-column grid, and shown or hidden with **Customize**. The layout is saved to `config/minepanel/layout.json` and can be exported or imported as JSON. Each tile compacts itself as it shrinks, hiding lower-priority details first (for example the inventory falls back to the hotbar only). The **Build progress** and JourneyMap tiles are hidden by default.

**Build progress** (needs Litematica 0.27.14+ and MaLiLib 0.28.12+, both optional) follows the placement selected in Litematica: blocks placed / total blocks with a bar, how many are wrong, how many chunks have not been checked yet (they must be loaded once) and a separate "N to clear" count of blocks standing where the schematic has air. Its material list shows, per item, how many are *Left* to place, how many you *Have* (inventory and offhand, including shulker box and bundle contents) and how many you *Still need*. Carried items never count as placed. Progress is remembered for the last four placements while you stay in the world. This integration compiles against Litematica 0.27.14 but has **not yet been tested in game**.

Pure Java service/protocol tests and browser-state tests are distinct from Minecraft verification. Full game compilation and in-game compatibility remain unverified in this environment; see [testing](docs/TESTING.md) for exact commands and build blockers.

JourneyMap plus its separate Webmap addon and Litematica/MaLiLib are optional; neither integration has been verified in game yet. Current compatibility and known limitations are documented in [installation](docs/INSTALLATION.md), [architecture](docs/ARCHITECTURE.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## Privacy

The services bind to loopback only. MinePanel has no cloud service, analytics telemetry, external API calls or chat archive. Live game data is sent only to the local browser while the client is running. The activity log is written to `minepanel/history/` in the game directory on this PC; delete those files to remove it.
