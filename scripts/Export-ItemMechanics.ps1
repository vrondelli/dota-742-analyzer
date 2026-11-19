#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $PSScriptRoot '../data/7.42')
)

$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture
$index = Get-Content -LiteralPath (Join-Path $DataDirectory 'patch-index.json') -Raw | ConvertFrom-Json
$catalog = Get-Content -LiteralPath (Join-Path $DataDirectory 'shop-items.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $DataDirectory 'client-6978.zip'
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($index.patch -ne '7.42' -or $index.client.build -ne 6978 -or
    $catalog.patch -ne $index.patch -or $catalog.client_build -ne $index.client.build -or
    $archiveHash -ne $index.client.archive_sha256) {
    throw 'Expected the 7.42 shop catalog and its verified build 6978 archive.'
}

# Map fields used for held item bonuses. Ambiguous or conditional values are handled per item.
$flatFields = [ordered]@{
    bonus_damage = 'attackDamage'
    bonus_attack_speed = 'attackSpeed'
    bonus_strength = 'strength'
    bonus_agility = 'agility'
    bonus_intellect = 'intelligence'
    bonus_armor = 'armor'
    bonus_health = 'health'
    bonus_hp = 'health'
    bonus_magical_armor = 'magicResistance'
    bonus_spell_resist = 'magicResistance'
    bonus_spell_amp = 'spellAmp'
    spell_amp = 'spellAmp'
    bonus_health_regen = 'healthRegen'
    bonus_hp_regen = 'healthRegen'
    bonus_regen = 'healthRegen'
    bonus_mana = 'mana'
    bonus_mana_regen = 'manaRegen'
    bonus_mp_regen = 'manaRegen'
    bonus_movement_speed = 'moveSpeed'
}
$itemFields = @{
    ancient_janggo = @{ bonus_str = 'strength' }
    arcane_boots = @{ bonus_movement = 'moveSpeed'; mana_regen = 'manaRegen' }
    bloodthorn = @{ bonus_damage = $null }
    boots_of_bearing = @{ bonus_str = 'strength'; bonus_health_regen = $null }
    buckler = @{ armor = 'armor' }
    enchanted_mango = @{ hp_regen = 'healthRegen' }
    essence_distiller = @{ mana_regen = 'manaRegen' }
    guardian_greaves = @{ bonus_movement = 'moveSpeed'; mana_regen = 'manaRegen' }
    headdress = @{ health_regen = 'healthRegen' }
    heart = @{ hp_regen = $null }
    hurricane_pike = @{ bonus_attack_speed = $null }
    hydras_breath = @{ strength = 'strength'; agility = 'agility'; damage = 'attackDamage' }
    infused_raindrop = @{ mana_regen = 'manaRegen' }
    manta = @{ bonus_movement_speed = $null }
    pipe = @{ health_regen = 'healthRegen'; magic_resistance = 'magicResistance' }
    quarterstaff = @{ bonus_speed = 'attackSpeed' }
    rapier = @{ bonus_damage = $null; bonus_spell_amp = $null }
    ring_of_basilius = @{ mana_regen = 'manaRegen' }
    ristuls_devotion = @{ armor = 'armor'; mana_regen = 'manaRegen' }
    smoke_of_deceit = @{ bonus_movement_speed = $null }
    solar_crest = @{ self_movement_speed = 'moveSpeed' }
    specialists_array = @{ agility = 'agility'; damage = 'attackDamage' }
    swift_blink = @{ bonus_movement = $null }
    tranquil_boots = @{ bonus_movement_speed = $null; bonus_health_regen = $null }
    urn_of_shadows = @{ mana_regen = 'manaRegen' }
    vladmir = @{ armor = 'armor'; mana_regen = 'manaRegen' }
    wind_lace = @{ movement_speed = 'moveSpeed' }
}
$itemNotes = @{
    aghanims_shard = 'Hero-specific Shard upgrade requires its own ability model.'
    arcane_boots = 'Active mana restoration and movement speed stacking rules are outside this item model.'
    armlet = 'Held bonuses only. Unholy Strength, toggling, and health drain require a separate state.'
    basher = 'Bash, proc restrictions, and cooldown are outside this item model.'
    berserkers_sabatons = 'Held offensive bonuses only. Unholy Strength, health drain, phase, and movement speed depend on state.'
    bloodthorn = 'The conditional hit damage from Soul Rend and the accumulated damage burst are outside this item model.'
    bloodslinger = 'Assumes the target is hit and stays affected. Models the confirmed magical damage over time. The impact, health cost, and slow are outside this estimate.'
    boots_of_bearing = 'The Endurance active and its conditional movement and regeneration are outside this item model.'
    bracer = 'Uses listed held values. Any time-based item behavior needs its own model.'
    ethereal_blade = 'The active depends on the primary attribute, target state, and spell amplification.'
    heart = 'Regeneration is sensitive to health state. Strength is modelled.'
    hurricane_pike = 'The active grants target-specific attack speed, which is separate from the held stats.'
    manta = 'Illusions and percent movement speed require separate models.'
    moon_shard = 'Attack speed is for the held item. Consuming it changes the scenario.'
    phase_boots = 'Melee and ranged movement bonuses and the Phase active are outside this item model.'
    power_treads = 'Fixed attack speed only. The selected attribute and melee/ranged movement bonuses are scenario inputs.'
    rapier = 'Attack damage and spell amplification depend on the selected toggle state.'
    shivas_guard = 'Arctic Blast assumes the wave reaches the target. The slow and area scaling are separate.'
    swift_blink = 'Held agility only. Additional mobility and agility depend on the blink state.'
    tranquil_boots = 'Combat and out-of-combat states have different movement and regeneration.'
    ultimate_scepter = 'Held stat bonuses are modelled. The hero-specific Aghanim upgrade needs an ability model.'
    ultimate_scepter_2 = 'Consumed Aghanim upgrade needs a hero-specific ability model.'
    wraith_band = 'Uses listed held values. Any time-based item behavior needs its own model.'
    null_talisman = 'Uses listed held values. Any time-based item behavior needs its own model.'
}

# Read the KeyValues hierarchy so nested conditional bonuses never look like top-level stats.
$tokenPattern = [regex]::new('(?m)//[^\r\n]*|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+')

function Read-Properties([string[]]$tokens, [ref]$cursor) {
    $properties = [ordered]@{}
    while ($cursor.Value -lt $tokens.Count) {
        $key = $tokens[$cursor.Value]
        $cursor.Value++
        if ($key -eq '}') { return $properties }
        $value = $tokens[$cursor.Value]
        $cursor.Value++
        if ($value -eq '{') {
            $properties[$key.Trim('"')] = Read-Properties $tokens $cursor
        } else {
            $properties[$key.Trim('"')] = $value.Trim('"')
        }
    }
    return $properties
}

function Get-NumericValue($properties, [string]$key, [int]$tierIndex = 0) {
    $value = $properties[$key]
    if ($value -is [System.Collections.IDictionary]) { $value = $value['value'] }
    if ($null -eq $value) { return $null }
    $parts = $value -split '\s+'
    if ($tierIndex -ge $parts.Count) { return $null }
    $parsed = 0.0
    if ([double]::TryParse($parts[$tierIndex], [Globalization.NumberStyles]::Float, $culture, [ref]$parsed)) {
        return $parsed
    }
    return $null
}

function New-Aura($key, $name, $recipient, $radiusField, $statFields, $stackGroups = @{}, $blockedBy = @{}) {
    $modelledValues.Add($radiusField) | Out-Null
    $stats = [ordered]@{}
    foreach ($field in ($statFields.Keys | Sort-Object)) {
        $modelledValues.Add($field) | Out-Null
        $amount = Get-NumericValue $values $field
        if ($amount) {
            $stat = $statFields[$field]
            $stats[$stat] = if ($stat -eq 'armorReduction') { [math]::Abs($amount) } else { $amount }
        }
    }
    $groupsByStat = [ordered]@{}
    foreach ($stat in ($stackGroups.Keys | Sort-Object)) { $groupsByStat[$stat] = $stackGroups[$stat] }
    $blockedGroupsByStat = [ordered]@{}
    foreach ($stat in ($blockedBy.Keys | Sort-Object)) { $blockedGroupsByStat[$stat] = $blockedBy[$stat] }
    return [ordered]@{
        key = $key
        name = $name
        recipient = $recipient
        radius = Get-NumericValue $values $radiusField
        stats = $stats
        stackGroups = $groupsByStat
        blockedBy = $blockedGroupsByStat
    }
}

function Get-ItemAuras($key) {
    switch ($key) {
        'assault' {
            New-Aura 'assault-allies' 'Assault Aura' 'allies' 'aura_radius' @{
                aura_attack_speed = 'attackSpeed'; aura_positive_armor = 'armor'
            } @{ armor = 'assault-armor'; attackSpeed = 'assault-attack-speed' }
            New-Aura 'assault-enemies' 'Assault Aura' 'enemies' 'aura_radius' @{
                aura_negative_armor = 'armorReduction'
            } @{ armorReduction = 'assault-armor-reduction' }
        }
        'buckler' {
            New-Aura 'buckler' 'Buckler Aura' 'allies' 'bonus_aoe_radius' @{ bonus_aoe_armor = 'armor' } @{
                armor = 'buckler-armor'
            } @{
                armor = @('vladmir-armor', 'assault-armor')
            }
        }
        'crimson_guard' {
            New-Aura 'crimson-guard' 'Buckler Aura' 'allies' 'aura_radius' @{ bonus_aoe_armor = 'armor' } @{
                armor = 'buckler-armor'
            }
        }
        { $_ -in 'vladmir', 'ristuls_devotion' } {
            $auraName = if ($key -eq 'ristuls_devotion') { "Ristul's Aura" } else { "Vladmir's Aura" }
            New-Aura $key $auraName 'allies' 'aura_radius' @{
                armor_aura = 'armor'; mana_regen_aura = 'manaRegen'; damage_aura = 'attackDamagePct'
            } @{ armor = 'vladmir-armor'; manaRegen = 'vladmir-mana-regen'; attackDamagePct = 'vladmir-base-damage' }
        }
        { $_ -in 'ring_of_basilius', 'arcane_boots' } {
            New-Aura $key 'Basilius Aura' 'allies' 'aura_radius' @{ aura_mana_regen = 'manaRegen' } @{
                manaRegen = 'basilius-mana-regen'
            }
        }
        'pipe' {
            New-Aura 'pipe' 'Insight Aura' 'allies' 'aura_radius' @{ magic_resistance_aura = 'magicResistance' } @{
                magicResistance = 'pipe-magic-resistance'
            }
        }
        'shivas_guard' {
            New-Aura 'shivas-guard' 'Freezing Aura' 'enemies' 'aura_radius' @{ aura_attack_speed = 'attackSpeed' } @{
                attackSpeed = 'shivas-attack-speed'
            }
        }
        { $_ -in 'headdress', 'mekansm' } {
            New-Aura $key 'Regeneration Aura' 'allies' 'aura_radius' @{ aura_health_regen = 'healthRegen' } @{
                healthRegen = 'headdress-health-regen'
            }
        }
        'guardian_greaves' {
            New-Aura 'guardian-greaves' 'Guardian Aura' 'allies' 'aura_radius' @{
                aura_health_regen = 'healthRegen'; aura_mana_regen = 'manaRegen'
            } @{ healthRegen = 'headdress-health-regen'; manaRegen = 'basilius-mana-regen' }
        }
    }
}

function Get-ItemEffects($key, $tierIndex, $properties) {
    switch -Regex ($key) {
        '^bloodslinger$' {
            foreach ($field in @('damage_over_time', 'tick_rate', 'debuff_duration')) {
                $modelledValues.Add($field) | Out-Null
            }
            [ordered]@{
                kind = 'magic-active'; key = 'sling-grenade'; name = 'Sling Grenade'
                damage = 0
                damagePerTick = Get-NumericValue $values 'damage_over_time'
                tickInterval = Get-NumericValue $values 'tick_rate'
                tickDuration = Get-NumericValue $values 'debuff_duration'
                cooldown = Get-NumericValue $properties 'AbilityCooldown'
                stackGroup = 'blood-grenade'
            }
        }
        '^dagon(?:_[2-5])?$' {
            $modelledValues.Add('damage') | Out-Null
            [ordered]@{
                kind = 'magic-active'; key = 'dagon'; name = 'Energy Burst'
                damage = Get-NumericValue $values 'damage' $tierIndex
                cooldown = Get-NumericValue $properties 'AbilityCooldown' $tierIndex
                stackGroup = 'dagon'
                notes = 'Raw damage for one cast. Mana, blocking, cast range, and spell lifesteal are separate conditions.'
            }
        }
        '^shivas_guard$' {
            $modelledValues.Add('blast_damage') | Out-Null
            [ordered]@{
                kind = 'magic-active'; key = 'arctic-blast'; name = 'Arctic Blast'
                damage = Get-NumericValue $values 'blast_damage'
                cooldown = Get-NumericValue $properties 'AbilityCooldown'
                stackGroup = 'shivas-guard'
                notes = 'Assumes a successful hit on the target.'
            }
        }
        '^(monkey_king_bar)$' {
            $modelledValues.Add('bonus_chance') | Out-Null
            $modelledValues.Add('bonus_chance_damage') | Out-Null
            [ordered]@{
                kind = 'magic-on-hit'; key = 'pierce'; name = 'Pierce'
                damage = Get-NumericValue $values 'bonus_chance_damage'
                chance = Get-NumericValue $values 'bonus_chance'
                stackGroup = 'pierce'
                notes = 'Normal real-hero attacks at 100% Item Potency. Includes conditional true strike in game. Illusions use different damage.'
            }
        }
        '^(maelstrom|mjollnir)$' {
            $modelledValues.Add('chain_chance') | Out-Null
            $modelledValues.Add('chain_damage') | Out-Null
            [ordered]@{
                kind = 'magic-on-hit'; key = 'chain-lightning'; name = 'Chain Lightning'
                damage = Get-NumericValue $values 'chain_damage'
                chance = Get-NumericValue $values 'chain_chance'
                cooldown = Get-NumericValue $values 'chain_cooldown'
                stackGroup = 'chain-lightning'
                notes = 'Single-target proc hit at 100% Item Potency. Additional bounces and the Mjollnir active are outside this item model.'
            }
        }
        '^(blight_stone|desolator|orb_of_corrosion)$' {
            $modelledValues.Add('corruption_armor') | Out-Null
            $name = switch ($key) {
                'blight_stone' { 'Lesser Corruption' }
                'desolator' { 'Corruption' }
                'orb_of_corrosion' { 'Corrosion' }
            }
            [ordered]@{
                kind = 'armor-reduction'; key = 'corruption'; name = $name
                armorReduction = [math]::Abs((Get-NumericValue $values 'corruption_armor'))
                stackGroup = 'corruption'
                notes = if ($key -eq 'desolator') {
                    'Single target at 100% Item Potency with zero prior Desolator kill or assist stacks.'
                } else { 'Single target at 100% Item Potency.' }
            }
        }
        '^(lesser_crit|greater_crit)$' {
            $modelledValues.Add('crit_chance') | Out-Null
            $modelledValues.Add('crit_multiplier') | Out-Null
            [ordered]@{
                kind = 'critical'; key = 'critical-strike'; name = 'Critical Strike'
                chance = Get-NumericValue $values 'crit_chance'
                multiplier = Get-NumericValue $values 'crit_multiplier'
                stackGroup = 'attack-critical'
                notes = 'Competing crits need an explicit priority rule.'
            }
        }
    }
}

$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archivePath).ProviderPath)
try {
    $zipEntry = $archive.GetEntry('game/dota/pak01_dir/scripts/npc/items.txt')
    $reader = [IO.StreamReader]::new($zipEntry.Open())
    try { $text = $reader.ReadToEnd() }
    finally { $reader.Dispose() }
}
finally { $archive.Dispose() }
$tokens = @($tokenPattern.Matches($text) | Where-Object { !$_.Value.StartsWith('//') } | ForEach-Object Value)
$cursor = 0
$definitions = (Read-Properties $tokens ([ref]$cursor))['DOTAAbilities']

