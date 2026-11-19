import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { getHeroRankings, getItemRankings, PURCHASE_WINDOWS } from './lib/analytics.mjs';
import { ABILITY_BUILD_METRIC, analyzeBuilds, BUILD_DEFAULTS, BUILD_METRICS } from './lib/build-efficiency.mjs';
import { GPM_PROJECTION_DEFAULTS, projectGpmEconomy } from './lib/gpm-projections.mjs';
import { buildItemPotencyComparison } from './lib/item-potency.mjs';
import { ROLE_BUILD_DEFAULTS } from './lib/role-builds.mjs';
import { buildDraftGuide, DRAFT_GUIDE_DEFAULTS } from './lib/draft-guide.mjs';
import { DRAFT_CONDITIONS, priceDraftPlan } from './lib/draft-plans.mjs';
import { ROLE_IMPACT_KEYS, prepareImpactRubric, scoreRoleImpact } from './lib/role-impact.mjs';
import { getHeroMatchups } from './lib/hero-matchups.mjs';
import { buildHeroFarm } from './lib/hero-farm.mjs';

const patch = '7.42';
const dataDirectory = new URL(`./data/${patch}/`, import.meta.url);
const snapshotPath = process.env.DOTA_MATCH_SNAPSHOT
  ? resolve(process.env.DOTA_MATCH_SNAPSHOT)
  : fileURLToPath(new URL('matches.json', dataDirectory));
