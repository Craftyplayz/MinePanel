# Architecture

MinePanel is a client-only Fabric mod, a loopback-only local service, and a static browser application embedded in the mod JAR. Minecraft APIs belong in the client adapter; the browser consumes versioned snapshots and never issues gameplay mutations.

The client adapter owns lifecycle and reads Minecraft state on the client thread. It copies state into immutable snapshots before publishing to bounded background service workers. The service serves only bundled resources and narrowly scoped authenticated read-only data. Optional integrations are separate adapters; absence or failure is reported as unavailable and does not prevent startup.

Gameplay events, open/last-viewed containers, and pins exist only in active-session memory. Chat is not retained. Dashboard layout/preferences may persist separately from gameplay data.

The initial service currently uses authenticated HTTP status polling; live WebSocket updates are not implemented. Transport authentication uses an unguessable per-server token in a header, not a URL, and enforces loopback binding, Host and Origin checks, bounded resource serving, and supported-operation validation. No network, disk, or expensive calculation belongs on the Minecraft tick/render thread.

JourneyMap is the only map source; MinePanel does not render terrain. Litematica completion is based on verified placement state, never carried inventory. Their compatible versions, APIs, and iframe behavior remain unverified until tested against Minecraft 26.1.2.
