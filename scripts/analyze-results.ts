import { promises as fs } from "node:fs";
import { relative, resolve } from "node:path";
import {
  directCliRun,
  ensureDir,
  parseArgv,
  writeJson,
  slugify,
  readJson,
  listJsonFiles
} from "./shared-utils";

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
  stuckTicks: number;
  coverageRatio: number;
  avgExitTime?: number;
  evacuationRate?: number;
};

type RunOutput = {
  map: string;
  scenario: Scenario;
  seed: string;
  agentCount: number;
  simMinutes: number;
  steps: number;
  metrics: RunMetrics;
  heatmap?: { png: string; maxMean: number; maxInstant: number };
  meta: Record<string, unknown>;
};

type Aggregated = {
  map: string;
  runs: RunOutput[];
  metrics: {
    avgPathLength: number;
    corridorMeanDensity: number;
    corridorPeakDensity: number;
    corridorP95: number;
    stuckRate: number;
    barOccupancyRatio: number;
    gymOccupancyRatio: number;
    meanOccupancy: number;
    exitSuccess: number;
    coverageRatio: number;
    roomCapacity: number;
    actualAgents: number;
    avgExitTime: number;
    evacuationRate: number;
  };
  score: number;
  rank: number;
  scoreBreakdown?: Record<string, number>; // New breakdown field
  heatmaps: string[];
  params?: unknown;
  mapFile?: string;
  runPath?: string;
};

type WeightConfig = {
  // Allow nested weights or flat properties
  weights?: {
    capacity: number;
    utilization: number;
    congestion: number;
    path: number;
    evacuation: number;
    wait: number;
  };
};

async function findRunFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findRunFiles(full);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.startsWith("run-") && entry.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function normalizeLower(values: number[], value: number): number {
  if (!values.length) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 1;
  return (max - value) / (max - min);
}

function normalizeHigher(values: number[], value: number): number {
  if (!values.length) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 1;
  return (value - min) / (max - min);
}

function aggregateRuns(runs: RunOutput[]): Aggregated[] {
  const byMap = new Map<string, RunOutput[]>();
  for (const run of runs) {
    const key = run.map;
    if (!byMap.has(key)) byMap.set(key, []);
    byMap.get(key)!.push(run);
  }

  const aggregates: Aggregated[] = [];

  for (const [map, list] of byMap.entries()) {
    const metrics = {
      avgPathLength: mean(list.map(r => r.metrics.avgPathLength)),
      corridorMeanDensity: mean(list.map(r => r.metrics.corridorMeanDensity)),
      corridorPeakDensity: mean(list.map(r => r.metrics.corridorPeakDensity)),
      corridorP95: mean(list.map(r => r.metrics.corridorP95)),
      stuckRate: mean(list.map(r => r.metrics.stuckRate)),
      barOccupancyRatio: mean(list.map(r => r.metrics.barOccupancyRatio)),
      gymOccupancyRatio: mean(list.map(r => r.metrics.gymOccupancyRatio)),
      meanOccupancy: mean(list.map(r => r.metrics.meanOccupancy)),
      exitSuccess: mean(list.map(r => (r.metrics.exitReachable ? 1 : 0))),
      coverageRatio: mean(list.map(r => r.metrics.coverageRatio)),
      roomCapacity: mean(list.map(r => (r.metrics as any).roomCapacity || 0)),
      actualAgents: mean(list.map(r => (r.metrics as any).actualAgents || 0)),
      avgExitTime: mean(list.map(r => r.metrics.avgExitTime || 0)),
      evacuationRate: mean(list.map(r => r.metrics.evacuationRate || 0)),
    };

    const heatmaps = list
      .map(r => r.heatmap?.png)
      .filter((p): p is string => Boolean(p));

    aggregates.push({
      map,
      runs: list,
      metrics,
      score: 0,
      rank: 0,
      heatmaps,
      params: list[0]?.meta?.["params"],
      mapFile: list[0]?.meta?.["mapFile"] as string | undefined,
      // Pass the relative path to the best run (first in list usually, but let's pick the one with max score or simply the first since they are same map?)
      // Actually we sort later. So in this list they are just all runs for this map.
      // We can just pick the first one's path to allow fetching heatmapData.
      // RunOutput doesn't explicitly have its own path, but we know the dir structure.
      // Or we can rely on findRunFiles to have populated something? No.
      // We need to resolve the path. 
      // The best way is to infer it: slugify(seed).json in the scenario dir.
      // Let's attach a 'runFile' property to the aggregate.
      // Use the actual file path if available to construct the relative URL path
      runPath: list[0].meta?.filePath
        ? relative(process.cwd(), list[0].meta.filePath as string).split("\\").join("/")
        : `${slugify(map)}/${list[0].scenario}/run-${slugify(list[0].seed)}.json`,
    });
  }

  return aggregates;
}

// Helper to compute statistics
function getStats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance) || 1e-9; // Avoid div by zero
  return { mean, stdDev };
}

