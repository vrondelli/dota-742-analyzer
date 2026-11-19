import { createStartingScorer } from './starting-build-scoring.mjs';

export const STARTING_GOLD = 600;
const maxSlots = 6;
const resultLimit = 3;

// Priced pre-horn equipment in the pinned 7.42 shop. Completed items include
// their paid recipe. The zero-cost recipes for held shop gear exceed this pool's budget.
const startingEquipment = new Set([
  'blades_of_attack', 'chainmail', 'quelling_blade', 'wind_lace', 'ring_of_protection',
  'gauntlets', 'slippers', 'mantle', 'branches', 'belt_of_strength', 'boots_of_elves',
  'robe', 'circlet', 'crown', 'gloves', 'ring_of_regen', 'sobi_mask', 'boots', 'shawl',
  'magic_stick', 'magic_wand', 'fluffy_hat', 'wizard_hat', 'bracer', 'wraith_band',
  'null_talisman', 'buckler', 'ring_of_basilius', 'headdress', 'orb_of_venom',
  'blight_stone', 'orb_of_frost',
]);

// Search at most these many copies of each repeat starter. A stack size of one
// means each purchase needs its own inventory slot, as with Iron Branches.
const repeats = new Map([
  ['branches', 3], ['gauntlets', 2], ['slippers', 2], ['mantle', 2], ['circlet', 2],
  ['ring_of_protection', 2], ['ring_of_regen', 2], ['sobi_mask', 2], ['fluffy_hat', 2],
  ['wizard_hat', 2],
]);

const consumables = new Map([
  ['tango', { max: 2, stackSize: 2 }], ['flask', { max: 2, stackSize: 2 }],
  ['clarity', { max: 2, stackSize: 2 }], ['enchanted_mango', { max: 3, stackSize: 3 }],
  ['faerie_fire', { max: 1, stackSize: 1 }], ['blood_grenade', { max: 1, stackSize: 1 }],
  ['ward_sentry', { max: 1, stackSize: 1 }],
]);

function candidateItems(catalog, budget) {
  return [...catalog.values()].flatMap(({ key, name, cost }) => {
    const equipment = startingEquipment.has(key);
    const consumable = consumables.get(key);
    if ((!equipment && !consumable) || !Number.isSafeInteger(cost) || cost < 1 || cost > budget) return [];
    return [{ key, name, cost, equipment, max: consumable?.max ?? repeats.get(key) ?? 1,
      stackSize: consumable?.stackSize ?? 1 }];
  }).sort((first, second) => first.cost - second.cost || first.key.localeCompare(second.key));
}

function retainResult(results, score, cost, slots, bundle, budget, metrics, notes) {
  if (!Number.isFinite(score)) return;
  const candidate = results.findIndex((other) => score > other.score
    || (score === other.score && (cost < other.cost || (cost === other.cost && slots < other.slots))));
  if (candidate === -1 && results.length >= resultLimit) return;
  const result = { score, cost, unspent: budget - cost, slots, items: [...bundle], metrics, notes };
  if (candidate === -1) results.push(result);
  else results.splice(candidate, 0, result);
  if (results.length > resultLimit) results.pop();
}

export function searchStartingBuilds({ hero, items, catalog, role, budget = STARTING_GOLD }) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > STARTING_GOLD) {
    throw new RangeError(`Starting gold must be a whole amount between 0 and ${STARTING_GOLD}.`);
  }
  const candidates = candidateItems(catalog, budget);
  const minEquipmentGold = Math.floor(budget / 4);
  const scorer = createStartingScorer(hero, items, role);
  const lanes = scorer.lanes.map((lane) => ({ ...lane, results: [] }));
  const bundle = [];
  let evaluated = 0;

  function visit(start, cost, slots, equipmentGold) {
    if (equipmentGold + budget - cost < minEquipmentGold) return;
    if (equipmentGold > 0 && equipmentGold >= minEquipmentGold) {
      const { scores, metrics, notes } = scorer.score(bundle);
      for (const { key, results } of lanes) {
        retainResult(results, scores[key], cost, slots, bundle, budget, metrics, notes);
      }
      evaluated += 1;
    }

    for (let index = start; index < candidates.length; index += 1) {
      const { key, name, cost: unit, equipment, max, stackSize } = candidates[index];
      if (cost + unit > budget) break;
      for (let quantity = 1; quantity <= max; quantity += 1) {
        const nextCost = cost + unit * quantity;
        const nextSlots = slots + Math.ceil(quantity / stackSize);
        if (nextCost > budget || nextSlots > maxSlots) break;
        bundle.push({ key, name, cost: unit, quantity });
        visit(index + 1, nextCost, nextSlots, equipmentGold + (equipment ? unit * quantity : 0));
        bundle.pop();
      }
    }
  }

  visit(0, 0, 0, 0);
  return { lanes, search: { candidateItems: candidates.length, evaluated, maxSlots, maxBudget: STARTING_GOLD, minEquipmentGold } };
}
