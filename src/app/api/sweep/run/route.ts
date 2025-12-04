import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

type SweepRequest = {
  count?: number;
  runs?: number;
  agents?: number;
  minutes?: number;
  seed?: string;
  corridor?: string;
  bandHeight?: string;
  bandCount?: string;
  barSize?: string;
  gymSize?: string;
  exitWidth?: string;
  outside?: string;
  resultsDir?: string;
  heatmap?: boolean;
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
    `--count ${body.count ?? 8}`,
    `--runs ${body.runs ?? 2}`,
    `--agents ${body.agents ?? 80}`,
    `--minutes ${body.minutes ?? 720}`,
  ];

  if (body.seed) args.push(`--seed ${body.seed}`);
  if (body.corridor) args.push(`--corridor ${body.corridor}`);
  if (body.bandHeight) args.push(`--bandHeight ${body.bandHeight}`);
  if (body.bandCount) args.push(`--bandCount ${body.bandCount}`);
  if (body.barSize) args.push(`--barSize ${body.barSize}`);
  if (body.gymSize) args.push(`--gymSize ${body.gymSize}`);
  if (body.exitWidth) args.push(`--exitWidth ${body.exitWidth}`);
  if (body.outside) args.push(`--outside ${body.outside}`);
  if (body.resultsDir) args.push(`--results ${body.resultsDir}`);
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
