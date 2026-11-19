import { MAX_TIMING_STEPS, timingItemOptions } from './build-timing-paths.mjs';
import { heldRecipeIngredients } from './build-timings.mjs';

const targetMinutes = [15, 20, 30];
const alternatives = 3;
const spendingBands = 5;
const bandWidth = 3;
const tolerance = 1e-8;
const boots = new Set([
  'boots', 'power_treads', 'phase_boots', 'arcane_boots', 'tranquil_boots', 'travel_boots',
  'travel_boots_2', 'boots_of_bearing', 'guardian_greaves',
]);

function describeItem({ key, name, cost }) {
  return { key, name, cost };
}

function shoppingTime(checkpoints, start, cost) {
  let left = start;
  let right = checkpoints.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (checkpoints[middle].budget >= cost) right = middle;
    else left = middle + 1;
  }
  return left;
}

function recordBest(rows, state, compare, limit) {
  const existing = rows.findIndex((row) => row.signature === state.signature);
  if (existing !== -1) {
    if (compare(rows[existing], state) <= 0) return;
    rows.splice(existing, 1);
  }
  const index = rows.findIndex((row) => compare(state, row) < 0);
  if (index !== -1) rows.splice(index, 0, state);
  else if (rows.length < limit) rows.push(state);
  if (rows.length > limit) rows.pop();
}

function progression(checkpoints, score) {
  const levels = new Map();
  function evaluate(state, level) {
    if (!levels.has(level)) levels.set(level, new Map());
    const cached = levels.get(level);
    if (!cached.has(state.signature)) cached.set(state.signature, score(state.items, level));
    return cached.get(state.signature);
  }
  function through(state, index) {
    let result = state.early;
    for (let i = state.time; i < index; i += 1) {
      result += evaluate(state, checkpoints[i].level).score * (checkpoints[i + 1].minute - checkpoints[i].minute);
    }
    return result;
  }
  return { evaluate, through };
}

function purchase(state, item, checkpoints, through) {
  if (state.steps.some(({ key }) => key === item.key)) return null;
  const consumed = heldRecipeIngredients(item.key, state.keys);
  if (boots.has(item.key) && state.items.some(({ key }) => boots.has(key) && !consumed.includes(key))) return null;
  const components = state.items.filter(({ key }) => consumed.includes(key));
  const kept = state.items.filter(({ key }) => !consumed.includes(key));
  const incrementalCost = item.cost - components.reduce((sum, { cost }) => sum + cost, 0);
  if (incrementalCost < 0) return null;
  const spent = state.spent + incrementalCost;
  const time = shoppingTime(checkpoints, state.time, spent);
  if (time === checkpoints.length) return null;
  const items = [...kept, item].sort((a, b) => a.key.localeCompare(b.key));
  const keys = new Set(items.map(({ key }) => key));
  const signature = [...keys].join(',');
  const step = { ...describeItem(item), minute: checkpoints[time].minute, incrementalCost,
    replacedItems: components.map(describeItem) };
  return { items, keys, signature, time, spent, early: through(state, time), steps: [...state.steps, step] };
}

function betterHistory(candidate, existing) {
  if (Math.abs(candidate.early - existing.early) > tolerance) return candidate.early > existing.early;
  return candidate.time < existing.time;
}

export function searchBuildOrders({ items, checkpoints, score, seedPaths = [], utilityItemKeys = [] }) {
  const planned = checkpoints.filter(({ minute }) => minute <= targetMinutes.at(-1));
  const checked = planned.flatMap((point, index) => targetMinutes.includes(point.minute) ? [{ ...point, index }] : []);
  const beamWidth = spendingBands * bandWidth * checked.length;
  const search = { candidateItems: 0, evaluated: 0, beamWidth, maxSteps: MAX_TIMING_STEPS, approximate: true };
  if (!checked.length) return { marks: [], search };

  const maxBudget = planned.at(-1).budget;
  const knownUtility = new Set(utilityItemKeys);
  const keys = new Set(timingItemOptions(items).map(({ key }) => key));
  const candidates = items.filter(({ key, cost, coverage }) => keys.has(key) && cost <= maxBudget
    && (coverage !== 'unmodelled' || knownUtility.has(key)))
    .sort((a, b) => a.cost - b.cost || a.key.localeCompare(b.key));
  search.candidateItems = candidates.length;
  const catalog = new Map(candidates.map((item) => [item.key, item]));
  const { evaluate, through } = progression(planned, score);
  const empty = { items: [], keys: new Set(), signature: '', time: 0, spent: 0, early: 0, steps: [] };

  const marks = checked.map((mark) => {
    const compare = (a, b) => {
      const final = evaluate(b, mark.level).score - evaluate(a, mark.level).score;
      if (Math.abs(final) > tolerance) return final;
      const timing = through(b, mark.index) - through(a, mark.index);
      if (Math.abs(timing) > tolerance) return timing;
      return a.spent - b.spent || a.signature.localeCompare(b.signature);
    };
    return { ...mark, compare, best: [] };
  });

  const seeds = Array.from({ length: MAX_TIMING_STEPS }, () => []);
  for (const { steps } of seedPaths) {
    let state = empty;
    for (const [index, { key }] of steps.slice(0, MAX_TIMING_STEPS).entries()) {
      const item = catalog.get(key);
      if (!item) break;
      state = purchase(state, item, planned, through);
      if (!state) break;
      seeds[index].push(state);
    }
  }

  let beam = [empty];
  for (let depth = 0; depth < MAX_TIMING_STEPS; depth += 1) {
    const next = new Map();
    const offer = (candidate) => {
      const existing = next.get(candidate.signature);
      if (!existing || betterHistory(candidate, existing)) next.set(candidate.signature, candidate);
    };
    for (const state of beam) for (const item of candidates) {
      const candidate = purchase(state, item, planned, through);
      if (!candidate) continue;
      search.evaluated += 1;
      offer(candidate);
    }
    for (const seed of seeds[depth]) offer(seed);

    const nextBeam = new Map();
    for (const mark of marks) {
      const bands = Array.from({ length: spendingBands }, () => []);
      for (const state of next.values()) {
        if (state.time > mark.index) continue;
        const band = Math.min(spendingBands - 1, Math.floor(spendingBands * state.spent / Math.max(1, mark.budget)));
        recordBest(mark.best, state, mark.compare, alternatives);
        recordBest(bands[band], state, mark.compare, bandWidth);
      }
      for (const band of bands) for (const state of band) nextBeam.set(state.signature, state);
    }
    beam = [...nextBeam.values()];
  }

  return { marks: marks.map(({ minute, level, budget, basis, sampleSize, best, index }) => ({ minute, level, budget, basis, sampleSize,
    results: best.map((state) => ({ steps: state.steps, items: state.items.map(describeItem), spent: state.spent,
      ...evaluate(state, level), earlyScore: through(state, index) / Math.max(1, minute - planned[0].minute) })),
  })), search };
}
