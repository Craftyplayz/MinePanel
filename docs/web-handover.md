# Handover: continuing MinePanel in Claude Code on the web

Written 2026-10-15 for the next session (human or Claude Code on the web). Read [`AGENTS.md`](../AGENTS.md), this, then
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — its **Litematica build progress** section is the agreed plan and
is the source of truth. Do not redesign it; ask the maintainer before changing any decision listed below.

## Current state

Updated 2026-10-15 by the web session on branch `ccr-c833f2be-mqcc2v` (see [TESTING.md](TESTING.md#litematica-build-progress-2026-10-15)).

- **Litematica support: steps 1–4 implemented, step 5 docs done; in-game checks not run.** The maintainer's
  local work was pushed as `86a36bf` before this started, and the session was asked to continue the plan.
  - Core (pure Java, `dev.craftyplayz.minepanel.build`), adapter (`dev.craftyplayz.minepanel.litematica`, the only
    package importing Litematica), `BuildProgressCollector`, `BlockChangeMixin`, the schema-4 `build` field and
    the Build progress tile all exist. Choices that filled gaps in the plan are listed under "Choices made during
    implementation" in `IMPLEMENTATION_PLAN.md`.
  - `./gradlew releaseBuild` passed here (full Loom build + all tests), and GitHub Actions passed with the
    masa.dy.fi dependencies.
- **Next:** run the Litematica manual checklist in `TESTING.md` on a real 26.1.2 client and fix what it finds.
  Mixin application, the version check and real counts against Litematica's verifier are untested.

### Build environment notes for web sessions

- Java 25 is not preinstalled; download Temurin 25 (api.adoptium.net works) into the scratchpad and set `JAVA_HOME`.
- `maven.fabricmc.net` and `masa.dy.fi` are reachable. Maven Central returned **429** through the egress proxy,
  so builds used a scratchpad Gradle init script (`-I mirror.gradle`) that rewrites `repo.maven.apache.org` and
  `plugins.gradle.org` repositories to `https://maven-central.storage-download.googleapis.com/maven2/`. It is
  not committed; CI does not need it.

## Agreed decisions

1. **Version scope:** Minecraft 26.1.2 only — Litematica **0.27.14**, MaLiLib **0.28.12** — but structured so later
   versions are a small port (versions in `gradle.properties`, Litematica imports confined to one package, an API
   table in the plan).
2. **Extra blocks** (schematic air, world has a block) do **not** change placed/total or the bar; shown as a separate
   "N to clear" line. **"Different block"** matches (Litematica's `enableDifferentBlocks`) count as **not placed**.
3. **Placement:** only the one selected in Litematica (`getSelectedSchematicPlacement()`).
4. **Tile content:** blocks placed / total blocks, a progress bar of that ratio, and a material list with
   *Left* / *Have* / *Still need*, where *Have* counts the player inventory **including shulker box and bundle
   contents** (from MinePanel's own inventory snapshot). Inventory never affects placed/total/bar.

## Technical constraints

- Client-only Fabric mod; Java 25, Loom `1.18-SNAPSHOT`, Minecraft 26.1.2 (unobfuscated, Mojang names).
- Litematica/MaLiLib are optional `compileOnly` dependencies from `https://masa.dy.fi/maven/sakura-ryoko`
  (`fi.dy.masa.litematica:litematica-fabric-26.1.2:0.27.14`, `fi.dy.masa.malilib:malilib-fabric-26.1.2:0.28.12`).
  Never bundle them (LGPL-3.0). No reflection.
- Only `dev.craftyplayz.minepanel.litematica` may import Litematica. Absence, an older version or any
  `LinkageError`/`RuntimeException` makes the tile unavailable; gameplay must never be affected.
- Read Litematica and world state only on the client thread, under a per-tick budget; only immutable snapshots
  cross to service threads (see [ARCHITECTURE.md](ARCHITECTURE.md)).
- Progress follows Litematica's verifier rules: a chunk is checked only when its 3×3 client chunks are loaded and the
  schematic world has it; comparison honours `ignoreCropAge`, `ignoreExistingFluids`, `enableDifferentBlocks`,
  `IgnoreBlockRegistry` and the verifier's ignored mismatches. Do not drive Litematica's own verifier or material-list
  tasks (they add HUD renderers and chat messages).
- Protocol changes bump `PlayerSnapshot.SCHEMA_VERSION` (3 → 4) and need matching validation in `protocol.js`.
- Docs must separate tested from unverified behaviour; never claim in-game checks that were not performed.
- Every player-visible change (new or changed feature, setting, default, label or message) must update the user wiki in
  [`docs/wiki/`](wiki/Home.md) in the same change. [`AGENTS.md`](../AGENTS.md) says which page covers what.
- Build access: `maven.fabricmc.net` has been blocked by DNS/firewall in earlier agent environments, so a full Loom
  build may fail there (see [TESTING.md](TESTING.md)). `masa.dy.fi` was reachable from the maintainer's machine; check
  it from the web environment and from CI before relying on it.

## Reference source

- Litematica: <https://github.com/sakura-ryoko/litematica/tree/LTS/26.1> — key files:
  `schematic/verifier/SchematicVerifier.java` (`verifyChunks`, `checkBlockStates`),
  `schematic/placement/SchematicPlacement*.java`, `world/SchematicWorldHandler.java`,
  `materials/MaterialCache.java`, `materials/MaterialListUtils.java`, `mixin/world/MixinClientLevel.java`.
- MaLiLib: <https://github.com/sakura-ryoko/malilib/tree/LTS/26.1> — `util/game/BlockUtils.java`.

## Outstanding milestones

From `IMPLEMENTATION_PLAN.md`: JourneyMap verification (4), containers (5), **Litematica (6: implemented, in-game
checks outstanding)**, release/reliability (7). The full mod now compiles and packages; in-game behaviour remains
unverified.

## Next steps

1. ✅ Steps 1–4 and the docs of step 5 (see `IMPLEMENTATION_PLAN.md`).
2. Run the Litematica manual checklist in `TESTING.md` in game; record results there without claiming unrun checks.
3. Fix anything the checks reveal; then continue with the other outstanding milestones.

Checks: `./gradlew check` (runs `serviceTest`, frontend syntax, `node --test src/test/js/dashboard.test.js` and
`litematicaIsolation`); `./gradlew releaseBuild` also validates the JAR.
