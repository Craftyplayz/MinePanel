# MinePanel Wiki

MinePanel is a second-screen dashboard for Minecraft. While you play, it shows your health, inventory, statistics, activity, experience rate, frame rate and more in a browser window. You can arrange it the way you like, and **rules** can change it automatically: a big map while you fly, the activity log during a fight, villager trades in a trading hall.

This wiki assumes MinePanel is already installed and running. It covers using and configuring it.

## Start here

1. Join a world. MinePanel posts a clickable link in chat.
2. Open it in a browser **on the same PC**. The address is normally **<http://127.0.0.1:57262/>**.
3. Move the browser window to your second monitor (or make it full screen).

The dashboard updates live. Nothing you do on it can change your game: it only reads.

## Pages

| Page | What it covers |
|---|---|
| [The dashboard](Dashboard.md) | Finding your way around: the connection indicator, tooltips, item windows, the player menu, toggles and notifications |
| [Customizing the layout](Customizing.md) | Moving, resizing, showing and hiding panels; profiles; update rate; exporting, importing and resetting |
| [Panels](Panels.md) | Every panel, what it shows and its settings |
| [Rules](Rules.md) | Making the dashboard react to the game: how rules work, the editor, timing, priority, places, toggles, folders |
| [Rule conditions](Rule-Conditions.md) | Every condition a rule can test |
| [Rule actions](Rule-Actions.md) | Every action a rule can take |
| [Templates and rule sets](Rule-Sets.md) | Ready-made rules, sharing rules, importing and exporting whole setups |
| [Ready-made rule sets](Ready-Made-Rule-Sets.md) | Every rule set file you can download and import: farms, AFK, advancement hunting, trading and more |
| [Integrations](Integrations.md) | JourneyMap web map, Litematica build progress, Curios slots, Sophisticated Backpacks, Sophisticated Storage, AE2 crafting and Ender Storage |
| [Files and privacy](Files-and-Privacy.md) | What MinePanel saves, where, and what leaves your PC |
| [Troubleshooting](Troubleshooting.md) | Common problems and questions |

## Quick reference

| I want to… | Do this |
|---|---|
| Rearrange the dashboard | Click the **M** button at the top left to enter **Customize**, drag a panel by its title bar, drag its bottom-right corner to resize, then click **Done** |
| Turn a panel on or off | In Customize, open **Tiles** and click its name |
| Change a panel's settings | Click the **⚙** in its title bar (not every panel has one) |
| Have a different layout for the Nether, farming, etc. | Make a [profile](Customizing.md#profiles) and a [rule](Rules.md) that switches to it |
| Show a panel only sometimes | Set it to **Rules only** in Customize and add a rule that shows it ([example](Rules.md#your-first-rule)) |
| See what's in a shulker box | Click it in the Inventory panel |
| Get directions to a villager | Click **Navigate** on it in Villager trades |
| Find where to build a linking Nether portal | Go through a portal, then click **Link portal** in the Activity log |
| Back up or move my whole setup | **Rules → Import / export → Download all rules**, then import it elsewhere with **Replace** ([details](Rule-Sets.md)) |

## Optional mods

MinePanel works on its own. Two panels need another mod:

- **JourneyMap** with its **Webmap** addon, for the [map panel](Integrations.md#journeymap).
- **Litematica** (with MaLiLib), or **Forgematica** (with MaFgLib) on NeoForge, for the [Build progress panel](Integrations.md#litematica-build-progress).

Both panels are off until you turn them on. On NeoForge, **Sophisticated Backpacks** adds [backpack contents](Integrations.md#sophisticated-backpacks) to item windows and fills the [Personal backpack](Panels.md#personal-backpack) and [Backpacks](Panels.md#backpacks) panels, and **Curios** adds your [extra slots](Integrations.md#curios) to the Inventory panel, and **Applied Energistics 2** fills the [AE2 crafting](Panels.md#ae2-crafting) panel, and **Ender Storage** fills the [Ender Storage](Panels.md#ender-storage) panels.

## Minecraft versions

MinePanel comes in three versions: **Fabric 26.1.2**, **Fabric 1.21.1** and **NeoForge 1.21.1**. Use the one that matches your game and mod loader. All three have the same panels, settings and rules, except the backpack, AE2 crafting and Ender Storage panels (see below). Items, armor, effects and entities from other mods show with the textures your game uses, including your resource packs. On 1.21.1 (Fabric and NeoForge), a few things differ because the game itself is older:

| What | On 1.21.1 |
|---|---|
| [Using an item](Rule-Conditions.md) condition | **Using a spear** and **bundle** never match: there are no spears yet, and bundles can't be used yet |
| [Build progress](Integrations.md#litematica-build-progress) panel | Needs Litematica 0.19.61 and MaLiLib 0.21.10 or newer (on NeoForge: Forgematica and MaFgLib 0.4.3 or newer). These have no option for ignoring crop age, so a crop at the wrong age counts as wrong |
| Backpacks | Only on NeoForge: [Sophisticated Backpacks](Integrations.md#sophisticated-backpacks) contents show in item windows. The [Personal backpack](Panels.md#personal-backpack) and [Backpacks](Panels.md#backpacks) panels (Backpacks 2 to 4 too) exist only on 1.21.1; on 26.1.2 they aren't in the **Tiles** list |
| AE2 crafting | The [AE2 crafting](Panels.md#ae2-crafting) panel exists only on 1.21.1, and shows anything only on NeoForge with [Applied Energistics 2](Integrations.md#applied-energistics-2) |
| Ender Storage | The [Ender Storage](Panels.md#ender-storage) panels (1 to 4) exist only on 1.21.1, and show anything only on NeoForge with [Ender Storage](Integrations.md#ender-storage) |

The 1.21.1 versions haven't been tested in game yet.
