import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { createBuildRoleScorer } from '../lib/build-role-scoring.mjs';
import { searchBuildOrders } from '../lib/build-search.mjs';

try {
  const { model, role, items, farms, options, seedPaths, patch } = workerData;
  let spells = [];
  if (role === 'mid') {
    const catalog = JSON.parse((await readFile(new URL('../data/7.42/hero-magic.json', import.meta.url), 'utf8'))
      .replace(/^\uFEFF/, ''));
    if (catalog.patch !== patch || !Array.isArray(catalog.heroes)) throw new Error('Hero spell data does not match this patch.');
    spells = catalog.heroes.find(({ id }) => id === model.id)?.spells ?? [];
  }
  const { score, utilityItemKeys, ...objective } = createBuildRoleScorer(model, role, { ...options, spells });
  parentPort.postMessage({ result: { objective, farms: farms.map(({ key, label, checkpoints }) => ({
    key, label, ...searchBuildOrders({ hero: model, items, checkpoints, score, seedPaths, utilityItemKeys }),
  })) } });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
