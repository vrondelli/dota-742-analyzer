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

export function priceDraftPlan(plan, catalog, economy, condition = '') {
  if (condition && !priorities.has(condition)) throw new RangeError('Select a supported game condition.');
  const swap = (plan.swaps ?? []).find(({ trigger }) => trigger === condition);
  return {
    ...plan,
    condition,
    conditionSupported: Boolean(swap),
    builds: scenarios.map(({ key, label, quantile }) => {
      const scenario = economy.scenarios.find((entry) => entry.key === key);
      const { items, note } = plan.builds[key];
      const { keys, change } = pathWithBudget(items, swap, catalog, scenario);
      let cumulativeCost = 0;
      const steps = keys.map((itemKey) => {
        const item = shopItem(catalog, itemKey);
        cumulativeCost += item.cost;
        return {
          ...item,
          cumulativeCost,
          affordable: scenario ? cumulativeCost <= scenario.budget : null,
          conditionItem: change?.itemKey === itemKey,
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
      };
    }),
    swaps: (plan.swaps ?? []).map(({ trigger, itemKey, note }) => ({
      trigger, label: priorities.get(trigger), item: shopItem(catalog, itemKey), note,
    })),
  };
}
