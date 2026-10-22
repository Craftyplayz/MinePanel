# MinePanel roadmap

Planned panels and integrations, in suggested order. Nothing here is built unless its status says so. The research was done on the ATM10 To the Sky pack (NeoForge 1.21.1) by inspecting the mod jars with `javap`. None of it has been tried in game.

MinePanel is client-only and read-only (see `ARCHITECTURE.md`). Every item below reads only data the server already sends to the client. MinePanel never sends a packet to ask for more.

| # | Item | Status | Effort |
|---|---|---|---|
| 1 | [AE2 crafting jobs panel](#1-ae2-crafting-jobs-panel) | Built, not tested in game | Rules still to do |
| 2 | [Curios in the Inventory panel](#2-curios-in-the-inventory-panel) | Built, not tested in game | Testing only |
| 3 | [Sophisticated Storage in the Backpacks panel, several panels](#3-sophisticated-storage-and-several-backpacks-panels) | Planned | 1–2 days |
| 4 | [More integrations](#4-more-integrations) | Candidates | Per item |

## 1. AE2 crafting jobs panel

A panel listing the player's AE2 crafting jobs, with live stats from the crafting CPUs. This would be NeoForge 1.21.1 only (AE2 19.x).

### What the client can see

The server keeps every job (`ExecutingCraftingJob` in `CraftingCpuLogic`, saved in the crafting CPU's block entity NBT). The client only gets the following.

| Data | Packet / field | When it arrives |
|---|---|---|
| Job started, finished, cancelled: item, requested amount, job UUID | `CraftingJobStatusPacket` → `appeng.client.gui.me.common.PendingCraftingJobs.jobStatus(UUID, AEKey, long, long, Status)` | Always. It is sent only to the player who started the job. `remainingAmount` is not updated while the job runs |
| CPU list: `serial`, `name`, `storage`, `coProcessors`, `mode`, `currentJob` (null when idle), `progress` (0–1), `elapsedTimeNanos` | `CraftingStatusMenu.cpuList` (`@GuiSync(8)`, record `CraftingCpuList` of `CraftingCpuListEntry`); `selectedCpuSerial` (`@GuiSync(9)`) | Only while the **Crafting Status** screen is open. It refreshes about once a second |
| Selected CPU detail: `elapsedTime`, `remainingItemCount`, `startItemCount`, `suspended`, per item `stored` / `active` / `pending` | `CraftingStatusPacket`, a delta merged into `CraftingCPUScreen.status` by `postUpdate(CraftingStatus)` | Only while that screen is open. The client drops the packet otherwise |

Nothing lets the client get CPU data without the screen. Opening it sends `SwitchGuisPacket.openSubMenu(CraftingStatusMenu.TYPE)`, and MinePanel must not send that itself. The player can open the screen from a wireless terminal (AE2, ae2wtlib), so remote checking still works by hand.

AdvancedAE quantum computers send the same `CraftingJobStatusPacket`. `QuantumComputerMenu.cpuList` mirrors the AE2 fields (its own `CraftingCpuListEntry` type). ExtendedAE, MEGA Cells and ae2wtlib don't change crafting sync.

### What was built

- **Code:**
  - Facade `Ae2` and the isolated package `dev.craftyplayz.minepanel.ae2`, which `isolatedMods` in `gradle/shared.gradle` enforces with `'ae2': 'appeng.'`.
  - `compileOnly maven.modrinth:ae2:19.2.17` in `build.neoforge.gradle`.
  - Snapshot field `ae2` (`Ae2Snapshot`).
  - Panel id `crafting`, labelled **AE2 crafting**.
- **Job list:** `PendingCraftingJobsMixin` (HEAD of `PendingCraftingJobs.jobStatus`) queues each notice. The panel keeps the last 16 jobs: item, amount, start time from the client clock, and result and time on finish or cancel.
- **CPU list and selected CPU:** read from `CraftingStatusMenu.cpuList` and `CraftingCPUScreenAccessor` (`status`) while the screen is open, then kept as last seen. The panel shows "Live" or "Seen 2m ago".
- **Mixin config:** the AE2 mixins live in their own `minepanel.ae2.mixins.json` (`required: false`, `defaultRequire: 0`). Its `Ae2MixinPlugin` applies them only when AE2 is loaded. Any failure turns the panel off for the session.
- **Decisions:**
  - Jobs stay in memory only and clear when you leave the world.
  - Quantum computers share the AE2 list, if AdvancedAE adds them to `getCpus()`. That is inferred; AdvancedAE's own Quantum Computer screen is not read.

### Not done yet

- A rule condition "crafting job finished" and a notification on finish or cancel.
- Elapsed time keeps the last seen value after the screen closes; it doesn't count on.
- Not tested in game.

## 2. Curios in the Inventory panel

**Status: built in the working tree, not committed and not tested in game** (`TESTING.md` lists it as not run).

What exists:

- `Accessories.java` (facade, NeoForge only, turns itself off on `LinkageError`) and `curios/CuriosSlots.java`. These read `CuriosApi.getCuriosInventory(player)` → `getCurios()` → `getStacks()`, keeping up to `MAX_ACCESSORIES = 32` worn items.
- `InventorySnapshot.accessories`, `protocol.js` `validateAccessories`, `#inventory-accessories` and `renderAccessories` in `app.js`. The row shows only while something is worn.
- `isolatedMods` has `'curios': 'top.theillusivec4.'`. The jar confirms Curios syncs slots to the client (`SPacketSyncCurios`, `SPacketSyncStack`).

Left to do:

1. Test in game: slot order, refresh rate, and a backpack worn in a Curios slot.
2. Optional: cosmetic slots (`getCosmeticStacks()`, about one line in `CuriosSlots`).
3. Optional: slot labels such as "ring". This needs a `slot` field per accessory, a `protocol.js` change and Java tests. Slot icons are at `assets/curios/textures/slot/empty_<id>_slot.png`.
4. Fabric (26.1.2, 1.21.1) has no Curios. Trinkets or Accessories (wispforest) would be the equivalent; neither has been looked at.

## 3. Sophisticated Storage and several Backpacks panels

### Is Sophisticated Storage similar enough? Yes

- Its screens use the same menu base as backpacks: `sophisticatedstorage.common.gui.StorageContainerMenu` (and `LimitedBarrelContainerMenu`) extend `sophisticatedcore.common.gui.StorageContainerMenuBase`, like `BackpackContainer`. `realInventorySlots` and `getStorageWrapper()` are on that base. Changing the capture-on-open code in `backpacks/SophisticatedBackpacks.java` to check `StorageContainerMenuBase` instead of `BackpackContainer` covers chests, barrels, limited barrels and shulker boxes.
- **Placed blocks:** contents live in the block entity on the server. The client's synced data (`StorageBlockEntity.saveSynchronizedData`) has no contents. On a server they are known only from the open screen ("remembered"). In singleplayer they could be read from the block entity on the server thread, but only in loaded chunks. There is no world-wide list like `BackpackStorage`.
- **Shulker boxes and packed chests as items:** these use the same `STORAGE_UUID` component as backpacks. Contents are in `ItemContentsStorage` saved data. The client copy (`clientStorageCopy`) is filled only by the mod's own tooltip request, so MinePanel can read it if present but must never send `RequestStorageContentsPayload`. Shulker box items have no access log, so there is no owner or name list.
- `ControllerBlockEntity` opens no inventory menu, so the controller is out.

### Design

- Same panel. Add a `kind` field to each entry (`backpack`, `chest`, `barrel`, `limited_barrel`, `shulker_box`) and consider renaming the panel **Storage**.
- Keys: the storage UUID for items; `dimension@x,y,z` (e.g. `minecraft:overworld@10,64,-3`) for placed blocks, which have no UUID until packed. `WorldStore.Backpack`, the UUID patterns in `LayoutStore` and `BackpacksSnapshot`, and `protocol.js` must accept both.
- All `net.p3pp3rf1y.*` code stays in the `backpacks` package (`litematicaIsolation`).

### Several panels, one per backpack or storage

Today each panel id can appear once in a layout. `normalizeLayout` (`TILE_IDS.includes`, `seen`) and `LayoutStore` ("unknown or duplicate tile") enforce this, and `TILE_MINIMUMS`, `tileOrder`, `TILE_VERSIONS`, rule targets and the fixed `#backpacks-*` elements all assume it.

Plan: add fixed extra panel ids `backpacks2`, `backpacks3`, `backpacks4`.

1. Add them to `TILE_IDS`, `TILE_MINIMUMS` (JS and `LayoutRules`), and `SETTING_RULES`, each with its own `settings.<id>.selected`.
2. Render the Backpacks panel per tile instead of into the fixed `#backpacks-*` elements.
3. `LayoutStore.backpackSelections()` reads every `backpacks*` setting. Raise `MAX_WATCHED_BACKPACKS` / `MAX_SHOWN` to fit.
4. Update `src/test/fixtures/layouts-v2.json`, `docs/RULE_SETS.md`, `wiki/Panels.md`, `wiki/Rule-Actions.md`.

Fully dynamic ids (`backpacks:<n>`) would need pattern checks everywhere above in JS and Java, plus a way for rules to name an instance. Only worth it if four panels is not enough.

## 4. More integrations

Ranked by player value and how easy they are. "Verified" means the class, field or packet handler was found in the jar. All NeoForge 1.21.1.

| # | Mod | What the client can read | Idea | Effort | Confidence |
|---|---|---|---|---|---|
| 1 | FTB Quests | `ClientQuestFile.INSTANCE.selfTeamData`: `getRelativeProgress`, `isCompleted`, `hasUnclaimedRewards`, `getPinnedQuestIds` | Pinned quests and chapter %, unclaimed-reward badge, rule "quest completed" | M | Verified |
| 2 | Energy items (Iron Jetpacks, Mekanism, others) | Iron Jetpacks `JETPACK_ENERGY` component; Mekanism `AttachedEnergy` / `AttachedChemicals`; generally NeoForge `Capabilities.EnergyStorage.ITEM` | Gear power bars, rule "jetpack energy < 20%" | S–M | Components verified; capability on client inferred |
| 3 | Mekanism radiation | `PacketPlayerRadiationData` → player attachment; `PacketEnvironmentalRadiationData` → `ClientRadiation` | Dose and area radiation, danger notification | S | Verified |
| 4 | Waystones | `PlayerWaystoneManager.getPlayerWaystoneData(CLIENT)` from `KnownWaystonesMessage`; cooldowns from `PlayerWaystoneCooldownsMessage` | Known waystones with distance; teleport cooldown; waystones as rule places | S | Verified (send timing unchecked) |
| 5 | FTB Teams | `ClientTeamManagerImpl.getInstance()`: members, online flag, own team | Team list, rule "teammate online" | S | Verified |
| 6 | FTB Chunks | `FTBChunksClientAPI.getWaypointManager().getAllWaypoints()`, `getNearestDeathpoint(player)` | Waypoint list, last death point, chunk owner | M | Waypoints verified; claims inferred |
| 7 | Gateways to Eternity | `GatewayEntity` synced data: `WAVE`, `ENEMIES`, `LIVES_REMAINING`, `WAVE_ACTIVE` | Gate tracker; rule "gateway nearby" switches profile | S–M | Verified |
| 8 | Apotheosis | Item components `AFFIXES`, `RARITY`, `SOCKETS`, `SOCKETED_GEMS`; `WorldTierPayload`; `BossSpawnPayload(pos, rarity)` | Rarity and gems in item windows, world tier, "boss spawned" notification | S–M | Verified |
| 9 | Apothic Attributes | Vanilla `player.getAttributes()` | Attributes panel (crit, life steal…) | S | GUI verified; full sync inferred |
| 10 | Ars Nouveau | `PacketUpdateMana` → `CapabilityRegistry.getMana(player)` | Mana bar, rule "mana low" | S | Verified |
| 11 | KubeJS | `SyncStagesPayload(stages)` | Rule condition "has stage" | S | Verified (pack use unknown) |
| 12 | SkyblockBuilder | `SkyblockDataUpdateHandler$Message` → `SkyblockSavedData.updateClient` | Island panel: team, members, spawn | M | Packet verified; contents inferred |
| 13 | Hostile Neural Networks | Components `DATA_MODEL`, `DATA`, `ITERATIONS` | Data model tier and progress | S | Verified |
| 14 | RFTools Utility | `PacketSendBuffsToClient(List<PlayerBuff>)` | Environmental controller buffs next to effects | S | Verified |
| 15 | Lootr | `IClientOpeners.hasClientOpened(player)` on Lootr block entities | "Unopened loot chests nearby" | M | Interface verified; scan inferred |

Not workable or low value:

- **Screen-only data:** Flux Networks (`ClientCache`, inferred), Occultism storage, Super Factory Manager, XNet. These could use the same "last seen" pattern as AE2 if wanted.
- **Need a client request MinePanel can't send:** Create train map, Dyson Cube Project.
- **Nothing useful on the client:** Powah, Mystical Agriculture, Jade.
- **Items only:** Silent Gear (`GearPropertiesData`) belongs in item windows.
- **Not traced:** Draconic Evolution shield points, Reliquary components, MekaSuit modules.
