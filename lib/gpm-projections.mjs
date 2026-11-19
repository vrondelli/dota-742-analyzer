import { createDpsBudgetAnalyzer } from './build-efficiency.mjs';
import { LEGEND_ROLES } from './role-builds.mjs';

export const GPM_PROJECTION_DEFAULTS = Object.freeze({
  rankTier: 5,
  role: 'all',
  targetMinute: 20,
  level: 12,
  reserveGold: 1500,
  targetArmor: 10,
  maxItems: 2,
  limit: 20,
  patchConfidence: 'all',
});

const FARM_SCENARIOS = Object.freeze([
  { key: 'bad', label: 'Bad game', quantile: 0.25 },
  { key: 'good', label: 'Good game', quantile: 0.50 },
  { key: 'easy', label: 'Easy game', quantile: 0.85 },
]);

function validatedOptions(input) {
  const options = Object.fromEntries(Object.entries(GPM_PROJECTION_DEFAULTS)
    .map(([key, fallback]) => [key, input[key] ?? fallback]));
  if (options.rankTier !== 5) throw new RangeError('The projection uses the Legend average match bracket.');
  if (options.role !== 'all' && !LEGEND_ROLES.some(({ key }) => key === options.role)) {
    throw new RangeError('Select all observed roles or one Legend role.');
  }
  for (const [key, min, max] of [
    ['targetMinute', 1, 90], ['level', 1, 30], ['reserveGold', 0, 100_000],
    ['maxItems', 1, 2], ['limit', 1, 20],
  ]) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) {
      throw new RangeError(`${key} must be an integer between ${min} and ${max}.`);
    }
  }
  if (!Number.isFinite(options.targetArmor) || options.targetArmor < -300 || options.targetArmor > 300) {
    throw new RangeError('Target armor must be between -300 and 300.');
  }
  if (options.patchConfidence !== 'all' && options.patchConfidence !== 'verified') {
    throw new RangeError('Select all patch observations or replay-confirmed matches.');
  }
  return options;
}

function goldAtMinute(timeline, minute) {
  if (!Array.isArray(timeline) || !Number.isFinite(timeline[0]) || !Number.isFinite(timeline[minute])) return null;
  const gained = timeline[minute] - timeline[0];
  return gained >= 0 ? gained : null;
}

function gatherEvidence(snapshot, options) {
  const selectedRoles = LEGEND_ROLES.filter(({ key }) => options.role === 'all' || key === options.role);
  const roles = selectedRoles.map((role) => ({ ...role, heroes: new Map(), rolePicks: 0, timeline: [], gpm: [] }));
  const byRole = new Map(roles.map((role) => [role.key, role]));
  let legendMatches = 0;
  let roleMatches = 0;
  for (const match of snapshot.matches) {
    if (match.rankTier !== options.rankTier
      || (options.patchConfidence === 'verified' && match.patchConfidence !== 'verified')) continue;
    legendMatches += 1;
    let observedRole = false;
    const reachedMinute = match.duration >= options.targetMinute * 60;
    for (const player of match.players) {
      const role = byRole.get(player.role);
      if (!role || !Number.isInteger(player.heroId) || player.heroId < 1) continue;
      observedRole = true;
      role.rolePicks += 1;
      const history = role.heroes.get(player.heroId) ?? { picks: 0, wins: 0 };
      history.picks += 1;
      history.wins += Number(player.won === true);
      role.heroes.set(player.heroId, history);
      if (!reachedMinute) continue;
      const earned = goldAtMinute(player.goldTimeline, options.targetMinute);
      if (earned !== null) role.timeline.push(earned);
      if (Number.isFinite(player.gpm) && player.gpm > 0) role.gpm.push(player.gpm);
    }
    if (observedRole) roleMatches += 1;
  }
  return { roles, legendMatches, roleMatches };
}

function percentile(sorted, probability) {
  const index = (sorted.length - 1) * probability;
  const left = Math.floor(index);
  const right = Math.ceil(index);
  return sorted[left] + (sorted[right] - sorted[left]) * (index - left);
}

