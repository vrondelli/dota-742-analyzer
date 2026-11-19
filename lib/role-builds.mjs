import { BUILD_DEFAULTS, createBuildBandAnalyzer, getModeledAbility } from './build-efficiency.mjs';

export const LEGEND_ROLES = Object.freeze([
  Object.freeze({ key: 'carry', label: 'Carry' }),
  Object.freeze({ key: 'mid', label: 'Mid' }),
  Object.freeze({ key: 'offlane', label: 'Offlane' }),
  Object.freeze({ key: 'soft-support', label: 'Soft Support' }),
  Object.freeze({ key: 'hard-support', label: 'Hard Support' }),
]);

export const ROLE_BUILD_DEFAULTS = Object.freeze({
  ...BUILD_DEFAULTS,
  budgets: Object.freeze([1000, 3000, 5000]),
  rankTier: 5,
  limit: 10,
  includeRoster: true,
  minReplayPicks: 1,
  coverage: 'all',
  patchConfidence: 'all',
});

function validatedControls(input) {
  const {
    budgets = ROLE_BUILD_DEFAULTS.budgets,
    rankTier = ROLE_BUILD_DEFAULTS.rankTier,
    limit = ROLE_BUILD_DEFAULTS.limit,
    includeRoster = ROLE_BUILD_DEFAULTS.includeRoster,
    minReplayPicks = ROLE_BUILD_DEFAULTS.minReplayPicks,
    coverage = ROLE_BUILD_DEFAULTS.coverage,
    patchConfidence = ROLE_BUILD_DEFAULTS.patchConfidence,
    spells = [],
    ...scenario
  } = input;
  if (!Array.isArray(budgets) || budgets.length === 0 || budgets.length > 5
    || !budgets.every((value, index) => Number.isInteger(value)
      && value > (budgets[index - 1] ?? 0) && value <= 100_000)) {
    throw new RangeError('Use up to five increasing positive integer budget ceilings.');
  }
  if (rankTier !== 5) throw new RangeError('The role boards use the Legend average match bracket.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 127) throw new RangeError('Show between 1 and 127 rows per band.');
  if (!Number.isInteger(minReplayPicks) || minReplayPicks < 1) {
    throw new RangeError('Minimum replay picks must be a positive integer.');
  }
  if (typeof includeRoster !== 'boolean') throw new TypeError('Roster inclusion must be boolean.');
  if (coverage !== 'all' && coverage !== 'flat') throw new RangeError('Select a supported model coverage filter.');
  if (patchConfidence !== 'all' && patchConfidence !== 'verified') {
    throw new RangeError('Select all patch observations or replay-confirmed matches.');
  }
  return { budgets, rankTier, limit, includeRoster, minReplayPicks, coverage, patchConfidence, spells, scenario };
}

function addPick(tallies, player) {
  const row = tallies.get(player.heroId) ?? { picks: 0, wins: 0 };
  row.picks += 1;
  row.wins += Number(player.won === true);
  tallies.set(player.heroId, row);
}

function replayEvidence(snapshot, { rankTier, patchConfidence }) {
  const roles = new Map(LEGEND_ROLES.map(({ key }) => [key, { matches: 0, picks: 0, heroes: new Map() }]));
  const allRoles = { matches: 0, picks: 0, heroes: new Map() };
  let legendMatches = 0;
  for (const match of snapshot.matches) {
    if (match.rankTier !== rankTier || (patchConfidence === 'verified' && match.patchConfidence !== 'verified')) {
      continue;
    }
    legendMatches += 1;
    const recordedRoles = new Set();
    for (const player of match.players) {
      const role = roles.get(player.role);
      if (!role || !Number.isInteger(player.heroId) || player.heroId < 1) continue;
      recordedRoles.add(player.role);
      role.picks += 1;
      allRoles.picks += 1;
      addPick(role.heroes, player);
      addPick(allRoles.heroes, player);
    }
    for (const key of recordedRoles) roles.get(key).matches += 1;
    if (recordedRoles.size) allRoles.matches += 1;
  }
  return { roles, allRoles, legendMatches };
}

function learnedSpell(spells, level) {
  let best = null;
  for (const { key, name, damageByRank, rankUnlockLevels: unlockLevels } of spells) {
    if (!Array.isArray(unlockLevels) || !Array.isArray(damageByRank)) continue;
    const rank = unlockLevels.findLastIndex((requiredLevel) => requiredLevel <= level) + 1;
    const damage = damageByRank[rank - 1];
    if (Number.isFinite(damage) && damage > (best?.damage ?? 0)) best = { key, name, rank, damage };
  }
  return best;
}

function conciseItem({ id, key, name, cost }) {
  return { id, key, name, cost };
}

function rankBuilds(rows, limit) {
  rows.sort((a, b) => b.gainPer1000 - a.gainPer1000 || b.gain - a.gain
    || b.total - a.total || a.cost - b.cost || a.hero.id - b.hero.id);
  let rank = 0;
  return rows.slice(0, limit).map((row, index) => {
    const prior = rows[index - 1];
    if (!prior || Math.abs(row.gainPer1000 - prior.gainPer1000) > 1e-9
      || Math.abs(row.gain - prior.gain) > 1e-9 || Math.abs(row.total - prior.total) > 1e-9
      || row.cost !== prior.cost) rank = index + 1;
    return { ...row, rank };
  });
}

function board(role, evidence, modeled, controls, isRoster = false) {
  const eligible = isRoster ? modeled : modeled.filter(({ hero }) =>
    (evidence.heroes.get(hero.id)?.picks ?? 0) >= controls.minReplayPicks);
  const bands = controls.budgets.map((maxSpend, index) => {
    const minSpend = (controls.budgets[index - 1] ?? 0) + 1;
    const supported = [];
    const itemOnly = [];
    for (const { hero, bands: heroBands, spell, itemOnlyMagic } of eligible) {
      const replay = evidence.heroes.get(hero.id);
      const result = heroBands[index];
      const builds = Array.isArray(result) ? result : result ? [result] : [];
      for (const build of builds) {
        const row = {
          ...build,
          hero,
          items: build.items.map(conciseItem),
          replayPicks: replay?.picks ?? 0,
          replayWins: replay?.wins ?? 0,
          spell,
        };
        (itemOnlyMagic ? itemOnly : supported).push(row);
      }
    }
    return {
      minSpend,
      maxSpend,
      eligibleHeroes: new Set(supported.map(({ hero }) => hero.id)).size,
      itemOnlyHeroes: itemOnly.length,
      rows: rankBuilds(supported, controls.limit),
      itemOnlyRows: rankBuilds(itemOnly, controls.limit),
    };
  });
  return {
    key: role.key,
    label: role.label,
    replayMatches: evidence.matches,
    replayPicks: evidence.picks,
    replayHeroes: evidence.heroes.size,
    eligibleRoleHeroes: eligible.length,
    bands,
  };
}

export function analyzeRoleBuilds(heroes, items, snapshot, input = {}) {
  const controls = validatedControls(input);
  const { options: scenario, analyze } = createBuildBandAnalyzer(items, controls.budgets, {
    ...controls.scenario,
    baseSpellDamage: 0,
    coverage: controls.coverage,
  });
  const isMagic = scenario.metric === 'magicalDamage';
  const isAbility = scenario.metric === 'abilityDamage';
  const spellsByHero = new Map(controls.spells.map(({ id, heroId, spells }) => [id ?? heroId, spells]));
  const evidence = replayEvidence(snapshot, controls);
  const supportedHeroes = isAbility
    ? heroes.filter(({ id }) => getModeledAbility(id, scenario.level))
    : heroes;
  const modeled = supportedHeroes.map((hero) => {
    const { id, key, name } = hero;
    const spell = isMagic ? learnedSpell(spellsByHero.get(id) ?? [], scenario.level) : null;
    return {
      hero: { id, key, name },
      spell,
      itemOnlyMagic: isMagic && spell === null,
      bands: analyze(hero, spell?.damage ?? 0),
    };
  });
  const { budgets, rankTier, limit, includeRoster, minReplayPicks, coverage, patchConfidence } = controls;
  return {
    options: { ...scenario, budgets, rankTier, limit, includeRoster, minReplayPicks, coverage, patchConfidence },
    coverage: {
      legendMatches: evidence.legendMatches,
      replayMatches: evidence.allRoles.matches,
      replayPicks: evidence.allRoles.picks,
      heroCount: heroes.length,
      spellHeroCount: isMagic ? modeled.filter((entry) => entry.spell).length : null,
      ...(isAbility ? { abilityHeroCount: modeled.length } : {}),
    },
    roles: LEGEND_ROLES.map((role) => board(role, evidence.roles.get(role.key), modeled, controls)),
    roster: includeRoster
      ? board({ key: 'roster', label: 'All heroes' }, evidence.allRoles, modeled, controls, true)
      : null,
  };
}
