# Files and privacy

[Home](Home.md) › Files and privacy

## What leaves your PC

Nothing, unless you click a link.

- The dashboard is served **only to your own PC** (`127.0.0.1`). Other devices on your network can't reach it.
- MinePanel has no account, cloud service, analytics or tracking.
- It doesn't read or keep chat.
- The [player menu](Dashboard.md#player-menu) links to outside websites, but nothing is sent to them until you click one.
- The JourneyMap panel only loads the address you give it, which must be on your own PC.

Nothing on the dashboard can change your game: there's no way to move items, send chat or run commands from it.

## Files MinePanel saves

Paths are relative to your Minecraft instance's game directory (the folder with `mods` and `saves`).

| Path | What's in it |
|---|---|
| `config/minepanel/layout.json` | Your whole dashboard: panels, profiles, settings, pinned windows, update rate and rules |
| `config/minepanel/layout.v1-backup.json` | A copy of a layout from an older MinePanel version, made once when it was upgraded. Never overwritten |
| `config/minepanel/layout.rejected.json` | A copy of a layout file that couldn't be read, made before anything replaces it |
| `config/minepanel/worlds/` | Per world or server: the villagers you've traded with, your ender chest's last-seen contents, and the last-seen contents of up to 64 [backpacks](Integrations.md#sophisticated-backpacks) you opened |
| `minepanel/history/<session start>.jsonl` | The full activity log of each session, one event per line |

### Deleting data

- **Activity history:** delete the files in `minepanel/history/`. The dashboard's Activity log only shows the current session anyway.
- **One villager:** click **×** on it in [Villager trades](Panels.md#villager-trades).
- **All villagers, ender chests and backpacks:** delete `config/minepanel/worlds/` while the game is closed.
- **Your whole layout:** delete `config/minepanel/layout.json` while the game is closed. You'll start with the default dashboard. Consider **Download all rules** first (see [Import / export](Rule-Sets.md#import--export)).

## What your browser keeps

The dashboard remembers two small things in your browser (not in the game folder):

- names of items, statistics, biomes and other ids it has seen, so the rule editor's pickers can suggest them
- whether the Link portal guide was open

Clearing the site's data in your browser removes them; your layout and rules are unaffected.
