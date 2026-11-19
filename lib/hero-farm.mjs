import { createDpsBudgetAnalyzer } from './build-efficiency.mjs';
import { priceDraftPlan } from './draft-plans.mjs';

const farmLabels = {
  bad: 'Bad farm',
  good: 'Good farm',
  easy: 'Easy farm',
};

const carryDamageItems = new Set([
  'phase_boots', 'power_treads', 'orb_of_corrosion', 'wraith_band', 'falcon_blade',
  'mask_of_madness', 'armlet', 'dragon_lance', 'echo_sabre', 'maelstrom', 'yasha',
  'diffusal_blade', 'desolator', 'lesser_crit', 'basher', 'skadi', 'manta', 'sange_and_yasha',
  'mjollnir', 'greater_crit', 'butterfly', 'monkey_king_bar', 'bloodthorn', 'satanic',
  'silver_edge', 'disperser',
]);

const completedPurchases = new Set([
  ...carryDamageItems,
  'arcane_boots', 'tranquil_boots', 'travel_boots', 'travel_boots_2', 'boots_of_bearing', 'guardian_greaves',
  'blink', 'arcane_blink', 'swift_blink', 'overwhelming_blink', 'phylactery', 'caduceus', 'hand_of_midas', 'witch_blade',
  'mekansm', 'vladmir', 'ristuls_devotion', 'holy_locket', 'pipe', 'urn_of_shadows', 'sheepstick', 'orchid', 'cyclone',
  'wind_waker', 'aether_lens', 'force_staff', 'hurricane_pike', 'dagon', 'ultimate_scepter', 'aghanims_shard',
  'refresher', 'assault', 'heart', 'black_king_bar', 'shivas_guard', 'bloodstone', 'sphere', 'lotus_orb', 'meteor_hammer',
  'starforge', 'nullifier', 'aeon_disk', 'kaya', 'spirit_vessel', 'vanguard', 'crimson_guard', 'blade_mail',
  'radiance', 'bfury', 'invis_sword', 'kaya_and_sange', 'yasha_and_kaya', 'helm_of_the_dominator', 'gungir',
  'ethereal_blade', 'octarine_core', 'mage_slayer', 'ancient_janggo', 'solar_crest', 'pavise', 'veil_of_discord',
  'rod_of_atos', 'abyssal_blade', 'heavens_halberd', 'skypiercer', 'glimmer_cape', 'harpoon', 'bloodslinger',
]);

const roleTemplates = {
  carry: {
    bad: { items: ['magic_wand', 'power_treads', 'falcon_blade'], note: 'Cover basic stats and mana before committing to an expensive item.' },
    good: { items: ['magic_wand', 'power_treads', 'maelstrom'], note: 'Consider a farming item if your attack pattern uses its procs well.' },
    easy: { items: ['magic_wand', 'power_treads', 'maelstrom', 'black_king_bar'], note: 'Protect your time on target if spell control can stop you from attacking.' },
  },
  mid: {
    bad: { items: ['bottle', 'magic_wand', 'boots', 'cyclone'], note: 'Bottle helps when you can contest runes. Eul’s gives a dispel or setup when you need it.' },
    good: { items: ['bottle', 'magic_wand', 'boots', 'blink'], note: 'Use Blink if reaching a fight or landing your first spell is the bottleneck.' },
    easy: { items: ['bottle', 'magic_wand', 'boots', 'blink', 'black_king_bar'], note: 'Add Black King Bar if control is stopping you from getting spells off.' },
  },
  offlane: {
    bad: { items: ['arcane_boots', 'magic_wand', 'vladmir'], note: 'Group around a team aura your allies can use. Check who else is building it.' },
    good: { items: ['arcane_boots', 'magic_wand', 'blink', 'mekansm'], note: 'Buy Blink if your team needs you to start fights. Mekansm supports the follow-up.' },
    easy: { items: ['arcane_boots', 'magic_wand', 'blink', 'pipe'], note: 'Pipe gives the team a barrier when incoming magic damage is the problem.' },
  },
  'soft-support': {
    bad: { items: ['boots', 'magic_wand', 'urn_of_shadows', 'pavise'], note: 'Buy Urn if nobody on the team has one. Pavise helps an ally survive physical damage.' },
    good: { items: ['boots', 'magic_wand', 'force_staff'], note: 'Use Force Staff to save an ally or fix a bad position in a fight.' },
    easy: { items: ['arcane_boots', 'magic_wand', 'blink'], note: 'Buy Blink if your hero has a disable that can start a fight.' },
  },
  'hard-support': {
    bad: { items: ['tranquil_boots', 'magic_wand', 'pavise'], note: 'Pavise gives an early ally save against physical damage.' },
    good: { items: ['boots', 'magic_wand', 'glimmer_cape'], note: 'Glimmer helps protect an ally against magic damage or lets them reposition.' },
    easy: { items: ['arcane_boots', 'magic_wand', 'force_staff'], note: 'Add repositioning when allies are getting trapped or caught out.' },
  },
};

