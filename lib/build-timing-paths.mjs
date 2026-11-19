export const MAX_TIMING_STEPS = 6;

const consumables = new Set([
  'aghanims_shard', 'ultimate_scepter_2', 'blood_grenade', 'clarity', 'dust', 'enchanted_mango',
  'faerie_fire', 'flask', 'infused_raindrop', 'smoke_of_deceit', 'tango', 'tpscroll', 'ward_sentry',
]);

const comparisonPaths = [
  {
    key: 'daedalus-rush', label: 'Daedalus rush',
    note: 'Buy Crystalys for an earlier crit spike, finish Daedalus, then add Maelstrom.',
    items: ['power_treads', 'lesser_crit', 'greater_crit', 'maelstrom'],
  },
  {
    key: 'maelstrom-first', label: 'Maelstrom first',
    note: 'Start with lightning and finish with the same items as the Daedalus rush.',
    items: ['power_treads', 'maelstrom', 'lesser_crit', 'greater_crit'],
  },
  {
    key: 'mjollnir-first', label: 'Mjollnir first',
    note: 'Finish the faster lightning item before investing in crits.',
    items: ['power_treads', 'maelstrom', 'mjollnir', 'lesser_crit', 'greater_crit'],
  },
  {
    key: 'attack-speed-first', label: 'Attack speed first',
    note: 'Test the earlier attack speed from Yasha and Butterfly with crits arriving later.',
    items: ['power_treads', 'yasha', 'butterfly', 'lesser_crit', 'greater_crit'],
  },
];

const carryAlternatives = new Map([
  [1, {
    label: 'Battle Fury and Manta',
    note: 'Compare Anti-Mage’s cleave and illusion path. The damage calculation covers the real hero’s attacks.',
    items: ['power_treads', 'bfury', 'yasha', 'manta', 'basher'],
  }],
  [6, {
    label: 'Pike and Manta',
    note: 'Price range and repositioning before Daedalus on Drow Ranger. The damage calculation assumes attacks already connect.',
    items: ['power_treads', 'dragon_lance', 'yasha', 'manta', 'hurricane_pike', 'greater_crit'],
  }],
  [12, {
    label: 'Diffusal and Manta',
    note: 'Compare a mana-burn and illusion path for Phantom Lancer. Illusion attacks require a separate damage calculation.',
    items: ['power_treads', 'diffusal_blade', 'yasha', 'manta', 'disperser'],
  }],
  [35, {
    label: 'Lightning and Pike',
    note: 'Price extra reach for Sniper between Maelstrom and the crit upgrade.',
    items: ['power_treads', 'dragon_lance', 'maelstrom', 'hurricane_pike', 'lesser_crit', 'greater_crit'],
  }],
  [41, {
    label: 'Mask and Mjollnir',
    note: 'Compare Mask of Madness and BKB timings around Faceless Void’s lightning upgrades.',
    items: ['power_treads', 'mask_of_madness', 'maelstrom', 'mjollnir', 'black_king_bar', 'greater_crit'],
  }],
  [53, {
    label: 'Lightning and BKB',
    note: 'Test the price of protecting Nature’s Prophet’s attack window with BKB before upgrading crits.',
    items: ['power_treads', 'maelstrom', 'mjollnir', 'black_king_bar', 'lesser_crit', 'greater_crit'],
  }],
]);

function isTimingItem(item) {
  return typeof item?.key === 'string' && !consumables.has(item.key) && !item.key.startsWith('recipe_')
    && Number.isSafeInteger(item.cost) && item.cost > 0;
}

export function timingItemOptions(items) {
  return [...items].filter(isTimingItem).map(({ key, name, cost }) => ({ key, name, cost }));
}

export function buildTimingPaths(hero, rolePlans, catalog, customItemKeys = [], role = 'carry') {
  if (!Array.isArray(customItemKeys) || customItemKeys.length > MAX_TIMING_STEPS
    || new Set(customItemKeys).size !== customItemKeys.length) {
    throw new RangeError('Choose up to six distinct items for the custom purchase path.');
  }
  if (customItemKeys.some((key) => !isTimingItem(catalog.get(key)))) {
    throw new RangeError('Choose priced shop items that can be held for the custom purchase path.');
  }

  const options = [...comparisonPaths];
  const curated = rolePlans.find((plan) => plan.heroId === hero.id && plan.role === role && plan.builds?.good);
  if (curated) {
    options.push({ key: 'hero-path', label: 'Role guide path', note: 'Compare held items from the selected role’s Good farm guide.',
      items: curated.builds.good.items });
  } else if (role === 'carry' && carryAlternatives.has(hero.id)) {
    options.push({ key: 'hero-path', ...carryAlternatives.get(hero.id) });
  }
  if (customItemKeys.length) {
    options.push({ key: 'custom', label: 'Custom path', note: 'Buys the selected items in the order shown.', items: customItemKeys });
  }

  return options.flatMap(({ key, label, note, items }) => {
    const steps = items.filter((itemKey) => isTimingItem(catalog.get(itemKey)))
      .slice(0, MAX_TIMING_STEPS).map((itemKey) => ({ key: itemKey }));
    return steps.length ? [{ key, label, note, steps }] : [];
  });
}
