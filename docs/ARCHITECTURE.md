# Architecture

MinePanel is a client-only Fabric mod, a loopback-only local service, and a static browser application embedded in the mod JAR. Minecraft APIs belong in the client adapter; the browser consumes versioned snapshots and never issues gameplay mutations.

The client adapter owns lifecycle and reads Minecraft state on the client thread. It copies state into immutable snapshots before publishing to bounded background service workers. The service serves only bundled resources and narrowly scoped authenticated read-only data. Optional integrations are separate adapters; absence or failure is reported as unavailable and does not prevent startup.

Gameplay history is session-only and bounded to 100 immutable events. Open/last-viewed containers and pins remain unimplemented. Chat is not retained. Layouts, preferences and rules are configurable (see [Layout and rules](#layout-and-rules)).

Client tick sampling is capped at four samples per second, suppresses unchanged values, and writes immutable versioned position/dimension/health snapshots into an atomic store. The browser WebSocket receives a full initial snapshot followed by changed-field deltas and reconnects after disconnect. HTTP state access uses a bearer token; the browser session endpoint sets the same random per-server token as an HttpOnly cookie for WebSocket authentication, never in a URL. Both listeners bind to IPv4 loopback; Host and Origin are checked, WebSocket handshakes and frames are bounded, and only read-only paths/frames are supported. No network, disk, or expensive calculation belongs on the Minecraft tick/render thread.

Current player fields include position, dimension ID, health, maximum health, absorption, active-session duration, inventory/equipment, vanilla statistics and session history. The target client has not been compiled or run in Minecraft in this environment.

## Layout and rules

The dashboard layout (tiles, settings, profiles, pinned windows, update rate and rules) is stored by the mod as `config/minepanel/layout.json`. It is read and written through the authenticated `/api/layout` endpoint and validated on both sides: `normalizeLayout` in `layout.js`, and `LayoutStore` with `LayoutRules` in Java. Both must accept and reject the same layouts, and the shared cases in `src/test/fixtures/layouts-v2.json` are checked by both test suites. Rules are evaluated only in the browser (`rules.js`), against the snapshots it already receives. They never cause gameplay actions.

Layout version 2 (rules v2, see [RULES_V2.md](RULES_V2.md)) is current.

- **Version 1** is still read, and the browser converts it. On the first version 2 save over a version 1 file, the mod copies the old file to `layout.v1-backup.json` and never overwrites that copy.
- **Saving** accepts only version 2.
- **A stored file that fails validation** loads as nothing. It is first copied to `layout.rejected.json`, so a later save can't lose it.
- **A version 1 file the browser can't convert** stays untouched: the dashboard shows the error and doesn't save until a layout is imported.

Rules v2 phase 1 added no snapshot fields. Its conditions use only data the protocol already carries. New sensors and registry lists (phase 4) will be new snapshot fields.

## Inventory and equipment protocol

Schema version 2 now includes `inventory`, `statistics` and `history`; both HTTP/WebSocket envelopes and player states use version 2. Unsupported versions require a fresh compatible dashboard, not silent interpretation. An available inventory contains exactly 36 indexed `slots`: 0–8 are hotbar, 9–35 are main inventory. `selectedHotbarSlot` is 0–8. `equipment` has `head`, `chest`, `legs`, `feet`, `offhand`, and `mainhand`. Mainhand is the same immutable value as the selected hotbar item, so the summary and slot cannot disagree.

Each item contains `empty`, registry `itemId`, readable `name`, `count`, `maxCount`, `damage`, `maxDamage`, derived `remainingDurability`, and `enchantments` (`id`, readable `name`, `level`). Empty items have null identity/name/durability, zero counts, and no enchantments. Non-damageable items have null durability rather than fabricated zero durability. Only explicit value records cross the thread boundary; arbitrary Minecraft objects/components are not serialized.

Initial messages contain a complete snapshot. Updates include `baseRevision` (the last revision sent to that connection); revisions can skip because sampling coalesces changes. Inventory updates carry only changed `{index,item}` slot entries, a changed selection, and changed equipment keys. Unchanged inventory is omitted entirely. Availability transitions carry all fields, with `inventory:null` on world disconnect. The browser validates and applies a complete update atomically; missing/wrong baselines or unsupported schemas close the socket and reconnect for a fresh full snapshot. Transport disconnect clears displayed live values, not merely the connection badge.

The client samples every 1, 2, 5, 10 or 20 client ticks (20, 10, 4 by default, 2 or 1 times per second), chosen under "Updates" while customizing and saved as `updates.intervalMillis` in the layout; a save takes effect on the next tick. It compares lightweight immutable values. Network serialization and writes occur only on service workers; inventory is not serialized every tick. The adapter reads only on the client tick thread, retaining no player/world/screen references after the sample. Brief changes between samples can be missed. Browser rendering updates changed slot nodes using text, never item-provided HTML. Item sprites, inventory actions, and warning rules are not implemented.

MinePanel exposes no slot-click, equip, consume, item-move, or inventory-changing packet operation. Its inventory adapter only reads stacks. HTTP and WebSocket threads never read live Minecraft objects.

Applied and stored/book enchantment components are merged by registry ID with the higher level and sorted for stable comparisons. Readable text is bounded to 256 UTF-16 units without splitting surrogate pairs; controls are replaced and malformed Unicode is repaired. Metadata exceeding the bounded protocol invariants makes the sample unavailable rather than crashing gameplay or publishing partially copied inventory; a generic warning is logged once, without item contents.

JourneyMap is the only map source; MinePanel does not render terrain. Litematica completion is based on the compared world state, never carried inventory (see below). JourneyMap's compatible versions and iframe behavior remain unverified until tested against Minecraft 26.1.2.

## Extraction, statistics and session events

`MinecraftInventoryCollector` wraps live stacks in getter-only `ItemExtractor.ItemView` adapters. The pure Java extractor handles empty stacks, metadata bounds, durable/non-durable items and applied/stored enchantment merging before immutable snapshot construction. Fake-view unit tests exercise this production transformation, not real Minecraft stacks; there is no configured game-test or headless client source set.

`MinecraftStatisticsCollector` reads `LocalPlayer.getStats()` only for ten custom statistic IDs actually observed in this connection's vanilla statistics packets. A client-only `StatisticsSyncMixin` observes `ClientPacketListener.handleAwardStats` at RETURN, after vanilla's thread handoff and application. Sparse responses add synchronization evidence rather than replacing it; absent values remain null. The bounded evidence set and static ID map retain no stack/player/world references. A standard `REQUEST_STATS` asks for server-maintained counters; it does not change inventory or gameplay. No custom server plugin or bypass is used.

`StatisticsTracker` establishes a separate baseline on the first received value of each counter. A decrease invalidates/rebases that counter; a new connection resets all baselines. Session means *since first synchronization*, not guaranteed since join. Distance is transmitted in centimeters and time in ticks, formatted in the browser as meters/durations. Cumulative means this server/world's totals, not universal account statistics. Counters are read at four Hz, requests at most every ten seconds; unchanged fields are suppressed. Unknown values stay null even after an empty response, as vanilla packets lack a completeness marker.

`GameplayTracker` owns an oldest-first deque; insertion evicts the oldest event at 100. Events contain increasing session-local IDs, wall-clock timestamps, categories, labels and bounded details. The browser displays newest first and preserves expanded details for unchanged event IDs. Death/dimension transitions are observed at END_CLIENT_TICK to avoid the slower telemetry sampling window; only tiny comparisons/event insertion happen there. Serialization, sockets and dashboard rendering stay off the client thread. Very brief transitions between ticks and unobserved/server-hidden deaths are not inferred.

Fabric play JOIN defines a new session, including joining another server/world; respawn or dimension travel within the same connection does not reset history/baselines. DISCONNECT appends one lifecycle event and retains an inactive history until the next JOIN. A transient missing player/level or invalid metadata clears live availability without prematurely resetting the connection session. Kill events describe aggregate reported counter increases only, with observation timestamps and unknown targets; the initial cumulative total is never treated as a new kill. No chat parsing, permanent history, database, disk write, scoreboard inference, or charts are involved.

Fabric disconnect notification can arrive on the network thread. MinePanel schedules its state changes onto the client executor, ignores obsolete listener callbacks, and samples only the joined, matching connection. A lingering player/level after disconnect cannot restart or erase the retained session.

Statistics and history deltas replace their whole bounded objects only when changed; inventory keeps its existing changed-slot delta semantics. Availability transitions send all fields with `statistics:null`, `inventory:null` and inactive retained history. Transport loss clears even stale displayed history until a fresh initial snapshot arrives. Unit tests cover baseline changes, unavailable counters, bounds, serialization, revision suppression and reset semantics; packet injection and live client compatibility remain unverified pending an accessible Minecraft build environment.

## Client frame rate

`FrameTimingMixin` calls `FrameCollector` at every return from `Minecraft.runTick`, which renders one frame, so frame time is measured end to end, including menus, loading screens and framerate-limiter waits. `FrameStats` runs on the render thread and allocates nothing per frame. It counts each frame into the second it ended in and into a log-spaced frame-time histogram with buckets 2% wide (0.1 ms to 10 s). Each closed second keeps only its non-empty buckets, in a 600-second ring. Running merges for the 10 s, 30 s, 60 s and 600 s windows add the new second and subtract the one leaving. A window's average is frames divided by their total duration. Its 1% low is the frame rate at the 99th-percentile frame time, accurate to the bucket width. A stall shows as seconds with zero frames.

The snapshot is the `performance` detail field. It holds frames per second for up to 600 seconds (newest last) and `{seconds, average, low}` per window, or null until the first second closes. It is rebuilt and resent only when a second closes. The browser averages long windows into at most 120 points and draws them with monotone cubic interpolation, so the curve never overshoots the data. The chosen window is saved as `settings.performance.window`. The mixin's injection into 26.1.2's `runTick` is unverified until the client compiles.

## Litematica build progress

Schema version 4 adds the `build` detail field, replaced whole when it changes:
`{ available, reason, placement: { id, name, total, placed, wrong, extra, uncheckedChunks, scanComplete, checkedAt } | null, materials: [ { itemId, name, icon, left, have } ] }` (at most 128 materials). `reason` is `missing`, `version` or `error` when unavailable, `none` when no placement is selected and `counting` while the schematic's blocks are counted; it is null when a placement is shown.

Code is split in three so Litematica's absence can never break class loading:

- `dev.craftyplayz.minepanel.build` (main source set, pure Java, no Minecraft): `BuildTracker` (counting, chunk scanning, per-chunk cache, materials), `BuildRules` (per-position classification), `ChunkCounts`, the `BuildSource` interface it reads through, and the `BuildProgress` snapshot. Tested by `BuildProgressTest` with fake placements.
- `dev.craftyplayz.minepanel.litematica` (client): `LitematicaBuildSource`, the **only** code that imports Litematica/MaLiLib (`litematicaIsolation`, part of `check`, enforces this). Compiled against Litematica 0.27.14 / MaLiLib 0.28.12 as `compileOnly`; never bundled (`releaseBuild` rejects `fi/dy/masa/` entries).
- `BuildProgressCollector` (client): on the first in-world tick, checks that Litematica is loaded and that its version satisfies MinePanel's own `suggests` range, then creates the adapter. Any `LinkageError` or `RuntimeException` from the adapter disables the tile for the game session with one logged warning.

Every Litematica and world read happens on the client thread at END_CLIENT_TICK, within a 2 ms budget per tick and at most 256 chunk readiness checks per tick. Only the immutable `BuildProgress` leaves that thread.

- **Total** is the count of non-air states in the containers of the placement's enabled sub-regions (as `MaterialListUtils.createMaterialListFor`), counted incrementally without loaded chunks.
- **Scanning** works per chunk of `getTouchedChunks(PLACEMENT_ENABLED)`, comparing every position in `getBoxesWithinChunk`, and only when Litematica's verifier would: the 3×3 client chunks are loaded and the schematic world has the chunk. Each position is classified as Litematica's `checkBlockStates` does (honouring `ignoreCropAge`, `ignoreExistingFluids`, the ignore-existing-blocks list and the placement verifier's ignored mismatches, if that verifier exists). Wrong blocks, wrong states and "different block" matches all count as *wrong*, i.e. not placed. An ignored mismatch is accepted (placed, or nothing for schematic air). Schematic air with a world block is *extra*, shown only as "N to clear". Litematica's render-layer verifier range is not applied: the whole placement is compared.
- **Cache:** results per chunk, for the last four placements by hash ID; a fingerprint change (schematic, origin, rotation, mirror, enabled sub-regions and their placement) starts that placement over. `ClientLevel.setServerVerifiedBlockState` (`BlockChangeMixin`, the hook Litematica uses) and Fabric chunk loads mark already-scanned chunks for a rescan; a marked chunk keeps its last result until it is ready again. Leaving the world clears the cache.
- **Materials:** for each state, (schematic count − placed count) converted to items with `MaterialCache` as `MaterialListUtils.convertStatesToStacks` does (waterlogged blocks add a water bucket; flower pots and cauldrons need several items). *Have* sums MinePanel's own inventory snapshot (36 slots and offhand, plus shulker box and bundle contents); it never affects placed/total.
- A selected but disabled placement is treated as no placement. Litematica's own verifier and material-list tasks are never started, so MinePanel adds no HUD renderers or chat messages.

Porting to a new Minecraft version: bump `litematica_version`/`malilib_version` in `gradle.properties`, compare `LitematicaBuildSource` against the new `LTS/<version>` branch using the API table in [the plan](IMPLEMENTATION_PLAN.md), fix compile errors and re-run the manual checks.
