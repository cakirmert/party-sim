import type { BaseSpec, RectSpec } from "@/lib/engine/Types";

type Side = "left" | "right";

export type PoiConfig = {
  w: number;
  h: number;
  side: Side;
  yOffset: number;
};

export type VariantParams = {
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

export const DEFAULT_RUNTIME_PARAMS: Required<VariantParams> = {
  corridorWidth: 2,
  crossHeight: 0,
  bandHeight: 12,
  bandCount: 0, // 0 => auto-fill vertical space
  dormRowGap: 3,
  bar: { w: 15, h: 6, side: "right", yOffset: 0 },
  gym: { w: 10, h: 5, side: "left", yOffset: 0 },
  outsideHeight: 4,
  exitWidth: 12,
  seed: "runtime",
};

const MIN_ROOM_SIZE = 6;

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

function rectsOverlap(a: RectSpec, b: RectSpec): boolean {
  const ax1 = a.x + a.w, ay1 = a.y + a.h;
  const bx1 = b.x + b.w, by1 = b.y + b.h;
  return a.x < bx1 && ax1 > b.x && a.y < by1 && ay1 > b.y;
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
  if (iy0 > ry0) out.push({ x: rx0, y: ry0, w: rect.w, h: iy0 - ry0 });
  if (iy1 < ry1) out.push({ x: rx0, y: iy1, w: rect.w, h: ry1 - iy1 });

  const midH = Math.max(0, iy1 - iy0);
  if (midH > 0) {
    if (ix0 > rx0) out.push({ x: rx0, y: iy0, w: ix0 - rx0, h: midH });
    if (ix1 < rx1) out.push({ x: ix1, y: iy0, w: rx1 - ix1, h: midH });
  }

  return out.filter(r => r.w > 0 && r.h > 0);
}

export function buildSpecRuntime(
  grid: { width: number; height: number },
  params: Required<VariantParams>
): BaseSpec {
  const margin = 3;
  const crossHeight = Math.max(0, params.crossHeight || 0);
  const outsideHeight = Math.max(2, params.outsideHeight || 3);
  const rowGap = clamp(params.dormRowGap ?? 2, 1, 5);
  const rng = mulberry32(seedFromString(params.seed || "map"));
  const usableBottom = grid.height - margin - outsideHeight - 1;
  const usableTop = margin;
  const usableHeight = usableBottom - usableTop;

  const requestedBandHeight = Math.max(MIN_ROOM_SIZE, params.bandHeight || MIN_ROOM_SIZE);
  const corridorWidth = clamp(params.corridorWidth || 2, 2, grid.width - margin * 2 - 8);
  const centerX = Math.floor(grid.width / 2);
  const corridorX0 = clamp(centerX - Math.floor(corridorWidth / 2), margin + 1, grid.width - margin - corridorWidth - 1);
  const corridorRects: RectSpec[] = [
    { x: corridorX0, y: usableTop, w: corridorWidth, h: Math.max(4, usableHeight) },
  ];

  const buffer = Math.max(2, Math.floor(corridorWidth / 3));
  const leftWidth = Math.max(MIN_ROOM_SIZE, corridorX0 - margin - buffer);
  const rightWidth = Math.max(MIN_ROOM_SIZE, grid.width - margin - (corridorX0 + corridorWidth) - buffer);
  const buildableRects: RectSpec[] = [];

  // room footprint (matches Engine)
  const roomInteriorW = 3;
  const roomInteriorH = 3;
  const wall = 1;
  const roomTotalW = roomInteriorW + wall * 2;
  const roomTotalH = roomInteriorH + wall * 2;
  const stepX = roomTotalW;
  const stepY = roomTotalH + rowGap;

  const minBandHeight = Math.max(requestedBandHeight, roomTotalH * 2 + rowGap); // ensure at least two rows fit

  const roomsPerRow = (width: number) => Math.max(0, Math.floor(width / stepX));
  const roomsPerBand = (height: number) => {
    const rows = Math.max(0, Math.floor((height - roomTotalH) / stepY) + 1);
    return rows * (roomsPerRow(leftWidth) + roomsPerRow(rightWidth));
  };

  let best = { bandHeight: minBandHeight, bandCount: 1, rooms: 0 };
  const maxBandsTry = Math.max(1, Math.floor(usableHeight / (roomTotalH + rowGap))) + 2;
  for (let bc = 1; bc <= maxBandsTry; bc++) {
    if (params.bandCount && params.bandCount > 0 && bc !== params.bandCount) continue;
    const maxH = Math.floor((usableHeight - crossHeight * Math.max(0, bc - 1)) / bc);
    if (maxH < roomTotalH * 2 + rowGap) continue;
    const bh = Math.min(minBandHeight, maxH);
    const rooms = roomsPerBand(bh) * bc;
    if (rooms > best.rooms) best = { bandHeight: bh, bandCount: bc, rooms };
  }

  const bandHeight = best.bandHeight;
  const bandCount = best.bandCount;

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
    if (i < bandCount - 1) {
      if (crossHeight > 0) {
        corridorRects.push({ x: margin, y: yCursor, w: grid.width - margin * 2, h: crossHeight });
        yCursor += crossHeight;
      }
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

  const corridorBody: RectSpec = { x: corridorX0, y: usableTop, w: corridorWidth, h: usableHeight };
  const corridorFootprints = () => corridorRects.map(r => ({ ...r }));
  const corridorOverlaps = (rect: RectSpec) => {
    const padded = { x: rect.x - 2, y: rect.y - 2, w: rect.w + 4, h: rect.h + 4 };
    return corridorFootprints().some(c => rectsOverlap(padded, c));
  };
  const tryPoi = (picker: () => RectSpec, other?: RectSpec): RectSpec => {
    let best = picker();
    for (let i = 0; i < 12; i++) {
      const cand = picker();
      const padded = { x: cand.x - 2, y: cand.y - 2, w: cand.w + 4, h: cand.h + 4 };
      const overlapsCorridor = corridorOverlaps(cand) || rectsOverlap(padded, corridorBody);
      const overlapsOther = other ? rectsOverlap(padded, other) : false;
      if (!overlapsCorridor && !overlapsOther) return cand;
      best = cand;
    }
    return best;
  };

  const barRect = tryPoi(() => pickPoiRect(bar, 0.55 + rng() * 0.35));
  const gymRect = tryPoi(() => pickPoiRect(gym, 0.25 + rng() * 0.35), barRect);

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

  ensureDoor(exitRect);
  const corridorCenterX = corridorX0 + Math.floor(corridorWidth / 2);
  const makeSideDoor = (rect: RectSpec) => {
    const cy = rect.y + Math.floor(rect.h / 2);
    const leftSide = rect.x - 1;
    const rightSide = rect.x + rect.w;
    const useLeft = corridorCenterX <= rect.x;
    const x = useLeft ? leftSide : rightSide;
    const y = clamp(cy, rect.y, rect.y + rect.h - 1);
    // widen entrance to 3 tiles tall
    for (let dy = -1; dy <= 1; dy++) {
      const yy = clamp(y + dy, rect.y, rect.y + rect.h - 1);
      doorTiles.push({ x, y: yy });
    }
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

  const padding = 6;
  const paddedBar = { x: barRect.x - padding, y: barRect.y - padding, w: barRect.w + padding * 2, h: barRect.h + padding * 2 };
  const paddedGym = { x: gymRect.x - padding, y: gymRect.y - padding, w: gymRect.w + padding * 2, h: gymRect.h + padding * 2 };
  const paddedOutside = { ...outsideRect };
  const paddedExit = { ...exitRect };
  const paddedPois = [paddedBar, paddedGym, paddedOutside, paddedExit];

  const pruneCorridors = (rects: RectSpec[]) => {
    const pruned: RectSpec[] = [];
    rects.forEach(r => {
      let slices = [r];
      for (const poi of paddedPois) {
        slices = slices.flatMap(s => subtractRect(s, poi));
        if (!slices.length) break;
      }
      pruned.push(...slices);
    });
    return pruned;
  };

  const prunedCorridors = pruneCorridors(corridorRects);

  const bottomWallY = outsideRect.y - 1;
  const sideWallHeight = bottomWallY - (usableTop - 1) + 1;
  const wallRects: RectSpec[] = [
    { x: margin - 1, y: usableTop - 1, w: grid.width - (margin - 1) * 2, h: 1 },
    { x: margin - 1, y: usableTop - 1, w: 1, h: sideWallHeight },
    { x: grid.width - margin, y: usableTop - 1, w: 1, h: sideWallHeight },
  ];

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
    buildableRects,
    corridorRects: prunedCorridors,
    barRect,
    gymRect,
    outsideRect,
    exitRect,
    wallRects,
    dormRowGap: clamp(params.dormRowGap ?? 1, 1, 5),
    doorTiles,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parameter Ranges for Sweep
// ─────────────────────────────────────────────────────────────────────────────

export type PoiSizeConfig = { w: number; h: number };

export type ParameterRanges = {
  corridorWidth: number[];
  crossHeight: number[];
  bandHeight: number[];
  bandCount: number[];
  dormRowGap: number[];
  barSizes: PoiSizeConfig[];
  barWidths: number[];
  barHeights: number[]; // New split dimensions
  barSides: Side[];
  barYOffsets: number[];
  gymSizes: PoiSizeConfig[];
  gymWidths: number[];
  gymHeights: number[]; // New split dimensions
  gymSides: Side[];
  gymYOffsets: number[];
  outsideHeight: number[];
  exitWidth: number[];
};

/**
 * Default parameter ranges matching the homepage random generation.
 * Bar/Gym sides are linked: bar on one side, gym on the opposite.
 */
export const DEFAULT_PARAMETER_RANGES: ParameterRanges = {
  corridorWidth: [2, 3, 4],
  crossHeight: [0],
  bandHeight: [12],
  bandCount: [0, 4],
  dormRowGap: [2, 3],
  barSizes: [
    { w: 14, h: 5 },
    { w: 16, h: 6 },
    { w: 18, h: 7 },
  ],
  barWidths: [14, 16],
  barHeights: [5, 6],
  barSides: ["left", "right"],
  barYOffsets: [-1, 0, 1],
  gymSizes: [
    { w: 8, h: 4 },
    { w: 10, h: 5 },
    { w: 12, h: 6 },
  ],
  gymWidths: [8, 10],
  gymHeights: [4, 5],
  gymSides: ["left", "right"], // Will be opposite of bar
  gymYOffsets: [-1, 0, 1],
  outsideHeight: [4],
  exitWidth: [10, 12],
};

/**
 * Calculate the total number of unique map variations from parameter ranges.
 * Bar and gym sides are linked (opposite), so we don't multiply by gymSides.
 */
export function calculateVariationCount(ranges: ParameterRanges): number {
  return (
    ranges.corridorWidth.length *
    ranges.crossHeight.length *
    ranges.bandHeight.length *
    ranges.bandCount.length *
    ranges.dormRowGap.length *
    ranges.bandCount.length *
    ranges.dormRowGap.length *
    (ranges.barSizes.length > 0 ? ranges.barSizes.length : (ranges.barWidths.length * ranges.barHeights.length)) *
    ranges.barSides.length * // gym side is opposite, so only count bar sides
    ranges.barYOffsets.length *
    (ranges.gymSizes.length > 0 ? ranges.gymSizes.length : (ranges.gymWidths.length * ranges.gymHeights.length)) *
    ranges.gymYOffsets.length *
    ranges.gymYOffsets.length *
    ranges.outsideHeight.length *
    ranges.exitWidth.length
  );
}

/**
 * Expand parameter ranges into an array of all possible VariantParams combinations.
 * Bar and gym are placed on opposite sides.
 */
export function expandParameterRanges(ranges: ParameterRanges, seed: string = "expand"): Required<VariantParams>[] {
  const variants: Required<VariantParams>[] = [];
  let idx = 0;

  for (const corridorWidth of ranges.corridorWidth) {
    for (const crossHeight of ranges.crossHeight) {
      for (const bandHeight of ranges.bandHeight) {
        for (const bandCount of ranges.bandCount) {
          for (const dormRowGap of ranges.dormRowGap) {
            // Support both explicit key-pair sizes OR separate cartesian product
            const barVariations = ranges.barSizes.length > 0
              ? ranges.barSizes
              : ranges.barWidths.flatMap(w => ranges.barHeights.map(h => ({ w, h })));

            for (const barSize of barVariations) {
              for (const barSide of ranges.barSides) {
                for (const barYOffset of ranges.barYOffsets) {
                  // Gym variations
                  const gymVariations = ranges.gymSizes.length > 0
                    ? ranges.gymSizes
                    : ranges.gymWidths.flatMap(w => ranges.gymHeights.map(h => ({ w, h })));

                  for (const gymSize of gymVariations) {
                    // Gym side is always opposite of bar
                    const gymSide: Side = barSide === "left" ? "right" : "left";
                    for (const gymYOffset of ranges.gymYOffsets) {
                      for (const outsideHeight of ranges.outsideHeight) {
                        for (const exitWidth of ranges.exitWidth) {
                          idx++;
                          variants.push({
                            corridorWidth,
                            crossHeight,
                            bandHeight,
                            bandCount,
                            dormRowGap,
                            bar: { w: barSize.w, h: barSize.h, side: barSide, yOffset: barYOffset },
                            gym: { w: gymSize.w, h: gymSize.h, side: gymSide, yOffset: gymYOffset },
                            outsideHeight,
                            exitWidth,
                            seed: `${seed}-${idx}`,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return variants;
}

/**
 * Parse CSV string of WxH size pairs into PoiSizeConfig array.
 * e.g., "14x5,16x6,18x7" -> [{w:14,h:5}, {w:16,h:6}, {w:18,h:7}]
 */
export function parseSizeList(raw: string | undefined): PoiSizeConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [w, h] = pair.toLowerCase().split("x").map(Number);
      if (Number.isFinite(w) && Number.isFinite(h)) return { w, h };
      return null;
    })
    .filter((v): v is PoiSizeConfig => Boolean(v));
}

/**
 * Parse CSV of numbers into number array.
 * e.g., "2,3,4" -> [2, 3, 4]
 */
export function parseNumberList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/**
 * Build ParameterRanges from form input strings, falling back to defaults.
 */
export function buildRangesFromForm(form: {
  corridor?: string;
  bandHeight?: string;
  bandCount?: string;
  rowGap?: string;
  barSize?: string;
  barX?: string;
  barY?: string;
  gymSize?: string;
  gymX?: string;
  gymY?: string;
  exitWidth?: string;
  outside?: string;
}): ParameterRanges {
  const corridorWidth = parseNumberList(form.corridor);
  const bandHeight = parseNumberList(form.bandHeight);
  const bandCount = parseNumberList(form.bandCount);
  const dormRowGap = parseNumberList(form.rowGap);
  const barSizes = parseSizeList(form.barSize);
  const gymSizes = parseSizeList(form.gymSize);
  const exitWidth = parseNumberList(form.exitWidth);
  const outsideHeight = parseNumberList(form.outside);

  return {
    corridorWidth: corridorWidth.length ? corridorWidth : DEFAULT_PARAMETER_RANGES.corridorWidth,
    crossHeight: DEFAULT_PARAMETER_RANGES.crossHeight,
    bandHeight: bandHeight.length ? bandHeight : DEFAULT_PARAMETER_RANGES.bandHeight,
    bandCount: bandCount.length ? bandCount : DEFAULT_PARAMETER_RANGES.bandCount,
    dormRowGap: dormRowGap.length ? dormRowGap : DEFAULT_PARAMETER_RANGES.dormRowGap,
    barSizes: barSizes.length ? barSizes : DEFAULT_PARAMETER_RANGES.barSizes,
    barWidths: DEFAULT_PARAMETER_RANGES.barWidths, // No form input for these, use default
    barHeights: DEFAULT_PARAMETER_RANGES.barHeights, // No form input for these, use default
    barSides: DEFAULT_PARAMETER_RANGES.barSides,
    barYOffsets: DEFAULT_PARAMETER_RANGES.barYOffsets,
    gymSizes: gymSizes.length ? gymSizes : DEFAULT_PARAMETER_RANGES.gymSizes,
    gymWidths: DEFAULT_PARAMETER_RANGES.gymWidths, // No form input for these, use default
    gymHeights: DEFAULT_PARAMETER_RANGES.gymHeights, // No form input for these, use default
    gymSides: DEFAULT_PARAMETER_RANGES.gymSides,
    gymYOffsets: DEFAULT_PARAMETER_RANGES.gymYOffsets,
    outsideHeight: outsideHeight.length ? outsideHeight : DEFAULT_PARAMETER_RANGES.outsideHeight,
    exitWidth: exitWidth.length ? exitWidth : DEFAULT_PARAMETER_RANGES.exitWidth,
  };
}
