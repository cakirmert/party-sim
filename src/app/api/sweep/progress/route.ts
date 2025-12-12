import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";

// Simple in-memory tracking for progress (persists across requests in the same process)
const progressState: {
  startedAt: number | null;
  lastCount: number;
  lastTime: number;
} = {
  startedAt: null,
  lastCount: 0,
  lastTime: 0,
};

async function countRunFiles(dir: string): Promise<{ count: number; latestMap: string | null }> {
  let total = 0;
  let latestMap: string | null = null;
  let latestTime = 0;

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await countRunFiles(full);
      total += sub.count;
      // Track the map folder name
      if (sub.count > 0) {
        try {
          const stat = await fs.stat(full);
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestMap = entry.name;
          }
        } catch {
          // ignore
        }
      }
    } else if (entry.isFile() && entry.name.startsWith("run-") && entry.name.endsWith(".json")) {
      total += 1;
    }
  }
  return { count: total, latestMap };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resultsDir = resolve(process.cwd(), searchParams.get("results") ?? "results");
  const expected = Number(searchParams.get("expected") ?? 0);
  const reset = searchParams.get("reset") === "true";

  // Reset tracking on new sweep
  if (reset || (progressState.startedAt === null && expected > 0)) {
    progressState.startedAt = Date.now();
    progressState.lastCount = 0;
    progressState.lastTime = Date.now();
  }

  const { count: found, latestMap } = await countRunFiles(resultsDir);
  const total = Math.max(1, expected || found || 1);
  const progress = Math.min(1, found / total);

  // Calculate ETA based on rate
  const now = Date.now();
  const elapsed = progressState.startedAt ? now - progressState.startedAt : 0;
  let eta: number | undefined;

  if (found > 0 && found < total && elapsed > 0) {
    // Calculate based on average time per simulation
    const avgTimePerSim = elapsed / found;
    const remaining = total - found;
    eta = Math.round(avgTimePerSim * remaining);
  }

  // Update tracking
  if (found > progressState.lastCount) {
    progressState.lastCount = found;
    progressState.lastTime = now;
  }

  // Reset state if sweep completed
  if (found >= total && progressState.startedAt) {
    progressState.startedAt = null;
  }

  return NextResponse.json({
    resultsDir,
    completed: found,
    total,
    progress,
    currentMap: latestMap,
    startedAt: progressState.startedAt,
    elapsed,
    eta,
  });
}
