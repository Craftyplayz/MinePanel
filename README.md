# MinePanel

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

The configured release artifact is `build/release/minepanel-0.1.0.jar`. This is an expected output, not a claim that it has been generated here. Node.js is also required for frontend syntax and regression checks. Static assets are copied by Gradle into the JAR; there is no framework, transpilation step, or CDN. The build requires access to the configured Gradle/Fabric repositories the first time.

## GitHub Releases

The [release workflow](.github/workflows/release.yml) runs on Ubuntu 24.04 with Java 25 and Node 22. It checks out the exact version tag and records its commit SHA. Existing Gradle tasks run in diagnostic stages:

```sh
./gradlew --no-daemon --stacktrace --console=plain classes clientClasses testClasses
./gradlew --no-daemon --stacktrace --console=plain check
./gradlew --no-daemon --stacktrace --console=plain releaseBuild
```

`releaseBuild` already depends on `build`, including `check`, service tests and frontend tests, and validates/copies the production `jar`. Dashboard files are packaged directly from client resources, with no separate frontend build. The workflow additionally checks JAR integrity, nonempty metadata/assets/classes, mod identity and version before copying `build/release/minepanel-<mod_version>.jar` unchanged to `build/verified-release/MinePanel-v<mod_version>.jar`.

To publish, first merge the workflow into the default branch, set `mod_version` in `gradle.properties` to the release version, and commit all release changes. Tag that commit (not an uncommitted working tree), then push the tag:

```sh
git tag -a v0.1.0 -m "MinePanel 0.1.0"
git push origin v0.1.0
```

Use `vMAJOR.MINOR.PATCH`, or an explicit prerelease such as `v0.1.0-beta.1` with `mod_version=0.1.0-beta.1`. The workflow rejects tags that do not match the packaged version. Tags with a prerelease suffix create prereleases. Do not move published tags. Existing releases, including drafts, are rejected rather than overwritten. Upload happens while the release is draft; a publication failure may leave a draft for a maintainer to inspect and remove before retrying.

Open **Actions → Build and release MinePanel** to inspect runs. **Run workflow** accepts an existing version tag for troubleshooting and builds/uploads it without publishing any release. Logs identify compilation/dependency resolution, tests, and packaging; `build-diagnostics` preserves available Gradle logs, test results and reports even on failure. Dependency/DNS errors fail the build normally; no placeholder JAR or bypassed tests are used. Only a successful build and artifact validation enable the tag-only publication job, which uses `GITHUB_TOKEN` with `contents: write`; the build job has read-only repository access.

