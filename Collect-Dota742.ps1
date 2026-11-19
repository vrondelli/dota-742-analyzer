#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'data/7.42')
)

$ErrorActionPreference = 'Stop'
$commit = '2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300'
$tree = 'game/dota/pak01_dir/scripts/npc'
$rawBase = "https://raw.githubusercontent.com/SteamTracking/GameTracking-Dota2/$commit/$tree"
$feed = 'https://www.dota2.com/datafeed'
$patchUrl = "$feed/patchnotes?version=7.42&language=english"
$heroUrl = "$feed/herolist?language=english"
$itemUrl = "$feed/itemlist?language=english"

$patch = Invoke-RestMethod $patchUrl -TimeoutSec 30
if (!$patch.success -or $patch.patch_number -ne '7.42' -or !$patch.heroes.Count -or !$patch.items.Count) {
    throw 'Valve did not return the 7.42 patch notes.'
}

$heroes = (Invoke-RestMethod $heroUrl -TimeoutSec 30).result.data.heroes
$items = (Invoke-RestMethod $itemUrl -TimeoutSec 30).result.data.itemabilities
if (!$heroes.Count -or !$items.Count) {
    throw 'Valve did not return both current identity lists.'
}

$heroById = @{}
foreach ($hero in $heroes) { $heroById[[int]$hero.id] = $hero }
$itemById = @{}
foreach ($item in $items) { $itemById[[int]$item.id] = $item }

function Get-ItemIndex($records) {
    foreach ($record in $records | Where-Object { $_.ability_id -gt 0 }) {
        $item = $itemById[[int]$record.ability_id]
        [ordered]@{
            id = $record.ability_id
            key = $item.name
            name = $item.name_loc
            note_count = @($record.ability_notes | Where-Object { $_.note -and !$_.hide_dot }).Count
        }
    }
}

$heroIndex = foreach ($record in $patch.heroes) {
    $hero = $heroById[[int]$record.hero_id]
    [ordered]@{
        id = $record.hero_id
        key = $hero.name
        name = $hero.name_loc
        changed_ability_ids = @($record.abilities | Where-Object { $_.ability_id -gt 0 } |
            Select-Object -ExpandProperty ability_id -Unique)
        hero_note_count = @($record.hero_notes | Where-Object { $_.note -and !$_.hide_dot }).Count
        talent_note_count = @($record.talent_notes | Where-Object { $_.note -and !$_.hide_dot }).Count
    }
}

$heroRoot = Invoke-WebRequest "$rawBase/npc_heroes.txt" -TimeoutSec 30
$heroPaths = [regex]::Matches($heroRoot.Content, '(?m)^\s*#base\s+"(heroes/[\w.-]+\.txt)"') |
    ForEach-Object { $_.Groups[1].Value }
if ($heroPaths.Count -ne 129) {
    throw "Expected 129 hero includes in build 6978, found $($heroPaths.Count)."
}

$paths = @('items.txt', 'neutral_items.txt', 'npc_abilities.txt', 'npc_ability_ids.txt', 'npc_units.txt') + $heroPaths
$files = @($paths | ForEach-Object -ThrottleLimit 10 -Parallel {
    $path = $_
    $response = Invoke-WebRequest "$using:rawBase/$path" -TimeoutSec 30 -MaximumRetryCount 2 -ErrorAction Stop
    [pscustomobject]@{ Path = $path; Bytes = $response.RawContentStream.ToArray() }
})
if ($files.Count -ne $paths.Count -or @($files | Where-Object { !$_.Bytes.Length }).Count) {
    throw 'The client snapshot download is incomplete.'
}
$files += [pscustomobject]@{ Path = 'npc_heroes.txt'; Bytes = $heroRoot.RawContentStream.ToArray() }

$itemFile = $files | Where-Object Path -eq 'items.txt'
$itemText = [Text.Encoding]::UTF8.GetString($itemFile.Bytes)
$removedShopItemIds = @($patch.items | Where-Object {
    $_.ability_notes.note -match '^Item removed from (the )?game\b'
} | Select-Object -ExpandProperty ability_id)
$itemsByKey = @{}
foreach ($item in $items) { $itemsByKey[$item.name] = $item }
$shopItems = foreach ($block in [regex]::Matches($itemText, '(?ms)^\t"(item_\w+)"\s*\{(.*?)^\t\}')) {
    $key = $block.Groups[1].Value
    $definition = $block.Groups[2].Value
    $item = $itemsByKey[$key]
    $cost = [int][regex]::Match($definition, '(?m)^\t\t"ItemCost"\s+"(\d+)"').Groups[1].Value
    if ($key.StartsWith('item_recipe_') -or !$item.name_loc -or $item.id -in $removedShopItemIds -or
        $item.neutral_item_tier -ge 0 -or $cost -le 0 -or
        $definition -match '(?m)^\t\t"ItemPurchasable"\s+"0"') {
        continue
    }
    [ordered]@{ id = $item.id; key = $key.Substring(5); name = $item.name_loc; cost = $cost }
}
if ($shopItems.Count -lt 100) {
    throw "Expected a shop catalog in build 6978, found $($shopItems.Count) items."
}

$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$suffix = [guid]::NewGuid().ToString('N')
$zipTemp = Join-Path $OutputDirectory "$suffix.zip"
$indexTemp = Join-Path $OutputDirectory "$suffix.json"
$shopTemp = Join-Path $OutputDirectory "$suffix.shop.json"
try {
    $zip = [IO.Compression.ZipFile]::Open($zipTemp, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files | Sort-Object Path) {
            $entry = $zip.CreateEntry("$tree/$($file.Path)")
            $entry.LastWriteTime = [DateTimeOffset]'2026-11-18T19:56:02Z'
            $stream = $entry.Open()
            try { $stream.Write($file.Bytes, 0, $file.Bytes.Length) }
            finally { $stream.Dispose() }
        }
    }
    finally { $zip.Dispose() }

    $index = [ordered]@{
        patch = '7.42'
        patch_feed = $patchUrl
        patch_feed_timestamp_utc = [DateTimeOffset]::FromUnixTimeSeconds($patch.patch_timestamp).ToString('o')
        catalog_sources = @($heroUrl, $itemUrl)
        catalog_fetched_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        client = [ordered]@{
            mirror = 'SteamTracking/GameTracking-Dota2'
            build = 6978
            commit = $commit
            file_count = $files.Count
            archive_sha256 = (Get-FileHash -LiteralPath $zipTemp -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        general_sections = @($patch.general_notes | ForEach-Object { $_.title })
        neutral_creep_records = $patch.neutral_creeps.Count
        heroes = @($heroIndex)
        items = @(Get-ItemIndex $patch.items)
        neutral_items = @(Get-ItemIndex $patch.neutral_items)
    }
    $index | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $indexTemp -Encoding utf8
    [ordered]@{
        patch = '7.42'
        client_build = 6978
        definition_source = "$rawBase/items.txt"
        name_source = $itemUrl
        removed_item_ids = $removedShopItemIds
        items = @($shopItems)
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $shopTemp -Encoding utf8
    Move-Item -LiteralPath $zipTemp -Destination (Join-Path $OutputDirectory 'client-6978.zip') -Force
    Move-Item -LiteralPath $indexTemp -Destination (Join-Path $OutputDirectory 'patch-index.json') -Force
    Move-Item -LiteralPath $shopTemp -Destination (Join-Path $OutputDirectory 'shop-items.json') -Force
}
finally {
    foreach ($temporaryFile in @($zipTemp, $indexTemp, $shopTemp)) {
        if (Test-Path -LiteralPath $temporaryFile -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryFile
        }
    }
}
