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

import {
  buildRangesFromForm,
  DEFAULT_PARAMETER_RANGES,
  type ParameterRanges,
  type VariantParams,
} from "../src/lib/mapgen/runtime";
import { writeFileSync } from "node:fs";

function normalizeRange(r: ParameterRanges | undefined, overrides: Partial<ParameterRanges>): ParameterRanges {
  const base = r ?? DEFAULT_PARAMETER_RANGES;
  const merged: ParameterRanges = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!value) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

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
    // Parse ranges from CLI
    const formRanges = buildRangesFromForm({
      corridor: typeof args.corridor === "string" ? args.corridor : undefined,
      bandHeight: typeof args.bandHeight === "string" ? args.bandHeight : undefined,
      bandCount: typeof args.bandCount === "string" ? args.bandCount : undefined,
      rowGap: typeof args.rowGap === "string" ? args.rowGap : undefined,
      barSize: typeof args.barSize === "string" ? args.barSize : undefined,
      barX: typeof args.barX === "string" ? args.barX : undefined,
      barY: typeof args.barY === "string" ? args.barY : undefined,
      gymSize: typeof args.gymSize === "string" ? args.gymSize : undefined,
      gymX: typeof args.gymX === "string" ? args.gymX : undefined,
      gymY: typeof args.gymY === "string" ? args.gymY : undefined,
      exitWidth: typeof args.exitWidth === "string" ? args.exitWidth : undefined,
      outside: typeof args.outside === "string" ? args.outside : undefined,
    });
    const mergedRange = normalizeRange(undefined, formRanges);

    await generateMaps({
      templatePath: resolve(String(args.template || "public/maps/base.json")),
      outDir: mapDir,
      ranges: mergedRange,
      explicit: undefined, // Explicit params support could be added but skipping for now
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

  // Default to 1260 minutes (21 hours: 6am to 3am) to capture bar closing but end early
  const simMinutes = Number(args.minutes ?? 1260);

  // Top-K filtering: only write results for top K maps (reduces file I/O)
  const topK = Number(args.topK ?? args["top-k"]) || undefined;

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
      topK,
    };

    if (parallel) {
      // eslint-disable-next-line no-console
      console.log(`Running parallel simulation with ${workers} workers for ${agentCount} agents${topK ? ` (top-K=${topK})` : ""}...`);

      let lastWrite = 0;
      await runBatchParallel({
        ...batchOpts,
        workers,
        onProgress: (completed, total) => {
          const now = Date.now();
          if (now - lastWrite > 1000) { // Write status at most once per second
            try {
              writeFileSync(resolve(resultsDir, "sweep-status.json"), JSON.stringify({
                completed,
                total,
                updatedAt: now,
                agentCount,
              }, null, 2));
              lastWrite = now;
            } catch (e) {
              // ignore write errors during progress
            }
          }
        }
      });

      // Final write to ensure 100% is recorded
      try {
        writeFileSync(resolve(resultsDir, "sweep-status.json"), JSON.stringify({
          completed: batchOpts.maps.length * batchOpts.scenarios.length * batchOpts.seeds.length, // approximate total or use explicit
          total: batchOpts.maps.length * batchOpts.scenarios.length * batchOpts.seeds.length,
          updatedAt: Date.now(),
          agentCount,
          finished: true
        }, null, 2));
      } catch (e) { /* ignore */ }

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
      weights: {
        capacity: Number(args["w-capacity"] ?? 0.35),
        utilization: Number(args["w-util"] ?? 0.20),
        congestion: Number(args["w-congestion"] ?? 0.15),
        path: Number(args["w-path"] ?? 0.10),
        evacuation: Number(args["w-evacuation"] ?? 0.15),
        wait: Number(args["w-wait"] ?? 0.05),
      }
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
