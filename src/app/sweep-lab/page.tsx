"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { GridMap } from "@/lib/engine/GridMap";
import type { BaseSpec, MapJSON, Tile, RectSpec } from "@/lib/engine/Types";
import {
  buildRangesFromForm,
  calculateVariationCount,
  DEFAULT_PARAMETER_RANGES,
} from "@/lib/mapgen/runtime";
import MapResultCard from "./MapResultCard";

type MapRow = {
  map: string;
  rank: number;
  score: number;
  metrics: Record<string, number>;
  params?: Record<string, unknown> | null;
  mapFile?: string;
  heatmap?: string | null;
  heatmapPath?: string;
};

type RankingResponse = {
  generatedAt?: string;
  weights?: Record<string, unknown>;
  maps: MapRow[];
};

type ProgressResponse = {
  progress: number;
  completed: number;
  total: number;
  currentMap?: string;
  startedAt?: number;
  elapsed?: number;
  eta?: number;
};

// Fixed constants (not user-configurable)
const FIXED_OUTSIDE_HEIGHT = 4;
const FIXED_HEATMAP_SCALE = 4;

// Get default worker count (will be overridden by API on server)
const DEFAULT_WORKERS = typeof navigator !== "undefined" ? Math.max(1, (navigator.hardwareConcurrency || 4) - 1) : 4;

const DEFAULT_FORM = {
  count: 32,
  runs: 1,
  minutes: 960, // 16 hours: 6am to 10pm
  seed: "ui-seed",
  rowGap: "2,3",
  barX: "14,16",
  barY: "5,6",
  gymX: "8,10",
  gymY: "4,5",
  exitWidth: "10,12",
  heatmap: true,
  resultsDir: "results",
  wFlow: 0.4,
  wWait: 0.3,
  wCluster: 0.2,
  wExit: 0.1,
  // Parallel execution
  parallel: true,
  workers: DEFAULT_WORKERS,
  // Top-K filtering (only save top K maps to reduce file I/O)
  topK: 10,
};

