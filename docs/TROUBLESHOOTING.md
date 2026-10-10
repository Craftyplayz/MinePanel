# Troubleshooting

## Dashboard does not load

Use the loopback URL printed by the running client, not a LAN address. Check whether another local application or firewall policy prevents binding. Restart Minecraft to obtain a new ephemeral port. If the local service fails, gameplay should continue normally.

## JourneyMap map is unavailable

JourneyMap Webmap is a separate client addon. Confirm both compatible mods are installed and Webmap is enabled in JourneyMap settings. Use the actual endpoint displayed by Webmap; MinePanel cannot assume its port. Some browser/server policies disallow embedding; open the map directly in a separate tab instead.

## Litematica progress is unavailable

Progress requires a supported Litematica version, Malilib, and an active schematic placement with accessible placement data. An unavailable indicator does not mean the schematic is complete.

Minecraft 26.1.2 compatibility, optional integration APIs, and browser embedding behavior have not yet been confirmed; see [the implementation plan](IMPLEMENTATION_PLAN.md).
