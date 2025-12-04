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
    metrics: Record<string, number>;
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

  let raw: string;
  try {
    raw = await fs.readFile(rankingPath, "utf8");
  } catch (err) {
    return NextResponse.json({ error: `Ranking not found at ${rankingPath}`, detail: String(err) }, { status: 404 });
  }

  const parsed = JSON.parse(raw) as RankingFile;
  const maps = parsed.maps ?? [];

  const limited = maps
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Number.isFinite(top) ? top : 10);

  const payload = [];
  for (const m of limited) {
    let heatmap: string | null = null;
    const heatPath = m.heatmaps?.[0];
    if (heatPath) {
      const resolved = isAbsolute(heatPath) ? heatPath : resolve(process.cwd(), heatPath);
      heatmap = await loadHeatmapData(resolved);
    }
    payload.push({
      map: m.map,
      rank: m.rank,
      score: m.score,
      metrics: m.metrics,
      params: m.params,
      mapFile: m.mapFile,
      heatmap,
    });
  }

  return NextResponse.json({
    generatedAt: parsed.generatedAt,
    weights: parsed.weights,
    maps: payload,
  });
}
