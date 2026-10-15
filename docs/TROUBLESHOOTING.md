# Troubleshooting

## Dashboard does not load

Use the loopback URL printed by the running client, not a LAN address. Check whether another local application or firewall policy prevents binding. Restart Minecraft to obtain a new ephemeral port. If the local service fails, gameplay should continue normally.

## Inventory unavailable or reconnecting

Inventory is unavailable outside an active world and is cleared when the browser loses its connection. A bad schema or revision baseline triggers a reconnect for a full snapshot, never a partial stale inventory. Empty slots are explicitly labelled; item sprites are not bundled, so names and registry IDs are the current visual fallback. Inventory is inspection-only.

## Release build fails before compilation

Use Java 25 and run `./gradlew releaseBuild --no-daemon --stacktrace --info`. Inspect the plugin-resolution exception and underlying repository access, not only the final failure line. An unresolved Loom marker does not itself prove the pinned plugin is incompatible. Preserve the official dependency pins unless concrete compatibility evidence says otherwise. An offline build needs cached Loom, Minecraft, Loader, and API artifacts, not just the Gradle distribution. See [testing](TESTING.md) for this environment's recorded diagnosis.

## JourneyMap map is unavailable

JourneyMap Webmap is a separate client addon. Confirm both compatible mods are installed and Webmap is enabled in JourneyMap settings. Use the actual endpoint displayed by Webmap; MinePanel cannot assume its port. Some browser/server policies disallow embedding; open the map directly in a separate tab instead.

## Litematica progress is unavailable

The tile's message says why:

- *Install Litematica…* — Litematica is not loaded. Install Litematica 0.27.14+ and MaLiLib 0.28.12+.
- *This Litematica version is not supported* — the installed Litematica is older than the version in MinePanel's `fabric.mod.json` `suggests` entry; the game log names it.
- *Build progress stopped after an error* — Litematica's API did not behave as expected (for example a newer release changed it). The game log has one warning with the stack trace; the tile stays off until the game restarts. Gameplay is not affected.
- *No placement selected in Litematica* — select a placement (and keep it enabled) in Litematica's placement list.

"N chunks not checked yet" means those chunks of the placement have not yet been loaded together with every chunk around them and Litematica's schematic world (which Litematica fills only near you) since you joined: walk near them once. Checked chunks keep their counts when you walk away. Progress is reset when you leave the world. An unavailable indicator does not mean the schematic is complete.

Minecraft 26.1.2 compatibility, optional integration APIs, and browser embedding behavior have not yet been confirmed; see [the implementation plan](IMPLEMENTATION_PLAN.md).
