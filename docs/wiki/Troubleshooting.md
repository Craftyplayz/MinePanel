# Troubleshooting

[Home](Home.md) › Troubleshooting

## The dashboard

**The dashboard doesn't load.**
Use the link MinePanel posts in chat when you join a world. If port 57262 was busy when the game started, MinePanel used a different port, so the usual address won't work. Open it on the same PC as the game: `127.0.0.1` doesn't work from another device. Restarting the game picks the port again.

**The dot on the M button is red / everything says Unavailable.**
The dashboard isn't connected. It reconnects on its own once the game is running again. If it stays red with the game open, reload the page.

**Panels say "No active world" or are empty on the title screen.**
That's expected. Most panels need you to be in a world.

**Things update slowly or look jumpy.**
Raise the update rate: **M** → **Updates** → **10×** or **20× per second** ([Update rate](Customizing.md#update-rate)).

**I opened two dashboards and they look different.**
Rules that use *Dashboard width* or a **Force on/off** preview work per browser window, so this can happen on purpose.

## Panels

**A panel is missing.**
It may be off: **M** → open **Tiles** and click its name. If it's set to **Rules only**, it only appears when a rule shows it. The JourneyMap, Build progress and AFK panels are off by default.

**My panel moved or changed size on its own.**
A rule probably moved it, or made room for another panel. Open the rules editor as a **Side panel** and click the panel to see which rules claim it ([Inspector](Rules.md#inspector)).

**Statistics say Unavailable.**
The server hasn't sent statistics. Some servers restrict them. MinePanel keeps asking every few seconds and never shows a made-up zero.

**The ender chest is empty or says to open it.**
MinePanel only knows your ender chest's contents from the last time you opened it in this world. Open it once.

**A backpack says "Contents not known yet".**
On a server, MinePanel only knows a backpack's contents from the last time you opened it. Open it once. In singleplayer it fills in within a second or two. See [Sophisticated Backpacks](Integrations.md#sophisticated-backpacks).

**An Ender Storage chest says "Contents not known yet", or the panel lists only some chests.**
On a server, MinePanel only knows the Ender Storage chests you've opened, as they were when you last had them open. Open the chest once. In singleplayer every chest is listed and fills in within a second. See [Ender Storage](Integrations.md#ender-storage).

**The 3D render shows a default skin or nothing.**
Your skin may still be downloading; it appears once the game has it.

**The map panel says it's looking for the map.**
See [JourneyMap](Integrations.md#journeymap). Check Webmap is installed and enabled, and that the panel's ⚙ address matches the one Webmap uses. If the map won't show inside the panel, use **↗** to open it in a tab.

**Build progress says chunks aren't checked yet.**
Walk near those parts of the build once. See [Litematica build progress](Integrations.md#litematica-build-progress).

## Rules

**My rule never turns on.**
Open it in the editor and look at the When list: each condition shows its live value, green if true, red if false.

- A condition with no data is **unknown** and never counts as true, even with Not. Most conditions are unknown outside a world.
- An empty When list never matches.
- [On-demand](Rule-Conditions.md#on-demand-sensors) conditions only get data while the rule is enabled.
- The rule's **Delay** may not have passed yet, or its folder may be turned off.

**My rule is active but nothing changes.**

- **Show** only works on a panel that's **Always** or **Rules only** in the profile in use. Set the panel to Rules only in Customize.
- A higher rule may claim the same panel, setting or profile and win. Check the [inspector](Rules.md#inspector).
- Rules are paused while you're in **Customize** mode. Click **Done**.

**A panel blinks on and off.**
Raise the rule's **Linger**, add **For** to the condition, or use *between* instead of `=`. Speeds and distances rarely equal an exact number.

**A rule turns off too late.**
Lower its **Linger** (minimum 500 ms). Conditions using **Within** also stay true for their whole window.

**"Near" never matches.**
A place only counts in the world and dimension it was saved in. Re-save it with **+ Current position** while standing there.

**Amount conditions are slow to react.**
Statistic-based amounts can lag by about 10 seconds because the server sends statistics that often. *Gained XP*, *Picked up*, *Took damage* and *Mined*/*Placed* with "any block" react immediately.

**An import failed.**
Nothing was imported. The error names the rule and the condition or action at fault. Fix it and import again. If an import succeeded with warnings, read them: they often point to a typo. See [Import / export](Rule-Sets.md#import--export).

## Layout

**My layout was reset after an update or a crash.**
If MinePanel couldn't read your layout file, it saved a copy as `config/minepanel/layout.rejected.json` before starting with the default. A layout from an older MinePanel version is backed up as `layout.v1-backup.json` when it's upgraded. See [Files and privacy](Files-and-Privacy.md).

**The dashboard shows an error and won't save.**
An old layout couldn't be converted. Your file is untouched. Import a layout or rule set (or Reset) to continue.

**How do I back up or move my setup?**
**Rules → Import / export → Download all rules**. On the other PC, import it with **Replace** ticked.