const patchIndex = await readJson(new URL('patch-index.json', dataDirectory));
const mechanics = await readJson(new URL('mechanics-seed.json', dataDirectory));
const shop = await readJson(new URL('shop-items.json', dataDirectory));
const roleRankings = await readJson(new URL('role-rankings.json', dataDirectory));
const catalog = new Map(shop.items.map((item) => [item.key, item]));
const heroes = patchIndex.heroes
  .filter((hero) => hero.key && hero.name)
  .map((hero) => ({
    id: hero.id,
    key: hero.key,
    name: hero.name,
    slug: hero.key.replace(/^npc_dota_hero_/, ''),
    notes: {
      hero: hero.hero_note_count,
      talent: hero.talent_note_count,
      abilityChanges: hero.changed_ability_ids.length,
    },
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const heroesById = new Map(heroes.map((hero) => [hero.id, hero]));
const heroesBySlug = new Map(heroes.map((hero) => [hero.slug, hero]));
const heroSlugs = Object.fromEntries(heroes.map(({ id, slug }) => [id, slug]));
const roles = [
  { key: 'all', label: 'All roles' },
  { key: 'carry', label: 'Carry' },
  { key: 'mid', label: 'Mid' },
  { key: 'offlane', label: 'Offlane' },
  { key: 'soft-support', label: 'Soft Support' },
  { key: 'hard-support', label: 'Hard Support' },
  { key: 'unknown', label: 'Unknown' },
];
const rankedRoles = roles.filter(({ key }) => key !== 'all' && key !== 'unknown');
const hasRankedRole = ({ key }) => {
  const rankings = roleRankings.roles?.[key]?.rankings;
  return Array.isArray(rankings) && rankings.length === 20;
};
if (roleRankings.patch !== patch || !rankedRoles.every(hasRankedRole)) {
  throw new Error(`Expected five top-20 role rankings for patch ${patch}.`);
}
const rankTiers = [
  { key: 'all', label: 'All ranks' },
  ...['Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine / top estimate']
    .map((label, index) => ({ key: String(index + 1), label })),
  { key: 'unknown', label: 'Unknown' },
];
const sources = {
  patch: 'https://www.dota2.com/patches/7.42',
  match: 'https://docs.opendota.com/',
  client: `https://github.com/SteamTracking/GameTracking-Dota2/commit/${patchIndex.client.commit}`,
};
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/efficiency', ['efficiency.html', 'text/html; charset=utf-8']],
  ['/efficiency.html', ['efficiency.html', 'text/html; charset=utf-8']],
  ['/efficiency.css', ['efficiency.css', 'text/css; charset=utf-8']],
  ['/efficiency.js', ['efficiency.js', 'text/javascript; charset=utf-8']],
  ['/legend-builds', ['legend-builds.html', 'text/html; charset=utf-8']],
  ['/legend-builds.css', ['legend-builds.css', 'text/css; charset=utf-8']],
  ['/legend-builds.js', ['legend-builds.js', 'text/javascript; charset=utf-8']],
  ['/gpm-builds', ['gpm-builds.html', 'text/html; charset=utf-8']],
  ['/gpm-builds.css', ['gpm-builds.css', 'text/css; charset=utf-8']],
  ['/gpm-builds.js', ['gpm-builds.js', 'text/javascript; charset=utf-8']],
  ['/draft-guide', ['draft-guide.html', 'text/html; charset=utf-8']],
  ['/draft-guide.css', ['draft-guide.css', 'text/css; charset=utf-8']],
  ['/draft-guide.js', ['draft-guide.js', 'text/javascript; charset=utf-8']],
  ['/role-rankings', ['role-rankings.html', 'text/html; charset=utf-8']],
  ['/role-rankings.css', ['role-rankings.css', 'text/css; charset=utf-8']],
  ['/role-rankings.js', ['role-rankings.js', 'text/javascript; charset=utf-8']],
  ['/hero', ['hero.html', 'text/html; charset=utf-8']],
  ['/hero.css', ['hero.css', 'text/css; charset=utf-8']],
  ['/hero.js', ['hero.js', 'text/javascript; charset=utf-8']],
]);
const emptySnapshot = { patch, fetchedAt: null, source: 'OpenDota', matches: [] };
let snapshotCache;
let buildData;
let heroProfileEvidence;
let currentProjectionSnapshot;
const projectionCache = new Map();
let projectionQueue = Promise.resolve();
const leaderboardMetrics = [
  ...BUILD_METRICS.filter(({ key }) => ['physicalDps', 'magicalDamage'].includes(key)),
  ABILITY_BUILD_METRIC,
];

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

async function loadSnapshot() {
  let details;
  try {
    details = await stat(snapshotPath);
  } catch (error) {
    if (error.code === 'ENOENT') return emptySnapshot;
    throw error;
  }
  const signature = `${details.mtimeMs}/${details.size}`;
  if (snapshotCache?.signature !== signature) {
    const snapshot = await readJson(snapshotPath);
    if (snapshot.patch !== patch || !Array.isArray(snapshot.matches)) {
      throw new Error(`Expected a ${patch} match snapshot in ${snapshotPath}`);
    }
    snapshotCache = { signature, snapshot };
  }
  return snapshotCache.snapshot;
}

async function loadBuildData() {
  if (buildData) return buildData;
  const [heroData, itemData] = await Promise.all([
    readJson(new URL('hero-dps.json', dataDirectory)),
    readJson(new URL('item-mechanics.json', dataDirectory)),
  ]);
  if (heroData.patch !== patch || itemData.patch !== patch
    || !Array.isArray(heroData.heroes) || !Array.isArray(itemData.items)) {
    throw new Error(`Expected build mechanics for patch ${patch}.`);
  }
  buildData = { heroes: new Map(heroData.heroes.map((hero) => [hero.id, hero])), items: itemData.items };
  return buildData;
}

function readBuildOptions(query, metrics = BUILD_METRICS) {
  const options = {};
  for (const field of [
    'level', 'budget', 'maxItems', 'targetArmor', 'targetMagicResistance',
    'baseSpellDamage', 'windowSeconds', 'ownArmor', 'ownMagicResistance', 'ownHealth',
  ]) {
    const value = query.get(field);
    if (value === null || value === '') continue;
    if (!Number.isFinite(Number(value))) throw new RangeError(`Invalid ${field}.`);
    options[field] = Number(value);
  }
  for (const field of ['includeActives', 'includeOnHit', 'includeAuras']) {
    const value = query.get(field);
    if (value === null) continue;
    if (!['true', 'false'].includes(value)) throw new RangeError(`Invalid ${field}.`);
    options[field] = value === 'true';
  }
  const metric = query.get('metric');
  if (metric !== null) {
    if (!metrics.some((entry) => entry.key === metric)) throw new RangeError('Select a supported metric.');
    options.metric = metric;
  }
  const itemKeys = query.getAll('itemKey');
  if (itemKeys.length) options.itemKeys = itemKeys;
  return options;
}

async function handleBuildRequest(url, response) {
  const data = await loadBuildData();
  if (url.pathname === '/api/efficiency/meta') {
    return sendJson(response, 200, {
      patch,
      heroes,
      metrics: BUILD_METRICS,
      defaults: { ...BUILD_DEFAULTS, heroId: 8 },
      items: data.items.map(({ id, key, name, cost, coverage }) => ({ id, key, name, cost, coverage })),
      sources,
    });
  }
  const query = url.searchParams;
  const hero = data.heroes.get(positiveInt(query.get('heroId')) ?? 8);
  if (!hero) return sendJson(response, 400, { error: 'Select a hero from the 7.42 roster.' });
  try {
    const options = readBuildOptions(query);
    const result = analyzeBuilds(hero, data.items, options);
    const rows = query.get('sort') === 'efficiency'
      ? [...result.rows].sort((a, b) => (b.gainPer1000 ?? -Infinity) - (a.gainPer1000 ?? -Infinity)
        || (b.gain ?? -Infinity) - (a.gain ?? -Infinity) || a.cost - b.cost)
      : result.rows;
    const limit = Math.min(100, positiveInt(query.get('limit')) ?? 40);
    const offset = positiveInt(query.get('offset')) ?? 0;
    const frontier = result.rows.filter((row) => row.frontier && row.gain > 0).map((row) => ({
      cost: row.cost,
      gain: row.gain,
      gainPer1000: row.gainPer1000,
      label: row.items.map((item) => item.name).join(' + '),
    })).sort((a, b) => a.cost - b.cost);
    return sendJson(response, 200, {
      ...result,
      frontier,
      totalRows: rows.length,
      rows: rows.slice(offset, offset + limit),
    });
  } catch (error) {
    if (error instanceof RangeError) return sendJson(response, 400, { error: error.message });
    throw error;
  }
}

function readLeaderboardOptions(query) {
  const scenario = readBuildOptions(query, leaderboardMetrics);
  const metric = scenario.metric ?? ROLE_BUILD_DEFAULTS.metric;
  const budgets = query.get('budgets');
  if (budgets !== null && !/^\d+(,\d+){0,4}$/.test(budgets)) {
    throw new RangeError('Enter up to five gold ceilings separated by commas.');
  }
  return {
    metric,
    level: scenario.level ?? ROLE_BUILD_DEFAULTS.level,
    maxItems: scenario.maxItems ?? ROLE_BUILD_DEFAULTS.maxItems,
    ...(budgets === null ? {} : { budgets: budgets.split(',').map(Number) }),
    ...(scenario.targetArmor === undefined ? {} : { targetArmor: scenario.targetArmor }),
    ...(scenario.targetMagicResistance === undefined ? {} : { targetMagicResistance: scenario.targetMagicResistance }),
    ...(scenario.windowSeconds === undefined ? {} : { windowSeconds: scenario.windowSeconds }),
    ...(scenario.includeOnHit === undefined ? {} : { includeOnHit: scenario.includeOnHit }),
    ...(query.has('minReplayPicks') ? { minReplayPicks: Number(query.get('minReplayPicks')) } : {}),
    ...(query.has('coverage') ? { coverage: query.get('coverage') } : {}),
    limit: Math.min(127, positiveInt(query.get('limit')) ?? ROLE_BUILD_DEFAULTS.limit),
  };
}

async function evaluateProjection(snapshot, options, kind) {
  const data = await loadBuildData();
  const evidence = {
    patch: snapshot.patch,
    matches: snapshot.matches.filter((match) => match.rankTier === 5).map((match) => ({
      id: match.id,
      rankTier: match.rankTier,
      patchConfidence: match.patchConfidence,
      duration: match.duration,
      players: match.players.filter(({ role }) => role !== 'unknown').map(({ heroId, role, won, gpm, goldTimeline }) => ({
        heroId, role, won, ...(kind === 'gpm' ? { gpm, goldTimeline } : {}),
      })),
    })),
  };
  return new Promise((accept, reject) => {
    const worker = new Worker(new URL('./workers/legend-builds.mjs', import.meta.url), {
      workerData: { kind, heroes: [...data.heroes.values()], items: data.items, snapshot: evidence, options },
    });
    worker.once('message', ({ result, error, invalidScenario }) => {
      if (error) reject(invalidScenario ? new RangeError(error) : new Error(error));
      else accept(result);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`Projection worker exited before returning a result (${code}).`)));
  });
}

