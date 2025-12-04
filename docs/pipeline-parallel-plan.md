# Procedural map sweep pipeline (parallel-friendly tasks)

## Goals
- Produce many map variants programmatically.
- Simulate weekday/weekend scenarios for each map while sweeping tunable layout params.
- Collect metrics and heatmaps, then rank maps for usability so we can pick the best layout.

## Independent task breakdown
These tasks are designed to be implemented in any order and are parameter-first so we can test layouts without waiting on other pieces.

### 1) Procedural BaseSpec generator
- Create a script (e.g., `scripts/generate-maps.ts`) that emits `BaseSpec` JSON files to `public/maps/generated/` from parameter inputs or ranges (corridor widths, door counts, spawn densities, table spacing, obstacle density).
- Include metadata (seed, params) inside each saved file for traceability so later stages can report which knobs produced which results.
- Provide a CLI that accepts either explicit parameter sets or a JSON/CSV input so it can run standalone and be swept by other tools (e.g., `--params ranges.json`, `--seed 42`).

### 2) Headless batch simulation runner
- Build a script (e.g., `scripts/run-batch.ts`) that loads any set of map files and runs weekday/weekend simulations without assuming how they were generated.
- Accept CLI args for the map glob/path list, agent count, seeds, and output directory so it is decoupled. Allow multiple runs per map to smooth variance (`--runs 5 --seeds 1,2,3`).
- Save outputs (metrics and density grids/heatmaps) under a chosen results directory keyed by map and day type (e.g., `results/<map>/<day>/run-<seed>.json` plus `.png` heatmaps).

### 3) Result analysis and ranking
- Implement `scripts/analyze-results.ts` that only consumes batch outputs (metrics + density grids) and produces rankings plus heatmap images/PNGs.
- Accept a results directory path as input; do not assume how the files were produced. Provide CLI flags for scoring weights (`--w-flow 0.4 --w-wait 0.3 --w-cluster 0.3`) so usability criteria can be tuned.
- Emit summary JSON/CSV with the ranked list (best→worst) and an optional HTML report linking heatmaps and parameter metadata. Include per-map diagnostics: average travel time, queue wait time, congestion score (e.g., >N agents per cell), deadlock frequency, exit reachability, and spillover time.

### 4) Sweep orchestration (optional glue)
- Add an npm script (e.g., `npm run sweep-maps`) that chains generation → simulation → analysis, but each step is invoked via its own CLI.
- Because each script is independently runnable, the orchestrator is thin and can be added after the other parts are done.

## How we find the best layout
- Sweep parameters: feed the generator explicit ranges or CSVs to cover corridor widths, door counts/locations, seating density, obstacle placement, and spawn profiles.
- Run multiple seeds per layout: average metrics to reduce randomness; preserve per-seed outputs for debugging.
- Rank for usability: combine flow efficiency (avg travel time), fairness (variance in wait times), safety (max density hot-spots), and robustness (deadlock frequency). Weightings are CLI-tunable so we can iterate quickly.
- Visual cues: export heatmaps for occupancy and queue length; add pathline visualizations or GIFs if easy.
- Traceability: every ranked row links back to the parameter set and heatmap so the “best map” is defensible.

## CLI usage (implemented)
- Generate variants: `npm run generate-maps -- --count 8 --seed demo` (writes to `public/maps/generated`). Use `--corridor 8,12 --bandHeight 8,10` or `--params myVariants.json` to drive sweeps.
- Run headless sims: `npm run run-batch -- --agents 80 --minutes 1440 --seeds a,b,c` (reads generated maps, writes `results/<map>/<scenario>/run-<seed>.json` + `__heatmap.png`).
- Analyze and rank: `npm run analyze-results -- --results results --w-flow 0.4 --w-wait 0.3 --w-cluster 0.3` (emits `results/analysis/{ranking.json,csv,report.html}` with heatmap links).
- One-shot sweep: `npm run sweep-maps -- --count 8 --runs 3 --agents 80` (generate → batch sim → analysis). Pass `--skip-generate` to reuse existing map variants.

## Hardest task to highlight
- Designing and validating the usability scoring (analysis/ranking) is the hardest piece. It requires defining meaningful metrics, normalizing them across runs, picking weights, and proving that rankings reflect real-world usability. This also needs iteration with real sims/heatmaps to tune thresholds and catch false positives.

## Parallelization notes
- Each script only depends on stable interfaces: `BaseSpec` typing, `GridMap.buildFromSpec`, and the batch-output file formats you define.
- Agree on simple file naming conventions (e.g., `<mapName>__weekday.json`) so the analyzer can parse results regardless of who produced them.
- Use seedable RNG for repeatability, but expose the seed as a CLI flag so others can run their own sweeps without coordination.
