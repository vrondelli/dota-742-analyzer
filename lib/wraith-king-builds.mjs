import { createInventoryEstimator } from './build-efficiency.mjs';
import { simulateBuildTimings } from './build-timings.mjs';

// Wraith King and item values from the pinned 7.42 client, build 6978.
const strikeUnlockLevels = [4, 8, 9, 11];
const strikeMultipliers = [160, 200, 240, 280];
const strikeCooldown = 5;
const radianceBurn = 60;
const armletHealthDrain = 45;
const clientDefinition = 'https://github.com/SteamTracking/GameTracking-Dota2/blob/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/scripts/npc';

const defaultAlternatives = [
  { key: 'armlet-rush', label: 'Boots → Armlet → Phase Boots → Blink → Desolator',
    note: 'Delay the boot upgrade to reach Armlet on a smaller budget.',
    itemKeys: ['boots', 'helm_of_iron_will', 'armlet', 'phase_boots', 'blink', 'desolator'] },
  { key: 'armlet-blink', label: 'Phase Boots → Armlet → Blink → Desolator',
    note: 'Complete the early fighting item, then buy target access.',
    itemKeys: ['boots', 'phase_boots', 'helm_of_iron_will', 'armlet', 'blink', 'desolator'] },
  { key: 'armlet-desolator', label: 'Phase Boots → Armlet → Desolator → Blink',
    note: 'Buy the same equipment with armor reduction before Blink.',
    itemKeys: ['boots', 'phase_boots', 'helm_of_iron_will', 'armlet', 'desolator', 'blink'] },
  { key: 'radiance-desolator', label: 'Phase Boots → Radiance → Desolator → Blink',
    note: 'Keep the early farming item while buying armor reduction before Blink.',
    itemKeys: ['boots', 'phase_boots', 'relic', 'radiance', 'desolator', 'blink'] },
  { key: 'radiance-rush', label: 'Boots → Radiance → Phase Boots → Blink → Desolator',
    note: 'Reach Radiance sooner by delaying the boots upgrade.',
    itemKeys: ['boots', 'relic', 'radiance', 'phase_boots', 'blink', 'desolator'] },
  { key: 'treads-armlet', label: 'Power Treads → Armlet → Desolator → Blink',
    note: 'Compare attack speed and Strength against Phase Boots and its active.',
    itemKeys: ['boots', 'power_treads', 'helm_of_iron_will', 'armlet', 'desolator', 'blink'] },
  { key: 'desolator-first', label: 'Phase Boots → Desolator → Armlet → Blink',
    note: 'Buy early armor reduction before finishing Armlet.',
    itemKeys: ['boots', 'phase_boots', 'desolator', 'helm_of_iron_will', 'armlet', 'blink'] },
  { key: 'mjollnir', label: 'Power Treads → Maelstrom → Mjollnir → Blink → Desolator',
    note: 'Test a lightning farming route and sustained attack speed. Lightning bounces and Static Charge are omitted.',
    itemKeys: ['boots', 'power_treads', 'maelstrom', 'mjollnir', 'blink', 'desolator'] },
  { key: 'armlet-protection', label: 'Phase Boots → Armlet → Blink → Black King Bar',
    note: 'Buy protection when spells and control stop you from attacking.',
    itemKeys: ['boots', 'phase_boots', 'helm_of_iron_will', 'armlet', 'blink', 'black_king_bar'] },
];

function combatItems(items, armletActive) {
  return items.map((item) => {
    if (item.key === 'armlet' && armletActive) {
      const { stats } = item;
      return { ...item, stats: { ...stats, strength: (stats.strength ?? 0) + 25,
        attackDamage: (stats.attackDamage ?? 0) + 35, armor: (stats.armor ?? 0) + 4 } };
    }
    if (item.key === 'power_treads') {
      return { ...item, stats: { ...item.stats, strength: (item.stats.strength ?? 0) + 10 } };
    }
    return item;
  });
}

function mortalStrike(level, inventory, attack, estimate) {
  const rank = strikeUnlockLevels.filter((unlock) => unlock <= level).length;
  if (!rank) return { mortalStrikeRank: 0, mortalStrikeDps: 0 };
  const effect = { kind: 'critical', chance: 100, multiplier: strikeMultipliers[rank - 1] };
  const strike = estimate([...inventory, { key: 'mortal_strike', stats: {}, effects: [effect] }], level);
  const attacksPerStrike = Math.max(1, Math.ceil(strikeCooldown * attack.attacksPerSecond - 1e-8));
  return { mortalStrikeRank: rank, mortalStrikeDps: (strike.physicalDps - attack.physicalDps) / attacksPerStrike };
}

