import { GridMap } from "./GridMap";
import { Agent, AGENT_PROPS } from "./Agent";
import type { EngineConfig, Vec2, BaseSpec, Tile, TileTag, AgentState, WanderTarget, PathMetric, BoundingBox } from "./Types";
import { RNG } from "./RNG";
import type { Command } from "./Commands";
import { EventBus } from "./Events";
import { Clock } from "./Clock";
import { TimeOfDay } from "./TimeOfDay";

const BREAKFAST_MINUTES = 30;
const POI_DWELL_MIN = 10;
const POI_DWELL_MAX = 20;
const RECENT_TILE_HISTORY = 6;
const STUCK_SEARCH_TICKS = 2;
const LOCAL_SEARCH_RADIUS = 0; // 0 => unlimited
const LOCAL_SEARCH_MAX_NODES = 4000;
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
  reason: "Study" | "Work" | "Shop";
  untilMinute: number;
  exitPos: Vec2;
}

export type timeOfDay = "morning" | "afternoon" | "night";

export class Engine {
  readonly cfg: EngineConfig;
  map: GridMap;
  readonly events = new EventBus();
  readonly clock: Clock;
  readonly rng: RNG;
  readonly tod: TimeOfDay;

  private agents: Map<string, Agent> = new Map();
  private outList: OutRecord[] = [];
  private tickCount = 0;

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
  private perfTimer = 0;
  private ticksThisSecond = 0;
  private lastTicksPerSecond = 0;
  private lastDensityRecomputes = 0;
  private corridorTiles: Vec2[] = [];
  public pathsMetrics: Array<PathMetric> = []
  private maxPathsMetricsLength = 500;
  public corridorBoundingBox?: BoundingBox;
  public corridorDensityValues: Array<number> = []

