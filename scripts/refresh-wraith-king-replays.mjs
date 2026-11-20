import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  createOpenDotaClient, findPatchUpperBound, getRankedPublicMatches, MIN_MATCH_DURATION,
  parsedMatchPages, PATCH, PATCH_RELEASE, withReplayDetails,
} from '../lib/opendota.mjs';

const heroId = 42;
const rankTier = 5;
const batchSize = 300;
const directory = new URL('../data/7.42/', import.meta.url);
const destination = new URL('wraith-king-replays.json', directory);

async function snapshotAt(file) {
  try {
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    if (snapshot.patch !== PATCH || !Array.isArray(snapshot.matches)) throw new Error(`Invalid 7.42 snapshot at ${file}.`);
    return snapshot.matches;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function refresh() {
  const { values } = parseArgs({ options: { 'parsed-pages': { type: 'string', default: '45' } } });
  const maxPages = Number(values['parsed-pages']);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 250) throw new Error('Use 1 to 250 parsed index pages.');
  const request = createOpenDotaClient();
  const client = async (resource, params) => {
    for (let retry = 0; ; retry += 1) {
      try {
        return await request(resource, params);
      } catch (error) {
        if (retry === 3 || ![429, 502, 503, 504].includes(error.status)) throw error;
        const delay = error.status === 429 ? 31_000 : 3_000;
        console.warn(`${error.message}. Retrying in ${delay / 1000} seconds.`);
        await wait(delay);
      }
    }
  };
  const [prior, generalBank, upperBound] = await Promise.all([
    snapshotAt(destination), snapshotAt(new URL('matches.json', directory)), findPatchUpperBound(),
  ]);
  const until = Math.min(upperBound ?? Infinity, Math.floor(Date.now() / 1000));
  const [first] = await getRankedPublicMatches(client, until, 1, rankTier, { heroId, oldestFirst: true });
  const [last] = await getRankedPublicMatches(client, until, 1, rankTier, { heroId });
  if (!first || !last) throw new Error('OpenDota did not return any eligible public matches.');

  const seen = new Map();
  for (const match of [...generalBank, ...prior]) {
    if (match.rankTier !== rankTier || match.startTime < PATCH_RELEASE || match.startTime >= until) continue;
    const player = match.players.find((entry) => entry.heroId === heroId);
    if (Array.isArray(player?.purchases)) seen.set(match.id, { ...match, players: [player] });
  }

  const indexed = new Map();
  const earliest = Number(first.id);
  let cursor = Number(last.id) + 1;
  let pages = 0;
  let batch = [];
  const warnings = [];
  const collectBatch = async (ids) => {
    const rows = await getRankedPublicMatches(client, until, ids.length, rankTier, { heroId, matchIds: ids });
    for (const row of rows) indexed.set(row.id, row);
  };
  try {
    for await (const page of parsedMatchPages(client, earliest, Number(last.id), maxPages)) {
      pages += 1;
      batch.push(...page.ids);
      if (batch.length >= batchSize) {
        await collectBatch(batch.slice(0, batchSize));
        batch = batch.slice(batchSize);
      }
      cursor = page.cursor;
      if (pages % 20 === 0) console.log(`Scanned ${pages} index pages; ${indexed.size} Wraith King replay candidates.`);
    }
    if (batch.length) await collectBatch(batch);
  } catch (error) {
    if (![429, 502, 503, 504].includes(error.status) || !indexed.size) throw error;
    warnings.push(`Index collection stopped before matching all requested pages. ${error.message}.`);
  }
  const completeIndexWindow = !warnings.length && cursor <= earliest;
  if (!warnings.length && !completeIndexWindow) warnings.push('The parsed index page limit was reached before the earliest eligible match.');
  console.log(`Found ${indexed.size} indexed Wraith King matches across ${pages} pages. ${seen.size} saved logs can be reused.`);

  let missingDetails = 0;
  let downloaded = 0;
  for (const [id, match] of indexed) {
    if (seen.has(id)) continue;
    let resolved = match;
    try {
      resolved = withReplayDetails(match, await client(`matches/${id}`));
    } catch (error) {
      if ([429, 502, 503, 504].includes(error.status)) {
        warnings.push(`Replay detail collection stopped early. ${error.message}.`);
        break;
      }
      if (error.status !== 404) throw error;
      missingDetails += 1;
    }
    seen.set(id, { ...resolved, players: resolved.players.filter((player) => player.heroId === heroId) });
    downloaded += 1;
    if (downloaded % 25 === 0) console.log(`Processed ${downloaded} replay details.`);
  }
  if (missingDetails) warnings.push(`${missingDetails} indexed replays returned HTTP 404 for match details.`);

  const matches = [...seen.values()].sort((a, b) => Number(b.id) - Number(a.id));
  const snapshot = {
    patch: PATCH, fetchedAt: new Date().toISOString(), source: 'OpenDota',
    sampling: {
      mode: 'Ranked All Pick', heroId, refreshRankTier: rankTier, minDurationSeconds: MIN_MATCH_DURATION,
      startTime: PATCH_RELEASE, endTime: until, nextPatchCutoff: upperBound,
      earliestPublicMatchId: first.id, latestPublicMatchId: last.id,
      completeIndexWindow, indexPages: pages, indexCursor: cursor, indexedMatches: indexed.size,
      parsedMatches: matches.filter(({ players: [player] }) => Array.isArray(player?.purchases)).length,
      warnings,
    },
    matches,
  };
  const pending = new URL(`wraith-king-replays.${randomUUID()}.tmp`, directory);
  try {
    await writeFile(pending, `${JSON.stringify(snapshot)}\n`, { flag: 'wx' });
    await rename(pending, destination);
  } finally {
    await rm(pending, { force: true });
  }
  console.log(`Saved ${matches.length} Wraith King matches with ${snapshot.sampling.parsedMatches} purchase logs.`);
}

refresh().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
