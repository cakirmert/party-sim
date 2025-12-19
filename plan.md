# Sweep Improvements Plan

## Summary
This plan captures the intended changes to sweep handling, scoring weights, agent selection, and map parameters so we can resume later.

## Key Goals
- Update score weighting to prioritize capacity, POI utilization, corridor congestion, and path wait time.
- Add an exit/evacuation scenario to the sweep scoring.
- Always simulate with maximum room capacity (no agent-count selection).
- Expand bar/gym sizing to width/height ranges and parameterize their placement.
- Remove explicit seed parameter from sweep UI/API (random seed by default).

## Weighting & Metrics (Target Behavior)
- Capacity (room count / max agents): 40% of score.
  - Target: ~150 agents yields 100% for this component (worth 40 points).
- Bar + Gym utilization: 25% of score.
  - Need metric for “good utilization” without congestion (see open questions).
- Hallway congestion: 15% of score.
- Path wait / travel time to desired locations: 20% of score.
- Exit scenario: 5% of total score.
  - Measured during evacuation phase (everyone exits); exclude path-length from this phase.
  - This is additive to congestion; confirm final weighting math.

## Open Questions / Decisions Needed
- How to compute bar/gym utilization:
  - Occupancy ratio vs. free tiles around agents vs. wait time to enter?
  - Threshold values (e.g., >= 2 free tiles around agents, or max wait < X)?
- Exit scenario duration and scoring:
  - How many minutes/ticks?
  - Is exit score separate 5% or folded into congestion weight?
- Capacity scoring curve:
  - Linear drop-off from 150, or target band (e.g., 140–160)?

## Planned Code Changes

### 1) Parameter Ranges & Map Generation
- Update `src/lib/mapgen/runtime.ts`:
  - Expand ParameterRanges to allow bar/gym width and height ranges separately.
  - Add bar/gym placement parameter ranges (side and yOffset already exist; may add X offset or position bands).
  - Ensure expandParameterRanges produces Cartesian product for bar/gym width+height.
- Update `scripts/generate-maps.ts`:
  - Adjust CLI/form parsing to accept width/height ranges instead of fixed WxH list.
  - Remove seed from user input; default to random UUID for each sweep.
- Update defaults if needed:
  - `DEFAULT_PARAMETER_RANGES` and `DEFAULT_RUNTIME_PARAMS` to reflect new sizing/placement ranges.

### 2) Simulation Pipeline (Sweep)
- Update `scripts/run-batch.ts`:
  - Always simulate using maximum room capacity (no explicit agent count).
  - Add exit/evacuation scenario:
    - Add a new scenario type (e.g., "evacuation") or run a short exit phase per map.
    - Track congestion during exit; ignore path-length during this phase.
  - Add new metrics for:
    - Capacity (room count / max agents)
    - Exit congestion (evacuation-specific corridor density or exit throughput)
    - Bar/gym utilization metric (pending definition)
- Update `scripts/sweep-maps.ts`:
  - Remove agent count CSV handling; run a single max-capacity simulation per map.
  - Remove seeds parameter from CLI and use random seeds per run by default.

### 3) Scoring & Analysis
- Update `scripts/analyze-results.ts`:
  - Replace weight config with new categories:
    - capacity (40%), utilization (25%), corridor congestion (15%), path wait (20%), exit (5%)
  - Incorporate new metrics into scoring:
    - Capacity score (target ~150).
    - Utilization score (bar+gym).
    - Congestion score (corridor density).
    - Path wait score (avg path length or wait time).
    - Exit score (evacuation congestion/success).

### 4) UI & API
- Update `src/app/sweep-lab/page.tsx`:
  - Remove agent count input (always max capacity).
  - Remove seed input (random seeds).
  - Update weights UI to reflect new categories.
  - Update helper text/variation count to match new parameters.
- Update `src/app/api/sweep/run/route.ts`:
  - Remove `agents` and `seed` from request handling.
  - Pass updated weights and parameter ranges.

### 5) Sim UI Defaults
- Consider whether in-sim controls (agent count) should also be locked to max capacity.
  - Yes, update `src/components/UIControls.tsx`, `src/lib/state/useSimStore.ts`, and `src/components/CanvasRenderer.tsx`.

## Suggested Implementation Order
1) Update parameter ranges + generation (runtime.ts + generate-maps.ts).
2) Update sweep pipeline to max capacity + exit scenario metrics.
3) Update analysis scoring with new weights/metrics.
4) Update sweep UI/API to remove agent/seed and expose new weights.
5) Align in-sim UI with max-capacity-only behavior.
