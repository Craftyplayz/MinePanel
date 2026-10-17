# Testing

`./gradlew releaseBuild` runs the Gradle build, `serviceTest`, `frontendSyntax`, and `frontendTest`, then validates mod metadata, the client entrypoint class, and bundled dashboard assets in the production JAR before copying it to `build/release/minepanel-<mod_version>.jar`. Static assets are already source files: `processClientResources` packages them without a separate frontend compilation step. No lint or type-check configuration exists.

Baseline pure Java service tests passed with both the default Java 17 and installed Java 25; the mod itself requires Java 25. Baseline frontend syntax passed. The existing snapshot/delta checks were described in earlier work but were not committed as a reusable test runner; this milestone adds the Node regression suite without deleting any existing tests.

Available offline checks from the repository root:

```sh
mkdir -p /tmp/minepanel-tests
/usr/lib/jvm/temurin-25-jdk-amd64/bin/javac -d /tmp/minepanel-tests $(find src/main/java src/test/java -name '*.java')
/usr/lib/jvm/temurin-25-jdk-amd64/bin/java -cp /tmp/minepanel-tests:src/client/resources dev.craftyplayz.minepanel.service.LocalDashboardServerTest
node --check src/client/resources/web/app.js
node --test src/test/js/dashboard.test.js
```

The Java suite covers immutable inventory transformation, explicit empty slots, counts/stack limits, moves/splits/consumption, selected held item, armour/offhand, enchanted and damageable items, JSON escaping, changed-slot deltas, availability transitions, revision baselines, HTTP authentication and actual loopback WebSocket initial/update/reconnect/shutdown behavior. Browser tests exercise state application and rendering with a small DOM test harness, including existing position/health/dimension/session fields and stale-data recovery. These are **not Minecraft runtime tests**.

The implementation agent's executed Java check used `javac --release 25 -d .protocol-test-classes` with the main telemetry/service and test Java sources, followed by both `InventorySnapshotTest` and `LocalDashboardServerTest` using that directory plus `src/client/resources` on the classpath; both passed. That temporary directory was removed and is not packaged. The commands above use `/tmp` for reproducible clean checks. The real WebSocket suite also verifies complete outgoing frames larger than 65,535 bytes for bounded item metadata.

Final frontend validation: both `node --check src/client/resources/web/app.js` and `node --check src/test/js/dashboard.test.js` passed; `node --test src/test/js/dashboard.test.js` passed all 21 tests, including back/forward-cache restoration. `git diff --check` passed. Secret scanning found no secrets. Independent read-only code review identified the restoration bug, which was fixed and tested.

Final automated validation was incomplete: the packaged code-review runner could not load its configured model; CodeQL completed JavaScript with zero alerts but timed out before all languages finished. This is not a clean full Java/security scan. Minecraft runtime checks remain not run.

## Build audit (2026-10-10)

With `JAVA_HOME=/usr/lib/jvm/temurin-25-jdk-amd64` and its `bin` directory on `PATH`, `./gradlew releaseBuild --stacktrace` failed at plugin resolution (`build.gradle:2`), before source compilation, with `org.gradle.api.plugins.UnknownPluginException` for `net.fabricmc.fabric-loom:net.fabricmc.fabric-loom.gradle.plugin:1.18-SNAPSHOT`. The complete stack trace contained no nested `Caused by:` exception. Direct repository probing failed with curl exit 6, `Could not resolve host: maven.fabricmc.net`, before TLS or HTTP. Mojang metadata/data/library hosts also failed DNS. Plugin Portal redirected the marker lookup to Maven Central, where it returned 404; Central is not a replacement for Fabric Maven.

The Gradle distribution was cached, but no Loom or Minecraft dependency artifacts were cached (only module metadata), so an offline release build was not attempted. Previous Actions run `38037704256`, job `114171506388`, independently records the same marker failure and Fabric Maven firewall block; a successful agent workflow conclusion does not imply a successful mod build.

