import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { GPM_PROJECTION_DEFAULTS, projectGpmEconomy } from '../lib/gpm-projections.mjs';
import { compareWraithKingBuilds } from '../lib/wraith-king-builds.mjs';
import { analyzeWraithKingReplayBuilds } from '../lib/wraith-king-replay-builds.mjs';

const dataDirectory = new URL('../data/7.42/', import.meta.url);
const { values } = parseArgs({ options: { snapshot: { type: 'string' }, role: { type: 'string', default: 'carry' } } });
const [snapshot, heroData, mechanics, shop] = await Promise.all([
  values.snapshot ?? new URL('wraith-king-replays.json', dataDirectory),
  ...['hero-dps.json', 'item-mechanics.json', 'shop-items.json'].map((name) => new URL(name, dataDirectory)),
].map(async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))));

const targetMinutes = [15, 20, 30];
const levelMarks = [1, 4, 7, 10, 12, 15, 18];
const { role } = values;
if (!['carry', 'offlane'].includes(role)) throw new RangeError('Choose carry or offlane.');
const { reserveGold } = GPM_PROJECTION_DEFAULTS;
const hero = heroData.heroes.find(({ id }) => id === 42);
const itemKeys = (row) => row.steps.map(({ items }) => items[0].key);
const roleEvidence = (result) => result.roles.find(({ key }) => key === role);
const evidence = analyzeWraithKingReplayBuilds(snapshot, shop.items, { limit: 5 });
const opening = roleEvidence(evidence).strictPrefixes.rows[0];
if (!opening) throw new Error(`There are no strictly ordered three-item ${role} prefixes in the replay bank.`);

const prefix = itemKeys(opening);
const extensions = roleEvidence(analyzeWraithKingReplayBuilds(snapshot, shop.items, { prefixLength: 4, limit: 100 }))
  .strictPrefixes.rows.filter((row) => itemKeys(row).slice(0, prefix.length).every((key, index) => key === prefix[index]));
const continuation = extensions[0] ?? null;
const order = continuation ? itemKeys(continuation) : prefix;
const majorComponents = {
  phase_boots: 'boots', power_treads: 'boots', armlet: 'helm_of_iron_will', radiance: 'relic',
};
const baseline = order.flatMap((key) => majorComponents[key] ? [majorComponents[key], key] : [key]);
const marks = levelMarks.map((_, index) => index * 5);
const economy = marks.slice(1).map((minute) => projectGpmEconomy(snapshot, { role, targetMinute: minute })
  .roles[0].scenarios);
if (economy.some((scenarios) => scenarios.length !== 3)) throw new Error(`Missing Wraith King ${role} economy data.`);

function farmCheckpoints(farm) {
  const checkpoints = [{ minute: 0, level: 1, earnedGold: 0, budget: 0 }];
  for (const [index, scenarios] of economy.entries()) {
    const minute = marks[index + 1];
    const mark = scenarios.find(({ key }) => key === farm);
    const previous = checkpoints.at(-1);
    const gold = Math.max(previous.earnedGold, mark.earnedGold);
    for (let time = previous.minute + 1; time <= minute; time += 1) {
      const share = (time - previous.minute) / (minute - previous.minute);
      const earnedGold = Math.floor(previous.earnedGold + share * (gold - previous.earnedGold));
      const level = Math.floor(previous.level + share * (levelMarks[index + 1] - previous.level));
      checkpoints.push({ minute: time, level, earnedGold, budget: Math.max(0, earnedGold - reserveGold),
        sampleSize: time === minute ? mark.sampleSize : null, basis: time === minute ? mark.basis : 'interpolated' });
    }
  }
  return checkpoints;
}

const cases = [
  { key: 'same-gold', options: {} },
  { key: 'armlet-off', options: { armletActive: false } },
  { key: 'more-armor', options: { targetArmor: 20 } },
  { key: 'farm-bonus', options: { bonusGpm: 75 } },
];

const farms = economy[0].map(({ key, label }) => {
  const checkpoints = farmCheckpoints(key);
  const baseArguments = { hero, items: mechanics.items, checkpoints, baseline };
  const evenGold = compareWraithKingBuilds(baseArguments);
  const extendPath = (keys) => {
    const next = ['black_king_bar', 'desolator', 'blink', 'assault'].find((key) => !keys.includes(key));
    const hammer = ['black_king_bar', 'desolator'].includes(next) && !keys.includes('mithril_hammer');
    return [...keys, ...(hammer ? ['mithril_hammer'] : []), next];
  };
  const lateBaseline = extendPath(baseline);
  const lateAlternatives = evenGold.paths.slice(1).map(({ key: pathKey, label: pathLabel, note, purchases }) => {
    const itemKeys = purchases.map(({ key: itemKey }) => itemKey);
    return { key: pathKey, label: pathLabel, note, itemKeys: extendPath(itemKeys) };
  });
  const comparisons = cases.map(({ key: scenario, options }) => {
    const result = scenario === 'same-gold' ? evenGold : compareWraithKingBuilds({ ...baseArguments, options });
    return { scenario, result };
  });
  comparisons.push({ scenario: 'fifth-item', result: compareWraithKingBuilds({
    ...baseArguments, baseline: lateBaseline, alternatives: lateAlternatives,
  }) });
  const summaries = comparisons.map(({ scenario, result }) => {
    const reference = result.paths[0];
    return { scenario, options: result.options,
      paths: result.paths.map(({ key: pathKey, label: pathLabel, note, purchases, points }) => ({
        key: pathKey, label: pathLabel, note,
        purchases: purchases.map(({ key: itemKey, name, minute, incrementalCost }) => ({ key: itemKey, name, minute, incrementalCost })),
        points: targetMinutes.map((minute) => {
          const { items, budget, spent, unspent, bonusGold, dps, physicalDps, procDps, mortalStrikeDps,
            radianceBurnDps, armletOffDps, mobility, spellProtection } = points[minute];
          const baselineDps = reference.points[minute].dps;
          return { minute, items, budget, spent, unspent, bonusGold, dps, physicalDps, procDps, mortalStrikeDps,
            radianceBurnDps, armletOffDps, mobility, spellProtection, baselineDps,
            deltaDps: dps - baselineDps, deltaPct: (dps / baselineDps - 1) * 100 };
        }),
      })) };
  });
  return { key, label, checkpoints: checkpoints.filter(({ minute }) => targetMinutes.includes(minute)),
    assumptions: evenGold.assumptions, sources: evenGold.sources, comparisons: summaries };
});

console.log(JSON.stringify({ evidence, role, baseline: { opening, continuation, extensions, order, pricedSteps: baseline }, reserveGold, farms }, null, 2));
