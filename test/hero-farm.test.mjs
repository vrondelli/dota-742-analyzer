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

test('a hero-specific condition retains the original guide and its cheaper bridge', () => {
  const juggernaut = heroes.find(({ id }) => id === 8);
  const farmEconomy = projectGpmEconomy({ matches: [{ duration: 1800, rankTier: 5, players: [
    { heroId: 8, role: 'carry', gpm: 300 },
    { heroId: 8, role: 'carry', gpm: 425 },
    { heroId: 8, role: 'carry', gpm: 500 },
  ] }] });
  const farm = buildHeroFarm(juggernaut, items, catalog, plans, farmEconomy, { role: 'carry', condition: 'illusions' });
  assert.equal(farm.type, 'curated');
  assert.equal(farm.conditionSource, 'hero-specific');
  assert.deepEqual(farm.scenarios.map(({ change }) => change.item.key), ['maelstrom', 'maelstrom', 'mjollnir']);
  assert.equal(farm.scenarios[0].change.deferredItem.key, 'mjollnir');
  assert.ok(farm.scenarios.every(({ items }) => items.filter(({ conditionItem }) => conditionItem).length === 1));
});

test('generic condition swaps replace upgrade components and reprice each farm tier', () => {
  const antiMage = heroes.find(({ id }) => id === 1);
  const farm = buildHeroFarm(antiMage, items, catalog, plans, economy, { role: 'carry', condition: 'illusions' });
  assert.equal(farm.type, 'role-template');
  assert.equal(farm.conditionSource, 'role-based');
  assert.ok(farm.scenarios.every(({ dps, items, spent, budget, change }) => dps === undefined
    && spent <= budget && change.item.key === 'mjollnir'
    && items.every(({ key, affordable, cumulativeCost }) => key !== 'maelstrom' && affordable === (cumulativeCost <= budget))));
  assert.ok(farm.scenarios.some(({ change }) => change.replaces?.key === 'maelstrom'));
});

test('a curated base uses a labeled role adjustment for an unmapped condition', () => {
  const juggernaut = heroes.find(({ id }) => id === 8);
  const farm = buildHeroFarm(juggernaut, items, catalog, plans, economy, { role: 'carry', condition: 'saves' });
  assert.equal(farm.type, 'curated');
  assert.equal(farm.conditionSource, 'role-based');
  assert.ok(farm.scenarios.every(({ change }) => change.item.key === 'nullifier'));
});

const combinedEconomy = projectGpmEconomy({ matches: [{ duration: 1800, rankTier: 5, players: [
  { heroId: 8, role: 'carry', gpm: 360 },
  { heroId: 8, role: 'carry', gpm: 440 },
  { heroId: 8, role: 'carry', gpm: 535 },
] }] });

test('illusions and heavy magic damage share the same sequential purchase budget', () => {
  const juggernaut = heroes.find(({ id }) => id === 8);
  const conditions = ['illusions', 'magic-burst'];
  const farm = buildHeroFarm(juggernaut, items, catalog, plans, combinedEconomy, { role: 'carry', conditions });
  assert.deepEqual(farm.conditions, conditions);
  assert.equal(farm.conditionSource, 'mixed');
  assert.deepEqual(farm.scenarios.map(({ changes }) => changes.map(({ item }) => item.key)),
    [['maelstrom', 'cloak'], ['maelstrom', 'cloak'], ['mjollnir', 'cloak']]);
  assert.ok(farm.scenarios.every(({ items: steps, budget, spent, changes }) => {
    const counters = steps.filter(({ conditionItem }) => conditionItem);
    return spent <= budget && counters.length === 2 && counters.every(({ affordable }) => affordable)
      && changes[1].deferredItem.key === 'black_king_bar' && changes[1].affordable;
  }));
});

test('one counter item can cover multiple conditions and is charged only once', () => {
  const antiMage = heroes.find(({ id }) => id === 1);
  const conditions = ['magic-burst', 'control'];
  const farm = buildHeroFarm(antiMage, items, catalog, plans, economy, { role: 'carry', conditions });
  for (const { items: steps, changes } of farm.scenarios) {
    const counters = steps.filter(({ conditionItem }) => conditionItem);
    assert.deepEqual(counters.map(({ key }) => key), ['black_king_bar']);
    assert.deepEqual(counters[0].conditions, conditions);
    assert.equal(changes[1].action, 'shared');
    assert.equal(changes[1].item.key, 'black_king_bar');
  }
});

test('the bridge to a shared counter applies only to the condition it addresses', () => {
  const antiMage = heroes.find(({ id }) => id === 1);
  const limitedEconomy = projectGpmEconomy({ matches: [{ duration: 1800, rankTier: 5, players: [
    { heroId: 1, role: 'carry', gpm: 240 },
    { heroId: 1, role: 'carry', gpm: 280 },
    { heroId: 1, role: 'carry', gpm: 320 },
  ] }] });
  const farm = buildHeroFarm(antiMage, items, catalog, plans, limitedEconomy,
    { role: 'carry', conditions: ['magic-burst', 'control'] });
  for (const { items: steps, changes } of farm.scenarios) {
    assert.deepEqual(steps.find(({ key }) => key === 'cloak').conditions, ['magic-burst']);
    assert.equal(changes[1].item.key, 'black_king_bar');
    assert.equal(changes[1].affordable, false);
  }
});

test('the first condition keeps its upgrade when another condition requests a conflicting branch', () => {
  const juggernaut = heroes.find(({ id }) => id === 8);
  const original = plans.find(({ heroId }) => heroId === 8);
  const plan = { ...original, swaps: [...original.swaps, { trigger: 'summons', itemKey: 'gungir', note: 'Root a group of units.' }] };
  const farm = buildHeroFarm(juggernaut, items, catalog, [plan], economy, { role: 'carry', conditions: ['illusions', 'summons'] });
  for (const { items: steps, changes } of farm.scenarios) {
    assert.deepEqual(steps.filter(({ conditionItem }) => conditionItem).map(({ key }) => key), ['mjollnir']);
    assert.ok(steps.every(({ key }) => key !== 'gungir' && key !== 'maelstrom'));
    assert.equal(changes[1].requestedItem.key, 'gungir');
    assert.equal(changes[1].action, 'conflict');
  }
});

test('an affordable counter is bought before an unaffordable higher-priority response', () => {
  const juggernaut = heroes.find(({ id }) => id === 8);
  const farm = buildHeroFarm(juggernaut, items, catalog, plans, combinedEconomy, { role: 'carry', conditions: ['evasion', 'healing'] });
  const { items: steps, changes } = farm.scenarios[0];
  assert.deepEqual(steps.slice(2, 4).map(({ key, affordable }) => [key, affordable]), [['orb_of_corrosion', true], ['monkey_king_bar', false]]);
  assert.deepEqual(changes.map(({ condition, affordable }) => [condition, affordable]), [['evasion', false], ['healing', true]]);
});
