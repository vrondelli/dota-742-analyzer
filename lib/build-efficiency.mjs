const metricGroups = {
  Attacks: [
    ['physicalDps', 'Physical attack DPS', 'damage/s'],
    ['damagePerHit', 'Raw attack damage per hit', 'damage'],
    ['attackSpeed', 'Attack speed', 'AS'],
    ['attacksPerSecond', 'Attacks per second', 'attacks/s'],
  ],
  Magic: [
    ['magicalDamage', 'Magical damage in window', 'damage'],
    ['spellAmp', 'Spell amplification', 'pp'],
  ],
  Defense: [
    ['armor', 'Armor', 'armor'],
    ['health', 'Maximum health', 'HP'],
    ['physicalEhp', 'Physical effective HP', 'HP'],
    ['magicResistance', 'Magic resistance', 'pp'],
    ['magicEhp', 'Magical effective HP', 'HP'],
    ['healthRegen', 'Health regeneration', 'HP/s'],
  ],
  Utility: [
    ['mana', 'Maximum mana', 'mana'],
    ['manaRegen', 'Mana regeneration', 'mana/s'],
    ['moveSpeed', 'Movement speed', 'units/s'],
  ],
  Auras: [
    ['auraArmor', 'Armor aura per ally', 'armor'],
    ['auraAttackDamagePct', 'Base attack damage aura per ally', 'pp'],
    ['auraAttackSpeed', 'Attack speed aura per ally', 'AS'],
    ['auraMagicResistance', 'Magic resistance aura per ally', 'pp'],
    ['auraHealthRegen', 'Health regeneration aura per ally', 'HP/s'],
    ['auraManaRegen', 'Mana regeneration aura per ally', 'mana/s'],
    ['auraArmorReduction', 'Armor reduction aura per enemy', 'armor'],
    ['auraAttackSpeedReduction', 'Attack speed reduction aura per enemy', 'AS'],
  ],
};

export const BUILD_METRICS = Object.freeze(Object.entries(metricGroups).flatMap(([group, rows]) =>
  rows.map(([key, label, unit]) => Object.freeze({ key, label, unit, group }))));

export const ABILITY_BUILD_METRIC = Object.freeze({
  key: 'abilityDamage',
  label: 'Ability damage per cast',
  unit: 'damage',
  group: 'Abilities',
});

export const BUILD_DEFAULTS = Object.freeze({
  level: 7,
  budget: 3000,
  maxItems: 2,
  metric: 'physicalDps',
  targetArmor: 10,
  targetMagicResistance: 25,
  baseSpellDamage: 200,
  windowSeconds: 10,
  includeActives: true,
  includeOnHit: true,
  includeAuras: true,
});

const attributes = ['strength', 'agility', 'intelligence'];
const auraMetrics = {
  auraArmor: ['allies', 'armor'],
  auraAttackDamagePct: ['allies', 'attackDamagePct'],
  auraAttackSpeed: ['allies', 'attackSpeed'],
  auraMagicResistance: ['allies', 'magicResistance'],
  auraHealthRegen: ['allies', 'healthRegen'],
  auraManaRegen: ['allies', 'manaRegen'],
  auraArmorReduction: ['enemies', 'armorReduction'],
};
const boots = new Set([
  'boots', 'travel_boots', 'travel_boots_2', 'phase_boots', 'power_treads',
  'arcane_boots', 'guardian_greaves', 'tranquil_boots', 'boots_of_bearing',
  'sabatons_of_mordiggian',
]);
const kayaFamily = new Set(['kaya', 'kaya_and_sange', 'yasha_and_kaya', 'meteor_hammer', 'starforge']);
const validMetric = new Set([...BUILD_METRICS, ABILITY_BUILD_METRIC].map(({ key }) => key));
const EPSILON = 1e-9;
const minAttackSpeed = 20;
const maxAttackSpeed = 700;

