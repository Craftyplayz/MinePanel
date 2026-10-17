# Templates and rule sets

[Home](Home.md) › [Rules](Rules.md) › Templates and rule sets

Three ways to get rules without building them from scratch: **templates** built into the editor, **share strings** for passing a rule to someone, and **rule set files** that can hold a whole dashboard setup.

## Templates

In the rules editor, click **From template** and pick one. It's added as a new rule you can change.

| Template | When | Then | Before using it |
|---|---|---|---|
| XP while gaining | Gained XP ≥ 1 within 10 s | Show Experience | Set Experience to Rules only |
| Hide idle movement | Standing still, for 30 s | Hide Movement | — |
| AFK screen | AFK for ≥ 2 min | Focus AFK | — (Focus works even though AFK is off by default) |
| Villagers while trading | Villager trading screen open, or 3+ known villagers within 16 blocks | Show Villager trades | Set Villager trades to Rules only |
| Portal guidance | Linking a portal (10 min) | Show Player, notify "Portal target set" | Set Player to Rules only to see it only then |
| Elytra map | Moving by elytra, for 3 s | Focus JourneyMap | Set up the [map](Integrations.md#journeymap) |
| Tool about to break | Held item durability < 10 % | Notify (at most once a minute) | — |
| Combat | 3+ hostile mobs within 16 blocks | Show Activity log, hide Recent pickups | Set Activity log to Rules only |
| Pickups while looting | Picked up anything within 15 s | Show Recent pickups | Set Recent pickups to Rules only |
| Phone layout | Dashboard width < 700 px | Switch profile | Pick your phone-sized profile under Then |

"Set X to Rules only" is done in [Customize](Customizing.md#always-or-rules-only). Without it the panel is always shown, so Show has nothing to do.

## Share strings

To give a rule or a whole folder to someone else:

1. Open the rule (or folder) and click **Share**.
2. Copy the line of text that appears. It starts with `minepanel-rules:1:`.
3. They open **Rules → Import / export**, paste it into the box and click **Import**.

A shared rule brings along any rules it depends on (through *Rule active*), plus the places and toggles it uses. Importing **adds**: it never overwrites existing rules.

- A place identical to one you already have is reused, and so is a toggle with the same name.
- A *Switch profile* action goes to your profile with the same name. If you don't have one, that action is left out.
- A shared folder arrives as a new folder.

## Import / export

**Rules → Import / export** has everything for moving rules and whole setups around:

| Control | What it does |
|---|---|
| Text box + **Import** | Imports a share string or a rule set's JSON pasted into the box |
| **Choose file…** | Imports a rule set `.json` file |
| **Replace all rules, folders, places and toggles (and profiles, if the file has any)** | Tick before importing to throw away your current rules (and profiles the file doesn't mention) and use the file's instead. It unticks itself after each import |
| **Download all rules** | Saves your whole setup, every profile with its panels and settings plus every rule, folder, place and toggle, as `minepanel-rules.json` |

**Download all rules**, then importing that file with **Replace** ticked, gives you exactly the same dashboard back. That makes it the best way to back up your setup or copy it to another PC.

### What an import tells you

- On success, it lists what was added and any **warnings**: fields it didn't recognise (often a typo), actions or conditions it had to leave out, and panels that ended up somewhere other than the file said. **Read the warnings**: a misspelled optional field is otherwise silently ignored.
- On failure, **nothing is imported**, and the error names the rule and the condition or action at fault, for example `Rule "Low health": condition 2: compare: invalid value`.

### Replace vs add

| | Without Replace | With Replace |
|---|---|---|
| Rules, folders, places, toggles | Added after yours, with new ids | Yours are removed; the file's are used with their own ids |
| Profiles named like yours (or "Default") | Changed to the file's version | Changed to the file's version |
| Profiles only in the file | Added | Added |
| Your profiles the file doesn't mention | Kept | Removed (only if the file defines any profiles; Default always stays) |
| Update rate, pinned windows, global animation | Kept | Kept |

## Rule set files

A rule set is a JSON file holding rules and, optionally, folders, places, toggles and **profiles** (panel arrangements and settings). One file can set up an entire dashboard. Here's a small one:

```json
{
  "format": "minepanel-rules",
  "version": 1,
  "rules": [
    {
      "name": "Map while flying",
      "when": [{ "type": "movement", "values": ["elytra"], "for": 3 }],
      "then": [{ "do": "focus", "panel": "map" }]
    }
  ]
}
```

The ids to use are listed in [Panels](Panels.md#overview) (panels and their settings), [Rule conditions](Rule-Conditions.md) (condition types) and [Rule actions](Rule-Actions.md) (action ids). The **complete file format**, with every field, limit and a full worked example, is in the [rule set reference](https://github.com/Craftyplayz/MinePanel/blob/main/docs/RULE_SETS.md).

### Example rule sets

The MinePanel repository has ready-to-import rule sets in its [`rule-sets`](https://github.com/Craftyplayz/MinePanel/tree/main/rule-sets) folder: farm layouts, an AFK screen, advancement hunting, trading and more. [Ready-made rule sets](Ready-Made-Rule-Sets.md) lists every one, what it does and how to import it.

### Writing rule sets with an AI assistant

The rule set format was designed to be easy for an AI assistant to write:

1. Click **Download all rules** to capture your current setup (optional).
2. Give the assistant the [rule set reference](https://github.com/Craftyplayz/MinePanel/blob/main/docs/RULE_SETS.md) and your file, and describe what you want.
3. Import its file, with **Replace** if it's a whole setup.
4. If the import fails or warns, paste the message back to the assistant.
