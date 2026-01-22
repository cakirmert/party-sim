import { promises as fs } from "node:fs";
import { resolve, relative } from "node:path";
import { PNG } from "pngjs";
import { Engine } from "../src/lib/engine/Engine";
import { aStar8 } from "../src/lib/engine/Pathfinder";
import type { EngineConfig, Vec2 } from "../src/lib/engine/Types";
import {
  type BaseSpecFile,
  directCliRun,
  ensureDir,
  fileStem,
  getDefaultWorkerCount,
  listJsonFiles,
  loadMapFile,
  parseArgv,
  parseCsv,
  runParallelTasks,
  slugify,
  writeJson,
} from "./pipeline-utils";

// Re-export for worker caching
export type { BaseSpecFile };
export { loadMapFile };

export type Scenario = "weekday" | "weekend";

export type RunMetrics = {
  avgPathLength: number;
  pathSamples: number;
  meanOccupancy: number;
  maxOccupancy: number;
  maxMeanTile: number;
  corridorMeanDensity: number;
  corridorPeakDensity: number;
  corridorP95: number;
  barOccupancyRatio: number;
  gymOccupancyRatio: number;
  stuckRate: number;
  exitReachable: boolean;
  agentTicks: number;
  stuckTicks: number;
  coverageRatio: number;
  hotspot: { x: number; y: number; value: number; tag?: string } | null;
  /** Max room capacity (spawn points) for this map */
  roomCapacity: number;
  /** Actual agents spawned (min of requested and capacity) */
  actualAgents: number;
  avgExitTime?: number;
  evacuationRate?: number;
  avgPathEfficiency?: number;
};

export type RunOutput = {
  map: string;
  scenario: Scenario;
  seed: string;
  agentCount: number;
  simMinutes: number;
  steps: number;
  metrics: RunMetrics;
  /** PNG heatmap (legacy mode) */
  heatmap?: { png: string; rel: string; maxMean: number; maxInstant: number };
  /** JSON heatmap data - flat array of normalized values [0,1], row-major order */
  heatmapData?: {
    width: number;
    height: number;
    /** Normalized occupancy values [0,1], row-major. Length = width * height */
    data: number[];
    maxMean: number;
    maxInstant: number;
  };
  meta: Record<string, unknown>;
};

function smoothGrid(occSum: Float64Array, width: number, height: number, steps: number) {
  const size = width * height;
  const base = new Float64Array(size);
  for (let i = 0; i < size; i++) base[i] = occSum[i] / steps;

  // simple Gaussian-ish blur kernel
  const out = new Float64Array(size);
  let max = 0;
  const k = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1],
  ];
  const kSum = 16;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = x + kx;
          const sy = y + ky;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          const w = k[ky + 1][kx + 1];
          acc += base[sy * width + sx] * w;
        }
      }
      const v = acc / kSum;
      const idx = y * width + x;
      out[idx] = v;
      if (v > max) max = v;
    }
  }
  return { grid: out, max };
}

export type BatchOptions = {
  maps: string[];
  outDir: string;
  agentCount: number;
  seeds: string[];
  simMinutes: number;
  scenarios: Scenario[];
  tickRate: number;
  heatmap: boolean;
  heatmapScale: number;
  /** Skip Gaussian blur for faster heatmap generation (default: false) */
  heatmapFast?: boolean;
  /** Store heatmap as JSON data instead of PNG (much faster, default: false) */
  heatmapJson?: boolean;
  /** Only keep top K results (skip file I/O for lower-scoring maps) */
  topK?: number;
};

/** Task for parallel simulation worker */
export type SimulationTask = {
  mapPath: string;
  scenario: Scenario;
  seed: string;
  agentCount: number;
  simMinutes: number;
  tickRate: number;
  heatmap: boolean;
  heatmapScale: number;
  heatmapFast?: boolean;
  heatmapJson?: boolean;
  outDir: string;
  /** Skip file I/O in worker - return RunOutput for main thread to handle */
  skipFileIO?: boolean;
};

/** Result from parallel simulation worker */
export type SimulationResult = {
  outputPath: string;
  mapName: string;
  scenario: Scenario;
  seed: string;
  /** Full run output when skipFileIO was set (for top-K filtering) */
  runOutput?: RunOutput;
  mapPath?: string;
};

