import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { analyzeRoleBuilds } from '../lib/role-builds.mjs';
import { analyzeGpmProjections } from '../lib/gpm-projections.mjs';

try {
  const { kind, heroes, items, snapshot, options } = workerData;
  let spells = [];
  if (options.metric === 'magicalDamage') {
    const catalog = JSON.parse((await readFile(new URL('../data/7.42/hero-magic.json', import.meta.url), 'utf8'))
      .replace(/^\uFEFF/, ''));
    if (catalog.patch !== snapshot.patch || !Array.isArray(catalog.heroes)) {
      throw new Error('The hero spell catalog does not match the selected patch.');
    }
    spells = catalog.heroes;
  }
  const result = kind === 'gpm'
    ? analyzeGpmProjections(heroes, items, snapshot, options)
    : analyzeRoleBuilds(heroes, items, snapshot, { ...options, spells });
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message, invalidScenario: error instanceof RangeError });
}
