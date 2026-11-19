const legendTier = 5;
const overallPriorGames = 40;
const matchupPriorGames = 25;
const minGames = 20;
const minComparisonGames = 20;
const maxRows = 8;
const evidenceBySnapshot = new WeakMap();

function normalizedTeams(players) {
  if (!Array.isArray(players) || players.length !== 10) return null;
  if (players.some((player) => !Number.isInteger(player?.heroId) || player.heroId < 1 || typeof player.won !== 'boolean')
    || new Set(players.map(({ heroId }) => heroId)).size !== 10) {
    return null;
  }
  // OpenDota's normalized match rows place Radiant before Dire. Replay updates preserve that order.
  const teams = [players.slice(0, 5), players.slice(5)];
  if (teams[0][0].won === teams[1][0].won
    || teams.some((side) => side.some(({ won }) => won !== side[0].won))) return null;
  return teams;
}

export function* rankMatchTeams(snapshot, tier) {
  const seenMatchIds = new Set();
  for (const { id, rankTier, players } of snapshot.matches) {
    if (rankTier !== tier) continue;
    if (id !== undefined) {
      const key = String(id);
      if (seenMatchIds.has(key)) continue;
      seenMatchIds.add(key);
    }
    yield normalizedTeams(players);
  }
}

export function addMatchResult(tallies, id, won) {
  const row = tallies.get(id) ?? { games: 0, wins: 0 };
  row.games += 1;
  row.wins += Number(won);
  tallies.set(id, row);
  return row;
}

export function shrinkWinRate({ games, wins }, prior = 0.5, priorGames = overallPriorGames) {
  return (wins + prior * priorGames) / (games + priorGames);
}

export function matchupEvidence(enemy, totals, { games = 0, wins = 0 } = {}) {
  const comparisonGames = totals.games - games;
  const comparisonRate = shrinkWinRate({ games: comparisonGames, wins: totals.wins - wins });
  const adjustedWinRate = games ? shrinkWinRate({ games, wins }, comparisonRate, matchupPriorGames) : null;
  return {
    enemyId: enemy.id,
    enemyName: enemy.name,
    games,
    wins,
    winRate: games ? wins / games : null,
    comparisonGames,
    comparisonRate,
    adjustedWinRate,
    delta: games ? adjustedWinRate - comparisonRate : null,
  };
}

function collectMatchupIndex(snapshot) {
  const totals = new Map();
  const opponents = new Map();
  const coverage = { legendMatches: 0, teamMatches: 0 };
  for (const teams of rankMatchTeams(snapshot, legendTier)) {
    coverage.legendMatches += 1;
    if (!teams) continue;
    coverage.teamMatches += 1;
    for (const [side, enemies] of [[teams[0], teams[1]], [teams[1], teams[0]]]) {
      for (const { heroId, won } of side) {
        addMatchResult(totals, heroId, won);
        if (!opponents.has(heroId)) opponents.set(heroId, new Map());
        const heroOpponents = opponents.get(heroId);
        for (const { heroId: enemyId } of enemies) addMatchResult(heroOpponents, enemyId, won);
      }
    }
  }
  return { totals, opponents, coverage };
}

export function getHeroMatchups(heroes, snapshot, heroId) {
  if (!evidenceBySnapshot.has(snapshot)) evidenceBySnapshot.set(snapshot, collectMatchupIndex(snapshot));
  const { totals, opponents, coverage } = evidenceBySnapshot.get(snapshot);
  const total = totals.get(heroId) ?? { games: 0, wins: 0 };
  const heroOpponents = opponents.get(heroId);
  const eligible = [];
  for (const enemy of heroes) {
    const tally = heroOpponents?.get(enemy.id);
    if (!tally || tally.games < minGames || total.games - tally.games < minComparisonGames) continue;
    eligible.push(matchupEvidence(enemy, total, tally));
  }
  const bySample = (a, b) => b.games - a.games || a.enemyId - b.enemyId;
  return {
    favorable: eligible.filter(({ delta }) => delta > 0).sort((a, b) => b.delta - a.delta || bySample(a, b)).slice(0, maxRows),
    difficult: eligible.filter(({ delta }) => delta < 0).sort((a, b) => a.delta - b.delta || bySample(a, b)).slice(0, maxRows),
    coverage: {
      ...coverage,
      heroGames: total.games,
      heroWinRate: total.games ? total.wins / total.games : null,
      eligibleOpponents: eligible.length,
    },
    minGames,
    minComparisonGames,
  };
}
