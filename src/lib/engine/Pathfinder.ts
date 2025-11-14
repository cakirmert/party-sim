import type { Vec2 } from "./Types";
import { GridMap } from "./GridMap";

function heuristic(a: Vec2, b: Vec2): number {
  // Octile distance
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  const F = Math.SQRT2 - 1;
  return (dx < dy) ? F * dx + dy : F * dy + dx;
}

export function aStar8(map: GridMap, start: Vec2, goal: Vec2): Vec2[] | null {
  if (!map.inBounds(start.x, start.y) || !map.inBounds(goal.x, goal.y)) return null;
  if (!map.get(goal.x, goal.y).walkable) return null;

  const w = map.width, h = map.height;
  const size = w * h;
  const idx = (x: number, y: number) => y * w + x;

  const open = new MinHeap<{ i: number; f: number }>((a, b) => a.f - b.f);
  const cameFrom = new Int32Array(size).fill(-1);
  const gScore = new Float32Array(size).fill(Infinity);
  const fScore = new Float32Array(size).fill(Infinity);
  const closed = new Uint8Array(size);

  const s = idx(start.x, start.y);
  const g = idx(goal.x, goal.y);

  gScore[s] = 0;
  fScore[s] = heuristic(start, goal);
  open.push({ i: s, f: fScore[s] });

  while (!open.isEmpty()) {
    const current = open.pop()!;
    const ci = current.i;
    if (ci === g) {
      const path: Vec2[] = [];
      let cur = g;
      while (cur !== s) {
        const x = cur % w, y = (cur / w) | 0;
        path.push({ x, y });
        cur = cameFrom[cur];
      }
      path.reverse();
      return path;
    }
    if (closed[ci]) continue;
    closed[ci] = 1;

    const cx = ci % w, cy = (ci / w) | 0;

    for (const nb of map.neighbors8(cx, cy)) {
      if (!map.get(nb.x, nb.y).walkable) continue;
      const ni = idx(nb.x, nb.y);
      if (closed[ni]) continue;

      const dx = nb.x - cx, dy = nb.y - cy;
      if (dx !== 0 && dy !== 0) {
        const adj1 = map.get(cx + dx, cy);
        const adj2 = map.get(cx, cy + dy);
        if (!adj1.walkable || !adj2.walkable) continue;
      }
      const stepDist = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1;
      const moveCost = map.get(nb.x, nb.y).moveCost || 1;
      const tentative = gScore[ci] + stepDist * moveCost;

      if (tentative < gScore[ni]) {
        cameFrom[ni] = ci;
        gScore[ni] = tentative;
        fScore[ni] = tentative + heuristic(nb, goal);
        open.push({ i: ni, f: fScore[ni] });
      }
    }
  }
  return null;
}

class MinHeap<T> {
  private a: T[] = [];
  private cmp: (x: T, y: T) => number;
  constructor(cmp: (x: T, y: T) => number) { this.cmp = cmp; }
  isEmpty() { return this.a.length === 0; }
  push(v: T) { this.a.push(v); this.up(this.a.length - 1); }
  pop(): T | undefined {
    const a = this.a; if (!a.length) return;
    const top = a[0]; const end = a.pop()!;
    if (a.length) { a[0] = end; this.down(0); }
    return top;
  }
  private up(i: number) {
    const a = this.a, cmp = this.cmp; while (i > 0) {
      const p = (i - 1) >> 1; if (cmp(a[i], a[p]) >= 0) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  private down(i: number) {
    const a = this.a, cmp = this.cmp, n = a.length;
    while (true) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && cmp(a[l], a[m]) < 0) m = l;
      if (r < n && cmp(a[r], a[m]) < 0) m = r;
      if (m === i) break;
      [a[i], a[m]] = [a[m], a[i]]; i = m;
    }
  }
}
