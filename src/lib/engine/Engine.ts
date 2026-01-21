import { GridMap } from "./GridMap";
import { ScoringMetrics } from "../scoring";
import { Agent, AGENT_PROPS, DAY_NAMES } from "./Agent";
import type { EngineConfig, Vec2, BaseSpec, Tile, TileTag, AgentState, WanderTarget, PathMetric, BoundingBox } from "./Types";
import { RNG } from "./RNG";
import type { Command } from "./Commands";
import { EventBus } from "./Events";
import { Clock } from "./Clock";
import { TimeOfDay } from "./TimeOfDay";

const BREAKFAST_MINUTES = 30;
const POI_DWELL_MIN = 10;
const POI_DWELL_MAX = 100;
const RECENT_TILE_HISTORY = 6;
const STUCK_SEARCH_TICKS = 2;
const LOCAL_SEARCH_RADIUS = 0; // 0 => unlimited
const LOCAL_SEARCH_MAX_NODES = 12000;
const NAV_SEARCH_MAX_NODES = 20000;
const RECENT_TILE_PENALTY = 0.35;
const MOVE_DIRS: Vec2[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 },
  { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 },
  { x: -1, y: 1 }, { x: -1, y: -1 },
];

/** Off-map tracking entry (for UI "Out List"). */
export interface OutRecord {
  id: string;
  name?: string;
  reason: "Study" | "Work" | "Shop";
  untilMinute: number;
  exitPos: Vec2;
  roomId?: string;
  exitTime?: number;
}

export type timeOfDay = "morning" | "afternoon" | "night";

export class Engine {
  readonly cfg: EngineConfig;
  map: GridMap;
  readonly events = new EventBus();
  readonly clock: Clock;
  private rng: RNG;
  readonly tod: TimeOfDay;

  private agents: Map<string, Agent> = new Map();
  private outList: OutRecord[] = [];
  private tickCount = 0;
  private weeksElapsed = 0;

  /** Minutes advanced per fixed logic tick at 1× speed. Adjust for your pacing. */
  private minutesPerTick = 0.5;

  /** Room spawn positions from the latest generation (one per agent). */
  private roomSpawns: Vec2[] = [];
  private poiCapacity: Record<"BAR" | "GYM", number> = { BAR: 30, GYM: 15 };
  private poiOccupancy: Record<"BAR" | "GYM", number> = { BAR: 0, GYM: 0 };
  private poiCenters = new Map<TileTag, Vec2>();
  density?: Uint16Array;
  private densityTimer = 0;
  private densityRecomputesThisSecond = 0;
  // private perfTimer = 0; // Keeping this for density timer sync? No, density uses its own. Remove if unused.
  // Actually densityTimer uses dtSec which IS simulation time. Correct.
  // We need new wall clock timers.
  private wallPerfTimer = 0;
  private wallTicksAccumulator = 0;
  private lastWallSec = 0;

  private ticksThisSecond = 0;
  private lastTicksPerSecond = 0;
  private lastDensityRecomputes = 0;
  private corridorTiles: Vec2[] = [];
  public pathsMetrics: Array<PathMetric> = []
  private maxPathsMetricsLength = 500;
  public corridorBoundingBoxes?: BoundingBox[];
  public gymBoundingBox?: BoundingBox;
  public barBoundingBox?: BoundingBox;
  public corridorDensityValues: Array<number> = []
  public maxBarOccupancy: Array<number> = [0, 0, 0, 0, 0, 0, 0]; // per day of week
  public maxGymOccupancy: Array<number> = [0, 0, 0, 0, 0, 0, 0]; // per day of week

  resetMetrics() {
    this.pathsMetrics = [];
    this.maxBarOccupancy = [0, 0, 0, 0, 0, 0, 0];
    this.maxGymOccupancy = [0, 0, 0, 0, 0, 0, 0];
    this.corridorDensityValues = [];
  }

  private setCorridorBoundingBoxes(baseSpec?: BaseSpec) {
    this.corridorBoundingBoxes = baseSpec?.corridorRects?.map((rect) => {
      return {
        x0: rect.x,
        y0: rect.y,
        x1: rect.x + rect.w,
        y1: rect.y + rect.h,
        tiles: rect.w * rect.h,
      };
    });
  }

  constructor(cfg: EngineConfig, baseSpec?: BaseSpec) {
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.clock = new Clock(cfg.baseTickRate);
    this.tod = new TimeOfDay(360); // 06:00

    this.setCorridorBoundingBoxes(baseSpec);

    // Start with a simple BUILDABLE floor if no spec yet; caller can reset later.
    this.map = baseSpec
      ? GridMap.buildFromSpec(cfg.grid, baseSpec)
      : new GridMap(cfg.grid, { walkable: true, moveCost: 1, tag: "BUILDABLE" });
  }

  private keyOf(pos: Vec2): string {
    return `${pos.x}:${pos.y}`;
  }

  // ——— Public getters ———
  getTick() { return this.tickCount; }
  getAgents(): Agent[] { return [...this.agents.values()]; }
  /** Iterate agents without allocating an array (for batch runs). */
  forEachAgent(cb: (a: Agent) => void): void {
    for (const a of this.agents.values()) cb(a);
  }
  /** Get agent count without allocating (for batch runs). */
  getAgentCount(): number { return this.agents.size; }
  /** Reseed the RNG (for reusing Engine across runs). */
  setSeed(seed: string): void {
    this.rng = new RNG(seed);
  }
  getOutList(): OutRecord[] { return [...this.outList]; }
  getPerfStats() {
    return {
      ticksPerSecond: this.lastTicksPerSecond,
      densityRecomputesPerSecond: this.lastDensityRecomputes,
    };
  }
  getRoomCapacity() { return this.roomSpawns.length; }
  setSpeed(mult: number) { this.clock.setSpeed(mult); }
  setPaused(p: boolean) { this.clock.setPaused(p); }
  stepOnce() {
    const steps = this.clock.stepOnce();
    for (let i = 0; i < steps; i++) {
      this.fixedStep(1 / this.cfg.baseTickRate);
      this.tickCount++;
      if (!this.cfg.headless || this.cfg.emitEvents) {
        this.events.emit({ type: "TICK", tick: this.tickCount });
      }
    }
    return steps;
  }

  // ——— Core API ———

  get paused() { return this.clock.isPaused; }

  /**
   * Return current metrics snapshot for live scoring.
   * Approximates metrics that are usually calculated at end of run.
   */
  getLiveMetrics(): ScoringMetrics {
    const agents = this.getAgents();
    if (agents.length === 0) {
      return {
        roomCapacity: this.getRoomCapacity(),
        actualAgents: 0,
        corridorP95: 0,
        avgPathLength: 0,
        stuckRate: 0,
        barOccupancyRatio: 0,
        gymOccupancyRatio: 0,
        evacuationRate: 0,
        avgExitTime: 0,
      };
    }

    // Agent count
    const actualAgents = agents.length;
    const roomCapacity = this.getRoomCapacity();

    // Corridor Density (P95 of collected values so far)
    let corridorP95 = 0;
    if (this.corridorDensityValues.length > 0) {
      // Basic approximation if array is large, or just take mean?
      // Sorting huge array every frame is bad. 
      // We only call this throttled.
      const sorted = [...this.corridorDensityValues].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * 0.95);
      corridorP95 = sorted[idx];
    }