export function getModeledAbility(heroId, level) {
  if (heroId !== 8 || level < 6) return null;
  const rank = level >= 18 ? 3 : level >= 12 ? 2 : 1;
  return {
    key: 'juggernaut_omni_slash',
    name: 'Omnislash',
    rank,
    durationSeconds: [3, 3.25, 3.5][rank - 1],
    bonusAttackSpeed: 40,
    attackRateMultiplier: 1.4,
    bonusDamage: [25, 30, 35][rank - 1],
  };
}

export function armorDamageMultiplier(armor) {
  const factor = 0.06 * armor;
  return 1 - factor / (1 + Math.abs(factor));
}

function magicResistance(sources) {
  const multiplier = sources.reduce((total, resistance) => total * (1 - resistance / 100), 1);
  return (1 - multiplier) * 100;
}

function sumStats(items) {
  const flat = {};
  const resists = [];
  let bootSpeed;
  let kayaSpellAmp;
  for (const item of items) {
    for (const [stat, value] of Object.entries(item.stats ?? {})) {
      if (!Number.isFinite(value)) continue;
      if (stat === 'magicResistance') resists.push(value);
      else if (stat === 'moveSpeed' && boots.has(item.key)) bootSpeed = Math.max(bootSpeed ?? 0, value);
      else if (stat === 'spellAmp' && kayaFamily.has(item.key)) kayaSpellAmp = Math.max(kayaSpellAmp ?? 0, value);
      else flat[stat] = (flat[stat] ?? 0) + value;
    }
  }
  if (bootSpeed !== undefined) flat.moveSpeed = (flat.moveSpeed ?? 0) + bootSpeed;
  if (kayaSpellAmp !== undefined) flat.spellAmp = (flat.spellAmp ?? 0) + kayaSpellAmp;
  return { flat, resists };
}

function auraStats(items, enabled) {
  const result = { allies: {}, enemies: {} };
  if (!enabled) return result;
  const strongest = new Map();
  const entries = [];
  for (const item of items) {
    for (const aura of item.auras ?? []) {
      if (!Object.hasOwn(result, aura.recipient)) continue;
      for (const [stat, value] of Object.entries(aura.stats ?? {})) {
        if (!Number.isFinite(value)) continue;
        const group = aura.stackGroups?.[stat] ?? aura.stackGroup;
        entries.push({ recipient: aura.recipient, stat, value, group, blockedBy: aura.blockedBy?.[stat] ?? [] });
      }
    }
  }
  const activeGroups = new Set(entries.filter((entry) => entry.group).map((entry) =>
    `${entry.recipient}:${entry.stat}:${entry.group}`));
  const applying = [];
  for (const entry of entries) {
    const base = `${entry.recipient}:${entry.stat}:`;
    if (entry.blockedBy.some((group) => activeGroups.has(base + group))) continue;
    if (!entry.group) applying.push(entry);
    else {
      const key = base + entry.group;
      if (!strongest.has(key) || Math.abs(strongest.get(key).value) < Math.abs(entry.value)) {
        strongest.set(key, entry);
      }
    }
  }
  for (const { recipient, stat, value } of [...applying, ...strongest.values()]) {
    const previous = result[recipient][stat] ?? 0;
    result[recipient][stat] = stat === 'magicResistance'
      ? magicResistance([previous, value])
      : previous + value;
  }
  return result;
}

function activeDamage(effects, enabled, windowSeconds) {
  if (!enabled) return 0;
  const groups = new Map();
  for (const effect of effects) {
    if (effect.kind !== 'magic-active' || !Number.isFinite(effect.damage)) continue;
    const key = effect.stackGroup ?? effect.key;
    const ticks = effect.tickInterval > 0 && effect.tickDuration > 0
      && Number.isFinite(effect.damagePerTick)
      ? Math.floor(Math.min(windowSeconds, effect.tickDuration) / effect.tickInterval)
      : 0;
    const damage = effect.damage + (ticks ? ticks * effect.damagePerTick : 0);
    groups.set(key, Math.max(groups.get(key) ?? 0, damage));
  }
  return [...groups.values()].reduce((total, damage) => total + damage, 0);
}

