# MinePanel

MinePanel is a client-side Fabric companion dashboard for Minecraft Java Edition 26.1.2. It includes a bundled offline dashboard, lifecycle-managed loopback service, player position/health/session telemetry, and read-only inventory/equipment over authenticated WebSocket updates. Statistics, containers, layouts, and optional integrations remain planned.

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

Pure Java service/protocol tests and browser-state tests are distinct from Minecraft verification. Full game compilation and in-game compatibility remain unverified in this environment; see [testing](docs/TESTING.md) for exact commands and build blockers.

JourneyMap plus its separate Webmap addon and Litematica/Malilib are optional, but their MinePanel integrations are not yet implemented. Current compatibility and known limitations are documented in [installation](docs/INSTALLATION.md), [architecture](docs/ARCHITECTURE.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## Privacy

The services bind to loopback only. MinePanel has no cloud service, analytics telemetry, external API calls, chat archive, or persistent gameplay-history store. Current game data is sent only to the local browser while the client is running.
