import { BUILD_DEFAULTS, estimateAttackDps } from './build-efficiency.mjs';

// Distinct priced direct ingredients from the pinned 7.42 client (build 6978).
// Components outside the model are included in the full shop price.
const recipes = new Map(Object.entries({
  abyssal_blade: ['basher', 'dragon_lance'],
  aeon_disk: ['vitality_booster', 'energy_booster'],
  aether_lens: ['energy_booster', 'void_stone'],
  ancient_janggo: ['headdress', 'belt_of_strength', 'wind_lace'],
  arcane_blink: ['blink', 'mystic_staff'],
  arcane_boots: ['boots', 'ring_of_basilius', 'wizard_hat'],
  armlet: ['helm_of_iron_will', 'gloves', 'blades_of_attack'],
  assault: ['buckler', 'hyperstone', 'platemail'],
  basher: ['mithril_hammer', 'belt_of_strength'],
  berserkers_sabatons: ['phase_boots', 'armlet'],
  bfury: ['pers', 'broadsword', 'quelling_blade'],
  black_king_bar: ['mithril_hammer', 'ogre_axe'],
  blade_mail: ['broadsword', 'splintmail'],
  bloodslinger: ['sobi_mask', 'mantle', 'blood_grenade'],
  bloodstone: ['veil_of_discord', 'soul_booster'],
  bloodthorn: ['orchid', 'oblivion_staff'],
  boots_of_bearing: ['tranquil_boots', 'ancient_janggo', 'ring_of_tarrasque'],
  bracer: ['circlet', 'gauntlets'],
  buckler: ['ring_of_protection'],
  butterfly: ['eagle', 'talisman_of_evasion', 'quarterstaff'],
  caduceus: ['force_staff', 'phylactery'],
  consecrated_wraps: ['vitality_booster', 'shawl', 'crown'],
  crellas_crozier: ['ghost', 'soul_booster'],
  crimson_guard: ['vanguard', 'buckler', 'helm_of_iron_will'],
  cyclone: ['staff_of_wizardry', 'void_stone', 'wind_lace'],
  dagon: ['point_booster', 'crown', 'wizard_hat'],
  dagon_2: ['dagon'],
  dagon_3: ['dagon_2'],
  dagon_4: ['dagon_3'],
  dagon_5: ['dagon_4'],
  desolator: ['mithril_hammer', 'blight_stone'],
  devastator: ['witch_blade', 'mystic_staff'],
  diffusal_blade: ['blade_of_alacrity', 'robe'],
  disperser: ['diffusal_blade', 'eagle'],
  dragon_lance: ['blade_of_alacrity', 'belt_of_strength'],
  echo_sabre: ['ogre_axe', 'broadsword', 'void_stone'],
  essence_distiller: ['urn_of_shadows', 'chainmail', 'wizard_hat'],
  ethereal_blade: ['ultimate_orb', 'ghost'],
  falcon_blade: ['fluffy_hat', 'blades_of_attack', 'sobi_mask'],
  force_staff: ['staff_of_wizardry', 'fluffy_hat'],
  glimmer_cape: ['shadow_amulet', 'shawl'],
  greater_crit: ['lesser_crit', 'demon_edge'],
  guardian_greaves: ['arcane_boots', 'mekansm'],
  gungir: ['rod_of_atos', 'point_booster', 'chasm_stone'],
  hand_of_midas: ['gloves'],
  harpoon: ['echo_sabre', 'dragon_lance'],
  headdress: ['ring_of_regen'],
  heart: ['reaver', 'ring_of_tarrasque'],
  heavens_halberd: ['ogre_axe', 'helm_of_iron_will'],
  helm_of_the_dominator: ['helm_of_iron_will', 'crown'],
  holy_locket: ['magic_wand', 'crown'],
  hurricane_pike: ['force_staff', 'dragon_lance'],
  hydras_breath: ['specialists_array', 'dragon_lance', 'orb_of_venom'],
  invis_sword: ['claymore', 'blitz_knuckles', 'shadow_amulet'],
  kaya: ['staff_of_wizardry', 'robe'],
  kaya_and_sange: ['kaya', 'sange'],
  lesser_crit: ['claymore', 'blades_of_attack'],
  lotus_orb: ['pers', 'platemail', 'energy_booster'],
  maelstrom: ['mithril_hammer', 'gloves'],
  mage_slayer: ['pers', 'cloak', 'blades_of_attack', 'orb_of_venom'],
  magic_wand: ['magic_stick', 'branches'],
  manta: ['yasha', 'diadem'],
  mask_of_madness: ['lifesteal', 'quarterstaff'],
  mekansm: ['headdress', 'chainmail'],
  meteor_hammer: ['kaya', 'crown'],
  mjollnir: ['maelstrom', 'hyperstone'],
  monkey_king_bar: ['demon_edge', 'blitz_knuckles', 'quarterstaff'],
  moon_shard: ['hyperstone'],
  null_talisman: ['circlet', 'mantle'],
  nullifier: ['relic', 'splintmail'],
  oblivion_staff: ['blitz_knuckles', 'robe', 'sobi_mask'],
  octarine_core: ['soul_booster', 'tiara_of_selemene'],
  orb_of_corrosion: ['orb_of_frost', 'blight_stone', 'slippers'],
  orchid: ['oblivion_staff', 'claymore'],
  overwhelming_blink: ['blink', 'reaver'],
  pavise: ['wizard_hat', 'fluffy_hat', 'ring_of_protection'],
  pers: ['ring_of_health', 'void_stone'],
  phase_boots: ['boots', 'chainmail', 'blades_of_attack'],
  phylactery: ['pers', 'diadem'],
  pipe: ['ring_of_tarrasque', 'cloak', 'shawl'],
  radiance: ['relic', 'talisman_of_evasion'],
  rapier: ['relic', 'demon_edge'],
  refresher: ['ring_of_tarrasque', 'tiara_of_selemene'],
  ring_of_basilius: ['sobi_mask'],
  ristuls_devotion: ['vladmir', 'splintmail', 'voodoo_mask'],
  rod_of_atos: ['staff_of_wizardry', 'vitality_booster'],
  sange: ['ogre_axe', 'belt_of_strength'],
  sange_and_yasha: ['sange', 'yasha'],
  satanic: ['reaver', 'claymore', 'lifesteal'],
  sheepstick: ['mystic_staff', 'tiara_of_selemene'],
  shivas_guard: ['platemail', 'splintmail', 'chasm_stone'],
  silver_edge: ['invis_sword', 'demon_edge'],
  skadi: ['ultimate_orb', 'orb_of_frost'],
  skypiercer: ['heavens_halberd', 'sange', 'talisman_of_evasion'],
  solar_crest: ['pavise', 'chainmail', 'wind_lace'],
  soul_booster: ['point_booster', 'vitality_booster', 'energy_booster'],
  soul_ring: ['ring_of_protection', 'gauntlets'],
  specialists_array: ['blade_of_alacrity', 'broadsword'],
  sphere: ['pers', 'ultimate_orb'],
  spirit_vessel: ['urn_of_shadows', 'diadem'],
  starforge: ['meteor_hammer', 'ultimate_orb'],
  swift_blink: ['blink', 'eagle'],
  tranquil_boots: ['boots', 'wind_lace', 'ring_of_regen'],
  travel_boots: ['boots'],
  travel_boots_2: ['travel_boots'],
  ultimate_scepter: ['point_booster', 'staff_of_wizardry', 'ogre_axe', 'blade_of_alacrity'],
  ultimate_scepter_2: ['ultimate_scepter'],
  urn_of_shadows: ['sobi_mask', 'ring_of_protection', 'circlet'],
  vanguard: ['vitality_booster', 'ring_of_health'],
  veil_of_discord: ['voodoo_mask', 'robe', 'fluffy_hat'],
  vladmir: ['buckler', 'ring_of_basilius', 'lifesteal', 'blades_of_attack'],
  wind_waker: ['cyclone', 'mystic_staff'],
  witch_blade: ['oblivion_staff', 'chainmail'],
  wraith_band: ['circlet', 'slippers'],
  yasha: ['blade_of_alacrity', 'boots_of_elves'],
  yasha_and_kaya: ['yasha', 'kaya'],
}));

