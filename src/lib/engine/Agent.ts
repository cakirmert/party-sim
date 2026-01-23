import type { AgentState, Vec2 } from "./Types";
import { Entity } from "./Entity";

// Enhanced Agent Types
export const AGENT_TYPES = [
  "Bookworm",    // Loves Room/Study (Quiet)
  "PartyAnimal", // Loves Bar, Nightlife
  "GymRat",      // Loves Gym
  "WorkingStudent", // Works 9-5
  "Balanced",    // A bit of everything
] as const;

export type AgentType = typeof AGENT_TYPES[number];

export class Agent extends Entity {
  pos: Vec2;
  dest: Vec2 | null = null;
  speed = 5; // tiles/sec (Faster base movement)
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
  visionRadius = 25;

  // Fidelity Metrics
  stepsTaken = 0;
  pathStartPos: Vec2 | null = null;
  avoidanceCount = 0;
  pathIntegrity = 100;
  movedThisTick = false;


  constructor(pos: Vec2) {
    super();
    this.pos = { ...pos };
    this.recentTiles.push({ ...this.pos });
  }

  setFacing(dx: number, dy: number) {
    const mag = Math.hypot(dx, dy);
    if (mag > 0) this.facing = { x: dx / mag, y: dy / mag };
  }

  isSmoker = false;

  resetRandomType(rng: () => number = Math.random) {
    // Weighted distribution: 25% Bookworm, 25% PartyAnimal, 25% GymRat, 20% WorkingStudent, 5% Balanced
    const r = rng();
    if (r < 0.25) this.agentType = "Bookworm";
    else if (r < 0.50) this.agentType = "PartyAnimal";
    else if (r < 0.75) this.agentType = "GymRat";
    else if (r < 0.95) this.agentType = "WorkingStudent";
    else this.agentType = "Balanced";

    // Smoker trait: 20%
    this.isSmoker = rng() < 0.2;
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

  shouldDespawn(tileVal: { tag?: string }, isEmergency: boolean): boolean {
    if (isEmergency) {
      return tileVal.tag === "EXIT" || tileVal.tag === "OUTSIDE";
    }
    if (tileVal.tag === "EXIT") {
      return this.state === "GoingToWork" || this.state === "GoingToExit";
    }
    return false;
  }

  name: string = "Agent";
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type TimeSlot = "morning" | "afternoon" | "evening" | "lateNight";


export type HourlyWeights = {
  room: number;   // Sleep/relax in room
  gym: number;    // Workout
  bar: number;    // Drink/Socialize
  outside: number; // Wander outside
  leaveMap: number; // Go off-map (Work/Study)
};

export type AgentProfiles = {
  [key in AgentType]: HourlyWeights[]; // Array of 24 hourly weights (0..23)
};

// Helper to create a 24h profile setup
const makeProfile = (base: HourlyWeights, ...overrides: [number, Partial<HourlyWeights>][]): HourlyWeights[] => {
  const p: HourlyWeights[] = Array(24).fill(null).map(() => ({ ...base }));
  for (const [hour, w] of overrides) {
    p[hour] = { ...p[hour], ...w };
  }
  return p;
};

// Default Profiles (Simplifying for brevity, but covering core behaviors)
// We will define a standard "Day" and apply it.
// Hours: 0-23.
// 0-6: Sleep heavy.
// 7-8: Wake/Breakfast.
// 9-17: Day activity.
// 18-23: Evening activity.

const SLEEP: HourlyWeights = { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 };
// const WORK: HourlyWeights = { room: 5, gym: 0, bar: 0, outside: 95, leaveMap: 0 }; // OLD Check
const WORK: HourlyWeights = { room: 0, gym: 0, bar: 0, outside: 0, leaveMap: 100 }; // NEW: Leave map

export const HOURLY_PROFILES: AgentProfiles = {
  "Bookworm": Array(24).fill(null).map((_, h) => {
    if (h < 7) return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 }; // Sleep 0-6
    if (h < 9) return { room: 80, gym: 0, bar: 0, outside: 20, leaveMap: 0 }; // Wake
    if (h < 17) return { room: 90, gym: 5, bar: 0, outside: 5, leaveMap: 10 }; // Study/Work (mostly room, occasional exit)
    if (h < 22) return { room: 80, gym: 0, bar: 10, outside: 10, leaveMap: 0 }; // Evening read
    return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 }; // Sleep 22+
  }),
  "PartyAnimal": Array(24).fill(null).map((_, h) => {
    if (h >= 4 && h < 12) return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 }; // 04:00 to 12:00 -> Sleep
    if (h >= 20 || h < 4) return { room: 5, gym: 10, bar: 100, outside: 10, leaveMap: 5 }; // 20:00 to 04:00 (h >= 20 OR h < 4) -> Bar
    return { room: 30, gym: 20, bar: 20, outside: 30, leaveMap: 0 }; // 12:00 to 20:00 -> Chill/Prepare
  }),
  "GymRat": Array(24).fill(null).map((_, h) => {
    if (h < 6) return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 }; // Sleep
    if (h < 8) return { room: 10, gym: 80, bar: 0, outside: 10, leaveMap: 0 }; // Morning run/gym
    if (h < 17) return { room: 40, gym: 40, bar: 0, outside: 20, leaveMap: 5 }; // Active day
    if (h < 22) return { room: 30, gym: 60, bar: 10, outside: 0, leaveMap: 0 }; // Evening pump
    return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 }; // Sleep
  }),
  "Balanced": Array(24).fill(null).map((_, h) => {
    if (h < 7) return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 };
    if (h < 18) return { room: 30, gym: 20, bar: 10, outside: 40, leaveMap: 5 }; // Mix
    if (h < 23) return { room: 40, gym: 10, bar: 40, outside: 10, leaveMap: 0 }; // Social evening
    return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 };
  }),
  "WorkingStudent": Array(24).fill(null).map((_, h) => {
    if (h < 7) return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 };
    if (h < 8) return { room: 50, gym: 0, bar: 0, outside: 50, leaveMap: 0 }; // Rush morning
    if (h >= 9 && h < 17) return { room: 0, gym: 0, bar: 0, outside: 0, leaveMap: 100 }; // WORK (Strict)
    if (h < 23) return { room: 40, gym: 10, bar: 40, outside: 10, leaveMap: 0 }; // Relax
    return { room: 100, gym: 0, bar: 0, outside: 0, leaveMap: 0 };
  }),
};