    // Path Length (Avg of completed paths)
    let avgPathLength = 0;
    if (this.pathsMetrics.length > 0) {
      avgPathLength = this.pathsMetrics.reduce((s, p) => s + p.length, 0) / this.pathsMetrics.length;
    }

    // Stuck Rate (Current agents with stuck/waiting status / total)
    // We approximate 'stuck' as agents waiting > 20 ticks (10s at 2 ticks/s? No, ticks are 0.5m?)
    // Using stuckTicks from Agent.
    const stuckCount = agents.filter(a => a.stuckTicks > 10).length;
    const stuckRate = stuckCount / actualAgents;

    // Occupancy (Max so far? Or Current?)
    // Live score should probably reflect *current* performance or *cumulative* performance?
    // "Live score" implies "how is it going".
    // Let's use the max recorded so far to match the 'peak' nature of occupancy scoring.
    const maxBar = Math.max(...this.maxBarOccupancy, this.poiOccupancy.BAR);
    const maxGym = Math.max(...this.maxGymOccupancy, this.poiOccupancy.GYM);

    // We need map tiles for ratio
    // barBoundingBox might be undefined if not set? (It is set in resetWorld)
    const barTiles = this.barBoundingBox?.tiles || 1;
    const gymTiles = this.gymBoundingBox?.tiles || 1;

    const barOccupancyRatio = maxBar / barTiles;
    const gymOccupancyRatio = maxGym / gymTiles;

    // Evacuation (only relevant if evac mode active?)
    // We can return 0 if not finished.
    // Or if in evac mode, return current progress.
    const evacs = this.outList.length;
    const evacuationRate = this.outList.length / (this.outList.length + agents.length || 1);

    // Avg Exit Time
    let avgExitTime = 0;
    if (this.outList.length > 0) {
      avgExitTime = this.outList.reduce((s, a) => s + (a.exitTime || 0), 0) / this.outList.length;
    }