  constructor(cfg: EngineConfig, baseSpec?: BaseSpec) {
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.clock = new Clock(cfg.baseTickRate);
    this.tod = new TimeOfDay(360); // 06:00

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
  getOutList(): OutRecord[] { return [...this.outList]; }
  getPerfStats() {
    return {
      ticksPerSecond: this.lastTicksPerSecond,
      densityRecomputesPerSecond: this.lastDensityRecomputes,
    };
  }
  setSpeed(mult: number) { this.clock.setSpeed(mult); }
  setPaused(p: boolean) { this.clock.setPaused(p); }
  stepOnce() {
    const steps = this.clock.stepOnce();
    for (let i = 0; i < steps; i++) {
      this.fixedStep(1 / this.cfg.baseTickRate);
      this.tickCount++;
      this.events.emit({ type: "TICK", tick: this.tickCount });
    }
    return steps;
  }

  // ——— Core API ———

  /**
   * Reset world to a generated dorm for `count` agents.
   * - Rebuilds from `baseSpec`
   * - Generates dorm (rooms+corridor) as LOCKED
   * - Spawns `count` agents (one per room) at 06:00
   */
  resetWorld(baseSpec: BaseSpec, count: number) {
    // Rebuild map from base spec
    this.map = GridMap.buildFromSpec(this.cfg.grid, baseSpec);
    // Clear sim
    this.agents.clear();
    this.outList.length = 0;
    this.tickCount = 0;
    this.tod.set(360); // 06:00
    this.poiOccupancy.BAR = 0;
    this.poiOccupancy.GYM = 0;
    this.poiCenters.clear();
    this.corridorTiles = [];
    this.pathsMetrics.length = 0;
    this.density = undefined;
    this.densityTimer = 0;
    this.densityRecomputesThisSecond = 0;
    this.perfTimer = 0;
    this.ticksThisSecond = 0;
    this.lastTicksPerSecond = 0;
    this.lastDensityRecomputes = 0;
    // Stable randomness for same seed
    // (we could allow user to change seed—left as cfg.seed)
    // Generate dorm & room spawns
    this.roomSpawns = this.generateDorm(count);

    const mapVersion = this.map.getVersion();
    // Spawn agents (cap to roomSpawns length)
    const n = Math.min(count, this.roomSpawns.length);
    for (let i = 0; i < n; i++) {
      const a = new Agent(this.roomSpawns[i]);
      a.roomId = `R${i}`;
      a.resetRandomType(); // set here agent
      this.setAgentState(a, "Breakfast", BREAKFAST_MINUTES);
      a.dest = null;
      a.stuckTicks = 0;
      a.recentTiles = [{ ...a.pos }];
      a.lastMapVersion = mapVersion;
      this.agents.set(a.id, a);
      this.events.emit({ type: "AGENT_ADDED", id: a.id });
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
        this.events.emit({ type: "AGENT_ADDED", id: a.id });
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
          a.dest = null;
          a.moveProgress = 0;
          a.stuckTicks = 0;
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
    const steps = this.clock.advance(nowSec);
    for (let i = 0; i < steps; i++) {
      this.fixedStep(1 / this.cfg.baseTickRate);
      this.tickCount++;
      this.events.emit({ type: "TICK", tick: this.tickCount });
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

  private updateAgentNeeds(agent: Agent) {
    const minutes = this.minutesPerTick;
    const hungerDelta = 0.0008 * minutes;
    const energyDelta = 0.0005 * minutes;
    const socialDelta = 0.0003 * minutes;
    agent.needs.hunger = Math.min(1, agent.needs.hunger + hungerDelta);
    agent.needs.energy = Math.max(0, agent.needs.energy - energyDelta);
    agent.needs.social = Math.max(0, Math.min(1, agent.needs.social - socialDelta));
  }

  private updateAgentTimers(agent: Agent): boolean {
    const prevState = agent.state;
    const hold = prevState === "Breakfast" || prevState === "AtBar" || prevState === "AtGym";
    if (!hold) return true;

    if (agent.stateTimer > 0) {
      agent.stateTimer = Math.max(0, agent.stateTimer - this.minutesPerTick);
      if (agent.stateTimer > 0) return false;
    }

    this.setAgentState(agent, "Idle");
    agent.dest = null;
    agent.lastMapVersion = this.map.getVersion();
    agent.pendingWander = true;
    agent.moveProgress = 0;
    agent.stuckTicks = 0;
    return true;
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

  private pickWanderTarget(agent: Agent): WanderTarget | null {
    const agentProps = AGENT_PROPS[agent.agentType];
    const timeOfDay = this.getTimeOfDay();
    const currentProps = agentProps[timeOfDay];
    const gymCoeff = currentProps.gym * Math.floor(Math.random() * (8 - 5 + 1)) + 5;
    const barCoeff = currentProps.bar * Math.floor(Math.random() * (8 - 5 + 1)) + 5;
    const roomCoeff = currentProps.room * Math.floor(Math.random() * (8 - 5 + 1)) + 5;

    const center = gymCoeff > barCoeff && gymCoeff > roomCoeff ? "GYM"
      : barCoeff > gymCoeff && barCoeff > roomCoeff ? "BAR"
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
    agent.dest = { ...target };
    const dx = agent.dest.x - agent.pos.x;
    const dy = agent.dest.y - agent.pos.y;
    agent.setFacing(dx, dy);
    if (wanderTarget?.room !== 'ROOM' && wanderTarget?.room && this.pathsMetrics.length < this.maxPathsMetricsLength) {
      const approxLength = Math.hypot(dx, dy);
      if (approxLength > 0) {
        this.pathsMetrics.push({
          length: approxLength,
          room: wanderTarget.room,
        });
      }
    }
    agent.lastMapVersion = this.map.getVersion();
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

  private chooseLocalStep(agent: Agent, occupied: Set<string>): Vec2 | null {
    const dest = agent.dest;
    if (!dest) return null;
    const dx = dest.x - agent.pos.x;
    const dy = dest.y - agent.pos.y;
    const currentDist = Math.hypot(dx, dy);
    if (currentDist === 0) return null;
    const targetX = dx / currentDist;
    const targetY = dy / currentDist;

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
      const score = dot - (visited ? RECENT_TILE_PENALTY : 0);
      const improves = nextDist < currentDist - 1e-6;
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
        agent.dest = null;
        agent.lastMapVersion = this.map.getVersion();
        agent.stuckTicks = 0;
        return;
      }
      this.poiOccupancy[key]++;
      const poiState: AgentState = tag === "BAR" ? "AtBar" : "AtGym";
      this.setAgentState(agent, poiState, dwell);
    }
    agent.dest = null;
    agent.lastMapVersion = this.map.getVersion();
    agent.stuckTicks = 0;
  }

  private handleArrival(agent: Agent): boolean {
    const tile = this.map.get(agent.pos.x, agent.pos.y);
    if (tile.tag === "EXIT") {
      this.despawnToOffMap(agent, { x: agent.pos.x, y: agent.pos.y });
      return false;
    }
    if (tile.tag === "BAR" || tile.tag === "GYM") {
      this.handlePoiArrival(agent, tile.tag);
      return true;
    }

    agent.dest = null;
    if (agent.state === "Wander" || agent.state === "GoingToExit" || agent.state === "Returning") {
      this.setAgentState(agent, "Idle");
    }
    agent.lastMapVersion = this.map.getVersion();
    agent.stuckTicks = 0;
    return true;
  }

  private onPoiLeave(state: AgentState) {
    if (state === "AtBar") {
      this.poiOccupancy.BAR = Math.max(0, this.poiOccupancy.BAR - 1);
    } else if (state === "AtGym") {
      this.poiOccupancy.GYM = Math.max(0, this.poiOccupancy.GYM - 1);
    }
  }

  // ——— Internals ———

  /** One discrete logic step. */
  private fixedStep(dtSec: number) {
    // Advance in-game time
    this.tod.advance(this.minutesPerTick);
    this.densityTimer += dtSec;
    this.perfTimer += dtSec;
    this.ticksThisSecond++;

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
          this.setAgentState(a, "Returning");
          a.lastMapVersion = this.map.getVersion();
          this.agents.set(a.id, a);
          this.events.emit({ type: "AGENT_RESPAWNED", id: a.id });
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
      this.updateAgentNeeds(a);
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
          a.dest = null;
          this.setAgentState(a, "Idle");
          a.moveProgress = 0;
          a.stuckTicks = 0;
        }
      }

      if (a.dest && a.pos.x === a.dest.x && a.pos.y === a.dest.y) {
        const stay = this.handleArrival(a);
        if (!stay) continue;
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

    while (this.densityTimer >= 1) {
      this.densityTimer -= 1;
      this.rebuildDensityGrid();
    }

    while (this.perfTimer >= 1) {
      this.perfTimer -= 1;
      this.lastTicksPerSecond = this.ticksThisSecond;
      this.ticksThisSecond = 0;
      this.lastDensityRecomputes = this.densityRecomputesThisSecond;
      this.densityRecomputesThisSecond = 0;
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
    this.outList.push({ id: a.id, reason, untilMinute, exitPos });
    this.events.emit({ type: "AGENT_DESPAWNED", id: a.id });
  }

  // ——— Dorm generator ———

  /**
   * Generate a corridor and enough rooms (3x3 by default) to host `numAgents`.
   * All generated tiles are tagged LOCKED plus semantic tags (ROOM, CORRIDOR, DOOR).
   * Returns centers for spawning, one per room.
   */
  private generateDorm(numAgents: number): Vec2[] {
    numAgents = Math.max(1, Math.min(100, numAgents));
    const spawns: Vec2[] = [];

    const margin = 4;
    const corridorWidth = 3;

    const roomInteriorW = 4;
    const roomInteriorH = 4;
    const wall = 1;
    const roomTotalW = roomInteriorW + wall * 2;
    const roomTotalH = roomInteriorH + wall * 2;
    const stepX = roomInteriorW + wall;
    const stepY = roomInteriorH + wall;

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
      while (x + roomTotalW <= this.map.width - margin && spawns.length < numAgents) {
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
      if (spawns.length < numAgents && topRowTop - stepY >= margin) {
        placeRow(topRowTop - stepY, "down");
      }
    }

    if (spawns.length < numAgents) {
      const bottomRowTop = corridorY1 + 1;
      if (bottomRowTop + roomTotalH <= this.map.height - margin) {
        placeRow(bottomRowTop, "up");
        if (spawns.length < numAgents && bottomRowTop + stepY + roomTotalH <= this.map.height - margin) {
          placeRow(bottomRowTop + stepY, "up");
        }
      }
    }

    // ensure corridor midline is very walkable for doors
    for (let x = margin; x < this.map.width - margin; x++) {
      const tile = this.map.get(x, corridorMid);
      this.map.set(x, corridorMid, { ...tile, walkable: true, moveCost: 1, tag: "CORRIDOR" });
    }

    const x0 = margin;
    const y0 = corridorY0;
    const x1 = this.map.width - margin - 1;
    const y1 = corridorY1;

    this.corridorBoundingBox = {
      x0,
      y0,
      x1,
      y1,
      tiles: (x0 - x1) * (y0 - y1),
    };

    return spawns.slice(0, numAgents);
  }
}