function cachedProjection(snapshot, options, kind) {
  if (snapshot !== currentProjectionSnapshot) {
    projectionCache.clear();
    currentProjectionSnapshot = snapshot;
  }
  const key = `${kind}/${JSON.stringify(options)}`;
  if (projectionCache.has(key)) {
    const job = projectionCache.get(key);
    projectionCache.delete(key);
    projectionCache.set(key, job);
    return job;
  }
  const job = projectionQueue.then(() => evaluateProjection(snapshot, options, kind));
  projectionQueue = job.catch(() => undefined);
  projectionCache.set(key, job);
  if (projectionCache.size > 6) projectionCache.delete(projectionCache.keys().next().value);
  job.catch(() => {
    if (projectionCache.get(key) === job) projectionCache.delete(key);
  });
  return job;
}

async function legendAbilityInteractions(snapshot) {
  const map = await readJson(new URL('ability-interactions.json', dataDirectory));
  if (map.patch !== patch || !Array.isArray(map.interactions)) {
    throw new Error('The ability interaction map does not match the selected patch.');
  }
  const rolePicksByHero = new Map(map.interactions.map(({ heroId }) => [heroId, {}]));
  const legendRoles = new Set(roles.filter(({ key }) => key !== 'all' && key !== 'unknown').map(({ key }) => key));
  for (const match of snapshot.matches) {
    if (match.rankTier !== 5) continue;
    for (const { heroId, role } of match.players) {
      const picks = rolePicksByHero.get(heroId);
      if (picks && legendRoles.has(role)) picks[role] = (picks[role] ?? 0) + 1;
    }
  }
  return map.interactions.map((entry) => ({
    ...entry,
    rolePicks: rolePicksByHero.get(entry.heroId),
    exampleItems: (entry.exampleItemKeys ?? []).flatMap((key) => {
      const item = catalog.get(key);
      return item ? [{ key, name: item.name }] : [];
    }),
  }));
}

