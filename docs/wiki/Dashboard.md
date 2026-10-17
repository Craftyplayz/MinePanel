# The dashboard

[Home](Home.md) › The dashboard

## Opening it

When you join a world, MinePanel posts a clickable link in chat. The dashboard is at **<http://127.0.0.1:57262/>**. If something else on your PC already uses that port, MinePanel picks a free one instead, so always use the link from chat if the usual address doesn't load.

- It only works **on the same PC** as Minecraft. Phones and other computers can't reach it.
- You can open it in several tabs or browsers at once. Each one is live.
- Leaving it open between sessions is fine: it reconnects on its own when the game starts again.

## The M button and the connection dot

The **M** button at the top left does two things:

- Its **dot** shows the connection: green when the dashboard is connected to the game, red when it isn't (game closed, or reconnecting). Hover over the button to see the status in words.
- Clicking it opens **Customize** mode (see [Customizing the layout](Customizing.md)).

While disconnected, panels show **Unavailable** or "—" rather than old values. When you're on the title screen or between worlds, most panels say they're waiting for a world.

## Panels

The dashboard is a grid of **panels** (sometimes called tiles). Each has a title bar with its name, a status badge and sometimes buttons:

| Control | Meaning |
|---|---|
| Badge (grey or coloured text on the right) | The panel's state: *Unavailable*, a count, *AFK*, … |
| **⚙** | The panel's own settings |
| **↗** | Open in a new browser tab (map panel) |
| Clickable chips such as **60 s** or **1 min** | Pick a time window (Experience, Performance) |

Panels **compact themselves when small**. Less important details disappear first, so a small panel still shows its key numbers. For example, a short Inventory panel shows only the hotbar.

See [Panels](Panels.md) for every panel.

## Item tooltips

Hover over any item (inventory, pickups, materials, villager trades) to see its full in-game tooltip, including enchantments, lore and the advanced details you'd see with F3+H (item ID, durability, component count). Icons are drawn by the game itself, so resource packs and modded items look the same as in game. They are shown without the enchantment glint.

## Item windows

Click a **shulker box** or **bundle** in the Inventory panel to open a window showing what's inside. The **ender chest** slot in the Inventory panel opens your ender chest's contents.

- A window follows the item: if you move the shulker box to another slot it still shows the same box, and it says so if the item is gone.
- Shulker boxes inside the ender chest open their own windows.
- **📌 Pin** keeps a window open. You can have several pinned windows; only one unpinned window is open at a time. Pinned windows are remembered with your layout.
- **×** closes a window.
- The ender chest shows what it held **the last time you opened it in game**, with how long ago that was. Until you open it once in a world, it asks you to.

## Player menu

Click your **player head** to open a menu of websites about your account, grouped by kind:

- **Profile & history**: name history, past skins, servers you've played on (NameMC and others)
- **Skins & renders**: pictures of your skin
- **Hypixel**: network stats, guilds and SkyBlock
- **PvP & other servers**: rankings on other servers
- **Raw data (JSON)**: what the lookup services return
- **Search the web**: mentions of your name

Each entry has a line saying what it shows. Some sites have several pages and ask which one you want. **Nothing is sent to any of these sites until you click a link.**

## Toggles

If you've made [toggles](Rules.md#toggles) for your rules, flip them from the **Toggles** dropdown in the [Customize toolbar](Customizing.md#the-toolbar) (click **M**, then **Toggles**). Click one to flip it on or off; **All off** turns every toggle off. Their state is saved, so it survives restarting the game.

## Notifications

Rules can show short messages at the **bottom right**. Each one stays for 6 seconds, at most four are shown at once, and they never make a sound.

## Advancement pop-ups

When you earn an advancement, it pops up on the dashboard for 10 seconds by default. You can change or turn this off in the [Advancements panel settings](Panels.md#advancements).