/** Cached derived map data (computed once per map+agentCount) */
export type DerivedMapData = {
  corridorIdx: number[];
  barIdx: number[];
  gymIdx: number[];
  walkableCount: number;
};

/** Quick composite score for in-memory ranking (higher = better)
 * Weights per notes.md:
 *   capacity (40%): room count, target ~150 for 100%
 *   utilization (25%): bar/gym not overcrowded
 *   congestion (15%): hallway density 
 *   path (20%): shorter travel time
 *   exit (5%): reachability
 */
export function quickScore(m: RunMetrics): number {
  // Capacity: ~150 rooms = 100% score, scales linearly
  const TARGET_CAPACITY = 150;
  const capacity = Math.min(1, (m.roomCapacity || m.actualAgents || 100) / TARGET_CAPACITY);

  // Utilization: ideal < 0.8. Penalty starts at 0.8.
  // Milder curve: 1.0 at <0.8, drops slowly.
  const barOver = Math.max(0, m.barOccupancyRatio - 0.8);
  const gymOver = Math.max(0, m.gymOccupancyRatio - 0.8);
  // Penalty: e.g. if ratio is 1.2 (0.4 over), penalty should be noticeable but not zeroing.
  // 1 / (1 + 0.4) = 0.71. Acceptable.
  // Let's keep rational but maybe softer: 1 / (1 + x * 2) -> 1 / (1 + 0.8) = 0.55. Too harsh.
  // Let's stick to 1 / (1 + x) for now, but ensure metrics are sane.
  // Actually user wants "not all smaller than 0.5".
  // Let's use linear penalty with floor. max possible over is maybe 2.0 (ratio 2.8).
  // 1.0 - (over * 0.5). If over is 0.4 -> 0.8 score.
  const utilization = Math.max(0, 1 - (barOver + gymOver) * 0.5);

  // Congestion: corridorP95. Typical 0.1-0.3?
  // If 0.1 -> score ~0.8. If 0.3 -> score ~0.4.
  // Linear: 1 - (p95 * 2.5). 0.1->0.75. 0.3->0.25.
  const congestion = Math.max(0, 1 - m.corridorP95 * 2.5);

  // Path: shorter avg path length is better (typical range 30-80)
  // 30 -> 1.0. 80 -> 0.375.
  const pathScore = m.avgPathLength > 0 ? Math.min(1, 35 / m.avgPathLength) : 0.5;

  // Evacuation Score
  const MAX_DRILL_TICKS = 480;
  const timeScore = Math.max(0, 1 - (m.avgExitTime || MAX_DRILL_TICKS) / MAX_DRILL_TICKS);
  // Rate is paramount. If only 50% exit, score should be low.
  const evacuation = (m.evacuationRate || 0) * 0.6 + timeScore * 0.4;

  // Stuck rate: Scale 500x. 0.1% (0.001) -> 0.5 penalty -> 1/(1.5) = 0.66
  // 0.05% -> 0.25 -> 0.8.
  // 1% -> 5.0 -> 0.16. Good range.
  const stuckPenalty = m.stuckRate * 500;
  const waitScore = 1 / (1 + stuckPenalty);

  // Weights: capacity=35%, utilization=20%, congestion=15%, path=10%, evacuation=15%, wait=5%
  return capacity * 0.35 + utilization * 0.20 + congestion * 0.15 + pathScore * 0.10 + evacuation * 0.15 + waitScore * 0.05;
}

/** Entry in the top-K ranking heap */
type RankedEntry = {
  score: number;
  run: RunOutput;
  mapPath: string;
};

/** Min-heap to track top K results by score */
export class TopKRanking {
  private heap: RankedEntry[] = [];

  constructor(private k: number) { }

  /** Try to insert a run. Returns true if it made it into top K. */
  tryInsert(run: RunOutput, mapPath: string): boolean {
    const score = quickScore(run.metrics);

    if (this.heap.length < this.k) {
      // Heap not full, always insert
      this.heap.push({ score, run, mapPath });
      this.bubbleUp(this.heap.length - 1);
      return true;
    }

    // Heap full - check if this beats the minimum
    if (score > this.heap[0].score) {
      // Replace min with new entry
      this.heap[0] = { score, run, mapPath };
      this.bubbleDown(0);
      return true;
    }

    return false;
  }

