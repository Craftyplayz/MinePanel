# Rules

[Home](Home.md) › Rules

Rules change the dashboard automatically based on what's happening in game. A rule says: **When** these conditions are true, **Then** do these things (and optionally, **Else** do these other things).

Examples of what rules can do:

- Show the map nearly full screen while you fly with an elytra.
- Switch to a "Nether" layout in the Nether.
- Show the activity log and hide pickups when hostile mobs are close.
- Warn you when your tool is about to break.
- Show the AFK panel after two minutes away.

Rules only change what the dashboard shows. They never do anything in game.

## Opening the rules editor

Click **M** (top left) to enter Customize mode, then **Rules…** in the toolbar.

The editor covers most of the screen. **Side panel** in its header docks it beside the live dashboard instead, which you need for the preview, the inspector and placing panels on the grid. **Done** closes it.

Every change is checked and saved immediately. If an edit isn't valid yet (for example a number out of range), it stays in the editor and the error is shown in the header until you fix it.

## Your first rule

Show the Experience panel only while you're gaining XP:

1. Click **M**, then click the **Always** button on the Experience panel's title bar so it reads **Rules only**. The panel disappears, and its neighbours fill the space.
2. Click **Rules…**, then **+ New rule**. Name it "XP while gaining".
3. Under **When**, click **+ AND condition** and choose **Gained XP** (in the Amounts group). Set it to `≥ 1` with a window of `10` seconds.
4. Under **Then**, click **+ Action**, choose **Show panel** and pick **Experience**.
5. Click **Done**, then **Done** again to leave Customize mode.

Now the Experience panel slides in when you pick up XP and slides out a couple of seconds after you stop.

