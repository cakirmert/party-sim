import { promises as fs } from "node:fs";
import { resolve, relative } from "node:path";
import { PNG } from "pngjs";
import { Engine } from "../src/lib/engine/Engine";
import { aStar8 } from "../src/lib/engine/Pathfinder";
import type { EngineConfig, Vec2 } from "../src/lib/engine/Types";
import {
  BaseSpecFile,
  directCliRun,
  ensureDir,
  fileStem,
  listJsonFiles,
  loadMapFile,
  parseArgv,
  parseCsv,
  slugify,
  writeJson,
} from "./pipeline-utils";

type Scenario = "weekday" | "weekend";

type RunMetrics = {
  avgPathLength: number;
  pathSamples: number;
  meanOccupancy: number;
  maxOccupancy: number;
  maxMeanTile: number;
  corridorMeanDensity: number;
  corridorPeakDensity: number;
  barOccupancyRatio: number;
  gymOccupancyRatio: number;
  stuckRate: number;
  exitReachable: boolean;
  agentTicks: number;
  stuckTicks: number;
};

type RunOutput = {
  map: string;
  scenario: Scenario;
  seed: string;
  agentCount: number;
  simMinutes: number;
  steps: number;
  metrics: RunMetrics;
  heatmap?: { png: string; rel: string; maxMean: number; maxInstant: number };
  meta: Record<string, unknown>;
};

type BatchOptions = {
  maps: string[];
  outDir: string;
  agentCount: number;
  seeds: string[];
  simMinutes: number;
  scenarios: Scenario[];
  tickRate: number;
  heatmap: boolean;
};

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

function heatColor(norm: number): [number, number, number] {
  const t = clamp(norm, 0, 1);
  if (t < 0.5) {
    const k = t / 0.5; // 0..1
    const r = 255;
    const g = Math.round(255 * k);
    const b = 50;
    return [r, g, b];
  }
  const k = (t - 0.5) / 0.5;
  const r = 255;
  const g = Math.round(255 * (1 - k));
  const b = Math.round(50 * (1 - k));
  return [r, g, b];
}

function centerOfRect(rect: { x: number; y: number; w: number; h: number }): Vec2 {
  return { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) };
}

async function runSimulation(map: BaseSpecFile, scenario: Scenario, seed: string, opts: BatchOptions): Promise<RunOutput> {
  const cfg: EngineConfig = {
    grid: { width: map.width, height: map.height },
    diagonal: true,
    seed,
    baseTickRate: opts.tickRate,
    pixelsPerTile: 1,
  };
  const engine = new Engine(cfg, map.spec);
  engine.resetWorld(map.spec, opts.agentCount);
  const scenarioDay = scenario === "weekend" ? 5 : 2;
  engine.tod.dayOfWeek = scenarioDay;

  const gridSize = map.width * map.height;
  const occSum = new Float64Array(gridSize);
  const occMax = new Uint16Array(gridSize);
  const stepCounts = new Uint16Array(gridSize);
  const touched: number[] = [];

  const corridorIdx: number[] = [];
  const barIdx: number[] = [];
  const gymIdx: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const idx = engine.map.index(x, y);
      const tag = engine.map.get(x, y).tag;
      if (tag === "CORRIDOR") corridorIdx.push(idx);
      if (tag === "BAR") barIdx.push(idx);
      if (tag === "GYM") gymIdx.push(idx);
    }
  }

  let agentTicks = 0;
  let stuckTicks = 0;
  const steps = Math.max(1, Math.round(opts.simMinutes / MINUTES_PER_TICK));

  for (let i = 0; i < steps; i++) {
    engine.stepOnce();
    const agents = engine.getAgents();
    agentTicks += agents.length;
    for (const a of agents) {
      const idx = engine.map.index(a.pos.x, a.pos.y);
      if (stepCounts[idx] === 0) touched.push(idx);
      stepCounts[idx]++;
      if (a.stuckTicks >= 2) stuckTicks++;
    }

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
  for (const idx of corridorIdx) {
    if (occMax[idx] > corridorPeak) corridorPeak = occMax[idx];
  }

  const avgPathLength = engine.pathsMetrics.length
    ? engine.pathsMetrics.reduce((acc, p) => acc + p.length, 0) / engine.pathsMetrics.length
    : 0;

  const barArea = Math.max(1, barIdx.length);
  const gymArea = Math.max(1, gymIdx.length);
  const barOcc = engine.maxBarOccupancy[scenarioDay] || 0;
  const gymOcc = engine.maxGymOccupancy[scenarioDay] || 0;

  const exitCenter = centerOfRect(map.spec.exitRect);
  const barCenter = centerOfRect(map.spec.barRect);
  const gymCenter = centerOfRect(map.spec.gymRect);
  const exitReachable = Boolean(aStar8(engine.map, barCenter, exitCenter) && aStar8(engine.map, gymCenter, exitCenter));

  let heatmap: RunOutput["heatmap"];
  if (opts.heatmap) {
    const png = new PNG({ width: map.width, height: map.height });
    const maxForNorm = Math.max(1e-6, maxMeanTile);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const idx = y * map.width + x;
        const mean = occSum[idx] / steps;
        const norm = mean / maxForNorm;
        const [r, g, b] = heatColor(norm);
        const o = (y * map.width + x) * 4;
        png.data[o] = r;
        png.data[o + 1] = g;
        png.data[o + 2] = b;
        png.data[o + 3] = 255;
      }
    }
    const dir = resolve(opts.outDir, slugify(map.name || fileStem("map")), scenario);
    await ensureDir(dir);
    const pngPath = resolve(dir, `run-${slugify(seed)}__heatmap.png`);
    const buffer = PNG.sync.write(png);
    await fs.writeFile(pngPath, buffer);
    heatmap = { png: pngPath, rel: relative(process.cwd(), pngPath), maxMean: maxMeanTile, maxInstant };
  }

  const metrics: RunMetrics = {
    avgPathLength,
    pathSamples: engine.pathsMetrics.length,
    meanOccupancy: totalOcc / (steps * gridSize),
    maxOccupancy: maxInstant,
    maxMeanTile,
    corridorMeanDensity: corridorMean,
    corridorPeakDensity: corridorPeak,
    barOccupancyRatio: barOcc / barArea,
    gymOccupancyRatio: gymOcc / gymArea,
    stuckRate: agentTicks > 0 ? stuckTicks / agentTicks : 0,
    exitReachable,
    agentTicks,
    stuckTicks,
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

async function cli() {
  const args = parseArgv(process.argv.slice(2));
  const outDir = resolve(String(args.outDir || "results"));
  const agentCount = Number(args.agents ?? 80);
  const simMinutes = Number(args.minutes ?? 1440);
  const tickRate = Number(args.tickRate ?? 20);
  const scenarioList = parseCsv(typeof args.scenarios === "string" ? args.scenarios : undefined) as Scenario[];
  const scenarios = scenarioList.length ? scenarioList : (["weekday", "weekend"] as Scenario[]);
  const heatmap = args.heatmap !== false && args.heatmap !== "false";

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
  });
}

if (directCliRun(import.meta.url)) {
  cli().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
