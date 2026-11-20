import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInventoryEstimator } from '../lib/build-efficiency.mjs';
import { compareWraithKingBuilds } from '../lib/wraith-king-builds.mjs';

const load = (file) => JSON.parse(readFileSync(new URL(`../data/7.42/${file}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const hero = load('hero-dps').heroes.find(({ id }) => id === 42);
const { items } = load('item-mechanics');
const item = (name) => items.find(({ key }) => key === name);
const atTwenty = [{ minute: 20, budget: 10000, level: 12 }];
const benchmark = (baseline, options) => compareWraithKingBuilds({ hero, items, baseline, options,
  checkpoints: atTwenty, alternatives: [] }).paths[0].points[0];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test('Mortal Strike wins overlapping Daedalus hits without double-counting crits', () => {
  const critical = item('greater_crit');
  const estimate = createInventoryEstimator(hero, { targetArmor: 10, targetMagicResistance: 25 });
  const regular = estimate([{ ...critical, effects: [] }], 12);
  const result = benchmark(['greater_crit']);
  const frequency = Math.ceil(5 * regular.attacksPerSecond);
  const baseCrit = 1 + .3 * (2.25 - 1);
  assert.equal(result.mortalStrikeRank, 4);
  close(result.mortalStrikeDps, regular.physicalDps * (2.8 - baseCrit) / frequency);
  close(result.dps, regular.physicalDps * baseCrit + result.mortalStrikeDps);
});

test('Radiance, Armlet active, and Strength Treads adjust the hero-specific benchmark only', () => {
  const radiance = benchmark(['radiance']);
  assert.equal(radiance.radianceBurnDps, 45);
  close(radiance.dps - radiance.genericDps, radiance.radianceBurnDps + radiance.mortalStrikeDps);

  const active = benchmark(['armlet']);
  const inactive = benchmark(['armlet'], { armletActive: false });
  assert.equal(active.armletDrainPerSecond, 45);
  assert.equal(inactive.armletDrainPerSecond, 0);
  assert.equal(active.genericDps, inactive.genericDps);
  assert.equal(active.armletOffDps, inactive.dps);
  const armorMultiplier = .625;
  const estimate = createInventoryEstimator(hero, { targetArmor: 10, targetMagicResistance: 25 });
  const { attacksPerSecond } = estimate([item('armlet')], 12);
  const attacksPerStrike = Math.ceil(5 * attacksPerSecond);
  close(active.dps - inactive.dps, 60 * attacksPerSecond * armorMultiplier * (1 + 1.8 / attacksPerStrike));

  const treads = benchmark(['power_treads']);
  const treadAttackRate = estimate([item('power_treads')], 12).attacksPerSecond;
  close(treads.dps - treads.genericDps - treads.mortalStrikeDps, 10 * treadAttackRate * armorMultiplier);
});
