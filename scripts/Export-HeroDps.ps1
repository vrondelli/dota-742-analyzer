#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $PSScriptRoot '../data/7.42')
)

$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture
$index = Get-Content -LiteralPath (Join-Path $DataDirectory 'patch-index.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $DataDirectory 'client-6978.zip'
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$roster = @($index.heroes | Where-Object { $_.key -and $_.name })
if ($index.patch -ne '7.42' -or $index.client.build -ne 6978 -or
    $archiveHash -ne $index.client.archive_sha256 -or $roster.Count -ne 127) {
    throw 'Expected the complete 7.42 roster and its verified build 6978 archive.'
}

$attributeNames = @{
    DOTA_ATTRIBUTE_STRENGTH = 'strength'
    DOTA_ATTRIBUTE_AGILITY = 'agility'
    DOTA_ATTRIBUTE_INTELLECT = 'intelligence'
    DOTA_ATTRIBUTE_ALL = 'universal'
}
$attackTypes = @{
    DOTA_UNIT_CAP_MELEE_ATTACK = 'melee'
    DOTA_UNIT_CAP_RANGED_ATTACK = 'ranged'
}
$universalCoefficient = 0.45
$scenarioNotes = @{
    npc_dota_hero_chen = 'Hero attack only. The starting Zealot and controlled units are excluded.'
    npc_dota_hero_kez = 'Uses the client hero definition and its 1.9-second attack time. Sai stance and weapon abilities are excluded.'
    npc_dota_hero_lone_druid = 'Hero attack only. Spirit Bear and True Form are excluded.'
    npc_dota_hero_medusa = 'Uses the raw hero definition. Mana Shield changes actual survivability.'
    npc_dota_hero_morphling = 'Uses unshifted attributes. Attribute Shift is excluded.'
    npc_dota_hero_tiny = 'Uses zero natural agility growth. Grow, Tree Grab, and hero-specific attack modifiers are excluded.'
    npc_dota_hero_troll_warlord = 'Uses the ranged hero definition. Melee stance and stacking attack speed are excluded.'
    npc_dota_hero_void_spirit = 'Intrinsic Edge is excluded. The patch notes describe stats with the innate active.'
}

# Match scalar properties on the hero record. Nested ability values use deeper indentation.
$heroFields = 'HeroID|Enabled|AttackRate|BaseAttackSpeed|AttackDamageMin|AttackDamageMax|AttackRange|AttackCapabilities|AttributePrimary|AttributeBaseStrength|AttributeStrengthGain|AttributeBaseAgility|AttributeAgilityGain|AttributeBaseIntelligence|AttributeIntelligenceGain|ArmorPhysical|MagicalResistance|StatusHealth|StatusHealthRegen|StatusMana|StatusManaRegen|MovementSpeed'
$fieldPattern = [regex]::new('(?m)^\t\t"(' + $heroFields + ')"[ \t]+"([^"\r\n]+)"')

function Get-HeroValues($archive, [string]$key) {
    $entryPath = "game/dota/pak01_dir/scripts/npc/heroes/$key.txt"
    $entry = $archive.GetEntry($entryPath)
    if (!$entry) { throw "Missing hero definition $entryPath." }
    $reader = [IO.StreamReader]::new($entry.Open())
    try {
        $values = @{}
        foreach ($match in $fieldPattern.Matches($reader.ReadToEnd())) {
            $field = $match.Groups[1].Value
            if ($values.ContainsKey($field)) { throw "Duplicate $field in $entryPath." }
            $values[$field] = $match.Groups[2].Value
        }
        return $values
    }
    finally { $reader.Dispose() }
}

function Read-HeroNumber($values, [string]$field) {
    if (!$values.ContainsKey($field)) { throw "Missing $field in hero definition." }
    return [double]::Parse($values[$field], $culture)
}

function Read-InheritedHeroNumber($values, $defaults, [string]$field) {
    if ($values.ContainsKey($field)) { return Read-HeroNumber $values $field }
    if ($defaults.ContainsKey($field)) { return Read-HeroNumber $defaults $field }
    return $null
}

function Get-LevelRows($hero) {
    foreach ($level in 1..30) {
        $levelups = $level - 1
        $strength = $hero.attributes.strength.base + $levelups * $hero.attributes.strength.gain
        $agility = $hero.attributes.agility.base + $levelups * $hero.attributes.agility.gain
        $intelligence = $hero.attributes.intelligence.base + $levelups * $hero.attributes.intelligence.gain
        $attributeDamage = switch ($hero.primaryAttribute) {
            'strength' { $strength }
            'agility' { $agility }
            'intelligence' { $intelligence }
            'universal' { ($strength + $agility + $intelligence) * $universalCoefficient }
        }
        $damageMin = $hero.baseAttackDamageMin + $attributeDamage
        $damageMax = $hero.baseAttackDamageMax + $attributeDamage
        $meanDamage = ($damageMin + $damageMax) / 2
        $attackSpeed = $hero.baseAttackSpeed + $agility
        $attacksPerSecond = $attackSpeed / (100 * $hero.baseAttackTime)
        [ordered]@{
            level = $level
            strength = [math]::Round($strength, 4)
            agility = [math]::Round($agility, 4)
            intelligence = [math]::Round($intelligence, 4)
            attackDamageMin = [math]::Round($damageMin, 4)
            attackDamageMax = [math]::Round($damageMax, 4)
            meanAttackDamage = [math]::Round($meanDamage, 4)
            attackSpeed = [math]::Round($attackSpeed, 4)
            attacksPerSecond = [math]::Round($attacksPerSecond, 6)
            dps = [math]::Round($meanDamage * $attacksPerSecond, 4)
        }
    }
}

$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archivePath).ProviderPath)
try {
    $defaults = Get-HeroValues $archive 'npc_dota_hero_base'
    $heroes = foreach ($entry in $roster | Sort-Object id) {
        $values = Get-HeroValues $archive $entry.key
        if ($values.HeroID -ne [string]$entry.id -or $values.Enabled -ne '1' -or
            !$attributeNames.ContainsKey($values.AttributePrimary) -or
            !$attackTypes.ContainsKey($values.AttackCapabilities)) {
            throw "Hero definition could not be resolved for $($entry.key)."
        }
        $baseAttackSpeed = if ($values.ContainsKey('BaseAttackSpeed')) {
            Read-HeroNumber $values 'BaseAttackSpeed'
        } else {
            Read-HeroNumber $defaults 'BaseAttackSpeed'
        }
        $hero = [ordered]@{
            id = $entry.id
            key = $entry.key
            name = $entry.name
            primaryAttribute = $attributeNames[$values.AttributePrimary]
            baseAttackDamageMin = Read-HeroNumber $values 'AttackDamageMin'
            baseAttackDamageMax = Read-HeroNumber $values 'AttackDamageMax'
            baseAttackTime = Read-HeroNumber $values 'AttackRate'
            baseAttackSpeed = $baseAttackSpeed
            baseArmor = Read-InheritedHeroNumber $values $defaults 'ArmorPhysical'
            baseMagicResistance = Read-InheritedHeroNumber $values $defaults 'MagicalResistance'
            baseHealth = Read-InheritedHeroNumber $values $defaults 'StatusHealth'
            baseHealthRegen = Read-InheritedHeroNumber $values $defaults 'StatusHealthRegen'
            baseMana = Read-InheritedHeroNumber $values $defaults 'StatusMana'
            baseManaRegen = Read-InheritedHeroNumber $values $defaults 'StatusManaRegen'
            baseMoveSpeed = Read-InheritedHeroNumber $values $defaults 'MovementSpeed'
            attackType = $attackTypes[$values.AttackCapabilities]
            attackRange = Read-HeroNumber $values 'AttackRange'
            attributes = [ordered]@{
                strength = [ordered]@{
                    base = Read-HeroNumber $values 'AttributeBaseStrength'
                    gain = Read-HeroNumber $values 'AttributeStrengthGain'
                }
                agility = [ordered]@{
                    base = Read-HeroNumber $values 'AttributeBaseAgility'
                    gain = Read-HeroNumber $values 'AttributeAgilityGain'
                }
                intelligence = [ordered]@{
                    base = Read-HeroNumber $values 'AttributeBaseIntelligence'
                    gain = Read-HeroNumber $values 'AttributeIntelligenceGain'
                }
            }
        }
        if ($scenarioNotes.ContainsKey($entry.key)) { $hero.scenarioNote = $scenarioNotes[$entry.key] }
        $hero.levels = @(Get-LevelRows $hero)
        $hero
    }
}
finally { $archive.Dispose() }

