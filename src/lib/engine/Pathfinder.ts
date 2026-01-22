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
// ——— Advanced Pathing ———

/**
 * Computes a Dijkstra Map (distance field) from a set of target tiles.
 * Returns a Uint16Array where value is distance * 10 (fixed point).
 * 65535 = Unreachable.
 */
export function computeDijkstraMap(map: GridMap, targets: Vec2[]): Uint16Array {
  const w = map.width, h = map.height;
  const size = w * h;
  const grid = new Uint16Array(size).fill(0xffff); // Max value

  const idx = (x: number, y: number) => y * w + x;
  const queue: Vec2[] = [];

  for (const t of targets) {
    if (map.inBounds(t.x, t.y)) {
      const i = idx(t.x, t.y);
      grid[i] = 0;
      queue.push(t);
    }
  }

  // FIFO Queue for BFS (Dijkstra with uniform/small integer weights is roughly BFS)
  // Actually standard Dijkstra needed if weights vary, but here moveCost is usually 1.
  // Standard BFS is O(N).

  let head = 0;
  while (head < queue.length) {
    const { x, y } = queue[head++];
    const i = idx(x, y);
    const dist = grid[i];

    // Check neighbors
    // Using 4-neighbors or 8? Man only requests FlowField for general direction.
    // 8-way is better for smooth movement.
    const neighbors = [
      { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
      { x: x + 1, y: y + 1 }, { x: x + 1, y: y - 1 }, { x: x - 1, y: y + 1 }, { x: x - 1, y: y - 1 }
    ];

    for (const n of neighbors) {
      if (!map.inBounds(n.x, n.y)) continue;
      const ni = idx(n.x, n.y);
      const tile = map.get(n.x, n.y);
      if (!tile.walkable) continue;

      // Cost: 10 for straight, 14 for diagonal? Or just 1.
      // Let's use 10/14 fixed point for precision.
      const isDiag = (n.x !== x && n.y !== y);
      const cost = (tile.moveCost || 1) * (isDiag ? 14 : 10);

      const newDist = dist + cost;
      if (newDist < grid[ni]) {
        grid[ni] = newDist as number;
        queue.push(n);
      }
    }
  }
  return grid;
}

/**
 * Perform string pulling (path smoothing) on a path.
 * Retains start and end. Tries to remove intermediate nodes if LOS exists.
 */
export function stringPull(map: GridMap, path: Vec2[]): Vec2[] {
  if (path.length < 3) return path;

  // Simple greedy algorithm
  const newPath: Vec2[] = [path[0]];
  let idx = 0;

  while (idx < path.length - 1) {
    let furthestIdx = idx + 1;
    // Look ahead as far as possible
    for (let i = idx + 2; i < path.length; i++) {
      // Limit lookahead to avoid expensive LOS checks on huge paths?
      // Let's try full lookahead for quality.
      if (hasLineOfSight(map, path[idx], path[i])) {
        furthestIdx = i;
      } else {
        // Optimization: If we fail LOS to i, we probably usually fail to i+1 ...
        // But walls are complex. 
        // For greedy string pulling, we usually just find the FIRST obstacle or furthest visible.
        // If we assume convexity of obstacles, we can stop? No.
      }
    }
    newPath.push(path[furthestIdx]);
    idx = furthestIdx;
  }
  return newPath;
}

function hasLineOfSight(map: GridMap, start: Vec2, end: Vec2): boolean {
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;

  // Check center-to-center ray
  // Ideally we check if the thick line passes through walls.
  // For path smoothing, center ray is often "good enough" if we are careful.
  // But cutting corners too close to walls might be an issue.
  // Let's stick to simple Bresenham for now.

  while (true) {
    if (!map.inBounds(x0, y0)) return false;
    const tile = map.get(x0, y0);
    if (!tile.walkable) return false;

    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return true;
}
