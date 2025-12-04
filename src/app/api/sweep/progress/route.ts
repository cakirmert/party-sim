import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";

async function countRunFiles(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await countRunFiles(full);
    } else if (entry.isFile() && entry.name.startsWith("run-") && entry.name.endsWith(".json")) {
      total += 1;
    }
  }
  return total;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resultsDir = resolve(process.cwd(), searchParams.get("results") ?? "results");
  const expected = Number(searchParams.get("expected") ?? 0);

  const found = await countRunFiles(resultsDir);
  const total = Math.max(1, expected || found || 1);
  const progress = Math.min(1, found / total);

  return NextResponse.json({
    resultsDir,
    found,
    expected: total,
    progress,
  });
}
