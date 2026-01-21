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

  generateName(rng: () => number = Math.random) {
    const names = [
      "Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Heidi",
      "Ivan", "Judy", "Mallory", "Niaj", "Olivia", "Peggy", "Rupert", "Sybil",
      "Trent", "Victor", "Walter", "Zara", "Arthur", "Beatrix", "Colin", "Daisy"
    ];
    return names[Math.floor(rng() * names.length)];
  }

  name: string = "Agent";
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type AgentProps = {
  [key in AgentType]: {
    [key in "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"]: {
      [key in "morning" | "afternoon" | "night"]: {
        room: number;
        gym: number;
        bar: number;
        outside: number;
      };
    };
  };
};

export const AGENT_PROPS: AgentProps = {
  "Bookworm": {
    "Mon": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.3, "bar": 0.3, "outside": 0.5 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Tue": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.3, "bar": 0.3, "outside": 0.5 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Wed": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.3, "bar": 0.3, "outside": 0.5 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Thu": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.3, "bar": 0.3, "outside": 0.5 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Fri": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.3, "bar": 0.3, "outside": 0.5 },
      "night": { "room": 0.6, "gym": 0, "bar": 0.4, "outside": 0 }
    },
    "Sat": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.1, "bar": 0.1, "outside": 0.3 },
      "night": { "room": 0.6, "gym": 0, "bar": 0.4, "outside": 0 }
    },
    "Sun": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.5, "gym": 0.1, "bar": 0.1, "outside": 0.3 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    }
  },
  "PartyAnimal": {
    "Mon": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4, "outside": 0 }
    },
    "Tue": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4, "outside": 0 }
    },
    "Wed": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4, "outside": 0 }
    },
    "Thu": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4, "outside": 0 }
    },
    "Fri": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.2, "gym": 0.1, "bar": 0.7, "outside": 0 }
    },
    "Sat": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.2, "gym": 0.1, "bar": 0.7, "outside": 0 }
    },
    "Sun": {
      "morning": { "room": 1, "gym": 0, "bar": 0, "outside": 0 },
      "afternoon": { "room": 0.7, "gym": 0.1, "bar": 0.2, "outside": 0 },
      "night": { "room": 0.5, "gym": 0.1, "bar": 0.4, "outside": 0 }
    }
  },
  "GymRat": {
    "Mon": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Tue": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Wed": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Thu": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Fri": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 0.9, "gym": 0.005, "bar": 0.05, "outside": 0 }
    },
    "Sat": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 0.9, "gym": 0.05, "bar": 0.05, "outside": 0 }
    },
    "Sun": {
      "morning": { "room": 0.7, "gym": 0.3, "bar": 0, "outside": 0.3 },
      "afternoon": { "room": 0.5, "gym": 0.5, "bar": 0, "outside": 0.3 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    }
  },
  "Balanced": {
    "Mon": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Tue": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Wed": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Thu": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    },
    "Fri": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 0.5, "gym": 0.25, "bar": 0.25, "outside": 0 }
    },
    "Sat": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 0.5, "gym": 0.25, "bar": 0.25, "outside": 0 }
    },
    "Sun": {
      "morning": { "room": 0.8, "gym": 0.2, "bar": 0, "outside": 0.2 },
      "afternoon": { "room": 0.25, "gym": 0.2, "bar": 0.2, "outside": 0.25 },
      "night": { "room": 1, "gym": 0, "bar": 0, "outside": 0 }
    }
  },
};