  /** Get minimum score in heap (for progress logging) */
  getMinScore(): number {
    return this.heap.length > 0 ? this.heap[0].score : 0;
  }

  /** Get all results sorted by score (best first) */
  getResults(): RankedEntry[] {
    return [...this.heap].sort((a, b) => b.score - a.score);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

const DEFAULT_MAP_DIR = "public/maps/generated";
const DEFAULT_SEEDS = ["sim-1", "sim-2"];
const MINUTES_PER_TICK = 0.5; // matches Engine

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

async function exists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectMaps(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of paths) {
    const p = resolve(raw);
    if (!(await exists(p))) continue;
    const stat = await fs.stat(p);
    if (stat.isDirectory()) {
      const files = await listJsonFiles(p);
      out.push(...files);
    } else if (stat.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function heatColor(norm: number): [number, number, number] {
  const t = Math.pow(clamp(norm, 0, 1), 0.6); // boost contrast
  const stops = [
    { t: 0, c: [14, 165, 233] },   // cyan
    { t: 0.33, c: [34, 197, 94] }, // green
    { t: 0.66, c: [251, 191, 36] },// amber
    { t: 1, c: [239, 68, 68] },    // red
  ];
  let i = 0;
  while (i < stops.length - 1 && t > stops[i + 1].t) i++;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  const span = Math.max(1e-6, b.t - a.t);
  const k = clamp((t - a.t) / span, 0, 1);
  return [
    Math.round(lerp(a.c[0], b.c[0], k)),
    Math.round(lerp(a.c[1], b.c[1], k)),
    Math.round(lerp(a.c[2], b.c[2], k)),
  ];
}

function centerOfRect(rect: { x: number; y: number; w: number; h: number }): Vec2 {
  return { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) };
}

/** Compute derived map indices from an initialized Engine. Call once per map+agentCount. */
export function computeDerivedMapData(engine: Engine, map: BaseSpecFile): DerivedMapData {
  const corridorIdx: number[] = [];
  const barIdx: number[] = [];
  const gymIdx: number[] = [];
  let walkableCount = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const idx = engine.map.index(x, y);
      const tag = engine.map.get(x, y).tag;
      const tile = engine.map.get(x, y);
      if (tile.walkable) walkableCount++;
      if (tag === "CORRIDOR") corridorIdx.push(idx);
      if (tag === "BAR") barIdx.push(idx);
      if (tag === "GYM") gymIdx.push(idx);
    }
  }
  return { corridorIdx, barIdx, gymIdx, walkableCount };
}

/** Options for runSimulation with optional cached data */
type RunSimulationOpts = BatchOptions & {
  /** Pre-computed derived map data (to avoid re-scanning tiles) */
  derivedData?: DerivedMapData;
  /** Skip writing heatmap PNG files (for deferred top-K mode) */
  /** Skip writing heatmap PNG files (for deferred top-K mode) */
  skipHeatmapFile?: boolean;
  /** Callback for progress reporting (ticks completed) */
  onProgress?: (ticks: number) => void;
};

async function runSimulation(
  map: BaseSpecFile,
  scenario: Scenario,
  seed: string,
  opts: RunSimulationOpts
): Promise<RunOutput> {
  const cfg: EngineConfig = {
    grid: { width: map.width, height: map.height },
    diagonal: true,
    seed,
    baseTickRate: opts.tickRate,
    pixelsPerTile: 1,
    headless: true, // Skip events, density, perf stats for batch runs
  };
  const engine = new Engine(cfg);
  // Always use max capacity - pass a very high number, engine caps at room count
  engine.resetWorld(map.spec, 9999);
  const roomCapacity = engine.getRoomCapacity();
  const actualAgents = engine.getAgents().length;
  const scenarioDay = scenario === "weekend" ? 5 : 2;
  engine.tod.dayOfWeek = scenarioDay;

  const gridSize = map.width * map.height;
  const occSum = new Float64Array(gridSize);
  const occMax = new Uint16Array(gridSize);
  const stepCounts = new Uint16Array(gridSize);
  const touched: number[] = [];

  // Use cached derived data or compute fresh
  const { corridorIdx, barIdx, gymIdx, walkableCount } = opts.derivedData ?? computeDerivedMapData(engine, map);

  let agentTicks = 0;
  let stuckTicks = 0;
  const steps = Math.max(1, Math.round(opts.simMinutes / MINUTES_PER_TICK));

  for (let i = 0; i < steps; i++) {
    // 2. Report progress periodically
    if (opts.onProgress && i % 64 === 0) {
      opts.onProgress(i);
    }

    engine.stepOnce();
    agentTicks += engine.getAgents().length;
    engine.getAgents().forEach((a) => {
      const idx = engine.map.index(Math.round(a.pos.x), Math.round(a.pos.y));
      if (stepCounts[idx] === 0) touched.push(idx);
      stepCounts[idx]++;
      if (a.stuckTicks >= 2) stuckTicks++;
    });

    for (const idx of touched) {
      const c = stepCounts[idx];
      occSum[idx] += c;
      if (c > occMax[idx]) occMax[idx] = c;
      stepCounts[idx] = 0;
    }
    touched.length = 0;
  }

  const totalOcc = occSum.reduce((acc, v) => acc + v, 0);
  let maxMeanTile = 0;
  let maxInstant = 0;
  for (let i = 0; i < gridSize; i++) {
    maxMeanTile = Math.max(maxMeanTile, occSum[i] / steps);
    if (occMax[i] > maxInstant) maxInstant = occMax[i];
  }

  const corridorSum = corridorIdx.reduce((acc, idx) => acc + occSum[idx], 0);
  const corridorMean = corridorIdx.length ? corridorSum / (steps * corridorIdx.length) : 0;
  let corridorPeak = 0;
  const corridorMeans: number[] = [];
  for (const idx of corridorIdx) {
    const mean = occSum[idx] / steps;
    corridorMeans.push(mean);
    if (occMax[idx] > corridorPeak) corridorPeak = occMax[idx];
  }
  corridorMeans.sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.min(corridorMeans.length - 1, Math.floor(corridorMeans.length * 0.95)));
  const corridorP95 = corridorMeans.length ? corridorMeans[p95Index] : 0;

