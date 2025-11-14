# Party Simulation (Next.js + TypeScript)
A deterministic, grid-based simulation with an engine-first architecture (fixed-step clock, seeded RNG, 8-directional A*), a canvas renderer with zoom/pan, a map editor for **BUILDABLE** tiles, a room generator that lays out **LOCKED** dorm rooms per agent, and lightweight agent behaviours (wander, off-map trips via EXIT). Designed for emergent group dynamics: simple local rules → interesting crowd patterns.

---

## Quick Start

```bash
npm i
npm run dev
# open http://localhost:3000


Controls

Space / MMB + drag: pan

Mouse wheel: zoom toward pointer

+ / -: zoom in/out

P: pause / play

.: step one tick (when paused)

S: toggle path visualization

Shift+Click: send the first agent to the clicked tile

Agents input + “Reset @06:00”: regenerate dorm (LOCKED), respawn N agents in rooms, reset time to 06:00

### Map Editing

- Visit `/map-editor` (or click **Open map editor** in the UI) to paint BUILDABLE tiles and assign semantic tags before exporting a JSON layout. Drag to paint rectangles; switch tools (Wall / Slow / Erase / Tag) to define structure, floor types, and areas like BAR or GYM.
- Save the JSON and load it in the main sim as needed. Runtime editing is disabled to keep play deterministic.

Project Layout
src/
  app/
    layout.tsx          # global shell
    page.tsx            # top-level UI, time readout, panels
    map-editor/page.tsx # dedicated editing workspace
  components/
    CanvasRenderer.tsx  # canvas drawing, camera controls, overlays
    UIControls.tsx      # sim controls, agent count/reset, save/load map
    AgentInspector.tsx  # paused-only single agent inspector
    OutList.tsx         # “out-of-building” table (reason + ETA)
  lib/
    engine/
      Clock.ts          # fixed-step logical clock; speed + pause
      RNG.ts            # seeded RNG (deterministic)
      TimeOfDay.ts      # in-game minutes (HH:MM)
      Camera.ts         # zoom/pan transform helpers
      Types.ts          # Vec2, Tile/Tags, EngineConfig, etc.
      GridMap.ts        # tile grid, tags, serialization, spec expansion
      Pathfinder.ts     # 8-dir A* (octile) with moveCost weighting
      Entity.ts         # base entity (id)
      Agent.ts          # square agents with front “wedge” facing
      Commands.ts       # command types (UI → engine)
      Events.ts         # observable event bus
      Engine.ts         # core simulation: ticks, agents, dorm generator, off-map
  state/
    useSimStore.ts      # Zustand store for UI state (speed, pause, etc.)
  maps/                 # reserved for future generator inputs/helpers
public/
  maps/
    base.json           # base layout spec (buildable zones + BAR/GYM/OUTSIDE/EXIT)
    rooms.schema.json   # schema for room generator options (docs)
    sample.rooms.json   # example generator input

Core Concepts
Tiles & Tags

Tile { walkable: boolean; moveCost: number; tag?: TileTag }

TileTag values:

BUILDABLE — zones that the external map builder is allowed to edit.

LOCKED footprint is not editable (ROOM, DOOR, CORRIDOR, BAR, GYM, OUTSIDE, EXIT, ROAD).

ROOM, DOOR, CORRIDOR — auto-generated dorm wing and hallways.

BAR, GYM, OUTSIDE, EXIT, ROAD — hand-defined areas from base spec.

No build cost exists in this project. moveCost strictly influences movement and A* weights (e.g., 1 = normal, 2 = slower / “sticky” floor).

Determinism

Fixed-step logic (baseTickRate, default 20/s) independent from render FPS.

Single seeded RNG governs all randomness (wander, off-map durations, reasons).

Same seed + same inputs ⇒ same sim outcome.

Time of Day

In-game minutes (0..1439), starting 06:00 (360). Each tick advances a fixed amount (default 0.5 min at 1×). Speed multipliers affect how many ticks are consumed per real-time second, not the per-tick minutes.

Pathfinding (8-dir A*)

Octile heuristic; diagonal step cost sqrt(2).

Effective weight: stepDistance * moveCost(nextTile).

Walls are walkable=false.

BUILDABLE vs LOCKED Semantics

The runtime assumes dorm rooms, corridors, and themed areas are LOCKED. BUILDABLE tiles mark spaces that the separate map builder can adjust before shipping a layout. The sim itself does not expose painting tools; regenerate dorms by changing the agent count and pressing **Reset @06:00**.

Engine Architecture

Clock
Fixed-step scheduling for simulation logic. Pausing prevents step consumption; “Step” advances a single logic tick.

Engine
Holds GridMap, agents, outList, TimeOfDay, and RNG.
Key responsibilities:

resetWorld(spec, count): build map from base spec, generate/lock dorm rooms (one per agent), spawn agents in rooms, reset time to 06:00.

advance(nowSec): consume zero or more fixed steps; emit TICK.

dispatch(cmd): process Commands (spawn, move, map edits, save/load).

Off-map trips: reaching an EXIT despawns an agent with {reason, untilMinute}, tracked in outList, later respawns at the exit.

Events & Commands
Events: TICK, AGENT_ADDED, AGENT_REPATHED, AGENT_DESPAWNED, AGENT_RESPAWNED.
Commands (UI → Engine): SET_AGENT_COUNT (handled via UI calling resetWorld with base spec), SPAWN_AGENT, MOVE_AGENT_TO, MAP_TOGGLE_WALL, MAP_SET_MOVECOST, MAP_LOAD_JSON, MAP_SAVE_REQUEST.

Room Generator
Produces a corridor band and packs 3×3 rooms with 1-tile doors. Footprints are semantically tagged (ROOM, DOOR, CORRIDOR) and treated as LOCKED by the editor. Ensures enough rooms for the requested agent count (≤100) and avoids collisions with BAR/GYM/OUTSIDE/EXIT regions.

Renderer & Camera

Canvas renders tiles, grid lines, and agents. Agents are squares with a small triangular “wedge” indicating facing.
Camera provides zoomAt(...), screenToWorld(...), worldToScreen(...), and clamps zoom to [0.5, 3]. Pan is stored as pixel offsets.

UI Overview

UIControls
Pause/Play, Step, Speed, Agent Count + Reset @06:00, Save/Load Map, Path toggle.

CanvasRenderer
Handles rendering, camera interaction, optional smooth rendering, and selection (when paused). Shift+Click orders the first agent to move.

AgentInspector (paused)
Shows id, room, position, facing, destination, path length, or off-map status.

OutList
Live table of agents off-map with reason and ETA.

Saving & Loading Maps

Save Map downloads a complete MapJSON with all tiles (useful for the offline map builder).

Load Map replaces the current map with a JSON exported from the builder. Dorm generation is still tied to **Reset @06:00**.

Performance Notes

Fixed-step logic avoids frame-rate dependence.

Avoid pathfinding every tick; only re-path on target change or if walls change in the path.

Arrays are re-used in hot loops where sensible.

Contributing

Discuss your change via an issue before a large PR.

Follow coding style:

TypeScript strictness preferred.

Keep the engine deterministic; use the single RNG instance passed via Engine.

No new libs unless discussed.

PR checklist:

npm run typecheck passes

Updated docs if you changed user-visible behavior

Kept BUILDABLE/LOCKED semantics intact

Scripts

{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}

Roadmap (high-level)

Behaviour systems: needs/jobs (hunger/thirst/study), POI capacities, queues (bar), schedules

Crowding: density maps, avoidance, lane formation

Visuals: interpolation for smooth movement (keep logic discrete), mini-map, better selection UX

Engine in a Web Worker (UI snapshots), replay logs, profiler overlay

Full state save/load (agents + time + RNG seed + map)

FAQ

Why “LOCKED” for generated rooms?
So designers focus on BUILDABLE experiment zones while the generator guarantees valid dorm layouts for N agents.

Where do I tweak speed/time?
Engine.minutesPerTick and Clock speed buttons. Keep in mind determinism.

How do I add a new agent behaviour?
Introduce state and transitions in Agent, hook an update in Engine.fixedStep, and keep all randomness via Engine.rng.

License

Choose your preferred license (e.g., MIT). Add it as LICENSE.
