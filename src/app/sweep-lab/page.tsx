"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { GridMap } from "@/lib/engine/GridMap";
import type { BaseSpec, MapJSON, Tile, RectSpec } from "@/lib/engine/Types";

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

const DEFAULT_FORM = {
  count: 8,
  runs: 2,
  agents: 80,
  minutes: 720,
  seed: "ui-seed",
  corridor: "2,3",
  bandHeight: "12",
  bandCount: "0,4",
  rowGap: "2,3",
  barSize: "14x5,16x6,18x7",
  gymSize: "8x4,10x5,12x6",
  exitWidth: "10,12",
  outside: "4",
  heatmap: true,
  resultsDir: "results",
  heatmapScale: 3,
  wFlow: 0.4,
  wWait: 0.3,
  wCluster: 0.2,
  wExit: 0.1,
};

export default function SweepLabPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runLog, setRunLog] = useState<string>("");
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [loadingRank, setLoadingRank] = useState(false);
  const [showHeatmaps, setShowHeatmaps] = useState(true);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.7);
  const [mapOpacity, setMapOpacity] = useState(0.8);
  const [showMap, setShowMap] = useState(true);
  const [mapPreviews, setMapPreviews] = useState<Record<string, string>>({});
  const [showInfo, setShowInfo] = useState(false);

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
    fetchRanking().catch(() => {});
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setProgress(5);
    setRunLog("Running sweep from UI...\n");
    const progressTimer = setInterval(() => {
      setProgress((p) => Math.min(p + 2, 98));
    }, 1200);
    const expectedRuns = Math.max(1, Number(form.count) * Number(form.runs || 1) * 2);
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/sweep/progress?expected=${expectedRuns}&results=${encodeURIComponent(form.resultsDir ?? "results")}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const pct = Math.round((data.progress || 0) * 100);
          setProgress((prev) => Math.max(prev, Math.min(100, pct)));
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
      setRunLog((prev) => `${prev}${json.stdout || ""}${json.stderr || ""}`);
      setProgress(100);
      await fetchRanking();
    } catch (err) {
      setRunLog((prev) => `${prev}\n${String(err)}`);
    } finally {
      clearInterval(progressTimer);
      clearInterval(pollTimer);
      setRunning(false);
      setTimeout(() => setProgress(0), 800);
    }
  };

  const mapLink = (mapFile?: string) => {
    if (!mapFile) return null;
    return `/api/sweep/map?path=${encodeURIComponent(mapFile)}`;
  };

  useEffect(() => {
    const loadPreviews = async () => {
      if (!ranking?.maps?.length) return;
      const entries = await Promise.all(ranking.maps.map(async (m) => {
        const href = mapLink(m.mapFile);
        if (!href || mapPreviews[m.map]) return [m.map, mapPreviews[m.map]] as const;
        try {
          const preview = await renderMapPreview(href);
          return [m.map, preview] as const;
        } catch {
          return [m.map, undefined] as const;
        }
      }));
      const next: Record<string, string> = {};
      for (const [key, val] of entries) {
        if (val) next[key] = val;
      }
      if (Object.keys(next).length) setMapPreviews((prev) => ({ ...prev, ...next }));
    };
    loadPreviews().catch(() => {});
  }, [ranking]);

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
            {running && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Running… (progress is approximate for long sweeps)</span>
                  <span>{progress.toFixed(0)}%</span>
                </div>
                <div className="h-2 rounded bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Label text="Map count" hint="How many map variants to generate for this run.">
                <input
                  type="number"
                  min={1}
                  value={form.count}
                  onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Runs per map" hint="How many seeds to simulate per map to smooth randomness.">
                <input
                  type="number"
                  min={1}
                  value={form.runs}
                  onChange={(e) => setForm({ ...form, runs: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Agents" hint="Target agent population in the sim.">
                <input
                  type="number"
                  min={1}
                  value={form.agents}
                  onChange={(e) => setForm({ ...form, agents: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
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
              <Label text="Corridor widths" hint="CSV of hallway widths; affects flow capacity.">
                <input
                  type="text"
                  value={form.corridor}
                  onChange={(e) => setForm({ ...form, corridor: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Band heights" hint="CSV of dorm band heights; controls room rows.">
                <input
                  type="text"
                  value={form.bandHeight}
                  onChange={(e) => setForm({ ...form, bandHeight: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Band count" hint="How many stacked dorm bands to place around the spine.">
                <input
                  type="text"
                  value={form.bandCount}
                  onChange={(e) => setForm({ ...form, bandCount: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Exit width" hint="Exit corridor width; influences evacuation speed.">
                <input
                  type="text"
                  value={form.exitWidth}
                  onChange={(e) => setForm({ ...form, exitWidth: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Door corridor" hint="Thickness of the corridor row that doors open into (UI Reset uses this).">
                <input
                  type="text"
                  value={form.rowGap ?? ""}
                  onChange={(e) => setForm({ ...form, rowGap: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Outside height" hint="Depth of outside/road buffer.">
                <input
                  type="text"
                  value={form.outside}
                  onChange={(e) => setForm({ ...form, outside: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Bar sizes" hint="CSV of WxH for bar area (e.g., 14x5,16x6).">
                <input
                  type="text"
                  value={form.barSize}
                  onChange={(e) => setForm({ ...form, barSize: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Gym sizes" hint="CSV of WxH for gym area (e.g., 8x5,10x6).">
                <input
                  type="text"
                  value={form.gymSize}
                  onChange={(e) => setForm({ ...form, gymSize: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </Label>
              <Label text="Heatmap scale" hint="Pixel scale for saved heatmaps (higher = sharper/larger PNG).">
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={form.heatmapScale}
                  onChange={(e) => setForm({ ...form, heatmapScale: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1 w-20"
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
              <label className="flex items-center gap-2 col-span-2">
                <input
                  type="checkbox"
                  checked={form.heatmap}
                  onChange={(e) => setForm({ ...form, heatmap: e.target.checked })}
                />
                <span className="text-slate-300">Render heatmaps</span>
              </label>
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
                <div key={m.map} className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-1 rounded bg-white/10 text-xs">#{m.rank}</span>
                      <div>
                        <p className="font-semibold text-lg">{m.map}</p>
                        <p className="text-xs text-slate-400">Score {m.score.toFixed(3)}</p>
                      </div>
                    </div>
                    {mapLink(m.mapFile) && (
                      <a
                        href={mapLink(m.mapFile) ?? "#"}
                        className="text-xs text-blue-300 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        View map JSON
                      </a>
                    )}
                    {mapLink(m.mapFile) && (
                      <a
                        href={`/?map=${encodeURIComponent(mapLink(m.mapFile)!)}`}
                        className="text-xs text-emerald-300 hover:underline ml-3"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            window.localStorage.setItem("simMapPath", mapLink(m.mapFile)!);
                          }
                        }}
                      >
                        Watch in sim
                      </a>
                    )}
                  </div>
                  <div className="grid md:grid-cols-4 gap-2 text-xs text-slate-300">
                    <Metric label="Path" value={m.metrics?.avgPathLength} />
                    <Metric label="Peak corridor" value={m.metrics?.corridorPeakDensity} />
                    <Metric label="Mean corridor" value={m.metrics?.corridorMeanDensity} />
                    <Metric label="Exit ok" value={m.metrics?.exitSuccess} />
                  </div>
                  <div className="grid md:grid-cols-4 gap-2 text-xs text-slate-300">
                    <Metric label="Stuck rate" value={m.metrics?.stuckRate} />
                    <Metric label="Bar occ" value={m.metrics?.barOccupancyRatio} />
                    <Metric label="Gym occ" value={m.metrics?.gymOccupancyRatio} />
                    <Metric label="Mean occ" value={m.metrics?.meanOccupancy} />
                  </div>
                  {m.params && (
                    <details className="text-xs text-slate-400">
                      <summary className="cursor-pointer text-slate-200">Params</summary>
                      <pre className="mt-1 bg-slate-900/70 border border-white/10 rounded p-2 overflow-auto max-h-40">{JSON.stringify(m.params, null, 2)}</pre>
                    </details>
                  )}
                  {(showHeatmaps || showMap) && m.heatmap && (
                    <div className="mt-1 rounded overflow-hidden border border-white/10 bg-black/30 relative">
                      {showMap && mapPreviews[m.map] && (
                        <img
                          src={mapPreviews[m.map]}
                          alt={`${m.map} map`}
                          className="w-full object-contain"
                          style={{ imageRendering: "pixelated" as React.CSSProperties["imageRendering"], opacity: mapOpacity }}
                        />
                      )}
                      {showHeatmaps && (
                        <img
                          src={m.heatmap}
                          alt={`${m.map} heatmap`}
                          className="w-full object-contain mix-blend-screen absolute inset-0"
                          style={{ opacity: heatmapOpacity }}
                        />
                      )}
                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-black/20" />
                      {m.heatmapPath && (
                        <a
                          href={`/api/sweep/ranking/heatmap?path=${encodeURIComponent(m.heatmapPath)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute bottom-2 right-2 text-[11px] text-blue-200 bg-black/50 px-2 py-1 rounded border border-white/10"
                        >
                          Open heatmap
                        </a>
                      )}
                    </div>
                  )}
                </div>
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
  const scale = Math.min(480 / width, 480 / height, 4);
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
