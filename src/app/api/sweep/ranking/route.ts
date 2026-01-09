import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

type RankingFile = {
  generatedAt?: string;
  weights?: Record<string, unknown>;
  maps?: Array<{
    map: string;
    rank: number;
    score: number;
    metrics: {
      avgPathLength: number;
      corridorMeanDensity: number;
      corridorPeakDensity: number;
      stuckRate: number;
      barOccupancyRatio: number;
      gymOccupancyRatio: number;
      meanOccupancy?: number;
      exitSuccess: number;
    };
    heatmaps?: string[];
    params?: unknown;
    mapFile?: string;
  }>;
};

async function loadHeatmapData(path: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(path);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const baseDir = resolve(process.cwd(), searchParams.get("base") ?? "results");
  const rankingPath = join(baseDir, "analysis", "ranking.json");
  const top = Number(searchParams.get("top") ?? 10);

  /* Safe Read */
  let raw: string;
  try {
    raw = await fs.readFile(rankingPath, "utf8");
    if (!raw.trim()) throw new Error("Empty ranking file");
  } catch (err) {
    return NextResponse.json({ error: `Ranking not found or empty at ${rankingPath}`, detail: String(err) }, { status: 404 });
  }

  let parsed: RankingFile;
  try {
    parsed = JSON.parse(raw) as RankingFile;
  } catch (err) {
    return NextResponse.json({ error: "Invalid ranking JSON", detail: String(err) }, { status: 500 });
  }

  const maps = parsed.maps ?? [];

  const limited = maps
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Number.isFinite(top) ? top : 10);

  const payload: Array<{
    map: string;
    rank: number;
    score: number;
    metrics: RankingFile["maps"] extends Array<infer T> ? T extends { metrics: infer M } ? M : Record<string, number> : Record<string, number>;
    params?: unknown;
    mapFile?: string;
    heatmap?: string | null;
    heatmapPath?: string;
    runPath?: string;
    scoreBreakdown?: Record<string, number>;
  }> = [];

  for (const m of limited) {
    let heatmap: string | null = null;
    const heatPath = m.heatmaps?.[0];
    if (heatPath) {
      const resolved = isAbsolute(heatPath) ? heatPath : resolve(process.cwd(), heatPath);
      heatmap = await loadHeatmapData(resolved);
    }

    // Pass through explicit properties that might exist on 'm' but aren't in the type definition above
    // (We cast 'm' to any to access the extended properties added by analyze-results.ts)
    const ext = m as any;

    payload.push({
      map: m.map,
      rank: m.rank,
      score: m.score,
      metrics: m.metrics,
      params: m.params,
      mapFile: m.mapFile,
      heatmap,
      heatmapPath: m.heatmaps?.[0],
      runPath: ext.runPath,
      scoreBreakdown: ext.scoreBreakdown,
    });
  }

  return NextResponse.json({
    generatedAt: parsed.generatedAt,
    weights: parsed.weights,
    maps: payload,
  });
}
