import type { MapJSON, Vec2 } from "./Types";

export type Command =
  | { type: "SET_AGENT_COUNT"; count: number } // full reset @06:00 + regen dorm + respawn
  | { type: "SPAWN_AGENT"; pos: Vec2 }
  | { type: "MOVE_AGENT_TO"; id: string; dest: Vec2 }
  | { type: "MAP_TOGGLE_WALL"; pos: Vec2 }
  | { type: "MAP_SET_MOVECOST"; pos: Vec2; moveCost: number }
  | { type: "MAP_LOAD_JSON"; map: MapJSON }
  | { type: "MAP_SAVE_REQUEST" };
