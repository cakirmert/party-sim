import type { Vec2 } from "./Types";

export class Camera {
  zoom = 1; // 0.5..3
  offset: Vec2 = { x: 0, y: 0 }; // pixels

  clampZoom(z: number) { this.zoom = Math.min(3, Math.max(0.5, z)); }

  screenToWorld(px: number, py: number, tileSize: number): Vec2 {
    return {
      x: (px - this.offset.x) / (tileSize * this.zoom),
      y: (py - this.offset.y) / (tileSize * this.zoom),
    };
  }
  worldToScreen(wx: number, wy: number, tileSize: number): Vec2 {
    return {
      x: wx * tileSize * this.zoom + this.offset.x,
      y: wy * tileSize * this.zoom + this.offset.y,
    };
  }

  zoomAt(pivotPx: {x:number;y:number}, factor: number) {
    const oldZoom = this.zoom;
    this.clampZoom(this.zoom * factor);
    const k = this.zoom / oldZoom;
    // zoom toward pivot by adjusting offset
    this.offset.x = pivotPx.x - (pivotPx.x - this.offset.x) * k;
    this.offset.y = pivotPx.y - (pivotPx.y - this.offset.y) * k;
  }
}
