import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { searchStartingBuilds, STARTING_GOLD } from '../lib/starting-builds.mjs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`../data/7.42/${name}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
}

const items = load('item-mechanics').items;
const hero = load('hero-dps').heroes.find(({ id }) => id === 1);
const sample = new Set(['branches', 'slippers', 'quelling_blade', 'magic_stick', 'faerie_fire',
  'infused_raindrop', 'tpscroll', 'smoke_of_deceit', 'tango', 'flask', 'clarity', 'enchanted_mango',
  'blood_grenade', 'ward_sentry']);
const catalog = new Map(load('shop-items').items.filter(({ key }) => sample.has(key)).map((item) => [item.key, item]));

test('finds distinct legal shopping bundles at the default pre-horn budget', () => {
  const build = searchStartingBuilds({ hero, items, catalog, role: 'carry' });
  assert.deepEqual(build.lanes.map(({ key }) => key), ['balanced', 'sustain', 'trading', 'last-hits']);
  assert.ok(build.search.evaluated > 250);
  assert.equal(build.search.minEquipmentGold, 150);
  for (const { results } of build.lanes) {
    assert.equal(results.length, 3);
    assert.ok(results.every(({ score }, index) => !index || score <= results[index - 1].score));
    const signatures = new Set();
    for (const { cost, unspent, slots, items: purchases } of results) {
      assert.equal(cost, purchases.reduce((total, row) => total + row.cost * row.quantity, 0));
      assert.equal(unspent + cost, STARTING_GOLD);
      assert.ok(unspent >= 0);
      assert.ok(slots <= 6);
      const gear = purchases.filter(({ key }) => ['branches', 'slippers', 'quelling_blade', 'magic_stick'].includes(key));
      assert.ok(gear.reduce((total, row) => total + row.cost * row.quantity, 0) >= 150);
      assert.ok(purchases.filter(({ key }) => ['blood_grenade', 'faerie_fire'].includes(key)).every(({ quantity }) => quantity === 1));
      assert.ok(purchases.every(({ key }) => !['tpscroll', 'infused_raindrop', 'smoke_of_deceit'].includes(key)));
      signatures.add(purchases.map(({ key, quantity }) => `${key}:${quantity}`).join(','));
    }
    assert.equal(signatures.size, results.length);
  }
});

test('counts a Tango stack as one carried slot and Branches individually', () => {
  const starters = new Map(['branches', 'tango'].map((key) => [key, catalog.get(key)]));
  const build = searchStartingBuilds({ hero, items, catalog: starters, role: 'carry' });
  const { slots, items: purchases } = build.lanes.find(({ key }) => key === 'sustain').results[0];
  const branches = purchases.find(({ key }) => key === 'branches').quantity;
  const tangos = purchases.find(({ key }) => key === 'tango').quantity;
  assert.ok(branches <= 3);
  assert.equal(tangos, 2);
  assert.equal(slots, branches + 1);
});

test('handles smaller starting budgets and rejects unavailable extra gold', () => {
  const inputs = { hero, items, catalog, role: 'mid' };
  const tight = searchStartingBuilds({ ...inputs, budget: 100 });
  assert.ok(tight.lanes.every(({ results }) => results.length && results.every(({ cost }) => cost <= 100)));
  const empty = searchStartingBuilds({ ...inputs, budget: 0 });
  assert.ok(empty.lanes.every(({ results }) => !results.length));
  assert.throws(() => searchStartingBuilds({ ...inputs, budget: 601 }), RangeError);
});
