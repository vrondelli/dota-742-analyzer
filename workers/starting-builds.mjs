import { parentPort, workerData } from 'node:worker_threads';
import { searchStartingBuilds } from '../lib/starting-builds.mjs';

try {
  parentPort.postMessage({ result: searchStartingBuilds(workerData) });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
