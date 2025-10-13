import type { AgentState, Vec2 } from "./Types";
import { Entity } from "./Entity";

export class Agent extends Entity {
  pos: Vec2;
  dest: Vec2 | null = null;
  path: Vec2[] | null = null;
  speed = 2; // tiles/sec
  facing = { x: 1, y: 0 };
  roomId?: string;
  state: AgentState = "Breakfast";
  offMap?: { untilMinute: number; reason: "Study" | "Work" | "Shop" };
  stateTimer = 0;
  lastPathMapVersion = -1;
  needs: { hunger: number; energy: number; social: number } = { hunger: 0.6, energy: 1, social: 0.5 };
  pendingWander = true;
  moveProgress = 0;

  constructor(pos: Vec2) {
    super();
    this.pos = { ...pos };
  }

  setFacing(dx: number, dy: number) {
    const mag = Math.hypot(dx, dy);
    if (mag > 0) this.facing = { x: dx / mag, y: dy / mag };
  }
}
