import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeBuilds } from '../lib/build-efficiency.mjs';
import { simulateBuildTimings } from '../lib/build-timings.mjs';

const load = (file) => JSON.parse(readFileSync(new URL(`../data/7.42/${file}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const hero = load('hero-dps').heroes.find(({ id }) => id === 1);
const { items } = load('item-mechanics');
const path = (key, ...steps) => ({ key, label: key, steps: steps.map((step) => typeof step === 'string' ? { key: step } : step) });
const point = (minute, budget, level = 12) => ({ minute, budget, level });
const run = (checkpoints, paths, options) => simulateBuildTimings({ hero, items, checkpoints, paths, options }).paths;

test('rushing and building Maelstrom first converge after both items are complete', () => {
  const [rush, farm, components] = run([
    point(0, 0, 1), point(3, 1400, 3), point(6, 3400, 6), point(8, 4350, 7),
    point(12, 6600, 9), point(20, 9550),
  ], [
    path('rush', 'power_treads', 'greater_crit', 'maelstrom'),
    path('farm', 'power_treads', 'maelstrom', 'greater_crit'),
    path('components', 'power_treads', 'lesser_crit', 'greater_crit', 'maelstrom'),
  ]);
  assert.deepEqual(rush.purchases.map(({ minute }) => minute), [3, 12, 20]);
  assert.deepEqual(farm.purchases.map(({ minute }) => minute), [3, 8, 20]);
  assert.deepEqual(components.purchases.map(({ minute }) => minute), [3, 6, 12, 20]);
  assert.equal(components.purchases[2].incrementalCost, 3200);
  assert.equal(components.purchases[2].replaces, 'lesser_crit');
  assert.ok(farm.points[3].procDps > 0);
  assert.equal(rush.points[3].procDps, 0);
  assert.equal(rush.points.at(-1).spent, 9550);
  assert.equal(components.points.at(-1).spent, 9550);
  assert.ok(Math.abs(rush.points.at(-1).dps - farm.points.at(-1).dps) < 1e-9);
  assert.deepEqual(components.points.at(-1).items.map(({ key }) => key), ['power_treads', 'greater_crit', 'maelstrom']);
});

test('an upgrade credits every held ingredient and retains only the completed item', () => {
  const [result] = run([point(5, 2950), point(10, 4950), point(12, 5500)], [path('mjollnir',
    'maelstrom', 'hyperstone', { key: 'mjollnir', replaces: 'maelstrom' }, 'greater_crit')]);
  assert.deepEqual(result.purchases.map(({ minute }) => minute), [5, 10, 12, null]);
  assert.deepEqual(result.purchases[2].replacedItems.map(({ key }) => key), ['maelstrom', 'hyperstone']);
  assert.equal(result.purchases[2].incrementalCost, 550);
  assert.equal(result.points.at(-1).spent, 5500);
  assert.deepEqual(result.points.at(-1).items.map(({ key }) => key), ['mjollnir']);
});

test('basic upgrades remove their components and a repeated recipe component is credited once', () => {
  const recipes = {
    ring_of_basilius: ['sobi_mask'],
    bracer: ['circlet', 'gauntlets'],
    null_talisman: ['circlet', 'mantle'],
    wraith_band: ['circlet', 'slippers'],
    vanguard: ['ring_of_health', 'vitality_booster'],
    moon_shard: ['hyperstone'],
  };
  const price = (target) => items.find(({ key }) => key === target).cost;
  for (const [upgrade, components] of Object.entries(recipes)) {
    const [result] = run([point(15, price(upgrade))], [path(upgrade, ...components, upgrade)]);
    assert.equal(result.purchases.at(-1).incrementalCost, price(upgrade) - components.reduce((sum, key) => sum + price(key), 0));
    assert.deepEqual(result.purchases.at(-1).replacedItems.map(({ key }) => key).sort(), [...components].sort());
    assert.deepEqual(result.points.at(-1).items.map(({ key }) => key), [upgrade]);
    assert.equal(result.points.at(-1).spent, price(upgrade));
  }
});

test('Treads can use a preferred recipe attribute while retaining other held components', () => {
  const [result] = run([point(10, 2000)], [path('treads', 'boots', 'gloves', 'belt_of_strength', 'robe',
    { key: 'power_treads', replaces: 'robe' })]);
  assert.deepEqual(result.purchases.at(-1).replacedItems.map(({ key }) => key), ['boots', 'gloves', 'robe']);
  assert.deepEqual(result.points.at(-1).items.map(({ key }) => key), ['belt_of_strength', 'power_treads']);
  assert.equal(result.points.at(-1).spent, 1850);
});

test('farm income starts after the farm item completes and can advance later purchases', () => {
  const checkpoints = [point(5, 3000), point(10, 4700), point(15, 6750), point(20, 8150)];
  const paths = [path('farm', 'maelstrom', 'greater_crit'), path('rush', 'greater_crit', 'maelstrom')];
  const [control] = run(checkpoints, paths);
  const [farm, rush] = run(checkpoints, paths, { bonusGpm: 150 });
  assert.equal(control.purchases[1].minute, 20);
  assert.equal(farm.purchases[1].minute, 15);
  assert.equal(farm.points[0].bonusGold, 0);
  assert.equal(farm.points[1].bonusGold, 750);
  assert.equal(farm.points[2].baseBudget, 6750);
  assert.equal(rush.points.at(-1).bonusGold, 0);
});

test('physical damage matches the item lab and modeled magic procs add a separate DPS column', () => {
  const itemKeys = ['greater_crit', 'maelstrom'];
  const [timings] = run([point(20, 8150)], [path('pair', ...itemKeys)], { targetArmor: 10, targetMagicResistance: 25 });
  const lab = analyzeBuilds(hero, items, { budget: 8150, itemKeys, level: 12, targetArmor: 10, targetMagicResistance: 25 });
  const [milestone] = timings.points;
  assert.equal(milestone.physicalDps, lab.rows[0].metrics.physicalDps);
  assert.equal(milestone.procDps, lab.rows[0].metrics.onHitMagicDamage / lab.options.windowSeconds);
  assert.equal(milestone.dps, milestone.physicalDps + milestone.procDps);
});

test('invalid upgrade claims and decreasing budgets are rejected', () => {
  assert.throws(() => run([point(20, 8150)], [path('invalid', 'maelstrom', { key: 'gungir', replaces: 'maelstrom' })]), /cannot credit/);
  assert.throws(() => run([point(10, 2000), point(15, 1900)], [path('invalid', 'maelstrom')]), /nondecreasing budgets/);
  assert.throws(() => run([point(15, 5000)], [path('invalid', 'power_treads', 'power_treads')]), /already holds/);
});