Download the compiled `MinePanel-v<version>.jar` under **Assets** on the [GitHub Releases page](https://github.com/Craftyplayz/MinePanel/releases), not GitHub's automatically generated source archives. Release notes include generated change notes, the build commit, SHA-256, and Minecraft/Fabric/Java requirements read from the packaged `fabric.mod.json`. Install the JAR in the appropriate Fabric client's `mods` directory.

**Verification status:** automatic publication, release notes generation, hosted-runner dependency access, and the actual packaged JAR have not yet been verified by a successful release workflow run. Local full builds have been blocked by DNS/firewall access to `maven.fabricmc.net` (see [testing](docs/TESTING.md)); a successful agent run is not a successful mod release. The existing Loom SNAPSHOT and wrapper versions remain unchanged: exact tagged source is enforced, but byte-for-byte reproducibility across changing upstream SNAPSHOT dependencies is not guaranteed. This workflow does not run Minecraft or certify in-game compatibility.

## Run

Once a real release JAR has been built, install it in a Fabric 26.1.2 instance's `mods` directory and start the client. MinePanel serves the dashboard at **http://127.0.0.1:57262/** (loopback only; if that port is busy it falls back to a random port) and posts a clickable link in chat whenever you join a world. Open it on the same PC.

The inventory tile shows the hotbar, 27 main slots, armour and offhand with icons rendered by the game itself, so resource packs, block models and tinted items look exactly as they do in game. Enchanted items get an animated glint built from the active pack's glint texture. Hovering an item shows its full in-game tooltip (with advanced F3+H details: ID, durability and component count). No dashboard action can change inventory.

Statistics are grouped into Movement, Combat and General counters, with server/world cumulative totals and changes since each counter's first synchronized observation. Absent vanilla packet values display **Unavailable**, never fabricated zero. Requests use vanilla's statistics action on join and every three seconds; restrictive servers may not respond.

The activity log records blocks mined and placed, containers opened and the net inventory change while they were open, items dropped, damage taken (with its source), healing back to full health, deaths with the death message, respawns, mobs killed (by exact entity type, including ranged/indirect kills reconciled from kill statistics), advancements, dimension changes and session joins/disconnects. Repeated actions within five seconds are merged (e.g. "Mined 12 × Stone"). The dashboard keeps the newest 500 events; every event is also appended to `minepanel/history/<session start>.jsonl` in the game directory as a complete log.

The player tile shows health with a gold saturation bar above it, food, and active status effects with their icon, level and a countdown; effects kept up by a beacon (or conduit) are marked. The inventory tile can show or hide armour and, when made small, shows only whole rows that fit (hotbar first) instead of scrolling or clipping. The statistics tile shows the statistics you pick (⚙) plus a **Recent** section of any other statistic that changed recently, such as blocks mined while mining. Like Recent pickups, Recent can keep changes for 10 seconds to 5 minutes (default 1 minute) or until newer changes replace them, with a chosen number of rows; statistics can be excluded from Recent. The JourneyMap tile embeds JourneyMap's web map (default `http://127.0.0.1:8080/`, changeable with ⚙) and retries while it is not running.

The log also notes biome changes (once you have spent 5 seconds in the new biome), weather changes and each new day. After going through a Nether portal, **Link portal** appears in the Activity log: it shows where the matching portal must be built (the portal you entered, ÷ 8 or × 8), an arrow that turns as you turn, whether your last obsidian is within 4 blocks of that spot (height ignored), and when a lit portal is close enough to link.

More tiles: **Movement** (an icon for how you are moving, 3D speed in blocks/s and km/h, facing, elytra durability and flight time left), **Experience** (XP/h averaged over 10 s to 1 h, chosen by clicking the window, and the time to the next level, the next multiple of 100 levels and any goal levels you add with ⚙), **Recent pickups** (items added to or removed from your inventory and how: picked up, mined (including mods that put drops straight into your inventory), crafted, traded, taken from or put in a chest, placed, dropped, used, …), **Advancements** (progress per tab, closest-to-done first with the criteria still missing; hidden ones show as ???, and new ones pop up for a configurable time) and **Villager trades** (searchable trades of villagers you have traded with, with directions to them including an up/down arrow when they are more than 5 blocks above or below). Clicking a shulker box or bundle in the inventory opens a window with its contents over the dashboard; windows can be pinned. Your ender chest's contents are shown once you have opened it. Villagers and the ender chest are remembered per server/world in `config/minepanel/worlds/`.

**Customize** also manages profiles (complete layouts) and **Rules**: a rule's conditions (server/world, dimension, biome, time of day, game mode, health, hunger, saturation, status effects, movement, wearing elytra, an advancement in the last N seconds, combat) combine as AND groups of OR choices, and an active rule can switch profile, show or hide tiles and change tile settings. A tile set to *Rules only* keeps its place and appears only when a rule shows it, so nothing else moves.

Tiles can be rearranged, resized on a 12-column grid, and shown or hidden with **Customize**. The layout is saved to `config/minepanel/layout.json` and can be exported or imported as JSON. Each tile compacts itself as it shrinks, hiding lower-priority details first (for example the inventory falls back to the hotbar only). The **Build progress** and JourneyMap tiles are hidden by default.

**Build progress** (needs Litematica 0.27.14+ and MaLiLib 0.28.12+, both optional) follows the placement selected in Litematica: blocks placed / total blocks with a bar, how many are wrong, how many chunks have not been checked yet (they must be loaded once) and a separate "N to clear" count of blocks standing where the schematic has air. Its material list shows, per item, how many are *Left* to place, how many you *Have* (inventory and offhand, including shulker box and bundle contents) and how many you *Still need*. Carried items never count as placed. Progress is remembered for the last four placements while you stay in the world. This integration compiles against Litematica 0.27.14 but has **not yet been tested in game**.

Pure Java service/protocol tests and browser-state tests are distinct from Minecraft verification. Full game compilation and in-game compatibility remain unverified in this environment; see [testing](docs/TESTING.md) for exact commands and build blockers.

JourneyMap plus its separate Webmap addon and Litematica/MaLiLib are optional; neither integration has been verified in game yet. Current compatibility and known limitations are documented in [installation](docs/INSTALLATION.md), [architecture](docs/ARCHITECTURE.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## Privacy

The services bind to loopback only. MinePanel has no cloud service, analytics telemetry, external API calls or chat archive. Live game data is sent only to the local browser while the client is running. The activity log is written to `minepanel/history/` in the game directory on this PC; delete those files to remove it.