async function handleLeaderboard(url, response) {
  const snapshot = await loadSnapshot();
  const provenance = { patch, source: snapshot.source, fetchedAt: snapshot.fetchedAt };
  if (url.pathname === '/api/legend-builds/meta') {
    return sendJson(response, 200, {
      ...provenance,
      metrics: leaderboardMetrics,
      roles: roles.filter(({ key }) => key !== 'all' && key !== 'unknown'),
      defaults: ROLE_BUILD_DEFAULTS,
      abilityInteractions: await legendAbilityInteractions(snapshot),
    });
  }
  try {
    const options = readLeaderboardOptions(url.searchParams);
    const result = await cachedProjection(snapshot, options, 'leaderboard');
    return sendJson(response, 200, { ...result, ...provenance });
  } catch (error) {
    if (error instanceof RangeError) return sendJson(response, 400, { error: error.message });
    throw error;
  }
}

function readGpmOptions(query) {
  const role = query.get('role') ?? GPM_PROJECTION_DEFAULTS.role;
  if (!roles.some(({ key }) => key === role) || role === 'unknown') {
    throw new RangeError('Select a Legend role.');
  }
  const options = { ...GPM_PROJECTION_DEFAULTS, role };
  for (const key of ['targetMinute', 'level', 'reserveGold', 'targetArmor', 'maxItems']) {
    if (!query.has(key)) continue;
    const value = query.get(key).trim();
    if (!value || !Number.isFinite(Number(value))) throw new RangeError(`Invalid ${key}.`);
    options[key] = Number(value);
  }
  return options;
}

function sendGpmCsv(response, result, fetchedAt) {
  const labels = ['Bad', 'Good', 'Easy'];
  const header = ['Rank', 'Hero', 'Legend role', 'Role picks', 'No-item DPS', 'Mean DPS',
    'Minute', 'Hero level', 'Reserve gold', 'Target armor', 'Snapshot UTC',
    ...labels.flatMap((label) => ['GPM', 'Sample size', 'Data basis', 'Earned gold', 'Budget',
      'Items', 'Spent', 'Unspent', 'DPS'].map((name) => `${label} ${name}`)),
  ];
  const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : '';
  const rows = result.rows.map((row) => [row.rank, row.hero.name, row.roleLabel, row.replayPicks,
    round(row.baselineDps), round(row.averageDps), result.options.targetMinute, result.options.level,
    result.options.reserveGold, result.options.targetArmor, fetchedAt,
    ...row.scenarios.flatMap((scenario) => [round(scenario.gpm), scenario.sampleSize, scenario.basis,
      scenario.earnedGold, scenario.budget, scenario.items.map(({ name }) => name).join(' + '),
      scenario.spent, scenario.unspent, round(scenario.dps)]),
  ]);
  const csv = [header, ...rows].map((row) =>
    row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="dota-7.42-legend-gpm-top20.csv"',
    'Cache-Control': 'no-store',
  });
  response.end(`\uFEFF${csv}\r\n`);
}

