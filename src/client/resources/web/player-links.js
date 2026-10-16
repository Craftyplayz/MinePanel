"use strict";

// Websites that can tell you more about the signed-in player, opened from the player head in the inventory tile.
// Plain data: features.js draws the menus. Nothing here is fetched; a site is only contacted when a link is clicked.
//
// A site either has one `url` or several `pages` (which open a picker). URLs fill in {name} (the account name),
// {uuid} (32 hex digits) and {uuidDashed}; sites that need a UUID are greyed out for offline-mode accounts, whose UUID
// no lookup service knows. `servers` lists the server domains a site is suggested on, at the top of the menu.

const PLAYER_LINK_GROUPS = [
  {
    id: "profile", name: "Profile & history", description: "Who the account is, past names, skins and servers",
    sites: [
      { name: "NameMC", domain: "namemc.com", url: "https://namemc.com/profile/{name}",
        description: "Name history, skins, capes and favourite servers" },
      { name: "MCIndex", domain: "mcindex.gg", url: "https://mcindex.gg/player/{name}",
        description: "Skin history, capes and stats from supported servers" },
      { name: "MC.dawg.bot", domain: "mc.dawg.bot", url: "https://mc.dawg.bot/player/{name}",
        description: "UUID, 3D skin viewer and name history" },
      { name: "MinecraftCapes", domain: "minecraftcapes.net", url: "https://minecraftcapes.net/profile/{name}",
        description: "Capes and ears from the MinecraftCapes mod" },
      { name: "Minecraft-Statistic", domain: "minecraft-statistic.net",
        url: "https://minecraft-statistic.net/en/player/{name}.html",
        description: "Servers the player has recently logged into, with play time" },
      { name: "MCUUID", domain: "mcuuid.net", url: "https://mcuuid.net/?q={name}",
        description: "Converts the name to its UUID and back" }
    ]
  },
  {
    id: "renders", name: "Skins & renders", description: "Pictures of the skin from mc-heads.net",
    sites: [
      { name: "2D face", domain: "mc-heads.net", url: "https://mc-heads.net/avatar/{uuid}",
        description: "The flat front of the face, with the hat layer" },
      { name: "2D face without hat", domain: "mc-heads.net", url: "https://mc-heads.net/avatar/{uuid}/nohelm",
        description: "The bare face, without the hat layer" },
      { name: "3D head", domain: "mc-heads.net", url: "https://mc-heads.net/head/{uuid}",
        description: "The head as a cube, turned to the right" },
      { name: "3D head (left)", domain: "mc-heads.net", url: "https://mc-heads.net/head/{uuid}/left",
        description: "The head as a cube, turned to the left" },
      { name: "3D body", domain: "mc-heads.net", url: "https://mc-heads.net/body/{uuid}",
        description: "The whole body, turned to the right" },
      { name: "3D body (left)", domain: "mc-heads.net", url: "https://mc-heads.net/body/{uuid}/left",
        description: "The whole body, turned to the left" },
      { name: "2D full body", domain: "mc-heads.net", url: "https://mc-heads.net/player/{uuid}",
        description: "Flat front view of the whole body" },
      { name: "2D full body without hat", domain: "mc-heads.net", url: "https://mc-heads.net/player/{uuid}/nohelm",
        description: "Flat front view of the body, without the outer skin layer" },
      { name: "Face and body", domain: "mc-heads.net", url: "https://mc-heads.net/combo/{uuid}",
        description: "A large face with a small full body in the corner" },
      { name: "Skin file", domain: "mc-heads.net", url: "https://mc-heads.net/skin/{uuid}",
        description: "The raw 64×64 skin texture" },
      { name: "Download skin", domain: "mc-heads.net", url: "https://mc-heads.net/download/{uuid}",
        description: "Saves the skin texture as a PNG file" }
    ]
  },
  {
    id: "hypixel", name: "Hypixel", description: "Network stats, guilds and SkyBlock",
    sites: [
      { name: "Plancke", domain: "plancke.io", url: "https://plancke.io/hypixel/player/stats/{name}",
        description: "Stats for every Hypixel game, plus guild and rank", servers: ["hypixel.net"] },
      { name: "25Karma", domain: "25karma.xyz", url: "https://25karma.xyz/player/{name}",
        description: "Player and guild stats in a compact layout", servers: ["hypixel.net"] },
      { name: "Sk1er", domain: "sk1er.club", url: "https://sk1er.club/stats/{name}",
        description: "Hypixel stats and leaderboard positions", servers: ["hypixel.net"] },
      { name: "SkyCrypt", domain: "sky.shiiyu.moe", url: "https://sky.shiiyu.moe/stats/{name}",
        description: "SkyBlock profiles: gear, skills, collections and networth", servers: ["hypixel.net"] },
      { name: "Hypixel forum posts", domain: "hypixel.net",
        url: "https://www.google.com/search?q=site%3Ahypixel.net+%22{name}%22",
        description: "Searches the Hypixel forums for the name (through Google)" }
    ]
  },
  {
    id: "pvp", name: "PvP & other servers", description: "Rankings and stats on other servers",
    sites: [
      { name: "EloTiers", domain: "elotiers.com", url: "https://elotiers.com/profile/{name}",
        description: "PvP rating, clan and match records" },
      { name: "2B2Tiers", domain: "2b2tiers.org", url: "https://2b2tiers.org/player/{name}",
        description: "2b2t PvP: kills, deaths, streaks and ELO", servers: ["2b2t.org"] },
      { name: "Wynncraft", domain: "wynncraft.com", url: "https://wynncraft.com/stats/player/{name}",
        description: "Wynncraft characters, levels and guild", servers: ["wynncraft.com"] }
    ]
  },
  {
    id: "data", name: "Raw data (JSON)", description: "The account's data as the lookup services return it",
    sites: [
      { name: "Mojang API", domain: "mojang.com", description: "Mojang's own public account lookups", pages: [
        { name: "Name → UUID", url: "https://api.mojang.com/users/profiles/minecraft/{name}",
          description: "The account's current name and UUID" },
        { name: "Profile and skin", url: "https://sessionserver.mojang.com/session/minecraft/profile/{uuid}?unsigned=false",
          description: "The profile with its skin and cape texture links (base64 encoded)" }
      ] },
      { name: "PlayerDB", domain: "playerdb.co", url: "https://playerdb.co/api/player/minecraft/{name}",
        description: "Name, UUID and skin links in one readable response" }
    ]
  },
  {
    id: "search", name: "Search the web", description: "Mentions of the name elsewhere",
    sites: [
      { name: "Google", domain: "google.com", url: "https://www.google.com/search?q=%22{name}%22+minecraft",
        description: "Pages that mention the name alongside Minecraft" },
      { name: "Reddit", domain: "reddit.com", url: "https://www.reddit.com/search/?q=%22{name}%22",
        description: "Posts and comments that mention the name" },
      { name: "GitHub", domain: "github.com", description: "Accounts and code that mention the name", pages: [
        { name: "Users", url: "https://github.com/search?q={name}&type=users",
          description: "GitHub accounts with a matching name" },
        { name: "Code", url: "https://github.com/search?q=%22{name}%22&type=code",
          description: "Code that mentions the name, like server configs and plugins" }
      ] },
      { name: "Internet Archive", domain: "web.archive.org",
        url: "https://web.archive.org/web/*/namemc.com/profile/{name}*",
        description: "Old saved copies of the NameMC profile" }
    ]
  }
];

/** Offline-mode accounts get a name-based (version 3) UUID that no lookup service knows. */
const isOfflineUuid = uuid => typeof uuid === "string" && uuid[14] === "3";

/** Whether a site, or one page of it, needs a UUID to work. */
const needsUuid = target => target.url ? target.url.includes("{uuid") : target.pages.every(page => page.url.includes("{uuid"));

function playerLinkUrl(template, identity) {
  return template.replaceAll("{name}", encodeURIComponent(identity.name))
    .replaceAll("{uuidDashed}", identity.uuid)
    .replaceAll("{uuid}", identity.uuid.replaceAll("-", ""));
}

/** The sites worth putting first on this server ("mc.hypixel.net:25565" matches "hypixel.net"). */
function suggestedPlayerLinks(world) {
  if (world?.kind !== "server") return [];
  const host = world.name.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return PLAYER_LINK_GROUPS.flatMap(group => group.sites).filter(site =>
    site.servers?.some(domain => host === domain || host.endsWith(`.${domain}`)));
}
