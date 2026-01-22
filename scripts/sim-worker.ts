/**
 * Simulation Worker - Runs a single simulation in a worker thread
 * 
 * Receives tasks via parentPort messages, runs Engine simulation,
 * writes results to disk, and reports completion back to parent.
 * 
 * Implements caching for:
 * - Map JSON (keyed by mapPath)
 * - Derived tile indices (keyed by mapPath+agentCount)
 */
import { parentPort } from "node:worker_threads";
import type { WorkerTask, WorkerResult } from "./pipeline-utils";
import { Engine } from "../src/lib/engine/Engine";
import {
  runSimulationTask,
  computeDerivedMapData,
  loadMapFile,
  type SimulationTask,
  type SimulationResult,
  type DerivedMapData,
  type BaseSpecFile,
} from "./run-batch";

if (!parentPort) {
  throw new Error("sim-worker must be run as a worker thread");
}

// Worker-side caches (persist across tasks within same worker)
const mapCache = new Map<string, BaseSpecFile>();
const derivedCache = new Map<string, DerivedMapData>();

/** Get cached map or load fresh */
async function getCachedMap(mapPath: string): Promise<BaseSpecFile> {
  let map = mapCache.get(mapPath);
  if (!map) {
    map = await loadMapFile(mapPath);
    (map.meta ??= {}).sourcePath = mapPath;
    mapCache.set(mapPath, map);
  }
  return map;
}

/** Get cached derived data or compute fresh (requires running resetWorld once) */
function getCachedDerived(map: BaseSpecFile, mapPath: string, agentCount: number, tickRate: number): DerivedMapData {
  const cacheKey = `${mapPath}:${agentCount}`;
  let derived = derivedCache.get(cacheKey);
  if (!derived) {
    // Create a temporary engine just to generate the map and compute indices
    const tempEngine = new Engine(
      {
        grid: { width: map.width, height: map.height },
        diagonal: true,
        seed: "derived-cache", // seed doesn't affect map generation
        baseTickRate: tickRate,
        pixelsPerTile: 1,
        headless: true,
      }
    );
    tempEngine.resetWorld(map.spec, agentCount);
    derived = computeDerivedMapData(tempEngine, map);
    derivedCache.set(cacheKey, derived);
  }
  return derived;
}

parentPort.on("message", async (task: WorkerTask<SimulationTask>) => {
  const { id, data } = task;

  try {
    // Get cached map and derived data
    const map = await getCachedMap(data.mapPath);
    const derived = getCachedDerived(map, data.mapPath, data.agentCount, data.tickRate);

    const result = await runSimulationTask(data, map, derived, (ticks) => {
      parentPort?.postMessage({
        id,
        type: "progress",
        ticks,
      });
    });

    const response: WorkerResult<SimulationResult> = {
      id,
      result,
    };
    parentPort!.postMessage(response);
  } catch (err) {
    const response: WorkerResult<SimulationResult> = {
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort!.postMessage(response);
  }
});