function roleBudgets(role, options) {
  const usesTimeline = role.timeline.length > 0;
  const observations = (usesTimeline ? role.timeline : role.gpm).sort((a, b) => a - b);
  const basis = usesTimeline ? 'gold-timeline' : observations.length ? 'full-match-gpm' : 'unavailable';
  const scenarios = observations.length ? FARM_SCENARIOS.map((scenario) => {
    const value = percentile(observations, scenario.quantile);
    const gpm = usesTimeline ? value / options.targetMinute : value;
    const earnedGold = Math.floor(usesTimeline ? value : value * options.targetMinute);
    return {
      ...scenario, basis, gpm, earnedGold,
      sampleSize: observations.length,
      budget: Math.max(0, earnedGold - options.reserveGold),
    };
  }) : [];
  return {
    key: role.key,
    label: role.label,
    rolePicks: role.rolePicks,
    roleHeroes: role.heroes.size,
    timelinePicks: role.timeline.length,
    gpmPicks: role.gpm.length,
    basis,
    scenarios,
  };
}

function conciseItem({ id, key, name, cost }) {
  return { id, key, name, cost };
}

function compareProjections(a, b) {
  return b.averageDps - a.averageDps || b.scenarios[1].dps - a.scenarios[1].dps
    || b.replayPicks - a.replayPicks || a.hero.id - b.hero.id;
}

function projectionEconomy(snapshot, input) {
  const options = validatedOptions(input);
  const evidence = gatherEvidence(snapshot, options);
  const roles = evidence.roles.map((role) => roleBudgets(role, options));
  return { options, evidence, roles };
}

export function projectGpmEconomy(snapshot, input = {}) {
  const { options, roles } = projectionEconomy(snapshot, input);
  return { options, roles };
}

export function analyzeGpmProjections(heroes, items, snapshot, input = {}) {
  const { options, evidence, roles } = projectionEconomy(snapshot, input);
  const activeRoles = roles
    .map((role, index) => ({ ...role, heroes: evidence.roles[index].heroes }))
    .filter(({ scenarios }) => scenarios.length);
  const caps = activeRoles.flatMap(({ scenarios }) => scenarios.map(({ budget }) => budget));
  const analyzeDps = createDpsBudgetAnalyzer(items, caps, options);
  const projections = [];
  let eligibleHeroes = 0;
  for (const hero of heroes) {
    if (!evidence.roles.some(({ heroes: observed }) => observed.has(hero.id))) continue;
    eligibleHeroes += 1;
    const observedRoles = activeRoles.filter(({ heroes: observed }) => observed.has(hero.id));
    if (!observedRoles.length) continue;
    const { baselineDps, builds } = analyzeDps(hero);
    if (!Number.isFinite(baselineDps)) continue;
    const candidates = observedRoles.map((role) => {
      const observed = role.heroes.get(hero.id);
      const scenarios = role.scenarios.map((scenario) => {
        const build = builds.get(scenario.budget);
        return {
          ...scenario, ...build,
          items: build.items.map(conciseItem),
          unspent: scenario.budget - build.spent,
        };
      });
      return {
        hero: { id: hero.id, key: hero.key, name: hero.name },
        role: role.key,
        roleLabel: role.label,
        replayPicks: observed.picks,
        replayWins: observed.wins,
        averageDps: scenarios.reduce((total, { dps }) => total + dps, 0) / scenarios.length,
        baselineDps,
        scenarios,
      };
    });
    projections.push(candidates.sort(compareProjections)[0]);
  }

  const rows = projections.sort(compareProjections).slice(0, options.limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    options,
    coverage: {
      legendMatches: evidence.legendMatches,
      roleMatches: evidence.roleMatches,
      rolePicks: roles.reduce((total, role) => total + role.rolePicks, 0),
      gpmPicks: roles.reduce((total, role) => total + role.gpmPicks, 0),
      timelinePicks: roles.reduce((total, role) => total + role.timelinePicks, 0),
      eligibleHeroes,
      scoredHeroes: projections.length,
      returnedHeroes: rows.length,
    },
    roles,
    rows,
    assumptions: [
      'Bad, good, and easy describe the 25th, 50th, and 85th percentiles of observed role farm. Replay outcomes do not enter the damage score.',
      'Only games reaching the selected minute supply economy observations. Sample counts are shown alongside each role.',
      'Budget equals projected gross gold earned minus a reserve for other spending. The calculation adds no separate starting gold. Available gold during an actual match also depends on earlier spending and losses.',
      'A role uses selected-minute earned gold where available. Full-match GPM times the selected minute supplies a fallback when the role has no timeline samples.',
      'The model maximizes sustained physical damage against one fixed-armor target, using up to the selected number of distinct shop items. Hero abilities, missed attacks, target access, survival, and upgrade timing are outside this score.',
      'Ranks use equal-weight mean DPS across the three scenarios. An all-role comparison uses each hero’s highest-scoring observed role. The role-specific budgets can differ substantially.',
    ],
  };
}
