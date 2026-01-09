import { promises as fs, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, basename, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { buildSync } from "esbuild";
import type { BaseSpec } from "../src/lib/engine/Types";

export type BaseSpecFile = {
  width: number;
  height: number;
  spec: BaseSpec;
  meta?: Record<string, unknown>;
  name?: string;
};

export async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(file: string, data: unknown, compact = false): Promise<void> {
  await ensureDir(dirname(file));
  const json = compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  await fs.writeFile(file, json, "utf8");
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function slugify(input: string): string {
  return input.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    || "map";
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

export function parseNumberList(value: string | undefined, fallback: number[] = []): number[] {
  if (!value) return fallback;
  const out = value.split(",").map(v => Number(v.trim())).filter(v => Number.isFinite(v));
  return out.length ? out : fallback;
}

export function parseArgv(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [keyRaw, valRaw] = arg.slice(2).split("=", 2);
    const key = keyRaw.trim();
    if (!key) continue;
    if (valRaw !== undefined) {
      args[key] = valRaw;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function fileStem(filePath: string): string {
  const base = basename(filePath);
  return base.slice(0, base.length - extname(base).length);
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && extname(e.name).toLowerCase() === ".json")
    .map(e => resolve(dir, e.name));
}

export async function loadMapFile(path: string): Promise<BaseSpecFile> {
  const json = await readJson<BaseSpecFile>(path);
  if (!json || typeof json.width !== "number" || typeof json.height !== "number" || !json.spec) {
    throw new Error(`Invalid map file: ${path}`);
  }
  const name = json.name || json.meta?.["name"] as string | undefined || fileStem(path);
  return { ...json, name };
}

export function directCliRun(importMetaUrl?: string): boolean {
  if (importMetaUrl) {
    return importMetaUrl === pathToFileURL(process.argv[1]).href;
  }
  if (typeof require !== "undefined" && typeof module !== "undefined") {
    return require.main === module;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Pool for Parallel Execution
// ─────────────────────────────────────────────────────────────────────────────

export type WorkerTask<T> = {
  id: number;
  data: T;
};

export type WorkerResult<R> = {
  id: number;
  result?: R;
  error?: string;
  type?: "result" | "progress";
  ticks?: number;
};

export type ProgressCallback = (completed: number, total: number, taskId: number, subProgress?: number) => void;

/**
 * Get default worker count (CPU cores - 1, minimum 1)
 */
export function getDefaultWorkerCount(): number {
  return Math.max(1, cpus().length - 1);
}

// Cache for compiled worker scripts
const compiledWorkerCache = new Map<string, string>();

/**
 * Compile TypeScript worker to JavaScript using esbuild.
 * Results are cached for reuse. Output is placed in project directory for module resolution.
 */
function compileWorker(workerPath: string): string {
  const cached = compiledWorkerCache.get(workerPath);
  if (cached && existsSync(cached)) return cached;

  // Place compiled worker in project's .compiled directory so node_modules can resolve
  const projectRoot = dirname(dirname(workerPath));
  const outDir = join(projectRoot, ".compiled");
  const outPath = join(outDir, "sim-worker.mjs");

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  buildSync({
    entryPoints: [workerPath],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: outPath,
    sourcemap: "inline",
    // Externalize node_modules to avoid bundling issues
    packages: "external",
  });

  compiledWorkerCache.set(workerPath, outPath);
  return outPath;
}

/**
 * Run tasks in parallel using worker threads.
 * Compiles TypeScript to JavaScript using esbuild for worker thread compatibility.
 * Worker threads provide lower overhead than child processes.
 * @param tasks - Array of task data to process
 * @param workerPath - Absolute path to worker script (TypeScript)
 * @param maxWorkers - Maximum concurrent workers (default: CPU cores - 1)
 * @param onProgress - Optional callback for progress updates
 * @returns Array of results in same order as input tasks
 */
export async function runParallelTasks<T, R>(
  tasks: T[],
  workerPath: string,
  maxWorkers: number = getDefaultWorkerCount(),
  onProgress?: ProgressCallback
): Promise<WorkerResult<R>[]> {
  if (tasks.length === 0) return [];

  // Compile TypeScript worker to JavaScript
  const compiledWorkerPath = compileWorker(workerPath);

  const workerCount = Math.min(maxWorkers, tasks.length);
  const results: WorkerResult<R>[] = new Array(tasks.length);
  let nextTaskIndex = 0;
  let completedCount = 0;

  return new Promise((resolveAll, rejectAll) => {
    const workers: Worker[] = [];
    let hasError = false;

    const assignTask = (worker: Worker, workerIndex: number) => {
      if (nextTaskIndex >= tasks.length || hasError) {
        worker.terminate();
        return;
      }

      const taskIndex = nextTaskIndex++;
      worker.postMessage({ id: taskIndex, data: tasks[taskIndex] });
    };

    const onWorkerMessage = (worker: Worker, workerIndex: number) => (msg: WorkerResult<R>) => {
      // Handle progress update (msg.ticks / totalTicks)
      if (msg.type === "progress") {
        if (onProgress && msg.ticks !== undefined) {
          // Pass sub-task progress (raw ticks)
          onProgress(completedCount, tasks.length, msg.id, msg.ticks);
        }
        return;
      }

      results[msg.id] = msg;
      completedCount++;

      if (onProgress) {
        onProgress(completedCount, tasks.length, msg.id, 0); // Task done
      }

      if (completedCount === tasks.length) {
        workers.forEach(w => w.terminate());
        resolveAll(results);
      } else {
        assignTask(worker, workerIndex);
      }
    };

    const onWorkerError = (workerIndex: number) => (err: Error) => {
      if (hasError) return;
      hasError = true;
      // eslint-disable-next-line no-console
      console.error(`Worker ${workerIndex} error:`, err);
      workers.forEach(w => w.terminate());
      rejectAll(err);
    };

    // Spawn worker threads using compiled JavaScript
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(compiledWorkerPath);
      workers.push(worker);

      worker.on("message", onWorkerMessage(worker, i));
      worker.on("error", onWorkerError(i));
      worker.on("exit", (code) => {
        // Workers exit with code 1 when terminated, which is expected
        if (code !== 0 && code !== 1 && !hasError) {
          // eslint-disable-next-line no-console
          console.warn(`Worker ${i} exited with code ${code}`);
        }
      });

      // Assign initial task
      assignTask(worker, i);
    }
  });
}
