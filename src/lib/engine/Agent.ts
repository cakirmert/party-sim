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
      "morning": { "room": 0.80, "gym": 0.10, "bar": 0.10 },
      "afternoon": { "room": 0.75, "gym": 0.15, "bar": 0.10 },
      "night": { "room": 0.85, "gym": 0.00, "bar": 0.12 }
    },
    "Tue": {
      "morning": { "room": 0.82, "gym": 0.10, "bar": 0.08 },
      "afternoon": { "room": 0.72, "gym": 0.18, "bar": 0.10 },
      "night": { "room": 0.85, "gym": 0.00, "bar": 0.13 }
    },
    "Wed": {
      "morning": { "room": 0.80, "gym": 0.12, "bar": 0.08 },
      "afternoon": { "room": 0.70, "gym": 0.20, "bar": 0.10 },
      "night": { "room": 0.83, "gym": 0.00, "bar": 0.15 }
    },
    "Thu": {
      "morning": { "room": 0.78, "gym": 0.12, "bar": 0.10 },
      "afternoon": { "room": 0.68, "gym": 0.22, "bar": 0.10 },
      "night": { "room": 0.80, "gym": 0.00, "bar": 0.18 }
    },
    "Fri": {
      "morning": { "room": 0.78, "gym": 0.12, "bar": 0.10 },
      "afternoon": { "room": 0.70, "gym": 0.20, "bar": 0.10 },
      "night": { "room": 0.70, "gym": 0.00, "bar": 0.28 }
    },
    "Sat": {
      "morning": { "room": 0.80, "gym": 0.10, "bar": 0.10 },
      "afternoon": { "room": 0.74, "gym": 0.14, "bar": 0.12 },
      "night": { "room": 0.70, "gym": 0.00, "bar": 0.30 }
    },
    "Sun": {
      "morning": { "room": 0.88, "gym": 0.07, "bar": 0.05 },
      "afternoon": { "room": 0.82, "gym": 0.10, "bar": 0.08 },
      "night": { "room": 0.87, "gym": 0.00, "bar": 0.10 }
    }
  },
  "PartyAnimal": {
    "Mon": {
      "morning": { "room": 0.80, "gym": 0.00, "bar": 0.20 },
      "afternoon": { "room": 0.35, "gym": 0.20, "bar": 0.45 },
      "night": { "room": 0.20, "gym": 0.00, "bar": 0.75 }
    },
    "Tue": {
      "morning": { "room": 0.78, "gym": 0.00, "bar": 0.22 },
      "afternoon": { "room": 0.30, "gym": 0.20, "bar": 0.50 },
      "night": { "room": 0.18, "gym": 0.00, "bar": 0.78 }
    },
    "Wed": {
      "morning": { "room": 0.75, "gym": 0.00, "bar": 0.25 },
      "afternoon": { "room": 0.28, "gym": 0.20, "bar": 0.52 },
      "night": { "room": 0.15, "gym": 0.00, "bar": 0.80 }
    },
    "Thu": {
      "morning": { "room": 0.70, "gym": 0.00, "bar": 0.30 },
      "afternoon": { "room": 0.25, "gym": 0.20, "bar": 0.55 },
      "night": { "room": 0.12, "gym": 0.00, "bar": 0.85 }
    },
    "Fri": {
      "morning": { "room": 0.65, "gym": 0.00, "bar": 0.35 },
      "afternoon": { "room": 0.20, "gym": 0.18, "bar": 0.62 },
      "night": { "room": 0.10, "gym": 0.00, "bar": 0.88 }
    },
    "Sat": {
      "morning": { "room": 0.60, "gym": 0.00, "bar": 0.40 },
      "afternoon": { "room": 0.20, "gym": 0.15, "bar": 0.65 },
      "night": { "room": 0.08, "gym": 0.00, "bar": 0.90 }
    },
    "Sun": {
      "morning": { "room": 0.75, "gym": 0.00, "bar": 0.25 },
      "afternoon": { "room": 0.35, "gym": 0.20, "bar": 0.45 },
      "night": { "room": 0.30, "gym": 0.00, "bar": 0.70 }
    }
  },
  "GymRat": {
    "Mon": {
      "morning": { "room": 0.25, "gym": 0.65, "bar": 0.10 },
      "afternoon": { "room": 0.25, "gym": 0.60, "bar": 0.15 },
      "night": { "room": 0.60, "gym": 0.25, "bar": 0.15 }
    },
    "Tue": {
      "morning": { "room": 0.25, "gym": 0.65, "bar": 0.10 },
      "afternoon": { "room": 0.23, "gym": 0.62, "bar": 0.15 },
      "night": { "room": 0.60, "gym": 0.25, "bar": 0.15 }
    },
    "Wed": {
      "morning": { "room": 0.22, "gym": 0.68, "bar": 0.10 },
      "afternoon": { "room": 0.23, "gym": 0.62, "bar": 0.15 },
      "night": { "room": 0.60, "gym": 0.25, "bar": 0.15 }
    },
    "Thu": {
      "morning": { "room": 0.22, "gym": 0.68, "bar": 0.10 },
      "afternoon": { "room": 0.23, "gym": 0.62, "bar": 0.15 },
      "night": { "room": 0.60, "gym": 0.25, "bar": 0.15 }
    },
    "Fri": {
      "morning": { "room": 0.28, "gym": 0.62, "bar": 0.10 },
      "afternoon": { "room": 0.25, "gym": 0.60, "bar": 0.15 },
      "night": { "room": 0.65, "gym": 0.20, "bar": 0.15 }
    },
    "Sat": {
      "morning": { "room": 0.40, "gym": 0.45, "bar": 0.15 },
      "afternoon": { "room": 0.35, "gym": 0.50, "bar": 0.15 },
      "night": { "room": 0.62, "gym": 0.23, "bar": 0.15 }
    },
    "Sun": {
      "morning": { "room": 0.45, "gym": 0.40, "bar": 0.15 },
      "afternoon": { "room": 0.40, "gym": 0.45, "bar": 0.15 },
      "night": { "room": 0.62, "gym": 0.23, "bar": 0.15 }
    }
  },
  "Balanced": {
    "Mon": {
      "morning": { "room": 0.55, "gym": 0.35, "bar": 0.10 },
      "afternoon": { "room": 0.35, "gym": 0.35, "bar": 0.30 },
      "night": { "room": 0.50, "gym": 0.00, "bar": 0.30 }
    },
    "Tue": {
      "morning": { "room": 0.53, "gym": 0.35, "bar": 0.12 },
      "afternoon": { "room": 0.34, "gym": 0.35, "bar": 0.31 },
      "night": { "room": 0.49, "gym": 0.00, "bar": 0.31 }
    },
    "Wed": {
      "morning": { "room": 0.52, "gym": 0.36, "bar": 0.12 },
      "afternoon": { "room": 0.34, "gym": 0.35, "bar": 0.31 },
      "night": { "room": 0.48, "gym": 0.00, "bar": 0.32 }
    },
    "Thu": {
      "morning": { "room": 0.50, "gym": 0.38, "bar": 0.12 },
      "afternoon": { "room": 0.35, "gym": 0.35, "bar": 0.30 },
      "night": { "room": 0.47, "gym": 0.00, "bar": 0.33 }
    },
    "Fri": {
      "morning": { "room": 0.48, "gym": 0.38, "bar": 0.14 },
      "afternoon": { "room": 0.32, "gym": 0.35, "bar": 0.33 },
      "night": { "room": 0.42, "gym": 0.00, "bar": 0.38 }
    },
    "Sat": {
      "morning": { "room": 0.55, "gym": 0.30, "bar": 0.15 },
      "afternoon": { "room": 0.35, "gym": 0.25, "bar": 0.40 },
      "night": { "room": 0.45, "gym": 0.00, "bar": 0.40 }
    },
    "Sun": {
      "morning": { "room": 0.60, "gym": 0.28, "bar": 0.12 },
      "afternoon": { "room": 0.40, "gym": 0.33, "bar": 0.27 },
      "night": { "room": 0.55, "gym": 0.00, "bar": 0.30 }
    }
  },
  "Procrastinator": {
    "Mon": {
      "morning": { "room": 0.45, "gym": 0.20, "bar": 0.35 },
      "afternoon": { "room": 0.30, "gym": 0.20, "bar": 0.50 },
      "night": { "room": 0.20, "gym": 0.00, "bar": 0.65 }
    },
    "Tue": {
      "morning": { "room": 0.45, "gym": 0.20, "bar": 0.35 },
      "afternoon": { "room": 0.28, "gym": 0.20, "bar": 0.52 },
      "night": { "room": 0.18, "gym": 0.00, "bar": 0.67 }
    },
    "Wed": {
      "morning": { "room": 0.44, "gym": 0.21, "bar": 0.35 },
      "afternoon": { "room": 0.27, "gym": 0.20, "bar": 0.53 },
      "night": { "room": 0.17, "gym": 0.00, "bar": 0.68 }
    },
    "Thu": {
      "morning": { "room": 0.43, "gym": 0.21, "bar": 0.36 },
      "afternoon": { "room": 0.25, "gym": 0.20, "bar": 0.55 },
      "night": { "room": 0.15, "gym": 0.00, "bar": 0.70 }
    },
    "Fri": {
      "morning": { "room": 0.42, "gym": 0.21, "bar": 0.37 },
      "afternoon": { "room": 0.22, "gym": 0.18, "bar": 0.60 },
      "night": { "room": 0.12, "gym": 0.00, "bar": 0.73 }
    },
    "Sat": {
      "morning": { "room": 0.45, "gym": 0.18, "bar": 0.37 },
      "afternoon": { "room": 0.20, "gym": 0.15, "bar": 0.65 },
      "night": { "room": 0.10, "gym": 0.00, "bar": 0.75 }
    },
    "Sun": {
      "morning": { "room": 0.55, "gym": 0.20, "bar": 0.25 },
      "afternoon": { "room": 0.35, "gym": 0.20, "bar": 0.45 },
      "night": { "room": 0.25, "gym": 0.00, "bar": 0.60 }
    }
  },
  "Overachiever": {
    "Mon": {
      "morning": { "room": 0.50, "gym": 0.40, "bar": 0.10 },
      "afternoon": { "room": 0.45, "gym": 0.40, "bar": 0.15 },
      "night": { "room": 0.40, "gym": 0.00, "bar": 0.35 }
    },
    "Tue": {
      "morning": { "room": 0.48, "gym": 0.42, "bar": 0.10 },
      "afternoon": { "room": 0.45, "gym": 0.40, "bar": 0.15 },
      "night": { "room": 0.38, "gym": 0.00, "bar": 0.37 }
    },
    "Wed": {
      "morning": { "room": 0.48, "gym": 0.42, "bar": 0.10 },
      "afternoon": { "room": 0.45, "gym": 0.40, "bar": 0.15 },
      "night": { "room": 0.38, "gym": 0.00, "bar": 0.37 }
    },
    "Thu": {
      "morning": { "room": 0.47, "gym": 0.43, "bar": 0.10 },
      "afternoon": { "room": 0.45, "gym": 0.40, "bar": 0.15 },
      "night": { "room": 0.37, "gym": 0.00, "bar": 0.38 }
    },
    "Fri": {
      "morning": { "room": 0.47, "gym": 0.40, "bar": 0.13 },
      "afternoon": { "room": 0.43, "gym": 0.37, "bar": 0.20 },
      "night": { "room": 0.35, "gym": 0.00, "bar": 0.40 }
    },
    "Sat": {
      "morning": { "room": 0.50, "gym": 0.38, "bar": 0.12 },
      "afternoon": { "room": 0.43, "gym": 0.33, "bar": 0.24 },
      "night": { "room": 0.40, "gym": 0.00, "bar": 0.35 }
    },
    "Sun": {
      "morning": { "room": 0.55, "gym": 0.35, "bar": 0.10 },
      "afternoon": { "room": 0.50, "gym": 0.35, "bar": 0.15 },
      "night": { "room": 0.45, "gym": 0.00, "bar": 0.35 }
    }
  }
};
