import { LEGEND_ROLES } from './role-builds.mjs';
import { addMatchResult, matchupEvidence, rankMatchTeams, shrinkWinRate } from './hero-matchups.mjs';

const emptyPicks = Object.freeze([]);
const roleByKey = new Map(LEGEND_ROLES.map((role) => [role.key, role]));

export const DRAFT_GUIDE_DEFAULTS = Object.freeze({
  rankTier: 5,
  role: 'carry',
  enemyIds: emptyPicks,
  allyIds: emptyPicks,
  blockedIds: emptyPicks,
  candidateIds: null,
  minRolePicks: 1,
  limit: 8,
});

const rolePriorGames = 24;
const blindFlexBonusPerRole = 0.005;
const maxBlindFlexBonus = 0.015;

function draftOptions(input, heroes) {
  const options = { ...DRAFT_GUIDE_DEFAULTS, ...input };
  if (!roleByKey.has(options.role)) throw new RangeError('Select a Legend role.');
  if (options.rankTier !== DRAFT_GUIDE_DEFAULTS.rankTier) {
    throw new RangeError('The draft guide uses the Legend average match bracket.');
  }
  for (const [key, min, max] of [['minRolePicks', 0, 10000], ['limit', 1, 20]]) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) {
      throw new RangeError(`${key} must be an integer from ${min} to ${max}.`);
    }
  }
  for (const [key, label, max] of [
    ['enemyIds', 'enemy picks', 5], ['allyIds', 'ally picks', 4], ['blockedIds', 'unavailable heroes', heroes.size],
    ['candidateIds', 'guided picks', heroes.size],
  ]) {
    if (key === 'candidateIds' && options[key] === null) continue;
    if (!Array.isArray(options[key]) || options[key].some((id) => !heroes.has(id))) {
      throw new RangeError(`Select valid heroes for ${label}.`);
    }
    const unique = [...new Set(options[key])];
    if (unique.length > max) throw new RangeError(`Select up to ${max} ${label}.`);
    options[key] = unique;
  }
  if (options.allyIds.some((id) => options.enemyIds.includes(id))) {
    throw new RangeError('A revealed hero can belong to only one team.');
  }
  return options;
}

function stageFor(enemyCount) {
  if (enemyCount === 5) return {
    key: 'counterpick',
    label: 'Full enemy lineup',
    advice: 'Compare the completed draft and adapt the purchase path for the hero you intend to play.',
  };
  if (enemyCount === 0) return {
    key: 'blind',
    label: 'Blind pick',
    advice: 'Favor a role fit you play well. A hero observed in multiple positions can keep your team’s lanes flexible.',
  };
  if (enemyCount <= 2) return {
    key: 'early-response',
    label: 'Early response',
    advice: 'Use the revealed matchups to check your lane plan. Preserve flexibility while enemy roles and the rest of their draft are uncertain.',
  };
  return {
    key: 'counterpick',
    label: 'Counterpick window',
    advice: 'Check the lane matchup, then compare the enemy threats your team still needs to cover. Several revealed enemies contribute individual matchup signals.',
  };
}

function collectDraftEvidence(snapshot, options) {
  const totals = new Map();
  const roleTotals = new Map(LEGEND_ROLES.map(({ key }) => [key, new Map()]));
  const byEnemy = new Map(options.enemyIds.map((id) => [id, new Map()]));
  const coverage = { legendMatches: 0, teamMatches: 0, roleMatches: 0, rolePicks: 0 };
  for (const teams of rankMatchTeams(snapshot, options.rankTier)) {
    coverage.legendMatches += 1;
    if (!teams) continue;
    coverage.teamMatches += 1;
    const players = teams.flat();
    if (players.some(({ role }) => role === options.role)) coverage.roleMatches += 1;
    for (const { heroId, won, role } of players) {
      addMatchResult(totals, heroId, won);
      if (roleTotals.has(role)) addMatchResult(roleTotals.get(role), heroId, won);
      if (role === options.role) coverage.rolePicks += 1;
    }
    for (const [side, opponents] of [[teams[0], teams[1]], [teams[1], teams[0]]]) {
      for (const { heroId: enemyId } of opponents) {
        const matchups = byEnemy.get(enemyId);
        if (!matchups) continue;
        for (const { heroId, won, role } of side) {
          const tally = addMatchResult(matchups, heroId, won);
          if (role === options.role) {
            tally.roleGames = (tally.roleGames ?? 0) + 1;
            tally.roleWins = (tally.roleWins ?? 0) + Number(won);
          }
        }
      }
    }
  }
  return { totals, roleTotals, byEnemy, coverage };
}

