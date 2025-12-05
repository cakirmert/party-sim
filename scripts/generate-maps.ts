import { randomUUID } from "node:crypto";
import { basename, resolve, relative } from "node:path";
import { GridMap } from "../src/lib/engine/GridMap";
import { aStar8 } from "../src/lib/engine/Pathfinder";
import type { GridSize, Vec2 } from "../src/lib/engine/Types";
import type { BaseSpec, RectSpec } from "../src/lib/engine/Types";
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

export type RangeConfig = {
  corridorWidth?: number[];
  crossHeight?: number[];
  bandHeight?: number[];
  bandCount?: number[];
  dormRowGap?: number[];
  barWidth?: number[];
  barHeight?: number[];
  barSide?: Side[];
  barYOffset?: number[];
  gymWidth?: number[];
  gymHeight?: number[];
  gymSide?: Side[];
  gymYOffset?: number[];
  outsideHeight?: number[];
  exitWidth?: number[];
};

type GenerateOptions = {
  templatePath: string;
  outDir: string;
  ranges?: RangeConfig;
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

export const DEFAULT_RANGE: RangeConfig = {
  corridorWidth: [2, 3, 4, 6],
  crossHeight: [0, 1, 2],
  bandHeight: [8, 10, 11, 12],
  bandCount: [3, 4],
  dormRowGap: [0, 1, 2],
  barWidth: [13, 15],
  barHeight: [4, 5, 6],
  barSide: ["right", "left"],
  barYOffset: [-2, 0, 2],
  gymWidth: [6, 8, 10],
  gymHeight: [4, 5, 6],
  gymSide: ["left", "right"],
  gymYOffset: [-2, 0, 2],
  outsideHeight: [3, 4, 5],
  exitWidth: [8, 10, 12],
};

export const DEFAULT_BASE_PARAMS: Required<VariantParams> = {
  corridorWidth: 4,
  crossHeight: 0,
  bandHeight: 11,
  bandCount: 4,
  dormRowGap: 0,
  bar: { w: 15, h: 6, side: "right", yOffset: 0 },
  gym: { w: 10, h: 5, side: "left", yOffset: 0 },
  outsideHeight: 4,
  exitWidth: 12,
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

function choose<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function cartesianPick(ranges: unknown[][]): unknown[][] {
  let acc: unknown[][] = [[]];
  for (const arr of ranges) {
    const next: unknown[][] = [];
    for (const partial of acc) {
      for (const v of arr) next.push([...partial, v]);
    }
    acc = next;
  }
  return acc;
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

function carveBuildables(rects: RectSpec[], pois: RectSpec[]): RectSpec[] {
  const carved: RectSpec[] = [];
  for (const rect of rects) {
    let pieces = [rect];
    for (const poi of pois) {
      pieces = pieces.flatMap(r => subtractRect(r, poi));
    }
    carved.push(...pieces);
  }
  return carved;
}

function padRect(rect: RectSpec, padding: number): RectSpec {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    w: rect.w + padding * 2,
    h: rect.h + padding * 2,
  };
}

export function buildSpec(grid: { width: number; height: number }, params: Required<VariantParams>): BaseSpec {
  const margin = 3;
  const crossHeight = Math.max(0, params.crossHeight || 0);
  const outsideHeight = Math.max(2, params.outsideHeight || 3);
  const bandCount = Math.max(1, params.bandCount || 1);
  const usableBottom = grid.height - margin - outsideHeight - 1;
  const usableTop = margin;
  const usableHeight = usableBottom - usableTop;

  const minAvailableHeight = bandCount * MIN_ROOM_SIZE + crossHeight * (bandCount - 1);
  if (usableHeight < minAvailableHeight) {
    throw new Error(`Grid too short for ${bandCount} bands (need >= ${minAvailableHeight}, have ${usableHeight})`);
  }

  const corridorWidth = clamp(params.corridorWidth || 8, MIN_CORRIDOR_WIDTH, grid.width - margin * 2 - 8);
  const centerX = Math.floor(grid.width / 2);
  const corridorX0 = clamp(centerX - Math.floor(corridorWidth / 2), margin + 1, grid.width - margin - corridorWidth - 1);
  const corridorRects: RectSpec[] = [
    { x: corridorX0, y: usableTop, w: corridorWidth, h: Math.max(4, usableHeight) },
  ];

  const buffer = Math.max(2, Math.floor(corridorWidth / 3));
  const leftWidth = Math.max(MIN_ROOM_SIZE, corridorX0 - margin - buffer);
  const rightWidth = Math.max(MIN_ROOM_SIZE, grid.width - margin - (corridorX0 + corridorWidth) - buffer);
  const buildableRects: RectSpec[] = [];

  const maxBandHeight = Math.floor((usableHeight - crossHeight * (bandCount - 1)) / bandCount);
  const bandHeight = clamp(params.bandHeight || maxBandHeight, MIN_ROOM_SIZE, maxBandHeight);

  let yCursor = usableTop;
  for (let i = 0; i < bandCount; i++) {
    buildableRects.push({ x: margin, y: yCursor, w: leftWidth, h: bandHeight });
    buildableRects.push({
      x: grid.width - margin - rightWidth,
      y: yCursor,
      w: rightWidth,
      h: bandHeight,
    });
    yCursor += bandHeight;
    if (i < bandCount - 1 && crossHeight > 0) {
      corridorRects.push({ x: margin, y: yCursor, w: grid.width - margin * 2, h: crossHeight });
      yCursor += crossHeight;
    }
  }

  const poiZoneHeight = usableHeight;
  const poiLeftCenter = margin + Math.floor(leftWidth / 2);
  const poiRightCenter = grid.width - margin - Math.floor(rightWidth / 2);
  const bar = {
    w: params.bar?.w ?? 14,
    h: params.bar?.h ?? 5,
    side: params.bar?.side ?? "right",
    yOffset: params.bar?.yOffset ?? 0,
  };
  const gym = {
    w: params.gym?.w ?? 8,
    h: params.gym?.h ?? 5,
    side: params.gym?.side ?? "left",
    yOffset: params.gym?.yOffset ?? 0,
  };

  const pickPoiRect = (poi: PoiConfig, frac: number): RectSpec => {
    const centerY = usableTop + Math.floor(poiZoneHeight * frac) + poi.yOffset;
    const clampedY = clamp(centerY - Math.floor(poi.h / 2), usableTop, usableBottom - poi.h);
    const targetCenter = poi.side === "left" ? poiLeftCenter : poiRightCenter;
    const clampedX = clamp(Math.floor(targetCenter - poi.w / 2), margin, grid.width - margin - poi.w);
    return { x: clampedX, y: clampedY, w: poi.w, h: poi.h };
  };

  const barRect = pickPoiRect(bar, 0.65);
  const gymRect = pickPoiRect(gym, 0.35);

  const outsideRect: RectSpec = {
    x: margin,
    y: grid.height - outsideHeight - 1,
    w: grid.width - margin * 2,
    h: outsideHeight,
  };

  const exitWidth = clamp(params.exitWidth || 10, 4, grid.width - margin * 2);
  const exitX0 = clamp(centerX - Math.floor(exitWidth / 2), margin, grid.width - margin - exitWidth);
  const exitRect: RectSpec = {
    x: exitX0,
    y: Math.max(1, outsideRect.y - 3),
    w: exitWidth,
    h: Math.max(2, Math.min(3, usableHeight)),
  };
  // connector from exit into the building to guarantee an entrance path
  corridorRects.push({
    x: exitX0,
    y: Math.max(1, exitRect.y - Math.max(1, crossHeight)),
    w: exitWidth,
    h: Math.max(1, crossHeight),
  });

  const doorTiles: { x: number; y: number }[] = [];
  const ensureDoor = (rect: RectSpec) => {
    const cx = rect.x + Math.floor(rect.w / 2);
    const cy = rect.y + Math.floor(rect.h / 2);
    doorTiles.push({ x: cx, y: cy });
  };

  // Entrance door at exit center
  ensureDoor(exitRect);
  // Bar/gym doors facing the vertical corridor
  const corridorCenterX = corridorX0 + Math.floor(corridorWidth / 2);
  const makeSideDoor = (rect: RectSpec) => {
    const cy = rect.y + Math.floor(rect.h / 2);
    const leftSide = rect.x - 1;
    const rightSide = rect.x + rect.w;
    const useLeft = corridorCenterX <= rect.x;
    const x = useLeft ? leftSide : rightSide;
    const y = clamp(cy, rect.y, rect.y + rect.h - 1);
    doorTiles.push({ x, y });
  };
  makeSideDoor(barRect);
  makeSideDoor(gymRect);

  const addCorridorBridge = (from: { x: number; y: number }) => {
    const cx = corridorCenterX;
    const x0 = Math.min(from.x, cx);
    const w = Math.abs(from.x - cx) + 1;
    const h = Math.max(1, Math.min(2, crossHeight));
    corridorRects.push({
      x: x0,
      y: clamp(from.y - 1, usableTop, usableBottom),
      w,
      h,
    });
  };

  doorTiles.forEach(d => addCorridorBridge(d));

  const padding = 3;
  const carvedBuildables = carveBuildables(buildableRects, [padRect(barRect, padding), padRect(gymRect, padding)]);

  const bottomWallY = outsideRect.y - 1;
  const sideWallHeight = bottomWallY - (usableTop - 1) + 1;
  const wallRects: RectSpec[] = [
    { x: margin - 1, y: usableTop - 1, w: grid.width - (margin - 1) * 2, h: 1 },
    { x: margin - 1, y: usableTop - 1, w: 1, h: sideWallHeight },
    { x: grid.width - margin, y: usableTop - 1, w: 1, h: sideWallHeight },
  ];

  // bottom wall, leave a gap for the exit width
  const leftSpan = exitX0 - (margin - 1);
  if (leftSpan > 0) {
    wallRects.push({ x: margin - 1, y: bottomWallY, w: leftSpan, h: 1 });
  }
  const rightStart = exitX0 + exitWidth;
  const rightSpan = grid.width - (margin - 1) - rightStart;
  if (rightSpan > 0) {
    wallRects.push({ x: rightStart, y: bottomWallY, w: rightSpan, h: 1 });
  }

  return {
    buildableRects: carvedBuildables,
    corridorRects,
    barRect,
    gymRect,
    outsideRect,
    exitRect,
    wallRects,
    dormRowGap: clamp(params.dormRowGap ?? 0, 0, 3),
    doorTiles,
  };
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

function normalizeRange(r: RangeConfig | undefined, overrides: Partial<RangeConfig>): RangeConfig {
  const base = r ?? DEFAULT_RANGE;
  const merged: RangeConfig = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!value) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function expandRanges(range: RangeConfig): VariantParams[] {
  const combos = cartesianPick([
    range.corridorWidth ?? DEFAULT_RANGE.corridorWidth!,
    range.crossHeight ?? DEFAULT_RANGE.crossHeight!,
    range.bandHeight ?? DEFAULT_RANGE.bandHeight!,
    range.bandCount ?? DEFAULT_RANGE.bandCount!,
    range.dormRowGap ?? DEFAULT_RANGE.dormRowGap!,
    range.barWidth ?? DEFAULT_RANGE.barWidth!,
    range.barHeight ?? DEFAULT_RANGE.barHeight!,
    range.barSide ?? DEFAULT_RANGE.barSide!,
    range.barYOffset ?? DEFAULT_RANGE.barYOffset!,
    range.gymWidth ?? DEFAULT_RANGE.gymWidth!,
    range.gymHeight ?? DEFAULT_RANGE.gymHeight!,
    range.gymSide ?? DEFAULT_RANGE.gymSide!,
    range.gymYOffset ?? DEFAULT_RANGE.gymYOffset!,
    range.outsideHeight ?? DEFAULT_RANGE.outsideHeight!,
    range.exitWidth ?? DEFAULT_RANGE.exitWidth!,
  ]);

  return combos.map((arr, i) => {
    const [
      corridorWidth,
      crossHeight,
      bandHeight,
      bandCount,
      dormRowGap,
      barWidth,
      barHeight,
      barSide,
      barYOffset,
      gymWidth,
      gymHeight,
      gymSide,
      gymYOffset,
      outsideHeight,
      exitWidth,
    ] = arr as [number, number, number, number, number, number, Side, number, number, number, Side, number, number, number, number];
    return {
      name: `variant-${i + 1}`,
      corridorWidth,
      crossHeight,
      bandHeight,
      bandCount,
      dormRowGap,
      bar: { w: barWidth, h: barHeight, side: barSide, yOffset: barYOffset },
      gym: { w: gymWidth, h: gymHeight, side: gymSide, yOffset: gymYOffset },
      outsideHeight,
      exitWidth,
    };
  });
}

export async function generateMaps(opts: GenerateOptions): Promise<BaseSpecFile[]> {
  const template = await loadTemplate(opts.templatePath);
  const grid = opts.gridOverride ?? {
    width: template.width ?? DEFAULT_GRID.width,
    height: template.height ?? DEFAULT_GRID.height,
  };

  let variants: VariantParams[] = [];
  if (opts.explicit && opts.explicit.length) {
    variants = opts.explicit;
  } else {
    variants = expandRanges(opts.ranges ?? DEFAULT_RANGE);
  }

  const combos = variants.length;
  const maxCount = Math.max(1, opts.count);
  let picked: VariantParams[] = variants;

  if (variants.length > maxCount) {
    const rng = mulberry32(seedFromString(opts.seed || randomUUID()));
    const pool = [...variants];
    const sampled: VariantParams[] = [];
    while (sampled.length < maxCount && pool.length) {
      const idx = Math.floor(rng() * pool.length);
      sampled.push(pool.splice(idx, 1)[0]);
    }
    picked = sampled;
  }

  await ensureDir(opts.outDir);

  const out: BaseSpecFile[] = [];
  for (const variant of picked) {
    const params: Required<VariantParams> = {
      corridorWidth: variant.corridorWidth ?? DEFAULT_RANGE.corridorWidth![0],
      crossHeight: variant.crossHeight ?? DEFAULT_RANGE.crossHeight![0],
      bandHeight: variant.bandHeight ?? DEFAULT_RANGE.bandHeight![0],
      bandCount: variant.bandCount ?? DEFAULT_RANGE.bandCount![0],
      dormRowGap: variant.dormRowGap ?? DEFAULT_RANGE.dormRowGap![0],
      bar: {
        w: variant.bar?.w ?? DEFAULT_RANGE.barWidth![0],
        h: variant.bar?.h ?? DEFAULT_RANGE.barHeight![0],
        side: variant.bar?.side ?? DEFAULT_RANGE.barSide![0] as Side,
        yOffset: variant.bar?.yOffset ?? 0,
      },
      gym: {
        w: variant.gym?.w ?? DEFAULT_RANGE.gymWidth![0],
        h: variant.gym?.h ?? DEFAULT_RANGE.gymHeight![0],
        side: variant.gym?.side ?? DEFAULT_RANGE.gymSide![0] as Side,
        yOffset: variant.gym?.yOffset ?? 0,
      },
      outsideHeight: variant.outsideHeight ?? DEFAULT_RANGE.outsideHeight![0],
      exitWidth: variant.exitWidth ?? DEFAULT_RANGE.exitWidth![0],
      name: variant.name ?? "",
      seed: variant.seed ?? opts.seed,
    };

    const spec = buildSpec(grid, params);
    if (!isSpecConnected(grid, spec)) {
      // skip invalid layouts that block POIs from exit
      // eslint-disable-next-line no-console
      console.warn("Skipping disconnected map", params);
      continue;
    }
    const label = variant.name || `${opts.prefix}-${params.bandCount}b-${params.corridorWidth}cw-${params.bar?.w}bw`;
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

  const count = Number(args.count ?? args.max ?? 12);
  const seed = typeof args.seed === "string" ? args.seed : randomUUID();
  const prefix = typeof args.prefix === "string" ? args.prefix : "map";

  let ranges: RangeConfig | undefined;
  if (args.ranges && typeof args.ranges === "string") {
    ranges = await loadRanges(resolve(args.ranges));
  }

  const rangeOverrides: Partial<RangeConfig> = {};
  const corridorOverride = parseNumberList(typeof args.corridor === "string" ? args.corridor : undefined);
  if (corridorOverride.length) rangeOverrides.corridorWidth = corridorOverride;
  const crossOverride = parseNumberList(typeof args.cross === "string" ? args.cross : undefined);
  if (crossOverride.length) rangeOverrides.crossHeight = crossOverride;
  const bandHeightOverride = parseNumberList(typeof args.bandHeight === "string" ? args.bandHeight : undefined);
  if (bandHeightOverride.length) rangeOverrides.bandHeight = bandHeightOverride;
  const bandCountOverride = parseNumberList(typeof args.bandCount === "string" ? args.bandCount : undefined);
  if (bandCountOverride.length) rangeOverrides.bandCount = bandCountOverride;
  const dormRowGapOverride = parseNumberList(typeof args.rowGap === "string" ? args.rowGap : undefined);
  if (dormRowGapOverride.length) rangeOverrides.dormRowGap = dormRowGapOverride.map(n => Math.max(1, Math.min(3, n)));
  const outsideOverride = parseNumberList(typeof args.outside === "string" ? args.outside : undefined);
  if (outsideOverride.length) rangeOverrides.outsideHeight = outsideOverride;
  const exitOverride = parseNumberList(typeof args.exitWidth === "string" ? args.exitWidth : undefined);
  if (exitOverride.length) rangeOverrides.exitWidth = exitOverride;

  const barSizes = parseSizeList(typeof args.barSize === "string" ? args.barSize : undefined);
  if (barSizes.length) {
    rangeOverrides.barWidth = barSizes.map(s => s.w);
    rangeOverrides.barHeight = barSizes.map(s => s.h);
  }
  const gymSizes = parseSizeList(typeof args.gymSize === "string" ? args.gymSize : undefined);
  if (gymSizes.length) {
    rangeOverrides.gymWidth = gymSizes.map(s => s.w);
    rangeOverrides.gymHeight = gymSizes.map(s => s.h);
  }
  const barSides = parseCsv(typeof args.barSide === "string" ? args.barSide : undefined) as Side[];
  if (barSides.length) rangeOverrides.barSide = barSides;
  const gymSides = parseCsv(typeof args.gymSide === "string" ? args.gymSide : undefined) as Side[];
  if (gymSides.length) rangeOverrides.gymSide = gymSides;
  const barYOffset = parseNumberList(typeof args.barYOffset === "string" ? args.barYOffset : undefined);
  if (barYOffset.length) rangeOverrides.barYOffset = barYOffset;
  const gymYOffset = parseNumberList(typeof args.gymYOffset === "string" ? args.gymYOffset : undefined);
  if (gymYOffset.length) rangeOverrides.gymYOffset = gymYOffset;

  let explicit: VariantParams[] | undefined;
  if (args.params && typeof args.params === "string") {
    explicit = await loadParams(resolve(args.params));
  }

  const mergedRange = normalizeRange(ranges, rangeOverrides);
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

async function loadRanges(path: string): Promise<RangeConfig> {
  const file = await import("node:fs/promises");
  const raw = await file.readFile(path, "utf8");
  const json = JSON.parse(raw);
  if (Array.isArray(json)) {
    throw new Error("Ranges file should be an object, not an array. Use --params for explicit variants.");
  }
  return json as RangeConfig;
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
