import test from 'node:test';
import assert from 'node:assert/strict';
import { searchBuildOrders } from '../lib/build-search.mjs';

const equipment = (key, cost, power, coverage = 'flat') => ({ key, name: key, cost, power, coverage });
const score = (items) => {
  const power = items.reduce((sum, item) => sum + item.power, 0);
  return { score: power, metrics: { power } };
};
const checkpoints = (entries) => entries.map(([minute, budget]) => ({ minute, budget, level: 10 }));

test('search keeps earlier gains when two orders finish with the same best inventory', () => {
  const marks = checkpoints([[0, 0], [5, 100], [10, 400], [15, 500], [20, 650], [30, 700]]);
  const items = [equipment('early', 100, 14), equipment('late', 400, 26), equipment('standalone', 600, 45)];
  const result = searchBuildOrders({ items, score, checkpoints: marks });
  assert.deepEqual(result.marks.map(({ minute }) => minute), [15, 20, 30]);
  assert.deepEqual(result.marks[0].results[0].steps.map(({ key, minute }) => [key, minute]), [['early', 5], ['late', 15]]);
  assert.equal(result.marks[1].results[0].steps.at(-1).key, 'standalone');
  for (const { results, budget } of result.marks) {
    assert.ok(results.every(({ spent }) => spent <= budget));
    assert.equal(new Set(results.map(({ items }) => items.map(({ key }) => key).join(','))).size, results.length);
  }
});

test('search credits completed ingredients and excludes an additional pair of boots', () => {
  const marks = checkpoints([[0, 0], [8, 2000], [15, 2900], [20, 5200], [30, 7000]]);
  const items = [equipment('lesser_crit', 2000, 20), equipment('greater_crit', 5200, 70),
    equipment('boots', 500, 2), equipment('power_treads', 1400, 12), equipment('phase_boots', 1500, 16)];
  const { marks: result } = searchBuildOrders({ items, score, checkpoints: marks });
  const at20 = result[1].results[0];
  assert.deepEqual(at20.items.map(({ key }) => key), ['greater_crit']);
  assert.equal(at20.steps.at(-1).incrementalCost, 3200);
  assert.deepEqual(at20.steps.at(-1).replacedItems.map(({ key }) => key), ['lesser_crit']);
  assert.equal(at20.spent, 5200);
  assert.ok(result.flatMap(({ results }) => results).every(({ items }) =>
    items.filter(({ key }) => key === 'boots' || key.endsWith('_boots') || key === 'power_treads').length <= 1));
});

test('explicit utility coverage includes an otherwise unmodeled tool', () => {
  const input = { items: [equipment('blink', 2250, 100, 'unmodelled'), equipment('wand', 450, 8)], score,
    checkpoints: checkpoints([[0, 0], [15, 2400], [20, 2700], [30, 3000]]) };
  const firstItem = (options) => searchBuildOrders(options).marks[0].results[0].steps[0].key;
  assert.equal(firstItem(input), 'wand');
  assert.equal(firstItem({ ...input, utilityItemKeys: ['blink'] }), 'blink');
  assert.deepEqual(searchBuildOrders({ ...input, checkpoints: checkpoints([[0, 0], [15, 10]]) }).marks[0].results, []);
});
