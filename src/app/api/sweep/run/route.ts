import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { cpus } from "node:os";

const execAsync = promisify(exec);

// Fixed constants for sweep (not user-configurable)
const FIXED_OUTSIDE_HEIGHT = 4;
const FIXED_HEATMAP_SCALE = 4;
const DEFAULT_WORKERS = Math.max(1, cpus().length - 1);

type SweepRequest = {
  count?: number;
  runs?: number;
  agents?: string; // CSV of agent counts
  minutes?: number;
  seed?: string;
  barSize?: string;
  barX?: string;
  barY?: string;
  gymSize?: string;
  gymX?: string;
  gymY?: string;
  exitWidth?: string;
  rowGap?: string;
  corridor?: string;
  resultsDir?: string;
  heatmap?: boolean;
  wFlow?: number;
  wWait?: number;
  wCluster?: number;
  wExit?: number;
  // Parallel execution options
  parallel?: boolean;
  workers?: number;
  // Top-K filtering (only save top K maps)
  topK?: number;
};

export async function POST(req: Request) {
  let body: SweepRequest = {};
  try {
    body = await req.json();
  } catch {
    // ignore, fall back to defaults
  }

  const args: string[] = [
    "run",
    "sweep-maps",
    "--",
    `--count ${body.count ?? 32}`,
    `--runs ${body.runs ?? 1}`,
    `--agents ${body.agents ?? "80"}`,
    `--minutes ${body.minutes ?? 960}`,
    `--outside ${FIXED_OUTSIDE_HEIGHT}`,
    `--heatmapScale ${FIXED_HEATMAP_SCALE}`,
  ];

  // Parallel execution (default: enabled)
  const parallel = body.parallel !== false;
  const workers = body.workers ?? DEFAULT_WORKERS;
  args.push(`--parallel ${parallel}`);
  args.push(`--workers ${workers}`);

  if (body.seed) args.push(`--seed ${body.seed}`);
  // Support both legacy size list or new split X/Y
  if (body.barSize) args.push(`--barSize ${body.barSize}`);
  if (body.barX) args.push(`--barX ${body.barX}`);
  if (body.barY) args.push(`--barY ${body.barY}`);

  if (body.gymSize) args.push(`--gymSize ${body.gymSize}`);
  if (body.gymX) args.push(`--gymX ${body.gymX}`);
  if (body.gymY) args.push(`--gymY ${body.gymY}`);

  if (body.exitWidth) args.push(`--exitWidth ${body.exitWidth}`);
  if (body.rowGap) args.push(`--rowGap ${body.rowGap}`);
  if (body.corridor) args.push(`--corridor ${body.corridor}`);
  if (body.resultsDir) args.push(`--results ${body.resultsDir}`);
  if (typeof body.wFlow === "number") args.push(`--w-flow ${body.wFlow}`);
  if (typeof body.wWait === "number") args.push(`--w-wait ${body.wWait}`);
  if (typeof body.wCluster === "number") args.push(`--w-cluster ${body.wCluster}`);
  if (typeof body.wExit === "number") args.push(`--w-exit ${body.wExit}`);
  if (typeof body.topK === "number" && body.topK > 0) args.push(`--top-k ${body.topK}`);
  args.push(`--heatmap ${body.heatmap === false ? "false" : "true"}`);

  const cmd = `npm ${args.join(" ")}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 0,
    });
    return NextResponse.json({
      ok: true,
      command: cmd,
      stdout,
      stderr,
      message: "Sweep completed.",
    });
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return NextResponse.json({
      ok: false,
      command: cmd,
      message: error?.message ?? "Sweep failed",
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
    }, { status: 500 });
  }
}