// Z-Score normalization
function normalizeZ(val: number, mean: number, std: number, lowerIsBetter: boolean): number {
  if (lowerIsBetter) {
    return (mean - val) / std;
  }
  return (val - mean) / std;
}

function scoreMaps(items: Aggregated[], cfg: WeightConfig): Aggregated[] {
  if (items.length === 0) return items;

  // 1. Collect all raw metrics
  const capacityVals = items.map(i => i.metrics.roomCapacity || i.metrics.actualAgents);
  const barVals = items.map(i => i.metrics.barOccupancyRatio);
  const gymVals = items.map(i => i.metrics.gymOccupancyRatio);
  const congestionVals = items.map(i => i.metrics.corridorP95);
  const pathVals = items.map(i => i.metrics.avgPathLength);
  const evacRateVals = items.map(i => (i.metrics as any).evacuationRate || 0);
  const evacTimeVals = items.map(i => (i.metrics as any).avgExitTime || 9999);
  const stuckVals = items.map(i => i.metrics.stuckRate);

  // Stats
  const sCap = getStats(capacityVals);
  const sBar = getStats(barVals);
  const sGym = getStats(gymVals);
  const sCong = getStats(congestionVals);
  const sPath = getStats(pathVals);
  const sEvRate = getStats(evacRateVals);
  const sEvTime = getStats(evacTimeVals);
  const sStuck = getStats(stuckVals);

  // Default weights matching notes.md
  const w = cfg.weights || {
    capacity: 0.35,
    utilization: 0.20,
    congestion: 0.15,
    path: 0.10,
    evacuation: 0.15,
    wait: 0.05,
  };

  for (const item of items) {
    const m = item.metrics;

    // 2. Compute 0-100 Score for each Metric (Bell Curve grading)
    // Formula: 50 + (Z * 15), clamped to [0, 100]

    // Capacity
    const zCap = normalizeZ(m.roomCapacity || m.actualAgents, sCap.mean, sCap.stdDev, false);
    const scoreCap = Math.max(0, Math.min(100, 50 + zCap * 15));

    // Utilization (Bar & Gym)
    const zBar = normalizeZ(m.barOccupancyRatio, sBar.mean, sBar.stdDev, true);
    const scoreBar = Math.max(0, Math.min(100, 50 + zBar * 15));

    const zGym = normalizeZ(m.gymOccupancyRatio, sGym.mean, sGym.stdDev, true);
    const scoreGym = Math.max(0, Math.min(100, 50 + zGym * 15));

    const scoreUtil = (scoreBar + scoreGym) / 2;

    // Congestion
    const zCong = normalizeZ(m.corridorP95, sCong.mean, sCong.stdDev, true);
    const scoreCong = Math.max(0, Math.min(100, 50 + zCong * 15));

    // Path
    const zPath = normalizeZ(m.avgPathLength, sPath.mean, sPath.stdDev, true);
    const scorePath = Math.max(0, Math.min(100, 50 + zPath * 15));

    // Evacuation
    const zEvRate = normalizeZ((m as any).evacuationRate || 0, sEvRate.mean, sEvRate.stdDev, false);
    const scoreEvRate = Math.max(0, Math.min(100, 50 + zEvRate * 15));

    const zEvTime = normalizeZ((m as any).avgExitTime || 0, sEvTime.mean, sEvTime.stdDev, true);
    const scoreEvTime = Math.max(0, Math.min(100, 50 + zEvTime * 15));

    const scoreEvac = scoreEvRate * 0.6 + scoreEvTime * 0.4;

    // Wait/Stuck
    const zStuck = normalizeZ(m.stuckRate, sStuck.mean, sStuck.stdDev, true);
    const scoreStuck = Math.max(0, Math.min(100, 50 + zStuck * 15));

    // 3. Weighted Average of Component Scores
    const totalWeight = w.capacity + w.utilization + w.congestion + w.path + w.evacuation + w.wait;
    const finalScore = (
      scoreCap * w.capacity +
      scoreUtil * w.utilization +
      scoreCong * w.congestion +
      scorePath * w.path +
      scoreEvac * w.evacuation +
      scoreStuck * w.wait
    ) / totalWeight;

    item.score = Number(finalScore.toFixed(1));

    // 5. Breakdown (Store the 0-100 score for each component)
    item.scoreBreakdown = {
      capacity: Number(scoreCap.toFixed(1)),
      utilization: Number(scoreUtil.toFixed(1)),
      congestion: Number(scoreCong.toFixed(1)),
      path: Number(scorePath.toFixed(1)),
      evacuation: Number(scoreEvac.toFixed(1)),
      wait: Number(scoreStuck.toFixed(1)),
    };
  }

  items.sort((a, b) => b.score - a.score);
  items.forEach((item, i) => { item.rank = i + 1; });
  return items;
}