function passiveDamage(effects, attacks, duration, spellAmp) {
  const groups = new Map();
  for (const effect of effects) {
    if (effect.kind !== 'magic-on-hit' || !Number.isFinite(effect.damage)
      || !Number.isFinite(effect.chance)) continue;
    const key = effect.stackGroup ?? effect.key;
    const procCount = attacks * effect.chance / 100;
    const rateLimit = effect.cooldown > 0 ? Math.ceil(duration / effect.cooldown) : Infinity;
    const spellMultiplier = effect.spellAmplified === true || effect.stackGroup === 'chain-lightning'
      ? 1 + spellAmp / 100
      : 1;
    const damage = Math.min(procCount, rateLimit) * effect.damage * spellMultiplier;
    groups.set(key, Math.max(groups.get(key) ?? 0, damage));
  }
  return [...groups.values()].reduce((total, damage) => total + damage, 0);
}

function critMultiplier(effects) {
  const crits = effects.filter((effect) => effect.kind === 'critical'
    && Number.isFinite(effect.chance) && Number.isFinite(effect.multiplier))
    .sort((a, b) => b.multiplier - a.multiplier);
  let multiplier = 0;
  let remaining = 1;
  for (const crit of crits) {
    const probability = crit.chance / 100;
    multiplier += remaining * probability * crit.multiplier / 100;
    remaining *= 1 - probability;
  }
  return multiplier + remaining;
}

function armorReducedByHits(effects) {
  const groups = new Map();
  for (const effect of effects) {
    if (effect.kind !== 'armor-reduction' || !Number.isFinite(effect.armorReduction)) continue;
    const key = effect.stackGroup ?? effect.key;
    groups.set(key, Math.max(groups.get(key) ?? 0, effect.armorReduction));
  }
  return [...groups.values()].reduce((total, reduction) => total + reduction, 0);
}

function prepareBuild(items, options) {
  const { flat, resists } = sumStats(items);
  const auras = auraStats(items, options.includeAuras);
  const selfAura = auras.allies;
  const effects = items.flatMap((item) => item.effects ?? []);
  const enemyArmor = options.targetArmor - (auras.enemies.armorReduction ?? 0)
    - (options.includeOnHit ? armorReducedByHits(effects) : 0);
  const spellAmp = flat.spellAmp ?? 0;
  const targetMagicMultiplier = 1 - options.targetMagicResistance / 100;
  const spellMultiplier = (1 + spellAmp / 100) * targetMagicMultiplier;
  const auraMetricsValues = Object.fromEntries(Object.entries(auraMetrics).map(([key, [recipient, stat]]) =>
    [key, auras[recipient][stat] ?? 0]));
  return {
    flat,
    resists,
    auras,
    selfAura,
    enemyArmor,
    spellAmp,
    spellMultiplier,
    targetMagicMultiplier,
    attackFactor: armorDamageMultiplier(enemyArmor) * (options.includeOnHit ? critMultiplier(effects) : 1),
    universalAttackDamage: attributes.reduce((total, key) => total + (flat[key] ?? 0), 0) * 0.45,
    activeMagicDamage: activeDamage(effects, options.includeActives, options.windowSeconds) * spellMultiplier,
    hitEffects: options.includeOnHit ? effects.filter(({ kind }) => kind === 'magic-on-hit') : [],
    auraAttackSpeedReduction: Math.max(0, -(auras.enemies.attackSpeed ?? 0)),
    auraMetricsValues,
  };
}

function attackDamage(hero, level, build) {
  const { flat, selfAura, universalAttackDamage } = build;
  const attributesAdded = hero.primaryAttribute === 'universal'
    ? universalAttackDamage
    : flat[hero.primaryAttribute] ?? 0;
  return (level.meanAttackDamage + attributesAdded) * (1 + (selfAura.attackDamagePct ?? 0) / 100)
    + (flat.attackDamage ?? 0) + (selfAura.attackDamage ?? 0);
}

