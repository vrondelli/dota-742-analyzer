import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyzeWraithKingReplayBuilds } from '../lib/wraith-king-replay-builds.mjs';

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

try {
  const { values } = parseArgs({
    options: {
      snapshot: { type: 'string' },
      'prefix-length': { type: 'string', default: '3' },
      limit: { type: 'string', default: '3' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/wraith-king-replay-builds.mjs [--snapshot path] [--prefix-length 3] [--limit 3]');
  } else {
    const [snapshot, { items }] = await Promise.all([
      readJson(values.snapshot ?? new URL('../data/7.42/wraith-king-replays.json', import.meta.url)),
      readJson(new URL('../data/7.42/shop-items.json', import.meta.url)),
    ]);
    const result = analyzeWraithKingReplayBuilds(snapshot, items, {
      prefixLength: Number(values['prefix-length']),
      limit: Number(values.limit),
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
