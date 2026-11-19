import { BUILD_DEFAULTS, estimateAttackDps } from './build-efficiency.mjs';

// Direct recipes from the pinned 7.42 client (build 6978). Ingredients outside
// this set are priced inside the completed item's full shop price.
const recipes = new Map(Object.entries({
  greater_crit: ['lesser_crit', 'demon_edge'],
  lesser_crit: ['claymore', 'blades_of_attack'],
  maelstrom: ['mithril_hammer', 'gloves'],
  mjollnir: ['maelstrom', 'hyperstone'],
  manta: ['yasha', 'diadem'],
  hurricane_pike: ['force_staff', 'dragon_lance'],
  dragon_lance: ['blade_of_alacrity', 'belt_of_strength'],
  bfury: ['pers', 'broadsword', 'quelling_blade'],
  black_king_bar: ['mithril_hammer', 'ogre_axe'],
  gungir: ['rod_of_atos', 'point_booster', 'chasm_stone'],
  phase_boots: ['boots', 'chainmail', 'blades_of_attack'],
  arcane_boots: ['boots', 'ring_of_basilius', 'wizard_hat'],
  tranquil_boots: ['boots', 'wind_lace', 'ring_of_regen'],
  travel_boots: ['boots'],
  travel_boots_2: ['travel_boots'],
  boots_of_bearing: ['tranquil_boots', 'ancient_janggo', 'ring_of_tarrasque'],
  guardian_greaves: ['arcane_boots', 'mekansm'],
  magic_wand: ['magic_stick', 'branches'],
  harpoon: ['echo_sabre', 'dragon_lance'],
  disperser: ['diffusal_blade', 'eagle'],
  bloodthorn: ['orchid', 'oblivion_staff'],
  silver_edge: ['invis_sword', 'demon_edge'],
  monkey_king_bar: ['demon_edge', 'blitz_knuckles', 'quarterstaff'],
  hand_of_midas: ['gloves'],
  armlet: ['helm_of_iron_will', 'gloves', 'blades_of_attack'],
  falcon_blade: ['fluffy_hat', 'blades_of_attack', 'sobi_mask'],
  wind_waker: ['cyclone', 'mystic_staff'],
  crimson_guard: ['vanguard', 'buckler', 'helm_of_iron_will'],
  solar_crest: ['pavise', 'chainmail', 'wind_lace'],
  spirit_vessel: ['urn_of_shadows', 'diadem'],
  radiance: ['relic', 'talisman_of_evasion'],
  sange_and_yasha: ['sange', 'yasha'],
  yasha_and_kaya: ['yasha', 'kaya'],
  kaya_and_sange: ['kaya', 'sange'],
  starforge: ['meteor_hammer', 'ultimate_orb'],
  dagon_2: ['dagon'],
  dagon_3: ['dagon_2'],
  dagon_4: ['dagon_3'],
  dagon_5: ['dagon_4'],
}));

const treadAttributes = ['belt_of_strength', 'robe', 'boots_of_elves'];
export const TIMING_FARM_ITEMS = Object.freeze(['maelstrom', 'mjollnir', 'bfury', 'radiance']);
const farmItems = new Set(TIMING_FARM_ITEMS);

function describeItem({ key, name, cost, coverage }) {
  return { key, name, cost, coverage };
}

function preparePath(path, catalog) {
  if (!Array.isArray(path.steps) || path.steps.length < 1 || path.steps.length > 6) {
    throw new RangeError('Select one to six purchases for each path.');
  }
  const held = new Map();
  return path.steps.map(({ key, replaces }) => {
    const item = catalog.get(key);
    if (!item) throw new RangeError(`Unknown shop item: ${key}.`);
    if (held.has(key)) throw new RangeError(`The path already holds ${item.name}.`);
    const treadAttribute = key === 'power_treads'
      ? (treadAttributes.includes(replaces) && held.has(replaces) ? replaces : treadAttributes.find((attribute) => held.has(attribute)))
      : null;
    const required = key === 'power_treads' ? ['boots', 'gloves', treadAttribute] : recipes.get(key) ?? [];
    const consumed = required.filter((part) => held.has(part));
    if (replaces && !consumed.includes(replaces)) {
      throw new RangeError(`The path cannot credit ${replaces} toward ${item.name}.`);
    }
    const components = consumed.map((part) => held.get(part));
    const incrementalCost = item.cost - components.reduce((subtotal, part) => subtotal + part.cost, 0);
    if (incrementalCost < 0) throw new RangeError(`Ingredient costs exceed the shop price of ${item.name}.`);
    for (const part of consumed) held.delete(part);
    held.set(key, item);
    return { item, components, incrementalCost };
  });
}

function simulatePath(hero, path, catalog, checkpoints, options) {
  const steps = preparePath(path, catalog);
  const purchases = steps.map(({ item, components, incrementalCost }) => ({
    ...describeItem(item), incrementalCost, minute: null,
    replaces: components[0]?.key ?? null, replacedItems: components.map(describeItem),
  }));
  const held = new Map();
  let stepIndex = 0;
  let spent = 0;
  let bonusGold = 0;
  let previousMinute = 0;
  const points = checkpoints.map(({ minute, level, budget: baseBudget }) => {
    if (options.bonusGpm > 0 && [...held.keys()].some((key) => farmItems.has(key))) {
      bonusGold += options.bonusGpm * (minute - previousMinute);
    }
    previousMinute = minute;
    const budget = baseBudget + bonusGold;
    while (stepIndex < steps.length && spent + steps[stepIndex].incrementalCost <= budget) {
      const { item, components, incrementalCost } = steps[stepIndex];
      for (const part of components) held.delete(part.key);
      held.set(item.key, item);
      spent += incrementalCost;
      purchases[stepIndex].minute = minute;
      stepIndex += 1;
    }
    const inventory = [...held.values()];
    return { minute, level, budget, baseBudget, bonusGold, spent, unspent: budget - spent,
      items: inventory.map(describeItem), ...estimateAttackDps(hero, inventory, { ...options, level }) };
  });
  return { key: path.key, label: path.label, note: path.note, purchases, points };
}

export function simulateBuildTimings({ hero, items, checkpoints, paths, options = {} }) {
  const {
    targetArmor = BUILD_DEFAULTS.targetArmor,
    targetMagicResistance = BUILD_DEFAULTS.targetMagicResistance,
    bonusGpm = 0,
  } = options;
  if (!Number.isFinite(bonusGpm) || bonusGpm < 0 || bonusGpm > 500) {
    throw new RangeError('Extra farm income must be between 0 and 500 gold per minute.');
  }
  if (!Array.isArray(checkpoints) || !checkpoints.length) throw new RangeError('At least one budget checkpoint is required.');
  let priorMinute = -1;
  let priorBudget = 0;
  for (const { minute, budget } of checkpoints) {
    if (!Number.isFinite(minute) || minute < 0 || minute <= priorMinute
      || !Number.isFinite(budget) || budget < priorBudget) {
      throw new RangeError('Checkpoints must have increasing times and nondecreasing budgets.');
    }
    priorMinute = minute;
    priorBudget = budget;
  }
  const combat = { targetArmor, targetMagicResistance, bonusGpm };
  const catalog = new Map(items.filter(({ cost }) => Number.isFinite(cost) && cost > 0).map((item) => [item.key, item]));
  return { checkpoints, options: combat, paths: paths.map((path) => simulatePath(hero, path, catalog, checkpoints, combat)) };
}