function totalAttackSpeed(level, { flat, selfAura }, extra = 0) {
  const speed = level.attackSpeed + (flat.agility ?? 0) + (flat.attackSpeed ?? 0) + (selfAura.attackSpeed ?? 0) + extra;
  return Math.max(minAttackSpeed, Math.min(maxAttackSpeed, speed));
}

function abilityCast(hero, level, build, ability) {
  const { durationSeconds, bonusAttackSpeed, attackRateMultiplier, bonusDamage } = ability;
  const ratePerAttackSpeed = attackRateMultiplier / (100 * hero.baseAttackTime);
  const preCastAttackSpeed = totalAttackSpeed(level, build);
  const attackSpeed = totalAttackSpeed(level, build, bonusAttackSpeed);
  const slashRate = attackSpeed * ratePerAttackSpeed;
  const slashInterval = 1 / slashRate;
  const hits = Math.max(1, Math.ceil(durationSeconds * slashRate - EPSILON));
  const nextSlashingSpeed = hits / (durationSeconds * ratePerAttackSpeed);
  const nextAttackSpeedThreshold = nextSlashingSpeed < maxAttackSpeed - EPSILON
    ? nextSlashingSpeed - bonusAttackSpeed
    : null;
  const damagePerHit = (attackDamage(hero, level, build) + bonusDamage) * build.attackFactor;
  return {
    hits,
    damage: hits * damagePerHit,
    damagePerHit,
    attackSpeed,
    preCastAttackSpeed,
    slashRate,
    slashInterval,
    lastHitMarginSeconds: durationSeconds - (hits - 1) * slashInterval,
    hitsWith33msDelay: Math.max(1, Math.ceil(durationSeconds / (slashInterval + 0.033) - EPSILON)),
    nextAttackSpeedThreshold,
  };
}

function onHitDamage(build, attacksPerSecond, windowSeconds) {
  return build.hitEffects.length
    ? passiveDamage(build.hitEffects, attacksPerSecond * windowSeconds, windowSeconds, build.spellAmp)
      * build.targetMagicMultiplier
    : 0;
}