async function handleGpmBuilds(url, response) {
  const snapshot = await loadSnapshot();
  const provenance = { patch, source: snapshot.source, fetchedAt: snapshot.fetchedAt };
  if (url.pathname === '/api/gpm-builds/meta') {
    return sendJson(response, 200, {
      ...provenance,
      defaults: GPM_PROJECTION_DEFAULTS,
      roles: roles.filter(({ key }) => key !== 'unknown').map((role) =>
        role.key === 'all' ? { ...role, label: 'All observed roles' } : role),
    });
  }
  try {
    const options = readGpmOptions(url.searchParams);
    const result = await cachedProjection(snapshot, options, 'gpm');
    if (url.pathname === '/api/gpm-builds.csv') return sendGpmCsv(response, result, snapshot.fetchedAt);
    return sendJson(response, 200, { ...result, ...provenance });
  } catch (error) {
    if (error instanceof RangeError) return sendJson(response, 400, { error: error.message });
    throw error;
  }
}

async function handleGpmContext(response) {
  const [report, data, snapshot] = await Promise.all([
    readJson(new URL('build-context.json', dataDirectory)),
    loadBuildData(),
    loadSnapshot(),
  ]);
  if (report.patch !== patch || !Array.isArray(report.notes)) {
    throw new Error(`Expected build context for patch ${patch}.`);
  }
  const itemsByKey = new Map(data.items.map(({ key, name, cost }) => [key, { key, name, cost }]));
  const rolePicks = new Map(report.notes.map(({ heroId, role }) => [`${heroId}/${role}`, 0]));
  for (const match of snapshot.matches) {
    if (match.rankTier !== GPM_PROJECTION_DEFAULTS.rankTier) continue;
    for (const { heroId, role } of match.players) {
      const key = `${heroId}/${role}`;
      if (rolePicks.has(key)) rolePicks.set(key, rolePicks.get(key) + 1);
    }
  }
  const notes = report.notes.map((note) => {
    const items = note.itemKeys.map((key) => itemsByKey.get(key));
    const exampleBuild = (note.exampleBuildKeys ?? []).map((key) => itemsByKey.get(key));
    if ([...items, ...exampleBuild].some((item) => !item)) {
      throw new Error(`Missing item data in the build context for ${note.heroName}.`);
    }
    return { ...note, items, exampleBuild, legendRolePicks: rolePicks.get(`${note.heroId}/${note.role}`) };
  });
  return sendJson(response, 200, {
    ...report,
    notes,
    potency: buildItemPotencyComparison(data.items),
  });
}

function draftIds(query, field) {
  const ids = query.getAll(field);
  if (ids.some((id) => !/^[1-9]\d*$/.test(id) || !heroesById.has(Number(id)))) {
    throw new RangeError('Select heroes from the 7.42 roster.');
  }
  return ids.map(Number);
}

function enemyConditionHints(enemyIds) {
  return DRAFT_CONDITIONS.flatMap(({ key, label, heroIds }) => {
    const matching = enemyIds.filter((id) => heroIds.includes(id));
    return matching.length ? [{ key, label, enemyIds: matching, enemies: matching.map((id) => heroesById.get(id).name) }] : [];
  });
}

async function loadImpactRoles() {
  const datasets = await Promise.all(['offlane-impact.json', 'support-impact.json']
    .map((filename) => readJson(new URL(filename, dataDirectory))));
  if (datasets.some((dataset) => dataset.patch !== patch || !Array.isArray(dataset.roles))) {
    throw new Error(`Expected role impact data for patch ${patch}.`);
  }
  return new Map(datasets.flatMap(({ roles }) => roles.map((role) => [role.key, role])));
}

async function loadDraftPlans() {
  const guide = await readJson(new URL('draft-plans.json', dataDirectory));
  if (guide.patch !== patch || !Array.isArray(guide.plans)) throw new Error(`Expected draft plans for patch ${patch}.`);
  return guide;
}

function profileEvidence(snapshot) {
  if (heroProfileEvidence?.snapshot === snapshot) return heroProfileEvidence;
  const picks = new Map(rankedRoles.map(({ key }) => [key, new Map()]));
  let roleReplayMatches = 0;
  for (const match of snapshot.matches) {
    if (match.rankTier !== 5) continue;
    let hasRole = false;
    for (const player of match.players) {
      const byHero = picks.get(player.role);
      if (!byHero) continue;
      hasRole = true;
      byHero.set(player.heroId, (byHero.get(player.heroId) ?? 0) + 1);
    }
    if (hasRole) roleReplayMatches += 1;
  }
  const economy = projectGpmEconomy(snapshot);
  heroProfileEvidence = { snapshot, picks, economy, roleReplayMatches };
  return heroProfileEvidence;
}

const exampleRoles = {
  riki: 'carry', doom_bringer: 'offlane', lycan: 'offlane', lone_druid: 'mid',
  keeper_of_the_light: 'soft-support', muerta: 'carry', largo: 'hard-support',
};

