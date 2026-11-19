import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftGuide } from '../lib/draft-guide.mjs';

const heroes = Array.from({ length: 25 }, (_, index) => ({
  id: index + 1,
  name: `Hero ${index + 1}`,
  key: `hero_${index + 1}`,
}));

function match(id, radiant, dire, radiantWon, roles = {}, rankTier = 5) {
  return {
    id, rankTier,
    players: [radiant, dire].flatMap((side, sideIndex) => side.map((heroId) => ({
      heroId, won: sideIndex === 0 ? radiantWon : !radiantWon, role: roles[heroId] ?? 'unknown',
    }))),
  };
}

test('only opposite-side Legend results enter each enemy matchup', () => {
  const paired = match('paired', [1, 4, 5, 6, 7], [3, 8, 9, 10, 11], true, { 1: 'carry' });
  const allied = match('allied', [1, 3, 5, 6, 7], [4, 8, 9, 10, 11], false, { 1: 'carry' });
  const normal = match('normal', [4, 8, 9, 10, 11], [1, 2, 5, 6, 7], true);
  const otherBracket = match('other', [1, 4, 5, 6, 7], [3, 8, 9, 10, 11], true, { 1: 'carry' }, 4);
  const badSideOrder = match('bad', [1, 4, 5, 6, 7], [3, 8, 9, 10, 11], false, { 1: 'carry' });
  [badSideOrder.players[1], badSideOrder.players[6]] = [badSideOrder.players[6], badSideOrder.players[1]];
  const result = buildDraftGuide(heroes, { matches: [paired, allied, normal, paired, otherBracket, badSideOrder] }, {
    enemyIds: [3, 2, 3],
  });
  assert.deepEqual(result.options.enemyIds, [3, 2]);
  assert.equal(result.coverage.legendMatches, 4);
  assert.equal(result.coverage.teamMatches, 3);
  assert.equal(result.coverage.roleMatches, 2);
  assert.equal(result.stage.key, 'early-response');
  const [row] = result.rows;
  assert.equal(row.hero.id, 1);
  assert.equal(row.allRole.games, 3);
  assert.equal(row.rolePicks, 2);
  const [observed, empty] = row.matchups;
  assert.equal(observed.games, 1);
  assert.equal(observed.roleGames, 1);
  assert.equal(observed.wins, 1);
  assert.equal(observed.comparisonGames, 2);
  assert.equal(observed.winRate, 1);
  assert.ok(observed.delta > 0 && observed.delta < 0.03);
  assert.equal(empty.games, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.delta, null);
  assert.equal(row.matchupDelta, observed.delta / 2);
});

test('candidate filters and unavailable picks preserve role support order', () => {
  const snapshot = { matches: [
    match('role', [1, 4, 5, 6, 7], [2, 8, 9, 10, 11], false, { 1: 'carry', 5: 'carry' }),
    match('flex-one', [1, 4, 5, 6, 7], [2, 8, 9, 10, 11], false, { 1: 'mid' }),
    match('flex-two', [1, 4, 5, 6, 7], [2, 8, 9, 10, 11], false, { 1: 'mid' }),
  ] };
  const blind = buildDraftGuide(heroes, snapshot, {
    candidateIds: [1, 2, 5, 12], allyIds: [5], blockedIds: [12], minRolePicks: 0,
  });
  assert.equal(blind.stage.key, 'blind');
  assert.equal(blind.coverage.observedEligibleHeroes, 1);
  assert.equal(blind.coverage.provisionalHeroes, 1);
  assert.deepEqual(blind.rows.map(({ hero }) => hero.id), [1, 2]);
  assert.equal(blind.rows[0].flexBonus, 0.005);
  assert.equal(blind.rows[1].rolePicks, 0);

  const late = buildDraftGuide(heroes, snapshot, {
    candidateIds: [1, 2, 5, 8], enemyIds: [8, 9, 10], allyIds: [5], minRolePicks: 1,
  });
  assert.equal(late.stage.key, 'counterpick');
  assert.deepEqual(late.rows.map(({ hero }) => hero.id), [1]);
  assert.equal(late.rows[0].flexBonus, 0);
  assert.deepEqual(late.rows[0].matchups.map(({ enemyId, games }) => [enemyId, games]), [[8, 3], [9, 3], [10, 3]]);
});