function estimate(hero, level, build, options) {
  const { flat, resists, auras, selfAura, enemyArmor, spellAmp, spellMultiplier, activeMagicDamage } = build;
  const rawAttack = attackDamage(hero, level, build);
  const attackSpeed = totalAttackSpeed(level, build);
  const attacksPerSecond = attackSpeed / (100 * hero.baseAttackTime);

  const nakedArmor = options.ownArmor ?? (Number.isFinite(hero.baseArmor) ? hero.baseArmor + level.agility / 6 : null);
  const armor = nakedArmor === null ? null
    : nakedArmor + (flat.agility ?? 0) / 6 + (flat.armor ?? 0) + (selfAura.armor ?? 0);
  const health = (options.ownHealth ?? ((hero.baseHealth ?? 200) + level.strength * 20))
    + (flat.strength ?? 0) * 20 + (flat.health ?? 0);
  const baseResistance = options.ownMagicResistance ?? hero.baseMagicResistance ?? 25;
  const intelligenceResistance = ((flat.intelligence ?? 0) + (options.ownMagicResistance === undefined
    ? level.intelligence : 0)) * 0.125;
  const resist = magicResistance([baseResistance, intelligenceResistance, ...resists, selfAura.magicResistance ?? 0]);
  const onHitMagicDamage = onHitDamage(build, attacksPerSecond, options.windowSeconds);
  const ability = options.metric === 'abilityDamage' ? getModeledAbility(hero.id, level.level) : null;
  const cast = ability && abilityCast(hero, level, build, ability);
  return {
    physicalDps: rawAttack * attacksPerSecond * build.attackFactor,
    magicalDamage: options.baseSpellDamage * spellMultiplier + activeMagicDamage + onHitMagicDamage,
    damagePerHit: rawAttack,
    attackSpeed,
    attacksPerSecond,
    armor,
    health,
    physicalEhp: armor === null ? null : health / armorDamageMultiplier(armor),
    magicResistance: resist,
    magicEhp: health / (1 - resist / 100),
    healthRegen: Number.isFinite(hero.baseHealthRegen)
      ? hero.baseHealthRegen + (level.strength + (flat.strength ?? 0)) * 0.1
        + (flat.healthRegen ?? 0) + (selfAura.healthRegen ?? 0)
      : null,
    mana: Number.isFinite(hero.baseMana)
      ? hero.baseMana + (level.intelligence + (flat.intelligence ?? 0)) * 12 + (flat.mana ?? 0)
      : null,
    manaRegen: Number.isFinite(hero.baseManaRegen)
      ? hero.baseManaRegen + (level.intelligence + (flat.intelligence ?? 0)) * 0.05
        + (flat.manaRegen ?? 0) + (selfAura.manaRegen ?? 0)
      : null,
    moveSpeed: Number.isFinite(hero.baseMoveSpeed) ? hero.baseMoveSpeed + (flat.moveSpeed ?? 0) : null,
    spellAmp,
    enemyArmor,
    activeMagicDamage,
    onHitMagicDamage,
    auras,
    auraAttackSpeedReduction: build.auraAttackSpeedReduction,
    ...build.auraMetricsValues,
    ...(options.metric === 'abilityDamage' ? {
      abilityDamage: cast?.damage ?? null,
      ability: cast && { ...ability, ...cast },
    } : {}),
  };
}

function validatedOptions(input) {
  const {
    level = BUILD_DEFAULTS.level,
    budget = BUILD_DEFAULTS.budget,
    maxItems = BUILD_DEFAULTS.maxItems,
    metric = input.mode === 'magic' ? 'magicalDamage' : BUILD_DEFAULTS.metric,
    targetArmor = BUILD_DEFAULTS.targetArmor,
    targetMagicResistance = BUILD_DEFAULTS.targetMagicResistance,
    baseSpellDamage = BUILD_DEFAULTS.baseSpellDamage,
    windowSeconds = BUILD_DEFAULTS.windowSeconds,
    includeActives = BUILD_DEFAULTS.includeActives,
    includeOnHit = BUILD_DEFAULTS.includeOnHit,
    includeAuras = BUILD_DEFAULTS.includeAuras,
    ownArmor,
    ownMagicResistance,
    ownHealth,
    itemKeys,
  } = input;
  if (!Number.isInteger(level) || level < 1 || level > 30) throw new RangeError('Select a hero level from 1 to 30.');
  if (![1, 2].includes(maxItems)) throw new RangeError('Select one or two inventory slots.');
  if (!validMetric.has(metric)) throw new RangeError('Select a supported build metric.');
  for (const [name, value, lower, upper] of [
    ['budget', budget, 0, 100_000], ['targetArmor', targetArmor, -300, 300],
    ['targetMagicResistance', targetMagicResistance, -100, 99.9],
    ['baseSpellDamage', baseSpellDamage, 0, 100_000], ['windowSeconds', windowSeconds, 0.1, 120],
    ['ownArmor', ownArmor ?? 0, -300, 300], ['ownMagicResistance', ownMagicResistance ?? 0, -100, 99.9],
    ['ownHealth', ownHealth ?? 1, 1, 100_000],
  ]) {
    if (!Number.isFinite(value) || value < lower || value > upper) {
      throw new RangeError(`${name} must be between ${lower} and ${upper}.`);
    }
  }
  if (![includeActives, includeOnHit, includeAuras].every((value) => typeof value === 'boolean')) {
    throw new TypeError('Effect selection must be boolean.');
  }
  if (itemKeys !== undefined && (!Array.isArray(itemKeys) || itemKeys.length < 1
    || itemKeys.length > maxItems || new Set(itemKeys).size !== itemKeys.length
    || !itemKeys.every((key) => typeof key === 'string' && key.length > 0))) {
    throw new RangeError('Select distinct items within the available slots.');
  }
  return {
    level, budget, maxItems, metric, targetArmor, targetMagicResistance, baseSpellDamage, windowSeconds,
    includeActives, includeOnHit, includeAuras, ownArmor: ownArmor ?? undefined,
    ownMagicResistance: ownMagicResistance ?? undefined, ownHealth: ownHealth ?? undefined, itemKeys,
  };
}