const conditionItems = {
  armor: { carry: 'desolator', offlane: 'desolator', default: 'veil_of_discord' },
  evasion: { carry: 'monkey_king_bar', default: 'cyclone' },
  'magic-burst': { carry: 'black_king_bar', mid: 'black_king_bar', offlane: 'pipe', default: 'glimmer_cape' },
  'physical-burst': { carry: 'heavens_halberd', offlane: 'heavens_halberd', mid: 'ghost', default: 'pavise' },
  healing: { carry: 'orb_of_corrosion', default: 'spirit_vessel' },
  illusions: { carry: 'mjollnir', offlane: 'crimson_guard', default: 'veil_of_discord' },
  saves: { carry: 'nullifier', default: 'orchid' },
  control: { carry: 'black_king_bar', mid: 'black_king_bar', offlane: 'lotus_orb', default: 'force_staff' },
  kite: { carry: 'blink', mid: 'blink', offlane: 'blink', default: 'force_staff' },
  summons: { carry: 'mjollnir', offlane: 'crimson_guard', mid: 'veil_of_discord', default: 'buckler' },
};

const conditionPurchases = {
  desolator: {
    note: 'Use armor reduction when your team can follow up with physical damage.',
    bridge: { itemKey: 'blight_stone', note: 'Apply a cheaper armor debuff while saving for Desolator.' },
  },
  veil_of_discord: { note: 'Invest in spell damage if your team can rely on spells for the fight.' },
  monkey_king_bar: { note: 'Buy Pierce when repeated misses are costing you attacks.' },
  cyclone: { note: 'Use Cyclone to interrupt an evasive attacker or buy time for allies to reposition.' },
  black_king_bar: { note: 'Buy debuff immunity when nonpiercing spells are cutting your attack or cast window short.' },
  pipe: {
    note: 'Prioritize a team magic barrier if several allies are taking spell burst.',
    bridge: { itemKey: 'cloak', note: 'Buy personal magic resistance until the team barrier is affordable.' },
  },
  glimmer_cape: {
    note: 'Bring the magic barrier forward to protect the ally being burst.',
    bridge: { itemKey: 'shawl', note: 'Build toward Glimmer Cape with its magic-resistance component.' },
  },
  heavens_halberd: { note: 'Use the disarm before the enemy commits their attack burst.' },
  ghost: { note: 'Keep Ghost Scepter for an attack-based jump. Check enemy magic damage before using it.' },
  pavise: { note: 'Shield the teammate taking the brunt of the physical burst.' },
  orb_of_corrosion: { note: 'Apply the healing reduction to the target you can keep hitting.' },
  spirit_vessel: {
    note: 'Coordinate one Vessel buyer and save a charge to reduce the target’s healing.',
    bridge: { itemKey: 'urn_of_shadows', note: 'Start with Urn and finish Vessel when you can afford the healing reduction.' },
  },
  mjollnir: {
    note: 'Use chain lightning to deal with waves of copies or summoned units.',
    bridge: { itemKey: 'maelstrom', note: 'Get cheaper wave clear first and finish Mjollnir when you have the gold.' },
  },
  crimson_guard: {
    note: 'Prioritize group damage block against frequent attacks from many units.',
    bridge: { itemKey: 'vanguard', note: 'Start with personal block while saving for protection for the team.' },
  },
  nullifier: { note: 'Buy Nullifier when dispellable defensive buffs keep targets alive.' },
  orchid: { note: 'Silence the save caster before committing damage if their dispels are limited.' },
  lotus_orb: { note: 'Use the dispel and spell reflection on an ally facing targeted spells.' },
  force_staff: { note: 'Reposition yourself or an ally out of follow-up damage when you can use Force Staff.' },
  blink: { note: 'Use Blink to start in range before the enemy can create distance.' },
  buckler: { note: 'Pick up armor for grouped allies defending against summoned attackers.' },
};