function chooseProfileRole(requestedRole, roleCards, heroPlans, slug) {
  if (requestedRole) return { role: requestedRole, roleBasis: 'selected' };
  const placed = roleCards.filter(({ rank }) => rank !== null)
    .sort((a, b) => a.rank - b.rank || b.replayPicks - a.replayPicks)[0];
  if (placed) return { role: placed.key, roleBasis: 'ranked' };
  if (heroPlans.length) return { role: heroPlans[0].role, roleBasis: 'curated' };
  const observed = [...roleCards].sort((a, b) => b.replayPicks - a.replayPicks)[0];
  if (observed.replayPicks) return { role: observed.key, roleBasis: 'replay' };
  return { role: exampleRoles[slug] ?? 'carry', roleBasis: 'example' };
}

async function handleHeroProfile(response, slug, query) {
  const hero = heroesBySlug.get(slug);
  if (!hero) return sendJson(response, 404, { error: 'Hero not found in the 7.42 roster.' });
  const requestedRole = query.get('role');
  if (requestedRole !== null && !rankedRoles.some(({ key }) => key === requestedRole)) {
    return sendJson(response, 400, { error: 'Select one Legend role.' });
  }
  const condition = query.get('condition') || 'auto';
  if (!['auto', 'none'].includes(condition) && !DRAFT_CONDITIONS.some(({ key }) => key === condition)) {
    return sendJson(response, 400, { error: 'Select a supported game condition.' });
  }
  let enemyIds;
  try {
    enemyIds = [...new Set(draftIds(query, 'enemy'))];
    if (enemyIds.includes(hero.id)) throw new RangeError('Choose enemies other than the hero you are playing.');
    if (enemyIds.length > 5) throw new RangeError('Select up to five enemy heroes.');
  } catch (error) {
    if (error instanceof RangeError) return sendJson(response, 400, { error: error.message });
    throw error;
  }
  const [snapshot, data, guide] = await Promise.all([loadSnapshot(), loadBuildData(), loadDraftPlans()]);
  const { picks, economy, roleReplayMatches } = profileEvidence(snapshot);
  const roleCards = rankedRoles.map(({ key, label }) => {
    const ranking = roleRankings.roles[key].rankings.find((row) => row.heroId === hero.id);
    return { key, label, rank: ranking?.rank ?? null, score: ranking?.score ?? null,
      summary: ranking?.mechanic ?? null, replayPicks: picks.get(key).get(hero.id) ?? 0 };
  });
  const plans = guide.plans.filter(({ heroId }) => heroId === hero.id);
  const { role, roleBasis } = chooseProfileRole(requestedRole, roleCards, plans, slug);
  const rolePlan = plans.find((plan) => plan.role === role);
  const curatedConditions = new Set(rolePlan?.swaps?.map(({ trigger }) => trigger));
  const conditionHints = enemyConditionHints(enemyIds).sort((a, b) => b.enemyIds.length - a.enemyIds.length
    || Number(curatedConditions.has(b.key)) - Number(curatedConditions.has(a.key)));
  const activeCondition = condition === 'auto' ? conditionHints[0]?.key ?? '' : condition === 'none' ? '' : condition;
  const farm = buildHeroFarm(data.heroes.get(hero.id) ?? hero, data.items, catalog, plans, {
    options: { ...economy.options, role }, roles: economy.roles.filter(({ key }) => key === role),
  }, { role, replayPicks: picks.get(role).get(hero.id) ?? 0, snapshot, condition: activeCondition });
  const matchups = getHeroMatchups(heroes, snapshot, hero.id);
  const addSlugs = (rows) => rows.map((row) => ({ ...row, enemySlug: heroSlugs[row.enemyId] ?? null }));
  return sendJson(response, 200, {
    patch, source: snapshot.source, fetchedAt: snapshot.fetchedAt, hero, roles: roleCards, role, roleBasis, roleReplayMatches,
    rankCoverage: { legendMatches: roleRankings.sample.publicMatches,
      inferredRoleReplays: roleRankings.sample.positionInferredReplayMatches },
    matchups: { ...matchups, favorable: addSlugs(matchups.favorable), difficult: addSlugs(matchups.difficult) },
    enemyIds, condition, activeCondition, conditionHints, farm,
  });
}

