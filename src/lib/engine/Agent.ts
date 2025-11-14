import type { AgentState, Vec2 } from "./Types";
import { Entity } from "./Entity";

export const AGENT_TYPES = [
  "Bookworm",
  "PartyAnimal",
  "GymRat",
  "Balanced",
  "Procrastinator",
  "Overachiever",
] as const;

export type AgentType = typeof AGENT_TYPES[number];

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
  agentType: AgentType = "Balanced";

  constructor(pos: Vec2) {
    super();
    this.pos = { ...pos };
  }

  setFacing(dx: number, dy: number) {
    const mag = Math.hypot(dx, dy);
    if (mag > 0) this.facing = { x: dx / mag, y: dy / mag };
  }

  resetRandomType(rng: () => number = Math.random) {
    const i = Math.floor(rng() * AGENT_TYPES.length);
    this.agentType = AGENT_TYPES[i];
  }
}

export type AgentProps = {
  [key in AgentType]: {
    [key in "morning" | "afternoon" | "night"]: {
      room: number;
      gym: number;
      bar: number;
    };
  };
};

export const AGENT_PROPS: AgentProps = {
  "Bookworm": {
    "morning": { "room": 0.80, "gym": 0.10, "bar": 0.10 },
    "afternoon": { "room": 0.70, "gym": 0.20, "bar": 0.10 },
    "night": { "room": 0.80, "gym": 0.0, "bar": 0.15 }
  },
  "PartyAnimal": {
    "morning": { "room": 0.80, "gym": 0.0, "bar": 0.20 },
    "afternoon": { "room": 0.25, "gym": 0.20, "bar": 0.55 },
    "night": { "room": 0.10, "gym": 0.0, "bar": 0.80 }
  },
  "GymRat": {
    "morning": { "room": 0.25, "gym": 0.65, "bar": 0.10 },
    "afternoon": { "room": 0.25, "gym": 0.60, "bar": 0.15 },
    "night": { "room": 0.60, "gym": 0.25, "bar": 0.15 }
  },
  "Balanced": {
    "morning": { "room": 0.55, "gym": 0.35, "bar": 0.10 },
    "afternoon": { "room": 0.35, "gym": 0.35, "bar": 0.30 },
    "night": { "room": 0.50, "gym": 0.0, "bar": 0.30 }
  },
  "Procrastinator": {
    "morning": { "room": 0.45, "gym": 0.20, "bar": 0.35 },
    "afternoon": { "room": 0.30, "gym": 0.20, "bar": 0.50 },
    "night": { "room": 0.20, "gym": 0.0, "bar": 0.65 }
  },
  "Overachiever": {
    "morning": { "room": 0.50, "gym": 0.40, "bar": 0.10 },
    "afternoon": { "room": 0.45, "gym": 0.40, "bar": 0.15 },
    "night": { "room": 0.40, "gym": 0.0, "bar": 0.35 }
  }
};
