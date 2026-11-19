import { BUILD_DEFAULTS, createInventoryEstimator, estimateAttackDps } from './build-efficiency.mjs';
import { learnedSpell } from './role-builds.mjs';

const criterionLabels = {
  dps: { label: 'Attack DPS', unit: 'DPS' },
  burst: { label: 'Modeled magic burst', unit: 'damage' },
  durability: { label: 'Physical and magic durability', unit: 'pt' },
  sustain: { label: 'Mana and mana regeneration', unit: 'pt' },
  auras: { label: 'Modeled team auras', unit: 'pt' },
  utility: { label: 'Item utility rating', unit: 'pt' },
};

const roleObjectives = {
  carry: { label: 'Sustained attack damage', weights: { dps: 100 } },
  mid: { label: 'Mid damage and casting', weights: { burst: 45, dps: 25, sustain: 20, utility: 10 } },
  offlane: { label: 'Offlane durability and team value', weights: { durability: 45, utility: 30, auras: 20, dps: 5 } },
  'soft-support': { label: 'Soft support catch and saves', weights: { utility: 55, sustain: 15, auras: 15, durability: 15 } },
  'hard-support': { label: 'Hard support saves and sustain', weights: { utility: 55, auras: 20, sustain: 15, durability: 10 } },
};

// Ability availability ratings are heuristic, separate from numeric combat effects.
// Each role rewards the strongest held item in each category once.
const utilityRatings = new Map(Object.entries({
  blink: { initiation: 1 },
  overwhelming_blink: { initiation: 1 },
  swift_blink: { initiation: 1 },
  arcane_blink: { initiation: 1 },
  invis_sword: { initiation: 0.65 },
  silver_edge: { initiation: 0.65, catch: 0.35 },
  rod_of_atos: { catch: 0.75 },
  gungir: { catch: 0.95 },
  sheepstick: { catch: 1 },
  orchid: { catch: 0.65 },
  bloodthorn: { catch: 0.8 },
  heavens_halberd: { catch: 0.45, save: 0.5 },
  cyclone: { catch: 0.45, self: 0.55 },
  wind_waker: { catch: 0.45, save: 1, self: 0.65 },
  force_staff: { save: 0.85, reach: 0.5 },
  hurricane_pike: { save: 0.85, reach: 0.65 },
  glimmer_cape: { save: 0.9 },
  pavise: { save: 0.6 },
  solar_crest: { save: 0.75 },
  lotus_orb: { save: 0.85, self: 0.35 },
  spirit_vessel: { catch: 0.35, save: 0.35 },
  disperser: { save: 0.65, catch: 0.35, reach: 0.5 },
  arcane_boots: { team: 0.45 },
  mekansm: { team: 0.65 },
  guardian_greaves: { team: 0.95 },
  pipe: { team: 0.85 },
  crimson_guard: { team: 0.8 },
  ancient_janggo: { team: 0.4 },
  boots_of_bearing: { team: 0.65 },
  black_king_bar: { self: 0.95 },
  aeon_disk: { self: 0.7 },
  sphere: { self: 0.65, save: 0.4 },
  ghost: { self: 0.55 },
  manta: { self: 0.55 },
  satanic: { self: 0.65 },
  aether_lens: { reach: 0.85 },
  ethereal_blade: { reach: 0.85, save: 0.55 },
}));

const utilityWeights = {
  mid: { initiation: 20, catch: 25, save: 5, team: 0, self: 35, reach: 15 },
  offlane: { initiation: 38, catch: 14, save: 10, team: 25, self: 8, reach: 5 },
  'soft-support': { initiation: 24, catch: 24, save: 26, team: 12, self: 5, reach: 9 },
  'hard-support': { initiation: 8, catch: 14, save: 40, team: 26, self: 5, reach: 7 },
};

const auraReference = Object.entries({
  auraArmor: 8, auraAttackDamagePct: 40, auraAttackSpeed: 40, auraMagicResistance: 25,
  auraHealthRegen: 10, auraManaRegen: 5, auraArmorReduction: 8, auraAttackSpeedReduction: 40,
});

