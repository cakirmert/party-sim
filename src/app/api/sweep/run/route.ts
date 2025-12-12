import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Fixed constants for sweep (not user-configurable)
const FIXED_OUTSIDE_HEIGHT = 4;
const FIXED_HEATMAP_SCALE = 4;

type SweepRequest = {
  count?: number;
  runs?: number;
  agents?: string; // CSV of agent counts
  minutes?: number;
  seed?: string;
  barSize?: string;
  gymSize?: string;
  exitWidth?: string;
  rowGap?: string;
  resultsDir?: string;
  heatmap?: boolean;
  wFlow?: number;
  wWait?: number;
  wCluster?: number;
  wExit?: number;
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
    `--minutes ${body.minutes ?? 720}`,
    `--outside ${FIXED_OUTSIDE_HEIGHT}`,
    `--heatmapScale ${FIXED_HEATMAP_SCALE}`,
  ];

  if (body.seed) args.push(`--seed ${body.seed}`);
  if (body.barSize) args.push(`--barSize ${body.barSize}`);
  if (body.gymSize) args.push(`--gymSize ${body.gymSize}`);
  if (body.exitWidth) args.push(`--exitWidth ${body.exitWidth}`);
  if (body.rowGap) args.push(`--rowGap ${body.rowGap}`);
  if (body.resultsDir) args.push(`--results ${body.resultsDir}`);
  if (typeof body.wFlow === "number") args.push(`--w-flow ${body.wFlow}`);
  if (typeof body.wWait === "number") args.push(`--w-wait ${body.wWait}`);
  if (typeof body.wCluster === "number") args.push(`--w-cluster ${body.wCluster}`);
  if (typeof body.wExit === "number") args.push(`--w-exit ${body.wExit}`);
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