  const avgPathLength = engine.pathsMetrics.length
    ? engine.pathsMetrics.reduce((acc, p) => acc + p.length, 0) / engine.pathsMetrics.length
    : 0;
  const avgPathEfficiency = engine.pathsMetrics.length
    ? engine.pathsMetrics.reduce((acc, p) => acc + (p.efficiency || 0), 0) / engine.pathsMetrics.length
    : 0;

  const barArea = Math.max(1, barIdx.length);
  const gymArea = Math.max(1, gymIdx.length);
  const barOcc = engine.maxBarOccupancy[scenarioDay] || 0;
  const gymOcc = engine.maxGymOccupancy[scenarioDay] || 0;

  const exitCenter = centerOfRect(map.spec.exitRect);
  const barCenter = centerOfRect(map.spec.barRect);
  const gymCenter = centerOfRect(map.spec.gymRect);
  const exitReachable = Boolean(aStar8(engine.map, barCenter, exitCenter) && aStar8(engine.map, gymCenter, exitCenter));

  const walkableTiles = Math.max(1, walkableCount);
  let visitedTiles = 0;
  for (let i = 0; i < gridSize; i++) {
    if (occSum[i] > 0) visitedTiles++;
  }
  const coverageRatio = visitedTiles / walkableTiles;
  let hotspot: RunMetrics["hotspot"] = null;
  if (maxMeanTile > 0) {
    const idx = occSum.findIndex((v) => v / steps === maxMeanTile);
    if (idx >= 0) {
      const x = idx % map.width;
      const y = Math.floor(idx / map.width);
      hotspot = { x, y, value: maxMeanTile, tag: engine.map.get(x, y).tag };
    }
  }

  // --- Evacuation Drill ---
  // Force all agents to exit and measure time/success
  let avgExitTime = 0;
  let evacuationRate = 0;
  if (exitReachable) {
    // Find all exit tiles once
    const exits: Vec2[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (engine.map.get(x, y).tag === "EXIT") exits.push({ x, y });
      }
    }

