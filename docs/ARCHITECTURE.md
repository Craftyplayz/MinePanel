# Architecture

MinePanel is a client-only Fabric mod, a loopback-only local service, and a static browser application embedded in the mod JAR. Minecraft APIs belong in the client adapter; the browser consumes versioned snapshots and never issues gameplay mutations.

The client adapter owns lifecycle and reads Minecraft state on the client thread. It copies state into immutable snapshots before publishing to bounded background service workers. The service serves only bundled resources and narrowly scoped authenticated read-only data. Optional integrations are separate adapters; absence or failure is reported as unavailable and does not prevent startup.

Gameplay events, open/last-viewed containers, and pins exist only in active-session memory. Chat is not retained. Dashboard layout/preferences may persist separately from gameplay data.

Client tick sampling is capped at four samples per second, suppresses unchanged values, and writes immutable versioned position/dimension/health snapshots into an atomic store. The browser WebSocket receives a full initial snapshot followed by changed-field deltas and reconnects after disconnect. HTTP state access uses a bearer token; the browser session endpoint sets the same random per-server token as an HttpOnly cookie for WebSocket authentication, never in a URL. Both listeners bind to IPv4 loopback; Host and Origin are checked, WebSocket handshakes and frames are bounded, and only read-only paths/frames are supported. No network, disk, or expensive calculation belongs on the Minecraft tick/render thread.

Current player fields are position, dimension ID, health, maximum health, absorption, and active-session duration. Vanilla statistics, inventory/equipment, and player-action events are not yet implemented. The health/absorption/maximum-health and dimension-ID call patterns are cross-checked against the official Fabric API 26.1.2 source, but the target client has not been compiled or run in Minecraft in this restricted environment.

JourneyMap is the only map source; MinePanel does not render terrain. Litematica completion is based on verified placement state, never carried inventory. Their compatible versions, APIs, and iframe behavior remain unverified until tested against Minecraft 26.1.2.
