#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $PSScriptRoot '../data/7.42')
)

$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture
$index = Get-Content -LiteralPath (Join-Path $DataDirectory 'patch-index.json') -Raw | ConvertFrom-Json
$roster = @($index.heroes | Where-Object { $_.key -and $_.name })
$archivePath = Join-Path $DataDirectory 'client-6978.zip'
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($index.patch -ne '7.42' -or $index.client.build -ne 6978 -or
    $archiveHash -ne $index.client.archive_sha256 -or $roster.Count -ne 127) {
    throw 'Expected the full 7.42 roster and its verified build 6978 archive.'
}

# Explicit selections distinguish one-hit damage from ticks, percentages, secondary damage,
# and values shared with upgrades. Every value and skill schedule is checked against the archive.
$choices = @'
crystal_maiden_crystal_nova|nova_damage|Crystal Nova
earthshaker_fissure|fissure_damage|Fissure
earthshaker_echo_slam|echo_slam_initial_damage|Echo Slam|Initial impact only. Echoes are outside this benchmark.
mirana_arrow|AbilityDamage|Sacred Arrow|Base damage. Distance bonus is outside this benchmark.
mirana_starfall|damage|Starstorm|Primary star only.
morphling_waveform|AbilityDamage|Waveform
nevermore_shadowraze3|shadowraze_damage|Shadowraze|One hit with no pre-existing Shadowraze stacks.
phantom_lancer_spirit_lance|lance_damage|Spirit Lance|Direct lance hit only.
puck_illusory_orb|damage|Illusory Orb|Projectile hit only.
puck_waning_rift|damage|Waning Rift
puck_dream_coil|coil_initial_damage|Dream Coil|Initial hit only. Coil break damage is outside this benchmark.
sandking_burrowstrike|AbilityDamage|Burrowstrike
storm_spirit_static_remnant|static_remnant_damage|Static Remnant
sven_storm_bolt|AbilityDamage|Storm Hammer
tiny_toss|toss_damage|Toss|Base landing damage.
vengefulspirit_magic_missile|magic_missile_damage|Magic Missile
vengefulspirit_wave_of_terror|damage|Wave of Terror
vengefulspirit_nether_swap|damage|Nether Swap|Enemy-target cast.
zuus_arc_lightning|arc_damage|Arc Lightning|First target. Secondary bounces and additional health-based effects are outside this benchmark.
zuus_lightning_bolt|damage|Lightning Bolt
zuus_heavenly_jump|damage|Heavenly Jump|Assumes the selected enemy is hit.
zuus_thundergods_wrath|damage|Thundergod's Wrath|One affected enemy.
kunkka_ghostship|AbilityDamage|Ghostship
lina_dragon_slave|dragon_slave_damage|Dragon Slave
lina_light_strike_array|light_strike_array_damage|Light Strike Array
lina_laguna_blade|damage|Laguna Blade
lion_impale|damage|Earth Spike
lion_finger_of_death|damage|Finger of Death|Zero accumulated Finger of Death kills.
shadow_shaman_ether_shock|damage|Ether Shock|One affected enemy.
tidehunter_gush|gush_damage|Gush
tidehunter_ravage|AbilityDamage|Ravage
witch_doctor_paralyzing_cask|base_damage|Paralyzing Cask|First hit only.
lich_chain_frost|damage|Chain Frost|First hit only.
tinker_deploy_turrets|drop_damage|Deploy Turrets|Initial drop damage. Turret missiles are outside this benchmark.
sniper_assassinate|damage|Assassinate|Base magical impact.
necrolyte_death_pulse|AbilityDamage|Death Pulse
beastmaster_primal_roar|damage|Primal Roar|Primary enemy target.
queenofpain_shadow_strike|strike_damage|Shadow Strike|Initial strike only.
queenofpain_scream_of_pain|damage|Scream of Pain
venomancer_venomous_gale|strike_damage|Venomous Gale|Initial projectile hit only.
venomancer_snakebite|base_damage|Snakebite|Initial hit only.
venomancer_noxious_plague|impact_damage|Noxious Plague|Impact only.
skeleton_king_hellfire_blast|damage|Wraithfire Blast|Initial damage only.
death_prophet_carrion_swarm|damage|Carrion Swarm
pugna_nether_blast|blast_damage|Nether Blast
luna_lucent_beam|beam_damage|Lucent Beam
dragon_knight_breathe_fire|damage|Breathe Fire
dragon_knight_dragon_tail|damage|Dragon Tail
rattletrap_rocket_flare|damage|Rocket Flare
rattletrap_hookshot|damage|Hookshot
leshrac_split_earth|AbilityDamage|Split Earth
leshrac_lightning_storm|damage|Lightning Storm|First target only.
furion_wrath_of_nature|damage|Wrath of Nature|First target only. Bounce bonuses are outside this benchmark.
dark_seer_vacuum|damage|Vacuum
huskar_inner_fire|damage|Inner Fire
night_stalker_void|damage|Void
broodmother_spawn_spiderlings|damage|Spawn Spiderlings|Immediate damage only.
bounty_hunter_shuriken_toss|bonus_damage|Shuriken Toss|First target only.
weaver_shukuchi|damage|Shukuchi|One contact with the target.
batrider_flamebreak|damage_impact|Flamebreak|Initial impact only.
spectre_spectral_dagger|damage|Spectral Dagger
ancient_apparition_ice_blast|AbilityDamage|Ice Blast|Impact only. Damage over time and shatter are outside this benchmark.
ursa_earthshock|AbilityDamage|Earthshock
spirit_breaker_nether_strike|damage|Nether Strike|Spell damage alone. Greater Bash is outside this benchmark.
gyrocopter_homing_missile|hit_damage|Homing Missile|Assumes the missile survives to hit the target.
silencer_curse_of_the_silent|application_damage|Arcane Curse|Application only. Subsequent damage is outside this benchmark.
obsidian_destroyer_astral_imprisonment|damage|Astral Imprisonment|Release damage only.
brewmaster_thunder_clap|damage|Thunder Clap
shadow_demon_shadow_poison|hit_damage|Shadow Poison|Projectile hit only. Stack release is outside this benchmark.
shadow_demon_demonic_purge|purge_damage|Demonic Purge|Completion damage with no upgrades.
ogre_magi_fireblast|fireblast_damage|Fireblast|One base cast. Multicast is outside this benchmark.
undying_decay|decay_damage|Decay|Base magical damage. Strength change is outside this benchmark.
rubick_fade_bolt|damage|Fade Bolt|First target only.
nyx_assassin_impale|impale_damage|Impale
keeper_of_the_light_blinding_light|damage|Blinding Light
medusa_mystic_snake|snake_damage|Mystic Snake|First target only.
troll_warlord_whirling_axes_ranged|axe_damage|Whirling Axes (Ranged)|Ranged stance. One enemy hit.
troll_warlord_whirling_axes_melee|damage|Whirling Axes (Melee)|Melee stance. One enemy hit.
centaur_hoof_stomp|stomp_damage|Hoof Stomp
magnataur_shockwave|shock_damage|Shockwave
magnataur_reverse_polarity|polarity_damage|Reverse Polarity
tusk_ice_shards|shard_damage|Ice Shards
tusk_snowball|snowball_damage|Snowball|Base impact with no additional passengers.
skywrath_mage_concussive_shot|damage|Concussive Shot
abaddon_death_coil|damage_heal|Mist Coil|Enemy-target cast.
techies_sticky_bomb|damage|Sticky Bomb|One explosion.
techies_suicide|damage|Blast Off!
ember_spirit_fire_remnant|damage|Fire Remnant|One remnant consumed. Additional remnants are outside this benchmark.
earth_spirit_boulder_smash|rock_damage|Boulder Smash|One hit from a Stone Remnant.
earth_spirit_geomagnetic_grip|rock_damage|Geomagnetic Grip|One hit from a Stone Remnant.
oracle_purifying_flames|damage|Purifying Flames|Initial magical damage. Later healing is outside this benchmark.
arc_warden_spark_wraith|spark_damage_base|Spark Wraith|One wraith triggered.
grimstroke_dark_artistry|damage|Stroke of Fate|First unit hit.
void_spirit_aether_remnant|impact_damage|Aether Remnant
void_spirit_dissimilate|AbilityDamage|Dissimilate
void_spirit_resonant_pulse|damage|Resonant Pulse
void_spirit_astral_step|pop_damage|Astral Step|Mark detonation only. Attack damage is outside this benchmark.
snapfire_firesnap_cookie|impact_damage|Firesnap Cookie|Landing damage.
mars_spear|damage|Spear of Mars|One projectile hit.
ringmaster_impalement|damage_impact|Impalement Arts|Initial hit only.
dawnbreaker_celestial_hammer|hammer_damage|Celestial Hammer|Outbound hammer hit only.
marci_grapple|impact_damage|Dispose|Impact damage.
marci_companion_run|impact_damage|Rebound|Landing damage.
muerta_dead_shot|damage|Dead Shot|First enemy hit.
largo_catchy_lick|damage|Catchy Lick|Enemy-target cast.
'@
$selected = @{}
foreach ($line in ($choices.Trim() -split '\r?\n')) {
    $key, $field, $name, $note = $line.Trim() -split '\|', 4
    $selected[$key] = @{ field = $field; name = $name; note = $note }
}