$items = foreach ($catalogItem in $catalog.items) {
    $key = $catalogItem.key
    $definition = $definitions["item_$key"]
    if (!$definition -or (Get-NumericValue $definition 'ItemCost') -ne $catalogItem.cost) {
        throw "Could not match $key and its price in build 6978."
    }
    $values = $definition['AbilityValues'] ?? [ordered]@{}
    $tierIndex = 0
    $name = $catalogItem.name
    if ($key -match '^dagon_([2-5])$') {
        $tierIndex = [int]$Matches[1] - 1
        $name = "Dagon $($tierIndex + 1)"
    }
    $stats = [ordered]@{}
    $modelledValues = [Collections.Generic.HashSet[string]]::new()
    $mapping = @{}
    foreach ($field in $flatFields.Keys) { $mapping[$field] = $flatFields[$field] }
    foreach ($field in $itemFields[$key].Keys) { $mapping[$field] = $itemFields[$key][$field] }
    foreach ($field in ($mapping.Keys | Sort-Object)) {
        $stat = $mapping[$field]
        if (!$stat -or !$values.Contains($field)) { continue }
        $amount = Get-NumericValue $values $field $tierIndex
        if ($null -ne $amount) { $modelledValues.Add($field) | Out-Null }
        if ($amount) { $stats[$stat] += $amount }
    }
    foreach ($field in @('bonus_all_stats', 'bonus_stats')) {
        if (!$values.Contains($field)) { continue }
        $amount = Get-NumericValue $values $field $tierIndex
        if ($null -ne $amount) { $modelledValues.Add($field) | Out-Null }
        if ($amount) {
            foreach ($stat in @('strength', 'agility', 'intelligence')) { $stats[$stat] += $amount }
        }
    }
    $auras = @(Get-ItemAuras $key)
    $effects = @(Get-ItemEffects $key $tierIndex $definition)
    $unmodelled = @($values.Keys | Where-Object {
        !$modelledValues.Contains($_) -and $_ -notmatch 'tooltip' -and
        ($null -eq (Get-NumericValue $values $_ $tierIndex) -or (Get-NumericValue $values $_ $tierIndex) -ne 0)
    })
    $notes = if ($itemNotes.ContainsKey($key)) { @($itemNotes[$key]) } else { @() }
    $coverage = if (!($stats.Count -or $auras.Count -or $effects.Count)) { 'unmodelled' }
    elseif ($unmodelled.Count -or $notes.Count -or $auras.Count -or $effects.Count -or
        $definition.AbilityBehavior -notmatch 'PASSIVE') { 'partial' }
    else { 'flat' }
    [ordered]@{
        id = $catalogItem.id
        key = $key
        name = $name
        cost = $catalogItem.cost
        stats = $stats
        auras = $auras
        effects = $effects
        coverage = $coverage
        notes = @($notes)
        unmodelledValues = $unmodelled
    }
}

