import { createInventoryEstimator } from './build-efficiency.mjs';

export const STARTING_LANES = Object.freeze([
  { key: 'balanced', label: 'Balanced lane', description: 'Balance last hits, trades, recovery, and team utility using your position’s priorities.' },
  { key: 'sustain', label: 'Sustain', description: 'Value health recovery and mana for a lane with repeated pressure.' },
  { key: 'trading', label: 'Early fighting', description: 'Value opening attack damage, durability, and the ability to stay in range.' },
  { key: 'last-hits', label: 'Last-hitting', description: 'Prioritize damage per hit on lane creeps while retaining some lane recovery.' },
]);

// Dimensions are creep damage, trading, health recovery, mana, and team utility.
const roleWeights = {
  carry: [0.40, 0.22, 0.25, 0.11, 0.02],
  mid: [0.32, 0.22, 0.21, 0.24, 0.01],
  offlane: [0.20, 0.29, 0.28, 0.16, 0.07],
  'soft-support': [0.03, 0.27, 0.28, 0.25, 0.17],
  'hard-support': [0.02, 0.20, 0.28, 0.28, 0.22],
};

const laneWeights = {
  sustain: [0, 0.12, 0.64, 0.22, 0.02],
  trading: [0, 0.8, 0.12, 0.03, 0.05],
  'last-hits': [0.84, 0.04, 0.08, 0.03, 0.01],
};

// Costs and raw values are pinned to the 7.42 item data. The fractions estimate
// useful recovery in a two-minute lane window with some interruption and overheal.
const laneSeconds = 120;
const chargeRecovery = 3 * 15;
const pressureItems = ['orb_of_frost', 'orb_of_venom', 'blood_grenade'];

function points(value, reference) {
  const benefit = Math.max(0, value);
  return 100 * benefit / (reference + benefit);
}

function weightedSum(values, weights) {
  return weights.reduce((sum, weight, index) => sum + weight * values[index], 0);
}

function windowRecovery(quantity, duration, rate, firstUse, laterUse) {
  const availableSeconds = Math.min(laneSeconds, quantity * duration);
  const firstSeconds = Math.min(duration, availableSeconds);
  const extraSeconds = availableSeconds - firstSeconds;
  return rate * (firstSeconds * firstUse + extraSeconds * laterUse);
}