$tokenPattern = [regex]::new('(?m)//[^\r\n]*|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+')

function Read-Properties([string[]]$tokens, [ref]$cursor) {
    $properties = [ordered]@{}
    while ($cursor.Value -lt $tokens.Count) {
        $key = $tokens[$cursor.Value]
        $cursor.Value++
        if ($key -eq '}') { return $properties }
        $value = $tokens[$cursor.Value]
        $cursor.Value++
        $properties[$key.Trim('"')] = if ($value -eq '{') {
            Read-Properties $tokens $cursor
        } else { $value.Trim('"') }
    }
    return $properties
}

function Get-Spell($key, $definition, $selection) {
    if ($definition.AbilityUnitDamageType -ne 'DAMAGE_TYPE_MAGICAL' -or
        $definition.AbilityBehavior -notmatch 'DOTA_ABILITY_BEHAVIOR_' -or
        $definition.AbilityBehavior -match '(?:PASSIVE|HIDDEN|NOT_LEARNABLE|CHANNELLED|TOGGLE|BEHAVIOR_ATTACK)\b' -or
        $definition.IsGrantedByShard -eq '1' -or $definition.IsGrantedByScepter -eq '1') {
        throw "Unexpected spell classification for $key."
    }
    $field = $selection.field
    if ($field -eq 'AbilityDamage') {
        $rawDamage = $definition.AbilityDamage
        $source = 'AbilityDamage'
    } else {
        $rawDamage = $definition.AbilityValues[$field]
        if ($rawDamage -is [System.Collections.IDictionary]) { $rawDamage = $rawDamage['value'] }
        $source = "AbilityValues.$field"
    }
    if (!$rawDamage -or $rawDamage -notmatch '^[0-9.]+(?:\s+[0-9.]+)+$') {
        throw "Missing ranked damage values in $key ($source)."
    }
    $damage = @($rawDamage -split '\s+' | ForEach-Object { [double]::Parse($_, $culture) })
    $ultimate = $definition.AbilityType -eq 'ABILITY_TYPE_ULTIMATE'
    $unlocks = if ($ultimate) { @(6, 12, 18) } else { @(1, 3, 5, 7) }
    $step = $unlocks[1] - $unlocks[0]
    if ($damage.Count -ne $unlocks.Count -or
        ($definition.MaxLevel -and [int]$definition.MaxLevel -ne $unlocks.Count) -or
        ($definition.RequiredLevel -and [int]$definition.RequiredLevel -ne $unlocks[0]) -or
        ($definition.LevelsBetweenUpgrades -and [int]$definition.LevelsBetweenUpgrades -ne $step)) {
        throw "Nonstandard skill ranks in $key."
    }
    $notes = if ($selection.note) { @($selection.note) } else { @() }
    return [ordered]@{
        key = $key
        name = $selection.name
        damageByRank = $damage
        rankUnlockLevels = $unlocks
        source = $source
        notes = @($notes | Where-Object { $_ })
    }
}