$dataset = [ordered]@{
    patch = $index.patch
    clientBuild = $index.client.build
    sources = [ordered]@{
        archiveSha256 = $archiveHash
        definitions = "https://github.com/SteamTracking/GameTracking-Dota2/blob/$($index.client.commit)/game/dota/pak01_dir/scripts/npc/items.txt"
        patch = 'https://www.dota2.com/datafeed/patchnotes?version=7.42&language=english'
        armorReductionStacking = 'https://www.dota2.com/wanderingwaters'
        shopCatalog = 'data/7.42/shop-items.json'
    }
    model = [ordered]@{
        target = 'Real hero attacking a real enemy hero'
        potencyPct = 100
        percentageUnits = 'percentage points'
        flatStats = 'Continually active bonuses to the holder while the item is in an active slot.'
        friendlyAuras = 'Stats apply to allies in radius, including the owner.'
        auraStacking = 'Stack groups apply per stat. Use the strongest amount per group and suppress groups named by blockedBy when present.'
        coverage = 'Missing fields are unmodelled. Partial items include only the represented stats, auras or effects.'
    }
    items = @($items)
}
$staged = Join-Path $DataDirectory "$([guid]::NewGuid().ToString('N')).json"
try {
    $dataset | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $staged -Encoding utf8
    Move-Item -LiteralPath $staged -Destination (Join-Path $DataDirectory 'item-mechanics.json') -Force
}
finally {
    if (Test-Path -LiteralPath $staged -PathType Leaf) { Remove-Item -LiteralPath $staged }
}
