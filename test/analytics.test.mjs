import assert from 'node:assert/strict';
import test from 'node:test';
import { getHeroRankings, getItemRankings } from '../lib/analytics.mjs';

const items = new Map([
  ['blink', { id: 1, name: 'Blink Dagger' }],
  ['branches', { id: 16, name: 'Iron Branch' }],
]);

function player(heroId, won, {
  role = 'mid', roleConfidence = 'inferred', purchases = null,
} = {}) {
  return { heroId, won, role, roleConfidence, purchases };
}

function match(players, { rankTier = 4, patchConfidence = 'inferred', duration = 1200 } = {}) {
  return { players, rankTier, patchConfidence, duration };
}

test('hero pick share uses the applicable role and confidence cohort', () => {
  const snapshot = { matches: [
    match([
      player(1, true, { roleConfidence: 'observed' }),
      player(2, false),
      player(3, true, { role: 'carry' }),
      player(4, false, { role: 'unknown', roleConfidence: 'unknown' }),
    ], { patchConfidence: 'verified' }),
    match([player(1, false), player(2, true, { role: 'carry' })], { rankTier: 5 }),
  ] };

  const mid = getHeroRankings(snapshot, { role: 'mid', rankTier: '4', minGames: 1 });
  assert.equal(mid.matches, 1);
  assert.equal(mid.eligiblePicks, 2);
  assert.equal(mid.roleKnownPicks, 3);
  assert.equal(mid.totalPicks, 4);
  assert.equal(mid.rows[0].heroId, 1);
  assert.equal(mid.rows[0].pickRate, 0.5);
  assert.equal(mid.rows[1].pickRate, 0.5);
  assert.ok(mid.rows[0].confidenceLow > 0 && mid.rows[0].confidenceLow < 1);

  const observed = getHeroRankings(snapshot, {
    role: 'mid', patchConfidence: 'verified', roleConfidence: 'observed',
  });
  assert.equal(observed.eligiblePicks, 1);
  assert.equal(observed.rows[0].pickRate, 1);
  assert.equal(observed.rows[0].rank, null);
});

test('hero rankings use the 95% Wilson lower bound for supported heroes', () => {
  const repetitions = (heroId, wins, losses) => [
    ...Array.from({ length: wins }, () => match([player(heroId, true)])),
    ...Array.from({ length: losses }, () => match([player(heroId, false)])),
  ];
  const snapshot = { matches: [
    ...repetitions(1, 2, 0),
    ...repetitions(2, 12, 2),
    ...repetitions(3, 1, 0),
  ] };
  const result = getHeroRankings(snapshot, { minGames: 2 });
  assert.deepEqual(result.rows.map(({ heroId, rank }) => [heroId, rank]), [[2, 1], [1, 2], [3, null]]);
});

test('item peer groups exclude prior owners, unavailable logs, short games, and other roles', () => {
  const blink = (time) => ({ key: 'blink', time });
  const snapshot = { matches: [
    match([player(1, true, { purchases: [blink(420), blink(300)] })]),
    match([player(1, false, { purchases: [blink(450)] })]),
    match([player(1, false, { purchases: [blink(900)] })]),
    match([player(1, false, { purchases: [] })], { duration: 900 }),
    match([player(1, true, { purchases: [blink(480), blink(299)] })]),
    match([player(1, true)]),
    match([player(1, true, { purchases: [blink(600)] })], { duration: 899 }),
    match([player(1, true, { purchases: [blink(500)], role: 'carry' })]),
  ] };
  const result = getItemRankings(snapshot, items, 1, { role: 'mid', window: 'early', minGroup: 2 });
  assert.equal(result.heroGames, 7);
  assert.equal(result.windowGames, 6);
  assert.equal(result.parsedGames, 5);
  assert.deepEqual(result.rows, [{
    key: 'blink', itemId: 1, name: 'Blink Dagger',
    buyers: 2, buyerWins: 1, nonBuyers: 2, nonBuyerWins: 0,
    buyerWinRate: 0.5, nonBuyerWinRate: 0, winRateDifference: 0.5,
    medianPurchaseTime: 375, rank: 1,
  }]);
});

test('opening accepts pre-horn purchases and excludes unknown or future items', () => {
  const snapshot = { matches: [
    match([player(1, true, { purchases: [
      { key: 'branches', time: -59 },
      { key: 'recipe_magic_wand', time: -50 },
      { key: 'blink', time: 300 },
    ] })]),
    match([player(1, false, { purchases: [
      { key: 'branches', time: -100 },
      { key: 'branches', time: 0 },
    ] })]),
  ] };
  const result = getItemRankings(snapshot, items, 1, { window: 'opening', minGroup: 1 });
  assert.equal(result.parsedGames, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].key, 'branches');
  assert.equal(result.rows[0].medianPurchaseTime, -59);
  assert.equal(result.rows[0].nonBuyers, 0);
  assert.equal(result.rows[0].winRateDifference, null);
  assert.equal(result.rows[0].rank, null);
});