// Group the condition purchases that replace a component or another branch of the same upgrade.
const conditionFamilies = [
  ['blight_stone', 'desolator'], ['pavise', 'solar_crest'], ['orchid', 'bloodthorn'],
  ['urn_of_shadows', 'spirit_vessel'], ['maelstrom', 'mjollnir', 'gungir'],
  ['vanguard', 'crimson_guard', 'buckler'], ['pipe', 'cloak'], ['glimmer_cape', 'shawl'],
  ['blink', 'arcane_blink', 'swift_blink', 'overwhelming_blink'],
  ['force_staff', 'hurricane_pike'], ['cyclone', 'wind_waker'],
];

function familyReplacements(itemKey) {
  const family = conditionFamilies.find((group) => group.includes(itemKey)) ?? [];
  return family.filter((key) => key !== itemKey);
}

function roleSwap(role, trigger) {
  if (!Object.hasOwn(conditionItems, trigger)) throw new RangeError('Select a supported game condition.');
  const choices = conditionItems[trigger];
  const itemKey = choices[role] ?? choices.default;
  const { note, bridge } = conditionPurchases[itemKey];
  return { trigger, itemKey, note, replaceKeys: familyReplacements(itemKey),
    ...(bridge && { bridge: { ...bridge, replaceKeys: familyReplacements(bridge.itemKey) } }),
  };
}

function formatScenario({ key, quantile, budget, gpm, basis, sampleSize }) {
  return { key, label: farmLabels[key], quantile, budget, gpm, basis, sampleSize };
}

