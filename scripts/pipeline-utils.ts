import { promises as fs } from "node:fs";
import { dirname, extname, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
