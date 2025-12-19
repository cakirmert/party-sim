import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { analyzeResults } from "./analyze-results";
import { generateMaps } from "./generate-maps";
import { runBatch, runBatchParallel } from "./run-batch";
import {
  directCliRun,
  getDefaultWorkerCount,
  listJsonFiles,
  parseArgv,
  parseCsv,
} from "./pipeline-utils";

async function cli() {
  const args = parseArgv(process.argv.slice(2));

  const mapDir = resolve(String(args.mapDir || "public/maps/generated"));
  const resultsDir = resolve(String(args.results || "results"));
  const count = Number(args.count ?? 8);
  const seed = typeof args.seed === "string" ? args.seed : randomUUID();
  const skipGenerate = args["skip-generate"] === true || args["skip-generate"] === "true";
  
  // Parallel execution options
  const parallel = args.parallel !== "false" && args.parallel !== false;
  const workers = Number(args.workers) || getDefaultWorkerCount();

  if (!skipGenerate) {
    await generateMaps({
      templatePath: resolve(String(args.template || "public/maps/base.json")),
      outDir: mapDir,
      ranges: undefined,
      explicit: undefined,
      count: Number.isFinite(count) ? count : 8,
      seed,
      prefix: String(args.prefix || "map"),
      gridOverride: undefined,
    });
  }

  const mapFiles = await listJsonFiles(mapDir);
  if (!mapFiles.length) throw new Error(`No maps found in ${mapDir}; run generate-maps first.`);

  let seedList = parseCsv(typeof args.seeds === "string" ? args.seeds : undefined);
  const runs = Number(args.runs ?? 0);
  if ((!seedList || !seedList.length) && runs > 0) {
    seedList = Array.from({ length: runs }, (_, i) => `run-${i + 1}`);
  }
  const seeds = (seedList && seedList.length ? seedList : ["sim-1", "sim-2"]).map(s => s.trim()).filter(Boolean);

  const scenarioList = parseCsv(typeof args.scenarios === "string" ? args.scenarios : undefined) as ("weekday" | "weekend")[];
  const scenarios = scenarioList.length ? scenarioList : (["weekday", "weekend"] as ("weekday" | "weekend")[]);

  // Support CSV agent counts (e.g., "80,100,120")
  const agentCounts = parseCsv(typeof args.agents === "string" ? args.agents : undefined)
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n) && n > 0);
  const agentList = agentCounts.length > 0 ? agentCounts : [80];
  
  // Default to 960 minutes (16 hours: 6am to 10pm) for realistic day simulation
  const simMinutes = Number(args.minutes ?? 960);

  // Run simulations for each agent count
  for (const agentCount of agentList) {
    const batchOpts = {
      maps: mapFiles,
      outDir: resultsDir,
      agentCount,
      seeds,
      simMinutes,
      scenarios,
      tickRate: Number(args.tickRate ?? 20),
      heatmap: args.heatmap !== "false",
      // Default scale 4 to match map preview (min(480/120, 480/70, 4) = 4 for 120x70 grid)
      heatmapScale: Number(args.heatmapScale ?? 4),
    };
    
    if (parallel) {
      // eslint-disable-next-line no-console
      console.log(`Running parallel simulation with ${workers} workers for ${agentCount} agents...`);
      await runBatchParallel({ ...batchOpts, workers });
    } else {
      // eslint-disable-next-line no-console
      console.log(`Running sequential simulation for ${agentCount} agents...`);
      await runBatch(batchOpts);
    }
  }

  await analyzeResults(
    resultsDir,
    resolve(resultsDir, "analysis"),
    {
      flow: Number(args["w-flow"] ?? 0.4),
      wait: Number(args["w-wait"] ?? 0.3),
      cluster: Number(args["w-cluster"] ?? 0.3),
      exit: Number(args["w-exit"] ?? 0.1),
    }
  );
}

if (directCliRun(import.meta.url)) {
  cli().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
