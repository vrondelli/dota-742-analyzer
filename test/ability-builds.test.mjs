import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBuilds, getModeledAbility } from '../lib/build-efficiency.mjs';
import { analyzeRoleBuilds } from '../lib/role-builds.mjs';

const juggernaut = {
  id: 8, key: 'npc_dota_hero_juggernaut', name: 'Juggernaut', baseAttackTime: 1.4,
  primaryAttribute: 'agility',
  levels: [5, 6, 12, 18, 30].map((level) => ({
    level, attackSpeed: 160, meanAttackDamage: 100, strength: 30, agility: 35, intelligence: 25,
  })),
};

function item(key, cost, stats, extra = {}) {
  return { key, name: key, cost, stats, coverage: 'flat', ...extra };
}

function approx(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `Expected ${actual} ≈ ${expected}`);
}

const scenario = { level: 6, metric: 'abilityDamage', targetArmor: 0 };

test('Omnislash counts a strike at zero and respects strict expiry breakpoints', () => {
  const speed = item('speed', 100, { attackSpeed: 1 });
  const deck = analyzeBuilds(juggernaut, [speed], { ...scenario, itemKeys: ['speed'] });
  const bare = deck.baseline.ability;
  assert.equal(bare.hits, 6);
  assert.equal(bare.attackSpeed, 200);
  assert.equal(bare.preCastAttackSpeed, 160);
  approx(bare.nextAttackSpeedThreshold, 160);
  approx(bare.damage, 750);
  const [entry] = deck.rows;
  assert.equal(entry.metrics.ability.hits, 7);
  assert.equal(entry.metrics.ability.hitsWith33msDelay, 6);
  assert.ok(entry.metrics.ability.lastHitMarginSeconds > 0 && entry.metrics.ability.lastHitMarginSeconds < 0.02);
  approx(entry.gain, 125);
  approx(entry.gainPer1000, 1250);
});

test('Omnislash uses learned rank values and reports no higher breakpoint at the speed cap', () => {
  assert.equal(getModeledAbility(8, 5), null);
  assert.equal(getModeledAbility(11, 18), null);
  assert.deepEqual([6, 12, 18].map((level) => {
    const ability = getModeledAbility(8, level);
    return [ability.rank, ability.durationSeconds, ability.bonusDamage];
  }), [[1, 3, 25], [2, 3.25, 30], [3, 3.5, 35]]);
  const speed = item('speed', 100, { attackSpeed: 900 });
  const [entry] = analyzeBuilds(juggernaut, [speed], { ...scenario, level: 18 }).rows;
  assert.equal(entry.metrics.ability.attackSpeed, 700);
  assert.equal(entry.metrics.ability.hits, 25);
  assert.equal(entry.metrics.ability.nextAttackSpeedThreshold, null);
});

test('Omnislash applies physical armor and modeled item critical strikes', () => {
  const critical = item('crit', 100, {}, {
    coverage: 'partial',
    effects: [{ key: 'crit', kind: 'critical', chance: 25, multiplier: 200 }],
  });
  const opts = { ...scenario, targetArmor: 10 };
  const [entry] = analyzeBuilds(juggernaut, [critical], opts).rows;
  assert.equal(entry.coverage, 'partial');
  approx(entry.metrics.ability.damagePerHit, 125 * 0.625 * 1.25);
  approx(entry.gain, 750 * 0.625 * 0.25);
  const [off] = analyzeBuilds(juggernaut, [critical], { ...opts, includeOnHit: false }).rows;
  assert.equal(off.gain, 0);
});

test('role boards rank multiple nondominated Juggernaut options and keep unsupported heroes unranked', () => {
  const others = [{ ...juggernaut, id: 1 }, { ...juggernaut, id: 2 }];
  const matches = [{
    rankTier: 5, patchConfidence: 'inferred',
    players: [{ heroId: 8, role: 'carry', won: false }, { heroId: 1, role: 'carry', won: true }],
  }, {
    rankTier: 6, players: [{ heroId: 8, role: 'offlane', won: true }],
  }];
  const items = [
    item('speed', 100, { attackSpeed: 1 }),
    item('damage', 150, { attackDamage: 30 }),
    item('padding', 125, { health: 100 }),
  ];
  const opts = { ...scenario, maxItems: 1, budgets: [200, 500] };
  const result = analyzeRoleBuilds([juggernaut, ...others], items, { matches }, opts);
  assert.equal(result.coverage.heroCount, 3);
  assert.equal(result.coverage.abilityHeroCount, 1);
  const carry = result.roles.find(({ key }) => key === 'carry');
  assert.equal(carry.replayPicks, 2);
  assert.equal(carry.eligibleRoleHeroes, 1);
  assert.equal(carry.bands[0].eligibleHeroes, 1);
  assert.deepEqual(carry.bands[0].rows.map((row) => [
    row.items[0].key, row.replayPicks, row.replayWins, row.ability.build.hits,
  ]), [['speed', 1, 0, 7], ['damage', 1, 0, 6]]);
  assert.equal(result.roles.find(({ key }) => key === 'offlane').bands[0].rows.length, 0);
  assert.equal(result.roster.bands[0].rows.length, 2);
  const unlearned = analyzeRoleBuilds([juggernaut, ...others], items, { matches }, { ...opts, level: 5 });
  assert.equal(unlearned.coverage.abilityHeroCount, 0);
  assert.equal(unlearned.roster.bands[0].rows.length, 0);
});
