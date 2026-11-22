import { parentPort, workerData } from 'node:worker_threads';
import { loadData, applyBalancePatch, evaluateScenario } from './balance.mjs';

const data = loadData();
applyBalancePatch(data.balance, workerData.patch ?? {});
parentPort.postMessage(evaluateScenario(data, workerData.dungeonId, workerData.options, workerData.runs));