async function handleDraftGuide(url, response) {
  try {
    const query = url.searchParams;
    const arm = query.get('arm') ?? 'draft';
    if (!['draft', 'impact'].includes(arm)) throw new RangeError('Select a draft guide view.');
    const defaultRole = arm === 'impact' ? ROLE_IMPACT_KEYS[0] : DRAFT_GUIDE_DEFAULTS.role;
    const availableRoles = roles.filter(({ key }) => arm === 'impact'
      ? ROLE_IMPACT_KEYS.includes(key) : key !== 'all' && key !== 'unknown');
    const role = query.get('role') ?? defaultRole;
    if (!availableRoles.some(({ key }) => key === role)) {
      throw new RangeError('Select one Legend role.');
    }
    const impactRoles = arm === 'impact' ? await loadImpactRoles() : null;
    if (url.pathname === '/api/draft-guide/meta') {
      return sendJson(response, 200, {
        patch, heroes, arm,
        defaults: { role: defaultRole, targetMinute: GPM_PROJECTION_DEFAULTS.targetMinute,
          reserveGold: GPM_PROJECTION_DEFAULTS.reserveGold },
        roles: availableRoles.map((entry) => arm === 'impact'
          ? { ...entry, criteria: prepareImpactRubric(impactRoles.get(entry.key)).criteria.map(({ key, label }) => ({ key, label })) }
          : entry),
        conditions: DRAFT_CONDITIONS.map(({ key, label }) => ({ key, label })),
      });
    }
    const impactRole = impactRoles?.get(role);
    const impact = impactRole ? prepareImpactRubric(impactRole, query.get('priority') ?? '') : null;
    const profiles = new Map(impactRole?.profiles.map((profile) => [profile.heroId, profile]));
    const condition = query.get('condition') ?? '';
    if (condition && !DRAFT_CONDITIONS.some(({ key }) => key === condition)) {
      throw new RangeError('Select a supported game condition.');
    }
    const enemyIds = draftIds(query, 'enemy');
    const allyIds = draftIds(query, 'ally');
    const blockedIds = draftIds(query, 'blocked');
    const [snapshot, guide] = await Promise.all([
      loadSnapshot(), loadDraftPlans(),
    ]);
    const plansByHero = new Map(guide.plans.filter((entry) => entry.role === role).map((entry) => [entry.heroId, entry]));
    const candidateIds = [...plansByHero.keys()].filter((id) => !impact || profiles.has(id));
    const draft = buildDraftGuide(heroes, snapshot, {
      role, enemyIds, allyIds, blockedIds, minRolePicks: 0, limit: 20, candidateIds,
    });
    const { options: farm, roles: [economy] } = projectGpmEconomy(snapshot, { ...readGpmOptions(query), role });
    const conditionHints = enemyConditionHints(enemyIds);
    const rows = draft.rows.map((row) => {
      const plan = priceDraftPlan(plansByHero.get(row.hero.id), catalog, economy, condition);
      return { ...row, plan, ...(impact ? { impact: scoreRoleImpact(impact, profiles.get(row.hero.id), plan) } : {}) };
    });
    if (impact) rows.sort((first, second) => second.impact.score - first.impact.score || first.rank - second.rank);
    return sendJson(response, 200, {
      patch, source: snapshot.source, fetchedAt: snapshot.fetchedAt, ...draft,
      arm, impact, condition, conditionHints, farm, economy, provenance: guide.provenance,
      rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
    });
  } catch (error) {
    if (error instanceof RangeError) return sendJson(response, 400, { error: error.message });
    throw error;
  }
}

function readFilters(query) {
  const rank = query.get('rank') ?? 'all';
  const role = query.get('role') ?? 'all';
  return {
    rankTier: rank === 'unknown' ? 'unknown' : /^[1-7]$/.test(rank) ? Number(rank) : 'all',
    role: roles.some(({ key }) => key === role) ? role : 'all',
    window: query.get('window') ?? 'early',
    patchConfidence: query.get('patchConfidence') === 'verified' ? 'verified' : 'all',
    roleConfidence: query.get('roleConfidence') === 'observed' ? 'observed' : 'all',
    minGames: positiveInt(query.get('minGames')),
    minGroup: positiveInt(query.get('minGroup')),
  };
}

