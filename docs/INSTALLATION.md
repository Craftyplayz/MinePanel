# Installation

## Requirements

- Minecraft Java Edition 26.1.2.
- Fabric Loader and Java 25, with versions verified for the target game release.
- JourneyMap plus its separate Webmap addon are optional. Litematica and Malilib are optional.

Optional-mod compatibility with Minecraft 26.1.2 has not yet been verified. The Webmap addon is separate from JourneyMap 6.0 onward.

## Build and install

From the repository root, run `./gradlew releaseBuild` on Linux/macOS or `gradlew.bat releaseBuild` on Windows. Copy the resulting production mod JAR from `build/release/` into the Minecraft instance's `mods` directory. No release JAR is available from this environment yet: Gradle cannot resolve the official Fabric Loom plugin because DNS requests to `maven.fabricmc.net` are blocked. Once that host is reachable, rerun the command and verify the JAR before installing it.

Start the Fabric client and open the local dashboard URL reported by MinePanel. The URL uses loopback only. Open the URL on the same PC, then move the browser window to the second monitor. Do not change the service to listen on a network interface.

## JourneyMap Webmap

Install the matching JourneyMap and separate Webmap client mods. Enable/configure Webmap in JourneyMap's own settings and use its actual displayed/configured local endpoint. MinePanel must not assume a port. Direct browser opening is the fallback if iframe embedding is blocked.
