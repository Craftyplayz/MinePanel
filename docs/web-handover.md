# Handover: continuing MinePanel in Claude Code on the web

Written 2026-10-15 for the next session (human or Claude Code on the web). Read this, then
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — its **Litematica build progress** section is the agreed plan and
is the source of truth. Do not redesign it; ask the maintainer before changing any decision listed below.

## Current state

- **Litematica support: planned, not started.** No Litematica code, dependency, mixin, protocol field or tile change
  exists yet. The **Build progress** tile is still the placeholder in `src/client/resources/web/index.html`, and the
  `build` tile ID already exists in `layout.js` (hidden by default).
- **Done:** research against the Litematica/MaLiLib source and the written plan in `IMPLEMENTATION_PLAN.md` (committed
  together with this handover).
- **Maintainer's priority:** they are fixing other issues first and asked that the Litematica feature **not be
  implemented yet**. Do not start the steps below until they say so.

### Uncommitted local work that is NOT on GitHub

When this handover was committed, the maintainer's local checkout had uncommitted changes to 14 other files
(`ClientActivity.java`, `PickupTracker.java`, `MinePanelClient.java`, `LayoutStore.java`, the web assets, both test
suites and `README.md`). They appear to rework inventory-change tracking (net gains/losses with sources, losses into
containers) and some Experience tile markup. They were deliberately **left out** of this commit. A web session cloned
from GitHub will not see them: ask the maintainer to push them before touching those files, or expect conflicts.

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

From `IMPLEMENTATION_PLAN.md`: JourneyMap verification (4), containers (5), **Litematica (6, planned as above)**,
release/reliability (7). Full mod compilation and in-game behaviour remain unverified.

## Next steps (once the maintainer gives the go-ahead)

1. Add the Maven repository, `compileOnly` dependencies and `litematica_version`/`malilib_version` properties;
   confirm CI can resolve them.
2. Pure-Java scanner, per-chunk cache, totals and material counting, with `serviceTest` coverage.
3. Adapter package, `ClientLevel.setServerVerifiedBlockState` mixin, wiring in `MinePanelClient`.
4. `build` detail field (`PlayerDetails`, `protocol.js`), tile UI, JS tests, `releaseBuild` checks.
5. Update ARCHITECTURE, INSTALLATION, TESTING and README; run the manual checks listed in the plan.

Checks: `./gradlew check` (runs `serviceTest`, frontend syntax and `node --test src/test/js/dashboard.test.js`).
