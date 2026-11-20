# Wraith King builds in Legend · 7.42

**Carry recommendation.** Buy Strength Treads and Armlet if you need to fight early. Go through Maelstrom to Mjollnir if you can farm 6,900 gold for your build by minute 20 and expect to keep attacking. Keep Radiance if you have a slower minute-20 budget and expect to use its burn while moving between targets or clearing camps.

## What players bought

The November 20 refresh brought the general bank to **13,679 matches**, including **12,714 Legend-average matches**. The targeted bank grew from **12 to 78 Wraith King replays with purchases**, including **32 carries** and **46 offlaners**. OpenDota returned 68 matching candidates in the 44 accessible recent index pages. The bank retained earlier Wraith King replays as well. Rate limiting left gaps in the patch window, and the two most common Carry openings are one game apart. [Targeted replay bank](../data/7.42/wraith-king-replays.json)

| Position | First three major purchases | Games | Median purchase times |
| --- | --- | ---: | --- |
| Carry | Phase Boots → Radiance → Armlet | 8/32 | 5:53 / 16:40 / 21:12 |
| Carry | Phase Boots → Radiance → Blink Dagger | 7/32 | 6:53 / 17:27 / 20:19 |
| Carry | Phase Boots → Armlet → Blink Dagger | 3/32 | 7:31 / 14:40 / 18:37 |
| Carry | Phase Boots → Armlet → Desolator | 3/32 | 7:20 / 12:43 / 20:36 |
| Offlane | Phase Boots → Radiance → Blink Dagger | 16/46 | 7:33 / 18:39 / 21:55 |