function observedPurchases(heroId, role, catalog, snapshot, options) {
  const { rankTier, patchConfidence, targetMinute } = options;
  const cutoff = targetMinute * 60;
  const counts = new Map();
  let sampleSize = 0;
  for (const match of snapshot?.matches ?? []) {
    if (match.rankTier !== rankTier || match.duration < cutoff
      || (patchConfidence === 'verified' && match.patchConfidence !== 'verified')) continue;
    const player = match.players.find((entry) => entry.heroId === heroId && entry.role === role);
    if (!Array.isArray(player?.purchases)) continue;
    sampleSize += 1;
    const bought = new Set(player.purchases.filter(({ key, time }) => completedPurchases.has(key)
      && Number.isFinite(time) && time <= cutoff).map(({ key }) => key));
    for (const key of bought) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (sampleSize < 3) return null;
  const items = [...counts].flatMap(([key, games]) => {
    const item = catalog.get(key);
    if (!item || games < 2) return [];
    const { id, name, cost } = item;
    return [{ id, key, name, cost, games }];
  }).sort((a, b) => b.games - a.games || a.cost - b.cost || a.id - b.id).slice(0, 5);
  return items.length ? { sampleSize, targetMinute, items } : null;
}

function modeledCarry(hero, items, economy, options) {
  if (!hero?.levels?.some(({ level }) => level === options.level) || !economy.scenarios.length) return null;
  const candidates = items.filter(({ key }) => carryDamageItems.has(key));
  const budgets = economy.scenarios.map(({ budget }) => budget);
  const analyze = createDpsBudgetAnalyzer(candidates, budgets, options);
  const { baselineDps, builds } = analyze(hero);
  if (!Number.isFinite(baselineDps)) return null;
  return economy.scenarios.map((scenario) => {
    const { items, spent, dps, gain, coverage } = builds.get(scenario.budget);
    return {
      ...formatScenario(scenario),
      items: items.map(({ id, key, name, cost }) => ({ id, key, name, cost, affordable: true })),
      spent, unspent: scenario.budget - spent, dps, gain, baselineDps, coverage,
    };
  });
}

function resolveCondition(role, condition, curated, combined) {
  const heroSwap = curated?.swaps?.find(({ trigger }) => trigger === condition);
  const choice = heroSwap ?? roleSwap(role, condition);
  const source = heroSwap ? 'hero-specific' : 'role-based';
  if (!combined) return { ...choice, source };

  // Cloak is an interim defense for spell damage when debuff immunity is beyond this budget.
  const bridge = choice.bridge ?? (!heroSwap && condition === 'magic-burst' && choice.itemKey === 'black_king_bar'
    ? { itemKey: 'cloak', note: 'Buy personal magic resistance while saving for Black King Bar if spells still stop you from fighting.' }
    : null);
  return { ...choice, source, familyKeys: familyReplacements(choice.itemKey),
    ...(bridge && { bridge: { ...bridge, familyKeys: familyReplacements(bridge.itemKey) } }),
  };
}

export function buildHeroFarm(hero, items, catalog, plans, economy, { role, replayPicks = 0, snapshot, condition = '', conditions }) {
  const { options, roles } = economy;
  const roleEconomy = roles.find(({ key }) => key === role);
  if (!roleEconomy) throw new RangeError('Select a Legend role with a budget profile.');
  const selectedConditions = [...new Set(conditions ?? (condition ? [condition] : []))];
  const [primaryCondition] = selectedConditions;
  const { targetMinute, reserveGold, targetArmor, level, maxItems } = options;
  const observed = observedPurchases(hero?.id, role, catalog, snapshot, options);
  const context = {
    role, roleLabel: roleEconomy.label, replayPicks, targetMinute, reserveGold, targetArmor, level, maxItems,
    ...(observed && { observedPurchases: observed }),
  };
  const curated = plans.find((plan) => plan.heroId === hero?.id && plan.role === role);
  const modeled = !primaryCondition && !curated && role === 'carry' && modeledCarry(hero, items, roleEconomy, options);
  if (modeled) {
    return {
      ...context,
      type: 'right-click-model',
      label: 'Modeled damage items',
      note: 'Compare up to two carry items by sustained attack damage. The model assumes an empty inventory and one target. Use the items as build options and account for your farming needs and the draft.',
      scenarios: modeled,
    };
  }

  const basePlan = curated ?? { builds: roleTemplates[role] };
  const combined = selectedConditions.length > 1;
  const swaps = selectedConditions.map((key) => resolveCondition(role, key, curated, combined));
  const [firstSwap] = swaps;
  const conditionSource = swaps.some(({ source }) => source !== firstSwap.source) ? 'mixed' : firstSwap?.source;
  const plan = firstSwap ? { ...basePlan, swaps } : basePlan;
  const { builds } = priceDraftPlan(plan, catalog, roleEconomy, combined ? selectedConditions : primaryCondition);
  return {
    ...context,
    ...(firstSwap && { condition: primaryCondition, conditions: selectedConditions, conditionSource }),
    type: curated ? 'curated' : 'role-template',
    label: curated ? 'Hero-specific purchase guide' : 'Role-based purchase examples',
    note: curated
      ? 'The gold estimate prices the recommended sequence from an empty inventory.'
      : 'Use these purchases as starting points for the position. Adapt the order and utility choices to your hero and draft.',
    scenarios: builds.map((build) => {
      const roleScenario = roleEconomy.scenarios.find(({ key }) => key === build.key);
      const spent = roleScenario ? build.steps.filter(({ affordable }) => affordable).at(-1)?.cumulativeCost ?? 0 : null;
      const singleChanges = build.change && [{ ...build.change, condition: primaryCondition, source: firstSwap.source,
        affordable: build.steps.find(({ key }) => key === build.change.itemKey).affordable }];
      return {
        ...formatScenario({ ...build, basis: roleScenario?.basis ?? 'unavailable', sampleSize: roleScenario?.sampleSize ?? 0 }),
        items: build.steps,
        spent,
        unspent: roleScenario ? roleScenario.budget - spent : null,
        note: build.note,
        ...(build.change && { change: build.change }),
        ...((build.changes || singleChanges) && { changes: build.changes ?? singleChanges }),
      };
    }),
  };
}
