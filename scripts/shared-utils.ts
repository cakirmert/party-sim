
import { promises as fs } from "node:fs";
import { dirname, basename, extname, resolve } from "node:path";

export interface RectSpec { x: number; y: number; w: number; h: number; }
export interface BaseSpec {
    corridorRects?: { x: number; y: number; w: number; h: number }[];
    buildableRects: RectSpec[];
    barRect: RectSpec;
    gymRect: RectSpec;
    outsideRect: RectSpec;
    exitRect: RectSpec;
    wallRects?: RectSpec[];
    doorTiles?: { x: number; y: number }[];
    dormRowGap?: number;
    // Allow other props for flexibility if needed, but strictly include above for compat
    [key: string]: unknown;
}

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

// Minimal stub for loadMapFile to avoid importing Engine types if possible, 
// or re-implement simple validation.
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
        // node:url pathToFileURL needs to be imported or used? 
        // Just use a simpler check or import it.
        // We'll skip strict check or assume it's passed correctly.
        // Re-implementing correctly:
        return process.argv[1] && importMetaUrl.endsWith(basename(process.argv[1]));
    }
    if (typeof require !== "undefined" && typeof module !== "undefined") {
        return require.main === module;
    }
    return false;
}
