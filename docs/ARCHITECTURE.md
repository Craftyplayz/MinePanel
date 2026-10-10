# Architecture

MinePanel is a client-only Fabric mod, a loopback-only local service, and a static browser application embedded in the mod JAR. Minecraft APIs belong in the client adapter; the browser consumes versioned snapshots and never issues gameplay mutations.

The client adapter owns lifecycle and reads Minecraft state on the client thread. It copies state into immutable snapshots before publishing to bounded background service workers. The service serves only bundled resources and narrowly scoped authenticated read-only data. Optional integrations are separate adapters; absence or failure is reported as unavailable and does not prevent startup.

Future gameplay events, open/last-viewed containers, and pins will be session-only; none are implemented yet. Chat is not retained. Configurable layouts/preferences remain outstanding.

Client tick sampling is capped at four samples per second, suppresses unchanged values, and writes immutable versioned position/dimension/health snapshots into an atomic store. The browser WebSocket receives a full initial snapshot followed by changed-field deltas and reconnects after disconnect. HTTP state access uses a bearer token; the browser session endpoint sets the same random per-server token as an HttpOnly cookie for WebSocket authentication, never in a URL. Both listeners bind to IPv4 loopback; Host and Origin are checked, WebSocket handshakes and frames are bounded, and only read-only paths/frames are supported. No network, disk, or expensive calculation belongs on the Minecraft tick/render thread.

Current player fields include position, dimension ID, health, maximum health, absorption, active-session duration, and inventory/equipment. Vanilla statistics and player-action events remain outstanding. The target client has not been compiled or run in Minecraft in this environment.

## Inventory and equipment protocol

Schema version 1 is extended additively with `inventory`. Older consumers may ignore that field. An available inventory contains exactly 36 indexed `slots`: 0–8 are hotbar, 9–35 are main inventory. `selectedHotbarSlot` is 0–8. `equipment` has `head`, `chest`, `legs`, `feet`, `offhand`, and `mainhand`. Mainhand is the same immutable value as the selected hotbar item, so the summary and slot cannot disagree.

Each item contains `empty`, registry `itemId`, readable `name`, `count`, `maxCount`, `damage`, `maxDamage`, derived `remainingDurability`, and `enchantments` (`id`, readable `name`, `level`). Empty items have null identity/name/durability, zero counts, and no enchantments. Non-damageable items have null durability rather than fabricated zero durability. Only explicit value records cross the thread boundary; arbitrary Minecraft objects/components are not serialized.

Initial messages contain a complete snapshot. Updates include `baseRevision` (the last revision sent to that connection); revisions can skip because sampling coalesces changes. Inventory updates carry only changed `{index,item}` slot entries, a changed selection, and changed equipment keys. Unchanged inventory is omitted entirely. Availability transitions carry all fields, with `inventory:null` on world disconnect. The browser validates and applies a complete update atomically; missing/wrong baselines or unsupported schemas close the socket and reconnect for a fresh full snapshot. Transport disconnect clears displayed live values, not merely the connection badge.

The client samples at most four times per second and compares lightweight immutable values. Network serialization and writes occur only on service workers; inventory is not serialized every tick. The adapter reads only on the client tick thread, retaining no player/world/screen references after the sample. Brief changes between samples can be missed. Browser rendering updates changed slot nodes using text, never item-provided HTML. Item sprites, inventory actions, and warning rules are not implemented.

MinePanel exposes no slot-click, equip, consume, item-move, or inventory-changing packet operation. Its inventory adapter only reads stacks. HTTP and WebSocket threads never read live Minecraft objects.

Applied and stored/book enchantment components are merged by registry ID with the higher level and sorted for stable comparisons. Readable text is bounded to 256 UTF-16 units without splitting surrogate pairs; controls are replaced and malformed Unicode is repaired. Metadata exceeding the bounded protocol invariants makes the sample unavailable rather than crashing gameplay or publishing partially copied inventory; a generic warning is logged once, without item contents.

JourneyMap is the only map source; MinePanel does not render terrain. Litematica completion is based on verified placement state, never carried inventory. Their compatible versions, APIs, and iframe behavior remain unverified until tested against Minecraft 26.1.2.