Blink was the most common fourth purchase after the modal Carry opening, in 3 of its 8 games. The Carry benchmark uses that continuation. Offlane’s modal opening most often added Black King Bar fourth, in 6 of its 16 games. [Example Carry replay](https://www.opendota.com/matches/9098363995) · [Example Offlane replay](https://www.opendota.com/matches/9098326683)

The most common recorded Carry starting bundle was two Gauntlets, two Iron Branches, Quelling Blade, and a Tango pack for **580g**. It appeared in 5 of 32 games. [Example starting bundle](https://www.opendota.com/matches/9098355450)

## Carry DPS at the same gold budget

Each cell shows **15 / 20 / 30 minutes**. Gold is available to spend after the 1,500g reserve. The 15-, 20-, and 30-minute budgets use 32, 31, and 29 valid Carry gold timelines, respectively.

| Path | Bad farm | Good farm | Easy farm |
| --- | ---: | ---: | ---: |
| Spendable gold | 3,929 / 6,628 / 13,133 | 4,343 / 7,235 / 14,479 | 4,858 / 8,354 / 16,391 |
| **Replay baseline** · Phase → Radiance → Armlet → Blink | 64 / **156** / 250 | 64 / 156 / 250 | 97 / 156 / 250 |
| **Early spike** · Treads → Armlet → Desolator → Blink | **134** / 149 / 284 | **134** / 149 / 284 | **134** / **252** / 284 |
| **Cheap first spike** · Boots → Armlet → Phase → Blink → Desolator | 113 / 139 / 265 | 124 / 139 / 265 | 124 / 139 / 265 |
| **Farming alternative** · Treads → Maelstrom → Mjollnir → Blink → Desolator | 68 / 129 / **335** | 68 / **187** / **335** | 116 / 187 / **335** |
| **Early Radiance** · Boots → Radiance → Phase → Blink → Desolator | 88 / **156** / 253 | 88 / 156 / 253 | 88 / 156 / 253 |

- **Fight before minute 15.** Treads and Armlet cost **3,900g** and project 134 DPS against the replay route’s 64 on good farm. If you have **3,000–3,899g** for the build, regular Boots and Armlet give you a cheaper spike. With Armlet off, the Treads path drops to 88 DPS at minute 15.
- **Fight or push around minute 20.** With **7,400g**, Treads, Armlet, and Desolator produce 252 DPS at the easy-farm checkpoint against 156 for the replay route. The Desolator path finishes Blink around minute 22 in that case. When you need to initiate earlier, Phase Boots → Armlet → Blink finishes Blink at minute 19 on good farm, seven minutes before the modeled replay route. Add BKB if enemy control is cutting your attack time.
- **Farm into a stronger 20–30 minute damage window.** The Mjollnir path needs **6,900g** for Treads and Mjollnir. At minute 20 on good farm it spends 6,900g for 187 DPS versus 7,125g for 156. With Desolator and Blink by minute 30, it reaches 335 DPS versus 250. On bad farm the Mjollnir upgrade lands at minute 21 and Radiance leads at minute 20.
- **Keep Radiance when you can farm safely.** Delaying Phase Boots reduces the Radiance purchase threshold from **6,150g to 5,200g**. It finishes two minutes earlier on bad and good farm in this model. The tradeoff is more time on basic Boots.

### Sensitivity checks

- At **20 target armor**, Treads → Armlet → Desolator still wins at easy-farm minute 20, 169 to 126 DPS. At minute 30 the four-item Treads path is effectively even with the replay route, 192 to 194. Mjollnir holds a 242-to-194 lead.
- With **75 hypothetical extra gold per minute** once a farming item is complete, bad-farm Mjollnir reaches 187 DPS at minute 20 to the replay route’s 156. This tests an income assumption. Replay farm gains attributable to each item were unavailable.
- Allowing a BKB follow-up with Mithril Hammer along the way gives the easy-farm replay route **277 DPS** at minute 30. Under the same shopping rule, Treads → Armlet → Desolator reaches **323** with BKB and the Mjollnir path reaches **369** with the hammer held. BKB and Blink affect attack access and survival, which the DPS column cannot price.

For **Offlane**, the first job is reaching a target. In bad farm, regular Boots → Armlet reaches 113 DPS at minute 15 versus 64 for the Offlane replay path. On good farm, Phase → Armlet → Blink reaches Blink at minute 20 and BKB at 26. The modeled Offlane replay path reaches Blink at 23 and BKB at 30.

## How to read the comparison

The replay bank uses Ranked All Pick matches lasting at least 10 minutes. OpenDota estimates the lobby’s average medal and infers positions from parsed replays. Patch membership comes from the match start time and Valve’s release cutoff. The Wraith King bank is sampled from matches that appear in both OpenDota’s public feed and parsed replay index. [OpenDota API specification](https://github.com/odota/core/blob/master/svc/api/spec.ts) · [Valve’s 7.42 update](https://www.dota2.com/patches/7.42)

The common opening uses the first three major purchases in order. The count includes longer builds with that opening. Purchases at the same recorded second form a separate group. The rules include upgraded boots and omit recipes, consumables, stand-alone components, and consumable upgrades. The report shows the number of games for each opening, independent of wins.

Bad, good, and easy farm use the 25th, 50th, and 85th percentiles of Wraith King’s observed earned gold in the selected role. Each route holds the same hero level and income at every comparison minute, and keeps 1,500 gold for starting gear, consumables, and other spending. Purchases start contributing as soon as the model can afford them. The model credits consumed recipe components and prices one representative early component for Armlet and Radiance.

The damage test holds one target in range and uses 10 armor and 25% magic resistance. It includes Mortal Strike’s five-second cooldown and uses the strongest critical multiplier on overlapping crits. Armlet is toggled on in the main test, Power Treads are set to Strength, and Radiance contributes 45 magic DPS while the target stays in its aura. Bone Guard attacks, Reincarnation, spell damage, farming speed, chase time, and survival are outside the DPS estimate. [Valve’s Wraith King ability data](https://www.dota2.com/datafeed/herodata?hero_id=42&language=english) · [Pinned 7.42 item definitions](https://github.com/SteamTracking/GameTracking-Dota2/blob/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/scripts/npc/items.txt)

## Reproduce

```powershell
node scripts/wraith-king-replay-builds.mjs
node scripts/compare-wraith-king-builds.mjs
node scripts/compare-wraith-king-builds.mjs --role offlane
```

The [targeted snapshot](../data/7.42/wraith-king-replays.json) contains Wraith King’s normalized replay rows. The comparison command includes checkpoint budgets, sample sizes, held equipment, relative damage, and sensitivity cases for 20 armor, inactive Armlet, hypothetical extra farming income, and a follow-up item.
