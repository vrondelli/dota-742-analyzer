import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBuilds, armorDamageMultiplier } from '../lib/build-efficiency.mjs';

const hero = {
  id: 1,
  key: 'example',
  name: 'Example',
  primaryAttribute: 'agility',
  baseAttackTime: 1.5,
  baseArmor: 0,
  baseMagicResistance: 25,
  baseHealth: 200,
  baseHealthRegen: 0.25,
  baseMana: 75,
  baseManaRegen: 0,
  baseMoveSpeed: 300,
  levels: [{ level: 7, meanAttackDamage: 60, strength: 30, agility: 35, intelligence: 25, attackSpeed: 135 }],
};

function item(key, cost, stats, extra = {}) {
  return { key, name: key, cost, stats, coverage: 'flat', ...extra };
}

function approx(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `Expected ${actual} ≈ ${expected}`);
}

test('signed armor adjustment and attribute-derived build stats', () => {
  approx(armorDamageMultiplier(10), 0.625);
  approx(armorDamageMultiplier(-10), 1.375);
  const rolls = item('attribute_item', 500, { strength: 4, agility: 6, intelligence: 8, armor: 2 });
  const [entry] = analyzeBuilds(hero, [rolls], { targetArmor: 0 }).rows;
  approx(entry.metrics.damagePerHit, 66);
  approx(entry.metrics.attackSpeed, 141);
  approx(entry.metrics.armor, 35 / 6 + 3);
  approx(entry.metrics.health, 880);
  approx(entry.metrics.physicalEhp, 880 / armorDamageMultiplier(35 / 6 + 3));
  approx(entry.gain, 66 * 141 / 150 - 54);
  approx(entry.gainPer1000, entry.gain * 2);

  const universal = analyzeBuilds({ ...hero, primaryAttribute: 'universal' }, [rolls]).rows[0];
  approx(universal.metrics.damagePerHit, 60 + (4 + 6 + 8) * 0.45);
});

test('distinct pairs include cross-stat synergy and mark the budget frontier', () => {
  const items = [
    item('gloves', 450, { attackSpeed: 20 }),
    item('blades', 450, { attackDamage: 9 }),
    item('weak', 900, { attackDamage: 1 }),
    item('costly', 901, { attackDamage: 100 }),
  ];
  const result = analyzeBuilds(hero, items, { targetArmor: 0, budget: 900 });
  const { rows } = result;
  assert.equal(rows.length, 4);
  const best = rows[0];
  assert.deepEqual(best.items.map(({ key }) => key), ['gloves', 'blades']);
  assert.equal(best.frontier, true);
  approx(best.metrics.physicalDps, 69 * 155 / 150);
  approx(best.synergy, 9 * 20 / 150);
  assert.ok(rows.every((row) => row.cost <= 900));
  assert.equal(rows.find((row) => row.items[0].key === 'weak').frontier, false);
});

test('magic applies resistance, a ready cast and spell amplification only to supported procs', () => {
  const items = [
    item('dagon', 900, {}, { effects: [{ kind: 'magic-active', key: 'dagon', damage: 400, stackGroup: 'dagon' }] }),
    item('dagon_2', 1100, {}, { effects: [{ kind: 'magic-active', key: 'dagon', damage: 500, stackGroup: 'dagon' }] }),
    item('kaya', 700, { spellAmp: 6 }),
    item('kaya_and_sange', 800, { spellAmp: 10 }),
    item('maelstrom', 600, {}, {
      effects: [{ kind: 'magic-on-hit', key: 'chain-lightning', chance: 25, damage: 100, stackGroup: 'chain-lightning' }],
    }),
  ];
  const active = analyzeBuilds(hero, items, {
    metric: 'magicalDamage', itemKeys: ['dagon', 'kaya'], targetMagicResistance: 25,
  }).rows[0];
  approx(active.gain, 600 * 1.06 * 0.75 - 200 * 0.75);
  assert.throws(() => analyzeBuilds(hero, items, { itemKeys: ['dagon', 'dagon_2'] }), /upgrade family/);
  const noActive = analyzeBuilds(hero, items, {
    metric: 'magicalDamage', includeActives: false, itemKeys: ['dagon'],
  }).rows[0];
  assert.equal(noActive.gain, 0);
  const [chain] = analyzeBuilds(hero, items, {
    metric: 'magicalDamage', itemKeys: ['maelstrom', 'kaya'], targetMagicResistance: 25,
  }).rows;
  approx(chain.metrics.onHitMagicDamage, 0.9 * 10 * 0.25 * 100 * 1.06 * 0.75);
  const [amp] = analyzeBuilds(hero, items, { metric: 'spellAmp', itemKeys: ['kaya', 'kaya_and_sange'] }).rows;
  assert.equal(amp.gain, 10);
});

test('auras respect strongest group and blocked overlap per stat', () => {
  const buckler = item('buckler', 425, { armor: 2 }, { auras: [{
    recipient: 'allies', stats: { armor: 1 },
    stackGroups: { armor: 'buckler-armor' },
    blockedBy: { armor: ['vladmir-armor'] },
  }] });
  const vladmir = item('vladmir', 2200, { armor: 2 }, { auras: [{
    recipient: 'allies', stats: { armor: 1, attackDamagePct: 18 }, stackGroups: { armor: 'vladmir-armor' },
  }] });
  const crimson = item('crimson', 2500, { armor: 5 }, { auras: [{
    recipient: 'allies', stats: { armor: 2 }, stackGroups: { armor: 'buckler-armor' },
  }] });
  const items = [buckler, vladmir, crimson];
  const build = analyzeBuilds(hero, items, { metric: 'auraArmor', itemKeys: ['buckler', 'vladmir'] }).rows[0];
  assert.equal(build.gain, 1);
  assert.equal(build.synergy, -1);
  approx(build.metrics.armor, 35 / 6 + 2 + 2 + 1);
  assert.equal(build.metrics.auraAttackDamagePct, 18);
  const [guard] = analyzeBuilds(hero, items, { metric: 'auraArmor', itemKeys: ['buckler', 'crimson'] }).rows;
  assert.equal(guard.gain, 2);
});

test('unmodelled items stay visible without claiming zero gain', () => {
  const items = [item('mystery', 300, {}, { coverage: 'unmodelled', notes: ['Unknown effect.'] })];
  const [entry] = analyzeBuilds(hero, items).rows;
  assert.equal(entry.coverage, 'unmodelled');
  assert.equal(entry.gain, null);
  assert.equal(entry.gainPer1000, null);
  assert.deepEqual(entry.notes, ['Unknown effect.']);
});

test('one ready cast adds only damage-over-time ticks that fit the window', () => {
  const effects = [{
    kind: 'magic-active', key: 'sling-grenade', damage: 50,
    damagePerTick: 15, tickInterval: 1, tickDuration: 5,
  }];
  const items = [item('bloodslinger', 925, {}, { effects })];
  const options = { metric: 'magicalDamage', targetMagicResistance: 20, baseSpellDamage: 0 };
  for (const [windowSeconds, expected] of [[0.5, 40], [2.8, 64], [10, 100]]) {
    const [result] = analyzeBuilds(hero, items, { ...options, windowSeconds }).rows;
    approx(result.metrics.activeMagicDamage, expected);
  }
});