$seen = [Collections.Generic.HashSet[string]]::new()
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archivePath).ProviderPath)
try {
    $heroes = foreach ($h in ($roster | Sort-Object id)) {
        $entry = $archive.GetEntry("game/dota/pak01_dir/scripts/npc/heroes/$($h.key).txt")
        if (!$entry) { throw "Missing definition for $($h.key)." }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $text = $reader.ReadToEnd() }
        finally { $reader.Dispose() }
        $tokens = @($tokenPattern.Matches($text) | Where-Object { !$_.Value.StartsWith('//') } | ForEach-Object Value)
        $offset = 0
        $hero = (Read-Properties $tokens ([ref]$offset))['DOTAHeroes'][$h.key]
        if ($hero.HeroID -ne [string]$h.id -or $hero.Enabled -ne '1') {
            throw "Unexpected roster record for $($h.key)."
        }
        $spells = @(
            foreach ($slot in $hero.Keys) {
                if ($slot -notmatch '^Ability\d+$') { continue }
                $key = $hero[$slot]
                if (!$selected.ContainsKey($key) -or !$seen.Add($key)) { continue }
                Get-Spell $key $hero.AbilityDefinitions[$key] $selected[$key]
            }
        )
        $heroNotes = if (!$spells.Count) { 'No direct magical spell has been mapped for this benchmark.' }
        [ordered]@{
            id = $h.id
            key = $h.key
            name = $h.name
            status = if ($spells.Count) { 'supported' } else { 'unsupported' }
            notes = @($heroNotes | Where-Object { $_ })
            spells = $spells
        }
    }
}
finally { $archive.Dispose() }
if ($seen.Count -ne $selected.Count) {
    $missing = $selected.Keys | Where-Object { !$seen.Contains($_) }
    throw "Missing spell definitions for $($missing -join ', ')."
}

