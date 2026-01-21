import type { AgentState, Vec2 } from "./Types";
import { Entity } from "./Entity";

// Enhanced Agent Types
export const AGENT_TYPES = [
  "Bookworm",    // Loves Room/Study (Quiet)
  "PartyAnimal", // Loves Bar, Nightlife
  "GymRat",      // Loves Gym
  "Balanced",    // A bit of everything
  "Workaholic",  // Loves Work, rarely fun
  "NatureLover"  // Loves Outside
] as const;

export type AgentType = typeof AGENT_TYPES[number];

export class Agent extends Entity {
  pos: Vec2;
  dest: Vec2 | null = null;
  speed = 2; // tiles/sec
  facing = { x: 1, y: 0 };
  roomId?: string;
  state: AgentState = "Breakfast";
  offMap?: { untilMinute: number; reason: "Study" | "Work" | "Shop" | "Evac" };
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
  visionRadius = 15;

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
    // Weighted distribution if desired, or flat random for now
    const i = Math.floor(rng() * AGENT_TYPES.length);
    this.agentType = AGENT_TYPES[i];
  }

  generateName(rng: () => number = Math.random) {
    const names = [
      // International mix
      "Aarav", "Akira", "Alessandro", "Amara", "Ana", "Andrei", "Ananya", "Arthur",
      "Beatrix", "Bilal", "Bo", "Carlos", "Chen", "Chiara", "Chloe", "Dmitri",
      "Diego", "Elena", "Elif", "Emma", "Fatima", "Felix", "Finn", "Gabriela",
      "Hana", "Hans", "Haruto", "Hugo", "Ibrahim", "Ingrid", "Isabella", "Ivan",
      "Jabari", "Jack", "Javier", "Ji-Min", "Jin", "Julia", "Kai", "Katarina",
      "Keiko", "Kwame", "Lars", "Leila", "Liam", "Luca", "Luis", "Mai",
      "Malik", "Maria", "Mateo", "Mei", "Mia", "Miguel", "Mohammed", "Nadia",
      "Nanami", "Nikolai", "Noah", "Olivia", "Omar", "Pablo", "Priya", "Rahul",
      "Ravi", "Rosa", "Sakura", "Samuel", "Sara", "Sato", "Sofia", "Sven",
      "Tariq", "Thomas", "Wei", "Xiu", "Yara", "Yuki", "Zara", "Zoe"
    ];
    return names[Math.floor(rng() * names.length)];
  }

  name: string = "Agent";
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type TimeSlot = "morning" | "afternoon" | "evening" | "lateNight";

export type AgentProps = {
  [key in AgentType]: {
    [key in "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"]: {
      [key in TimeSlot]: {
        room: number;
        gym: number;
        bar: number;
        outside: number;
      };
    };
  };
};

const BASE_SCHEDULE = {
  room: 1, gym: 0, bar: 0, outside: 0
};