    if (exits.length > 0) {
      // Reset heuristics for drill
      const agents = engine.getAgents();
      const initialCount = agents.length;
      if (initialCount > 0) {
        // Assign every agent to nearest exit
        for (const a of agents) {
          let nearest: Vec2 = exits[0];
          let minD = Infinity;
          for (const e of exits) {
            const d = Math.abs(a.pos.x - e.x) + Math.abs(a.pos.y - e.y); // Manhattan is fine for selection
            if (d < minD) { minD = d; nearest = e; }
          }
          // Force move command
          engine.dispatch({ type: "MOVE_AGENT_TO", id: a.id, dest: nearest });
        }

        // Run drill for 120 minutes (4 hours)
        const DRILL_MINUTES = 240;
        const MINUTES_PER_TICK = 0.5; // Engine default, but check config if variable?
        const drillSteps = Math.ceil(DRILL_MINUTES / MINUTES_PER_TICK);

        // We need to track who exited during drill. 
        // Engine removes agents to outList.
        const initialOutIds = new Set(engine.getOutList().map(o => o.id));
        let totalExitTicks = 0;
        let exitedCount = 0;

        for (let i = 0; i < drillSteps; i++) {
          engine.stepOnce();

          // Check for new exits
          const currentOut = engine.getOutList();
          if (currentOut.length > initialOutIds.size) {
            for (const rec of currentOut) {
              if (!initialOutIds.has(rec.id)) {
                // New exit
                exitedCount++;
                totalExitTicks += i; // ticks from start of drill
                initialOutIds.add(rec.id);
              }
            }
          }

          if (engine.getAgents().length === 0) break; // All gone
        }

        evacuationRate = exitedCount / initialCount;
        // avgExitTime: average ticks to exit. If didn't exit, penalize with max drill time?
        // User requested "Time to exit". 
        // If we use only successful exits, it ignores stuck agents.
        // Metric "Average Exit Time" usually implies successful exits.
        // The score handles the fail case.
        avgExitTime = exitedCount > 0 ? (totalExitTicks / exitedCount) : drillSteps;
      }
    }
  }

  let heatmap: RunOutput["heatmap"];
  let heatmapData: RunOutput["heatmapData"];

  if (opts.heatmap) {
    // Compute normalized occupancy grid
    const maxForNorm = Math.max(1e-6, maxMeanTile);

    if (opts.heatmapJson || opts.skipHeatmapFile) {
      // JSON mode: store normalized data inline (much faster, no PNG encoding)
      // Also used when skipHeatmapFile is set for deferred top-K heatmap generation
      const data: number[] = new Array(gridSize);
      for (let i = 0; i < gridSize; i++) {
        // Round to 3 decimal places to reduce JSON size
        data[i] = Math.round((occSum[i] / steps / maxForNorm) * 1000) / 1000;
      }
      heatmapData = {
        width: map.width,
        height: map.height,
        data,
        maxMean: maxMeanTile,
        maxInstant,
      };
    } else {
      // PNG mode (legacy): render to image file
      const scale = Math.max(1, Math.floor(opts.heatmapScale));

      // Fast mode: skip Gaussian blur, use raw occupancy data normalized
      let grid: Float64Array;
      let max: number;
      if (opts.heatmapFast) {
        // Direct normalization without blur
        grid = new Float64Array(gridSize);
        max = 0;
        for (let i = 0; i < gridSize; i++) {
          const v = occSum[i] / steps;
          grid[i] = v;
          if (v > max) max = v;
        }
      } else {
        const smooth = smoothGrid(occSum, map.width, map.height, steps);
        grid = smooth.grid;
        max = smooth.max;
      }

      const png = new PNG({ width: map.width * scale, height: map.height * scale });
      const pngMaxNorm = Math.max(1e-6, max);
      grid.forEach((mean, idx) => {
        const norm = mean / pngMaxNorm;
        const [r, g, b] = heatColor(norm);
        const x = idx % map.width;
        const y = Math.floor(idx / map.width);
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x * scale + sx;
            const py = y * scale + sy;
            const o = (py * png.width + px) * 4;
            png.data[o] = r;
            png.data[o + 1] = g;
            png.data[o + 2] = b;
            png.data[o + 3] = 255;
          }
        }
      });
      const dir = resolve(opts.outDir, slugify(map.name || fileStem("map")), scenario);
      await ensureDir(dir);
      const pngPath = resolve(dir, `run-${slugify(seed)}__heatmap.png`);
      const buffer = PNG.sync.write(png);
      await fs.writeFile(pngPath, buffer);
      heatmap = { png: pngPath, rel: relative(process.cwd(), pngPath), maxMean: maxMeanTile, maxInstant };
    }
  }

  const metrics: RunMetrics = {
    avgPathLength,
    pathSamples: engine.pathsMetrics.length,
    meanOccupancy: totalOcc / (steps * gridSize),
    maxOccupancy: maxInstant,
    maxMeanTile,
    corridorMeanDensity: corridorMean,
    corridorPeakDensity: corridorPeak,
    corridorP95,
    barOccupancyRatio: barOcc / barArea,
    gymOccupancyRatio: gymOcc / gymArea,
    stuckRate: agentTicks > 0 ? stuckTicks / agentTicks : 0,
    exitReachable,
    agentTicks,
    stuckTicks,
    coverageRatio,
    hotspot,
    roomCapacity,
    actualAgents,
    // New metrics
    avgExitTime,
    evacuationRate,
    avgPathEfficiency,
  };

  const run: RunOutput = {
    map: map.name || fileStem("map"),
    scenario,
    seed,
    agentCount: opts.agentCount,
    simMinutes: opts.simMinutes,
    steps,
    metrics,
    heatmap,
    heatmapData,
    meta: {
      mapFile: map.meta?.["sourcePath"] ?? map.meta?.["mapFile"] ?? "",
      params: map.meta?.["params"],
      generatedAt: new Date().toISOString(),
    },
  };

  return run;
}