function matchupFor(heroId, enemy, totals, enemyTallies) {
  const tally = enemyTallies.get(heroId);
  const { roleGames = 0, roleWins = 0 } = tally ?? {};
  return { ...matchupEvidence(enemy, totals, tally), roleGames, roleWins };
}

export function buildDraftGuide(heroes, snapshot, input = {}) {
  const heroById = new Map([...heroes].map((hero) => [hero.id, hero]));
  const options = draftOptions(input, heroById);
  const { totals, roleTotals, byEnemy, coverage } = collectDraftEvidence(snapshot, options);
  const unavailable = new Set([...options.enemyIds, ...options.allyIds, ...options.blockedIds]);
  const role = roleByKey.get(options.role);
  const stage = stageFor(options.enemyIds.length);
  const qualified = [];
  const candidates = options.candidateIds ?? [...heroById.keys()];
  for (const heroId of candidates) {
    const hero = heroById.get(heroId);
    const { games: rolePicks = 0, wins: roleWins = 0 } = roleTotals.get(role.key).get(heroId) ?? {};
    if (rolePicks < options.minRolePicks || unavailable.has(heroId)) continue;
    const total = totals.get(heroId) ?? { games: 0, wins: 0 };
    const adjustedWinRate = shrinkWinRate(total);
    const otherGamesRate = shrinkWinRate({
      games: total.games - rolePicks,
      wins: total.wins - roleWins,
    });
    const roleBaseline = shrinkWinRate({ games: rolePicks, wins: roleWins }, otherGamesRate, rolePriorGames);
    const flexRoles = LEGEND_ROLES.flatMap((entry) => {
      const picks = roleTotals.get(entry.key).get(heroId)?.games ?? 0;
      return picks ? [{ ...entry, picks }] : [];
    });
    const matchups = options.enemyIds.map((id) => matchupFor(heroId, heroById.get(id), total, byEnemy.get(id)));
    const matchupDelta = matchups.reduce((sum, { delta }) => sum + (delta ?? 0), 0) / Math.max(1, matchups.length);
    const additionalRoles = flexRoles.filter(({ key, picks }) => key !== role.key && picks >= 2).length;
    const flexBonus = stage.key === 'blind'
      ? Math.min(maxBlindFlexBonus, additionalRoles * blindFlexBonusPerRole) : 0;
    qualified.push({
      hero: { id: hero.id, key: hero.key, name: hero.name },
      score: roleBaseline + matchupDelta + flexBonus,
      roleBaseline,
      allRole: { ...total, winRate: total.games ? total.wins / total.games : null, adjustedWinRate },
      rolePicks, roleWins, flexRoles, flexBonus, matchups, matchupDelta,
    });
  }
  qualified.sort((a, b) => Number(b.rolePicks > 0) - Number(a.rolePicks > 0)
    || b.score - a.score || b.rolePicks - a.rolePicks
    || b.allRole.games - a.allRole.games || a.hero.id - b.hero.id);
  const observedEligibleHeroes = qualified.filter(({ rolePicks }) => rolePicks > 0).length;
  return {
    options, role, stage,
    coverage: {
      ...coverage,
      eligibleHeroes: qualified.length,
      observedEligibleHeroes,
      provisionalHeroes: qualified.length - observedEligibleHeroes,
    },
    rows: qualified.slice(0, options.limit).map((entry, index) => ({ rank: index + 1, ...entry })),
    assumptions: [
      'Matchup evidence pools all positions in Legend-average Ranked All Pick games. Enemy pairs come from opposite teams. Hero eligibility and role counts use the inferred replay positions.',
      'The role baseline blends observed role wins with the hero’s remaining matches. The broader rate includes 40 prior games at an even win rate and the role blend uses a 24-game prior.',
      'Each enemy adjustment compares games against that hero with all other games for the same pick. The pair receives a 25-game prior at the comparison rate.',
      'The score adds the mean of the individual enemy adjustments to the role baseline. Unobserved pairs contribute zero. The score does not estimate the win rate against the full lineup.',
      'Blind picks get a 0.5 point bonus per other role with at least two replay picks, capped at 1.5 points. Already picked and unavailable heroes are removed from the candidate list.',
      'Guided picks with zero replays in this position use all-position evidence and appear after heroes observed in the selected role.',
    ],
  };
}
