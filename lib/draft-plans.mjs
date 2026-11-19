export const DRAFT_CONDITIONS = Object.freeze([
  { key: 'armor', label: 'Armor stacking', heroIds: [49, 98] },
  { key: 'evasion', label: 'Evasion', heroIds: [21, 44] },
  { key: 'magic-burst', label: 'Heavy magic damage', heroIds: [22, 25, 26, 52, 101] },
  { key: 'physical-burst', label: 'Physical burst', heroIds: [8, 18, 44] },
  { key: 'healing', label: 'Healing or sustain', heroIds: [36, 50, 59, 91, 102, 111] },
  { key: 'illusions', label: 'Illusions', heroIds: [12, 81, 89, 109] },
  { key: 'saves', label: 'Enemy saves', heroIds: [50, 76, 79, 102, 111] },
  { key: 'control', label: 'Disables', heroIds: [2, 3, 26, 27, 33, 69] },
  { key: 'kite', label: 'Kiting or poor target access', heroIds: [6, 13, 35, 40, 47] },
  { key: 'summons', label: 'Summons or early push', heroIds: [38, 53, 61, 66, 77] },
]);

const scenarios = [
  { key: 'bad', label: 'Slow farm', quantile: 0.25 },
  { key: 'good', label: 'Steady farm', quantile: 0.50 },
  { key: 'easy', label: 'Fast farm', quantile: 0.85 },
];

const priorities = new Map(DRAFT_CONDITIONS.map(({ key, label }) => [key, label]));

function shopItem(catalog, key) {
  const item = catalog.get(key);
  if (!item || !Number.isSafeInteger(item.cost) || item.cost <= 0) {
    throw new Error(`Missing draft item price for ${key}.`);
  }
  const { id, name, cost } = item;
  return { key, id, name, cost };
}

function adaptPath(path, swap) {
  const keys = [...path];
  if (!swap) return { keys, change: null };
  const existing = keys.indexOf(swap.itemKey);
  const replace = existing < 0 ? keys.findIndex((key) => swap.replaceKeys?.includes(key)) : -1;
  const removed = [existing, replace].find((index) => index >= 0);
  const position = Math.min(removed ?? keys.length, 2);
  if (removed !== undefined) keys.splice(removed, 1);
  keys.splice(position, 0, swap.itemKey);
  const action = existing >= 0 ? (position === existing ? 'kept' : 'advanced') : replace >= 0 ? 'replaced' : 'inserted';
  return { keys, change: { action, itemKey: swap.itemKey, replaces: path[replace] ?? null, note: swap.note } };
}

function pathWithBudget(path, swap, catalog, scenario) {
  const adapted = adaptPath(path, swap);
  if (!swap?.bridge || !scenario) return adapted;
  const through = ({ keys }, itemKey) => {
    const index = keys.indexOf(itemKey);
    return keys.slice(0, index + 1).reduce((total, key) => total + shopItem(catalog, key).cost, 0);
  };
  if (through(adapted, swap.itemKey) <= scenario.budget) return adapted;
  const bridge = adaptPath(path, { ...swap, ...swap.bridge });
  return { ...bridge, change: { ...bridge.change, deferredItem: shopItem(catalog, swap.itemKey) } };
}

function conflicts(first, second) {
  return first.itemKey === second.itemKey || first.familyKeys?.includes(second.itemKey) || second.familyKeys?.includes(first.itemKey);
}

