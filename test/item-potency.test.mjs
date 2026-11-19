import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemPotencyComparison } from '../lib/item-potency.mjs';

const items = [
  { key: 'desolator', name: 'Desolator', cost: 3500 },
  { key: 'diffusal_blade', name: 'Diffusal Blade', cost: 2500 },
  { key: 'disperser', name: 'Disperser', cost: 6100 },
  { key: 'maelstrom', name: 'Maelstrom', cost: 2950 },
  { key: 'manta', name: 'Manta Style', cost: 4550 },
  { key: 'ultimate_scepter', name: 'Aghanim’s Scepter', cost: 4200 },
];

test('7.42 Item Potency scales each eligible effect by attack source', () => {
  const comparison = buildItemPotencyComparison(items);
  const bySource = new Map(comparison.sources.map((source) => [source.key, source]));
  const values = (key) => bySource.get(key).effects.map(({ value }) => value);
  assert.deepEqual(values('hero'), [6, 40, 40, 25]);
  assert.deepEqual(values('illusion'), [1.2, 8, 8, 5]);
  assert.deepEqual(values('manta'), [2.1, 14, 14, 8.75]);
  assert.deepEqual(values('swashbuckle'), [3.6, 24, 24, 15]);
  assert.deepEqual(values('blade-fury-scepter'), [4.5, 30, 30, 18.75]);
  assert.deepEqual(values('phantasm'), values('hero'));
  assert.deepEqual(values('vengeful-scepter'), values('hero'));
  assert.deepEqual(values('chaos-knight-shard'), values('shadow-step'));
  assert.deepEqual(values('haunt'), values('illusion-rune'));
  assert.deepEqual(bySource.get('manta').requiredItem, items[4]);
  assert.deepEqual(bySource.get('blade-fury-scepter').requiredItem, items[5]);
  assert.equal(comparison.items.find(({ key }) => key === 'disperser').cost, 6100);
});

test('four connected Swashbuckle hits aggregate mana burn under a target mana cap', () => {
  for (const [targetMana, expected] of [[null, 96], [110, 96], [50, 50], [0, 0]]) {
    const { sources } = buildItemPotencyComparison(items, { targetMana });
    const { hits, effects } = sources.find(({ key }) => key === 'swashbuckle');
    assert.equal(hits, 4);
    assert.deepEqual(effects.map(({ sequenceValue }) => sequenceValue), [null, expected, expected, null]);
  }
  assert.throws(() => buildItemPotencyComparison(items, { targetMana: -1 }), RangeError);
});