function utilityPoints(inventory, role) {
  const best = { initiation: 0, catch: 0, save: 0, team: 0, self: 0, reach: 0 };
  for (const { key } of inventory) {
    const rating = utilityRatings.get(key);
    if (!rating) continue;
    for (const category in rating) best[category] = Math.max(best[category], rating[category]);
  }
  const weights = utilityWeights[role];
  return best.initiation * weights.initiation + best.catch * weights.catch + best.save * weights.save
    + best.team * weights.team + best.self * weights.self + best.reach * weights.reach;
}

function gainPoints(value, base, reference = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(base)) return 0;
  return Math.min(150, 100 * (value - base) / Math.max(base, reference));
}

export function createBuildRoleScorer(hero, role, input = {}) {
  if (!Object.hasOwn(roleObjectives, role)) throw new RangeError('Select a supported build role.');
  const objective = roleObjectives[role];
  const options = { ...input, baseSpellDamage: 0, windowSeconds: 10 };
  const criteria = Object.entries(objective.weights).map(([key, weight]) => ({ key, weight, ...criterionLabels[key] }));
  const baselines = new Map();

  if (role === 'carry') {
    return {
      label: objective.label,
      scoreUnit: 'DPS',
      description: 'Ranks physical attacks and supported passive magic procs against one target, using the same hero level and defenses for every build.',
      criteria,
      utilityItemKeys: [],
      score(inventory, level) {
        if (!baselines.has(level)) baselines.set(level, estimateAttackDps(hero, [], { ...options, level }).dps);
        const metrics = estimateAttackDps(hero, inventory, { ...options, level });
        return { score: metrics.dps, metrics: { ...metrics, dpsGain: metrics.dps - baselines.get(level) } };
      },
    };
  }

  const estimate = createInventoryEstimator(hero, options);
  const spellCurve = new Map();
  const targetMagicMultiplier = 1 - (options.targetMagicResistance ?? BUILD_DEFAULTS.targetMagicResistance) / 100;
  return {
    label: objective.label,
    scoreUnit: 'pt',
    description: `${role === 'mid' ? 'Magic burst uses the strongest supported learned spell where mapped, plus modeled ready item actives. ' : ''}The role score weights gains above the empty inventory at the same level. Utility uses explicit item ratings for initiation, catch, saves, team effects, personal protection, and reach, with the strongest item in each category counted once. Aura points use effects on one in-range ally or enemy.`,
    criteria,
    utilityItemKeys: [...utilityRatings.keys()],
    score(inventory, level) {
      if (!baselines.has(level)) {
        baselines.set(level, estimate([], level));
        const spell = role === 'mid' ? learnedSpell(input.spells ?? [], level) : null;
        spellCurve.set(level, (spell?.damage ?? 0) * targetMagicMultiplier);
      }
      const base = baselines.get(level);
      const current = estimate(inventory, level);
      const baseCast = spellCurve.get(level);
      const burst = baseCast * (1 + current.spellAmp / 100) + current.activeMagicDamage;
      const durability = (gainPoints(current.physicalEhp, base.physicalEhp) + gainPoints(current.magicEhp, base.magicEhp)) / 2;
      const sustain = 0.4 * gainPoints(current.mana, base.mana, 300) + 0.6 * gainPoints(current.manaRegen, base.manaRegen, 1.5);
      const auras = Math.min(150, auraReference.reduce((total, [key, reference]) => total + 100 * (current[key] - base[key]) / reference, 0));
      const utility = utilityPoints(inventory, role);
      const metrics = { dps: current.dps, physicalDps: current.physicalDps, procDps: current.procDps, dpsGain: current.dps - base.dps,
        burst, durability, sustain, auras, utility, physicalEhp: current.physicalEhp, magicEhp: current.magicEhp, manaRegen: current.manaRegen };
      const gain = { durability, sustain, auras, utility, dps: gainPoints(current.dps, base.dps), burst: gainPoints(burst, baseCast, 250) };
      const score = criteria.reduce((sum, { key, weight }) => sum + gain[key] * weight / 100, 0);
      return { score, metrics };
    },
  };
}
