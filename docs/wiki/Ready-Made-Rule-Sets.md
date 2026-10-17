# Ready-made rule sets

[Home](Home.md) › [Rules](Rules.md) › Ready-made rule sets

Rule set files you can import as they are, or use as a starting point. Each one adds a few rules, and most add a profile (a panel arrangement) for them to switch to. They all live in the repository's [`rule-sets`](https://github.com/Craftyplayz/MinePanel/tree/main/rule-sets) folder.

## Importing one

1. Click the file's **Download** link below and save it (in most browsers: right-click → **Save link as…**).
2. In the dashboard, open **Rules → Import / export** and click **Choose file…**.
3. Leave **Replace** unticked, so your own rules and profiles stay.

Things to know:

- **Imported rules go to the bottom of your rule list**, so they lose every conflict with your existing rules. Move them up with **↑** in the rules editor if they should win. Importing several files in the order listed on this page gives the priority they were made with.
- **Importing the same file again adds its rules a second time.** To update one, first delete its old rules (or its folder) in the rules editor, then import the new file. Its profile is updated in place, and its toggle is kept.
- The layouts are sized for a maximised browser on a 1920 × 1080 monitor: 12 columns and 18 rows. On a different screen, adjust them in [Customize](Customizing.md).

For how imports work in detail, see [Templates and rule sets](Rule-Sets.md#import--export).

## The rule sets

| File | What it does |
|---|---|
| [Default screen](#default-screen) | Notifies you and switches to the Default profile when you're not in a world |
| [AFK screen](#afk-screen) | Switches to an AFK layout after 2 minutes AFK |
| [Hide idle movement](#hide-idle-movement) | Hides Movement after 30 s standing still |
| [Raid farm](#raid-farm) | A raid farm layout while you're killing pillagers |
| [Nether farms](#nether-farms) | Wither skeleton and piglin farm layouts while those farms run |
| [Advancement hunting](#advancement-hunting) | A toggle-controlled layout built around the Advancements panel |
| [Trading](#trading) | A big Villager trades layout in a trading hall |

---

## Default screen

**File:** `default-screen.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/default-screen.json)

| | |
|---|---|
| Rules | **default screen** |
| When | Not connected to a world |
| Then | Notifies "Not Currently in a world" (at most every 5 s) and switches to the **Default** profile |
| Adds profiles | None. It uses your own Default |

Put it at the **top** of your rule list, so no other profile stays up on the title screen.

## AFK screen

**File:** `afk-screen.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/afk-screen.json)

| | |
|---|---|
| Rules | **AFK screen** |
| When | AFK for 2 minutes or more |
| Then | Switches to the **AFK** profile |
| Adds profiles | **AFK**: AFK down the left third, 3D render, Performance and Inventory in the middle, Advancements down the right third. Inventory hides the armor slots and the 3D render spins at 120° a second |

Keep it high in the list, so it wins over farm and other layouts while you're away.

## Hide idle movement

**File:** `idle-movement.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/idle-movement.json)

| | |
|---|---|
| Rules | **Hide idle movement** |
| When | Standing still for 30 s |
| Then | Hides Movement. Its neighbours grow into the space |
| Adds profiles | None. It works in every profile |

This is the same as the **Hide idle movement** template.

## Raid farm

**File:** `raid-farm.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/raid-farm.json)

| | |
|---|---|
| Rules | **Raid farm** |
| When | 30 or more pillagers killed in 30 s |
| Then | Switches to the **Raid farm** profile, and stays for 20 s after the kills stop |
| Adds profiles | **Raid farm**: Experience, Inventory, Performance and Player on the left, Activity log in the middle, Statistics on the right |

Statistics shows pillager, vindicator, evoker and witch kills, diamond sword uses, distance walked, deaths, mob kills and player kills. Experience and Performance average over 10 minutes, and Inventory hides the armor slots.

## Nether farms

**File:** `nether-farms.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/nether-farms.json)

| | |
|---|---|
| Rules | **Wither skeleton farm**, **Piglin farm** |
| When | 15 or more wither skeletons killed in 120 s; or 30 or more zombified piglins killed in 30 s |
| Then | Switches to that farm's profile, and stays for 20 s after the kills stop |
| Adds profiles | **Wither skeleton farm** and **Piglin farm**, both arranged like Raid farm |

- **Wither skeleton farm** Statistics: wither skeleton kills, netherite sword uses, distance walked, deaths and mob kills. Experience averages over 10 minutes.
- **Piglin farm** Statistics: zombified piglin kills, netherite sword uses, mob kills, chicken kills and piglin kills. Experience averages over 5 minutes, with a goal of level 6767.
- In both, Performance averages over 10 minutes, and Inventory hides the armor slots.

## Advancement hunting

**File:** `advancement-hunting.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/advancement-hunting.json)

Turn it on with the **Advancement hunting** button in the **Toggles** dropdown (Customize toolbar).

| | |
|---|---|
| Adds | The **Advancement hunting** toggle, profile and folder |
| Rules | **Advancement hunting layout**, **Hunting: villagers at a trading hall**, **Hunting: no villagers away from a hall**, **Hunting: hide movement when still** |
| Needs | The [JourneyMap](Integrations.md#journeymap) map for the top-left panel |

The layout, in thirds:

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ JourneyMap    │ │ Advancements  │ │ Inventory     │
│               │ │ (full height) │ │               │
│               │ │               │ ├───────┬───────┤
├───────┬───────┤ │               │ │ Stats │Pickups│
│Movemnt│Player │ │               │ │       │       │
├───────┴───────┤ │               │ ├───────┴───────┤
│ Performance   │ │               │ │ Experience    │
└───────────────┘ └───────────────┘ └───────────────┘
```

- **At a trading hall** (6 or more known villagers within 24 blocks, for 3 s), Statistics and Recent pickups are replaced by **Villager trades**. They come back 20 s after you leave.
- **Standing still for 15 s** hides Movement, and Player widens into its space. It comes back about a second after you move.

Rules elsewhere in your list that show Villager trades (such as the **Villagers while trading** template) can pull it into view while you hunt. Move the **Advancement hunting** folder above them.

## Trading

**File:** `trading.json` · [Download](https://raw.githubusercontent.com/Craftyplayz/MinePanel/main/rule-sets/trading.json)

| | |
|---|---|
| Rules | **Trading hall** |
| When | 5 or more known villagers within 10 blocks, for 3 s |
| Then | Switches to the **Trading Panel** profile and shows Villager trades, and stays for 20 s after you leave |
| Adds profiles | **Trading Panel**: a large Villager trades panel at the top left, with Player and Recent pickups on the right, and Inventory, Activity log and Experience below. Experience averages over 5 minutes |

"Known" villagers are ones MinePanel has seen or traded with. If you use [Advancement hunting](#advancement-hunting) too, keep this rule **below** its folder, so the hunting layout stays in a trading hall.
