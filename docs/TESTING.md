# Testing

`./gradlew releaseBuild` runs the Gradle build, `serviceTest`, `frontendSyntax`, and `frontendTest`, then validates mod metadata, the client entrypoint class, and bundled dashboard assets in the production JAR before copying it to `build/release/minepanel-0.1.0.jar`. Static assets are already source files: `processClientResources` packages them without a separate frontend compilation step. No lint or type-check configuration exists.

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
- [ ] Litematica and Malilib compatible versions; placement progress.
- [ ] Sodium and REI each present and absent.
- [ ] Inventory: move/split/consume, selected slot, custom names, enchantments, durability, armour and offhand in real Minecraft.
- [ ] Container open/close/pinning, warnings, statistics and events (future features).
- [ ] Browser refresh/reconnect, service unavailable, and port conflict.
- [ ] Fullscreen/borderless gameplay with dashboard on a second monitor.

Do not mark these checks complete without running them on the target client.
