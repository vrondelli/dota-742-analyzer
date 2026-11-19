import test from 'node:test';
import assert from 'node:assert/strict';
import { getHeroMatchups } from '../lib/hero-matchups.mjs';

const heroes = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, name: `Hero ${index + 1}` }));

function samples(prefix, opponent, games, wins, { ally = 6, rankTier = 5 } = {}) {
  return Array.from({ length: games }, (_, index) => {
    const heroWon = index < wins;
    const friendly = [1, ally, 7, 8, 9].map((heroId) => ({ heroId, won: heroWon }));
    const opponents = [opponent, 10, 11, 12, 13].map((heroId) => ({ heroId, won: !heroWon }));
    const teams = index % 2 ? [friendly, opponents] : [opponents, friendly];
    return { id: `${prefix}-${index}`, rankTier, players: teams.flat() };
  });
}

test('hero profile matchups require opposite-side pairs and comparison games', () => {
  const favorable = samples('favorable', 2, 20, 16);
  const difficult = samples('difficult', 3, 20, 4);
  const small = samples('small', 4, 19, 19);
  const allies = samples('allies', 5, 2, 0, { ally: 2 });
  const otherRank = samples('otherRank', 4, 8, 8, { rankTier: 6 });
  const invalid = { ...favorable[0], id: 'bad' };
  invalid.players = invalid.players.map((player) => ({ ...player, won: true }));
  const snapshot = { matches: [...favorable, ...difficult, ...small, ...allies, ...otherRank, invalid, favorable[0]] };
  const result = getHeroMatchups(heroes, snapshot, 1);
  assert.deepEqual(result.coverage, {
    legendMatches: 62, teamMatches: 61, heroGames: 61, heroWinRate: 39 / 61, eligibleOpponents: 2,
  });
  assert.deepEqual(result.favorable.map(({ enemyId }) => enemyId), [2]);
  assert.deepEqual(result.difficult.map(({ enemyId }) => enemyId), [3]);
  const [pair] = result.favorable;
  assert.equal(pair.games, 20);
  assert.equal(pair.winRate, 16 / 20);
  assert.equal(pair.comparisonGames, 41);
  assert.equal(pair.comparisonRate, (23 + 20) / (41 + 40));
  assert.ok(pair.adjustedWinRate > pair.comparisonRate && pair.adjustedWinRate < pair.winRate);
  assert.equal(pair.delta, pair.adjustedWinRate - pair.comparisonRate);
  assert.deepEqual(getHeroMatchups(heroes, snapshot, 1), result);
});

test('an unobserved hero returns empty lists and a missing win rate', () => {
  const snapshot = { matches: samples('observed', 2, 25, 25) };
  const result = getHeroMatchups(heroes, snapshot, 3);
  assert.equal(result.coverage.heroGames, 0);
  assert.equal(result.coverage.heroWinRate, null);
  assert.deepEqual(result.favorable, []);
  assert.deepEqual(result.difficult, []);
});