$dataset = [ordered]@{
    patch = $index.patch
    clientBuild = $index.client.build
    mode = 'supported_raw_one_cast_magical_damage'
    sources = [ordered]@{
        archiveSha256 = $archiveHash
        definitions = "https://github.com/SteamTracking/GameTracking-Dota2/tree/$($index.client.commit)/game/dota/pak01_dir/scripts/npc/heroes"
        patch = 'https://www.dota2.com/datafeed/patchnotes?version=7.42&language=english'
    }
    model = [ordered]@{
        target = 'One enemy hero successfully hit by one supported cast.'
        damage = 'Raw magical damage of the explicitly identified damage instance, before target resistance.'
        coverage = 'Curated damage components with checked 7.42 values. Unsupported means this catalog has no eligible spell profile for the hero.'
        exclusions = 'Spell damage amplification, talents, upgrades, conditional stacks, variable damage, additional hits, damage over time, other targets, and actual skill distributions.'
    }
    heroes = @($heroes)
}
$staged = Join-Path $DataDirectory "$([guid]::NewGuid().ToString('N')).json"
try {
    $dataset | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $staged -Encoding utf8
    Move-Item -LiteralPath $staged -Destination (Join-Path $DataDirectory 'hero-magic.json') -Force
}
finally {
    if (Test-Path -LiteralPath $staged -PathType Leaf) { Remove-Item -LiteralPath $staged }
}
