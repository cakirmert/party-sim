import type { AgentState, Vec2 } from "./Types";
import { Entity } from "./Entity";

export const AGENT_TYPES = [
  "Bookworm",
  "PartyAnimal",
  "GymRat",
  "Balanced",
] as const;

export type AgentType = typeof AGENT_TYPES[number];

export class Agent extends Entity {
  pos: Vec2;
  dest: Vec2 | null = null;
  speed = 2; // tiles/sec
  facing = { x: 1, y: 0 };
  roomId?: string;
  state: AgentState = "Breakfast";
  offMap?: { untilMinute: number; reason: "Study" | "Work" | "Shop" };
  stateTimer = 0;
  lastMapVersion = -1;
  needs: { hunger: number; energy: number; social: number } = { hunger: 0.6, energy: 1, social: 0.5 };
  pendingWander = true;
  moveProgress = 0;
  agentType: AgentType = "Balanced";
  recentTiles: Vec2[] = [];
  stuckTicks = 0;
  flowField: Uint16Array | null = null;
  flowFieldVersion = -1;
  flowFieldDest: Vec2 | null = null;
  navQueue: Vec2[] = [];

  constructor(pos: Vec2) {
    super();
    this.pos = { ...pos };
    this.recentTiles.push({ ...this.pos });
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

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type AgentProps = {
  [key in AgentType]: {
    [key in "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"]: {
      [key in "morning" | "afternoon" | "night"]: {
        room: number;
        gym: number;
        bar: number;
      };
    };
  };
};

export const AGENT_PROPS: AgentProps = {
  "Bookworm": {
    "Mon": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.9, "gym": 0.1, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Tue": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.9, "gym": 0.1, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Wed": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.9, "gym": 0.1, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Thu": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.9, "gym": 0.1, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Fri": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.8, "gym": 0.1, "bar": 0.1 },
      "night": { "room": 0.9, "gym": 0, "bar": 0.1 }
    },
    "Sat": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.8, "gym": 0.1, "bar": 0.1 },
      "night": { "room": 0.9, "gym": 0, "bar": 0.1 }
    },
    "Sun": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.9, "gym": 0.1, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    }
  },
  "PartyAnimal": {
    "Mon": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4 }
    },
    "Tue": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4 }
    },
    "Wed": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4 }
    },
    "Thu": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4 }
    },
    "Fri": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.2, "gym": 0.1, "bar": 0.7 }
    },
    "Sat": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.2, "gym": 0.1, "bar": 0.7 }
    },
    "Sun": {
      "morning": { "room": 1, "gym": 0, "bar": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4 }
    }
  },
  "GymRat": {
    "Mon": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Tue": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Wed": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Thu": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Fri": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 0.9, "gym": 0.005, "bar": 0.05 }
    },
    "Sat": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 0.9, "gym": 0.05, "bar": 0.05 }
    },
    "Sun": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    }
  },
  "Balanced": {
    "Mon": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Tue": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Wed": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Thu": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    },
    "Fri": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 0.5, "gym": 0.25, "bar": 0.25 }
    },
    "Sat": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 0.5, "gym": 0.25, "bar": 0.25 }
    },
    "Sun": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0 },
      "afternoon": { "room": 0.5, "gym": 0.25, "bar": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0 }
    }
  },
};
