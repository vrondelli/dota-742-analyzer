import { LEGEND_ROLES } from './role-builds.mjs';

const HERO_ID = 42;
const RANK_TIER = 5;
const MINIMUM_MAJOR_ITEM_COST = 1400;

const excludedComponents = new Set([
  'demon_edge', 'eagle', 'hyperstone', 'mithril_hammer', 'mystic_staff', 'oblivion_staff',
  'pers', 'platemail', 'reaver', 'relic', 'ring_of_tarrasque', 'soul_booster',
  'tiara_of_selemene', 'ultimate_orb',
]);
const excludedUpgrades = new Set(['aghanims_shard', 'moon_shard', 'ultimate_scepter_2']);
const roles = [...LEGEND_ROLES, { key: 'unknown', label: 'Unknown position' }];

function isMajorItem(item) {
  return item?.cost >= MINIMUM_MAJOR_ITEM_COST
    && !item.key.startsWith('recipe_')
    && !excludedComponents.has(item.key)
    && !excludedUpgrades.has(item.key);
}

function describeItem(item) {
  const { key, name, cost } = item;
  return { key, name, cost };
}

function getMilestoneGroups(purchases, catalog, duration) {
  const first = new Map();
  for (const { key, time } of purchases) {
    if (!isMajorItem(catalog.get(key)) || !Number.isFinite(time) || time < 0 || time > duration) continue;
    if (!first.has(key) || time < first.get(key)) first.set(key, time);
  }
  const groups = new Map();
  for (const [key, time] of first) {
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(key);
  }
  return [...groups].sort(([a], [b]) => a - b)
    .map(([time, keys]) => ({ time, keys: keys.sort() }));
}

