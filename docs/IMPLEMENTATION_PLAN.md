# MinePanel implementation plan

## Verified starting point

The repository initially contained only a short README; there was no build, application, or test setup. The supported target in this project is Minecraft Java Edition 26.1.2 with Java 25 and Fabric only.

The official [Fabric 26.1.2 example mod](https://github.com/FabricMC/fabric-example-mod/tree/26.1.2) pins Minecraft `26.1.2`, Loader `0.19.5`, Fabric API `0.155.3+26.1.2`, Loom `1.18-SNAPSHOT`, Gradle `9.7.1`, and Java 25. These are example pins, not minimum versions. Fabric API's own `26.1.2` branch corroborates API `0.155.3` and game version `26.1.2`, with its project baseline Loader `0.18.4`; it does not establish incompatibility of the example's Loader `0.19.5`. The [versioned Loom docs](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/loom/index.md) say 26.1+ uses `net.fabricmc.fabric-loom` because Minecraft is unobfuscated. The [porting guide](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/porting/index.md) requires Java 25 and lists the 26.1 build changes.

Build audit: `./gradlew releaseBuild --no-daemon --stacktrace --info` with Java 25 and the pinned Gradle 9.7.1 reproduced `UnknownPluginException` for the marker coordinate `net.fabricmc.fabric-loom:net.fabricmc.fabric-loom.gradle.plugin:1.18-SNAPSHOT`. This does **not** establish an absent or incompatible artifact. `curl` fails before HTTP with `Could not resolve host: maven.fabricmc.net`; the previous run's Actions log records that domain blocked by firewall DNS for Java and curl, and Gradle's selected plugin repository is the official Fabric Maven. The official Loom source configures the 1.18-SNAPSHOT plugin marker, and the official 26.1.2 example uses the same plugin ID/version, so no version/repository workaround is justified. The full Loom/game build cannot be verified until network policy permits that Maven host.

JourneyMap's [official Webmap installation guide](https://github.com/TeamJM/journeymap-docs/blob/6.0.x/docs/en/webmap/installing.md) confirms that Webmap is a separate, client-side addon and requires JourneyMap. Webmap's upstream `26.1` branch targets Minecraft 26.1.2; its docs say its resolved endpoint is announced in chat/log, with a configured port and possible fallback port. No official endpoint-discovery API or iframe guarantee is documented. A direct-open fallback is required.

The upstream Litematica and MaLiLib branches inspected do not include a 26.1.2 branch. Older source exposes placement/material-list structures but does not establish a stable supported API or 26.1.2 compatibility. Do not ship a Litematica adapter until an actually compatible build and API are verified.

## Architecture and component boundaries

1. **Fabric client mod:** lifecycle ownership, client-thread state collection, configuration, optional-mod detection, and immutable snapshots. No server-side installation, command, or inventory mutation.
2. **Local service:** loopback-only HTTP for bundled assets and narrow read-only APIs, with a per-server random secret delivered in a same-origin response (never in a URL or log), strict origin/host and request validation, bounded work, and clean shutdown. Minecraft state must be copied on the client thread; network work must not run there. The current service still uses HTTP polling; a browser WebSocket server remains outstanding.
3. **Bundled browser UI:** offline-capable dashboard assets, accessible dark responsive widgets, and UI-only layout preferences. No remote scripts, APIs, telemetry, or gameplay-history persistence.

Optional integrations are isolated behind adapters and fail closed to an unavailable status. JourneyMap remains the map source of truth. Litematica progress may only be implemented against verified placement/mismatch APIs; inventory ownership is not build progress.

## Data and update policy

Version every wire message. Send a full initial snapshot and then coalesced changes. Critical changes (world/dimension, inventory/container) are event-driven; rapidly changing health is throttled; statistics/diagnostics are sampled less often. Bound network queues and browser payloads. Retain events and container snapshots in memory for the active session only. Do not store chat or create a gameplay database/log.

Every displayed value must identify unavailable data honestly. Server-only facts are not inferred. Containers are read only while legitimately visible and pins are session-only. Statistic values must identify their vanilla source or MinePanel's session calculation.

## Security and performance

- Bind MinePanel only to `127.0.0.1`, using a conflict-resistant ephemeral port by default.
- Validate origin, host, authentication, operation, payload type, and size; expose no filesystem, command, remote-fetch, or inventory-mutation operation.
- Treat Minecraft-provided text as untrusted text, not HTML.
- Keep network and disk I/O off the render/client tick thread; immutable snapshots cross to background workers.
- Optional integrations must never block startup. Stop executors and the service on client shutdown; service failure must not affect gameplay.

## Dependencies and compatibility decisions

- Fabric Loader `0.19.5`, Fabric API `0.155.3+26.1.2`, Loom `1.18-SNAPSHOT`, and Gradle `9.7.1` are pinned to the official 26.1.2 example.
- Java toolchain/release target: 25. Use current official 26.1 unobfuscated Loom plugin ID.
- The foundation uses JDK HTTP and authenticated 3-second status polling to avoid a web-server dependency; WebSocket push updates remain a core-telemetry milestone.
- JourneyMap Webmap and Litematica/Malilib are optional and are not compile-time requirements until exact compatible versions and supported APIs have been verified.
- Frontend assets must be built locally and embedded in the mod JAR; the runtime must not need internet access.

## Integration limitations to resolve

- Confirm a published JourneyMap/Webmap 26.1.2 artifact and test endpoint/iframe behavior with it; source branch compatibility alone is not runtime verification.
- Confirm whether a Litematica/Malilib port for 26.1.2 exists, plus stable placement/mismatch APIs, before implementing the optional adapter. No reflection-based guesswork.
- Exercise the actual client APIs and test singleplayer/multiplayer; compilation alone cannot establish game behavior.

## Milestones, tests, acceptance

1. **Foundation:** pinned Java/Fabric build, lifecycle, loopback service, bundled offline dashboard, and automated service tests. Accept when the client can start the service, same-origin browser can read a status snapshot, unauthorized requests fail, and shutdown closes the listener.
2. **Core telemetry (partial):** client tick sampling publishes immutable versioned position/dimension/health/absorption snapshots and session duration, with a 250 ms sampling ceiling and change detection. The dashboard consumes authenticated HTTP state polling. WebSocket push, vanilla statistics, inventory/equipment, warnings, and event history remain outstanding. Exact vanilla accessor signatures and runtime behavior remain unverified because Loom dependencies cannot be downloaded here.
3. **Dashboard:** responsive movable/resizable widgets, named layouts, accessibility, filters, and preference persistence (no history). Test layout recovery and filters.
4. **JourneyMap:** verified endpoint/status, direct-open fallback, iframe only after real compatibility testing.
5. **Containers:** read-only visible contents, last snapshot, and session-only pins; test stale/open distinction.
6. **Litematica:** isolated optional adapter, actual placement-based progress and controlled progress tests, with scheduled/incremental calculation.
7. **Release/reliability:** lifecycle/security/integration tests, full manual checklist where runtime dependencies exist, valid production JAR, and reproducible `releaseBuild`.

Each milestone must build and its docs must distinguish tested behavior from unverified behavior. Manual checks are not claimed unless performed.
