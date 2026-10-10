# MinePanel

MinePanel is a client-side Fabric companion dashboard targeting Minecraft Java Edition 26.1.2. It includes a bundled offline dashboard, lifecycle-managed loopback service, player position/health/session telemetry, read-only inventory/equipment, vanilla statistics counters, and bounded session event history over authenticated WebSocket updates. Minecraft compilation and runtime compatibility are still **unverified**, not release-ready claims.

## Requirements and build

The verified Fabric 26.1.2 example uses Java 25, Fabric Loader 0.19.5, Fabric API 0.155.3+26.1.2, Loom 1.18-SNAPSHOT, and Gradle 9.7.1. Build and test the release with:

```sh
./gradlew releaseBuild
```

Windows:

```bat
gradlew.bat releaseBuild
```

The configured release artifact is `build/release/minepanel-0.1.0.jar`. This is an expected output, not a claim that it has been generated here. Node.js is also required for frontend syntax and regression checks. Static assets are copied by Gradle into the JAR; there is no framework, transpilation step, or CDN. The build requires access to the configured Gradle/Fabric repositories the first time.

## Run

Once a real release JAR has been built, install it in a Fabric 26.1.2 instance's `mods` directory and start the client. MinePanel binds only to `127.0.0.1` on ephemeral ports and prints the dashboard URL in the game log. Open it on the same PC. The dashboard displays player telemetry, 27 main inventory slots, nine hotbar slots, selected/held items, armour, and offhand. Items use readable names and accurate identifiers, not sprites; counts, stack limits, enchantments, and applicable durability are included. No dashboard action can change inventory.

Statistics are grouped into Movement, Combat and General counters, with server/world cumulative totals and changes since each counter's first synchronized observation. Absent vanilla packet values display **Unavailable**, never fabricated zero. Requests use vanilla's statistics action once on join and at most every ten seconds; restrictive servers may not respond. Session counters exclude activity before the first synchronized baseline.

The newest-first event list supports category filtering, search and expandable details. Up to 100 events are held only in memory: joins/disconnects, observed alive-to-dead transitions, dimension changes, and aggregate increases in synchronized vanilla kill counters. Kill report timestamps are receipt/sample times, not exact kill times; targets, causes, scoreboard/minigame and hidden server events are unavailable. The previous session stays marked stale after disconnect and is replaced on the next play join. Containers/pinning, configurable layouts, JourneyMap and Litematica remain outstanding.

Pure Java service/protocol tests and browser-state tests are distinct from Minecraft verification. Full game compilation and in-game compatibility remain unverified in this environment; see [testing](docs/TESTING.md) for exact commands and build blockers.

JourneyMap plus its separate Webmap addon and Litematica/Malilib are optional, but their MinePanel integrations are not yet implemented. Current compatibility and known limitations are documented in [installation](docs/INSTALLATION.md), [architecture](docs/ARCHITECTURE.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## Privacy

The services bind to loopback only. MinePanel has no cloud service, analytics telemetry, external API calls, chat archive, or persistent gameplay-history store. Current game data is sent only to the local browser while the client is running.
