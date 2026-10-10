# MinePanel implementation plan

## Verified starting point

The repository initially contained only a short README; there was no build, application, or test setup. The supported target in this project is Minecraft Java Edition 26.1.2 with Java 25 and Fabric only.

The official [Fabric 26.1.2 Loom documentation](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/loom/index.md) says Minecraft 26.1 and newer use `net.fabricmc.fabric-loom` (the game is unobfuscated). The [26.1 porting guide](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/porting/index.md) requires Java 25 and advises using the Fabric Develop site for version coordinates. The official [Fabric example mod for 26.1](https://github.com/FabricMC/fabric-example-mod/tree/26.1) uses Java 25 and the new Loom plugin ID. This verifies the 26.1 build approach, but not that any particular Loader/API/Loom release or optional-mod release supports **26.1.2**. Maven metadata was unreachable in this environment; do not infer patch compatibility from the example.

JourneyMap's [official Webmap installation guide](https://github.com/TeamJM/journeymap-docs/blob/6.0.x/docs/en/webmap/installing.md) confirms that Webmap is a separate, client-side addon and requires JourneyMap. Its URL, configured port, access controls, browser headers, and iframe behavior must be discovered/tested against the actual compatible addon before claiming iframe support. No endpoint is assumed.

## Architecture and component boundaries

1. **Fabric client mod:** lifecycle ownership, client-thread state collection, configuration, optional-mod detection, and immutable snapshots. No server-side installation, command, or inventory mutation.
2. **Local service:** loopback-only HTTP for bundled assets and narrow read-only APIs, with a per-process random secret delivered in a same-origin response (never in a URL or log), strict origin/host and request validation, bounded work, and clean shutdown. Minecraft state must be copied on the client thread; network work must not run there.
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

- Fabric Loader, Fabric API, Loom, and Gradle versions must be pinned to versions verified for Minecraft 26.1.2, not merely 26.1. Current official 26.1 example coordinates are reference evidence only.
- Java toolchain/release target: 25. Use current official 26.1 unobfuscated Loom plugin ID.
- Prefer JDK facilities for the local transport and avoid a runtime web-server dependency unless a tested WebSocket implementation becomes necessary.
- JourneyMap Webmap and Litematica/Malilib are optional and are not compile-time requirements until exact compatible versions and supported APIs have been verified.
- Frontend assets must be built locally and embedded in the mod JAR; the runtime must not need internet access.

## Integration limitations to resolve

- Verify exact Fabric Loader, API, and Loom artifacts for 26.1.2 from authoritative metadata before release.
- Confirm JourneyMap and Webmap versions for 26.1.2, local endpoint discovery/configuration, and browser iframe policy. Until tested, provide a direct-open fallback and report embedding as unverified.
- Confirm Litematica/Malilib 26.1.2 versions and stable placement/mismatch APIs before implementing the optional adapter. No reflection-based guesswork.
- Exercise the actual client APIs and test singleplayer/multiplayer; compilation alone cannot establish game behavior.

## Milestones, tests, acceptance

1. **Foundation:** pinned Java/Fabric build, lifecycle, loopback service, bundled offline dashboard, and automated service tests. Accept when the client can start the service, same-origin browser can read a status snapshot, unauthorized requests fail, and shutdown closes the listener.
2. **Core telemetry:** immutable player/inventory/equipment/health/stat snapshots and session playtime/events/warnings. Test deltas, thresholds, de-duplication, and invalid/unavailable data.
3. **Dashboard:** responsive movable/resizable widgets, named layouts, accessibility, filters, and preference persistence (no history). Test layout recovery and filters.
4. **JourneyMap:** verified endpoint/status, direct-open fallback, iframe only after real compatibility testing.
5. **Containers:** read-only visible contents, last snapshot, and session-only pins; test stale/open distinction.
6. **Litematica:** isolated optional adapter, actual placement-based progress and controlled progress tests, with scheduled/incremental calculation.
7. **Release/reliability:** lifecycle/security/integration tests, full manual checklist where runtime dependencies exist, valid production JAR, and reproducible `releaseBuild`.

Each milestone must build and its docs must distinguish tested behavior from unverified behavior. Manual checks are not claimed unless performed.
