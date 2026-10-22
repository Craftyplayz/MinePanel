# Installation

## Requirements

- Minecraft Java Edition with the MinePanel JAR for its loader and version: Fabric 26.1.2 (Java 25), Fabric 1.21.1 or NeoForge 1.21.1 (Java 21).
- Fabric: Loader 0.19.3 or newer and the Fabric API listed in the JAR's `fabric.mod.json` (0.154.0 for 26.1.2, 0.116.17 for 1.21.1). NeoForge: 21.1.221 or newer.
- JourneyMap plus its separate Webmap addon are optional. Litematica and MaLiLib are optional (26.1.2: 0.27.14 / 0.28.12 or newer; Fabric 1.21.1: 0.19.61 / 0.21.10 or newer; NeoForge: Forgematica / MaFgLib 0.4.3 or newer). Sophisticated Backpacks 3.25.34 or newer is optional on NeoForge. MinePanel never bundles any of them.

Optional-mod compatibility has not yet been verified in game, and neither 1.21.1 build has been run in game at all. The Webmap addon is separate from JourneyMap 6.0 onward.

## Build and install

From the repository root with Node.js available, run `./gradlew releaseBuild` on Linux/macOS or `gradlew.bat releaseBuild` on Windows (Gradle downloads Java 21 and 25 if they aren't installed). It produces `build/release/minepanel-<loader>-<mod_version>+<minecraft>.jar` for each loader and Minecraft version; copy the one matching the instance into its `mods` directory.

Start the client and open the local dashboard URL reported by MinePanel. The URL uses loopback only. Open the URL on the same PC, then move the browser window to the second monitor. Do not change the service to listen on a network interface.

## JourneyMap Webmap

Install the matching JourneyMap and separate Webmap client mods. Enable/configure Webmap in JourneyMap's own settings and use its actual displayed/configured local endpoint. MinePanel must not assume a port. Direct browser opening is the fallback if iframe embedding is blocked.

## Litematica build progress

Install Litematica and MaLiLib for your Minecraft version (MinePanel was compiled against Litematica 0.27.14 / MaLiLib 0.28.12 for 26.1.2 and 0.19.61 / 0.21.10 for 1.21.1, the minimum it accepts; `fabric.mod.json` lists Litematica under `suggests`). Enable the **Build progress** tile with **Customize**, then load a schematic and select its placement in Litematica. Without Litematica, or with an older version, the tile says so and everything else works as usual. This integration has not yet been tested in game.