function combinedPath(path, swaps, catalog, scenario) {
  // Leave the opening purchases in place and allocate the remaining budget to counters.
  let opening = [...new Set(path.slice(0, 2))];
  let remainder = [...new Set(path.slice(2))].filter((key) => !opening.includes(key));
  const reserved = new Set(swaps.flatMap(({ itemKey, bridge }) => [itemKey, bridge?.itemKey]));
  const chosen = [];
  const changes = [];
  const cost = (key) => shopItem(catalog, key).cost;
  const overlaps = (key, swap, choice) => conflicts({ itemKey: key }, swap) || conflicts({ itemKey: key }, choice);

  for (const swap of swaps) {
    const blockedBy = chosen.find(({ wanted, choice }) => conflicts(wanted, swap) || conflicts(choice, swap));
    const common = { condition: swap.trigger, source: swap.source };
    if (blockedBy) {
      const { wanted, choice } = blockedBy;
      const shared = wanted.itemKey === swap.itemKey || choice.itemKey === swap.itemKey;
      const bridgeOnlyCoversEarlierThreat = shared && choice.itemKey !== swap.itemKey && choice.itemKey !== swap.bridge?.itemKey;
      changes.push({ ...common, itemKey: bridgeOnlyCoversEarlierThreat ? swap.itemKey : choice.itemKey,
        replaces: null, action: shared ? 'shared' : 'conflict',
        ...(shared
          ? { note: bridgeOnlyCoversEarlierThreat
              ? `${shopItem(catalog, choice.itemKey).name} is an interim buy for the earlier condition.`
              : choice.itemKey === swap.itemKey ? swap.note : swap.bridge.note,
            ...(choice.itemKey !== swap.itemKey && !bridgeOnlyCoversEarlierThreat && { deferredItem: shopItem(catalog, swap.itemKey) }) }
          : { requestedItem: shopItem(catalog, swap.itemKey), note: 'The higher-priority counter keeps this upgrade slot.' }),
      });
      continue;
    }

    const through = (choice) => opening.filter((key) => !overlaps(key, swap, choice)).reduce((sum, key) => sum + cost(key), 0)
      + chosen.filter(({ ready, inOpening }) => ready && !inOpening).reduce((sum, entry) => sum + cost(entry.choice.itemKey), 0)
      + cost(choice.itemKey);
    const fits = (choice) => !scenario || through(choice) <= scenario.budget;
    const bridge = swap.bridge && { ...swap, ...swap.bridge };
    const useBridge = bridge && !fits(swap)
      && !chosen.some(({ wanted, choice }) => conflicts(wanted, bridge) || conflicts(choice, bridge));
    const choice = useBridge ? bridge : swap;
    const ready = fits(choice);
    const inOpening = opening.includes(choice.itemKey);
    const existing = path.includes(choice.itemKey);
    const replace = existing ? null : remainder.find((key) => overlaps(key, swap, choice))
      ?? remainder.find((key) => choice.replaceKeys?.includes(key) && !reserved.has(key)) ?? null;
    opening = opening.filter((key) => key === choice.itemKey || !overlaps(key, swap, choice));
    remainder = remainder.filter((key) => key !== replace && !overlaps(key, swap, choice));
    chosen.push({ wanted: swap, choice, ready, inOpening });
    changes.push({ ...common, itemKey: choice.itemKey, replaces: replace,
      action: existing ? 'kept' : replace ? 'replaced' : 'inserted', note: choice.note,
      ...(useBridge && { deferredItem: shopItem(catalog, swap.itemKey) }),
    });
  }

  const counters = chosen.filter(({ inOpening }) => !inOpening);
  const keys = [...opening, ...counters.filter(({ ready }) => ready).map(({ choice }) => choice.itemKey),
    ...counters.filter(({ ready }) => !ready).map(({ choice }) => choice.itemKey), ...remainder];
  for (const change of changes) {
    if (change.action === 'kept' && keys.indexOf(change.itemKey) < path.indexOf(change.itemKey)) change.action = 'advanced';
  }
  return { keys, changes };
}

export function priceDraftPlan(plan, catalog, economy, condition = '') {
  const conditions = Array.isArray(condition) ? condition : condition ? [condition] : [];
  if (conditions.some((key) => !priorities.has(key))) throw new RangeError('Select a supported game condition.');
  const swaps = conditions.map((key) => plan.swaps?.find(({ trigger }) => trigger === key)).filter(Boolean);
  const [swap] = swaps;
  return {
    ...plan,
    condition,
    conditionSupported: Boolean(swap),
    builds: scenarios.map(({ key, label, quantile }) => {
      const scenario = economy.scenarios.find((entry) => entry.key === key);
      const { items, note } = plan.builds[key];
      const { keys, change = null, changes } = swaps.length > 1
        ? combinedPath(items, swaps, catalog, scenario) : pathWithBudget(items, swap, catalog, scenario);
      let cumulativeCost = 0;
      const steps = keys.map((itemKey) => {
        const item = shopItem(catalog, itemKey);
        cumulativeCost += item.cost;
        const threats = changes?.filter(({ itemKey: changed, action }) => changed === itemKey && action !== 'conflict')
          .map(({ condition: threat }) => threat);
        return {
          ...item,
          cumulativeCost,
          affordable: scenario ? cumulativeCost <= scenario.budget : null,
          conditionItem: change?.itemKey === itemKey || Boolean(threats?.length),
          ...(threats?.length && { conditions: threats }),
        };
      });
      return {
        key, label, quantile, note, steps, cumulativeCost,
        gpm: scenario?.gpm ?? null,
        budget: scenario?.budget ?? null,
        change: change && {
          ...change,
          item: shopItem(catalog, change.itemKey),
          replaces: change.replaces ? shopItem(catalog, change.replaces) : null,
        },
        ...(changes && { changes: changes.map((entry) => ({
          ...entry,
          item: shopItem(catalog, entry.itemKey),
          replaces: entry.replaces ? shopItem(catalog, entry.replaces) : null,
          affordable: scenario ? steps.find(({ key: itemKey }) => itemKey === entry.itemKey)?.affordable ?? false : null,
        })) }),
      };
    }),
    swaps: (plan.swaps ?? []).map(({ trigger, itemKey, note }) => ({
      trigger, label: priorities.get(trigger), item: shopItem(catalog, itemKey), note,
    })),
  };
}