export async function runBatch(opts: BatchOptions): Promise<RunOutput[]> {
  const results: RunOutput[] = [];

  for (const mapPath of opts.maps) {
    const map = await loadMapFile(mapPath);
    (map.meta ??= {}).sourcePath = mapPath;
    for (const scenario of opts.scenarios) {
      for (const seed of opts.seeds) {
        const run = await runSimulation(map, scenario, seed, opts);
        const dir = resolve(opts.outDir, slugify(map.name || fileStem(mapPath)), scenario);
        await ensureDir(dir);
        const outPath = resolve(dir, `run-${slugify(seed)}.json`);
        await writeJson(outPath, run);
        // eslint-disable-next-line no-console
        console.log(`Saved ${outPath}`);
        results.push(run);
      }
    }
  }

  return results;
}

/**
 * Run a single simulation task (used by worker threads).
 * Loads map, runs simulation, saves results, returns summary.
 * Accepts optional pre-loaded map and derived data for caching.
 * When skipFileIO is set, returns RunOutput for main thread to filter/write.
 */
export async function runSimulationTask(
  task: SimulationTask,
  cachedMap?: BaseSpecFile,
  cachedDerived?: DerivedMapData,
  onProgress?: (ticks: number) => void
): Promise<SimulationResult> {
  const map = cachedMap ?? await loadMapFile(task.mapPath);
  (map.meta ??= {}).sourcePath = task.mapPath;

  const opts: RunSimulationOpts = {
    maps: [task.mapPath],
    outDir: task.outDir,
    agentCount: task.agentCount,
    seeds: [task.seed],
    simMinutes: task.simMinutes,
    scenarios: [task.scenario],
    tickRate: task.tickRate,
    heatmap: task.heatmap,
    heatmapScale: task.heatmapScale,
    heatmapFast: task.heatmapFast,
    heatmapJson: task.heatmapJson,
    derivedData: cachedDerived,
    // Defer heatmap PNG writes when doing top-K filtering
    skipHeatmapFile: task.skipFileIO,
    onProgress,
  };

  const run = await runSimulation(map, task.scenario, task.seed, opts);
  const mapName = map.name || fileStem(task.mapPath);

  // When skipFileIO is set, return RunOutput for top-K filtering in main thread
  if (task.skipFileIO) {
    return {
      outputPath: "",
      mapName,
      scenario: task.scenario,
      seed: task.seed,
      runOutput: run,
      mapPath: task.mapPath,
    };
  }

  // Normal path: write to disk immediately
  const dir = resolve(task.outDir, slugify(mapName), task.scenario);
  await ensureDir(dir);
  const outPath = resolve(dir, `run-${slugify(task.seed)}.json`);
  await writeJson(outPath, run);

  return {
    outputPath: outPath,
    mapName,
    scenario: task.scenario,
    seed: task.seed,
  };
}