This exact rule is also a [template](Rule-Sets.md#templates): **From template → XP while gaining**.

## How a rule decides

### Conditions, AND and OR

**When** is a list of conditions. Each one after the first is joined to the one above it with **AND** or **OR**.

- AND binds tighter than OR, so `A and B or C and D` means `(A and B) or (C and D)`.
- Each OR starts a new **block**, drawn as its own box. The rule **matches** when every condition in at least one block is true.
- A rule with no conditions never matches (the editor warns you).

Each condition can also have:

- **Not**: inverts it.
- **For N s**: it only counts as true once it has been true without a break for N seconds. Good for "haven't moved for 30 s".
- **Within N s**: it counts as true if it was true at any moment in the last N seconds. Good for "took damage in the last 10 s". Events (died, advancement earned, …) always use Within.

A condition takes For or Within, not both. Both are 1–3600 seconds.

### Unknown is never true

Sometimes a condition can't be worked out, for example on the title screen, or before the server has sent statistics. It's then **unknown**, and an unknown condition is **never true, even with Not**. So "not in the Nether" doesn't fire on the title screen.

Outside a world, every condition is unknown except Toggle, Rule active, Dashboard width, Real-world time and In game.

### Delay and linger

A rule that matches becomes **active** through its **Timing**:

| Setting | Default | What it does |
|---|---|---|
| **Delay** | 0 ms | How long the rule must match before it becomes active |
| **Linger** | 2000 ms (minimum 500) | How long it stays active after it stops matching |

Linger stops panels blinking when a value hovers around a threshold. For rules that detect a farm from a kill or item rate, use a long linger such as 20 000 ms so the layout stays up through short gaps.

While a rule is **active**, its **Then** actions apply. While it's enabled but **not active**, its **Else** actions apply. A disabled rule does nothing.

Rules are checked every time the game sends new data (see [Update rate](Customizing.md#update-rate)) and once a second in between, so timings are accurate to about a second.

### Priority: higher rules win

The order of the rule list is the priority, highest first. Each action **claims** something: the profile, a panel's visibility, a panel's position and size, which panel is focused, or one panel setting.

- When two active rules claim the same thing, the higher rule wins and the other is **overridden**.
- Claims on different things combine. One rule can switch the profile while another hides a panel in it.

Reorder rules with **↑** and **↓**.

## What happens on the dashboard

1. The **base layout** is the profile from the winning Switch profile action, or Default.
2. **Hide** hides panels and **Show** shows them. Show only works on a panel that is **Always** or **Rules only** in that profile; a panel that's off stays off.
3. **Place** and **Swap** move panels.
4. The layout settles:
   - The space a hidden panel leaves is filled by a neighbour whose edge matches it exactly, or by several neighbours that together cover it. Otherwise the panels below slide up. A Hide action can choose differently.
   - A panel that's shown or placed over others makes them shrink, down to their minimum size. Anything that still doesn't fit is pushed down.
5. Setting changes are applied on top of the profile's settings.
6. Every change **animates**. After a rule changes a panel, rules can't change that panel again for 1 second, so nothing flickers.

**Focus** is separate: the focused panel grows to cover nearly the whole dashboard, and the others fade out where they are without moving. When focus ends, it shrinks back to its place, or fades away if it isn't otherwise shown. Only one panel can be focused at a time.

If your system asks for **reduced motion**, panels cross-fade instead of sliding.

## The editor

### Rule list (left)

- Rules in priority order. A **dot** marks each rule that's active right now; an outlined dot means it's being previewed.
- **↑ / ↓** reorder rules.
- **+ New rule**, **+ Folder**, **From template** and **Import / export**.
- Below the rules: **Places**, **Toggles**, **Settings** and the **activity log**.

### A rule (right)

- **Name**, **Enabled**, **Folder**, **Duplicate**, **Share** and **Delete**.
- **Preview**: **Auto**, **Force on** or **Force off**. This only affects this browser and ends when you close the editor. Use it to see what a rule does without setting up the situation in game.
- **When**: one row per condition, added with **+ AND condition** or **+ OR condition**. The type list is grouped by family (World, Position, Player, …). Each row has an AND/OR choice, Not, its parameters and the For/Within modifier. Each row shows its **live value** (for example "speed 4.3 b/s") and a green (true) or red (false) edge, and each block shows whether it's true as a whole.
- **Then** and **Else** action lists, added to with **+ Action**.
- **Timing**: delay, linger, and an optional animation of its own.

### Pickers

Fields that take an item, block, mob, effect, biome or statistic have a searchable picker with names and icons. **+ current** fills in where you are (world, dimension or biome) and **+ held** fills in the item in your hand. On a **Near** condition, **+ here** fills in your position.

### Inspector

With the editor docked as a **Side panel**, click any panel on the dashboard to see every rule that claims it, what each one claims, and which claim won.

### Place on grid

On a **Place panel** action, **Set on grid** docks the editor and draws an outline of the panel on the live grid. Drag the outline to move it, drag its corner to resize it, then **Set** (or **Cancel**, or press Escape).

### Copy and paste

Tick condition or action rows, click **Copy**, open another rule and click **Paste**. Conditions paste into When, actions into Then or Else.

### Activity log

The editor lists the most recent rule activations and deactivations with times. It's kept in memory only and clears when you close the dashboard.

## Places

A **place** is a saved, named location for the **Near place** condition, for example "Base" or "Trading hall".

- Make one in the **Places** section; **+ Current position** saves where you're standing, in this world and dimension.
- A place only counts **in the world and dimension it was saved in**.
- Up to 64 places.

## Toggles

A **toggle** is an on/off switch you flip by hand. Use one in a **Toggle** condition, for example to turn a "Building" mode on and off.

- Make toggles in the **Toggles** section with **+ Toggle**. Flip them from the **Toggles** dropdown in the Customize toolbar, which also has **All off**.
- Their state is saved, so it survives restarts.
- Up to 16 toggles.

## Folders

Folders group rules.

- A folder's **checkbox** turns all of its rules on or off; **▸ / ▾** collapses it.
- A folder's rules stay together in the list. ↑/↓ on a folder moves the whole folder; ↑/↓ on a rule moves it within its folder.
- Deleting a folder keeps its rules, just without a folder.
- Up to 32 folders.

## Global settings

**Settings** in the editor sets the default **animation** (duration 0–5000 ms, default 300, and easing) used for every rule that doesn't have its own.

## Limits

| What | Limit |
|---|---|
| Rules | 128 |
| Conditions per rule | 32 |
| Actions | 16 in Then and 16 in Else |
| Values in one list (dimensions, effects, …) | 32 |
| Profiles | 16 besides Default |
| Folders / places / toggles | 32 / 64 / 16 |
| Whole saved layout | 256 KB |

## Tips

- **Start from a template.** [Templates](Rule-Sets.md#templates) cover the common cases.
- **Set panels a rule shows to Rules only**, or Show does nothing visible.
- **Use For or Delay** against noisy values, and **Within or Linger** to keep a panel up for a while after something happens.
- **Don't use = on decimals** (speed, distance). Use *between*.
- **Put important rules first.** A low-health warning should beat an elytra map.
- **Use Force on** in the preview to check a rule's actions without setting it up in game.

See [Rule conditions](Rule-Conditions.md) and [Rule actions](Rule-Actions.md) for everything a rule can test and do.