    return {
      roomCapacity,
      actualAgents,
      corridorP95,
      avgPathLength,
      stuckRate,
      barOccupancyRatio,
      gymOccupancyRatio,
      evacuationRate,
      avgExitTime
    };
  }

  /**
   * Reset world to a generated dorm for `count` agents.
   * - Rebuilds from `baseSpec` (unless reuseMap is true)
   * - Generates dorm (rooms+corridor) as LOCKED
   * - Spawns `count` agents (one per room) at 06:00
   */
  resetWorld(baseSpec: BaseSpec, count: number, reuseMap = false) {
    if (!reuseMap || !this.map) {
      // Rebuild map from base spec
      this.map = GridMap.buildFromSpec(this.cfg.grid, baseSpec);
      this.setCorridorBoundingBoxes(baseSpec);
      this.roomSpawns = this.generateDorm(count); // This fills map with rooms

      this.barBoundingBox = {
        x0: baseSpec.barRect.x,
        y0: baseSpec.barRect.y,
        x1: baseSpec.barRect.x + baseSpec.barRect.w,
        y1: baseSpec.barRect.y + baseSpec.barRect.h,
        tiles: baseSpec.barRect.w * baseSpec.barRect.h,
      }

      this.gymBoundingBox = {
        x0: baseSpec.gymRect.x,
        y0: baseSpec.gymRect.y,
        x1: baseSpec.gymRect.x + baseSpec.gymRect.w,
        y1: baseSpec.gymRect.y + baseSpec.gymRect.h,
        tiles: baseSpec.gymRect.w * baseSpec.gymRect.h,
      }
    } else {
      // We are strictly reusing the map structure. 
      // roomSpawns should already be populated from the previous generation.
      // We assume baseSpec is compatible/same.
    }

    // Clear sim status
    this.agents.clear();
    this.outList.length = 0;
    this.tickCount = 0;
    this.weeksElapsed = 0;
    this.tod.set(360); // 06:00
    this.tod.dayOfWeek = 0;
    this.poiOccupancy.BAR = 0;
    this.poiOccupancy.GYM = 0;
    this.poiCenters.clear();
    // corridorTiles is map property? No, it's private. If we reuse map, we assume corridorTiles is preserved.
    // Wait, generateDorm populates corridorTiles. If REUSE map, we must NOT clear it.
    if (!reuseMap) {
      // generateDorm already cleared and repopulated it if we called it.
      // If reuseMap, we keep it.
    } else {
      // If reusing map, ensure we don't hold stale state if any?
      // Metrics should be reset.
    }

    this.pathsMetrics.length = 0;
    this.density = undefined;
    this.densityTimer = 0;
    this.densityRecomputesThisSecond = 0;
    this.perfTimer = 0;
    this.ticksThisSecond = 0;
    this.lastTicksPerSecond = 0;
    this.lastDensityRecomputes = 0;

    this.resetMetrics();

    const mapVersion = this.map.getVersion();
    // Spawn agents (cap to roomSpawns length)
    const n = Math.min(count, this.roomSpawns.length);
    for (let i = 0; i < n; i++) {
      const a = new Agent(this.roomSpawns[i]);
      a.roomId = `R${i}`;
      a.resetRandomType(); // set here agent
      a.name = a.generateName(this.rng.next.bind(this.rng)); // Assign persistent name
      this.setAgentState(a, "Breakfast", BREAKFAST_MINUTES);
      this.resetAgentTarget(a);
      a.recentTiles = [{ ...a.pos }];
      a.lastMapVersion = mapVersion;
      this.agents.set(a.id, a);
      if (!this.cfg.headless || this.cfg.emitEvents) {
        this.events.emit({ type: "AGENT_ADDED", id: a.id });
      }
    }
  }

  /** Dispatch command interface for UI and systems. */
  dispatch(cmd: Command) {
    switch (cmd.type) {
      case "SET_AGENT_COUNT": {
        // For resets, the UI is expected to provide the same baseSpec every time (from /maps/base.json)
        // We leave the actual spec loading to the caller; see CanvasRenderer.
        // This overload is intentionally a no-op here; use resetWorld(baseSpec, count) from UI after fetch.
        // (Kept for future headless integrations.)
        break;
      }
      case "SPAWN_AGENT": {
        const a = new Agent(cmd.pos);
        this.setAgentState(a, "Idle");
        a.lastMapVersion = this.map.getVersion();
        this.agents.set(a.id, a);
        if (!this.cfg.headless || this.cfg.emitEvents) {
          this.events.emit({ type: "AGENT_ADDED", id: a.id });
        }
        break;
      }
      case "MOVE_AGENT_TO": {
        const a = this.agents.get(cmd.id);
        if (!a) return;
        if (!this.map.inBounds(cmd.dest.x, cmd.dest.y)) return;
        const tile = this.map.get(cmd.dest.x, cmd.dest.y);
        if (!tile.walkable) return;
        if (a.pos.x === cmd.dest.x && a.pos.y === cmd.dest.y) return;
        a.dest = { ...cmd.dest };
        const dx = a.dest.x - a.pos.x, dy = a.dest.y - a.pos.y;
        a.setFacing(dx, dy);
        a.lastMapVersion = this.map.getVersion();
        this.rebuildFlowField(a);
        const targetTag = tile.tag;
        if (targetTag === "EXIT") this.setAgentState(a, "GoingToExit");
        else this.setAgentState(a, "Wander");
        a.moveProgress = 0;
        break;
      }
      case "MAP_TOGGLE_WALL": {
        const t = this.map.get(cmd.pos.x, cmd.pos.y);
        if (t.tag === "LOCKED") return; // non-editable
        this.map.set(cmd.pos.x, cmd.pos.y, { ...t, walkable: !t.walkable });
        break;
      }
      case "MAP_SET_MOVECOST": {
        const t = this.map.get(cmd.pos.x, cmd.pos.y);
        if (t.tag === "LOCKED") return; // non-editable
        this.map.set(cmd.pos.x, cmd.pos.y, { ...t, moveCost: cmd.moveCost, walkable: true });
        break;
      }
      case "MAP_LOAD_JSON": {
        // Replace map entirely (editor import)
        this.map = GridMap.fromJSON(cmd.map);
        this.poiOccupancy.BAR = 0;
        this.poiOccupancy.GYM = 0;
        this.poiCenters.clear();
        this.density = undefined;
        this.densityTimer = 0;
        this.densityRecomputesThisSecond = 0;
        this.perfTimer = 0;
        this.ticksThisSecond = 0;
        this.lastTicksPerSecond = 0;
        this.lastDensityRecomputes = 0;
        this.corridorTiles = [];
        this.pathsMetrics.length = 0;
        // Invalidate outstanding moves
        const mapVersionAfterLoad = this.map.getVersion();
        for (const a of this.agents.values()) {
          this.resetAgentTarget(a);
          a.moveProgress = 0;
          a.recentTiles = [{ ...a.pos }];
          a.lastMapVersion = mapVersionAfterLoad;
        }
        break;
      }
      case "MAP_SAVE_REQUEST": {
        // UI should call map.toJSON() directly; nothing to do here.
        break;
      }
    }
  }

  /** Drive the sim from a raf loop; call with nowSec. Returns how many fixed steps ran. */
  advance(nowSec: number): number {
    if (this.lastWallSec === 0) this.lastWallSec = nowSec;
    const wallDt = nowSec - this.lastWallSec;
    this.lastWallSec = nowSec;

    this.wallPerfTimer += wallDt;

    const steps = this.clock.advance(nowSec);
    this.wallTicksAccumulator += steps;

    if (this.wallPerfTimer >= 1.0) {
      this.lastTicksPerSecond = this.wallTicksAccumulator;
      this.wallTicksAccumulator = 0;
      this.wallPerfTimer -= 1.0;
      // Safety reset if huge lag spike
      if (this.wallPerfTimer > 1.0) this.wallPerfTimer = 0;
    }

    for (let i = 0; i < steps; i++) {
      this.fixedStep(1 / this.cfg.baseTickRate);
      this.tickCount++;
      if (!this.cfg.headless || this.cfg.emitEvents) {
        this.events.emit({ type: "TICK", tick: this.tickCount });
      }
    }
    return steps;
  }

  private setAgentState(agent: Agent, state: AgentState, timerMinutes = 0) {
    if (agent.state !== state) {
      if (agent.state === "AtBar" || agent.state === "AtGym") {
        this.onPoiLeave(agent.state);
      }
    }
    agent.state = state;
    agent.stateTimer = Math.max(0, timerMinutes);
  }

  private updateAgentTimers(agent: Agent): boolean {
    const prevState = agent.state;
    const hold = prevState === "Breakfast" || prevState === "AtBar" || prevState === "AtGym" || prevState === "InRoom";
    if (!hold) return true;

    if (agent.stateTimer > 0) {
      agent.stateTimer = Math.max(0, agent.stateTimer - this.minutesPerTick);
      if (agent.stateTimer > 0) return false;
    }

    this.setAgentState(agent, "Idle");
    this.resetAgentTarget(agent);
    agent.lastMapVersion = this.map.getVersion();
    agent.pendingWander = true;
    agent.moveProgress = 0;
    agent.stuckTicks = 0;
    return true;
  }

  private resetAgentTarget(agent: Agent) {
    agent.dest = null;
    agent.navQueue = [];
    agent.flowField = null;
    agent.flowFieldDest = null;
    agent.flowFieldVersion = -1;
    agent.stuckTicks = 0;
  }

  private getPoiCenter(tag: TileTag): Vec2 | null {
    if (this.poiCenters.has(tag)) return this.poiCenters.get(tag)!;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const t = this.map.get(x, y);
        if (t.tag === tag) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    if (!count) return null;
    const center = { x: sumX / count, y: sumY / count };
    this.poiCenters.set(tag, center);
    return center;
  }

  private getTimeOfDay(): timeOfDay {
    const hour = Math.floor(this.tod.minute / 60) % 24;
    if (hour >= 6 && hour < 12) return "morning";
    if (hour >= 12 && hour < 18) return "afternoon";
    return "night";
  }

  private isMax(currentValue: number, otherValues: number[]) {
    for (const v of otherValues) {
      if (v > currentValue) return false;
    }
    return true;
  }

  private pickWanderTarget(agent: Agent): WanderTarget | null {
    const agentProps = AGENT_PROPS[agent.agentType];
    const timeOfDay = this.getTimeOfDay();
    const dayOfWeek = DAY_NAMES[this.tod.dayOfWeek];
    const currentProps = agentProps[dayOfWeek][timeOfDay];
    const gymCoeff = currentProps.gym * (this.rng.int(5, 8));
    const barCoeff = currentProps.bar * (this.rng.int(5, 8));
    const roomCoeff = currentProps.room * (this.rng.int(5, 8));
    const outsideCoeff = currentProps.outside * (this.rng.int(5, 8));

    const min = this.tod.minute % 1440;
    // Sleep Override: 00:00 - 06:00 -> Force ROOM
    const isSleepTime = min < 360;

    // Determine base desire
    const center = isSleepTime ? "ROOM" :
      this.isMax(gymCoeff, [barCoeff, outsideCoeff, roomCoeff]) ? "GYM"
        : this.isMax(barCoeff, [gymCoeff, outsideCoeff, roomCoeff]) ? "BAR"
          : this.isMax(outsideCoeff, [gymCoeff, barCoeff, roomCoeff]) ? "OUTSIDE"
            : "ROOM";

    const agentRoom = parseInt(agent.roomId?.split("R")[1] || "0", 10);
    const isRoom = center === "ROOM";
    const poiCenter = isRoom ? this.roomSpawns[agentRoom] : this.getPoiCenter(center);

    if (isRoom && poiCenter) {
      return { point: { x: poiCenter.x, y: poiCenter.y }, room: center };
    }

    if (poiCenter) {
      const cx = isRoom ? poiCenter.x : Math.round(poiCenter.x);
      const cy = isRoom ? poiCenter.y : Math.round(poiCenter.y);
      for (let i = 0; i < 6; i++) {
        const tx = cx + this.rng.int(-4, 4);
        const ty = cy + this.rng.int(-4, 4);
        if (!this.map.inBounds(tx, ty)) continue;
        const tile = this.map.get(tx, ty);
        if (tile.walkable) return { point: { x: tx, y: ty }, room: center };
      }
    }

    for (let i = 0; i < 8; i++) {
      const gx = this.rng.int(0, this.map.width - 1);
      const gy = this.rng.int(0, this.map.height - 1);
      if (this.map.get(gx, gy).walkable) return { point: { x: gx, y: gy }, room: center };
    }
    return null;
  }

  private tryAssignMove(agent: Agent, wanderTarget: WanderTarget | null, state: AgentState = "Wander"): boolean {
    const target = wanderTarget?.point;
    if (!target) return false;
    if (agent.pos.x === target.x && agent.pos.y === target.y) return false;
    if (!this.map.inBounds(target.x, target.y)) return false;
    const tile = this.map.get(target.x, target.y);
    if (!tile.walkable) return false;
    let path = this.buildEgocentricRoute(agent, target);
    if (!path || !path.length) {
      path = this.planLocalPath(agent.pos, target) ?? [];
    }
    if (!path.length) return false;
    agent.navQueue = path;
    if (!this.advanceWaypoint(agent) || !agent.dest) {
      this.resetAgentTarget(agent);
      return false;
    }
    if (wanderTarget?.room !== 'ROOM' && wanderTarget?.room && this.pathsMetrics.length < this.maxPathsMetricsLength) {
      this.pathsMetrics.push({
        length: path.length,
        room: wanderTarget.room,
      });
    }
    this.setAgentState(agent, state);
    agent.moveProgress = 0;
    agent.stuckTicks = 0;
    return true;
  }

  private forceWander(agent: Agent): boolean {
    const target = this.pickWanderTarget(agent);
    if (target && this.tryAssignMove(agent, target, "Wander")) return true;
    if (this.corridorTiles.length) {
      const choice = this.rng.pick(this.corridorTiles);
      return this.tryAssignMove(agent, { point: choice }, "Wander");
    }
    return false;
  }

  private rememberTile(agent: Agent) {
    agent.recentTiles.push({ x: agent.pos.x, y: agent.pos.y });
    if (agent.recentTiles.length > RECENT_TILE_HISTORY) {
      agent.recentTiles.shift();
    }
  }

  private findNearestTaggedTile(start: Vec2, tag: TileTag, maxRadius = 0): Vec2 | null {
    if (!this.map.inBounds(start.x, start.y)) return null;
    const queue: Vec2[] = [{ x: start.x, y: start.y }];
    const distMap = new Map<string, number>();
    const startKey = this.keyOf(start);
    distMap.set(startKey, 0);
    let qi = 0;
    while (qi < queue.length) {
      const pos = queue[qi++];
      const posKey = this.keyOf(pos);
      const dist = distMap.get(posKey)!;
      const tile = this.map.get(pos.x, pos.y);
      if (tile.tag === tag) return { ...pos };
      if (maxRadius > 0 && dist >= maxRadius) continue;
      for (const dir of MOVE_DIRS) {
        const nx = pos.x + dir.x;
        const ny = pos.y + dir.y;
        if (!this.map.inBounds(nx, ny)) continue;
        const key = this.keyOf({ x: nx, y: ny });
        if (distMap.has(key)) continue;
        const nextTile = this.map.get(nx, ny);
        if (!nextTile.walkable) continue;
        distMap.set(key, dist + 1);
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  private planLocalPath(start: Vec2, goal: Vec2, maxNodes = NAV_SEARCH_MAX_NODES): Vec2[] | null {
    if (!this.map.inBounds(start.x, start.y) || !this.map.inBounds(goal.x, goal.y)) return null;
    const startKey = this.keyOf(start);
    const goalKey = this.keyOf(goal);
    const queue: Vec2[] = [{ ...start }];
    const prev = new Map<string, Vec2 | null>();
    const posByKey = new Map<string, Vec2>();
    prev.set(startKey, null);
    posByKey.set(startKey, { ...start });
    let bestKey = startKey;
    let bestDist = Math.hypot(goal.x - start.x, goal.y - start.y);
    let nodes = 0;
    while (queue.length && nodes < maxNodes) {
      const current = queue.shift()!;
      nodes++;
      const currentKey = this.keyOf(current);
      const dist = Math.hypot(goal.x - current.x, goal.y - current.y);
      if (dist + 0.001 < bestDist) {
        bestDist = dist;
        bestKey = currentKey;
      }
      if (currentKey === goalKey) {
        bestKey = currentKey;
        break;
      }
      for (const dir of MOVE_DIRS) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        if (!this.map.inBounds(nx, ny)) continue;
        const tile = this.map.get(nx, ny);
        if (!tile.walkable) continue;
        const next: Vec2 = { x: nx, y: ny };
        const key = this.keyOf(next);
        if (prev.has(key)) continue;
        prev.set(key, current);
        posByKey.set(key, next);
        queue.push(next);
      }
    }
    if (!prev.has(goalKey)) {
      if (bestKey === startKey) return null;
    } else {
      bestKey = goalKey;
    }
    const path: Vec2[] = [];
    let currentKey = bestKey;
    let node = posByKey.get(currentKey);
    if (!node) return null;
    while (currentKey !== startKey) {
      path.push({ x: node.x, y: node.y });
      const parent = prev.get(currentKey);
      if (!parent) break;
      currentKey = this.keyOf(parent);
      node = posByKey.get(currentKey);
      if (!node) break;
    }
    path.reverse();
    return path;
  }

  private buildEgocentricRoute(agent: Agent, finalTarget: Vec2): Vec2[] | null {
    const waypoints: Vec2[] = [];
    if (this.map.inBounds(agent.pos.x, agent.pos.y)) {
      const startTile = this.map.get(agent.pos.x, agent.pos.y);
      if (startTile.tag === "ROOM") {
        const door = this.findNearestTaggedTile(agent.pos, "DOOR", 64);
        if (door) waypoints.push(door);
      }
    }
    if (this.map.inBounds(finalTarget.x, finalTarget.y)) {
      const targetTile = this.map.get(finalTarget.x, finalTarget.y);
      if (targetTile.tag === "ROOM") {
        const door = this.findNearestTaggedTile(finalTarget, "DOOR", 64);
        if (door) waypoints.push(door);
      }
    }
    waypoints.push({ ...finalTarget });
    const fullPath: Vec2[] = [];
    let current = { ...agent.pos };
    for (const waypoint of waypoints) {
      const segment = this.planLocalPath(current, waypoint);
      if (!segment || !segment.length) {
        return null;
      }
      fullPath.push(...segment);
      current = waypoint;
    }
    return fullPath;
  }

  private advanceWaypoint(agent: Agent): boolean {
    while (agent.navQueue.length) {
      const next = agent.navQueue.shift()!;
      if (next.x === agent.pos.x && next.y === agent.pos.y) continue;
      agent.dest = { ...next };
      agent.lastMapVersion = this.map.getVersion();
      this.rebuildFlowField(agent);
      const dx = agent.dest.x - agent.pos.x;
      const dy = agent.dest.y - agent.pos.y;
      agent.setFacing(dx, dy);
      agent.moveProgress = 0;
      agent.stuckTicks = 0;
      return true;
    }
    return false;
  }

  private rebuildFlowField(agent: Agent) {
    if (!agent.dest) {
      this.resetAgentTarget(agent);
      return;
    }
    const width = this.map.width;
    const height = this.map.height;
    const size = width * height;
    if (!agent.flowField || agent.flowField.length !== size) {
      agent.flowField = new Uint16Array(size);
    }
    const field = agent.flowField;
    field.fill(0xffff);
    const dest = agent.dest;
    if (!this.map.inBounds(dest.x, dest.y)) return;
    const destIdx = this.map.index(dest.x, dest.y);
    field[destIdx] = 0;
    const queue: Vec2[] = [{ x: dest.x, y: dest.y }];
    let qi = 0;
    while (qi < queue.length && qi < LOCAL_SEARCH_MAX_NODES) {
      const cur = queue[qi++];
      const curIdx = this.map.index(cur.x, cur.y);
      const base = field[curIdx];
      for (const dir of MOVE_DIRS) {
        const nx = cur.x + dir.x;
        const ny = cur.y + dir.y;
        if (!this.map.inBounds(nx, ny)) continue;
        const tile = this.map.get(nx, ny);
        if (!tile.walkable) continue;
        const idx = this.map.index(nx, ny);
        const existing = field[idx];
        const stepCost = (dir.x !== 0 && dir.y !== 0 ? 14 : 10) + Math.max(0, tile.moveCost - 1) * 10;
        const nextCost = base + stepCost;
        if (nextCost >= 0xffff) continue;
        if (nextCost < existing) {
          field[idx] = nextCost;
          queue.push({ x: nx, y: ny });
        }
      }
    }
    agent.flowFieldDest = { ...dest };
    agent.flowFieldVersion = this.map.getVersion();
  }

  private chooseLocalStep(agent: Agent, occupied: Set<string>): Vec2 | null {
    const dest = agent.dest;
    if (!dest) return null;
    const dx = dest.x - agent.pos.x;
    const dy = dest.y - agent.pos.y;
    const currentDist = Math.hypot(dx, dy);
    if (currentDist === 0) return null;
    const targetX = dx / currentDist;
    const targetY = dy / currentDist;
    const field = agent.flowField;
    const currentField = field ? field[this.map.index(agent.pos.x, agent.pos.y)] : 0xffff;

    const candidates: Array<{ dir: Vec2; dot: number; improves: boolean; nextDist: number }> = [];
    for (const dir of MOVE_DIRS) {
      const nx = agent.pos.x + dir.x;
      const ny = agent.pos.y + dir.y;
      if (!this.map.inBounds(nx, ny)) continue;
      const tile = this.map.get(nx, ny);
      if (!tile.walkable) continue;
      const key = this.keyOf({ x: nx, y: ny });
      if (occupied.has(key)) continue;
      const nextDist = Math.hypot(dest.x - nx, dest.y - ny);
      const dot = dir.x * targetX + dir.y * targetY;
      const visited = agent.recentTiles.some(t => t.x === nx && t.y === ny);
      let fieldBonus = 0;
      let fieldImproves = false;
      if (field && currentField !== 0xffff) {
        const neighborField = field[this.map.index(nx, ny)];
        if (neighborField !== 0xffff) {
          fieldImproves = neighborField < currentField;
          fieldBonus = Math.max(0, currentField - neighborField) / 100;
        }
      }
      const score = dot + fieldBonus - (visited ? RECENT_TILE_PENALTY : 0);
      const improves = (fieldImproves) || nextDist < currentDist - 1e-6;
      candidates.push({ dir, dot: score, improves, nextDist });
    }

    if (!candidates.length) return null;
    const improving = candidates.filter(c => c.improves);
    const pool = improving.length ? improving : candidates;
    pool.sort((a, b) => {
      if (b.dot === a.dot) return a.nextDist - b.nextDist;
      return b.dot - a.dot;
    });
    return pool[0].dir;
  }

  private findLocalSearchStep(agent: Agent, occupied?: Set<string>): Vec2 | null {
    if (!agent.dest) return null;
    const start: Vec2 = { x: agent.pos.x, y: agent.pos.y };
    const startKey = this.keyOf(start);
    const destKey = this.keyOf(agent.dest);
    const queue: Vec2[] = [start];
    const prev = new Map<string, Vec2 | null>();
    const posByKey = new Map<string, Vec2>();
    prev.set(startKey, null);
    posByKey.set(startKey, start);
    let nodes = 0;
    let bestKey = startKey;
    let bestDist = Math.hypot(agent.dest.x - start.x, agent.dest.y - start.y);

    while (queue.length && nodes < LOCAL_SEARCH_MAX_NODES) {
      const current = queue.shift()!;
      nodes++;
      const currentKey = this.keyOf(current);
      const dist = Math.hypot(agent.dest.x - current.x, agent.dest.y - current.y);
      if (dist + 0.001 < bestDist) {
        bestDist = dist;
        bestKey = currentKey;
      }
      if (currentKey === destKey) {
        bestKey = currentKey;
        break;
      }
      for (const dir of MOVE_DIRS) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        if (LOCAL_SEARCH_RADIUS > 0) {
          if (Math.abs(nx - start.x) > LOCAL_SEARCH_RADIUS || Math.abs(ny - start.y) > LOCAL_SEARCH_RADIUS) continue;
        }
        if (!this.map.inBounds(nx, ny)) continue;
        const tile = this.map.get(nx, ny);
        if (!tile.walkable) continue;
        const next: Vec2 = { x: nx, y: ny };
        const key = this.keyOf(next);
        if (prev.has(key)) continue;
        if (occupied && key !== destKey && occupied.has(key)) continue;
        prev.set(key, current);
        posByKey.set(key, next);
        queue.push(next);
      }
    }

    if (bestKey === startKey) return null;

    let currentKey = bestKey;
    let node = posByKey.get(currentKey);
    if (!node) return null;
    let previous = prev.get(currentKey);
    while (previous && this.keyOf(previous) !== startKey) {
      currentKey = this.keyOf(previous);
      node = posByKey.get(currentKey);
      if (!node) return null;
      previous = prev.get(currentKey);
    }
    if (!node || !previous) return null;
    return { x: node.x - start.x, y: node.y - start.y };
  }

  private rebuildDensityGrid() {
    const size = this.map.width * this.map.height;
    const grid = new Uint16Array(size);
    for (const agent of this.agents.values()) {
      const { x, y } = agent.pos;
      if (!this.map.inBounds(x, y)) continue;
      const idx = this.map.index(x, y);
      const next = grid[idx] + 1;
      grid[idx] = next > 0xffff ? 0xffff : next;
    }
    this.density = grid;
    this.densityRecomputesThisSecond++;
  }

  private handlePoiArrival(agent: Agent, tag: TileTag) {
    const dwell = this.rng.int(POI_DWELL_MIN, POI_DWELL_MAX);
    if (tag === "BAR" || tag === "GYM") {
      const key = tag;
      if (this.poiOccupancy[key] >= this.poiCapacity[key]) {
        this.setAgentState(agent, "Idle");
        this.resetAgentTarget(agent);
        agent.lastMapVersion = this.map.getVersion();
        return;
      }
      this.poiOccupancy[key]++;
      const poiState: AgentState = tag === "BAR" ? "AtBar" : "AtGym";
      this.setAgentState(agent, poiState, dwell);
    }
    this.resetAgentTarget(agent);
    agent.lastMapVersion = this.map.getVersion();
  }

  private handleArrival(agent: Agent): boolean {
    if (agent.navQueue.length) {
      if (this.advanceWaypoint(agent)) {
        return true;
      }
      // No more waypoints; fall through to final arrival handling.
    }
    const tile = this.map.get(agent.pos.x, agent.pos.y);
    if (tile.tag === "EXIT") {
      this.despawnToOffMap(agent, { x: agent.pos.x, y: agent.pos.y });
      return false;
    }
    if (tile.tag === "BAR") {
      this.handlePoiArrival(agent, tile.tag);
      const minStay = Math.max(1, 60 - 50);
      const maxStay = 60 + 50;
      const dwell = this.rng.int(minStay, maxStay);
      this.setAgentState(agent, "AtBar", dwell);
      return true;
    }
    if (tile.tag === "GYM") {
      this.handlePoiArrival(agent, tile.tag);
      const minStay = Math.max(1, 60 - 50);
      const maxStay = 60 + 50;
      const dwell = this.rng.int(minStay, maxStay);
      this.setAgentState(agent, "AtGym", dwell);
      return true;
    }

    this.resetAgentTarget(agent);
    if (tile.tag === "ROOM") {
      const minStay = Math.max(1, 60 - 50);
      const maxStay = 60 + 50;
      const dwell = this.rng.int(minStay, maxStay);
      this.setAgentState(agent, "InRoom", dwell);
    } else if (agent.state === "Wander" || agent.state === "GoingToExit" || agent.state === "Returning") {
      this.setAgentState(agent, "Idle");
    }
    agent.lastMapVersion = this.map.getVersion();
    return true;
  }

  private onPoiLeave(state: AgentState) {
    const maxGym = this.maxGymOccupancy[this.tod.dayOfWeek];
    const maxBar = this.maxBarOccupancy[this.tod.dayOfWeek];

    if (this.poiOccupancy.BAR > maxBar) {
      this.maxBarOccupancy[this.tod.dayOfWeek] = this.poiOccupancy.BAR;
    }

    if (this.poiOccupancy.GYM > maxGym) {
      this.maxGymOccupancy[this.tod.dayOfWeek] = this.poiOccupancy.GYM;
    }

    if (state === "AtBar") {
      this.poiOccupancy.BAR = Math.max(0, this.poiOccupancy.BAR - 1);
    } else if (state === "AtGym") {
      this.poiOccupancy.GYM = Math.max(0, this.poiOccupancy.GYM - 1);
    }
  }

  // ——— Internals ———

  /** One discrete logic step. */
  private fixedStep(dtSec: number) {
    const prevDayOfWeek = this.tod.dayOfWeek;
    // Advance in-game time
    this.tod.advance(this.minutesPerTick);
    this.densityTimer += dtSec;
    // this.perfTimer += dtSec; // Removed, using wall clock for TPS
    // this.ticksThisSecond++;  // Removed

    if (this.tod.minute == 0) {
      this.tod.dayOfWeek = (this.tod.dayOfWeek + 1) % 7;
      if (prevDayOfWeek === 6) {
        this.weeksElapsed++;
        if (!this.cfg.headless || this.cfg.emitEvents) {
          this.events.emit({ type: "WEEK_COMPLETED", weeksElapsed: this.weeksElapsed });
        }
      }
    }

    // Handle off-map returns
    if (this.outList.length) {
      const now = this.tod.minute;
      for (let i = this.outList.length - 1; i >= 0; i--) {
        const rec = this.outList[i];
        // naive minute comparison (wrap handled by modulo nature; edge cases acceptable for starter)
        const due = (rec.untilMinute - now + 1440) % 1440;
        if (due === 0 || (now >= rec.untilMinute && (now - rec.untilMinute) < this.minutesPerTick + 0.001)) {
          // Respawn
          const a = new Agent({ ...rec.exitPos });
          a.roomId = rec.roomId;
          this.setAgentState(a, "Returning");
          a.lastMapVersion = this.map.getVersion();
          this.agents.set(a.id, a);
          if (!this.cfg.headless || this.cfg.emitEvents) {
            this.events.emit({ type: "AGENT_RESPAWNED", id: a.id });
          }
          this.outList.splice(i, 1);
        }
      }
    }

    // Agents update
    const occupiedTiles = new Set<string>();
    for (const a of this.agents.values()) {
      occupiedTiles.add(this.keyOf(a.pos));
    }

    for (const a of this.agents.values()) {
      if (!this.updateAgentTimers(a)) {
        continue;
      }

      if (a.pendingWander && !a.dest) {
        if (this.forceWander(a)) {
          a.pendingWander = false;
        }
      }

      const breakfastOver = ((this.tod.minute - 360 + 1440) % 1440) >= BREAKFAST_MINUTES;

      if (!a.dest && breakfastOver && this.rng.next() < 0.08) {
        if (this.forceWander(a)) {
          a.pendingWander = false;
        }
      }

      if (a.dest && a.lastMapVersion !== this.map.getVersion()) {
        const mapVersion = this.map.getVersion();
        a.lastMapVersion = mapVersion;
        if (!this.map.inBounds(a.dest.x, a.dest.y) || !this.map.get(a.dest.x, a.dest.y).walkable) {
          this.resetAgentTarget(a);
          this.setAgentState(a, "Idle");
          a.moveProgress = 0;
        }
        if (a.dest) {
          this.rebuildFlowField(a);
        }
      }

      if (a.dest && a.pos.x === a.dest.x && a.pos.y === a.dest.y) {
        const stay = this.handleArrival(a);
        if (!stay) continue;
      }

      if (!a.dest && a.navQueue.length) {
        this.advanceWaypoint(a);
      }

      if (!a.dest) {
        a.moveProgress = 0;
        continue;
      }

      let remaining = a.moveProgress + a.speed * dtSec;
      let movedThisTick = false;
      let blockedThisTick = false;
      while (remaining > 0 && a.dest) {
        let step = this.chooseLocalStep(a, occupiedTiles);
        if (!step) {
          blockedThisTick = true;
          a.stuckTicks = Math.min(a.stuckTicks + 1, 1000);
          if (a.stuckTicks >= STUCK_SEARCH_TICKS) {
            step = this.findLocalSearchStep(a, occupiedTiles);
            if (step) blockedThisTick = false;
          }
          if (!step) break;
        } else {
          blockedThisTick = false;
        }
        const stepDist = (step.x !== 0 && step.y !== 0) ? Math.SQRT2 : 1;
        if (remaining + 1e-6 < stepDist) break;
        const next = { x: a.pos.x + step.x, y: a.pos.y + step.y };
        const tile = this.map.get(next.x, next.y);
        if (!tile.walkable) {
          blockedThisTick = true;
          a.stuckTicks = Math.min(a.stuckTicks + 1, 1000);
          break;
        }
        const nextKey = this.keyOf(next);
        if (occupiedTiles.has(nextKey)) {
          blockedThisTick = true;
          a.stuckTicks = Math.min(a.stuckTicks + 1, 1000);
          break;
        }
        const currentKey = this.keyOf(a.pos);
        occupiedTiles.delete(currentKey);
        occupiedTiles.add(nextKey);
        a.setFacing(step.x, step.y);
        a.pos = next;
        this.rememberTile(a);
        remaining -= stepDist;
        movedThisTick = true;
        a.stuckTicks = 0;

        if (a.dest && a.pos.x === a.dest.x && a.pos.y === a.dest.y) {
          const stay = this.handleArrival(a);
          if (!stay) break;
        }
      }
      if (!movedThisTick && !blockedThisTick) {
        a.stuckTicks = 0;
      }
      if (movedThisTick) {
        a.stuckTicks = 0;
      }
      a.moveProgress = remaining;
    }

    // Skip density computation in headless mode unless explicitly requested
    if (!this.cfg.headless || this.cfg.computeDensity) {
      while (this.densityTimer >= 1) {
        this.densityTimer -= 1;
        this.rebuildDensityGrid();
      }
    } else {
      this.densityTimer = 0; // Reset timer to prevent buildup
    }

    // Skip perf stats in headless mode unless explicitly requested
    if (!this.cfg.headless || this.cfg.computePerfStats) {
      // Legacy perf timer block removed. TPS is now wall-clock based in advance()
    } else {
      // cleared
    }
  }

  /** Convert an agent reaching EXIT into an off-map record, remove from world. */
  private despawnToOffMap(a: Agent, exitPos: Vec2) {
    // Remove agent
    this.agents.delete(a.id);
    // Pick reason + duration
    const reason = this.rng.pick<OutRecord["reason"]>(["Study", "Work", "Shop"]);
    const dur = this.rng.int(60, 360); // minutes
    const untilMinute = (this.tod.minute + dur) % 1440;
    // Track
    this.outList.push({ id: a.id, name: a.name, reason, untilMinute, exitPos, roomId: a.roomId });
    if (!this.cfg.headless || this.cfg.emitEvents) {
      this.events.emit({ type: "AGENT_DESPAWNED", id: a.id });
    }
  }

  // ——— Dorm generator ———

  /**
   * Generate a corridor and enough rooms (3x3 by default) to host `numAgents`.
   * All generated tiles are tagged LOCKED plus semantic tags (ROOM, CORRIDOR, DOOR).
   * Returns centers for spawning, one per room.
   */
  private generateDorm(_numAgents: number): Vec2[] {
    // keep requested count for future limits; generation itself produces full capacity
    const requestedAgents = Math.max(1, _numAgents);
    void requestedAgents;
    const spawns: Vec2[] = [];

    const roomInteriorW = 3;
    const roomInteriorH = 3;
    const wall = 1;
    const roomTotalW = roomInteriorW + wall * 2;
    const roomTotalH = roomInteriorH + wall * 2;
    const columnGap = 0;
    const doorGap = Math.max(1, Math.min(5, this.map.spec?.dormRowGap ?? 1)); // thickness of the shared corridor between stacked rows
    const stepX = roomTotalW + columnGap;
    const stepY = roomTotalH + doorGap;

    this.corridorTiles = [];

    const buildableRects = this.map.spec?.buildableRects;

    if (buildableRects && buildableRects.length) {
      const poiPadding = 3;
      const specPois = this.map.spec;
      const paddedBar = specPois ? {
        x: specPois.barRect.x - poiPadding,
        y: specPois.barRect.y - poiPadding,
        w: specPois.barRect.w + poiPadding * 2,
        h: specPois.barRect.h + poiPadding * 2,
      } : undefined;
      const paddedGym = specPois ? {
        x: specPois.gymRect.x - poiPadding,
        y: specPois.gymRect.y - poiPadding,
        w: specPois.gymRect.w + poiPadding * 2,
        h: specPois.gymRect.h + poiPadding * 2,
      } : undefined;
      const overlapsPoi = (x: number, y: number, w: number, h: number) => {
        const rect = { x, y, w, h };
        const overlap = (a: { x: number; y: number; w: number; h: number } | undefined, b: { x: number; y: number; w: number; h: number }) => {
          if (!a) return false;
          return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        };
        if (overlap(paddedBar, rect)) return true;
        if (overlap(paddedGym, rect)) return true;
        if (specPois && overlap({ ...specPois.outsideRect, w: specPois.outsideRect.w, h: specPois.outsideRect.h }, rect)) return true;
        if (specPois && overlap({ ...specPois.exitRect, w: specPois.exitRect.w, h: specPois.exitRect.h }, rect)) return true;
        return false;
      };

      const placeRoom = (left: number, top: number, doorDir: "up" | "down") => {
        const spawn: Vec2 = {
          x: left + wall + Math.floor(roomInteriorW / 2),
          y: top + wall + Math.floor(roomInteriorH / 2),
        };

        if (overlapsPoi(left, top, roomTotalW, roomTotalH)) return;

        // Build room walls and interior
        for (let yy = 0; yy < roomTotalH; yy++) {
          for (let xx = 0; xx < roomTotalW; xx++) {
            const tx = left + xx;
            const ty = top + yy;
            if (!this.map.inBounds(tx, ty)) continue;

            const isWall =
              xx < wall ||
              xx >= wall + roomInteriorW ||
              yy < wall ||
              yy >= wall + roomInteriorH;

            const tile: Tile = {
              walkable: !isWall,
              moveCost: 1,
              tag: "ROOM",
            };
            this.map.set(tx, ty, tile);
          }
        }

        // Add the door (so agents can enter)
        const doorX = left + wall + Math.floor(roomInteriorW / 2);
        const doorY = doorDir === "down" ? top + roomTotalH - 1 : top;
        if (this.map.inBounds(doorX, doorY)) {
          this.map.set(doorX, doorY, { walkable: true, moveCost: 1, tag: "DOOR" });
        }

        // Add the bed (tiny 2x1 area)
        const bedW = 1;
        const bedH = 2;
        const placeAtTop = doorDir === "down";
        const bedTop = placeAtTop ? top + wall : top + wall + roomInteriorH - bedH;
        const bedLeft = left + wall;

        for (let by = 0; by < bedH; by++) {
          for (let bx = 0; bx < bedW; bx++) {
            const tx = bedLeft + bx;
            const ty = bedTop + by;
            if (!this.map.inBounds(tx, ty)) continue;
            this.map.set(tx, ty, { walkable: false, moveCost: 1, tag: "BED" });
          }
        }

        // Add to spawn list (center of room)
        spawns.push(spawn);
      };

      const stampCorridorRow = (y: number, rect: { x: number; w: number }) => {
        for (let xx = rect.x; xx < rect.x + rect.w; xx++) {
          if (!this.map.inBounds(xx, y)) continue;
          // avoid carving through POIs or the exit/outside zones
          if (overlapsPoi(xx, y, 1, 1)) continue;
          const existing = this.map.get(xx, y);
          if (!existing.walkable && existing.tag !== "BUILDABLE") continue;
          this.map.set(xx, y, { walkable: true, moveCost: 1, tag: "CORRIDOR" });
        }
      };

      // Build dorms inside each JSON rect (not just one block!)
      for (const rect of buildableRects) {
        let y = rect.y;
        let placedRow = 0;
        while (y + roomTotalH <= rect.y + rect.h) {
          const hasGapBelow = y + roomTotalH + doorGap <= rect.y + rect.h;
          const doorDir: "up" | "down" = hasGapBelow ? "down" : (placedRow > 0 ? "up" : "down");

          let x = rect.x;
          while (x + roomTotalW <= rect.x + rect.w) {
            placeRoom(x, y, doorDir);
            x += stepX;
          }

          if (hasGapBelow) {
            const gapY = y + roomTotalH;
            for (let gy = 0; gy < doorGap && gapY + gy < rect.y + rect.h; gy++) {
              stampCorridorRow(gapY + gy, rect);
            }
          }

          y += stepY;
          placedRow++;
        }
      }

      return spawns;
    }

    const margin = 4;
    const corridorWidth = 3;

    const corridorStartGuess = Math.max(margin + roomTotalH, Math.floor(this.map.height * 0.32));
    const corridorY0 = Math.min(this.map.height - margin - corridorWidth, corridorStartGuess);
    const corridorY1 = corridorY0 + corridorWidth - 1;
    const corridorMid = corridorY0 + Math.floor(corridorWidth / 2);

    const rectConflicts = (x: number, y: number, w: number, h: number) => {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          if (!this.map.inBounds(xx, yy)) return true;
          const tag = this.map.get(xx, yy).tag;
          if (tag && tag !== "BUILDABLE" && tag !== "ROOM" && tag !== "CORRIDOR" && tag !== "DOOR") {
            return true;
          }
        }
      }
      return false;
    };

    const placeRoom = (left: number, top: number, doorDir: "up" | "down") => {
      const spawn: Vec2 = {
        x: left + wall + Math.floor(roomInteriorW / 2),
        y: top + wall + Math.floor(roomInteriorH / 2),
      };

      for (let yy = 0; yy < roomTotalH; yy++) {
        for (let xx = 0; xx < roomTotalW; xx++) {
          const tx = left + xx;
          const ty = top + yy;
          if (!this.map.inBounds(tx, ty)) continue;
          const isWall = xx < wall || xx >= wall + roomInteriorW || yy < wall || yy >= wall + roomInteriorH;
          const tile: Tile = {
            walkable: !isWall,
            moveCost: 1,
            tag: isWall ? "ROOM" : "ROOM",
          };
          this.map.set(tx, ty, tile);
        }
      }

      const doorX = left + wall + Math.floor(roomInteriorW / 2);
      const doorY = doorDir === "down" ? top + roomTotalH - 1 : top;
      if (this.map.inBounds(doorX, doorY)) {
        this.map.set(doorX, doorY, { walkable: true, moveCost: 1, tag: "DOOR" });
      }

      spawns.push(spawn);
    };

    const placeRow = (top: number, doorDir: "up" | "down") => {
      let x = margin;
      while (x + roomTotalW <= this.map.width - margin) {
        if (!rectConflicts(x, top, roomTotalW, roomTotalH)) {
          placeRoom(x, top, doorDir);
        }
        x += stepX;
      }
    };

    for (let y = corridorY0; y <= corridorY1; y++) {
      for (let x = margin; x < this.map.width - margin; x++) {
        this.map.set(x, y, { walkable: true, moveCost: 1, tag: "CORRIDOR" });
        if (y === corridorMid) this.corridorTiles.push({ x, y });
      }
    }

    const topRowTop = corridorY0 - roomTotalH;
    if (topRowTop >= margin) {
      placeRow(topRowTop, "down");
      if (topRowTop - stepY >= margin) {
        placeRow(topRowTop - stepY, "down");
      }
    }

    const bottomRowTop = corridorY1 + 1;
    if (bottomRowTop + roomTotalH <= this.map.height - margin) {
      placeRow(bottomRowTop, "up");
      if (bottomRowTop + stepY + roomTotalH <= this.map.height - margin) {
        placeRow(bottomRowTop + stepY, "up");
      }
    }

    // ensure corridor midline is very walkable for doors
    for (let x = margin; x < this.map.width - margin; x++) {
      const tile = this.map.get(x, corridorMid);
      this.map.set(x, corridorMid, { ...tile, walkable: true, moveCost: 1, tag: "CORRIDOR" });
    }

    return spawns;
  }
}
