import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWraithKingReplayBuilds } from '../lib/wraith-king-replay-builds.mjs';

const catalog = [
  ['phase_boots', 1450], ['armlet', 2500], ['blink', 2250], ['radiance', 4700],
  ['black_king_bar', 4050], ['desolator', 3500], ['relic', 3400], ['mithril_hammer', 1600],
  ['aghanims_shard', 1400], ['recipe_desolator', 1500], ['tpscroll', 100], ['branches', 50],
].map(([key, cost]) => ({ key, name: key, cost }));

function game(id, events, { rankTier = 5, heroId = 42, role = 'carry', won = false } = {}) {
  return {
    id, rankTier, duration: 2200, patchConfidence: 'inferred',
    players: [{ heroId, role, won, purchases: events?.map(([key, time]) => ({ key, time })) ?? null }],
  };
}

function analyze(matches, options) {
  return analyzeWraithKingReplayBuilds({ patch: '7.42', matches }, catalog, options);
}

function stepKeys(row) {
  return row.steps.map(({ items }) => items.map(({ key }) => key));
}

const radianceOpening = [['phase_boots', 390], ['radiance', 1040], ['blink', 1200]];
const armletOpening = [['phase_boots', 405], ['armlet', 820], ['desolator', 1080]];

test('the most common ordered prefix is based on occurrence and ignores intermediate purchases', () => {
  const result = analyze([
    game('1', [['blink', 1650], ...radianceOpening, ['relic', 500], ['tpscroll', 800]]),
    game('2', [...radianceOpening, ['mithril_hammer', 1150], ['black_king_bar', 1600]]),
    game('3', [...radianceOpening, ['aghanims_shard', 1180], ['recipe_desolator', 1210], ['armlet', 1600]]),
    game('4', armletOpening, { won: true }),
    game('5', [...armletOpening, ['blink', 1250]], { won: true }),
    game('6', armletOpening, { role: 'offlane', won: true }),
    game('7', armletOpening, { rankTier: 6, won: true }),
  ]);
  const carry = result.roles.find(({ key }) => key === 'carry');
  assert.equal(carry.parsedPicks, 5);
  assert.equal(carry.strictPrefixes.modes, 1);
  assert.equal(carry.exactSequences.repeated, 0);
  assert.deepEqual(carry.strictPrefixes.rows.map(({ games, wins, share }) =>
    [games, wins, share]), [[3, 0, 0.6], [2, 2, 0.4]]);
  assert.deepEqual(stepKeys(carry.strictPrefixes.rows[0]), [['phase_boots'], ['radiance'], ['blink']]);
  assert.deepEqual(carry.strictPrefixes.rows[0].examples[0].stepTimesSeconds, [390, 1040, 1200]);
});

test('same-second items at the prefix boundary form a separate unordered group', () => {
  const result = analyze([
    game('1', [['phase_boots', 400], ['radiance', 1000], ['blink', 1200], ['armlet', 1200]]),
    game('2', [['phase_boots', 380], ['radiance', 1100], ['armlet', 1250], ['blink', 1250]]),
    game('3', [...radianceOpening, ['armlet', 1400], ['black_king_bar', 1400]]),
    game('4', [['phase_boots', 400], ['radiance', 1000], ['blink', 2201]]),
    game('5', null),
  ]);
  const carry = result.roles.find(({ key }) => key === 'carry');
  assert.deepEqual([carry.parsedPicks, carry.missingPurchaseLogPicks,
    carry.strictPrefixPicks, carry.tiedPrefixPicks, carry.insufficientMilestonePicks], [4, 1, 1, 2, 1]);
  assert.equal(carry.tiedPrefixes.distinct, 1);
  assert.equal(carry.tiedPrefixes.rows[0].games, 2);
  assert.deepEqual(stepKeys(carry.tiedPrefixes.rows[0]), [['phase_boots'], ['radiance'], ['armlet', 'blink']]);
  const { minSeconds, medianSeconds, maxSeconds } = carry.tiedPrefixes.rows[0].steps[2];
  assert.deepEqual([minSeconds, medianSeconds, maxSeconds], [1200, 1225, 1250]);
  assert.deepEqual(stepKeys(carry.strictPrefixes.rows[0]), [['phase_boots'], ['radiance'], ['blink']]);
});

test('equal-frequency prefixes share a rank and are counted when omitted from the result limit', () => {
  const result = analyze([
    game('1', radianceOpening),
    game('2', armletOpening, { won: true }),
  ], { limit: 1 });
  const { strictPrefixes } = result.roles.find(({ key }) => key === 'carry');
  assert.equal(strictPrefixes.rows.length, 1);
  assert.equal(strictPrefixes.rows[0].rank, 1);
  assert.equal(strictPrefixes.modes, 2);
  assert.equal(strictPrefixes.omittedAtCutoff, 1);
});

test('deduplicates targeted replay rows and tracks missing position and unordered starter counts', () => {
  const snapshot = [
    game('1', [['branches', -89], ['tpscroll', -89], ['branches', -89], ...radianceOpening], { role: 'unknown' }),
    game('2', [['branches', -89], ['branches', -89], ['tpscroll', -89], ...radianceOpening], { role: 'unknown' }),
    game('2', radianceOpening, { role: 'unknown' }),
    game('3', null, { role: 'unknown' }),
    game('4', radianceOpening, { heroId: 6 }),
  ];
  const result = analyze(snapshot);
  assert.deepEqual(result.coverage, {
    inputMatches: 5, legendMatches: 4, heroPicks: 3, parsedPicks: 2, missingPurchaseLogPicks: 1,
    missingRolePicks: 3, missingRoleAmongParsedPicks: 2, patchConfidencePicks: { verified: 0, inferred: 3, unknown: 0 },
  });
  const unknown = result.roles.find(({ key }) => key === 'unknown');
  assert.equal(unknown.preHornBundles.distinct, 1);
  assert.equal(unknown.preHornBundles.rows[0].games, 2);
  assert.deepEqual(unknown.preHornBundles.rows[0].items.map(({ key, quantity }) => [key, quantity]),
    [['branches', 2], ['tpscroll', 1]]);
});