async function writeCsv(path: string, rows: Aggregated[]) {
  const header = [
    "rank",
    "map",
    "score",
    "avgPathLength",
    "corridorMeanDensity",
    "corridorPeakDensity",
    "corridorP95",
    "stuckRate",
    "barOccupancyRatio",
    "gymOccupancyRatio",
    "meanOccupancy",
    "coverageRatio",
    "exitSuccess",
    "evacuationRate",
    "avgExitTime",
    "runs",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.rank,
      JSON.stringify(row.map),
      row.score.toFixed(4),
      row.metrics.avgPathLength.toFixed(3),
      row.metrics.corridorMeanDensity.toFixed(3),
      row.metrics.corridorPeakDensity.toFixed(3),
      row.metrics.corridorP95.toFixed(3),
      row.metrics.stuckRate.toFixed(4),
      row.metrics.barOccupancyRatio.toFixed(3),
      row.metrics.gymOccupancyRatio.toFixed(3),
      row.metrics.meanOccupancy.toFixed(3),
      row.metrics.coverageRatio.toFixed(3),
      row.metrics.exitSuccess.toFixed(3),
      row.metrics.evacuationRate.toFixed(3),
      row.metrics.avgExitTime.toFixed(1),
      row.runs.length,
    ].join(","));
  }
  await fs.writeFile(path, lines.join("\n"), "utf8");
}

async function writeHtml(path: string, rows: Aggregated[], root: string) {
  const lines: string[] = [];
  lines.push("<html><head><title>Map Sweep Report</title>");
  lines.push(`<style>body{font-family:Inter,Arial,sans-serif;padding:24px;background:#0b1021;color:#e2e8f0;}
  table{border-collapse:collapse;width:100%;margin-top:12px;}
  th,td{border:1px solid #1f2937;padding:8px;font-size:14px;}
  th{background:#111827;color:#f8fafc;text-align:left;}
  tr:nth-child(even){background:#111827;}
  tr:nth-child(odd){background:#0f172a;}
  a{color:#60a5fa;text-decoration:none;}
  </style></head><body>`);
  lines.push("<h1>Map Sweep Ranking</h1>");
  lines.push("<table>");
  lines.push("<tr><th>Rank</th><th>Map</th><th>Score</th><th>Avg Path</th><th>Peak Corridor</th><th>Stuck Rate</th><th>Exit OK</th><th>Heatmap</th></tr>");
  for (const row of rows) {
    const heat = row.heatmaps[0] ? relative(root, row.heatmaps[0]) : "";
    const heatLink = heat ? `<a href="${heat}">heatmap</a>` : "";
    lines.push(`<tr><td>${row.rank}</td><td>${row.map}</td><td>${row.score.toFixed(3)}</td>
      <td>${row.metrics.avgPathLength.toFixed(2)}</td>
      <td>${row.metrics.corridorPeakDensity.toFixed(2)}</td>
      <td>${row.metrics.stuckRate.toFixed(4)}</td>
      <td>${row.metrics.exitSuccess.toFixed(2)}</td>
      <td>${heatLink}</td></tr>`);
  }
  lines.push("</table></body></html>");
  await fs.writeFile(path, lines.join("\n"), "utf8");
}

export async function analyzeResults(resultsDir: string, outDir: string, weights: WeightConfig) {
  const runFiles = await findRunFiles(resultsDir);
  if (!runFiles.length) throw new Error(`No run-*.json files found in ${resultsDir}`);

  const runs: RunOutput[] = [];
  for (const file of runFiles) {
    const raw = await fs.readFile(file, "utf8");
    try {
      const parsed = JSON.parse(raw) as RunOutput;
      // Attach source file path for correct API URL generation
      parsed.meta = parsed.meta || {};
      parsed.meta.filePath = file;
      runs.push(parsed);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping invalid run file ${file}: ${(e as Error).message}`);
    }
  }

  const aggregates = scoreMaps(aggregateRuns(runs), weights);

  await ensureDir(outDir);
  await writeJson(resolve(outDir, "ranking.json"), {
    generatedAt: new Date().toISOString(),
    weights,
    maps: aggregates,
  });
  await writeCsv(resolve(outDir, "ranking.csv"), aggregates);
  await writeHtml(resolve(outDir, "report.html"), aggregates, outDir);

  // eslint-disable-next-line no-console
  console.log(`Analyzed ${runs.length} runs across ${aggregates.length} maps. Top: ${aggregates[0]?.map ?? "n/a"}.`);
}

async function cli() {
  const args = parseArgv(process.argv.slice(2));
  const resultsDir = resolve(String(args.results || args.input || "results"));
  const outDir = resolve(String(args.outDir || resolve(resultsDir, "analysis")));
  const weights: WeightConfig = {
    weights: {
      capacity: Number(args["w-capacity"] ?? 0.35),
      utilization: Number(args["w-util"] ?? 0.20),
      congestion: Number(args["w-congestion"] ?? 0.15),
      path: Number(args["w-path"] ?? 0.10),
      evacuation: Number(args["w-evacuation"] ?? 0.15),
      wait: Number(args["w-wait"] ?? 0.05),
    }
  };
  await analyzeResults(resultsDir, outDir, weights);
}

if (directCliRun(import.meta.url)) {
  cli().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
