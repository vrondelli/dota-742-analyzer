import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  createOpenDotaClient,
  findParsedIds,
  findPatchUpperBound,
  getRankedPublicMatches,
  MIN_MATCH_DURATION,
  PATCH,
  PATCH_RELEASE,
  withReplayDetails,
} from '../lib/opendota.mjs';

const defaults = {
  limit: '2000',
  details: '160',
  'parsed-pages': '20',
  'economy-backfill': '0',
  output: fileURLToPath(new URL('../data/7.42/matches.json', import.meta.url)),
};

function readInteger(value, flag, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`--${flag} must be an integer from ${min} to ${max}.`);
  }
  return Number(value);
}

async function readPrevious(path) {
  try {
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    if (snapshot.patch !== PATCH || !Array.isArray(snapshot.matches)) {
      throw new Error('The previous snapshot is not a 7.42 match collection.');
    }
    return snapshot.matches;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveSnapshot(path, snapshot) {
  await mkdir(dirname(path), { recursive: true });
  const pending = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, `${JSON.stringify(snapshot)}\n`, { flag: 'wx' });
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }
}

async function refresh() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string', default: defaults.limit },
      details: { type: 'string', default: defaults.details },
      'parsed-pages': { type: 'string', default: defaults['parsed-pages'] },
      'economy-backfill': { type: 'string', default: defaults['economy-backfill'] },
      'rank-tier': { type: 'string' },
      output: { type: 'string', default: defaults.output },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/refresh.mjs [--rank-tier 5] [--limit 2000] [--details 160] [--parsed-pages 20] [--economy-backfill 0] [--output path]');
    console.log('Rank tiers run from 1 (Herald) to 7 (Divine / top estimate). Legend is tier 5.');
    console.log('Economy backfill revisits up to the specified number of already parsed matches with no economy import.');
    return;
  }
  const limit = readInteger(values.limit, 'limit', 1, 5000);
  const details = readInteger(values.details, 'details', 0, 500);
  const maxPages = readInteger(values['parsed-pages'], 'parsed-pages', 1, 50);
  const economyBackfill = readInteger(values['economy-backfill'], 'economy-backfill', 0, 500);
  const rankTier = values['rank-tier'] === undefined
    ? undefined
    : readInteger(values['rank-tier'], 'rank-tier', 1, 7);
  const output = resolve(values.output);

  const client = createOpenDotaClient();
  const [previous, upperBound] = await Promise.all([readPrevious(output), findPatchUpperBound()]);
  const until = Math.min(upperBound ?? Infinity, Math.floor(Date.now() / 1000));
  const fresh = await getRankedPublicMatches(client, until, limit, rankTier);
  const matches = new Map(fresh.map((match) => [match.id, match]));
  for (const match of previous) {
    if (match.startTime >= PATCH_RELEASE && match.startTime < until) matches.set(match.id, match);
  }

  const inRank = [...matches.values()].filter((match) => rankTier === undefined || match.rankTier === rankTier);
  const alreadyParsed = (match) => match.players.some((player) => Array.isArray(player.purchases)
    || (player.role && player.role !== 'unknown'));
  const candidates = new Set(inRank.filter((match) => !alreadyParsed(match)).map(({ id }) => id));
  const backfillIds = inRank.filter((match) => alreadyParsed(match)
    && !match.players.some((player) => Object.hasOwn(player, 'gpm') && Object.hasOwn(player, 'goldTimeline')))
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, economyBackfill)
    .map(({ id }) => id);
  const warnings = [];
  let parsedIds = [];
  try {
    parsedIds = await findParsedIds(client, candidates, details, maxPages);
  } catch (error) {
    if (!error.status) throw error;
    warnings.push(`Parsed-match discovery paused. ${error.message}.`);
  }
  console.log(`Found ${fresh.length} public matches, ${parsedIds.length} indexed replays, and ${backfillIds.length} economy backfill candidates.`);
  for (const id of [...backfillIds, ...parsedIds]) {
    try {
      const detail = await client(`matches/${id}`);
      matches.set(id, withReplayDetails(matches.get(id), detail));
    } catch (error) {
      if (error.status === 404) {
        warnings.push(`Indexed replay was unavailable for match ${id}.`);
        continue;
      }
      warnings.push(`Match detail collection paused. ${error.message}.`);
      break;
    }
  }

  const ranked = [...matches.values()].sort((a, b) => Number(b.id) - Number(a.id));
  const parsed = ranked.filter(({ players }) => players.some(({ purchases }) => purchases != null));
  const rolePlayers = ranked.reduce((total, match) => total
    + match.players.filter(({ role }) => role !== 'unknown').length, 0);
  const gpmPlayers = ranked.reduce((total, match) => total
    + match.players.filter(({ gpm }) => Number.isFinite(gpm)).length, 0);
  const goldTimelinePlayers = ranked.reduce((total, match) => total
    + match.players.filter(({ goldTimeline }) => Array.isArray(goldTimeline)).length, 0);
  const snapshot = {
    patch: PATCH,
    fetchedAt: new Date().toISOString(),
    source: 'OpenDota',
    sampling: {
      mode: 'Ranked All Pick',
      minDurationSeconds: MIN_MATCH_DURATION,
      refreshRankTier: rankTier ?? null,
      startTime: PATCH_RELEASE,
      endTime: until,
      nextPatchCutoff: upperBound,
      latestPublicMatches: fresh.length,
      parsedMatches: parsed.length,
      rolePlayers,
      gpmPlayers,
      goldTimelinePlayers,
      warnings,
    },
    matches: ranked,
  };
  await saveSnapshot(output, snapshot);
  for (const warning of warnings) console.warn(warning);
  console.log(`Saved ${ranked.length} matches. ${parsed.length} have purchase logs and ${rolePlayers} player rows have roles.`);
  console.log(`Economy observations: ${gpmPlayers} player rows have GPM and ${goldTimelinePlayers} have timed earnings.`);
}

refresh().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
