import test from 'node:test';
import assert from 'node:assert/strict';
import { priceDraftPlan } from '../lib/draft-plans.mjs';

const catalog = new Map([
  ['wand', { id: 1, name: 'Wand', cost: 450 }],
  ['boots', { id: 2, name: 'Boots', cost: 500 }],
  ['damage', { id: 3, name: 'Damage', cost: 1000 }],
  ['barrier', { id: 4, name: 'Barrier', cost: 1400 }],
]);
const economy = { scenarios: [
  { key: 'bad', gpm: 150, budget: 2200 },
  { key: 'good', gpm: 200, budget: 2400 },
  { key: 'easy', gpm: 250, budget: 3000 },
] };
const guide = {
  builds: {
    bad: { items: ['wand', 'boots'], note: 'Bridge' },
    good: { items: ['wand', 'boots', 'damage'], note: 'Core' },
    easy: { items: ['wand', 'boots', 'damage', 'barrier'], note: 'Finish' },
  },
  swaps: [{ trigger: 'magic-burst', itemKey: 'barrier', replaceKeys: ['damage'], note: 'Buy defense' }],
};

test('conditions insert, replace or advance an item, then price the changed path', () => {
  const defaultBuild = priceDraftPlan(guide, catalog, economy).builds[1];
  assert.deepEqual(defaultBuild.steps.map(({ key }) => key), ['wand', 'boots', 'damage']);
  assert.equal(defaultBuild.cumulativeCost, 1950);
  const { builds, conditionSupported } = priceDraftPlan(guide, catalog, economy, 'magic-burst');
  assert.equal(conditionSupported, true);
  assert.deepEqual(builds.map(({ change }) => change.action), ['inserted', 'replaced', 'advanced']);
  assert.deepEqual(builds[0].steps.map(({ affordable }) => affordable), [true, true, false]);
  assert.deepEqual(builds[1].steps.map(({ key }) => key), ['wand', 'boots', 'barrier']);
  assert.equal(builds[1].steps.at(-1).cumulativeCost, 2350);
  assert.deepEqual(builds[2].steps.map(({ key }) => key), ['wand', 'boots', 'barrier', 'damage']);
  assert.equal(builds[2].steps[2].affordable, true);
  assert.equal(builds[2].steps[3].affordable, false);
});

test('an unsupported branch keeps its path and missing economy leaves affordability unknown', () => {
  const plan = priceDraftPlan(guide, catalog, { scenarios: [] }, 'illusions');
  assert.equal(plan.conditionSupported, false);
  assert.equal(plan.builds[1].budget, null);
  assert.equal(plan.builds[1].change, null);
  assert.ok(plan.builds[1].steps.every(({ affordable }) => affordable === null));
});

test('a budget-dependent branch keeps the bridge until the upgrade timing fits', () => {
  const bridge = { ...guide, swaps: [{ ...guide.swaps[0], bridge: { itemKey: 'damage', note: 'Keep the cheaper answer.' } }] };
  const result = priceDraftPlan(bridge, catalog, economy, 'magic-burst');
  assert.equal(result.builds[0].change.item.key, 'damage');
  assert.equal(result.builds[0].change.deferredItem.key, 'barrier');
  assert.equal(result.builds[0].steps.at(-1).affordable, true);
  assert.equal(result.builds[1].change.item.key, 'barrier');
});
