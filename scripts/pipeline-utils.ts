import { promises as fs } from "node:fs";
import { dirname, extname, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fork, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
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

export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
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
};

export type ProgressCallback = (completed: number, total: number, taskId: number) => void;

/**
 * Get default worker count (CPU cores - 1, minimum 1)
 */
export function getDefaultWorkerCount(): number {
  return Math.max(1, cpus().length - 1);
}

/**
 * Run tasks in parallel using child processes (fork).
 * Uses tsx to handle TypeScript files.
 * @param tasks - Array of task data to process
 * @param workerPath - Absolute path to worker script
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
  
  const workerCount = Math.min(maxWorkers, tasks.length);
  const results: WorkerResult<R>[] = new Array(tasks.length);
  let nextTaskIndex = 0;
  let completedCount = 0;
  
  return new Promise((resolveAll, rejectAll) => {
    const workers: ChildProcess[] = [];
    let hasError = false;
    
    const assignTask = (worker: ChildProcess, workerIndex: number) => {
      if (nextTaskIndex >= tasks.length || hasError) {
        worker.kill();
        return;
      }
      
      const taskIndex = nextTaskIndex++;
      const task: WorkerTask<T> = { id: taskIndex, data: tasks[taskIndex] };
      worker.send(task);
    };
    
    const onWorkerMessage = (worker: ChildProcess, workerIndex: number) => (msg: WorkerResult<R>) => {
      results[msg.id] = msg;
      completedCount++;
      
      if (onProgress) {
        onProgress(completedCount, tasks.length, msg.id);
      }
      
      if (completedCount === tasks.length) {
        // All done - kill remaining workers
        workers.forEach(w => w.kill());
        resolveAll(results);
      } else {
        // Assign next task to this worker
        assignTask(worker, workerIndex);
      }
    };
    
    const onWorkerError = (workerIndex: number) => (err: Error) => {
      if (hasError) return;
      hasError = true;
      // eslint-disable-next-line no-console
      console.error(`Worker ${workerIndex} error:`, err);
      workers.forEach(w => w.kill());
      rejectAll(err);
    };
    
    // Spawn workers using fork with tsx
    for (let i = 0; i < workerCount; i++) {
      // Use tsx to run the TypeScript worker
      const worker = fork(workerPath, [], {
        execArgv: ["--import", "tsx"],
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      });
      workers.push(worker);
      
      worker.on("message", onWorkerMessage(worker, i));
      worker.on("error", onWorkerError(i));
      worker.on("exit", (code) => {
        // Workers exit with null code when killed after completion, which is expected
        if (code !== 0 && code !== null && !hasError) {
          // eslint-disable-next-line no-console
          console.warn(`Worker ${i} exited with code ${code}`);
        }
      });
      
      // Assign initial task
      assignTask(worker, i);
    }
  });
}
