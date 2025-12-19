import { randomUUID } from "node:crypto";
import { basename, resolve, relative } from "node:path";
import { GridMap } from "../src/lib/engine/GridMap";
import { aStar8 } from "../src/lib/engine/Pathfinder";
import type { GridSize, Vec2 } from "../src/lib/engine/Types";
import type { BaseSpec, RectSpec } from "../src/lib/engine/Types";
import {
  buildSpecRuntime,
  DEFAULT_RUNTIME_PARAMS,
  DEFAULT_PARAMETER_RANGES,
  expandParameterRanges,
  buildRangesFromForm,
  type VariantParams as RuntimeVariantParams,
  type ParameterRanges,
} from "../src/lib/mapgen/runtime";
import {
  BaseSpecFile,
  directCliRun,
  ensureDir,
  loadMapFile,
  parseArgv,
  parseCsv,
  parseNumberList,
  slugify,
  writeJson,
} from "./pipeline-utils";

type Side = "left" | "right";

export type PoiConfig = {
  w: number;
  h: number;
  side: Side;
  yOffset: number;
};

export type VariantParams = {
  name?: string;
  corridorWidth?: number;
  crossHeight?: number;
  bandHeight?: number;
  bandCount?: number;
  dormRowGap?: number;
  bar?: Partial<PoiConfig>;
  gym?: Partial<PoiConfig>;
  outsideHeight?: number;
  exitWidth?: number;
  seed?: string;
};

// Re-export ParameterRanges for backward compatibility
export type RangeConfig = ParameterRanges;

type GenerateOptions = {
  templatePath: string;
  outDir: string;
  ranges?: ParameterRanges;
  explicit?: VariantParams[];
  count: number;
  seed: string;
  prefix: string;
  gridOverride?: { width: number; height: number };
};

export const DEFAULT_TEMPLATE = "public/maps/base.json";
export const DEFAULT_GRID: GridSize = { width: 120, height: 70 };
const MIN_ROOM_SIZE = 6; // matches dorm generator expectations
const MIN_CORRIDOR_WIDTH = 2;

// Use centralized ranges from runtime.ts
export const DEFAULT_RANGE = DEFAULT_PARAMETER_RANGES;

