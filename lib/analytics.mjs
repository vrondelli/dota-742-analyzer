const DEFAULT_MIN_GAMES = 5;
const DEFAULT_MIN_GROUP = 5;
const CONFIDENCE_Z = 1.959963984540054;

export const PURCHASE_WINDOWS = Object.freeze([
  Object.freeze({ key: 'opening', label: 'Before 5 min', start: -90, end: 300 }),
  Object.freeze({ key: 'early', label: '5–15 min', start: 300, end: 900 }),
  Object.freeze({ key: 'mid', label: '15–25 min', start: 900, end: 1500 }),
  Object.freeze({ key: 'late', label: '25–40 min', start: 1500, end: 2400 }),
]);

function selectMatches(snapshot, { rankTier = 'all', patchConfidence = 'all' }) {
  return snapshot.matches.filter((match) => {
    const matchRank = match.rankTier == null ? 'unknown' : String(match.rankTier);
    return (rankTier === 'all' || String(rankTier) === matchRank)
      && (patchConfidence === 'all' || patchConfidence === match.patchConfidence);
  });
}

function selectPlayer(player, { role = 'all', roleConfidence = 'all' }) {
  return (role === 'all' || player.role === role)
    && (roleConfidence === 'all' || player.roleConfidence === roleConfidence);
}

function wilsonInterval(wins, games) {
  const rate = wins / games;
  const z2 = CONFIDENCE_Z ** 2;
  const denominator = 1 + z2 / games;
  const center = rate + z2 / (2 * games);
  const halfWidth = CONFIDENCE_Z * Math.sqrt((rate * (1 - rate) + z2 / (4 * games)) / games);
  return [Math.max(0, (center - halfWidth) / denominator), Math.min(1, (center + halfWidth) / denominator)];
}

function rankRows(rows, qualifies, compare, compareInsufficient) {
  const ranked = rows.filter(qualifies).sort(compare);
  const provisional = rows.filter((row) => !qualifies(row)).sort(compareInsufficient);
  ranked.forEach((row, index) => { row.rank = index + 1; });
  return [...ranked, ...provisional];
}

export function getHeroRankings(snapshot, filters = {}) {
  const matches = selectMatches(snapshot, filters);
  const minGames = filters.minGames ?? DEFAULT_MIN_GAMES;
  const heroes = new Map();
  let eligiblePicks = 0;
  let roleKnownPicks = 0;
  let parsedPicks = 0;
  let totalPicks = 0;

  for (const { players } of matches) {
    totalPicks += players.length;
    for (const player of players) {
      if (player.role !== 'unknown') roleKnownPicks += 1;
      if (Array.isArray(player.purchases)) parsedPicks += 1;
      if (!selectPlayer(player, filters)) continue;

      eligiblePicks += 1;
      if (!heroes.has(player.heroId)) heroes.set(player.heroId, { games: 0, wins: 0 });
      const hero = heroes.get(player.heroId);
      hero.games += 1;
      hero.wins += Number(player.won);
    }
  }

  const rows = Array.from(heroes, ([heroId, { games, wins }]) => {
    const [confidenceLow, confidenceHigh] = wilsonInterval(wins, games);
    return {
      heroId, games, wins, winRate: wins / games, pickRate: games / eligiblePicks,
      confidenceLow, confidenceHigh, rank: null,
    };
  });
  const bySample = (a, b) => b.games - a.games || a.heroId - b.heroId;
  const rankedRows = rankRows(rows, (row) => row.games >= minGames,
    (a, b) => b.confidenceLow - a.confidenceLow || bySample(a, b), bySample);

  const verifiedMatches = matches.filter((match) => match.patchConfidence === 'verified').length;
  return { matches: matches.length, verifiedMatches, eligiblePicks, roleKnownPicks, parsedPicks, totalPicks, minGames, rows: rankedRows };
}

function firstPurchases(purchases, itemCatalog, duration, windowEnd) {
  const first = new Map();
  for (const { key, time } of purchases) {
    if (!itemCatalog.has(key) || !Number.isFinite(time) || time >= windowEnd || time > duration) continue;
    if (!first.has(key) || first.get(key) > time) first.set(key, time);
  }
  return first;
}

function median(times) {
  const ordered = [...times].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

export function getItemRankings(snapshot, itemCatalog, heroId, filters = {}) {
  const window = PURCHASE_WINDOWS.find(({ key }) => key === (filters.window ?? 'early'));
  if (!window) throw new RangeError(`Unknown purchase window: ${filters.window}`);
  const minGroup = filters.minGroup ?? DEFAULT_MIN_GROUP;
  const matches = selectMatches(snapshot, filters);
  const items = new Map();
  let heroGames = 0;
  let windowGames = 0;
  let parsedGames = 0;
  let parsedWins = 0;

  for (const match of matches) {
    const player = match.players.find((candidate) => candidate.heroId === heroId && selectPlayer(candidate, filters));
    if (!player) continue;
    heroGames += 1;
    if (match.duration < window.end) continue;
    windowGames += 1;
    if (!Array.isArray(player.purchases)) continue;
    parsedGames += 1;
    const won = Number(player.won);
    parsedWins += won;

    for (const [key, time] of firstPurchases(player.purchases, itemCatalog, match.duration, window.end)) {
      if (!items.has(key)) items.set(key, { times: [], buyerWins: 0, priorOwners: 0, priorOwnerWins: 0 });
      const item = items.get(key);
      if (time < window.start) {
        item.priorOwners += 1;
        item.priorOwnerWins += won;
      } else {
        item.times.push(time);
        item.buyerWins += won;
      }
    }
  }

  const rows = [];
  for (const [key, { times, buyerWins, priorOwners, priorOwnerWins }] of items) {
    const buyers = times.length;
    if (!buyers) continue;
    const { id, name } = itemCatalog.get(key);
    const nonBuyers = parsedGames - priorOwners - buyers;
    const nonBuyerWins = parsedWins - priorOwnerWins - buyerWins;
    const buyerWinRate = buyerWins / buyers;
    const nonBuyerWinRate = nonBuyers ? nonBuyerWins / nonBuyers : null;
    rows.push({
      key, itemId: id ?? null, name, buyers, buyerWins, nonBuyers, nonBuyerWins, buyerWinRate, nonBuyerWinRate,
      winRateDifference: nonBuyerWinRate === null ? null : buyerWinRate - nonBuyerWinRate,
      medianPurchaseTime: median(times),
      rank: null,
    });
  }

  const bySample = (a, b) => b.buyers - a.buyers || b.nonBuyers - a.nonBuyers || a.key.localeCompare(b.key);
  const rankedRows = rankRows(rows, (row) => row.buyers >= minGroup && row.nonBuyers >= minGroup,
    (a, b) => b.winRateDifference - a.winRateDifference || bySample(a, b), bySample);

  return { matches: matches.length, heroGames, windowGames, parsedGames, window, minGroup, rows: rankedRows };
}
