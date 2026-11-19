import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { estimateAttackDps } from '../lib/build-efficiency.mjs';
import { createBuildRoleScorer } from '../lib/build-role-scoring.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/7.42/${name}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const lina = read('hero-dps').heroes.find(({ id }) => id === 25);
const linaSpells = read('hero-magic').heroes.find(({ id }) => id === 25).spells;
const shopItems = new Map(read('item-mechanics').items.map((item) => [item.key, item]));
const inventory = (...keys) => keys.map((key) => shopItems.get(key));

test('carry scores use the same physical attacks and procs as Build timings', () => {
  const items = inventory('greater_crit', 'maelstrom');
  const objective = createBuildRoleScorer(lina, 'carry');
  const result = objective.score(items, 12);
  const expected = estimateAttackDps(lina, items, { level: 12 });
  assert.equal(result.score, expected.dps);
  assert.equal(result.metrics.procDps, expected.procDps);
  assert.ok(result.metrics.dpsGain > 0);
  assert.equal(objective.utilityItemKeys.length, 0);
});

test('mid scores use the learned spell, spell amplification and active burst', () => {
  const objective = createBuildRoleScorer(lina, 'mid', { spells: linaSpells });
  const baseline = objective.score([], 12);
  assert.equal(baseline.score, 0);
  assert.equal(baseline.metrics.burst, 525 * 0.75);
  const attack = objective.score(inventory('maelstrom'), 12);
  assert.equal(attack.metrics.burst, baseline.metrics.burst);
  const spell = objective.score(inventory('dagon', 'kaya'), 12);
  assert.ok(spell.metrics.burst > baseline.metrics.burst);
  assert.ok(spell.score > attack.score);
  assert.equal(createBuildRoleScorer(lina, 'mid').score([], 12).metrics.burst, 0);
});

test('utility caps overlapping saves and role weights can distinguish the same tools', () => {
  const support = createBuildRoleScorer(lina, 'hard-support');
  const offlane = createBuildRoleScorer(lina, 'offlane');
  const blink = inventory('blink');
  assert.ok(offlane.score(blink, 12).score > support.score(blink, 12).score);
  assert.ok(offlane.utilityItemKeys.includes('blink'));
  assert.equal(support.score(inventory('pavise', 'glimmer_cape'), 12).metrics.utility,
    support.score(inventory('glimmer_cape'), 12).metrics.utility);
  assert.ok(support.score(inventory('arcane_boots', 'force_staff'), 12).score
    > support.score(inventory('greater_crit', 'maelstrom'), 12).score);
});

test('offlane credits effective health and shared aura stats', () => {
  const objective = createBuildRoleScorer(lina, 'offlane');
  const base = objective.score([], 12);
  const pipe = objective.score(inventory('pipe'), 12);
  assert.equal(base.score, 0);
  assert.ok(pipe.score > 0);
  assert.ok(pipe.metrics.magicEhp > base.metrics.magicEhp);
  assert.ok(pipe.metrics.auras > 0);
  assert.equal(objective.criteria.reduce((sum, { weight }) => sum + weight, 0), 100);
});
