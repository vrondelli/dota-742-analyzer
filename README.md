# Dota 2 7.42 Analyzer

## Run the analyzer

Run this command from the project folder with Node.js 22 or later.

```powershell
npm start
```

Open [the analyzer](http://127.0.0.1:4173). It starts on Legend, using the lobby's estimated average medal. Filter by role, select a hero to see item performance by purchase window, or add up to three heroes to compare side by side. Match refreshes appear on page reload.

| View | Use it to answer |
| --- | --- |
| Matches | How did heroes and purchases perform in the recorded games? |
| Heroes | Where does this hero rank, which opponents look favorable, and what can I buy by minute 20? |
| Role rankings | Which heroes fit my position under the mechanics rubric? |
| Draft guide | How do revealed picks, game conditions, and farm speed change my options? |
| Farm budgets | Which builds fit the gold I could earn by a given minute? |
| Build timings | When do alternative purchase paths come online, and how does their damage change over time? |
| Best build orders | Which purchase sequences lead at minutes 15, 20, and 30 for this hero, role, and farm pace? |
| Damage rankings | Which hero and item combinations add the most damage per gold across fixed spend bands? |
| Item lab | What does a specific build add to one hero under the same combat assumptions? |

```powershell
npm run refresh -- --rank-tier 5
npm test
```

The Legend refresh collects ranked All Pick matches of at least 10 minutes with recorded results from OpenDota. It adds purchase logs and position estimates where available and preserves earlier matches from all ranks. Run `npm run refresh` for all ranks or `npm run refresh -- --help` for collection options. The public feed can include games with abandons. [OpenDota API specification](https://github.com/odota/core/blob/master/svc/api/spec.ts)

Hero ranks use the lower bound of a 95% Wilson interval with a default minimum of five games. Pick share uses the eligible hero slots in the selected cohort. Role-specific results use OpenDota's inferred positions from parsed replays. Estimated match rank averages available player medals and caps at Divine. Every match in the initial snapshot has timestamp-inferred patch membership. [Role estimation](https://github.com/odota/core/blob/master/svc/util/compute.ts#L254) · [Rank calculation](https://github.com/odota/core/blob/master/svc/util/utility.ts#L151)

Item rows compare first purchases within a selected time window against games where the hero reached the end of that window without buying the item. Games with missing logs and prior owners are excluded. A rank requires at least five games in each group. Any displayed win-rate difference is an unadjusted association within the selected cohort. Pre-purchase gold and team lead are outside the first version's comparison.

## Deploy to Vercel

Import the GitHub repository with the repository root as the Vercel project directory. The checked-in Vercel configuration serves the analyzer pages and the Node API with the bundled 7.42 datasets. The default data snapshot runs without environment variables.

Use the project's production domain for sharing. Open `/role-rankings` for the role boards or add a role query such as `/role-rankings?role=offlane` to link directly to a position.

## Item lab

Open the [Item lab](http://127.0.0.1:4173/efficiency) to compare single items and two-item builds under the same gold budget. The model starts from the selected hero and level. Choose a damage, durability, aura or sustain metric and enter the relevant target and fight assumptions. The same page also opens from a selected hero in the Legend analyzer.

- Right-click DPS combines average physical damage per hit, attack rate, supported attack effects, and target armor. Magic damage uses the selected fight window, entered spell damage, target magic resistance, and supported item effects.
- Armor, magic resistance, effective HP, attack speed, mana and health regeneration use each stat's own unit. Aura values apply per affected unit in range. Documented conflicts are applied where represented.
- Gain is measured relative to the unmodified hero in the same scenario. Gain per 1,000 gold divides that gain by build cost and multiplies by 1,000. The spending curve shows builds that improve on every cheaper option for the selected metric.

The model uses fractional attribute growth, continuous attacks and a single target. Item rows mark partial or unmodelled coverage. Hero abilities, inventories already owned, dispels, evasion, damage block and conditional effects require their own scenario or model. Use the results to shortlist builds, then check replay outcomes or reproduce an interaction in Demo Hero. [7.42 rules](https://www.dota2.com/patches/7.42) · [Armor formula](https://www.dota2.com/datafeed/patchnotes?version=7.27&language=english)

To regenerate the modelling datasets, fetch the pinned Valve source archive with PowerShell 7, then export the datasets and restart the local server.

```powershell
pwsh -NoProfile -File ./Collect-Dota742.ps1
pwsh -NoProfile -File ./scripts/Export-HeroDps.ps1
pwsh -NoProfile -File ./scripts/Export-ItemMechanics.ps1
```

## Legend build rankings

Open [Legend builds](http://127.0.0.1:4173/legend-builds) to compare hero and item combinations across Carry, Mid, Offlane, Soft Support and Hard Support. Each role board uses heroes seen in that role in the available 7.42 Legend-average replays. The all-hero board compares the full roster without a role requirement.

Each spend band has a distinct lower and upper gold bound. For example, the middle band at the default settings contains builds costing more than 1,000 and at most 3,000 gold. Results rank the best build for each hero in each band by incremental damage per 1,000 gold. Output after items, actual cost, and Legend replay picks are shown alongside it. Rank filters never change the modeled damage.

A build must beat the damage of every cheaper choice for the same hero. This prevents a higher spend band from rewarding the same build with an added item that contributes no damage.

The magic comparison uses one cast of each hero's strongest supported direct spell available at the selected level, plus supported item casts and on-hit damage under the scenario settings. Turn off attack procs to compare cast damage alone. Heroes without a supported learned spell can still be compared on represented item damage. This benchmark uses one target and excludes complex spell sequences and many conditional effects. Replay picks establish role eligibility and do not measure the effect of the suggested build. [OpenDota role estimation](https://github.com/odota/core/blob/master/svc/util/compute.ts#L254)

Regenerate the spell catalog with `pwsh -NoProfile -File ./scripts/Export-HeroMagic.ps1`.

### Ability damage per gold

Select **Ability damage** to rank added physical damage per Omnislash cast per 1,000 gold. Juggernaut is currently the scored hero. The ranking uses Omnislash ranks learned at levels 6, 12 and 18, one continuously available enemy, the selected target armor, and supported physical item effects. Each band shows multiple builds that improve on cheaper choices, so you can see attack-speed breakpoints alongside damage and crit purchases. [Valve's Juggernaut data](https://www.dota2.com/datafeed/herodata?hero_id=8&language=english)

The timing model places the first strike at time zero and estimates subsequent hits from the attack interval, with hits at the expiry boundary excluded. The model shows whole hits, the next nominal attack-speed threshold, and the hit count if every interval takes 33 ms longer. This is a sensitivity check. Actual slash timing in Demo Hero remains uncalibrated. The calculation excludes Bladeform, Blade Dance, talents, target switching, misses and magical item procs.

The ability interaction map lists other hero-specific item mechanics and their Legend role observations. Mapped interactions have a source and a test question. Ability rankings include interactions with an implemented damage model.

## GPM projections

Open [GPM projections](http://127.0.0.1:4173/gpm-builds) for 20 unique Legend heroes and projected builds under bad, good, and easy farm. The farm scenarios use the 25th, 50th, and 85th percentiles of observed gold per minute for each role. The selected minute controls both the income measurement and the estimated purchase budget. Roles with no valid earned-gold timelines use available whole-match GPM with its basis labeled. [OpenDota replay gold counter](https://github.com/odota/parser/blob/master/src/main/java/opendota/Parse.java#L798)

The default scenario evaluates minute 20, hero level 12, a 1,500g reserve for other purchases, a target with 10 armor, and up to two modeled items. The budget is estimated earned gold through the selected minute less the reserve. The solver picks the highest modeled sustained physical DPS it can afford in each scenario. The top 20 rank by the equal-weight mean across all three scenarios, with each hero appearing once in their best-scoring eligible role. A role filter uses only that role's projections.

Heroes in a role share its farm distribution. Replay start times assign the current sample to the patch window, and inferred replay roles determine hero eligibility. The build model uses gross earnings and ranks held items by single-target attack DPS. The CSV export includes the selected settings, per-scenario sample counts, budgets, items and DPS.

Open **Item Potency and patch builds** to compare supported on-hit effects across normal attacks, illusions, and special attacks. The panel also prices report-derived build examples against the current role budgets. Its Dota2ProTracker paths are historical 7.41f context. Per-hit effects and build hypotheses sit alongside the sustained right-click ranking. [Valve 7.42 mechanics](https://www.dota2.com/patches/7.42)

## Build timings

Open [Build timings](http://127.0.0.1:4173/build-timings) to compare Daedalus rush, Maelstrom first, an early Mjollnir upgrade, and other paths for a hero. Choose a Legend position and farm pace, set the target's defenses, or enter up to six purchases in your own order. A shared link restores the whole setup.

The model estimates purchases at one-minute intervals from five-minute Legend gold checkpoints, with 1,500 gold set aside for other spending. Paths share the same hero levels at each minute. When a supported recipe consumes an item already bought, the path pays the remaining cost and replaces that item's stats with the upgrade's stats.

Each curve combines sustained physical attacks with supported passive item magic damage. Hero abilities, survival, target access, and farming gains can change what works in a match. Add hypothetical gold per minute after a farm item comes online to see how early farming could change later timings. At zero, the comparison uses the same income for every path.

Open [Best build orders](http://127.0.0.1:4173/best-builds) to search up to six purchases for any hero and Legend position. The search keeps competitive paths at several spending levels and reports three distinct inventories for each target minute and farm pace when available. It scores the purchases from damage, durability, or role utility as shown on the page. Buy timings break ties in favor of earlier impact. Open any result in Build timings to inspect its purchase curve alongside other paths.

## Legend draft guide

Open [Draft and build guide](http://127.0.0.1:4173/draft-guide) and select a role. Add revealed enemies to compare their observed pair results and see specific matchup notes. Mark allied and banned heroes to remove them from the available shortlist. The opening, response, and last-pick steps follow Ranked All Pick’s simultaneous reveal phases. [Valve All Pick rules](https://www.dota2.com/patches/7.27)

The guide combines pooled all-position matchup results with sparse inferred role evidence. Pair results are pulled toward the hero’s outcomes in other matches to reduce the impact of small samples. Guided heroes with no observed picks in the selected role are marked as role hypotheses.

Each guided hero has separate slow, steady, and fast farm paths. Select the primary in-game problem to replace, move, or add a counter item in each path. Enemy picks suggest conditions to consider. Where a path has a cheaper bridge, the guide can keep it until the projected budget covers the upgrade. The budget cutoff uses cumulative prices for completed purchases and the selected Legend GPM scenarios. The guide prices each path from an empty inventory after the reserve.

### Offlane and support impact

The [role impact arm](http://127.0.0.1:4173/draft-guide?arm=impact&role=offlane) covers four offlaners, three soft supports and three hard supports. Each position has its own weighted criteria. Every hero rating uses a 0–3 scale with a mechanics explanation. Picking a team priority doubles that criterion's weight and rescales the weights to total 100%. The resulting role fit score ranks the hero's abilities within the selected position, with the draft score used for ties.

The matchup results and budget estimates appear alongside the role fit score. Each farm path has a role milestone, such as Blink for initiation or Pavise for an ally barrier. Its cost is the cumulative spend through that purchase in the active path. A game-condition branch can put another item first, delay the role milestone, or replace it.

## Top 20 by role

Open [Role rankings](http://127.0.0.1:4173/role-rankings) to see 20 heroes for each position. Select a hero to inspect the mechanics rationale, individual ratings, and supported benchmarks. The fixed 7.42 analysis gives mechanics and benchmarks up to 95 points and confidence-adjusted pooled win rate up to five.

Choose a farm level to preview item purchases and open a hero's details for all three farm levels. Open the hero guide to adapt those purchases to enemy picks and game conditions.

The snapshot combines 15,008 Legend-average public matches with 49 inferred-role replays. Candidate positions are curated from the hero kit and conventional role fit. Carry DPS uses three minute-20 farm budgets. The mid benchmark evaluates one supported cast at level 12 and labels cases that use the median mapped cast as a scoring input. [Ranking dataset](data/7.42/role-rankings.json)

## Hero guides

Open [Heroes](http://127.0.0.1:4173/heroes) to search the 7.42 roster. A hero guide shows that hero's placement on each top-20 position board and opponent results pooled across Legend positions. Matchups compare the hero's adjusted results against an enemy to its results in other games, with at least 20 games in each group.

Select a position to compare bad, good, and easy farm. Item budgets use that position's 25th, 50th, and 85th percentile farm by minute 20, less 1,500 gold reserved for other spending. Each guide labels the basis of the purchases, whether the view uses a curated build, a right-click damage model, or a general role template. Share a selected role with a link such as `/hero/juggernaut?role=carry`.

Add up to five enemies under **What to buy**. Automatic mode combines detected threats, ordered by the number of enemies that flag each threat, with hero-specific item changes first when counts tie. You can choose several conditions yourself or return to the default build. Each farm budget shows the purchase order, including affordable alternatives and upgrades to buy later. Shared hero links restore the role, enemies, and selected conditions.

Use **Check your farm pace** to compare cumulative earned gold with Legend benchmarks from minute 5 to 30. Enter your estimated earned gold at a checkpoint to find the closest build tier for your role. Bad farm covers gold through the 25th percentile, easy farm starts at the 85th percentile, and good farm sits between them. Benchmarks also show average gold per minute. The farm label describes personal gold pace.

## Patch sources

Valve released 7.42 on November 18, 2026. The Steam event starts at 17:00 São Paulo time (20:00 UTC) and was published 46 seconds later. The patch-notes feed carries a separate timestamp at 08:00 UTC. Use the actual server build where available when assigning matches to a patch. [Full official notes](https://www.dota2.com/patches/7.42) · [Official JSON feed](https://www.dota2.com/datafeed/patchnotes?version=7.42&language=english) · [Valve announcement](https://store.steampowered.com/news/app/570/view/689773669992367212)

## What changed in 7.42

| Area | Changes to model |
| --- | --- |
| Hero stats | Base HP 120 → 200, HP per Strength 22 → 20, and magic resistance per Intelligence 0.10 → 0.125 percentage points. |
| Economy and levels | Flat 90 passive GPM and 50 passive XP per minute, including while dead. Kill and building bounties and level XP requirements changed. |
| Combat | Item Potency scales eligible on-hit effects, including on illusion attacks. Pip-health rules were standardized. Debuff immunity, breakability, duplicate spell lifesteal, and spell scaling changed. |
| Map and objectives | Tormentor starts at 15:00 and drops Greater Horn of Battle. Roshan respawns sooner after successive kills. Glyph has two charges. Twin Gates, mid terrain, and neutral camps moved or changed. |
| Items | Quarterstaff returned. New shop upgrades include Bloodslinger, Caduceus, Ristul's Devotion, Sabatons of Mordiggian, Skypiercer, and Starforge. Neutral items now have four tiers. |

See Valve's full notes for the individual hero, ability, item, and neutral creep changes. The JSON feed groups deltas by hero and ability/item ID. [Official notes](https://www.dota2.com/patches/7.42) · [JSON](https://www.dota2.com/datafeed/patchnotes?version=7.42&language=english)

## Local data

| File | Contents |
| --- | --- |
| `data/7.42/client-6978.zip` | Local input regenerated by the collector. Contains 135 pinned Valve KeyValues files from the SteamTracking mirror. The analyzer runs with the derived datasets below. |
| [Patch index](data/7.42/patch-index.json) | 128 hero-section records, 82 ID-bearing item records, and 79 ID-bearing neutral item records. Source metadata and the archive checksum are included. Hero record 1961 is absent from Valve's hero list and its name is left blank. |
| [Mechanics seed](data/7.42/mechanics-seed.json) | Selected structured rules for attributes, gold, XP, Item Potency, pip health, spell interactions, objectives, and neutral tiers. |
| [Shop catalog](data/7.42/shop-items.json) | Names and build 6978 prices for purchasable items used in the item rankings. Recipes and neutral drops are filtered out. |
| [Hero attack model](data/7.42/hero-dps.json) · [CSV](data/7.42/hero-dps.csv) | Baseline damage per hit, attack speed, attacks per second and sustained attack DPS for 127 heroes at levels 1–30. |
| [Hero magic benchmark](data/7.42/hero-magic.json) | Supported direct spell damage and spell-rank unlock levels for the cross-hero magic comparison. |
| [Ability interaction map](data/7.42/ability-interactions.json) | Patch-specific item interactions for Omnislash and candidate abilities, with source links and modeling limits. |
| [Item mechanics](data/7.42/item-mechanics.json) | Modelled stats, effects, aura stacking and coverage for 190 named purchasable items. |
| [Match snapshot](data/7.42/matches.json) | OpenDota ranked match results, inferred roles, and purchase logs where available. |
| [Collector](Collect-Dota742.ps1) | Rebuilds the pinned client archive, patch index, and shop catalog using PowerShell 7. Catalog names are resolved from Valve's live feeds when the script runs. |

```powershell
pwsh -NoProfile -File ./Collect-Dota742.ps1
```

Use the pinned files for patch-specific numeric values. The live Valve detail feeds provide structured targeting, damage, cooldowns, costs, special values, talents and upgrades. The live item list also exposes recipe IDs. Preserve internal keys and provider IDs, resolve KeyValues `#base` includes, and keep per-level values as arrays. [Pinned source](https://github.com/SteamTracking/GameTracking-Dota2/tree/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/scripts/npc) · [Hero detail](https://www.dota2.com/datafeed/herodata?hero_id=1&language=english) · [Ability detail](https://www.dota2.com/datafeed/abilitydata?ability_id=5003&language=english) · [Item detail](https://www.dota2.com/datafeed/itemdata?item_id=1&language=english) · [Item list](https://www.dota2.com/datafeed/itemlist?language=english) · [Pinned English localization](https://github.com/SteamTracking/GameTracking-Dota2/tree/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/resource/localization)

Some interaction rules need patch notes or in-game verification. For example, build 6978 exposes Desolator's −6 armor and Swashbuckle's 60% Item Potency. The patch rule predicts −3.6 armor per eligible Swashbuckle application, while a normal attack with a Tier 4 Evolved Enchantment predicts −7.2. Model magnitude, eligibility, and stacking as separate fields. [Item definitions](https://github.com/SteamTracking/GameTracking-Dota2/blob/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/scripts/npc/items.txt) · [Pangolier definitions](https://github.com/SteamTracking/GameTracking-Dota2/blob/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/scripts/npc/heroes/npc_dota_hero_pangolier.txt) · [Patch rules](https://www.dota2.com/patches/7.42)

## Match data and ranking

OpenDota's public match feed supplies start times, drafts, results, modes, and average rank. Match details supply purchase logs and lane data when a replay has been parsed. STRATZ is another replay data source. Its authenticated 7.42 coverage was outside this check. [OpenDota public matches](https://api.opendota.com/api/publicMatches) · [OpenDota API specification](https://github.com/odota/core/blob/master/svc/api/spec.ts) · [STRATZ API](https://stratz.com/api)

For a second source, verify that the same 7.42 data can be filtered to Legend and include role and purchase timings. STRATZ offers rank and position filters on its public site, and its GraphQL API requires a token for a match-data check. Dota2ProTracker focuses on high-MMR and tournament cohorts. An estimated Legend lobby can contain players with other medals, so keep match-average and player-level filters explicit if both are available. [STRATZ rank and position filters](https://stratz.com/heroes/meta/trends) · [STRATZ token guidance](https://github.com/STRATZ-Esports/knowledge-base/issues/37) · [D2PT scope](https://dota2protracker.com/pages)

The patch-day OpenDota index ended at 7.41. Four ranked All Pick matches starting from 17:14 to 17:15 São Paulo time still had `patch=60` (7.41) and no populated purchase logs when checked. The collector uses the announcement cutoff for a preliminary 7.42 cohort and marks patch assignment as inferred. Replay server build metadata can confirm patch assignment once its mapping has been validated independently of the mirrored client build number. [OpenDota patch constants](https://api.opendota.com/api/constants/patch) · [Example match](https://api.opendota.com/api/matches/9095881920) · [OpenDota patch calculation](https://github.com/odota/core/blob/master/svc/util/compute.ts#L397) · [Clarity replay build metadata](https://github.com/skadistats/clarity-examples#the-context)

1. **Heroes.** Start with completed ranked All Pick matches. Report win rate, pick rate, sample size, and an uncertainty interval per patch and rank bracket. Add role splits when reliable role data is available.
2. **Items.** Compare first purchase of an item with alternatives for the same hero, role, rank, and purchase window. Compare games that reached the same window and account for pre-purchase net worth and team lead when available. Show purchase timing, sample size, parsed coverage, and the observed win-rate difference.
3. **Mechanics.** Explain differences with context such as effective HP, disable duration, on-hit scaling, and gold cost. Keep simulated effects and observed match outcomes as distinct inputs.

Completed inventory is a biased measure of item value because winning players have more gold and some items can only be bought in games that last long enough. OpenDota's precomputed item-timing aggregates also pool patches, so the analyzer should use patch-filtered purchase events for this comparison. [OpenDota item-timing query](https://github.com/odota/core/blob/master/svc/util/queries.ts#L343)
