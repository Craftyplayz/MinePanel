# Testing

`./gradlew releaseBuild` runs the Gradle build and `serviceTest` before checking that the production JAR contains mod metadata and the bundled dashboard. The service test covers loopback binding, static resources, token authorization, cross-origin rejection, unsupported operations, method validation, WebSocket handshake/authentication/origin validation, initial push and changed-field deltas, versioned snapshot JSON, escaped values, deduplicated changes, and unavailable values. In this environment those Java tests were compiled/run directly using Java 25 because Loom cannot resolve while Fabric Maven DNS is blocked. Frontend JavaScript syntax can be checked with `node --check src/client/resources/web/app.js`.

No Minecraft runtime/manual integration checks have been performed.

## Manual checklist (not yet performed)

- [ ] Minecraft 26.1.2 + Fabric Java 25: client startup and shutdown.
- [ ] Singleplayer and multiplayer without server-side MinePanel.
- [ ] JourneyMap and compatible Webmap: endpoint, embedding policy, and direct-open fallback.
- [ ] Litematica and Malilib compatible versions; placement progress.
- [ ] Sodium and REI each present and absent.
- [ ] Inventory, container open/close/pinning, health, warnings, statistics and events.
- [ ] Browser refresh/reconnect, service unavailable, and port conflict.
- [ ] Fullscreen/borderless gameplay with dashboard on a second monitor.

Do not mark these checks complete without running them on the target client.