The official [26.1.2 example](https://github.com/FabricMC/fabric-example-mod/tree/26.1.2) and [versioned porting guide](https://github.com/FabricMC/fabric-docs/blob/main/versions/26.1.2/develop/porting/index.md) corroborate Java 25, Gradle 9.7.1, Loom 1.18-SNAPSHOT, Loader 0.19.5, API 0.155.3+26.1.2, the unobfuscated plugin ID, `implementation` dependencies, and ordinary production `jar` (not `remapJar`). No duplicate plugins or incorrect repository ordering were found. Pins remain unchanged.

Consequently Minecraft compilation, Gradle task execution, and actual JAR packaging remain blocked, not passed. No real release JAR was generated. Dependency pins were checked against official source; unit tests ran with Temurin 25.0.4.1 and Node 22.23.3, not a running game.

After implementing and extracting the client collector, `./gradlew releaseBuild --stacktrace --console=plain` with Java 25 failed again at the same pinned Loom marker before compilation/tests/packaging. Final client changes therefore remain source-reviewed only.

## Client API evidence

Official Fabric API's `26.1.2` branch corroborates `Inventory.getItem`/`getSelectedSlot` (transfer inventory storage), `LivingEntity.getItemBySlot` (entity builder test), item component access, durability, enchantment descriptions (item API), `ItemStack.getMaxStackSize` (transfer storage), and `BuiltInRegistries.ITEM.getKey` (armour renderer registry). Additional target-version evidence for `ItemEnchantments.getLevel(Holder<Enchantment>)` and equipment enum constants comes from [mirrored generated 26.1.2 Javadoc](https://raw.githubusercontent.com/mas6y6/NeoForgeJavaDocs/main/26.1-26.1.2.7-beta/net/minecraft/world/item/enchantment/ItemEnchantments.html), not a locally downloaded official Minecraft artifact. This corroboration is not compilation or in-game verification. Mojang artifact DNS restrictions prevent stronger local verification.

No Minecraft runtime/manual integration checks have been performed.

## Manual checklist (not yet performed)

- [ ] Minecraft 26.1.2 + Fabric Java 25: client startup and shutdown.
- [ ] Singleplayer and multiplayer without server-side MinePanel.
- [ ] JourneyMap and compatible Webmap: endpoint, embedding policy, and direct-open fallback.
- [ ] Litematica build progress (Litematica 0.27.14 / MaLiLib 0.28.12): see the Litematica checklist below.
- [ ] Sodium and REI each present and absent.
- [ ] Inventory: move/split/consume, selected slot, custom names, enchantments, durability, armour and offhand in real Minecraft.
- [ ] Container open/close/pinning and warnings (future features).
- [ ] Statistics and session event history using the reproducible checklist below.
- [ ] Browser refresh/reconnect, service unavailable, and port conflict.
- [ ] Fullscreen/borderless gameplay with dashboard on a second monitor.

Do not mark these checks complete without running them on the target client.

## Inventory/statistics/history milestone verification (2026-10-10)

Initial working tree was clean at `3820237` (inventory/dashboard merge); no repository `AGENTS.md` was present. Configured dependency pins are unchanged. Baseline commands, run from `/home/runner/work/MinePanel/MinePanel`:

```sh
mkdir -p /tmp/minepanel-baseline
javac -d /tmp/minepanel-baseline $(find src/main/java src/test/java -name '*.java')
java -cp /tmp/minepanel-baseline:src/client/resources dev.craftyplayz.minepanel.telemetry.InventorySnapshotTest
java -cp /tmp/minepanel-baseline:src/client/resources dev.craftyplayz.minepanel.service.LocalDashboardServerTest
node --check src/client/resources/web/app.js
node --test src/test/js/dashboard.test.js
```

All exited 0 with default Java 17; baseline browser suite: **21 passed, 0 failed**. Java tests use synthetic models plus actual local HTTP/WebSocket connections, not Minecraft.

Final Java 25 checks executed by the collector validation agent:

```sh
mkdir -p .minepanel-final-java
/usr/lib/jvm/temurin-25-jdk-amd64/bin/javac --release 25 -d .minepanel-final-java $(find src/main/java src/test/java -name '*.java')
/usr/lib/jvm/temurin-25-jdk-amd64/bin/java -cp .minepanel-final-java:src/client/resources dev.craftyplayz.minepanel.service.LocalDashboardServerTest
/usr/lib/jvm/temurin-25-jdk-amd64/bin/java -cp .minepanel-final-java:src/client/resources dev.craftyplayz.minepanel.telemetry.ItemExtractorTest
/usr/lib/jvm/temurin-25-jdk-amd64/bin/java -cp .minepanel-final-java:src/client/resources dev.craftyplayz.minepanel.telemetry.InventorySnapshotTest
/usr/lib/jvm/temurin-25-jdk-amd64/bin/java -cp .minepanel-final-java:src/client/resources dev.craftyplayz.minepanel.telemetry.StatisticsAndHistoryTest
rm -rf .minepanel-final-java
```

All passed (exit 0); the temporary classes were removed. After the counter-decrease regression was added, the same compilation and standalone `StatisticsAndHistoryTest` were repeated successfully. For future local reproduction use `/tmp/minepanel-final-java` instead of the removed scratch path. `serviceTest` now invokes inventory, extraction, statistics/history and service runners together.

Final frontend checks executed by the dashboard agent:

```sh
node --check src/client/resources/web/app.js
node --check src/test/js/dashboard.test.js
node --test src/test/js/dashboard.test.js
git diff --check
```

All passed; **32 dashboard tests passed, 0 failed**. No configured lint/type-check tool exists.

`ItemExtractorTest` uses **fake read-only views** to exercise production extraction shared by `MinecraftInventoryCollector`, including empty/populated slots, all 36 slots, selection/held equality, all armour and offhand, stack counts/limits, durability, applied/stored enchantments, text bounds, read counts and changes between samples. It does **not** call `MinecraftInventoryCollector.collect` with a real player or stack. `StatisticsAndHistoryTest` uses synthetic observed counters/transitions for null values, first-sync and decreased-counter baselines, serialization, field deltas, immutability, bounded eviction, duplicate-death suppression, reported aggregate kills and connection reset. Dashboard tests use a synthetic DOM and messages, including filters/search, details expansion, unsafe-text rendering, bounds, versioning and disconnect clearing.

No Fabric game-test or headless Minecraft client infrastructure is configured; there are no game-test source sets or launcher fixtures. Adding a speculative game test while dependencies are unavailable would not demonstrate compatibility. Missing player/world handling and real API bridging remain source-reviewed only.

### Release failure and artifacts

Executed `./gradlew releaseBuild --stacktrace --console=plain` first with default Java, then with:

```sh
JAVA_HOME=/usr/lib/jvm/temurin-25-jdk-amd64 PATH=/usr/lib/jvm/temurin-25-jdk-amd64/bin:$PATH ./gradlew releaseBuild --stacktrace --console=plain
```

Both exited 1 before any source compilation. Complete logs were captured at `/tmp/minepanel-release-baseline.log` and `/tmp/minepanel-release-java25.log` for this sandbox session. The relevant failure is:

```text
Build file '/home/runner/work/MinePanel/MinePanel/build.gradle' line: 2
Plugin [id: 'net.fabricmc.fabric-loom', version: '1.18-SNAPSHOT'] was not found
- Gradle Core Plugins (plugin is not in 'org.gradle' namespace)
- Included Builds (No included builds contain this plugin)
- Plugin Repositories (could not resolve plugin artifact
  'net.fabricmc.fabric-loom:net.fabricmc.fabric-loom.gradle.plugin:1.18-SNAPSHOT')
Searched: maven(https://maven.fabricmc.net/), Gradle Central Plugin Repository, MavenRepo
org.gradle.api.plugins.UnknownPluginException
```

Direct `curl -I --connect-timeout 10 --max-time 15` probes of `https://maven.fabricmc.net/net/fabricmc/fabric-loom/1.18-SNAPSHOT/maven-metadata.xml` and `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` both exited 6: **Could not resolve host**. This is network/DNS evidence, not evidence of an invalid version or compilation error. GitHub MCP workflow listing and historic job `114171506388` logs were inspected; agent workflow success is not a release-build result.

To avoid repeating blocked requests, final release verification used the same Java 25 environment with `./gradlew releaseBuild --offline --stacktrace --console=plain`: exit 1, same uncached Loom plugin, full log `/tmp/minepanel-release-final.log`. No local artifact could satisfy offline resolution. Inspection with `find /home/runner/work/MinePanel/MinePanel/build -type f -name '*.jar'` found **no JAR** (no build directory). Expected `/home/runner/work/MinePanel/MinePanel/build/release/minepanel-0.1.0.jar` does not exist. Client compilation, mixin injection, packaging, and Minecraft 26.1.2 launch have **not** passed or run.

Automated final validation: secret scan clean; packaged code review could not load its configured model (despite its success heading); CodeQL JavaScript completed with **0 alerts**, but timed out before all languages finished. This is not a successful complete Java security scan.

An independent read-only code-review agent subsequently found that Fabric disconnect notification can run on Netty's thread. The client callback now schedules mutation through `client.execute`, guards obsolete connection identities, and prevents sampling a disconnected but still-populated player/world. This tightly scoped client fix was source-reviewed; Minecraft compilation/runtime remain blocked. Automated validation was not retried after its explicit timeout warning.

### Target API evidence and multiplayer limitations

Official [Fabric 26.1.2 connection events](https://github.com/FabricMC/fabric/blob/26.1.2/fabric-networking-api-v1/src/client/java/net/fabricmc/fabric/api/client/networking/v1/ClientPlayConnectionEvents.java) distinguish INIT, JOIN and DISCONNECT. Vanilla packet/custom-stat APIs were corroborated against a [third-party 26.1.2 source mirror](https://github.com/Sekai0NI0itamio/ModCompiler/tree/DecompiledMinecraftSourceCode/26.1.2-fabric/net/minecraft): `ClientboundAwardStatsPacket.stats()`, `Stats.CUSTOM`, `FLY_ONE_CM`, `LEAVE_GAME`, `Stat.getType/getValue`, and `StatsCounter.getValue`. Client implementation bodies were available in that mirror's matching Forge subtree, not its Fabric subtree. This evidence is **not an official artifact compilation**. [Loader 0.19.5](https://github.com/FabricMC/fabric-loader/blob/0.19.5/gradle.properties) declares Mixin `0.17.4+mixin.0.8.7`, whose `JAVA_25` compatibility level supports the configured JVM/ASM prerequisites; actual injection still needs live verification.

Statistics responses are sparse; `StatsCounter.getValue` alone returns zero even for absent values. Only observed packet IDs are treated as available. Totals belong to the connected server/world, not other players or a universal account. Never-used values may remain unavailable, sessions begin at first synchronization, and server suppression/delay is respected. Kill history records aggregate vanilla counter increases, without targets, exact action times, death causes, scoreboard/minigame semantics or hidden server state.

### Reproducible manual Minecraft verification (not performed)

1. On a network-enabled Java 25 machine, run `./gradlew releaseBuild`; inspect the actual release JAR with `jar tf` for mod metadata, client entrypoint, `minepanel.client.mixins.json`, `StatisticsSyncMixin.class` and all bundled web assets. Install that verified JAR in a clean Fabric 26.1.2 client with the configured Loader/API.
2. Launch singleplayer; inspect logs for startup or mixin errors, open the printed loopback dashboard URL. Repeat multiplayer on a server without MinePanel; never add permissions/bypass restrictions to obtain data.
3. Start with empty inventory, then populate every slot (0–35), cycle all nine selected hotbar slots, equip head/chest/legs/feet and offhand. Compare dashboard identity/name/count/max stack size against Minecraft tooltips. Move/split/consume stacks using **Minecraft**, not dashboard actions.
4. Test stackable blocks, 16-stack items and one-stack tools; compare damaged/undamaged tools, non-damageable items, applied enchantments and stored enchanted-book enchantments. Rename an item and change held/offhand/armour between samples. Verify old snapshot values are replaced without inventory mutations.
5. Open vanilla Statistics to compare synchronized counters. Walk/sprint/swim/fly/jump, then wait at least ten seconds; confirm cumulative counters and first-sync session differences. Unsent counters must read Unavailable. Change worlds/servers to verify baseline reset; respawn/dimension travel must not reset the connection session.
6. Observe one death and respawn, travel dimensions and produce vanilla kill-counter changes. Verify one transition event per death, dimensions, aggregate kill-report wording, receipt timestamps, category search/filter and expandable details. Do not expect hidden kills or target identities.
7. Disconnect: inventory/counters unavailable and prior events marked stale. Join another world: new session ID/history and baselines, without prior events. Browser reload/reconnect requires a full snapshot; socket loss clears displayed history. Repeat respawn and temporary loading screens to check missing player/level recovery.
8. Trigger more than 100 supported events during a disposable session (for example dimension transitions), confirm oldest eviction and consistent newest-first display. Close client and relaunch: no history survives, no chat/database archive appears, and local services stop.

Record actual game version, commands, log errors and observed results before marking any manual/runtime check passed.

## Litematica build progress (2026-10-15)

Run in a Claude Code on the web container on branch `ccr-c833f2be-mqcc2v`, with Temurin 25.0.4.1+1 and Node 22.22.0:

- `./gradlew releaseBuild` **passed**: Loom, Minecraft 26.1.2 and Fabric API resolved, main and client sources compiled (the Litematica adapter against the real Litematica 0.27.14 and MaLiLib 0.28.12 jars from `https://masa.dy.fi/maven/sakura-ryoko`), `serviceTest` (including `BuildProgressTest`), `frontendSyntax`, `frontendTest` (68 tests) and `litematicaIsolation` passed, and the release JAR was validated: adapter, mixin and core classes present, no `fi/dy/masa/` classes, `suggests.litematica` = `>=0.27.14`. This is the first full Loom build recorded for this project. In this container Maven Central answered 429 (rate limited) through the egress proxy, so the build ran with a Gradle init script (not committed) that points Maven Central and Plugin Portal at Google's Central mirror `https://maven-central.storage-download.googleapis.com/maven2/`; no repository file depends on it.
- `javap` on the Loom-provided 26.1.2 client jar confirmed the mixin target `ClientLevel.setServerVerifiedBlockState(BlockPos, BlockState, int)`. Mixin application itself was not exercised.
- GitHub Actions run 17 (`Build MinePanel`, commit `f9dd3cd`) **succeeded** with the Litematica/MaLiLib dependencies, so CI can reach `masa.dy.fi`.
- Mutation checks: breaking a tile message made the JS suite fail, and adding a Litematica import outside the adapter package made `litematicaIsolation` fail.

`BuildProgressTest` covers each classification (placed, missing, wrong, extra, ignorable fluids, crop age, ignored mismatches), total counting resumed across ticks, the readiness rule (unchecked chunks), the per-tick readiness cap and deadline with cursor resume, rescans after block changes and chunk loads, results kept while unloaded, fingerprint invalidation, the four-placement cache, materials (multi-item states, shulker contents, offhand, sorting, bound of 128) and JSON/deltas. These use fake placements, **not Minecraft**.

### Litematica manual checklist (not performed)

Nothing below has been run in game. With Litematica 0.27.14 and MaLiLib 0.28.12 installed and the Build progress tile enabled:

- [ ] Client starts with and without Litematica; without it the tile says to install Litematica and no errors are logged.
- [ ] Singleplayer: load a schematic, select its placement; the tile shows "Counting" briefly, then placed / total. Place, break and replace blocks; counts follow within a sample.
- [ ] Compare placed / total and wrong with Litematica's own Schematic Verifier for the same placement (missing + wrong + different blocks should equal total − placed when every chunk is checked; extra matches "N to clear").
- [ ] Toggle `ignoreCropAge`, `ignoreExistingFluids` and `enableDifferentBlocks`, and ignore a mismatch in Litematica's verifier; counts change as described in [architecture](ARCHITECTURE.md).
- [ ] Select another placement and back; move/rotate a placement (counts restart); disable a sub-region.
- [ ] Walk away until chunks unload: counts stay. Build outside render range from another player (multiplayer), return: the reloaded chunks are rescanned.
- [ ] Material list: Left/Have/Still need with items in the hotbar, offhand, a shulker box and a bundle; waterlogged blocks need a water bucket.
- [ ] Multiplayer server without MinePanel or Litematica server-side.
- [ ] Frame time with a large placement (for example 500 × 500 × 100) stays smooth while scanning.

## Rules v2 phase 1 (2026-10-16)

Run on Windows 11 on branch `rules-v2`, with Temurin 25.0.4.1 and Node 24.19.0:

- `./gradlew releaseBuild` **passed**. Loom and Minecraft 26.1.2 resolved from the local Gradle cache. The build ran `serviceTest` (now including `LayoutStoreTest`), `frontendSyntax`, `frontendTest` (82 tests), `litematicaIsolation` and the release JAR validation.
- These were also run directly:
  - `node --check` on each dashboard script and on the test file.
  - `node --test src/test/js/dashboard.test.js`.
  - `javac --release 25` over `src/main/java` and `src/test/java` with Gson on the classpath, followed by `LocalDashboardServerTest` (which runs `LayoutStoreTest`).

**What the tests cover**

- `src/test/fixtures/layouts-v2.json` holds 15 valid and 100 invalid version 2 layouts. The JS suite and `LayoutStoreTest` both check it, so `layout.js` and `LayoutStore.java` accept and reject the same layouts. When the format changes, add cases there.
- **Evaluator:**
  - The AND/OR truth table.
  - `for`, `within` and `not`.
  - Delay and linger at their boundaries.
  - Unknown values outside a world.
  - First-claim-wins priority with overridden claims, Else, folders, Force previews, and Notify edges and cooldowns.
  - Each condition type against synthetic snapshots.
  - Amounts within windows, including coalesced history events.
  - Portal linking, including return trips.
- **Migration:**
  - A seeded property test: random v1 rules give the same match as their converted rules (and helper rules) on random inputs.
  - The documented mappings, splitting rules with more than 16 actions, and the 128-rule limit.
  - An app test: a stored v1 layout loads, its rule shows a rules-only tile, and it is saved back as version 2.
  - A layout that can't be converted is never saved over.
- **Java:** v1 is read, a v1 save is rejected, `layout.v1-backup.json` is written once, and an invalid stored file is copied to `layout.rejected.json`.
- **Mutation checks:**
  - JS: swapping AND/OR precedence, letting unknown values pass `not`, making the last claim win, skipping helper rules and removing linger each made the JS suite fail.
  - Java: changing the minimum linger, or allowing a place together with a position, made `LayoutStoreTest` fail.

**Not run.** Nothing was run in Minecraft. The checks use synthetic snapshots, not a live client.

## Customize toolbar cleanup (2026-10-17)

The toolbar no longer shows the game state ("Live") or the version. The tile chips moved into a **Tiles** dropdown, the rule toggles moved from the floating bar at the top right into a **Toggles** dropdown beside it, and **Reset** asks for confirmation (`window.confirm`).

**Tested** (`node --test src/test/js/dashboard.test.js`, 115 passing): the dropdowns open and close (one at a time, on a click elsewhere, and on Done), the tile chips inside still toggle panels, the Toggles button counts the toggles that are on, an empty Toggles dropdown shows a note, and cancelling the Reset question leaves the layout unchanged.

**Not run.** Not checked in a real browser or in Minecraft: dropdown positioning and look, and the browser's confirm window.

## Drag to reorder rules (2026-10-17)

Rules and folders in the rules editor's list can be dragged (HTML drag and drop) to reorder them, and rules can be dragged into and out of folders. The order logic is in `dropRule` and `dropFolder` in `layout.js`; neither ever splits a folder's rules.

**Tested** (`node --test src/test/js/dashboard.test.js`, 116 passing): `dropRule` and `dropFolder` on their own (into, out of and between folders, onto itself, a drop that would split a folder, empty folders), and in the editor test, drag events on the list rows: a rule onto the bottom half of a folder (into it), onto the end zone (out of it), onto the top half of a folder (above it), and a folder with its rules onto a rule.

**Not run.** Not checked in a real browser or in Minecraft: real mouse dragging, the drop marks and grip look, and Firefox starting a drag from a row's name button.