// Detailed Per-Day Config
export const AGENT_PROPS: AgentProps = {
  "Bookworm": {
    "Mon": {
      "morning": { room: 8, gym: 1, bar: 0, outside: 1 },
      "afternoon": { room: 7, gym: 1, bar: 0, outside: 2 },
      "evening": { room: 9, gym: 0, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    // ... Copy for Tue-Thu (condensed for brevity in prompt but I should write them out if user wants explicit)
    // Actually, I'll write Mon-Fri and Sat-Sun distinct blocks.
    "Tue": {
      "morning": { room: 8, gym: 1, bar: 0, outside: 1 },
      "afternoon": { room: 7, gym: 1, bar: 0, outside: 2 },
      "evening": { room: 9, gym: 0, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Wed": {
      "morning": { room: 8, gym: 1, bar: 0, outside: 1 },
      "afternoon": { room: 7, gym: 1, bar: 0, outside: 2 },
      "evening": { room: 9, gym: 0, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Thu": {
      "morning": { room: 8, gym: 1, bar: 0, outside: 1 },
      "afternoon": { room: 7, gym: 1, bar: 0, outside: 2 },
      "evening": { room: 9, gym: 0, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Fri": {
      "morning": { room: 8, gym: 1, bar: 0, outside: 1 },
      "afternoon": { room: 6, gym: 1, bar: 0, outside: 3 },
      "evening": { room: 7, gym: 0, bar: 1, outside: 2 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    },
    "Sat": {
      "morning": { room: 5, gym: 0, bar: 0, outside: 5 },
      "afternoon": { room: 4, gym: 0, bar: 0, outside: 6 },
      "evening": { room: 7, gym: 0, bar: 1, outside: 2 },
      "lateNight": { room: 9, gym: 0, bar: 1, outside: 0 },
    },
    "Sun": {
      "morning": { room: 6, gym: 0, bar: 0, outside: 4 },
      "afternoon": { room: 6, gym: 0, bar: 0, outside: 4 },
      "evening": { room: 9, gym: 0, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    }
  },
  "PartyAnimal": {
    "Mon": {
      "morning": { room: 5, gym: 1, bar: 0, outside: 4 },
      "afternoon": { room: 3, gym: 2, bar: 1, outside: 4 },
      "evening": { room: 2, gym: 1, bar: 4, outside: 3 },
      "lateNight": { room: 6, gym: 0, bar: 2, outside: 2 },
    },
    "Tue": {
      "morning": { room: 5, gym: 1, bar: 0, outside: 4 },
      "afternoon": { room: 3, gym: 2, bar: 1, outside: 4 },
      "evening": { room: 2, gym: 1, bar: 4, outside: 3 },
      "lateNight": { room: 6, gym: 0, bar: 2, outside: 2 },
    },
    "Wed": {
      "morning": { room: 5, gym: 1, bar: 0, outside: 4 },
      "afternoon": { room: 3, gym: 2, bar: 1, outside: 4 },
      "evening": { room: 2, gym: 1, bar: 5, outside: 2 },
      "lateNight": { room: 6, gym: 0, bar: 2, outside: 2 },
    },
    "Thu": {
      "morning": { room: 5, gym: 1, bar: 0, outside: 4 },
      "afternoon": { room: 3, gym: 2, bar: 1, outside: 4 },
      "evening": { room: 1, gym: 0, bar: 6, outside: 3 },
      "lateNight": { room: 5, gym: 0, bar: 4, outside: 1 },
    },
    "Fri": {
      "morning": { room: 3, gym: 0, bar: 0, outside: 7 },
      "afternoon": { room: 1, gym: 1, bar: 3, outside: 5 },
      "evening": { room: 0, gym: 0, bar: 10, outside: 0 },
      "lateNight": { room: 0, gym: 0, bar: 10, outside: 0 },
    },
    "Sat": {
      "morning": { room: 9, gym: 0, bar: 0, outside: 1 }, // Hangover
      "afternoon": { room: 2, gym: 1, bar: 2, outside: 5 },
      "evening": { room: 0, gym: 0, bar: 10, outside: 0 },
      "lateNight": { room: 0, gym: 0, bar: 10, outside: 0 },
    },
    "Sun": {
      "morning": { room: 9, gym: 0, bar: 0, outside: 1 },
      "afternoon": { room: 4, gym: 0, bar: 1, outside: 5 },
      "evening": { room: 5, gym: 0, bar: 2, outside: 3 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    }
  },
  "GymRat": {
    "Mon": {
      "morning": { room: 2, gym: 7, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 6, bar: 0, outside: 1 },
      "evening": { room: 5, gym: 4, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Tue": {
      "morning": { room: 2, gym: 7, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 6, bar: 0, outside: 1 },
      "evening": { room: 5, gym: 4, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Wed": {
      "morning": { room: 2, gym: 7, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 6, bar: 0, outside: 1 },
      "evening": { room: 5, gym: 4, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Thu": {
      "morning": { room: 2, gym: 7, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 6, bar: 0, outside: 1 },
      "evening": { room: 5, gym: 4, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Fri": {
      "morning": { room: 2, gym: 7, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 6, bar: 0, outside: 1 },
      "evening": { room: 4, gym: 4, bar: 1, outside: 1 },
      "lateNight": { room: 9, gym: 0, bar: 1, outside: 0 },
    },
    "Sat": {
      "morning": { room: 4, gym: 5, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 5, bar: 0, outside: 2 },
      "evening": { room: 5, gym: 3, bar: 1, outside: 1 },
      "lateNight": { room: 9, gym: 0, bar: 1, outside: 0 },
    },
    "Sun": {
      "morning": { room: 4, gym: 5, bar: 0, outside: 1 },
      "afternoon": { room: 3, gym: 5, bar: 0, outside: 2 },
      "evening": { room: 8, gym: 2, bar: 0, outside: 0 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    }
  },
  "Balanced": {
    "Mon": {
      "morning": { room: 6, gym: 1, bar: 0, outside: 3 },
      "afternoon": { room: 5, gym: 2, bar: 0, outside: 3 },
      "evening": { room: 6, gym: 1, bar: 1, outside: 2 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Tue": {
      "morning": { room: 6, gym: 1, bar: 0, outside: 3 },
      "afternoon": { room: 5, gym: 2, bar: 0, outside: 3 },
      "evening": { room: 6, gym: 1, bar: 1, outside: 2 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Wed": {
      "morning": { room: 6, gym: 1, bar: 0, outside: 3 },
      "afternoon": { room: 5, gym: 2, bar: 0, outside: 3 },
      "evening": { room: 6, gym: 1, bar: 1, outside: 2 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Thu": {
      "morning": { room: 6, gym: 1, bar: 0, outside: 3 },
      "afternoon": { room: 5, gym: 2, bar: 0, outside: 3 },
      "evening": { room: 5, gym: 1, bar: 2, outside: 2 },
      "lateNight": { room: 9, gym: 0, bar: 1, outside: 0 },
    },
    "Fri": {
      "morning": { room: 6, gym: 1, bar: 0, outside: 3 },
      "afternoon": { room: 4, gym: 1, bar: 1, outside: 4 },
      "evening": { room: 2, gym: 0, bar: 6, outside: 2 },
      "lateNight": { room: 5, gym: 0, bar: 4, outside: 1 },
    },
    "Sat": {
      "morning": { room: 7, gym: 0, bar: 0, outside: 3 },
      "afternoon": { room: 4, gym: 1, bar: 0, outside: 5 },
      "evening": { room: 3, gym: 0, bar: 5, outside: 2 },
      "lateNight": { room: 6, gym: 0, bar: 4, outside: 0 },
    },
    "Sun": {
      "morning": { room: 7, gym: 0, bar: 0, outside: 3 },
      "afternoon": { room: 5, gym: 1, bar: 0, outside: 4 },
      "evening": { room: 7, gym: 0, bar: 1, outside: 2 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    }
  },
  "Workaholic": {
    "Mon": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 }, // Go to work!
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 }, // Still working
      "evening": { room: 8, gym: 1, bar: 0, outside: 1 }, // Home/Relax
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Tue": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 },
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 },
      "evening": { room: 8, gym: 1, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Wed": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 },
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 },
      "evening": { room: 8, gym: 1, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Thu": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 },
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 },
      "evening": { room: 8, gym: 1, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Fri": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 },
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 },
      "evening": { room: 5, gym: 1, bar: 3, outside: 1 }, // Forced fun
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    },
    "Sat": {
      "morning": { room: 5, gym: 1, bar: 0, outside: 4 }, // Catch up on work/errands
      "afternoon": { room: 5, gym: 1, bar: 0, outside: 4 },
      "evening": { room: 8, gym: 1, bar: 1, outside: 0 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    },
    "Sun": {
      "morning": { room: 5, gym: 1, bar: 0, outside: 4 },
      "afternoon": { room: 7, gym: 2, bar: 0, outside: 1 },
      "evening": { room: 9, gym: 0, bar: 0, outside: 1 },
      "lateNight": { room: 10, gym: 0, bar: 0, outside: 0 },
    }
  },
  "NatureLover": {
    "Mon": {
      "morning": { room: 2, gym: 0, bar: 0, outside: 8 },
      "afternoon": { room: 2, gym: 0, bar: 0, outside: 8 },
      "evening": { room: 5, gym: 0, bar: 0, outside: 5 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    },
    "Tue": {
      "morning": { room: 2, gym: 0, bar: 0, outside: 8 },
      "afternoon": { room: 2, gym: 0, bar: 0, outside: 8 },
      "evening": { room: 5, gym: 0, bar: 0, outside: 5 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    },
    "Wed": {
      "morning": { room: 2, gym: 0, bar: 0, outside: 8 },
      "afternoon": { room: 2, gym: 0, bar: 0, outside: 8 },
      "evening": { room: 5, gym: 0, bar: 0, outside: 5 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    },
    "Thu": {
      "morning": { room: 2, gym: 0, bar: 0, outside: 8 },
      "afternoon": { room: 2, gym: 0, bar: 0, outside: 8 },
      "evening": { room: 5, gym: 0, bar: 0, outside: 5 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    },
    "Fri": {
      "morning": { room: 2, gym: 0, bar: 0, outside: 8 },
      "afternoon": { room: 2, gym: 0, bar: 0, outside: 8 },
      "evening": { room: 4, gym: 0, bar: 2, outside: 4 },
      "lateNight": { room: 8, gym: 0, bar: 1, outside: 1 },
    },
    "Sat": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 },
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 },
      "evening": { room: 3, gym: 0, bar: 2, outside: 5 },
      "lateNight": { room: 8, gym: 0, bar: 1, outside: 1 },
    },
    "Sun": {
      "morning": { room: 1, gym: 0, bar: 0, outside: 9 },
      "afternoon": { room: 1, gym: 0, bar: 0, outside: 9 },
      "evening": { room: 4, gym: 0, bar: 0, outside: 6 },
      "lateNight": { room: 9, gym: 0, bar: 0, outside: 1 },
    }
  },
};