function positiveInt(input) {
  const number = Number(input);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function sendJson(response, code, body) {
  response.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function heroRows(stats) {
  const seen = new Set(stats.rows.map((row) => row.heroId));
  const rankedRows = stats.rows.map((row) => ({
    ...row,
    name: heroesById.get(row.heroId)?.name ?? `Hero #${row.heroId}`,
    slug: heroesById.get(row.heroId)?.slug ?? null,
  }));
  const unplayedRows = heroes.filter((hero) => !seen.has(hero.id)).map((hero) => ({
    heroId: hero.id,
    name: hero.name,
    slug: hero.slug,
    games: 0,
    wins: 0,
    winRate: null,
    pickRate: stats.eligiblePicks ? 0 : null,
    confidenceLow: null,
    confidenceHigh: null,
    rank: null,
  }));
  return [...rankedRows, ...unplayedRows];
}

export async function handleRequest(request, response, routedUrl) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return sendJson(response, 405, { error: 'Method not supported.' });
    }
    const url = routedUrl ?? new URL(request.url, 'http://localhost');
    const route = url.pathname;
    const heroPage = /^\/(?:heroes|hero(?:\/[a-z0-9_-]+)?)\/?$/i.test(route);
    const page = staticFiles.get(heroPage ? '/hero' : route);
    if (page) {
      const [file, type] = page;
      const content = await readFile(new URL(`./public/${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return response.end(content);
    }

    const asset = /^\/assets\/(heroes|items)\/([a-z0-9_]+)\.(jpg|png)$/.exec(route);
    if (asset) {
      const [, collection, slug] = asset;
      const folder = collection === 'items' ? 'items' : 'heroes';
      response.writeHead(302, {
        Location: `https://cdn.akamai.steamstatic.com/apps/dota2/images/dota_react/${folder}/${slug}.png`,
        'Cache-Control': 'public, max-age=86400',
      });
      return response.end();
    }

    if (route === '/api/efficiency' || route === '/api/efficiency/meta') {
      return await handleBuildRequest(url, response);
    }
    if (route === '/api/legend-builds' || route === '/api/legend-builds/meta') {
      return await handleLeaderboard(url, response);
    }
    if (route === '/api/gpm-builds/context') return await handleGpmContext(response);
    if (route === '/api/draft-guide' || route === '/api/draft-guide/meta') return await handleDraftGuide(url, response);
    if (route === '/api/role-rankings') return sendJson(response, 200, { ...roleRankings, heroSlugs });
    if (route === '/api/hero-profiles/meta') {
      return sendJson(response, 200, { patch, heroes: heroes.map(({ id, name, slug }) => ({ id, name, slug })),
        conditions: DRAFT_CONDITIONS.map(({ key, label }) => ({ key, label })) });
    }
    const heroProfile = /^\/api\/hero-profiles\/([a-z0-9_-]+)$/.exec(route);
    if (heroProfile) return await handleHeroProfile(response, heroProfile[1], url.searchParams);
    if (route === '/api/gpm-builds' || route === '/api/gpm-builds/meta' || route === '/api/gpm-builds.csv') {
      return await handleGpmBuilds(url, response);
    }
    if (!['/api/meta', '/api/heroes', '/api/items'].includes(route)) {
      return sendJson(response, 404, { error: 'Page not found.' });
    }
    const snapshot = await loadSnapshot();
    if (route === '/api/meta') {
      const players = snapshot.matches.flatMap((match) => match.players);
      return sendJson(response, 200, {
        patch,
        fetchedAt: snapshot.fetchedAt,
        source: snapshot.source,
        sampling: snapshot.sampling ?? null,
        matches: snapshot.matches.length,
        verifiedMatches: snapshot.matches.filter((match) => match.patchConfidence === 'verified').length,
        roleKnownPicks: players.filter((player) => player.role !== 'unknown').length,
        parsedPicks: players.filter((player) => Array.isArray(player.purchases)).length,
        totalPicks: players.length,
        roles,
        rankTiers,
        windows: Object.values(PURCHASE_WINDOWS),
        heroes,
        mechanics,
        sources,
      });
    }
    const filters = readFilters(url.searchParams);
    if (route === '/api/heroes') {
      const stats = getHeroRankings(snapshot, filters);
      return sendJson(response, 200, { ...stats, rows: heroRows(stats) });
    }
    const hero = heroesById.get(positiveInt(url.searchParams.get('heroId')));
    if (!hero) return sendJson(response, 400, { error: 'Select a hero from the 7.42 roster.' });
    if (!PURCHASE_WINDOWS.some((window) => window.key === filters.window)) {
      return sendJson(response, 400, { error: 'Select a supported purchase window.' });
    }
    const stats = getItemRankings(snapshot, catalog, hero.id, filters);
    const rows = stats.rows.map((row) => ({
      ...row,
      slug: row.key,
      cost: catalog.get(row.key).cost,
    }));
    return sendJson(response, 200, { ...stats, hero, rows });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Could not load analyzer data. Check the local server log.' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(handleRequest);
  const port = Number(process.env.PORT ?? 4173);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Dota ${patch} analyzer available at http://127.0.0.1:${server.address().port}`);
  });
}