function atPoint(level, inventory, estimate, targetMagicResistance) {
  const attack = estimate(inventory, level);
  const { mortalStrikeRank, mortalStrikeDps } = mortalStrike(level, inventory, attack, estimate);
  const radianceBurnDps = inventory.some(({ key }) => key === 'radiance') ? radianceBurn * (1 - targetMagicResistance / 100) : 0;
  const physicalDps = attack.physicalDps + mortalStrikeDps;
  return { physicalDps, procDps: attack.procDps, mortalStrikeRank, mortalStrikeDps, radianceBurnDps,
    dps: physicalDps + attack.procDps + radianceBurnDps };
}

export function compareWraithKingBuilds({ hero, items, checkpoints, baseline, options = {}, alternatives = defaultAlternatives }) {
  if (hero?.id !== 42 || hero.primaryAttribute !== 'strength') throw new RangeError('Select Wraith King for this benchmark.');
  const { targetArmor = 10, targetMagicResistance = 25, bonusGpm = 0, armletActive = true } = options;
  const combat = { targetArmor, targetMagicResistance, bonusGpm };
  const definitions = [
    { key: 'baseline', label: 'Replay baseline', note: 'Prices the supplied observed core item order.', itemKeys: baseline },
    ...alternatives,
  ];
  const paths = definitions.map(({ key, label, note, itemKeys }) => {
    if (!Array.isArray(itemKeys)) throw new RangeError('Supply a list of item keys for each Wraith King path.');
    return { key, label, note, steps: itemKeys.map((itemKey) => ({ key: itemKey })) };
  });
  const comparison = simulateBuildTimings({ hero, items, checkpoints, paths, options: { ...combat, maxPurchases: 9 } });
  const estimate = createInventoryEstimator(hero, { ...combat, includeActives: false });
  const catalog = new Map(combatItems(items, armletActive).map((item) => [item.key, item]));
  const inactiveCatalog = new Map(combatItems(items, false).map((item) => [item.key, item]));
  return {
    ...comparison,
    options: { ...comparison.options, armletActive },
    paths: comparison.paths.map((path) => ({ ...path, points: path.points.map((point) => {
      const inventory = point.items.map(({ key }) => catalog.get(key));
      const metrics = atPoint(point.level, inventory, estimate, targetMagicResistance);
      const active = armletActive && inventory.some(({ key }) => key === 'armlet');
      const armletDrainPerSecond = active ? armletHealthDrain : 0;
      const armletOffDps = active
        ? atPoint(point.level, point.items.map(({ key }) => inactiveCatalog.get(key)), estimate, targetMagicResistance).dps
        : metrics.dps;
      const mobility = point.items.filter(({ key }) => key.endsWith('blink') || key === 'phase_boots').map(({ name }) => name);
      const spellProtection = point.items.some(({ key }) => key === 'black_king_bar');
      return { ...point, ...metrics, genericDps: point.dps, armletOffDps, armletDrainPerSecond, mobility, spellProtection };
    }) })),
    assumptions: [
      'Mortal Strike follows the pinned guide at hero levels 4, 8, 9, and 11. With continuous attacks, the next attack after its five-second cooldown receives the crit. The highest critical multiplier applies on a hit.',
      'Radiance deals 60 base magical damage per second to the target while it remains in the full-hero aura. Armlet assumes the stated toggle setting, with 45 health drained per second when active. Power Treads is set to Strength.',
      'This continuous-attack comparison keeps armor and magic resistance fixed. In a match, Blink and Phase Boots help you reach targets and Bone Guard skeletons can add damage and speed up farming. This benchmark omits skeleton attacks, Wraithfire Blast, talents, survival, and actual fight uptime.',
      'Replay spending on starting gear, consumables, and other omitted purchases is represented by the shared reserve. Any extra farming income in the simulation is a hypothesis.',
      'Once a path completes its last listed purchase, later gold remains unspent. Extend shorter paths when comparing late-game budgets.',
    ],
    sources: {
      patch: 'https://www.dota2.com/patches/7.42',
      hero: 'https://www.dota2.com/datafeed/herodata?hero_id=42&language=english',
      clientHero: `${clientDefinition}/heroes/npc_dota_hero_skeleton_king.txt`,
      clientItems: `${clientDefinition}/items.txt`,
    },
  };
}
