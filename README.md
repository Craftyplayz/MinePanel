# MinePanel

MinePanel is a client-side Fabric companion dashboard for Minecraft Java Edition 26.1.2. Its initial foundation is a bundled, offline-capable local dashboard and lifecycle-managed status service. Player telemetry, layouts, and the optional integrations are not implemented yet; see the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for milestones and verified limitations.

## Requirements and build

The verified Fabric 26.1.2 example uses Java 25, Fabric Loader 0.19.5, Fabric API 0.155.3+26.1.2, Loom 1.18-SNAPSHOT, and Gradle 9.7.1. Build and test the release with:

```sh
./gradlew releaseBuild
```

Windows:

```bat
gradlew.bat releaseBuild
```

The installable JAR is produced under `build/release/`. The build requires access to the configured Gradle/Fabric repositories the first time; after dependencies are cached, runtime dashboard assets are entirely local.

## Run

Install the JAR in a Fabric 26.1.2 instance's `mods` directory and start the client. MinePanel binds only to `127.0.0.1` on an ephemeral port and prints the dashboard URL in the game log. Open it on the same PC and move the browser to the second monitor. The current dashboard is a connection/status foundation; it does not yet display live player data.

JourneyMap plus its separate Webmap addon and Litematica/Malilib are optional, but their MinePanel integrations are not yet implemented. Current compatibility and known limitations are documented in [installation](docs/INSTALLATION.md), [architecture](docs/ARCHITECTURE.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## Privacy

The service is loopback-only. MinePanel has no cloud service, telemetry, external API calls, chat archive, or persistent gameplay-history store. The dashboard currently exposes only service/build status.