function getPreHornBundle(purchases, catalog) {
  const counts = new Map();
  for (const { key, time } of purchases) {
    if (!catalog.has(key) || !Number.isFinite(time) || time >= 0) continue;
    counts.set(key, 1 + (counts.get(key) ?? 0));
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

function firstGroups(groups, itemCount) {
  let seen = 0;
  for (const [index, group] of groups.entries()) {
    seen += group.keys.length;
    if (seen >= itemCount) return groups.slice(0, index + 1);
  }
  return null;
}

function record(map, definition, game, timestamps = []) {
  const key = JSON.stringify(definition);
  if (!map.has(key)) map.set(key, { definition, games: [] });
  map.get(key).games.push({ ...game, timestamps });
}

function stepsKey(groups) {
  return groups.map(({ keys }) => keys);
}

function timingSummary(times) {
  const ordered = times.sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const medianSeconds = ordered.length % 2
    ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  return { minSeconds: ordered[0], medianSeconds, maxSeconds: ordered.at(-1) };
}

function summarize(map, denominator, limit, makeSteps) {
  const ordered = [...map].sort(([ka, a], [kb, b]) => b.games.length - a.games.length || ka.localeCompare(kb));
  let rank;
  const rows = [];
  for (const [index, [, group]] of ordered.slice(0, limit).entries()) {
    const count = group.games.length;
    if (count !== ordered[index - 1]?.[1].games.length) rank = index + 1;
    const wins = group.games.filter(({ won }) => won).length;
    rows.push({
      rank, games: count, wins, share: count / denominator,
      ...makeSteps(group.definition, group.games),
      examples: group.games.slice(0, 3).map(({ id, won, duration, timestamps }) => ({
        matchId: id, won, matchDurationSeconds: duration, stepTimesSeconds: timestamps,
      })),
    });
  }
  return {
    distinct: map.size,
    repeated: ordered.filter(([, entry]) => entry.games.length > 1).length,
    modes: ordered.filter(([, entry]) => entry.games.length === rows[0]?.games).length,
    omittedAtCutoff: ordered.slice(limit).filter(([, entry]) => entry.games.length === rows.at(-1)?.games).length,
    rows,
  };
}

function analyzeRole(cohort, catalog, prefixLength, limit) {
  const exact = new Map();
  const prefixes = new Map();
  const tiedPrefixes = new Map();
  const bundles = new Map();
  let parsedPicks = 0;
  let parsedWins = 0;
  let strictPrefixPicks = 0;
  let tiedPrefixPicks = 0;
  let picksWithMilestones = 0;
  let preHornPicks = 0;
  for (const game of cohort) {
    if (!Array.isArray(game.purchases)) continue;
    parsedPicks += 1;
    parsedWins += Number(game.won);
    const { purchases, ...example } = game;
    const bundle = getPreHornBundle(purchases, catalog);
    if (bundle.length) {
      preHornPicks += 1;
      record(bundles, bundle, example);
    }
    const groups = getMilestoneGroups(purchases, catalog, game.duration);
    if (!groups.length) continue;
    picksWithMilestones += 1;
    record(exact, stepsKey(groups), example, groups.map(({ time }) => time));
    const prefix = firstGroups(groups, prefixLength);
    if (!prefix) continue;
    const timestamps = prefix.map(({ time }) => time);
    if (prefix.some(({ keys }) => keys.length > 1)) {
      tiedPrefixPicks += 1;
      record(tiedPrefixes, stepsKey(prefix), example, timestamps);
    } else {
      strictPrefixPicks += 1;
      record(prefixes, stepsKey(prefix), example, timestamps);
    }
  }
  const steps = (definition, games) => ({
    steps: definition.map((keys, index) => ({
      items: keys.map((key) => describeItem(catalog.get(key))),
      ...timingSummary(games.map(({ timestamps }) => timestamps[index])),
    })),
  });
  return {
    picks: cohort.length,
    parsedPicks,
    missingPurchaseLogPicks: cohort.length - parsedPicks,
    parsedWins,
    picksWithMilestones,
    strictPrefixPicks,
    tiedPrefixPicks,
    insufficientMilestonePicks: parsedPicks - strictPrefixPicks - tiedPrefixPicks,
    preHornPicks,
    strictPrefixes: summarize(prefixes, parsedPicks, limit, steps),
    tiedPrefixes: summarize(tiedPrefixes, parsedPicks, limit, steps),
    exactSequences: summarize(exact, parsedPicks, limit, steps),
    preHornBundles: summarize(bundles, preHornPicks, limit, (definition) => ({
      items: definition.map(([key, quantity]) => ({ ...describeItem(catalog.get(key)), quantity })),
    })),
  };
}

export function analyzeWraithKingReplayBuilds(snapshot, shopItems, { prefixLength = 3, limit = 3 } = {}) {
  if (snapshot.patch !== '7.42' || !Array.isArray(snapshot.matches)) {
    throw new TypeError('Expected a 7.42 normalized match snapshot.');
  }
  if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > 10) {
    throw new RangeError('Prefix length must be an integer from 1 to 10.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Result limit must be an integer from 1 to 100.');
  }
  const catalog = new Map(shopItems.map((item) => [item.key, item]));
  const byRole = new Map(roles.map(({ key }) => [key, []]));
  const patchConfidencePicks = { verified: 0, inferred: 0, unknown: 0 };
  const seenMatches = new Set();
  let legendMatches = 0;
  let heroPicks = 0;
  let parsedPicks = 0;
  let missingRolePicks = 0;
  let missingRoleAmongParsedPicks = 0;

  for (const match of snapshot.matches) {
    if (match.rankTier !== RANK_TIER || seenMatches.has(match.id)) continue;
    legendMatches += 1;
    seenMatches.add(match.id);
    const player = match.players.find(({ heroId }) => heroId === HERO_ID);
    if (!player) continue;
    heroPicks += 1;
    const parsed = Array.isArray(player.purchases);
    if (parsed) parsedPicks += 1;
    const role = byRole.has(player.role) ? player.role : 'unknown';
    if (role === 'unknown') {
      missingRolePicks += 1;
      if (parsed) missingRoleAmongParsedPicks += 1;
    }
    const { patchConfidence } = match;
    const confidence = patchConfidence === 'verified' || patchConfidence === 'inferred' ? patchConfidence : 'unknown';
    patchConfidencePicks[confidence] += 1;
    byRole.get(role).push({ id: match.id, duration: match.duration, won: player.won, purchases: player.purchases });
  }

  return {
    patch: snapshot.patch, heroId: HERO_ID, hero: 'Wraith King', rankTier: RANK_TIER,
    rankBasis: 'OpenDota estimated Legend-average match medal',
    mode: snapshot.sampling?.mode ?? null,
    source: snapshot.source ?? null,
    fetchedAt: snapshot.fetchedAt ?? null,
    sampling: snapshot.sampling ?? null,
    coverage: {
      inputMatches: snapshot.matches.length, legendMatches, heroPicks, parsedPicks,
      missingPurchaseLogPicks: heroPicks - parsedPicks, missingRolePicks, missingRoleAmongParsedPicks,
      patchConfidencePicks,
    },
    policy: {
      prefixLength, limit, minimumMajorItemCost: MINIMUM_MAJOR_ITEM_COST,
      excludedComponents: [...excludedComponents],
      excludedUpgrades: [...excludedUpgrades],
      milestones: 'First recorded acquisition of each eligible post-horn major item.',
      timingTies: 'Items recorded in the same second are unordered. A strict prefix ends before any tie.',
      frequencyTies: 'Equal counts share a rank. Ties omitted at the display limit are counted.',
      sequenceShare: 'Fraction of Wraith King picks in the same role with purchase logs.',
      preHornBundle: 'Unordered known shop-item records with quantities. Share uses logged nonempty bundles.',
    },
    roles: roles.map(({ key, label }) => ({
      key, label, ...analyzeRole(byRole.get(key), catalog, prefixLength, limit),
    })),
  };
}
