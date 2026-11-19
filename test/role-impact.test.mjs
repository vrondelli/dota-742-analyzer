import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImpactRubric, scoreRoleImpact } from '../lib/role-impact.mjs';

const role = {
  key: 'offlane', headline: 'Start fights and protect allies',
  criteria: [{ key: 'initiation', label: 'Initiation', weight: 60 }, { key: 'protection', label: 'Protection', weight: 40 }],
};
const profile = {
  heroId: 29,
  ratings: { initiation: { value: 3, reason: 'Ravage' }, protection: { value: 0, reason: 'Scope fixture' } },
  milestones: { bad: 'blink', good: 'blink', easy: 'blink' },
};

test('role priority rescales weights and scores only the rubric inputs', () => {
  const standard = prepareImpactRubric(role);
  const prioritised = prepareImpactRubric(role, 'protection');
  assert.equal(standard.criteria.reduce((total, { weight }) => total + weight, 0), 100);
  assert.ok(Math.abs(prioritised.criteria.reduce((total, { weight }) => total + weight, 0) - 100) < 1e-9);
  assert.equal(scoreRoleImpact(standard, profile, { builds: [] }).score, 60);
  assert.ok(Math.abs(scoreRoleImpact(prioritised, profile, { builds: [] }).score - 100 * 60 / 140) < 1e-9);
  assert.throws(() => prepareImpactRubric(role, 'damage'), RangeError);
});

test('role milestones use the actual purchase order and disclose replacements', () => {
  const plan = { builds: [
    { key: 'bad', budget: 5443, steps: [{ key: 'blink', name: 'Blink Dagger', cumulativeCost: 6935, affordable: false }] },
    { key: 'good', budget: 6338, steps: [], change: { replaces: { key: 'blink', name: 'Blink Dagger' }, item: { name: 'Pipe of Insight' } } },
    { key: 'easy', budget: null, steps: [{ key: 'blink', name: 'Blink Dagger', cumulativeCost: 3210, affordable: null }] },
  ] };
  const result = scoreRoleImpact(prepareImpactRubric(role), profile, plan);
  assert.equal(result.milestones.bad.shortfall, 1492);
  assert.equal(result.milestones.good.replaced, 'Pipe of Insight');
  assert.equal(result.milestones.good.cumulativeCost, undefined);
  assert.equal(result.milestones.easy.affordable, null);
  assert.equal(result.score, 60);
});
