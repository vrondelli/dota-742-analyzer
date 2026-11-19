import { setTimeout as sleep } from 'node:timers/promises';

export const PATCH = '7.42';
export const PATCH_RELEASE = 1795032046;
export const MIN_MATCH_DURATION = 600;
export const API_BASE = 'https://api.opendota.com/api/';

const valvePatches = 'https://www.dota2.com/datafeed/patchnoteslist';
const positionRoles = [null, 'carry', 'mid', 'offlane', 'soft-support', 'hard-support'];

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw Object.assign(new Error(`${url.pathname} returned HTTP ${response.status}`), {
      status: response.status,
    });
  }
  return response.json();
}

export function createOpenDotaClient() {
  let readyAt = 0;
  return async (resource, params = {}) => {
    const now = Date.now();
    const scheduledAt = Math.max(now, readyAt);
    readyAt = scheduledAt + 1_100;
    if (scheduledAt > now) await sleep(scheduledAt - now);
    const url = new URL(resource, API_BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return getJson(url);
  };
}

export async function findPatchUpperBound() {
  const data = await getJson(new URL(valvePatches));
  const index = data.patches?.findIndex(({ patch_number }) => patch_number === PATCH);
  if (!data.success || index == null || index < 0) {
    throw new Error(`Valve did not return patch ${PATCH} in its patch list.`);
  }
  const nextPatch = data.patches[index + 1];
  if (!nextPatch) return null;
  const timestamp = nextPatch.patch_timestamp;
  if (!Number.isSafeInteger(timestamp) || timestamp < data.patches[index].patch_timestamp) {
    throw new Error(`Cannot identify the date of patch ${nextPatch.patch_number}.`);
  }
  if (timestamp < PATCH_RELEASE) {
    throw new Error(`Patch ${nextPatch.patch_number} shares the release day. A precise rollout time is needed for new inference.`);
  }
  // Valve's timestamp labels the patch day. Exclude that entire UTC day.
  return Math.floor(timestamp / 86_400) * 86_400;
}

export async function getRankedPublicMatches(client, until, limit, rankTier) {
  if (!Number.isSafeInteger(until) || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('Invalid Explorer collection bounds.');
  }
  if (rankTier !== undefined && (!Number.isInteger(rankTier) || rankTier < 1 || rankTier > 7)) {
    throw new Error('Invalid Explorer rank tier.');
  }
  const rankFilter = rankTier === undefined
    ? ''
    : `AND avg_rank_tier >= ${rankTier * 10} AND avg_rank_tier < ${(rankTier + 1) * 10}`;
  const sql = `
SELECT match_id, start_time, duration, avg_rank_tier, radiant_team, dire_team, radiant_win
FROM public_matches
WHERE start_time >= ${PATCH_RELEASE} AND start_time < ${until}
  AND lobby_type = 7 AND game_mode = 22 AND duration >= ${MIN_MATCH_DURATION}
  ${rankFilter}
ORDER BY match_id DESC
LIMIT ${limit}`;
  const { rows } = await client('explorer', { sql });
  if (!Array.isArray(rows)) throw new Error('OpenDota Explorer did not return a match list.');

  return rows.flatMap((row) => {
    const teams = [row.radiant_team, row.dire_team];
    const heroIds = teams.flat();
    if (!Number.isSafeInteger(row.match_id) || row.match_id <= 0
      || !Number.isSafeInteger(row.start_time) || row.start_time < PATCH_RELEASE || row.start_time >= until
      || !Number.isSafeInteger(row.duration) || row.duration < MIN_MATCH_DURATION
      || typeof row.radiant_win !== 'boolean'
      || !teams.every((team) => Array.isArray(team) && team.length === 5)
      || heroIds.some((id) => !Number.isInteger(id) || id < 1)
      || new Set(heroIds).size !== 10) return [];

    const matchRank = Math.floor(row.avg_rank_tier / 10);
    if (rankTier !== undefined && matchRank !== rankTier) return [];
    return [{
      id: String(row.match_id),
      startTime: row.start_time,
      duration: row.duration,
      rankTier: matchRank >= 1 && matchRank <= 8 ? matchRank : null,
      patchConfidence: 'inferred',
      players: teams.flatMap((team, teamIndex) => team.map((heroId) => ({
        heroId,
        won: row.radiant_win === (teamIndex === 0),
        role: 'unknown',
        roleConfidence: 'unknown',
        purchases: null,
      }))),
    }];
  });
}

export async function findParsedIds(client, candidates, limit, maxPages) {
  const parsedIds = [];
  if (!candidates.size || !limit) return parsedIds;
  let earliest = Infinity;
  let latest = 0;
  for (const id of candidates) {
    earliest = Math.min(earliest, Number(id));
    latest = Math.max(latest, Number(id));
  }
  let cursor = latest + 1;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await client('parsedMatches', { less_than_match_id: cursor });
    if (!Array.isArray(rows)) throw new Error('OpenDota did not return the parsed match list.');
    const ids = rows.map(({ match_id }) => match_id)
      .filter((id) => Number.isSafeInteger(id) && id < cursor);
    for (const id of ids) {
      const key = String(id);
      if (candidates.has(key)) parsedIds.push(key);
      if (parsedIds.length === limit) return parsedIds;
    }
    if (!ids.length) break;
    cursor = Math.min(...ids);
    if (cursor <= earliest) break;
  }
  return [...new Set(parsedIds)];
}

