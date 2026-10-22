# Downloads the newest MinePanel release JAR from GitHub into a Minecraft instance's mods folder,
# replacing any earlier MinePanel JAR there.
#
#   powershell -ExecutionPolicy Bypass -File scripts\download-latest-release.ps1 -ModsDir "D:\Minecraft\Instances\ATM10\minecraft\mods" -Loader neoforge -Minecraft 1.21.1
#
# -ModsDir defaults to the MINEPANEL_MODS_DIR environment variable. Each release has one JAR per loader and Minecraft
# version (MinePanel-v<version>-<loader>-mc<minecraft>.jar); -Loader (fabric or neoforge, default fabric) and
# -Minecraft (default 26.1.2) pick one.
param(
    [string]$ModsDir = $env:MINEPANEL_MODS_DIR,
    [ValidateSet('fabric', 'neoforge')]
    [string]$Loader = 'fabric',
    [string]$Minecraft = '26.1.2',
    [string]$Repo = 'Craftyplayz/MinePanel'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $ModsDir) {
    throw 'Pass -ModsDir <mods folder> or set MINEPANEL_MODS_DIR.'
}
if (-not (Test-Path -LiteralPath $ModsDir -PathType Container)) {
    throw "Mods folder does not exist: $ModsDir"
}

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'MinePanel-downloader' }
$asset = $release.assets | Where-Object { $_.name -like "MinePanel-v*-$Loader-mc$Minecraft.jar" } | Select-Object -First 1
if (-not $asset) {
    throw "Release $($release.tag_name) has no MinePanel JAR for $Loader $Minecraft attached."
}

$destination = Join-Path $ModsDir $asset.name
if (Test-Path -LiteralPath $destination) {
    Write-Output "Already up to date: $($asset.name)"
    exit 0
}

# Download first, then remove old copies, so a failed download leaves the old JAR in place.
$temp = "$destination.part"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $temp -UseBasicParsing
Get-ChildItem -LiteralPath $ModsDir -File | Where-Object { $_.Name -match '^(?i)minepanel-.*\.jar$' } | Remove-Item -Confirm:$false
Move-Item -LiteralPath $temp -Destination $destination
Write-Output "Installed $($release.tag_name): $destination"
