import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGpmProjections } from '../lib/gpm-projections.mjs';

function hero(id, attackDamage = 100) {
  return {
    id, key: `hero_${id}`, name: `Hero ${id}`, primaryAttribute: 'agility', baseAttackTime: 1,
    levels: [{ level: 12, meanAttackDamage: attackDamage, attackSpeed: 100, agility: 30, strength: 20, intelligence: 20 }],
  };
}

function timeline(gold, start = 0) {
  return Array.from({ length: 11 }, (_, minute) => start + minute * gold / 10);
}

function player(heroId, role, economy = {}, won = false) {
  return { heroId, role, won, ...economy };
}

function match(players, extras = {}) {
  return { rankTier: 5, patchConfidence: 'inferred', duration: 1800, players, ...extras };
}

const options = { targetMinute: 10, level: 12, targetArmor: 0, reserveGold: 500 };
const items = [
  { id: 10, key: 'cheap', name: 'Cheap', cost: 100, stats: { attackDamage: 20 }, coverage: 'flat' },
  { id: 11, key: 'major', name: 'Major', cost: 1500, stats: { attackDamage: 80 }, coverage: 'partial' },
];

test('timeline percentiles use gold actually earned by target minute, with one reserve', () => {
  const snapshot = { matches: [
    match([player(1, 'carry', { goldTimeline: timeline(1000, 600), gpm: 400 })]),
    match([player(1, 'carry', { goldTimeline: timeline(3000), gpm: 600 }, true)]),
    match([player(2, 'carry', { gpm: 2000 })]),
    match([player(2, 'carry', { goldTimeline: timeline(9000), gpm: 3000 })], { duration: 599 }),
    match([player(2, 'carry', { goldTimeline: timeline(9000), gpm: 3000 })], { rankTier: 4 }),
  ] };
  const result = analyzeGpmProjections([hero(1), hero(2)], items, snapshot, options);
  const carry = result.roles.find(({ key }) => key === 'carry');
  assert.equal(carry.basis, 'gold-timeline');
  assert.equal(carry.rolePicks, 4);
  assert.equal(carry.timelinePicks, 2);
  assert.equal(carry.gpmPicks, 3);
  assert.deepEqual(carry.scenarios.map(({ gpm, earnedGold, budget, sampleSize }) =>
    [gpm, earnedGold, budget, sampleSize]), [[150, 1500, 1000, 2], [200, 2000, 1500, 2], [270, 2700, 2200, 2]]);
  assert.equal(result.coverage.legendMatches, 4);
  assert.equal(result.coverage.eligibleHeroes, 2);
});

test('budget optimizer chooses absolute DPS over cheap efficiency and accounts for unspent gold', () => {
  const snapshot = { matches: [match([
    player(1, 'carry', { goldTimeline: timeline(1000) }),
    player(1, 'carry', { goldTimeline: timeline(3000) }),
  ])] };
  const result = analyzeGpmProjections([hero(1)], items, snapshot, { ...options, role: 'carry' });
  const [row] = result.rows;
  assert.equal(row.averageDps, (120 + 180 + 200) / 3);
  assert.deepEqual(row.scenarios.map(({ items: build, dps, spent, unspent }) => [
    build.map(({ key }) => key), dps, spent, unspent,
  ]), [[['cheap'], 120, 100, 900], [['major'], 180, 1500, 0], [['cheap', 'major'], 200, 1600, 600]]);
  const [reserved] = analyzeGpmProjections([hero(1)], items, snapshot, {
    ...options, reserveGold: 3_000,
  }).rows;
  assert.ok(reserved.scenarios.every(({ budget, dps, spent }) => !budget && dps === 100 && !spent));
});

test('full-match GPM fallback stays role-local and all roles return one row per hero', () => {
  const snapshot = { matches: [
    match([player(1, 'carry', { gpm: 80 }), player(2, 'carry', { gpm: 100 })]),
    match([player(1, 'mid', { gpm: 250 }, true)]),
    match([player(3, 'unknown', { gpm: 2000 }, true)]),
    match([player(4, 'offlane', {}, true)]),
  ] };
  const result = analyzeGpmProjections([hero(1), hero(2), hero(3), hero(4)], items, snapshot, options);
  assert.equal(result.coverage.eligibleHeroes, 3);
  assert.equal(result.coverage.scoredHeroes, 2);
  assert.deepEqual(result.rows.map(({ hero: entry, role, replayPicks, replayWins }) =>
    [entry.id, role, replayPicks, replayWins]), [[1, 'mid', 1, 1], [2, 'carry', 1, 0]]);
  const mid = result.roles.find(({ key }) => key === 'mid');
  assert.equal(mid.basis, 'full-match-gpm');
  assert.ok(mid.scenarios.every(({ gpm, earnedGold, budget, sampleSize }) =>
    gpm === 250 && earnedGold === 2500 && budget === 2000 && sampleSize === 1));
  const offlane = result.roles.find(({ key }) => key === 'offlane');
  assert.equal(offlane.basis, 'unavailable');
  assert.deepEqual(offlane.scenarios, []);
  const carry = analyzeGpmProjections([hero(1), hero(2)], items, snapshot, { ...options, role: 'carry' });
  assert.ok(carry.rows.every(({ role }) => role === 'carry'));
});

test('ranking defaults to twenty unique heroes and keeps missing observations out', () => {
  const heroes = Array.from({ length: 22 }, (_, index) => hero(index + 1, 100 + index));
  const snapshot = { matches: heroes.slice(0, 21).map(({ id }) => match([player(id, 'carry', { gpm: 300 })])) };
  const result = analyzeGpmProjections(heroes, items, snapshot, options);
  assert.equal(result.rows.length, 20);
  assert.equal(result.coverage.scoredHeroes, 21);
  assert.equal(result.rows[0].hero.id, 21);
  assert.equal(result.rows.at(-1).rank, 20);
  assert.equal(new Set(result.rows.map(({ hero: entry }) => entry.id)).size, 20);
});