function earnedGoldTimeline(player, duration) {
  const { gold_t: gold, times } = player;
  if (!Array.isArray(gold) || !Array.isArray(times) || !gold.length || times.length !== gold.length) return null;
  // OpenDota's replay parser samples cumulative earned gold.
  const minutes = Math.min(gold.length, Math.floor(duration / 60) + 1);
  for (let minute = 0; minute < minutes; minute += 1) {
    if (times[minute] !== minute * 60 || !Number.isSafeInteger(gold[minute]) || gold[minute] < 0
      || (minute > 0 && gold[minute] < gold[minute - 1])) return null;
  }
  return gold.slice(0, minutes);
}

export function withReplayDetails(match, detail) {
  if (String(detail.match_id) !== match.id || detail.start_time !== match.startTime
    || detail.game_mode !== 22 || detail.lobby_type !== 7 || !Array.isArray(detail.players)
    || typeof detail.radiant_win !== 'boolean') return match;

  const byHero = new Map(detail.players.map((player) => [player.hero_id, player]));
  return {
    ...match,
    players: match.players.map((player) => {
      const replay = byHero.get(player.heroId);
      const onRadiant = player.won === detail.radiant_win;
      if (!replay || replay.isRadiant !== onRadiant) return player;
      const estimatedRole = Number.isInteger(replay.position_est) ? positionRoles[replay.position_est] : null;
      const knownRole = player.role && player.role !== 'unknown';
      const purchases = Array.isArray(replay.purchase_log)
        ? replay.purchase_log.flatMap(({ key, time }) => typeof key === 'string' && key
          && Number.isInteger(time) && time <= match.duration
          ? [{ key: key.replace(/^item_/, ''), time }]
          : [])
        : null;
      const gpm = Number.isSafeInteger(replay.gold_per_min) && replay.gold_per_min > 0 ? replay.gold_per_min : null;
      return {
        ...player,
        role: knownRole ? player.role : (estimatedRole ?? 'unknown'),
        roleConfidence: knownRole ? player.roleConfidence : (estimatedRole ? 'inferred' : 'unknown'),
        purchases: player.purchases ?? purchases,
        gpm: gpm ?? player.gpm ?? null,
        goldTimeline: earnedGoldTimeline(replay, match.duration) ?? player.goldTimeline ?? null,
      };
    }),
  };
}