export function createStartingScorer(hero, items, role) {
  if (!Object.hasOwn(roleWeights, role)) throw new RangeError('Select one Legend role.');
  const statItems = new Map(items.filter(({ stats, effects, auras }) =>
    Object.keys(stats ?? {}).length || effects?.length || auras?.length).map((item) => [item.key, item]));
  const estimate = createInventoryEstimator(hero, { level: 1, targetArmor: 2, includeActives: false, baseSpellDamage: 0 });
  const baseline = estimate([], 1);
  const inventoryStats = new Map([['', baseline]]);
  const creepBonus = hero.attackType === 'ranged' ? 4 : 8;
  const baselineHealthRegen = baseline.healthRegen ?? 0;
  const baselineManaRegen = baseline.manaRegen ?? 0;
  const grenadeHealth = statItems.get('blood_grenade')?.stats.health ?? 0;
  const manaReference = Math.max(120, (baseline.mana ?? 0) * 0.56);

  return { lanes: STARTING_LANES, score(bundle) {
    const counts = new Map(bundle.map(({ key, quantity }) => [key, quantity]));
    const quantity = (key) => counts.get(key) ?? 0;
    const statBundle = bundle.filter(({ key }) => statItems.has(key));
    const signature = statBundle.map(({ key, quantity: copies }) => `${key}:${copies}`).sort().join(',');
    if (!inventoryStats.has(signature)) {
      const inventory = statBundle.flatMap(({ key, quantity: copies }) => Array(copies).fill(statItems.get(key)));
      inventoryStats.set(signature, estimate(inventory, 1));
    }
    const current = inventoryStats.get(signature);
    const quelling = quantity('quelling_blade') > 0;
    const lastHitDamage = current.damagePerHit + (quelling ? creepBonus : 0);
    const hasStick = quantity('magic_stick') > 0 || quantity('magic_wand') > 0;
    const charges = hasStick ? chargeRecovery : 0;
    const tangos = quantity('tango');
    const salves = quantity('flask');
    const clarities = quantity('clarity');
    const mangoes = quantity('enchanted_mango');
    const fires = quantity('faerie_fire');
    const vision = quantity('ward_sentry');
    const extraRegen = (current.healthRegen ?? baselineHealthRegen) - baselineHealthRegen - 0.2 * mangoes;
    const laneHealing = Math.max(0, extraRegen * laneSeconds)
      + windowRecovery(tangos, 3 * 16, 7, 0.65, 0.30)
      + windowRecovery(salves, 13, 30, 0.50, 0.20) + fires * 85 * 0.8 + charges;
    const laneMana = Math.max(0, (current.manaRegen ?? baselineManaRegen) - baselineManaRegen) * laneSeconds
      + Math.min(1, mangoes) * 100 + Math.max(0, mangoes - 1) * 65
      + windowRecovery(clarities, 25, 6, 0.55, 0.25) + charges;

    const grenadeCount = quantity('blood_grenade');
    const heldFraction = 1 - grenadeCount * grenadeHealth / current.health;
    const resilience = (fraction) => points(((current.physicalEhp * fraction - baseline.physicalEhp) || 0) * 0.65
      + ((current.magicEhp * fraction - baseline.magicEhp) || 0) * 0.35, 135);
    const durableResilience = resilience(heldFraction);
    const attack = points(current.physicalDps - baseline.physicalDps, 13);
    const mobility = points((current.moveSpeed - baseline.moveSpeed) || 0, 30);
    const pressure = points(pressureItems.filter((key) => quantity(key) > 0).length, 1.7);
    const trading = 0.56 * attack + 0.24 * (0.65 * durableResilience + 0.35 * resilience(1))
      + 0.10 * mobility + 0.10 * pressure;
    const healing = 0.73 * points(laneHealing, 245) + 0.27 * durableResilience;
    const mana = 0.74 * points(laneMana, manaReference) + 0.26 * points((current.mana - baseline.mana) || 0, 95);
    const aura = (current.auraArmor ?? 0) * 0.12 + (current.auraHealthRegen ?? 0) * 0.20
      + (current.auraManaRegen ?? 0) * 0.28;
    const team = points((vision ? 0.47 : 0) + (grenadeCount ? 0.3 : 0) + aura, 0.48);
    const values = [points(lastHitDamage - baseline.damagePerHit, 13), trading, healing, mana, team];
    const balanced = weightedSum(values, roleWeights[role]);
    const scores = { balanced };
    for (const [key, weights] of Object.entries(laneWeights)) scores[key] = 0.37 * balanced + 0.63 * weightedSum(values, weights);

    const notes = [];
    if (quelling) notes.push(`Quelling Blade adds ${creepBonus} damage per hit when last-hitting enemy lane creeps.`);
    if (hasStick) notes.push('Stick recovery assumes three charges earned from nearby enemy spells.');
    if (tangos || salves || clarities || fires || mangoes) notes.push('Recovery estimates use a two-minute lane window and discount repeat consumables. Safe windows, missing health, and available trees affect the result.');
    if (vision) notes.push('Sentries help with dewarding and detection when the lane needs them.');
    if (quantity('orb_of_frost') || quantity('orb_of_venom')) notes.push('Orb pressure earns a small trading bonus for its on-hit effect.');
    if (grenadeCount) notes.push('Blood Grenade adds health while held. Throwing it spends health and can slow a target.');
    return { scores, metrics: { attackDps: current.physicalDps, lastHitDamage, health: current.health,
      physicalEhp: current.physicalEhp, magicEhp: current.magicEhp, laneHealing, laneMana,
      moveSpeed: current.moveSpeed, vision }, notes };
  } };
}