$dataset = [ordered]@{
    patch = $index.patch
    clientBuild = $index.client.build
    mode = 'unmodified_sustained_normal_attack'
    model = [ordered]@{
        targetArmor = 0
        targetEvasion = 0
        primaryDamagePerAttribute = 1
        universalDamagePerAttribute = $universalCoefficient
        attackSpeedPerAgility = 1
        attacksPerSecond = '(baseAttackSpeed + agility) / (100 × baseAttackTime)'
        dps = 'meanAttackDamage × attacksPerSecond'
        baseDefense = 'Raw hero definitions with inheritance. These values precede attributes and innate ability modifiers.'
        assumptions = @(
            'Single stationary target with zero armor and evasion. Continuous attacks with no downtime.'
            'Models natural attribute growth as base plus (level minus one) times gain. Keeps fractional values before engine rounding.'
            'No items, abilities, innates, passives, procs, special attack modes, talents, Attribute Bonus skill points, or other modifiers.'
        )
    }
    sources = [ordered]@{
        archiveSha256 = $archiveHash
        client = "https://github.com/SteamTracking/GameTracking-Dota2/tree/$($index.client.commit)/game/dota/pak01_dir/scripts/npc/heroes"
        universalDamageCoefficient = 'https://www.dota2.com/datafeed/patchnotes?version=7.38&language=english'
        patch = 'https://www.dota2.com/datafeed/patchnotes?version=7.42&language=english'
    }
    heroes = @($heroes)
}

$csvRows = foreach ($hero in $heroes) {
    foreach ($row in $hero.levels) {
        [pscustomobject]@{
            heroId = $hero.id
            hero = $hero.name
            primaryAttribute = $hero.primaryAttribute
            attackType = $hero.attackType
            attackRange = $hero.attackRange
            level = $row.level
            strength = $row.strength
            agility = $row.agility
            intelligence = $row.intelligence
            baseAttackTime = $hero.baseAttackTime
            meanAttackDamage = $row.meanAttackDamage
            attackSpeed = $row.attackSpeed
            attacksPerSecond = $row.attacksPerSecond
            dps = $row.dps
        }
    }
}

$exportId = [guid]::NewGuid().ToString('N')
$stagedJson = Join-Path $DataDirectory "$exportId.json"
$stagedCsv = Join-Path $DataDirectory "$exportId.csv"
try {
    $dataset | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $stagedJson -Encoding utf8
    $csvRows | Export-Csv -LiteralPath $stagedCsv -UseQuotes AsNeeded -NoTypeInformation -Encoding utf8
    Move-Item -LiteralPath $stagedJson -Destination (Join-Path $DataDirectory 'hero-dps.json') -Force
    Move-Item -LiteralPath $stagedCsv -Destination (Join-Path $DataDirectory 'hero-dps.csv') -Force
}
finally {
    foreach ($file in @($stagedJson, $stagedCsv)) {
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
    }
}