function canPair(a, b) {
  return !(a.exclusiveGroup && a.exclusiveGroup === b.exclusiveGroup)
    && !(a.key.startsWith('dagon') && b.key.startsWith('dagon'))
    && ![a.key, b.key].every((key) => key === 'rapier' || key === 'caster_rapier');
}

function coverageFor(items) {
  if (items.every((item) => item.coverage === 'unmodelled')) return 'unmodelled';
  return items.every((item) => item.coverage === 'flat') ? 'flat' : 'partial';
}

function shopItems(items) {
  return items.filter(({ key, cost }) => typeof key === 'string' && Number.isFinite(cost) && cost > 0);
}

function* affordableBuilds(items, budget, maxItems) {
  const affordable = items.filter(({ cost }) => cost <= budget);
  for (const item of affordable) yield { items: [item], cost: item.cost };
  if (maxItems === 1) return;
  for (let left = 0; left < affordable.length - 1; left += 1) {
    const first = affordable[left];
    for (let right = left + 1; right < affordable.length; right += 1) {
      const second = affordable[right];
      const cost = first.cost + second.cost;
      if (cost <= budget && canPair(first, second)) yield { items: [first, second], cost };
    }
  }
}

function markFrontier(rows) {
  let bestGain = 0;
  const ranked = rows.filter((row) => row.gain !== null).sort((a, b) => a.cost - b.cost || b.gain - a.gain);
  for (const row of ranked) {
    if (row.gain <= bestGain + EPSILON) continue;
    row.frontier = true;
    bestGain = row.gain;
  }
}

function heroAtLevel(hero, heroLevel) {
  const level = hero.levels?.find((stats) => stats.level === heroLevel);
  if (!level || !Number.isFinite(hero.baseAttackTime) || hero.baseAttackTime <= 0) {
    throw new RangeError('The selected hero has no stats at that level.');
  }
  return level;
}

export function estimateAttackDps(hero, items, input = {}) {
  const options = validatedOptions({ ...input, includeActives: false });
  const level = heroAtLevel(hero, options.level);
  const build = prepareBuild(items, options);
  const attacksPerSecond = totalAttackSpeed(level, build) / (100 * hero.baseAttackTime);
  const physicalDps = attackDamage(hero, level, build) * attacksPerSecond * build.attackFactor;
  const procDps = onHitDamage(build, attacksPerSecond, options.windowSeconds) / options.windowSeconds;
  return { physicalDps, procDps, dps: physicalDps + procDps };
}

