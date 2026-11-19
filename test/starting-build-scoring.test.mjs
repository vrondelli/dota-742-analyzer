import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStartingScorer } from '../lib/starting-build-scoring.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/7.42/${name}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const { heroes } = read('hero-dps');
const { items } = read('item-mechanics');
const hero = (id) => heroes.find((entry) => entry.id === id);
const bundle = (...keys) => keys.map((key) => ({ key, quantity: 1 }));

test('Quelling Blade affects creep hit damage by attack type and leaves hero damage unchanged', () => {
  for (const [id, damage] of [[8, 8], [26, 4]]) {
    const scorer = createStartingScorer(hero(id), items, 'carry');
    const base = scorer.score([]);
    const quell = scorer.score(bundle('quelling_blade'));
    assert.equal(quell.metrics.lastHitDamage - base.metrics.lastHitDamage, damage);
    assert.equal(quell.metrics.attackDps, base.metrics.attackDps);
    assert.ok(quell.scores['last-hits'] > quell.scores.trading);
  }
});

test('baskets with the same equipped stats retain separate consumable recovery and detection', () => {
  const scorer = createStartingScorer(hero(26), items, 'hard-support');
  const stats = bundle('branches');
  const bare = scorer.score(stats);
  const sustain = scorer.score([...stats, ...bundle('magic_stick', 'tango', 'ward_sentry')]);
  assert.equal(sustain.metrics.attackDps, bare.metrics.attackDps);
  assert.ok(Math.abs(sustain.metrics.laneHealing - bare.metrics.laneHealing - 263.4) < 1e-8);
  assert.ok(Math.abs(sustain.metrics.laneMana - bare.metrics.laneMana - 45) < 1e-8);
  assert.equal(sustain.metrics.vision, 1);
  assert.match(sustain.notes.join(' '), /three charges/);
});

test('position criteria favor different opening baskets with the same hero', () => {
  const itemsForCreeps = bundle('tango', 'quelling_blade', 'slippers', 'circlet', 'branches');
  const itemsForSupport = bundle('magic_stick', 'tango', 'enchanted_mango', 'ward_sentry', 'blood_grenade', 'branches');
  const carry = createStartingScorer(hero(8), items, 'carry');
  const support = createStartingScorer(hero(8), items, 'hard-support');
  assert.ok(carry.score(itemsForCreeps).scores.balanced > carry.score(itemsForSupport).scores.balanced);
  assert.ok(support.score(itemsForSupport).scores.balanced > support.score(itemsForCreeps).scores.balanced);
});
