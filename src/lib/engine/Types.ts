export type Vec2 = { x: number; y: number };
export type WanderTarget = { point: Vec2, room?: string };
export type PathMetric = { length: number, room?: string };
export type Dir = 0|1|2|3|4|5|6|7; // N,NE,E,SE,S,SW,W,NW
export type BoundingBox = { x0: number; y0: number; x1: number; y1: number; tiles: number };

type RoomMetrics = {
  totalLength: number;
  count: number;
};

export type MetricsMap = Record<string, RoomMetrics>;

export type TileTag =
  | "BUILDABLE"   // editable by map editor
  | "LOCKED"      // generated, non-editable
  | "ROOM"
  | "DOOR"
  | "CORRIDOR"
  | "BAR"
  | "GYM"
  | "OUTSIDE"
  | "EXIT"
  | "ROAD"
  | "BED"
  | "WALL";

export interface Tile {
  walkable: boolean;
  moveCost: number;  // Only affects movement/path weight. No build costs in this project.
  tag?: TileTag;
}

export interface GridSize { width: number; height: number; }

export interface MapJSON {
  width: number;
  height: number;
  tiles: Tile[];
  // Optional base spec (used for initial generation)
  generated?: boolean;
  spec?: BaseSpec;
}

// “Spec-driven” base map recipe, small JSON so we don't ship a massive tiles array.
// Engine will expand this into tiles on boot/reset.
export interface RectSpec { x: number; y: number; w: number; h: number; }
export interface BaseSpec {
  corridorRects?: { x: number; y: number; w: number; h: number }[];
  buildableRects: RectSpec[]; // tagged BUILDABLE
  barRect: RectSpec;          // BAR
  gymRect: RectSpec;          // GYM
  outsideRect: RectSpec;      // OUTSIDE
  exitRect: RectSpec;         // ROAD/EXIT area (walkable)
  wallRects?: RectSpec[];     // WALLS
  doorTiles?: { x: number; y: number }[];
}

export interface EngineConfig {
  grid: GridSize;
  diagonal: true;        // 8-dir default
  seed: string;
  baseTickRate: number;  // logical ticks/sec @ 1x
  pixelsPerTile: number; // for renderer
}

export type SimSpeed = 0.25 | 0.5 | 1 | 2 | 4 | 8 | 16 | 32 | 64;

export type AgentState = "Idle"|"Wander"|"GoingToExit"|"OffMap"|"Returning"|"Breakfast"|"AtBar"|"AtGym"|"InRoom";
