# MinePanel implementation plan

## Verified starting point

The repository initially contained only a short README; there was no build, application, or test setup. The supported target in this project is Minecraft Java Edition 26.1.2 with Java 25 and Fabric only.

The official [Fabric 26.1.2 example mod](https://github.com/FabricMC/fabric-example-mod/tree/26.1.2) pins Minecraft `26.1.2`, Loader `0.19.5`, Fabric API `0.155.3+26.1.2`, Loom `1.18-SNAPSHOT`, Gradle `9.7.1`, and Java 25. These are example pins, not minimum versions. Fabric API's own `26.1.2` branch corroborates API `0.155.3` and game version `26.1.2`, with its project baseline Loader `0.18.4`; it does not establish incompatibility of the example's Loader `0.19.5`. The [versioned Loom docs](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/loom/index.md) say 26.1+ uses `net.fabricmc.fabric-loom` because Minecraft is unobfuscated. The [porting guide](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/porting/index.md) requires Java 25 and lists the 26.1 build changes.

Build audit: `./gradlew releaseBuild --no-daemon --stacktrace --info` with Java 25 and the pinned Gradle 9.7.1 reproduced `UnknownPluginException` for the marker coordinate `net.fabricmc.fabric-loom:net.fabricmc.fabric-loom.gradle.plugin:1.18-SNAPSHOT`. This does **not** establish an absent or incompatible artifact. `curl` fails before HTTP with `Could not resolve host: maven.fabricmc.net`; the previous run's Actions log records that domain blocked by firewall DNS for Java and curl, and Gradle's selected plugin repository is the official Fabric Maven. The official Loom source configures the 1.18-SNAPSHOT plugin marker, and the official 26.1.2 example uses the same plugin ID/version, so no version/repository workaround is justified. The full Loom/game build cannot be verified until network policy permits that Maven host.

JourneyMap's [official Webmap installation guide](https://github.com/TeamJM/journeymap-docs/blob/6.0.x/docs/en/webmap/installing.md) confirms that Webmap is a separate, client-side addon and requires JourneyMap. Webmap's upstream `26.1` branch targets Minecraft 26.1.2; its docs say its resolved endpoint is announced in chat/log, with a configured port and possible fallback port. No official endpoint-discovery API or iframe guarantee is documented. A direct-open fallback is required.

Litematica and MaLiLib now have 26.1.2 ports: the `LTS/26.1` branches of [sakura-ryoko/litematica](https://github.com/sakura-ryoko/litematica/tree/LTS/26.1) (0.27.14) and [sakura-ryoko/malilib](https://github.com/sakura-ryoko/malilib/tree/LTS/26.1) (0.28.12), published as `fi.dy.masa.litematica:litematica-fabric-26.1.2` and `fi.dy.masa.malilib:malilib-fabric-26.1.2` on `https://masa.dy.fi/maven/sakura-ryoko`. Both are LGPL-3.0 and use Mojang names. The adapter design below was checked against that source; it has not been compiled or run in game. See [Litematica build progress](#litematica-build-progress).

## Architecture and component boundaries

1. **Fabric client mod:** lifecycle ownership, client-thread state collection, configuration, optional-mod detection, and immutable snapshots. No server-side installation, command, or inventory mutation.
2. **Local service:** loopback-only HTTP for bundled assets plus a bounded browser WebSocket listener for read-only snapshots. A per-server random secret is delivered as an HttpOnly same-origin cookie (never in a URL or log); WebSocket Host/Origin/cookie, handshake and frames are validated. Minecraft state must be copied on the client thread; network work must not run there.
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
- The service uses JDK HTTP plus a small, narrowly scoped WebSocket server implementation. It sends one initial full snapshot and field-level deltas on changed samples; clients reconnect to receive a new initial snapshot.
- JourneyMap Webmap is optional and not a compile-time requirement until an exact compatible version has been verified.
- Litematica/MaLiLib are optional `compileOnly` dependencies (never bundled), with versions kept in `gradle.properties`.
- Frontend assets must be built locally and embedded in the mod JAR; the runtime must not need internet access.

## Integration limitations to resolve

- Confirm a published JourneyMap/Webmap 26.1.2 artifact and test endpoint/iframe behavior with it; source branch compatibility alone is not runtime verification.
- Confirm `masa.dy.fi` is reachable from CI, then compile the Litematica adapter against 0.27.14 and test it in game. No reflection-based guesswork.
- Exercise the actual client APIs and test singleplayer/multiplayer; compilation alone cannot establish game behavior.

## Milestones, tests, acceptance

1. **Foundation:** pinned Java/Fabric build, lifecycle, loopback service, bundled offline dashboard, and automated service tests. Accept when the client can start the service, same-origin browser can read a status snapshot, unauthorized requests fail, and shutdown closes the listener.
2. **Core telemetry (partial):** client tick sampling publishes immutable versioned position/dimension/health/absorption/session and inventory/equipment snapshots, with a 250 ms sampling ceiling and change detection. A WebSocket sends initial state and changed-field/changed-slot deltas with revision baselines. Inventory/equipment is read-only with textual item fallback. Vanilla statistics, warnings, and event history remain outstanding. Full mod compilation and runtime behavior remain unverified; see [testing](TESTING.md) for the current build audit rather than treating unit tests as game verification.
3. **Dashboard:** responsive movable/resizable widgets, named layouts, accessibility, filters, and preference persistence (no history). Test layout recovery and filters.
4. **JourneyMap:** verified endpoint/status, direct-open fallback, iframe only after real compatibility testing.
5. **Containers:** read-only visible contents, last snapshot, and session-only pins; test stale/open distinction.
6. **Litematica:** isolated optional adapter, actual placement-based progress and controlled progress tests, with scheduled/incremental calculation.
7. **Release/reliability:** lifecycle/security/integration tests, full manual checklist where runtime dependencies exist, valid production JAR, and reproducible `releaseBuild`.

Each milestone must build and its docs must distinguish tested behavior from unverified behavior. Manual checks are not claimed unless performed.

## Litematica build progress

Status: planned, not started. Target: Minecraft 26.1.2, Litematica 0.27.14, MaLiLib 0.28.12.

### What the tile shows

The **Build progress** tile follows the placement currently selected in Litematica (`getSelectedSchematicPlacement()`); with none selected it says "No placement selected in Litematica".

- **Blocks placed / total blocks**, plus a progress bar of the same ratio.
  - *Total* is the non-air blocks in the placement's enabled sub-regions, counted from the schematic's block containers (as `MaterialListUtils.createMaterialListFor(schematic, subRegions)` does). It needs no loaded chunks.
  - *Placed* is positions where the world exactly matches the schematic, summed from per-chunk scan results. Wrong blocks and Litematica's "different block" matches are not placed. Chunks not yet checked count as not placed, and the tile says how many there are.
  - *Extra blocks* (the schematic has air but the world has a block: leftover terrain, scaffolding, torches; water and lava only when Litematica's `ignoreExistingFluids` is off) do not affect the numbers or bar. They appear as a separate "N to clear" line when non-zero.
- **Material list**, one row per item: *Left* (missing + wrong + unchecked, as items via `MaterialCache.getRequiredBuildItemForState`), *Have* (player inventory including the contents of shulker boxes and bundles, from MinePanel's own inventory snapshot), and *Still need* = max(0, Left − Have), with ✓ when covered. Sorted by Still need, covered rows last. Counting the remembered ender chest may become an off-by-default option.
- When small, the tile shows only the name, numbers and bar.

Inventory feeds only *Have*/*Still need*; it never affects placed, total or the bar.

### How progress is calculated

- Work unit: one chunk of the selected placement, from `getTouchedChunks(PLACEMENT_ENABLED)` and `getBoxesWithinChunk`.
- A chunk is checked only under Litematica's verifier rule: the 3×3 client chunks around it are loaded and the schematic world (`SchematicWorldHandler.getSchematicWorld()`, filled only near the player) has it.
- Comparison matches `SchematicVerifier.checkBlockStates`: Litematica's `ignoreCropAge`, `ignoreExistingFluids` and `enableDifferentBlocks` options, `IgnoreBlockRegistry`, and the placement verifier's ignored mismatches when one exists.
- Per-chunk results are cached so progress survives walking away; caches for the last 4 placements (by `getHashId()`) are kept. A placement fingerprint change (origin, rotation, mirror, enabled sub-regions/boxes) drops its cache.
- A MinePanel mixin on `ClientLevel.setServerVerifiedBlockState` (the same hook Litematica uses) and chunk loads mark chunks for rescanning.
- Scanning runs at END_CLIENT_TICK under a fixed per-tick budget. Litematica is read only on the client thread; only immutable snapshots leave it.
- Litematica's own `SchematicVerifier` and `MaterialListPlacement` tasks are not driven: they add HUD renderers and chat messages and belong to the user's GUI state.

### Structure and future versions

- Only `dev.craftyplayz.minepanel.litematica` imports Litematica/MaLiLib. The scanner, cache, counts and snapshot are pure Java behind a `BuildSource` interface, tested with fake chunks and classifiers.
- `litematica_version`/`malilib_version` live in `gradle.properties`; `processResources` writes them into `fabric.mod.json` (`"suggests": {"litematica": ">=${litematica_version}"}`) and the adapter's version check.
- Missing Litematica, an unsupported version, or any `LinkageError`/`RuntimeException` turns the tile unavailable for the session with one logged warning; gameplay is never affected.
- Porting to a new Minecraft version: bump the properties, compare the adapter against the new `LTS/<version>` branch using the API list below, fix compile errors, and re-run the manual checks.

| Litematica/MaLiLib API used | Purpose |
|---|---|
| `DataManager.getSchematicPlacementManager().getSelectedSchematicPlacement()` | Selected placement |
| `SchematicPlacement`: `getHashId`, `getName`, `getSchematic`, `getOrigin`, `getRotation`, `getMirror`, `getTouchedChunks`, `getBoxesWithinChunk`, `getEnabledRelativeSubRegionPlacements`, `hasVerifier`/`getSchematicVerifier().getIgnoredMismatches()` | Identity, fingerprint, scan area, ignored mismatches |
| `LitematicaSchematic.getSubRegionContainer` | Total blocks |
| `SchematicWorldHandler.getSchematicWorld()`, `WorldUtils.isClientChunkLoaded` | Expected blocks, chunk-ready rule |
| `BlockUtils.areStatesEqualIgnoringAge`, MaLiLib `BlockUtils.isInSameGroup`/`matchPropertiesOnly`, `IgnoreBlockRegistry`, `Configs` options above | Verifier-equivalent comparison |
| `MaterialCache.getRequiredBuildItemForState` | Block → required item |
| `DataManager.getClientTickStartTime()` | Tick budget |

### Wire format

A new `build` detail field (schema version 4), replaced whole when it changes:

```
build: { available, reason,
         placement: { id, name, total, placed, wrong, extra, uncheckedChunks, scanComplete, checkedAt } | null,
         materials: [ { itemId, name, icon, left, have } ] }   // at most ~128 entries
```

### Steps

1. Add the Maven repository, `compileOnly` dependencies and version properties; check CI can reach `masa.dy.fi`.
2. Pure-Java scanner, per-chunk cache, totals and material counting, with `serviceTest` coverage (each classification, readiness rule, budget/cursor resume, cache invalidation, bounds, JSON/deltas).
3. Adapter package, block-change mixin, wiring in `MinePanelClient`.
4. `build` field in `PlayerDetails`/`protocol.js`, tile UI, JS tests; `releaseBuild` checks the adapter is present and no Litematica classes are bundled.
5. Docs (ARCHITECTURE, INSTALLATION, TESTING, README) and manual checks: singleplayer and server, selection changes, walking away and back, building outside render range, Litematica absent, counts matching Litematica's verifier.