export default function SweepLabPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressInfo, setProgressInfo] = useState<ProgressResponse | null>(null);
  const [runLog, setRunLog] = useState<string>("");
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [loadingRank, setLoadingRank] = useState(false);
  const [showHeatmaps, setShowHeatmaps] = useState(true);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.7);
  const [mapOpacity, setMapOpacity] = useState(0.8);
  const [showMap, setShowMap] = useState(true);
  const [mapPreviews, setMapPreviews] = useState<Record<string, string>>({});
  const [showInfo, setShowInfo] = useState(false);

  // Calculate variation count from current form parameters
  const variationInfo = useMemo(() => {
    const ranges = buildRangesFromForm({
      rowGap: form.rowGap,
      barX: form.barX,
      barY: form.barY,
      gymX: form.gymX,
      gymY: form.gymY,
      exitWidth: form.exitWidth,
    });
    const total = calculateVariationCount(ranges);
    const mapsToGenerate = Math.min(total, form.count);
    // 2 scenarios (weekday + weekend) * runs per map * 1 agent config (max capacity)
    const totalSimulations = mapsToGenerate * 2 * Math.max(1, form.runs);

    return { total, mapsToGenerate, totalSimulations, ranges, agentVariants: 1 };
  }, [form.rowGap, form.barX, form.barY, form.gymX, form.gymY, form.exitWidth, form.count, form.runs]);

  const weightsText = useMemo(() => {
    if (!ranking?.weights) return "";
    return Object.entries(ranking.weights)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
  }, [ranking]);

  const fetchRanking = async () => {
    setLoadingRank(true);
    try {
      const res = await fetch("/api/sweep/ranking?top=10", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as RankingResponse;
      setRanking(json);
    } catch (err) {
      setRunLog(prev => `${prev}\nFailed to load ranking: ${String(err)}`);
    } finally {
      setLoadingRank(false);
    }
  };

  useEffect(() => {
    fetchRanking().catch(() => { });
  }, []);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const handleRun = async () => {
    setRunning(true);
    setProgress(0);
    setProgressInfo(null);
    setRunLog("Starting sweep...\n");

    const totalExpected = variationInfo.totalSimulations;

    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/sweep/progress?expected=${totalExpected}&results=${encodeURIComponent(form.resultsDir ?? "results")}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json() as ProgressResponse;
          setProgressInfo(data);
          const pct = Math.round((data.progress || 0) * 100);
          setProgress(Math.min(99, pct)); // Cap at 99% until complete

          // Update log with progress
          if (data.currentMap) {
            setRunLog(prev => {
              const lines = prev.split("\n");
              const lastLine = lines[lines.length - 1];
              if (lastLine.startsWith("Processing:")) {
                lines[lines.length - 1] = `Processing: ${data.currentMap} (${data.completed}/${data.total})`;
              } else {
                lines.push(`Processing: ${data.currentMap} (${data.completed}/${data.total})`);
              }
              return lines.join("\n");
            });
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    try {
      const res = await fetch("/api/sweep/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.message || "Sweep failed");
      }
      setRunLog((prev) => `${prev}\n✓ Sweep completed successfully!`);
      setProgress(100);
      setProgressInfo(null);
      await fetchRanking();
    } catch (err) {
      setRunLog((prev) => `${prev}\n✗ Error: ${String(err)}`);
    } finally {
      clearInterval(pollTimer);
      setRunning(false);
      setTimeout(() => {
        setProgress(0);
        setProgressInfo(null);
      }, 2000);
    }
  };

  const mapLink = (mapFile?: string) => {
    if (!mapFile) return undefined;
    return `/api/sweep/map?path=${encodeURIComponent(mapFile)}`;
  };

  const handleCleanup = async () => {
    if (!confirm("Are you sure you want to delete all results and generated maps?")) return;
    try {
      const res = await fetch("/api/sweep/cleanup", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        setRunLog(prev => `${prev}\n✓ Cleanup successful: ${json.message}`);
        setRanking(null);
        setProgressInfo(null);
      } else {
        throw new Error(json.error || "Cleanup failed");
      }
    } catch (err) {
      setRunLog(prev => `${prev}\n✗ Error: ${String(err)}`);
    }
  };

  // Map preview effect removed as we now use dynamic CanvasRenderer in MapResultCard

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Simulation Lab</p>
            <h1 className="text-3xl font-bold">Sweep & Rank Maps</h1>
            <p className="text-slate-400 max-w-3xl">
              Generate thousands of layout variants, run headless sims, and inspect the top-ranked maps with heatmaps and metrics.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowInfo(s => !s)}
              className="px-3 py-2 rounded bg-white/10 border border-white/20 hover:bg-white/20 text-sm"
            >
              {showInfo ? "Hide info" : "Info"}
            </button>
            <Link href="/" className="px-3 py-2 rounded bg-white/10 border border-white/20 hover:bg-white/20 text-sm">
              ← Back to sim
            </Link>
            <Link href="/map-editor" className="px-3 py-2 rounded bg-blue-500 text-white text-sm shadow">
              Open map editor
            </Link>
          </div>
        </div>

        {showInfo && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-200 space-y-2">
            <p className="font-semibold text-slate-100">What affects runtime?</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Map count × runs per map: doubles with more seeds (weekday+weekend are both simulated).</li>
              <li>Agent count: higher populations slow pathfinding and density tracking.</li>
              <li>Heatmaps: rendering and larger heatmap scale (e.g., 4×) increases PNG write time/size.</li>
              <li>Map size/complexity: bigger grids and denser corridors add pathfinding work.</li>
            </ul>
            <p className="text-slate-400">Tip: start small (few maps, low heatmap scale) to iterate, then scale up.</p>
          </div>
        )}

        <div className="grid md:grid-cols-5 gap-6">
          <section className="md:col-span-2 bg-white/5 border border-white/10 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Run a sweep</h2>
              <button
                className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                onClick={() => setForm(DEFAULT_FORM)}
                disabled={running}
              >
                Reset defaults
              </button>
            </div>

            {/* Variation count display */}
            <div className="mb-3 p-3 rounded-lg bg-slate-800/50 border border-white/10">
              <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                <div>
                  <span className="text-slate-400">Possible layouts: </span>
                  <span className="font-mono text-emerald-400">{variationInfo.total.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-400">Maps to generate: </span>
                  <span className="font-mono text-blue-400">{variationInfo.mapsToGenerate}</span>
                </div>
                <div>
                  <span className="text-slate-400">Agent variants: </span>
                  <span className="font-mono text-purple-400">{variationInfo.agentVariants}</span>
                </div>
                <div>
                  <span className="text-slate-400">Total simulations: </span>
                  <span className="font-mono text-amber-400">{variationInfo.totalSimulations.toLocaleString()}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {variationInfo.mapsToGenerate} maps × 2 scenarios × {form.runs} run(s) × {variationInfo.agentVariants} agent count(s) = {variationInfo.totalSimulations.toLocaleString()} simulations
              </p>
            </div>

            {running && (
              <div className="mb-3 p-3 rounded-lg bg-slate-800/80 border border-emerald-500/30">
                <div className="flex items-center justify-between text-sm text-slate-200 mb-2">
                  <span className="font-medium">
                    {progressInfo?.currentMap ? `Processing: ${progressInfo.currentMap}` : "Starting..."}
                  </span>
                  <span className="font-mono">{progress.toFixed(0)}%</span>
                </div>
                <div className="h-3 rounded bg-white/10 overflow-hidden mb-2">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {progressInfo?.completed ?? 0} / {progressInfo?.total ?? variationInfo.totalSimulations} completed
                  </span>
                  {progressInfo?.eta !== undefined && progressInfo.eta > 0 && (
                    <span>ETA: ~{formatTime(progressInfo.eta)}</span>
                  )}
                  {progressInfo?.elapsed !== undefined && progressInfo.elapsed > 0 && (
                    <span>Elapsed: {formatTime(progressInfo.elapsed)}</span>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Label text="Max maps" hint={`Limit maps to generate (max ${variationInfo.total} possible).`}>
                <input
                  type="number"
                  min={1}
                  max={variationInfo.total}
                  value={form.count}
                  onChange={(e) => setForm({ ...form, count: Math.min(Number(e.target.value), variationInfo.total) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Runs per scenario" hint="How many seeds to simulate per scenario to smooth randomness.">
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.runs}
                  onChange={(e) => setForm({ ...form, runs: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              {/* Agents input removed - auto-calculated */}
              <Label text="Sim minutes" hint="In-game minutes to run per seed (e.g., 720 = half-day).">
                <input
                  type="number"
                  min={1}
                  value={form.minutes}
                  onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Seed" hint="Base RNG seed for reproducible sweeps.">
                <input
                  type="text"
                  value={form.seed}
                  onChange={(e) => setForm({ ...form, seed: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Exit width" hint="CSV of exit corridor widths (e.g., 10,12); influences evacuation speed.">
                <input
                  type="text"
                  value={form.exitWidth}
                  onChange={(e) => setForm({ ...form, exitWidth: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Door corridor gap" hint="CSV of corridor thicknesses between dorm rows (e.g., 2,3).">
                <input
                  type="text"
                  value={form.rowGap ?? ""}
                  onChange={(e) => setForm({ ...form, rowGap: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Bar Widths" hint="CSV of X dimensions for bar area (e.g., 14,16,18).">
                <input
                  type="text"
                  value={form.barX}
                  onChange={(e) => setForm({ ...form, barX: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Bar Heights" hint="CSV of Y dimensions for bar area (e.g., 5,6,7).">
                <input
                  type="text"
                  value={form.barY}
                  onChange={(e) => setForm({ ...form, barY: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Gym Widths" hint="CSV of X dimensions for gym area (e.g., 8,10,12).">
                <input
                  type="text"
                  value={form.gymX}
                  onChange={(e) => setForm({ ...form, gymX: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Gym Heights" hint="CSV of Y dimensions for gym area (e.g., 4,5,6).">
                <input
                  type="text"
                  value={form.gymY}
                  onChange={(e) => setForm({ ...form, gymY: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Weights: flow / wait" hint="Ranking weight for path length and stuck/queue penalties.">
                <div className="flex gap-2">
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    value={form.wFlow}
                    onChange={(e) => setForm({ ...form, wFlow: Number(e.target.value) })}
                    className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
                  />
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    value={form.wWait}
                    onChange={(e) => setForm({ ...form, wWait: Number(e.target.value) })}
                    className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
                  />
                </div>
              </Label>
              <Label text="Weights: cluster / exit" hint="Ranking weight for congestion and exit reachability.">
                <div className="flex gap-2">
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    value={form.wCluster}
                    onChange={(e) => setForm({ ...form, wCluster: Number(e.target.value) })}
                    className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
                  />
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    value={form.wExit}
                    onChange={(e) => setForm({ ...form, wExit: Number(e.target.value) })}
                    className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
                  />
                </div>
              </Label>
              <Label text="Parallel workers" hint="Number of CPU cores to use for parallel simulation. More workers = faster but uses more RAM (~100MB each).">
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={form.workers}
                  onChange={(e) => setForm({ ...form, workers: Math.max(1, Number(e.target.value)) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
                />
              </Label>
              <Label text="Top-K results" hint="Only save the top K maps to reduce file I/O. Set to 0 to save all.">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.topK}
                  onChange={(e) => setForm({ ...form, topK: Math.max(0, Number(e.target.value)) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
                />
              </Label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.parallel}
                    onChange={(e) => setForm({ ...form, parallel: e.target.checked })}
                  />
                  <span className="text-slate-300">Parallel execution</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.heatmap}
                    onChange={(e) => setForm({ ...form, heatmap: e.target.checked })}
                  />
                  <span className="text-slate-300">Render heatmaps</span>
                </label>
              </div>
            </div>

            {/* Performance estimate */}
            <div className="mt-3 p-2 rounded bg-slate-800/50 border border-white/10 text-xs text-slate-400">
              <span className="font-medium text-slate-300">Estimated time: </span>
              {form.parallel ? (
                <span>
                  ~{Math.ceil(variationInfo.totalSimulations * 3 / form.workers / 60)} minutes with {form.workers} workers
                  {form.workers < DEFAULT_WORKERS && <span className="text-amber-400"> (increase workers for faster execution)</span>}
                </span>
              ) : (
                <span className="text-amber-400">
                  ~{Math.ceil(variationInfo.totalSimulations * 3 / 60)} minutes (sequential - enable parallel for {Math.ceil(variationInfo.totalSimulations * 3 / DEFAULT_WORKERS / 60)}min)
                </span>
              )}
              <span className="block mt-1">
                RAM usage: ~{form.parallel ? form.workers * 100 : 100}MB
                {variationInfo.totalSimulations > 500 && <span className="text-amber-400"> • Large sweep - consider running overnight</span>}
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRun}
                disabled={running}
                className="px-3 py-2 rounded bg-emerald-500 text-white font-semibold shadow disabled:opacity-50"
              >
                {running ? "Running…" : "Run sweep"}
              </button>
              <button
                onClick={fetchRanking}
                className="px-3 py-2 rounded bg-white/10 border border-white/10 hover:bg-white/20 text-sm"
                disabled={loadingRank}
              >
                {loadingRank ? "Refreshing…" : "Refresh ranking"}
              </button>
              <button
                onClick={handleCleanup}
                className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-200 text-sm"
              >
                Cleanup
              </button>
            </div>
            <div className="mt-3">
              <p className="text-xs text-slate-400">
                Note: very large runs (e.g. 10,000 maps) will take time. Keep this tab open while it processes; the bar is approximate—check the log below for live output.
              </p>
            </div>
          </section>

          <section className="md:col-span-3 bg-white/5 border border-white/10 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">Top maps</h2>
                <p className="text-xs text-slate-400">
                  {ranking?.generatedAt ? `Last analyzed: ${new Date(ranking.generatedAt).toLocaleString()}` : "Load a ranking to view results."}
                  {weightsText ? ` · Weights ${weightsText}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <LegendSwatch color="#fde68a" label="Bar" />
                  <LegendSwatch color="#a7f3d0" label="Gym" />
                  <LegendSwatch color="#dbeafe" label="Corridor" />
                  <LegendSwatch color="#e0e7ff" label="Room" />
                  <LegendSwatch color="#fca5a5" label="Exit" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={showHeatmaps} onChange={(e) => setShowHeatmaps(e.target.checked)} />
                  Show heatmaps
                  {showHeatmaps && (
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={heatmapOpacity}
                      onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                      className="w-24"
                      title="Heatmap opacity"
                    />
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} />
                  Show map
                  {showMap && (
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={mapOpacity}
                      onChange={(e) => setMapOpacity(Number(e.target.value))}
                      className="w-24"
                      title="Map opacity"
                    />
                  )}
                </label>
              </div>
            </div>

            <div className="space-y-3">
              {ranking?.maps?.length ? ranking.maps.map((m) => (
                <MapResultCard
                  key={m.map}
                  m={m}
                  showHeatmaps={showHeatmaps}
                  showMap={showMap}
                  mapOpacity={mapOpacity}
                  heatmapOpacity={heatmapOpacity}
                  mapLink={mapLink}
                />
              )) : (
                <p className="text-sm text-slate-400">No ranking loaded yet. Run a sweep or refresh.</p>
              )}
            </div>
          </section>
        </div>

        <section className="bg-black/40 border border-white/10 rounded-xl p-4 shadow-inner">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Run log</h2>
            <button
              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              onClick={() => setRunLog("")}
            >
              Clear
            </button>
          </div>
          <pre className="text-xs bg-black/50 border border-white/5 rounded p-3 h-56 overflow-auto whitespace-pre-wrap">{runLog || "Logs will appear here after running a sweep."}</pre>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  if (value === undefined || value === null || Number.isNaN(value)) return (
    <div className="flex flex-col">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-500">—</span>
    </div>
  );
  return (
    <div className="flex flex-col">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-100">{value.toFixed(3)}</span>
    </div>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-slate-300 flex items-center gap-1">
        {text}
      </span>
      {hint && (
        <span className="text-[11px] text-slate-500 leading-snug">{hint}</span>
      )}
      {children}
    </label>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm border border-white/30" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}

async function renderMapPreview(url: string): Promise<string | undefined> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Failed to load map ${url}`);
  const json = await res.json() as MapJSON;
  if (!json) return undefined;

  let map = json;
  if (!map.tiles || !map.tiles.length) {
    if (!map.spec) return undefined;
    const gm = GridMap.buildFromSpec({ width: json.width, height: json.height }, map.spec as BaseSpec);
    map = gm.toJSON();
  }

  const { width, height, tiles } = map;
  // Use scale 4-6 for better detail, matching heatmap scale
  const scale = Math.max(4, Math.min(600 / width, 600 / height, 6));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  const colorOf = (t: Tile): string => {
    if (!t.walkable) return "#0b1021";
    switch (t.tag) {
      case "BAR": return "#fde68a";
      case "GYM": return "#a7f3d0";
      case "CORRIDOR": return "#dbeafe";
      case "ROOM": return "#e0e7ff";
      case "DOOR": return "#fef08a";
      case "OUTSIDE": return "#bbf7d0";
      case "EXIT": return "#fb7185";
      case "ROAD": return "#cbd5e1";
      default: return "#f8fafc";
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y * width + x];
      ctx.fillStyle = colorOf(tile);
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  if (map.spec) {
    const labels: Array<{ text: string; rect: RectSpec }> = [
      { text: "BAR", rect: map.spec.barRect as RectSpec },
      { text: "GYM", rect: map.spec.gymRect as RectSpec },
      { text: "EXIT", rect: map.spec.exitRect as RectSpec },
      { text: "OUTSIDE", rect: map.spec.outsideRect as RectSpec },
    ];
    ctx.fillStyle = "#0f172a";
    ctx.font = `${Math.max(10, 12 * scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    labels.forEach(l => {
      if (!l.rect) return;
      const cx = (l.rect.x + l.rect.w / 2) * scale;
      const cy = (l.rect.y + l.rect.h / 2) * scale;
      ctx.strokeStyle = "white";
      ctx.lineWidth = Math.max(1, scale / 2);
      ctx.strokeText(l.text, cx, cy);
      ctx.fillText(l.text, cx, cy);
    });
  }

  return canvas.toDataURL("image/png");
}