export const DEFAULT_BASE_PARAMS: Required<VariantParams> = {
  corridorWidth: DEFAULT_RUNTIME_PARAMS.corridorWidth,
  crossHeight: DEFAULT_RUNTIME_PARAMS.crossHeight,
  bandHeight: DEFAULT_RUNTIME_PARAMS.bandHeight,
  bandCount: DEFAULT_RUNTIME_PARAMS.bandCount,
  dormRowGap: DEFAULT_RUNTIME_PARAMS.dormRowGap,
  bar: DEFAULT_RUNTIME_PARAMS.bar,
  gym: DEFAULT_RUNTIME_PARAMS.gym,
  outsideHeight: DEFAULT_RUNTIME_PARAMS.outsideHeight,
  exitWidth: DEFAULT_RUNTIME_PARAMS.exitWidth,
  name: "base-template",
  seed: "homepage",
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seedFromString(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return h >>> 0;
}

function subtractRect(rect: RectSpec, cut: RectSpec): RectSpec[] {
  if (!rectsOverlap(rect, cut)) return [rect];

  const rx0 = rect.x;
  const ry0 = rect.y;
  const rx1 = rect.x + rect.w;
  const ry1 = rect.y + rect.h;
  const cx0 = cut.x;
  const cy0 = cut.y;
  const cx1 = cut.x + cut.w;
  const cy1 = cut.y + cut.h;

  const ix0 = Math.max(rx0, cx0);
  const iy0 = Math.max(ry0, cy0);
  const ix1 = Math.min(rx1, cx1);
  const iy1 = Math.min(ry1, cy1);

  const out: RectSpec[] = [];

  // top band
  if (iy0 > ry0) out.push({ x: rx0, y: ry0, w: rect.w, h: iy0 - ry0 });
  // bottom band
  if (iy1 < ry1) out.push({ x: rx0, y: iy1, w: rect.w, h: ry1 - iy1 });

  const midH = Math.max(0, iy1 - iy0);
  if (midH > 0) {
    if (ix0 > rx0) out.push({ x: rx0, y: iy0, w: ix0 - rx0, h: midH });
    if (ix1 < rx1) out.push({ x: ix1, y: iy0, w: rx1 - ix1, h: midH });
  }

  return out.filter(r => r.w >= MIN_ROOM_SIZE && r.h >= MIN_ROOM_SIZE);
}

function isSpecConnected(grid: { width: number; height: number }, spec: BaseSpec): boolean {
  const gm = GridMap.buildFromSpec(grid, spec);
  const exitTiles: Vec2[] = [];
  const barTiles: Vec2[] = [];
  const gymTiles: Vec2[] = [];
  for (let y = 0; y < gm.height; y++) {
    for (let x = 0; x < gm.width; x++) {
      const t = gm.get(x, y);
      if (t.tag === "EXIT") exitTiles.push({ x, y });
      if (t.tag === "BAR") barTiles.push({ x, y });
      if (t.tag === "GYM") gymTiles.push({ x, y });
    }
  }
  const exit = exitTiles[0];
  const bar = barTiles[Math.floor(barTiles.length / 2)];
  const gym = gymTiles[Math.floor(gymTiles.length / 2)];
  if (!exit || !bar || !gym) return false;
  const barPath = aStar8(gm, bar, exit);
  const gymPath = aStar8(gm, gym, exit);
  return Boolean(barPath && gymPath);
}

function rectsOverlap(a: RectSpec, b: RectSpec): boolean {
  const ax1 = a.x + a.w, ay1 = a.y + a.h;
  const bx1 = b.x + b.w, by1 = b.y + b.h;
  return a.x < bx1 && ax1 > b.x && a.y < by1 && ay1 > b.y;
}

async function loadTemplate(path: string): Promise<BaseSpecFile> {
  try {
    return await loadMapFile(path);
  } catch (err) {
    throw new Error(`Failed to load template ${path}: ${String(err)}`);
  }
}

function parseSizeList(raw: string | undefined): Array<{ w: number; h: number }> {
  if (!raw) return [];
  return raw.split(",")
    .map(pair => pair.trim())
    .filter(Boolean)
    .map(pair => {
      const [w, h] = pair.toLowerCase().split("x").map(Number);
      if (Number.isFinite(w) && Number.isFinite(h)) return { w, h };
      return null;
    })
    .filter((v): v is { w: number; h: number } => Boolean(v));
}

function normalizeRange(r: ParameterRanges | undefined, overrides: Partial<ParameterRanges>): ParameterRanges {
  const base = r ?? DEFAULT_RANGE;
  const merged: ParameterRanges = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!value) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

export async function generateMaps(opts: GenerateOptions): Promise<BaseSpecFile[]> {
  const template = await loadTemplate(opts.templatePath);
  const grid = opts.gridOverride ?? {
    width: template.width ?? DEFAULT_GRID.width,
    height: template.height ?? DEFAULT_GRID.height,
  };

  // Use the centralized expandParameterRanges from runtime.ts
  let variants: RuntimeVariantParams[] = [];
  if (opts.explicit && opts.explicit.length) {
    variants = opts.explicit.map((v, i) => ({
      ...DEFAULT_RUNTIME_PARAMS,
      ...v,
      seed: v.seed ?? `${opts.seed}-${i}`,
    }));
  } else {
    variants = expandParameterRanges(opts.ranges ?? DEFAULT_RANGE, opts.seed);
  }

  const combos = variants.length;
  const maxCount = opts.count <= 0 ? combos : Math.max(1, opts.count);
  let picked = variants;

  if (variants.length > maxCount) {
    const rng = mulberry32(seedFromString(opts.seed || randomUUID()));
    const pool = [...variants];
    const sampled: RuntimeVariantParams[] = [];
    while (sampled.length < maxCount && pool.length) {
      const idx = Math.floor(rng() * pool.length);
      sampled.push(pool.splice(idx, 1)[0]);
    }
    picked = sampled;
  }

  await ensureDir(opts.outDir);

  const out: BaseSpecFile[] = [];
  for (let i = 0; i < picked.length; i++) {
    const variant = picked[i];
    const params: Required<RuntimeVariantParams> = {
      corridorWidth: variant.corridorWidth ?? DEFAULT_RUNTIME_PARAMS.corridorWidth,
      crossHeight: variant.crossHeight ?? DEFAULT_RUNTIME_PARAMS.crossHeight,
      bandHeight: variant.bandHeight ?? DEFAULT_RUNTIME_PARAMS.bandHeight,
      bandCount: variant.bandCount ?? DEFAULT_RUNTIME_PARAMS.bandCount,
      dormRowGap: variant.dormRowGap ?? DEFAULT_RUNTIME_PARAMS.dormRowGap,
      bar: variant.bar ?? DEFAULT_RUNTIME_PARAMS.bar,
      gym: variant.gym ?? DEFAULT_RUNTIME_PARAMS.gym,
      outsideHeight: variant.outsideHeight ?? DEFAULT_RUNTIME_PARAMS.outsideHeight,
      exitWidth: variant.exitWidth ?? DEFAULT_RUNTIME_PARAMS.exitWidth,
      seed: variant.seed ?? `${opts.seed}-${i}`,
    };

    // Use buildSpecRuntime directly - same as homepage
    const spec = buildSpecRuntime(grid, params);
    if (!isSpecConnected(grid, spec)) {
      // skip invalid layouts that block POIs from exit
      // eslint-disable-next-line no-console
      console.warn("Skipping disconnected map", params);
      continue;
    }
    const hash = seedFromString(JSON.stringify(params));
    const label = `variant-${hash}`;
    const fileName = `${slugify(label)}.json`;
    const outPath = resolve(opts.outDir, fileName);
    const mapFile: BaseSpecFile = {
      width: grid.width,
      height: grid.height,
      spec,
      name: label,
      meta: {
        template: basename(opts.templatePath),
        seed: params.seed,
        generatedAt: new Date().toISOString(),
        params,
        source: "generate-maps",
        sourcePath: relative(process.cwd(), outPath),
      },
    };
    await writeJson(outPath, mapFile);
    out.push(mapFile);
    // eslint-disable-next-line no-console
    console.log(`Generated ${outPath}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Generated ${out.length}/${combos} variant(s) into ${opts.outDir}`);
  return out;
}

async function cli() {
  const args = parseArgv(process.argv.slice(2));
  const templatePath = resolve(String(args.template || DEFAULT_TEMPLATE));
  const outDir = resolve(String(args.outDir || "public/maps/generated"));

  const gridFlag = typeof args.grid === "string" ? String(args.grid) : undefined;
  const grid = gridFlag
    ? (() => {
      const [w, h] = gridFlag.toLowerCase().split("x").map(Number);
      if (Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h };
      return undefined;
    })()
    : undefined;

  const count = Number(args.count ?? args.max ?? 0);
  const seed = typeof args.seed === "string" ? args.seed : randomUUID();
  const prefix = typeof args.prefix === "string" ? args.prefix : "map";

  let ranges: ParameterRanges | undefined;
  if (args.ranges && typeof args.ranges === "string") {
    ranges = await loadRanges(resolve(args.ranges));
  }

  // Build ranges from CLI arguments using the centralized builder
  const formRanges = buildRangesFromForm({
    corridor: typeof args.corridor === "string" ? args.corridor : undefined,
    bandHeight: typeof args.bandHeight === "string" ? args.bandHeight : undefined,
    bandCount: typeof args.bandCount === "string" ? args.bandCount : undefined,
    rowGap: typeof args.rowGap === "string" ? args.rowGap : undefined,
    barSize: typeof args.barSize === "string" ? args.barSize : undefined,
    gymSize: typeof args.gymSize === "string" ? args.gymSize : undefined,
    exitWidth: typeof args.exitWidth === "string" ? args.exitWidth : undefined,
    outside: typeof args.outside === "string" ? args.outside : undefined,
  });

  // Merge loaded ranges with form overrides
  const mergedRange = normalizeRange(ranges, formRanges);

  let explicit: VariantParams[] | undefined;
  if (args.params && typeof args.params === "string") {
    explicit = await loadParams(resolve(args.params));
  }

  await generateMaps({
    templatePath,
    outDir,
    ranges: explicit ? undefined : mergedRange,
    explicit,
    count: Number.isFinite(count) ? count : 12,
    seed,
    prefix,
    gridOverride: grid,
  });
}

async function loadRanges(path: string): Promise<ParameterRanges> {
  const file = await import("node:fs/promises");
  const raw = await file.readFile(path, "utf8");
  const json = JSON.parse(raw);
  if (Array.isArray(json)) {
    throw new Error("Ranges file should be an object, not an array. Use --params for explicit variants.");
  }
  return json as ParameterRanges;
}

async function loadParams(path: string): Promise<VariantParams[]> {
  const file = await import("node:fs/promises");
  const raw = await file.readFile(path, "utf8");
  const json = JSON.parse(raw);
  if (!Array.isArray(json)) throw new Error("Params file must be an array of variant objects.");
  return json as VariantParams[];
}

if (directCliRun(import.meta.url)) {
  cli().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