export function analyzeBuilds(hero, items, input = {}) {
  const options = validatedOptions(input);
  const level = heroAtLevel(hero, options.level);
  const baseline = estimate(hero, level, prepareBuild([], options), options);
  const eligible = shopItems(items);
  const byKey = new Map(eligible.map((item) => [item.key, item]));
  const rows = [];
  const singles = new Map();

  function evaluate(build) {
    const coverage = coverageFor(build);
    const metrics = estimate(hero, level, prepareBuild(build, options), options);
    const before = baseline[options.metric];
    const after = metrics[options.metric];
    const gain = coverage === 'unmodelled' || !Number.isFinite(before) || !Number.isFinite(after)
      ? null
      : after - before;
    const cost = build.reduce((total, item) => total + item.cost, 0);
    const notes = [...new Set(build.flatMap((item) => item.notes ?? []))];
    const singleGains = build.map((item) => singles.get(item.key)?.gain);
    const synergy = build.length === 2 && gain !== null && singleGains.every(Number.isFinite)
      ? gain - singleGains[0] - singleGains[1] : null;
    return {
      items: build, cost, metrics, gain, gainPer1000: gain === null ? null : gain / cost * 1000,
      frontier: false, coverage, notes, synergy,
    };
  }

  if (options.itemKeys) {
    const selected = options.itemKeys.map((key) => byKey.get(key));
    if (selected.some((item) => !item)) throw new RangeError('A selected item is outside the shop catalog.');
    if (selected.length === 2 && !canPair(selected[0], selected[1])) {
      throw new RangeError('Those items share an upgrade family.');
    }
    if (selected.reduce((total, item) => total + item.cost, 0) <= options.budget) {
      for (const item of selected) singles.set(item.key, evaluate([item]));
      rows.push(selected.length === 1 ? singles.get(selected[0].key) : evaluate(selected));
    }
  } else {
    for (const { items: build } of affordableBuilds(eligible, options.budget, options.maxItems)) {
      const row = evaluate(build);
      if (build.length === 1) singles.set(build[0].key, row);
      rows.push(row);
    }
  }

  if (!options.itemKeys) markFrontier(rows);
  rows.sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity)
    || a.cost - b.cost || a.items[0].key.localeCompare(b.items[0].key)
    || (a.items[1]?.key ?? '').localeCompare(b.items[1]?.key ?? ''));
  return {
    options,
    hero: { id: hero.id, key: hero.key, name: hero.name },
    baseline,
    rows,
    assumptions: [
      'Sustained attacks connect with one target at normal-hero Item Potency. The model excludes hero abilities, talents, uptime, misses, and target movement.',
      'Auras apply to one in-range unit. Enabled friendly auras that affect the wearer also contribute to the wearer stats. Shared effects use the strongest supported value.',
      'Magic damage uses the entered pre-resistance spell total, one ready cast per supported active group, and expected on-hit procs when enabled. Damage-over-time targets are assumed to remain affected.',
      'Builds use distinct items bought from an empty inventory. An estimated gain covers the effects listed by the model.',
    ],
  };
}

function metricValue(hero, level, build, options, ability) {
  switch (options.metric) {
    case 'physicalDps':
      return attackDamage(hero, level, build)
        * (totalAttackSpeed(level, build) / (100 * hero.baseAttackTime)) * build.attackFactor;
    case 'damagePerHit':
      return attackDamage(hero, level, build);
    case 'attackSpeed':
      return totalAttackSpeed(level, build);
    case 'attacksPerSecond':
      return totalAttackSpeed(level, build) / (100 * hero.baseAttackTime);
    case 'magicalDamage':
      return options.baseSpellDamage * build.spellMultiplier + build.activeMagicDamage
        + onHitDamage(build, totalAttackSpeed(level, build) / (100 * hero.baseAttackTime), options.windowSeconds);
    case 'abilityDamage':
      return abilityCast(hero, level, build, ability).damage;
    case 'spellAmp':
      return build.spellAmp;
    case 'auraAttackSpeedReduction':
      return build.auraAttackSpeedReduction;
    default:
      return build.auraMetricsValues[options.metric] ?? estimate(hero, level, build, options)[options.metric];
  }
}

function prepareCandidates(items, options, coverageFilter) {
  const templates = [];
  for (const build of affordableBuilds(shopItems(items), options.budget, options.maxItems)) {
    const coverage = coverageFor(build.items);
    if (coverage === 'unmodelled' || (coverageFilter === 'flat' && coverage !== 'flat')) continue;
    const prepared = prepareBuild(build.items, options);
    templates.push({ ...build, coverage, prepared });
  }
  templates.sort((a, b) => a.cost - b.cost);
  return templates;
}

