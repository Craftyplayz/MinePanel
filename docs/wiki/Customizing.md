# Customizing the layout

[Home](Home.md) › Customizing the layout

Click the **M** button at the top left to enter **Customize** mode. A toolbar appears, and every change you make is saved immediately. Click **Done** to leave.

While you customize, **rules are paused** and you see the profile you're editing exactly as it's stored. When you click Done, rules take over again.

## The toolbar

| Part | What it does |
|---|---|
| Connection | Whether the dashboard is connected to the game |
| **Profile** | Which profile you're editing, its name, **New**, **Delete** and **Rules…** (see [Profiles](#profiles)) |
| **Tiles** | A dropdown with one button per panel. Click a panel to turn it on or off |
| **Toggles** | A dropdown with your rule [toggles](Rules.md#toggles). Click one to flip it; **All off** turns them all off. Shows how many are on, for example **Toggles (1 on)** |
| **Updates** | How often the game sends new data (see [Update rate](#update-rate)) |
| **Reset** | Put the profile you're editing back to the default arrangement and settings (asks first) |
| **Export** / **Import** | Save the whole layout to a file, or load one |
| **Done** | Leave Customize mode |

## Moving and resizing panels

- **Move:** drag a panel by its **title bar**.
- **Resize:** drag its **bottom-right corner**.

The dashboard is a grid **12 columns wide**. Columns share the window's width, and each row is 40 px tall with 10 px gaps. Panels snap to the grid and never overlap: panels in the way are pushed down, and every panel floats up as far as it can, so there are no empty gaps above a panel.

Every panel has a minimum size (listed in [Panels](Panels.md#overview)). Make a panel small and it hides its less important details; make it big and it shows everything.

## Turning panels on and off

Open the **Tiles** dropdown and click a panel's name to turn it on or off. The dropdown stays open so you can flip several; click anywhere else or press Escape to close it. A panel that's off keeps its spot for when you turn it back on.

## Always or Rules only

In Customize mode, each panel's title bar has a button that reads **Always** or **Rules only**. Click it to switch:

- **Always**: the panel is always shown.
- **Rules only**: the panel keeps its spot, but stays hidden until a [rule](Rules.md) shows it. While it's hidden, its neighbours grow into the space, and they give it back when a rule shows the panel.

A panel must be **Always** or **Rules only** (not off) in the profile in use for a rule's **Show** action to work. Use Rules only for panels you want to see only at certain times.

## Profiles

A **profile** is a complete arrangement: which panels are on, where they are, how big, and their settings.

- **Default** is the one used when no rule says otherwise.
- Other profiles are alternatives that a rule can switch to, for example "Nether", "Mining" or "Phone". See [Switch profile](Rule-Actions.md#switch-profile).

To manage profiles in Customize mode:

| Control | What it does |
|---|---|
| Profile drop-down | Pick which profile you're editing. The grid shows it |
| Name box | Rename the profile you're editing (1–64 characters) |
| **New** | Copy the current profile into a new one |
| **Delete** | Delete the profile you're editing (not Default) |

You can have up to **16 profiles** besides Default. **New** copies the profile you're editing, so start from the one closest to what you want.

Panel settings (⚙, and choices like the Experience window) are saved **per profile**: changing one changes it in the profile currently on screen. So if a rule has switched you to "Mining", a setting you change is saved in Mining, not Default.

## Update rate

**Updates** sets how often the game sends new player data to the dashboard:

| Choice | Interval |
|---|---|
| 20× per second | every game tick |
| 10× per second | every 2 ticks |
| **4× per second** (default) | every 5 ticks |
| 2× per second | every 10 ticks |
| 1× per second | every 20 ticks |

Faster looks smoother (speed, position, health) and costs a little more game-thread time. Rules are checked every time new data arrives, and once a second in between.

## Export, import and reset

- **Export** downloads your whole layout (all profiles, panel settings, pinned windows, the update rate and every rule) as a JSON file.
- **Import** loads such a file and **replaces** your current layout with it.
- **Reset** asks for confirmation, then puts the profile you're editing back to the default arrangement **and default panel settings**. Other profiles and your rules are left alone.

To share or back up only rules and profiles in a form you can read and edit, use **Rules → Import / export** instead (see [Templates and rule sets](Rule-Sets.md)).

## Several screens

Each browser tab shows the same saved layout. Rules that use **Dashboard width** are worked out per browser window, so a narrow window can switch to a different profile from a wide one.
