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
  corridorP95: number;
  barOccupancyRatio: number;
  gymOccupancyRatio: number;
  stuckRate: number;
  exitReachable: boolean;
  agentTicks: number;
  stuckTicks: number;
  coverageRatio: number;
  hotspot: { x: number; y: number; value: number; tag?: string } | null;
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

type BatchOptions = {
  maps: string[];
  outDir: string;
  agentCount: number;
  seeds: string[];
  simMinutes: number;
  scenarios: Scenario[];
  tickRate: number;
  heatmap: boolean;
  heatmapScale: number;
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

  let heatmap: RunOutput["heatmap"];
  if (opts.heatmap) {
    const scale = Math.max(1, Math.floor(opts.heatmapScale));
    const smooth = smoothGrid(occSum, map.width, map.height, steps);
    const png = new PNG({ width: map.width * scale, height: map.height * scale });
    const maxForNorm = Math.max(1e-6, smooth.max);
    smooth.grid.forEach((mean, idx) => {
      const norm = mean / maxForNorm;
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
