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

Progress requires a supported Litematica version, Malilib, and an active schematic placement with accessible placement data. An unavailable indicator does not mean the schematic is complete.

Minecraft 26.1.2 compatibility, optional integration APIs, and browser embedding behavior have not yet been confirmed; see [the implementation plan](IMPLEMENTATION_PLAN.md).