function* costFrontier(templates, valueFor, base) {
  let bestLowerCostGain = 0;
  for (let index = 0; index < templates.length;) {
    let winner = templates[index];
    let total = valueFor(winner.prepared);
    const { cost } = winner;
    index += 1;
    while (templates[index]?.cost === cost) {
      const candidate = templates[index];
      const value = valueFor(candidate.prepared);
      if (value > total || !Number.isFinite(total)) {
        total = value;
        winner = candidate;
      }
      index += 1;
    }
    const gain = total - base;
    if (!Number.isFinite(total) || gain <= bestLowerCostGain + EPSILON) continue;
    bestLowerCostGain = gain;
    yield { winner, total, gain };
  }
}

export function createBuildBandAnalyzer(items, budgets, input = {}) {
  const options = validatedOptions({ ...input, budget: budgets.at(-1), itemKeys: undefined });
  const baselineBuild = prepareBuild([], options);
  const templates = prepareCandidates(items, options, input.coverage);
  return {
    options,
    analyze(hero, baseSpellDamage = options.baseSpellDamage) {
      const level = heroAtLevel(hero, options.level);
      const scenario = { ...options, baseSpellDamage };
      const isAbility = options.metric === 'abilityDamage';
      const ability = isAbility ? getModeledAbility(hero.id, level.level) : null;
      const best = budgets.map(() => (isAbility ? [] : null));
      if (isAbility && !ability) return best;
      const valueFor = (build) => metricValue(hero, level, build, scenario, ability);
      const base = valueFor(baselineBuild);
      if (!Number.isFinite(base)) return best;
      const baselineCast = isAbility ? abilityCast(hero, level, baselineBuild, ability) : null;
      for (const { winner, total, gain } of costFrontier(templates, valueFor, base)) {
        const { cost } = winner;
        const band = budgets.findIndex((maxSpend) => cost <= maxSpend);
        const gainPer1000 = gain / cost * 1000;
        const row = { items: winner.items, cost, coverage: winner.coverage, total, base, gain, gainPer1000 };
        if (isAbility) {
          best[band].push({ ...row, ability: {
            ...ability,
            baseline: baselineCast,
            build: abilityCast(hero, level, winner.prepared, ability),
          } });
          continue;
        }
        const current = best[band];
        if (current && (gainPer1000 < current.gainPer1000 - EPSILON
          || (Math.abs(gainPer1000 - current.gainPer1000) <= EPSILON && (gain < current.gain - EPSILON
            || (Math.abs(gain - current.gain) <= EPSILON && cost >= current.cost))))) continue;
        best[band] = row;
      }
      return best;
    },
  };
}

export function createDpsBudgetAnalyzer(items, budgetCaps, input = {}) {
  const caps = [...new Set(budgetCaps)].sort((a, b) => a - b);
  const options = validatedOptions({
    ...input, metric: 'physicalDps', budget: caps.at(-1) ?? 0, itemKeys: undefined,
  });
  const baselineBuild = prepareBuild([], options);
  const templates = prepareCandidates(items, options, input.coverage);
  return (hero) => {
    const level = heroAtLevel(hero, options.level);
    const valueFor = (build) => metricValue(hero, level, build, options);
    const baselineDps = valueFor(baselineBuild);
    const builds = new Map();
    if (!Number.isFinite(baselineDps)) return { baselineDps: null, builds };
    let current = { items: [], spent: 0, dps: baselineDps, gain: 0, coverage: 'flat' };
    let index = 0;
    for (const { winner, total, gain } of costFrontier(templates, valueFor, baselineDps)) {
      while (index < caps.length && caps[index] < winner.cost) {
        builds.set(caps[index], current);
        index += 1;
      }
      current = { items: winner.items, spent: winner.cost, dps: total, gain, coverage: winner.coverage };
    }
    while (index < caps.length) {
      builds.set(caps[index], current);
      index += 1;
    }
    return { baselineDps, builds };
  };
}
