import { GridMap } from "./GridMap";
import { aStar8 } from "./Pathfinder";
import { Agent } from "./Agent";
import type { EngineConfig, Vec2, BaseSpec, Tile, TileTag, AgentState } from "./Types";
import { RNG } from "./RNG";
import type { Command } from "./Commands";
import { EventBus } from "./Events";
import { Clock } from "./Clock";
import { TimeOfDay } from "./TimeOfDay";

const BREAKFAST_MINUTES = 30;
const POI_DWELL_MIN = 10;
const POI_DWELL_MAX = 20;

/** Off-map tracking entry (for UI "Out List"). */
export interface OutRecord {
  id: string;
  reason: "Study" | "Work" | "Shop";
  untilMinute: number;
  exitPos: Vec2;
}

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
  private poiCapacity: Record<"BAR"|"GYM", number> = { BAR: 30, GYM: 15 };
  private poiOccupancy: Record<"BAR"|"GYM", number> = { BAR: 0, GYM: 0 };
  private poiCenters = new Map<TileTag, Vec2>();
  density?: Uint16Array;
  private densityTimer = 0;
  private densityRecomputesThisSecond = 0;
  private pathRecomputesThisSecond = 0;
  private perfTimer = 0;
  private ticksThisSecond = 0;
  private lastTicksPerSecond = 0;
  private lastPathRecomputes = 0;
  private lastDensityRecomputes = 0;
  private corridorTiles: Vec2[] = [];

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

  // ——— Public getters ———
  getTick() { return this.tickCount; }
  getAgents(): Agent[] { return [...this.agents.values()]; }
  getOutList(): OutRecord[] { return [...this.outList]; }
  getPerfStats() {
    return {
      ticksPerSecond: this.lastTicksPerSecond,
      pathRecomputesPerSecond: this.lastPathRecomputes,
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
    this.density = undefined;
    this.densityTimer = 0;
    this.densityRecomputesThisSecond = 0;
    this.pathRecomputesThisSecond = 0;
    this.perfTimer = 0;
    this.ticksThisSecond = 0;
    this.lastTicksPerSecond = 0;
    this.lastPathRecomputes = 0;
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
      this.setAgentState(a, "Breakfast", BREAKFAST_MINUTES);
      a.dest = null;
      a.path = null;
      a.lastPathMapVersion = mapVersion;
      this.agents.set(a.id, a);
      this.events.emit({ type: "AGENT_ADDED", id: a.id });
    }
  }

  /** Simple 8-dir A* wrapper */
  findPath(from: Vec2, to: Vec2) {
    const path = aStar8(this.map, from, to);
    this.pathRecomputesThisSecond++;
    return path;
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
        a.lastPathMapVersion = this.map.getVersion();
        this.agents.set(a.id, a);
        this.events.emit({ type: "AGENT_ADDED", id: a.id });
        break;
      }
      case "MOVE_AGENT_TO": {
        const a = this.agents.get(cmd.id);
        if (!a) return;
        a.dest = { ...cmd.dest };
        const dx = a.dest.x - a.pos.x, dy = a.dest.y - a.pos.y;
        a.setFacing(dx, dy);
        a.path = this.findPath(a.pos, a.dest) ?? null;
        a.lastPathMapVersion = this.map.getVersion();
        const targetTag = this.map.inBounds(a.dest.x, a.dest.y) ? this.map.get(a.dest.x, a.dest.y).tag : undefined;
        if (targetTag === "EXIT") this.setAgentState(a, "GoingToExit");
        else this.setAgentState(a, "Wander");
        this.events.emit({ type: "AGENT_REPATHED", id: a.id });
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
        this.pathRecomputesThisSecond = 0;
        this.perfTimer = 0;
        this.ticksThisSecond = 0;
        this.lastTicksPerSecond = 0;
        this.lastPathRecomputes = 0;
        this.lastDensityRecomputes = 0;
        this.corridorTiles = [];
        // invalidate all paths
        const mapVersionAfterLoad = this.map.getVersion();
        for (const a of this.agents.values()) { a.path = null; a.dest = null; a.moveProgress = 0; a.lastPathMapVersion = mapVersionAfterLoad; }
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
    agent.path = null;
    agent.lastPathMapVersion = this.map.getVersion();
    agent.pendingWander = true;
    agent.moveProgress = 0;
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

  private pickWanderTarget(agent: Agent): Vec2 | null {
    if (agent.needs.hunger > 0.8) {
      const barCenter = this.getPoiCenter("BAR");
      if (barCenter) {
        const cx = Math.round(barCenter.x);
        const cy = Math.round(barCenter.y);
        for (let i = 0; i < 6; i++) {
          const tx = cx + this.rng.int(-4, 4);
          const ty = cy + this.rng.int(-4, 4);
          if (!this.map.inBounds(tx, ty)) continue;
          const tile = this.map.get(tx, ty);
          if (tile.walkable) return { x: tx, y: ty };
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      const gx = this.rng.int(0, this.map.width - 1);
      const gy = this.rng.int(0, this.map.height - 1);
      if (this.map.get(gx, gy).walkable) return { x: gx, y: gy };
    }
    return null;
  }

  private tryAssignMove(agent: Agent, target: Vec2 | null, state: AgentState = "Wander"): boolean {
    if (!target) return false;
    if (agent.pos.x === target.x && agent.pos.y === target.y) return false;
    agent.dest = { ...target };
    const dx = agent.dest.x - agent.pos.x;
    const dy = agent.dest.y - agent.pos.y;
    agent.setFacing(dx, dy);
    agent.path = this.findPath(agent.pos, agent.dest) ?? null;
    agent.lastPathMapVersion = this.map.getVersion();
    if (agent.path && agent.path.length) {
      this.setAgentState(agent, state);
      agent.moveProgress = 0;
      this.events.emit({ type: "AGENT_REPATHED", id: agent.id });
      return true;
    }
    agent.dest = null;
    agent.path = null;
    return false;
  }

  private forceWander(agent: Agent): boolean {
    const target = this.pickWanderTarget(agent);
    if (target && this.tryAssignMove(agent, target, "Wander")) return true;
    if (this.corridorTiles.length) {
      const choice = this.rng.pick(this.corridorTiles);
      return this.tryAssignMove(agent, choice, "Wander");
    }
    return false;
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
        agent.path = null;
        agent.lastPathMapVersion = this.map.getVersion();
        return;
      }
      this.poiOccupancy[key]++;
      const poiState: AgentState = tag === "BAR" ? "AtBar" : "AtGym";
      this.setAgentState(agent, poiState, dwell);
    }
    agent.dest = null;
    agent.path = null;
    agent.lastPathMapVersion = this.map.getVersion();
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
    agent.path = null;
    if (agent.state === "Wander" || agent.state === "GoingToExit" || agent.state === "Returning") {
      this.setAgentState(agent, "Idle");
    }
    agent.lastPathMapVersion = this.map.getVersion();
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
          a.lastPathMapVersion = this.map.getVersion();
          this.agents.set(a.id, a);
          this.events.emit({ type: "AGENT_RESPAWNED", id: a.id });
          this.outList.splice(i, 1);
        }
      }
    }

    // Agents update
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

      if (a.dest && a.lastPathMapVersion !== this.map.getVersion()) {
        const newPath = this.findPath(a.pos, a.dest) ?? null;
        a.path = newPath;
        a.lastPathMapVersion = this.map.getVersion();
        if (newPath) {
          this.events.emit({ type: "AGENT_REPATHED", id: a.id });
        } else {
          a.dest = null;
          this.setAgentState(a, "Idle");
        }
      }

      // If no path, continue
      if (!a.path || a.path.length === 0) continue;

      // Move along path, consuming whole tiles based on speed
      let remaining = a.moveProgress + a.speed * dtSec; // tiles per tick
      while (remaining > 0 && a.path && a.path.length > 0) {
        const next = a.path[0];

        // If user edited a wall in front, re-path
        if (!this.map.get(next.x, next.y).walkable) {
          if (a.dest) a.path = this.findPath(a.pos, a.dest) ?? null;
          if (!a.path) break;
          continue;
        }

        if (a.pos.x === next.x && a.pos.y === next.y) {
          a.path.shift();
          continue;
        }
        const dx = next.x - a.pos.x;
        const dy = next.y - a.pos.y;
        const stepDist = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1;
        if (remaining >= stepDist) {
          a.setFacing(dx, dy);
          a.pos = { x: next.x, y: next.y };
          remaining -= stepDist;
          a.path.shift();

          // Arrival handling
          if (!a.path || a.path.length === 0) {
            if (a.dest && a.pos.x === a.dest.x && a.pos.y === a.dest.y) {
              const stay = this.handleArrival(a);
              if (!stay) break;
            }
            break;
          }
        } else {
          // Not enough time this tick to reach next tile
          break;
        }
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
      this.lastPathRecomputes = this.pathRecomputesThisSecond;
      this.pathRecomputesThisSecond = 0;
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
    console.log("🧩 buildable rects:", (this.map as any).spec?.buildableRects);
    numAgents = Math.max(1, Math.min(100, numAgents));
    const spawns: Vec2[] = [];
  
    const buildableRects = (this.map as any).spec?.buildableRects || [];
    const roomInteriorW = 4;
    const roomInteriorH = 4;
    const wall = 1;
    const roomTotalW = roomInteriorW + wall * 2;
    const roomTotalH = roomInteriorH + wall * 2;
    const stepX = roomInteriorW + wall;
    const stepY = roomInteriorH + wall;
  
    const placeRoom = (left: number, top: number, doorDir: "up" | "down") => {
      const spawn: Vec2 = {
        x: left + wall + Math.floor(roomInteriorW / 2),
        y: top + wall + Math.floor(roomInteriorH / 2),
      };
    
      // 1️⃣ Build room walls and interior
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
    
      // 2️⃣ Add the door (so agents can enter)
      const doorX = left + wall + Math.floor(roomInteriorW / 2);
      const doorY = doorDir === "down" ? top + roomTotalH - 1 : top;
      if (this.map.inBounds(doorX, doorY)) {
        this.map.set(doorX, doorY, { walkable: true, moveCost: 1, tag: "DOOR" });
      }
    
      // 3️⃣ Add the bed (tiny 2×1 area)
      const bedW = 1;
      const bedH = 2;
    
      // placeAtTop = true → bed goes along top wall; otherwise bottom wall
      const placeAtTop = doorDir === "down";
      const bedTop = placeAtTop
        ? top + wall // bed near top wall
        : top + wall + roomInteriorH - bedH; // bed near bottom wall
      const bedLeft = left + wall; // near left wall
    
      for (let by = 0; by < bedH; by++) {
        for (let bx = 0; bx < bedW; bx++) {
          const tx = bedLeft + bx;
          const ty = bedTop + by;
          if (!this.map.inBounds(tx, ty)) continue;
          this.map.set(tx, ty, { walkable: false, moveCost: 1, tag: "BED" });
        }
      }
    
      // 4️⃣ Add to spawn list (center of room)
      spawns.push(spawn);
    };
    
  
    // 🔹 Build dorms inside each JSON rect (not just one block!)
    for (const rect of buildableRects) {
      let y = rect.y;
      while (y + roomTotalH <= rect.y + rect.h && spawns.length < numAgents) {
        let x = rect.x;
        while (x + roomTotalW <= rect.x + rect.w && spawns.length < numAgents) {
          placeRoom(x, y, "down");
          x += stepX;
        }
        y += stepY;
      }
    }
  
    // Add corridors between clusters
 /*   for (const rect of buildableRects) {
      for (let y = rect.y + rect.h + 1; y < rect.y + rect.h + 3; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (this.map.inBounds(x, y))
            this.map.set(x, y, { walkable: true, moveCost: 1, tag: "CORRIDOR" });
        }
      }
    }*/
  
    return spawns.slice(0, numAgents);
  }
  
}