const treadAttributes = ['belt_of_strength', 'robe', 'boots_of_elves'];
export const TIMING_FARM_ITEMS = Object.freeze(['maelstrom', 'mjollnir', 'bfury', 'radiance']);
const farmItems = new Set(TIMING_FARM_ITEMS);

export function heldRecipeIngredients(key, held, preferred) {
  const treadAttribute = key === 'power_treads'
    ? (treadAttributes.includes(preferred) && held.has(preferred) ? preferred : treadAttributes.find((attribute) => held.has(attribute)))
    : null;
  const required = key === 'power_treads' ? ['boots', 'gloves', treadAttribute] : recipes.get(key) ?? [];
  return required.filter((part) => held.has(part));
}

function describeItem({ key, name, cost, coverage }) {
  return { key, name, cost, coverage };
}

function preparePath(path, catalog, maxPurchases) {
  if (!Array.isArray(path.steps) || path.steps.length < 1 || path.steps.length > maxPurchases) {
    throw new RangeError(`Select one to ${maxPurchases} purchases for each path.`);
  }
  const held = new Map();
  return path.steps.map(({ key, replaces }) => {
    const item = catalog.get(key);
    if (!item) throw new RangeError(`Unknown shop item: ${key}.`);
    if (held.has(key)) throw new RangeError(`The path already holds ${item.name}.`);
    const consumed = heldRecipeIngredients(key, held, replaces);
    if (replaces && !consumed.includes(replaces)) {
      throw new RangeError(`The path cannot credit ${replaces} toward ${item.name}.`);
    }
    const components = consumed.map((part) => held.get(part));
    const incrementalCost = item.cost - components.reduce((subtotal, part) => subtotal + part.cost, 0);
    if (incrementalCost < 0) throw new RangeError(`Ingredient costs exceed the shop price of ${item.name}.`);
    for (const part of consumed) held.delete(part);
    held.set(key, item);
    if (held.size > 6) throw new RangeError('Each path must fit within six held items.');
    return { item, components, incrementalCost };
  });
}

function simulatePath(hero, path, catalog, checkpoints, options, maxPurchases) {
  const steps = preparePath(path, catalog, maxPurchases);
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
    maxPurchases = 6,
  } = options;
  if (!Number.isFinite(bonusGpm) || bonusGpm < 0 || bonusGpm > 500) {
    throw new RangeError('Extra farm income must be between 0 and 500 gold per minute.');
  }
  if (!Number.isInteger(maxPurchases) || maxPurchases < 1 || maxPurchases > 9) {
    throw new RangeError('Purchase limit must be a whole number from 1 to 9.');
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
  return { checkpoints, options: combat, paths: paths.map((path) => simulatePath(hero, path, catalog, checkpoints, combat, maxPurchases)) };
}