/**
 * Run batch simulations in parallel using worker threads.
 * When topK is set, only writes results for maps that make it into the top K.
 */
export async function runBatchParallel(
  opts: BatchOptions & { workers?: number; onProgress?: (completed: number, total: number, taskId?: number, subProgress?: number) => void }
): Promise<SimulationResult[]> {
  const workerPath = resolve(import.meta.dirname ?? __dirname, "sim-worker.ts");
  const workerCount = opts.workers ?? getDefaultWorkerCount();
  const useTopK = !!(opts.topK && opts.topK > 0);

  // Build task list
  const tasks: SimulationTask[] = [];
  for (const mapPath of opts.maps) {
    for (const scenario of opts.scenarios) {
      for (const seed of opts.seeds) {
        tasks.push({
          mapPath,
          scenario,
          seed,
          agentCount: opts.agentCount,
          simMinutes: opts.simMinutes,
          tickRate: opts.tickRate,
          heatmap: opts.heatmap,
          heatmapScale: opts.heatmapScale,
          heatmapFast: opts.heatmapFast,
          heatmapJson: opts.heatmapJson ?? true, // Default to JSON mode (no PNGs)
          outDir: opts.outDir,
          // Skip file I/O when using top-K filtering
          skipFileIO: useTopK,
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Running ${tasks.length} simulations with ${workerCount} workers${useTopK ? ` (top-K=${opts.topK})` : ""}...`);

  const results = await runParallelTasks<SimulationTask, SimulationResult>(
    tasks,
    workerPath,
    workerCount,
    (completed, total, taskId, subProgress) => {
      // Calculate approximate total progress if we knew total ticks per task.
      // We know task.simMinutes -> total ticks.
      // But here we just log granular updates occasionally to avoid spamming
      if (subProgress !== undefined && subProgress % 512 === 0) { // Log every ~512 ticks
        // Using strict stdout write for cleaner logs if TTY
        // process.stdout.write(`\r[${completed}/${total}] Task ${taskId}: Ticks ${subProgress}   `);
        // But strict logging is safer for now
      }

      if (subProgress === undefined || subProgress === 0) {
        // eslint-disable-next-line no-console
        console.log(`[${completed}/${total}] Completed task ${taskId}`);
      }

      if (opts.onProgress) {
        // Pass taskId and subProgress (ticks) to caller
        // We cast to any because BatchOptions might define a simpler callback signature,
        // but passing extra args is safe in JS/TS if the receiver handles it.
        // Actually, let's update the signature in the function args.
        opts.onProgress(completed, total, taskId, subProgress);
      }
    }
  );

  // Extract successful results
  const successful: SimulationResult[] = [];
  const errors: string[] = [];

  for (const r of results) {
    if (r.result) {
      successful.push(r.result);
    } else if (r.error) {
      errors.push(`Task ${r.id}: ${r.error}`);
    }
  }

  if (errors.length) {
    // eslint-disable-next-line no-console
    console.warn(`${errors.length} tasks failed:\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ""}`);
  }

  // When using top-K, filter results and write only the best ones
  if (useTopK && opts.topK) {
    const ranking = new TopKRanking(opts.topK);

    // Insert all results into the ranking
    for (const r of successful) {
      if (r.runOutput) {
        ranking.tryInsert(r.runOutput, r.mapPath || "");
      }
    }

    // Write only the top K results to disk
    const topResults = ranking.getResults();
    const written: SimulationResult[] = [];

    // eslint-disable-next-line no-console
    console.log(`Finalizing results: filtering top ${opts.topK} maps and writing to disk...`);
    // eslint-disable-next-line no-console
    console.log(`Top-K filter: writing ${topResults.length} of ${successful.length} results...`);

    for (const entry of topResults) {
      const run = entry.run;
      const mapName = run.map;
      const dir = resolve(opts.outDir, slugify(mapName), run.scenario);
      await ensureDir(dir);

      // Render heatmap PNG from stored JSON data (only for top-K results)
      if (opts.heatmap && run.heatmapData && !run.heatmap) {
        const { width, height, data, maxMean, maxInstant } = run.heatmapData;
        const scale = Math.max(1, Math.floor(opts.heatmapScale));
        const png = new PNG({ width: width * scale, height: height * scale });
        const maxForNorm = Math.max(1e-6, Math.max(...data));

        for (let i = 0; i < data.length; i++) {
          const norm = data[i] / maxForNorm;
          const [r, g, b] = heatColor(norm);
          const x = i % width;
          const y = Math.floor(i / width);
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = x * scale + sx;
              const py = y * scale + sy;
              const o = (py * png.width + px) * 4;
              png.data[o] = r;
              png.data[o + 1] = g;
              png.data[o + 2] = b;
              png.data[o + 3] = 255;
            }
          }
        }

        const pngPath = resolve(dir, `run-${slugify(run.seed)}__heatmap.png`);
        const buffer = PNG.sync.write(png);
        await fs.writeFile(pngPath, buffer);
        run.heatmap = { png: pngPath, rel: relative(process.cwd(), pngPath), maxMean, maxInstant };
      }

      const outPath = resolve(dir, `run-${slugify(run.seed)}.json`);
      await writeJson(outPath, run);

      written.push({
        outputPath: outPath,
        mapName,
        scenario: run.scenario,
        seed: run.seed,
      });
    }

    // eslint-disable-next-line no-console
    console.log(`Completed ${successful.length}/${tasks.length} simulations, wrote top ${written.length}`);

    return written;
  }

  // eslint-disable-next-line no-console
  console.log(`Completed ${successful.length}/${tasks.length} simulations`);

  return successful;
}

async function cli() {
  const args = parseArgv(process.argv.slice(2));
  const outDir = resolve(String(args.outDir || "results"));
  const agentCount = Number(args.agents ?? 80);
  const simMinutes = Number(args.minutes ?? 1440);
  const tickRate = Number(args.tickRate ?? 20);
  const scenarioList = parseCsv(typeof args.scenarios === "string" ? args.scenarios : undefined) as Scenario[];
  const scenarios = scenarioList.length ? scenarioList : (["weekday", "weekend"] as Scenario[]);
  const heatmap = args.heatmap !== false && args.heatmap !== "false";
  const heatmapScale = Number(args.heatmapScale ?? 3);

  let seedList = parseCsv(typeof args.seeds === "string" ? args.seeds : undefined);
  const runs = Number(args.runs ?? 0);
  if ((!seedList || !seedList.length) && runs > 0) {
    seedList = Array.from({ length: runs }, (_, i) => `run-${i + 1}`);
  }
  const seeds = (seedList && seedList.length ? seedList : DEFAULT_SEEDS).map(s => s.trim()).filter(Boolean);

  let mapInputs = parseCsv(typeof args.maps === "string" ? args.maps : undefined);
  if (args.mapsDir && typeof args.mapsDir === "string") {
    mapInputs.push(args.mapsDir);
  }
  if (!mapInputs.length) {
    mapInputs = [DEFAULT_MAP_DIR, "public/maps"];
  }
  const mapFiles = await collectMaps(mapInputs);
  if (!mapFiles.length) throw new Error("No map files found. Run generate-maps first or point --maps to files.");

  await runBatch({
    maps: mapFiles,
    outDir,
    agentCount: Number.isFinite(agentCount) ? agentCount : 80,
    seeds,
    simMinutes: Number.isFinite(simMinutes) ? simMinutes : 1440,
    scenarios,
    tickRate: Number.isFinite(tickRate) ? tickRate : 20,
    heatmap,
    heatmapScale: Number.isFinite(heatmapScale) ? heatmapScale : 3,
  });
}

if (directCliRun(import.meta.url)) {
  cli().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
