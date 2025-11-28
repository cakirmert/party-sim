import type { BaseSpec, GridSize, MapJSON, Tile, TileTag, Vec2 } from "./Types";

export class GridMap {
  readonly width: number;
  readonly height: number;
  spec?: BaseSpec;
  private tiles: Tile[];
  private version = 0;

  constructor(size: GridSize, defaultTile: Tile = { walkable: true, moveCost: 1, tag: "BUILDABLE" }) {
    this.width = size.width;
    this.height = size.height;
    this.tiles = Array.from({ length: size.width * size.height }, () => ({ ...defaultTile }));
  }

  index(x: number, y: number) { return y * this.width + x; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  get(x: number, y: number): Tile {
    if (!this.inBounds(x, y)) throw new Error("GridMap.get: out of bounds");
    return this.tiles[this.index(x, y)];
  }

  getVersion() { return this.version; }

  private bumpVersion() { this.version++; }

  private setDirect(index: number, t: Tile) {
    this.tiles[index] = { ...t };
  }

  set(x: number, y: number, t: Tile) {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)] = { ...t };
    this.bumpVersion();
  }

  setWalkable(x: number, y: number, walkable: boolean) {
    const t = this.get(x, y);
    this.set(x, y, { ...t, walkable });
  }

  setMoveCost(x: number, y: number, moveCost: number) {
    const t = this.get(x, y);
    this.set(x, y, { ...t, moveCost });
  }

  setTag(x: number, y: number, tag?: TileTag) {
    const t = this.get(x, y);
    const nt: Tile = { ...t };
    if (tag === undefined) delete nt.tag; else nt.tag = tag;
    this.set(x, y, nt);
  }

  toggleWall(x: number, y: number) {
    const t = this.get(x, y);
    this.set(x, y, { ...t, walkable: !t.walkable });
  }

  toJSON(): MapJSON {
    return {
      width: this.width,
      height: this.height,
      tiles: this.tiles.map(t => ({ walkable: t.walkable, moveCost: t.moveCost, ...(t.tag ? { tag: t.tag } : {}) })),
      generated: true,
    };
  }

  static fromJSON(json: MapJSON): GridMap {
    const gm = new GridMap({ width: json.width, height: json.height });
    json.tiles.forEach((jt, i) => {
      gm.setDirect(i, { walkable: jt.walkable, moveCost: jt.moveCost, tag: jt.tag });
    });
    if (json.spec) gm.spec = json.spec;
    gm.bumpVersion();
    return gm;
  }

  // --- Neighbors ---
  neighbors4(x: number, y: number): Vec2[] {
    const out: Vec2[] = [];
    if (this.inBounds(x, y - 1)) out.push({ x, y: y - 1 });
    if (this.inBounds(x + 1, y)) out.push({ x: x + 1, y });
    if (this.inBounds(x, y + 1)) out.push({ x, y: y + 1 });
    if (this.inBounds(x - 1, y)) out.push({ x: x - 1, y });
    return out;
  }

  neighbors8(x: number, y: number): Vec2[] {
    const out = this.neighbors4(x, y);
    const diag = [
      { x: x + 1, y: y - 1 }, { x: x + 1, y: y + 1 },
      { x: x - 1, y: y + 1 }, { x: x - 1, y: y - 1 },
    ];
    for (const p of diag) if (this.inBounds(p.x, p.y)) out.push(p);
    return out;
  }

  // --- Spec expansion helpers ---
  static buildFromSpec(grid: GridSize, spec: BaseSpec): GridMap {
    const gm = new GridMap(grid, { walkable: true, moveCost: 1, tag: "BUILDABLE" });

    const stamp = (
      r: { x: number; y: number; w: number; h: number },
      tag: TileTag,
      walkable = true,
      moveCost = 1
    ) => {
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) {
          if (!gm.inBounds(xx, yy)) continue;
          gm.set(xx, yy, { walkable, moveCost, tag });
        }
      }
    };

    // 1) buildable areas (dorm strips etc.)
    for (const b of spec.buildableRects) {
      stamp(b, "BUILDABLE", true, 1);
    }

    // 2) corridors
    if (spec.corridorRects) {
      for (const r of spec.corridorRects) {
        stamp(r, "CORRIDOR", true, 1);
      }
    }

    // 3) key areas
    stamp(spec.barRect, "BAR", true, 1);
    stamp(spec.gymRect, "GYM", true, 1);
    stamp(spec.outsideRect, "OUTSIDE", true, 1);
    

    // 4) explicit walls from JSON (outer frame etc.)
    if (spec.wallRects) {
      for (const w of spec.wallRects) {
        for (let yy = w.y; yy < w.y + w.h; yy++) {
          for (let xx = w.x; xx < w.x + w.w; xx++) {
            if (!gm.inBounds(xx, yy)) continue;
            gm.set(xx, yy, {
              walkable: false,
              moveCost: 1,
              tag: "WALL",
            });
          }
        }
      }
    }

    // 5) AUTO WALL BORDER around BAR & GYM (only on BUILDABLE tiles)
    const addWallBorder = (r: { x: number; y: number; w: number; h: number }) => {
      const innerX0 = r.x;
      const innerY0 = r.y;
      const innerX1 = r.x + r.w - 1;
      const innerY1 = r.y + r.h - 1;

      const x0 = innerX0 - 1;
      const x1 = innerX1 + 1;
      const y0 = innerY0 - 1;
      const y1 = innerY1 + 1;

      const placeWallIfBuildable = (x: number, y: number) => {
        if (!gm.inBounds(x, y)) return;
        const base = gm.get(x, y);
        if (base.tag !== "BUILDABLE") return; // don't overwrite corridors, exit, outside, etc.
        gm.set(x, y, { ...base, walkable: false, moveCost: 1, tag: "WALL" });
      };

      // top & bottom edges
      for (let x = x0; x <= x1; x++) {
        placeWallIfBuildable(x, y0);
        placeWallIfBuildable(x, y1);
      }
      // left & right edges (between top/bottom so we don't double corners)
      for (let y = innerY0; y <= innerY1; y++) {
        placeWallIfBuildable(x0, y);
        placeWallIfBuildable(x1, y);
      }
    };

    addWallBorder(spec.barRect);
    addWallBorder(spec.gymRect);

    // 6) AUTO DOORS for BAR & GYM (cut through wall ring)
    const addAutoDoorBand = (rect: { x: number; y: number; w: number; h: number }) => {
      type Side = "top" | "bottom" | "left" | "right";

      const candidatesBySide: Record<Side, { x: number; y: number }[]> = {
        top: [],
        bottom: [],
        left: [],
        right: [],
      };

      const innerX0 = rect.x;
      const innerY0 = rect.y;
      const innerX1 = rect.x + rect.w - 1;
      const innerY1 = rect.y + rect.h - 1;

      const x0 = innerX0 - 1;      // wall ring coords
      const x1 = innerX1 + 1;
      const y0 = innerY0 - 1;
      const y1 = innerY1 + 1;

      const isRoom = (t: Tile) => t.tag === "BAR" || t.tag === "GYM";

      // ---- TOP side: wall at (x, y0), room inside at (x, y0+1), corridor outside at (x, y0-1)
      for (let x = innerX0; x <= innerX1; x++) {
        const wx = x, wy = y0;
        const insideY = y0 + 1;
        const outsideY = y0 - 1;
        if (!gm.inBounds(wx, wy) || !gm.inBounds(wx, insideY) || !gm.inBounds(wx, outsideY)) continue;
        const wall = gm.get(wx, wy);
        const inside = gm.get(wx, insideY);
        const outside = gm.get(wx, outsideY);
        if (wall.tag === "WALL" && isRoom(inside) && outside.tag === "CORRIDOR") {
          candidatesBySide.top.push({ x: wx, y: wy });
        }
      }

      // ---- BOTTOM side
      for (let x = innerX0; x <= innerX1; x++) {
        const wx = x, wy = y1;
        const insideY = y1 - 1;
        const outsideY = y1 + 1;
        if (!gm.inBounds(wx, wy) || !gm.inBounds(wx, insideY) || !gm.inBounds(wx, outsideY)) continue;
        const wall = gm.get(wx, wy);
        const inside = gm.get(wx, insideY);
        const outside = gm.get(wx, outsideY);
        if (wall.tag === "WALL" && isRoom(inside) && outside.tag === "CORRIDOR") {
          candidatesBySide.bottom.push({ x: wx, y: wy });
        }
      }

      // ---- LEFT side
      for (let y = innerY0; y <= innerY1; y++) {
        const wx = x0, wy = y;
        const insideX = x0 + 1;
        const outsideX = x0 - 1;
        if (!gm.inBounds(wx, wy) || !gm.inBounds(insideX, wy) || !gm.inBounds(outsideX, wy)) continue;
        const wall = gm.get(wx, wy);
        const inside = gm.get(insideX, wy);
        const outside = gm.get(outsideX, wy);
        if (wall.tag === "WALL" && isRoom(inside) && outside.tag === "CORRIDOR") {
          candidatesBySide.left.push({ x: wx, y: wy });
        }
      }

      // ---- RIGHT side
      for (let y = innerY0; y <= innerY1; y++) {
        const wx = x1, wy = y;
        const insideX = x1 - 1;
        const outsideX = x1 + 1;
        if (!gm.inBounds(wx, wy) || !gm.inBounds(insideX, wy) || !gm.inBounds(outsideX, wy)) continue;
        const wall = gm.get(wx, wy);
        const inside = gm.get(insideX, wy);
        const outside = gm.get(outsideX, wy);
        if (wall.tag === "WALL" && isRoom(inside) && outside.tag === "CORRIDOR") {
          candidatesBySide.right.push({ x: wx, y: wy });
        }
      }

      // ---- choose side with most corridor contact
      let bestSide: Side | null = null;
      let bestList: { x: number; y: number }[] = [];
      (["top", "bottom", "left", "right"] as Side[]).forEach(side => {
        const list = candidatesBySide[side];
        if (list.length > bestList.length) {
          bestList = list;
          bestSide = side;
        }
      });

      if (!bestSide || bestList.length === 0) return;

      // band of up to 4 doors, centred
      const span = Math.min(4, bestList.length);
      const center = Math.floor(bestList.length / 2);
      const start = Math.max(
        0,
        Math.min(center - Math.floor(span / 2), bestList.length - span)
      );

      for (let i = start; i < start + span; i++) {
        const { x, y } = bestList[i];
        gm.set(x, y, { walkable: true, moveCost: 1, tag: "DOOR" });
      }
    };

    addAutoDoorBand(spec.barRect);
    addAutoDoorBand(spec.gymRect);

    // 7) manual doorTiles override if you ever add them again
    if (spec.doorTiles) {
      for (const d of spec.doorTiles) {
        if (!gm.inBounds(d.x, d.y)) continue;
        gm.set(d.x, d.y, { walkable: true, moveCost: 1, tag: "DOOR" });
      }
    }
    // 8) Fill empty interior with CORRIDOR
    //    (any walkable tile inside the outer walls that has no real tag)
    if (spec.wallRects && spec.wallRects.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      // compute overall bounding box of all walls (outer ring)
      for (const w of spec.wallRects) {
        minX = Math.min(minX, w.x);
        minY = Math.min(minY, w.y);
        maxX = Math.max(maxX, w.x + w.w - 1);
        maxY = Math.max(maxY, w.y + w.h - 1);
      }

      // go over everything *inside* that box (not including the wall tiles themselves)
      for (let y = minY + 1; y <= maxY - 1; y++) {
        for (let x = minX + 1; x <= maxX - 1; x++) {
          const t = gm.get(x, y);

          // skip non-walkable (walls) and already tagged things
          if (!t.walkable) continue;
          if (t.tag && t.tag !== "BUILDABLE") continue;

          // turn "empty" into corridor
          gm.set(x, y, {
            ...t,
            walkable: true,
            moveCost: 1,
            tag: "CORRIDOR",
          });
        }
      }
    }
    stamp(spec.exitRect, "EXIT", true, 1);
    gm.spec = spec;
    return gm;
  }

}
