# Rule actions

[Home](Home.md) › [Rules](Rules.md) › Rule actions

Actions go in a rule's **Then** list (applied while the rule is active) or **Else** list (applied while it's enabled but not active). Each rule can have up to 16 of each. The same actions are allowed in both.

When two rules' actions claim the same thing, the rule higher in the list wins (see [Priority](Rules.md#priority-higher-rules-win)).

| Editor name | Id (`do`) | What it does |
|---|---|---|
| [Switch profile](#switch-profile) | `profile` | Use another profile as the base layout |
| [Show panel](#show-panel) | `show` | Show a panel |
| [Hide panel](#hide-panel) | `hide` | Hide a panel |
| [Place panel](#place-panel) | `place` | Move and resize a panel |
| [Swap panels](#swap-panels) | `swap` | Two panels trade places |
| [Focus panel](#focus-panel) | `focus` | Blow a panel up to nearly full screen |
| [Set panel setting](#set-panel-setting) | `set` | Change one of a panel's settings |
| [Notify](#notify) | `notify` | Show a short message |

## Switch profile

Uses a [profile](Customizing.md#profiles) as the base layout. Every other action applies on top of it. With no Switch profile winning, the base is Default.

Use this for big changes (a "Nether" or "Phone" arrangement) and the other actions for small ones.

## Show panel

Shows a panel. Its neighbours shrink to make room (down to their minimum size), and anything that still doesn't fit is pushed down.

> **Show only works on panels that are Always or Rules only in the profile in use.** A panel that's off in the profile stays off. Set the panel to **Rules only** in [Customize](Customizing.md#always-or-rules-only) to have it hidden until the rule shows it.

## Hide panel

Hides a panel. **Fill** chooses what happens to its space:

| Fill | Result |
|---|---|
| **Auto** (default) | Neighbours grow into the space: one whose edge matches it exactly, or several that together cover it. Otherwise the panels below slide up |
| **Empty** | The space stays blank, and nothing moves into it |
| A specific panel | That panel takes the space. It grows over it if that makes a neat rectangle, and otherwise moves into it |

## Place panel

Moves and resizes a panel in one go. Click **Set on grid** to drag an outline of the panel on the live dashboard: drag to move, drag the corner to resize, then **Set**. You can also type the column (x, 0–11), row (y), width (w, up to 12 columns) and height (h).

Panels it overlaps shrink away from it, and its old spot is filled as if it had been hidden.

## Swap panels

The two panels trade places and sizes.

## Focus panel

Draws the panel above everything else, covering nearly the whole dashboard. The other panels fade out where they are, without moving. When focus ends, the panel shrinks back to its place, or fades away if it isn't shown in the grid.

- Focus works even on a panel that's **off** or hidden, so a panel you only ever want focused can stay off.
- Only one panel is focused at a time. The highest rule wins.

## Set panel setting

Changes one panel setting while the rule applies, using the panel's own controls. When the rule stops applying, the setting goes back to the profile's value.

| Panel | Setting | Values |
|---|---|---|
| Inventory | Show armor | on / off |
| Statistics | Shown, Recent excluded, Recent lifetime, Recent rows | statistic lists; 0–3600 s; 1–32 |
| JourneyMap | Map address | a `127.0.0.1` or `localhost` address |
| Movement | Show vertical speed, Show elytra | on / off |
| Experience | Window, Goals | 10 s – 1 h; up to 8 levels |
| Performance | Window | 10 s, 30 s, 1 min, 10 min |
| Recent pickups | Lifetime, Rows, Show source, Ignored | 0–3600 s; 1–32; on/off; item list |
| Advancements | Pop-up seconds, Hidden tabs, Pinned | 0–300; lists |
| 3D render | Spin, Axis, Speed | on/off; turntable / head over heels / cartwheel; 15–120 °/s |
| AFK | Text size, Speed, Hidden | 11–32 px; slow / normal / fast / very fast; statistic list |

See [Panels](Panels.md) for what each setting does and its default.

Example: an Else action **Experience → Window → 5 min** with a When of "in the Nether" gives you a long XP average everywhere except the Nether.

## Notify

Shows a message at the bottom right of the dashboard for 6 seconds. No sound, ever.

| Setting | Values |
|---|---|
| Text | 1–128 characters |
| Cooldown | 0–3600 seconds: the least time between two showings of this message |

In **Then**, it fires once when the rule becomes active. In **Else**, once when the rule stops being active. It doesn't repeat while the rule stays active.

## Animation

Every change animates using the global animation (**Rules → Settings**, default 300 ms *ease-out*). A rule's **Timing** section can give it its own duration (0–5000 ms) and easing (*linear*, *ease*, *ease-in*, *ease-out*, *ease-in-out*), used for the panels it shows, hides, moves or focuses.
