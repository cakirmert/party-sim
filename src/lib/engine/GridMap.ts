import type { BaseSpec, GridSize, MapJSON, Tile, TileTag, Vec2 } from "./Types";

export class GridMap {
  spec?: BaseSpec; 
  readonly width: number;
  readonly height: number;
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
    gm.bumpVersion();
    return gm;
  }

  // ——— Neighbors ———
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

  // ——— Spec expansion helpers ———

  static buildFromSpec(grid: GridSize, spec: BaseSpec): GridMap {
    const gm = new GridMap(grid, { walkable: true, moveCost: 1, tag: "BUILDABLE" });

    // helper to stamp rects
    const stamp = (r: { x: number; y: number; w: number; h: number }, tag: TileTag, walkable = true, moveCost = 1) => {
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) {
          if (!gm.inBounds(xx, yy)) continue;
          gm.set(xx, yy, { walkable, moveCost, tag });
        }
      }
    };


    if (spec.corridorRects) {
      for (const c of spec.corridorRects) {
        for (let yy = c.y; yy < c.y + c.h; yy++) {
          for (let xx = c.x; xx < c.x + c.w; xx++) {
            if (!gm.inBounds(xx, yy)) continue;
            gm.set(xx, yy, { walkable: true, moveCost: 1, tag: "CORRIDOR" });
          }
        }
      }
    }

    // establish buildable areas
    for (const b of spec.buildableRects) {
      for (let yy = b.y; yy < b.y + b.h; yy++) {
        for (let xx = b.x; xx < b.x + b.w; xx++) {
          if (!gm.inBounds(xx, yy)) continue;
          gm.set(xx, yy, { walkable: true, moveCost: 1, tag: "BUILDABLE" });
        }
      }
    }

    // key areas
    stamp(spec.barRect, "BAR", true, 1);
    stamp(spec.gymRect, "GYM", true, 1);
    stamp(spec.outsideRect, "OUTSIDE", true, 1);
    stamp(spec.exitRect, "EXIT", true, 1);
    // corridors
if (spec.corridorRects) {
  for (const r of spec.corridorRects) {
    stamp(r, "CORRIDOR", true, 1);
  }
}

    gm.spec = spec; // ✅ attach your JSON
    return gm;      // ✅ return the actual map with everything on it
  }

}
