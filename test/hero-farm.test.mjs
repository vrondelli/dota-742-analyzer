import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHeroFarm } from '../lib/hero-farm.mjs';
import { projectGpmEconomy } from '../lib/gpm-projections.mjs';

const readData = (file) => JSON.parse(readFileSync(new URL(`../data/7.42/${file}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const { heroes } = readData('hero-dps');
const { items } = readData('item-mechanics');
const { plans } = readData('draft-plans');
const catalog = new Map(readData('shop-items').items.map((item) => [item.key, item]));
const economy = projectGpmEconomy({ matches: [{ duration: 1800, rankTier: 5, players: [
  { heroId: 8, role: 'carry', gpm: 400 },
  { heroId: 8, role: 'carry', gpm: 500 },
  { heroId: 8, role: 'carry', gpm: 700 },
] }] });

test('hero-specific purchase order wins over the carry damage optimizer', () => {
  const juggernaut = heroes.find(({ id }) => id === 8);
  const farm = buildHeroFarm(juggernaut, items, catalog, plans, economy, { role: 'carry', replayPicks: 3 });
  assert.equal(farm.type, 'curated');
  assert.equal(farm.replayPicks, 3);
  assert.deepEqual(farm.scenarios.map(({ key }) => key), ['bad', 'good', 'easy']);
  assert.deepEqual(farm.scenarios[0].items.map(({ key }) => key), plans.find(({ heroId }) => heroId === 8).builds.bad.items);
  assert.ok(farm.scenarios.every(({ sampleSize, spent, budget }) => sampleSize === 3 && spent <= budget));
});

test('a carry with no role replays can use the role budget without implying hero evidence', () => {
  const antiMage = heroes.find(({ id }) => id === 1);
  const farm = buildHeroFarm(antiMage, items, catalog, plans, economy, { role: 'carry' });
  assert.equal(farm.type, 'right-click-model');
  assert.equal(farm.replayPicks, 0);
  assert.ok(farm.scenarios.every(({ dps, baselineDps, spent, budget }) => dps >= baselineDps && spent <= budget));
});

test('support examples retain unknown affordability when the role has no economy sample', () => {
  const farm = buildHeroFarm(heroes[0], items, catalog, [], economy, { role: 'hard-support' });
  assert.equal(farm.type, 'role-template');
  assert.ok(farm.scenarios.every(({ basis, budget, spent, items }) => basis === 'unavailable' && budget === null
    && spent === null && items.length && items.every(({ affordable }) => affordable === null)));
});

test('observed purchases count repeated completions in matching role replays before the cutoff', () => {
  const antiMage = heroes.find(({ id }) => id === 1);
  const replay = (purchases, options = {}) => ({
    rankTier: 5, duration: 1800, players: [{ heroId: 1, role: 'carry', purchases }], ...options,
  });
  const log = [{ key: 'bfury', time: 900 }, { key: 'bfury', time: 901 }, { key: 'broadsword', time: 450 }];
  const matching = [replay(log), replay(log), replay([{ key: 'bfury', time: 1201 }])];
  const other = [replay(log, { duration: 1199 }), replay(log, { rankTier: 4 }),
    replay(log, { players: [{ heroId: 1, role: 'mid', purchases: log }] })];
  const snapshot = { matches: [...matching, ...other] };
  const farm = buildHeroFarm(antiMage, items, catalog, [], economy, { role: 'carry', snapshot });
  assert.equal(farm.observedPurchases.sampleSize, 3);
  assert.equal(farm.observedPurchases.targetMinute, 20);
  assert.deepEqual(farm.observedPurchases.items.map(({ key, games }) => [key, games]), [['bfury', 2]]);
  const small = buildHeroFarm(antiMage, items, catalog, [], economy, { role: 'carry', snapshot: { matches: matching.slice(0, 2) } });
  assert.equal(small.observedPurchases, undefined);
});
