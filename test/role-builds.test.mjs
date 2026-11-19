import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBuilds, BUILD_METRICS } from '../lib/build-efficiency.mjs';
import { analyzeRoleBuilds } from '../lib/role-builds.mjs';

function hero(id, attackDamage) {
  return {
    id, key: `hero_${id}`, name: `Hero ${id}`, primaryAttribute: 'agility',
    baseAttackTime: 1.5, baseArmor: 0, baseHealth: 200, baseMagicResistance: 25,
    baseHealthRegen: 0.25, baseMana: 75, baseManaRegen: 0, baseMoveSpeed: 300,
    levels: [1, 7].map((level) => ({
      level, strength: 30, agility: 35, intelligence: 25, meanAttackDamage: attackDamage, attackSpeed: 135,
    })),
  };
}

const heroes = [hero(1, 60), hero(2, 85), hero(3, 105)];
const items = [
  { id: 11, key: 'blade', name: 'Blade', cost: 1000, stats: { attackDamage: 20 }, coverage: 'flat' },
  { id: 12, key: 'glove', name: 'Glove', cost: 1001, stats: { attackSpeed: 30 }, coverage: 'flat' },
  { id: 13, key: 'large', name: 'Large', cost: 2501, stats: {
    health: 100, armor: 10, magicResistance: 8, mana: 80, healthRegen: 3, manaRegen: 3, moveSpeed: 25,
  }, coverage: 'flat' },
  {
    id: 14, key: 'caster', name: 'Caster', cost: 2500, stats: { spellAmp: 10 }, coverage: 'partial',
    effects: [{ key: 'zap', kind: 'magic-active', damage: 400 }],
    auras: [
      { key: 'armored', recipient: 'allies', stats: {
        armor: 2, attackDamagePct: 10, attackSpeed: 10, magicResistance: 8, healthRegen: 2, manaRegen: 2,
      } },
      { key: 'weakened', recipient: 'enemies', stats: { armorReduction: 3, attackSpeed: -10 } },
    ],
  },
  { id: 15, key: 'large_blade', name: 'Large blade', cost: 3001, stats: { attackDamage: 70 }, coverage: 'flat' },
];

const player = (heroId, role, won) => ({ heroId, role, won, roleConfidence: 'inferred' });
const snapshot = {
  matches: [
    { rankTier: 5, patchConfidence: 'inferred', players: [player(1, 'carry', false), player(2, 'mid', true)] },
    { rankTier: 5, patchConfidence: 'inferred', players: [player(1, 'carry', false), player(2, 'carry', true)] },
    { rankTier: 5, patchConfidence: 'inferred', players: [player(3, 'unknown', true)] },
    { rankTier: 6, patchConfidence: 'inferred', players: [player(3, 'carry', true)] },
  ],
};

test('spending bands are disjoint and keep one maximum efficiency build per hero', () => {
  const result = analyzeRoleBuilds(heroes, items, snapshot, { coverage: 'flat' });
  assert.deepEqual(result.roster.bands.map(({ minSpend, maxSpend }) => [minSpend, maxSpend]), [
    [1, 1000], [1001, 3000], [3001, 5000],
  ]);
  for (const { rows, minSpend, maxSpend } of result.roster.bands) {
    assert.equal(rows.length, 3);
    assert.ok(rows.every(({ cost }) => cost >= minSpend && cost <= maxSpend));
    assert.ok(rows.every(({ coverage }) => coverage === 'flat'));
    assert.equal(new Set(rows.map(({ hero }) => hero.id)).size, rows.length);
    assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].gainPer1000 >= row.gainPer1000));
  }
  assert.deepEqual(result.roster.bands[0].rows.map(({ cost, rank }) => [cost, rank]), [
    [1000, 1], [1000, 2], [1000, 3],
  ]);
});

