import { promises as fs } from "node:fs";
import { relative, resolve } from "node:path";
import { directCliRun, ensureDir, parseArgv, writeJson } from "./pipeline-utils";

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
    stuckRate: number;
    barOcc: number;
    gymOcc: number;
    exitSuccess: number;
  };
  score: number;
  rank: number;
  heatmaps: string[];
  params?: unknown;
  mapFile?: string;
};

type WeightConfig = {
  flow: number;
  wait: number;
  cluster: number;
  exit: number;
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
      stuckRate: mean(list.map(r => r.metrics.stuckRate)),
      barOcc: mean(list.map(r => r.metrics.barOccupancyRatio)),
      gymOcc: mean(list.map(r => r.metrics.gymOccupancyRatio)),
      exitSuccess: mean(list.map(r => (r.metrics.exitReachable ? 1 : 0))),
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
    });
  }

  return aggregates;
}

function scoreMaps(items: Aggregated[], weights: WeightConfig): Aggregated[] {
  const waitMetric = (m: Aggregated["metrics"]) => m.stuckRate + Math.max(0, m.barOcc - 1) + Math.max(0, m.gymOcc - 1);

  const flowVals = items.map(i => i.metrics.avgPathLength);
  const waitVals = items.map(i => waitMetric(i.metrics));
  const clusterVals = items.map(i => i.metrics.corridorPeakDensity);
  const exitVals = items.map(i => i.metrics.exitSuccess);

  const totalWeight = Math.max(1e-6, weights.flow + weights.wait + weights.cluster + weights.exit);

  for (const item of items) {
    const flowScore = normalizeLower(flowVals, item.metrics.avgPathLength);
    const waitScore = normalizeLower(waitVals, waitMetric(item.metrics));
    const clusterScore = normalizeLower(clusterVals, item.metrics.corridorPeakDensity);
    const exitScore = normalizeHigher(exitVals, item.metrics.exitSuccess);

    const score = (flowScore * weights.flow + waitScore * weights.wait + clusterScore * weights.cluster + exitScore * weights.exit) / totalWeight;
    item.score = Number(score.toFixed(4));
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
    "stuckRate",
    "barOcc",
    "gymOcc",
    "exitSuccess",
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
      row.metrics.stuckRate.toFixed(4),
      row.metrics.barOcc.toFixed(3),
      row.metrics.gymOcc.toFixed(3),
      row.metrics.exitSuccess.toFixed(3),
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
    const parsed = JSON.parse(raw) as RunOutput;
    runs.push(parsed);
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
    flow: Number(args["w-flow"] ?? 0.4),
    wait: Number(args["w-wait"] ?? 0.3),
    cluster: Number(args["w-cluster"] ?? 0.3),
    exit: Number(args["w-exit"] ?? 0.1),
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
