# Working on MinePanel

Instructions for AI agents (Claude Code, Codex and others) and human contributors.

MinePanel is a client-only Fabric mod (Minecraft 26.1.2, Java 25) that serves a read-only, loopback-only browser dashboard. Java collects game state into immutable snapshots; the dashboard (`src/client/resources/web/`, plain JS, no build step) renders them, and evaluates layout rules in the browser.

## Documentation map

| File | Audience | Holds |
|---|---|---|
| `docs/wiki/` | **Players** | The user wiki: how to use and configure every feature. No install or build steps |
| `docs/RULE_SETS.md` | Players and agents writing rule set files | Complete rule set JSON format. Its two `json` code blocks are imported by `dashboard.test.js` |
| `docs/ARCHITECTURE.md` | Developers | Protocol, threading, snapshot fields, integrations internals |
| `docs/RULES_V2.md` | Developers | Rules design, implementation status, handoff |
| `docs/IMPLEMENTATION_PLAN.md`, `docs/web-handover.md` | Developers | Plans, milestones, agreed decisions, session handover |
| `docs/TESTING.md` | Developers | Test commands and records of what was and wasn't verified |
| `docs/INSTALLATION.md`, `docs/TROUBLESHOOTING.md`, `README.md` | Developers / repo visitors | Install, build, release and developer-level troubleshooting |

## Keep the wiki up to date

**Any change that a player could notice must update `docs/wiki/` in the same change.** That includes:

- adding, removing or renaming a panel, setting, button, menu, dialog or message
- changing a default, limit, range or choice list
- adding or changing a rule condition, action, template or editor feature
- changing what MinePanel saves, where, or what it sends anywhere
- changing an integration's requirements or behaviour

Where to put it:

| You changed… | Update |
|---|---|
| A panel (anything in `index.html` tiles, `app.js`/`features.js` rendering, `SETTING_RULES`, `defaultLayout`, `TILE_IDS`, `TILE_MINIMUMS`) | `wiki/Panels.md` (the overview table and the panel's section); `wiki/Rule-Actions.md` settings table if it has a setting; `docs/RULE_SETS.md` Panels / Panel settings tables |
| Customize mode, profiles, update rate, layout import/export/reset | `wiki/Customizing.md` |
| Tooltips, item windows, player menu, toggles bar, notifications, connection indicator | `wiki/Dashboard.md` |
| Rule evaluation, timing, priority, the solver, the rules editor, places, toggles, folders | `wiki/Rules.md` |
| A condition type (`CONDITION_TYPES`, `CONDITION_LABELS`, `evaluateCondition`) | `wiki/Rule-Conditions.md` and `docs/RULE_SETS.md` Conditions |
| An action type (`ACTION_TYPES`, `normalizeAction`) | `wiki/Rule-Actions.md` and `docs/RULE_SETS.md` Actions |
| Templates (`RULE_TEMPLATES`), share strings, rule set import/export, `rule-sets/*.json` | `wiki/Rule-Sets.md` (and RULE_SETS.md if the format changed) |
| JourneyMap or Litematica behaviour | `wiki/Integrations.md` |
| Files written, browser storage, anything sent off the PC | `wiki/Files-and-Privacy.md` |
| A new common failure or a user-visible error message | `wiki/Troubleshooting.md` |
| A new wiki page | `wiki/Home.md` (Pages table) and `wiki/_Sidebar.md` |

Before finishing, grep the wiki for the old name, value or behaviour you changed and fix every hit.

### Wiki style

- Write for a player who already has the mod running and wants to use or configure it. **Never add installation, build, release or developer instructions to the wiki**; those belong in `README.md` and the other `docs/` files.
- Describe what the player sees and does. Use the exact labels from the UI, in **bold** (check `index.html`, `CONDITION_LABELS`, `ACTION_LABELS` and the `button(...)` calls in `features.js`). Give ids (`afk`, `showArmor`) only where rule set files need them.
- Check every fact against the code: defaults, ranges and choices come from `layout.js` (`SETTING_RULES`, `defaultSettings`, `*_CHOICES`, `MAX_*`). Don't copy from other docs without checking; they can be stale.
- Plain, short sentences; tables for settings and options; one topic per section. Start each page with the breadcrumb line (`[Home](Home.md) › …`). Link between pages with relative `Page.md#anchor` links; link to files outside `docs/wiki/` with full GitHub URLs, so the pages also work as a GitHub wiki.
- Be honest: if a feature isn't verified in game, a short note is fine; never claim behaviour the code doesn't have.

## Other rules

- Follow the constraints in `docs/ARCHITECTURE.md` and `docs/web-handover.md`: read-only, loopback-only, no gameplay mutation, nothing slow on the client thread, Litematica imports only in `dev.craftyplayz.minepanel.litematica`.
- Layout format changes go in **both** validators (`layout.js` `normalizeLayout` and `LayoutStore`/`LayoutRules` in Java) and in `src/test/fixtures/layouts-v2.json`.
- Docs must separate tested from unverified behaviour. Never claim in-game checks that weren't performed; record results in `docs/TESTING.md`.
- Checks: `node --test src/test/js/dashboard.test.js` for the dashboard; `./gradlew check` or `./gradlew releaseBuild` for everything.