test('roles come from Legend replay picks, loss rows count, and the separate roster stays exploratory', () => {
  const result = analyzeRoleBuilds(heroes, items, snapshot);
  assert.deepEqual(result.coverage, {
    legendMatches: 3, replayMatches: 2, replayPicks: 4, heroCount: 3, spellHeroCount: null,
  });
  const carry = result.roles.find(({ key }) => key === 'carry');
  const mid = result.roles.find(({ key }) => key === 'mid');
  assert.deepEqual(carry.bands[0].rows.map((row) => [row.hero.id, row.replayPicks, row.replayWins]), [
    [2, 1, 1], [1, 2, 0],
  ]);
  assert.deepEqual(mid.bands[0].rows.map((row) => row.hero.id), [2]);
  assert.equal(result.roster.bands[0].rows.find(({ hero }) => hero.id === 3).replayPicks, 0);
  const filtered = analyzeRoleBuilds(heroes, items, snapshot, { minReplayPicks: 2, includeRoster: false });
  assert.equal(filtered.roster, null);
  assert.deepEqual(filtered.roles.find(({ key }) => key === 'carry').bands[0].rows.map(({ hero }) => hero.id), [1]);
  assert.equal(filtered.roles.find(({ key }) => key === 'mid').bands[0].rows.length, 0);
});

test('adding an item without gain cannot pad a build into a higher spending band', () => {
  const result = analyzeRoleBuilds(heroes, [items[0], items[2]], snapshot);
  assert.equal(result.roster.bands[0].eligibleHeroes, 3);
  assert.equal(result.roster.bands[1].eligibleHeroes, 0);
  assert.equal(result.roster.bands[2].eligibleHeroes, 0);
});

test('magic uses one highest learned spell and keeps item-only heroes separate', () => {
  const spells = [{ id: 1, spells: [
    { key: 'basic', name: 'Basic', damageByRank: [100, 200, 300, 400], rankUnlockLevels: [1, 3, 5, 7] },
    { key: 'ultimate', name: 'Ultimate', damageByRank: [350, 750, 1200], rankUnlockLevels: [6, 12, 18] },
  ] }, { id: 3, spells: [
    { key: 'locked', name: 'Locked', damageByRank: [800], rankUnlockLevels: [12] },
  ] }];
  const options = { metric: 'magicalDamage', level: 7, maxItems: 1, targetMagicResistance: 25, spells };
  const result = analyzeRoleBuilds(heroes, items, snapshot, options);
  const band = result.roster.bands[1];
  assert.equal(result.coverage.spellHeroCount, 1);
  assert.deepEqual(band.rows[0].spell, { key: 'basic', name: 'Basic', rank: 4, damage: 400 });
  assert.deepEqual([band.rows[0].base, band.rows[0].total, band.rows[0].gain], [300, 660, 360]);
  assert.equal(band.itemOnlyHeroes, 2);
  assert.ok(band.itemOnlyRows.every((row) => row.spell === null && row.base === 0 && row.total === 330));
  const early = analyzeRoleBuilds(heroes, items, snapshot, { ...options, level: 1 });
  assert.equal(early.roster.bands[1].rows[0].spell.damage, 100);
});

test('prepared matrix and single-hero build calculations agree on every metric', () => {
  for (const { key: metric } of BUILD_METRICS) {
    const [selected] = heroes;
    const options = { level: 7, metric, targetArmor: 5, budgets: [5000] };
    const matrix = analyzeRoleBuilds([selected], items, snapshot, options);
    const band = matrix.roster.bands[0];
    const row = band.rows[0] ?? band.itemOnlyRows[0];
    assert.ok(row, `Expected a positive fixture gain for ${metric}`);
    const checked = analyzeBuilds(selected, items, {
      ...options,
      budget: 5000,
      baseSpellDamage: 0,
      itemKeys: row.items.map(({ key }) => key),
    }).rows[0];
    assert.ok(Math.abs(row.total - checked.metrics[metric]) < 1e-9, metric);
    assert.ok(Math.abs(row.gainPer1000 - checked.gainPer1000) < 1e-9, metric);
  }
});
