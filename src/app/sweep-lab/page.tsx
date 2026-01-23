"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { GridMap } from "@/lib/engine/GridMap";
import type { BaseSpec, MapJSON, Tile, RectSpec } from "@/lib/engine/Types";
import {
  buildRangesFromForm,
  calculateVariationCount,
} from "@/lib/mapgen/runtime";
import MapResultCard from "./MapResultCard";
import { FormLabel, FormInput } from "@/components/FormElements";

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



// Get default worker count (will be overridden by API on server)
const DEFAULT_WORKERS = typeof navigator !== "undefined" ? Math.max(1, (navigator.hardwareConcurrency || 4) - 1) : 4;

const DEFAULT_FORM = {
  count: 194, // Matches screenshot max for "all"
  runs: 1,
  minutes: 1200, // 20 hours: 6am to 2am
  agents: "150",
  seed: "ui-seed",
  rowGap: "2,3,4",
  corridor: "2,3",
  barX: "6,10,14,18",
  barY: "6,10,14",
  gymX: "6,10,14,18",
  gymY: "6,10,14",
  exitWidth: "10,12",
  heatmap: true,
  resultsDir: "results",
  wCapacity: 0.40,
  wUtil: 0.20,
  wCongestion: 0.25,
  wPath: 0.15,
  wEvacuation: 0,
  wWait: 0,
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
  const [_progressInfo, setProgressInfo] = useState<ProgressResponse | null>(null);
  const [runLog, setRunLog] = useState<string>("");
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [loadingRank, setLoadingRank] = useState(false);
  const [showHeatmaps, setShowHeatmaps] = useState(true);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.7);
  const [mapOpacity, setMapOpacity] = useState(0.8);
  const [showMap, setShowMap] = useState(true);


  // Calculate variation count from current form parameters
  const variationInfo = useMemo(() => {
    // Helper to normalize input: Replace dots with commas to support "6.10.14" format
    const clean = (s: string) => s.replace(/\./g, ",");

    // We must pass the fully dynamic set of parameters to get the true count
    const ranges = buildRangesFromForm({
      rowGap: clean(form.rowGap),
      corridor: clean(form.corridor),
      barX: clean(form.barX),
      barY: clean(form.barY),
      gymX: clean(form.gymX),
      gymY: clean(form.gymY),
      exitWidth: clean(form.exitWidth),
    });
    const total = calculateVariationCount(ranges);
    const mapsToGenerate = Math.min(total, form.count);
    // 2 scenarios (weekday + weekend) * runs per map * 1 agent config (max capacity)
    const totalSimulations = mapsToGenerate * 2 * Math.max(1, form.runs);

    return { total, mapsToGenerate, totalSimulations, ranges, agentVariants: 1 };
  }, [form.rowGap, form.barX, form.barY, form.gymX, form.gymY, form.exitWidth, form.count, form.runs]);

  const weightsText = useMemo(() => {
    if (!ranking?.weights?.weights) return "";
    const w = ranking.weights.weights as Record<string, number>;
    return Object.entries(w)
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
      .join(" · ");
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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black font-sans selection:bg-emerald-500/30">
      <div className="max-w-[1600px] mx-auto px-4 py-8 flex flex-col gap-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/5 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                Sweep Lab
              </h1>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl">
              Procedurally generate map variants, simulate agent crowds, and analyze performance metrics to find the optimal venue layout.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/" className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm font-medium transition-colors flex items-center gap-2">
              <svg className="w-4 h-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Back to Sim
            </Link>
            <Link href="/map-editor" className="px-4 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 text-indigo-300 text-sm font-medium transition-colors flex items-center gap-2">
              <svg className="w-4 h-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Map Editor
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Left Column: Configuration */}
          <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-6">

            {/* Main Config Card */}
            <section className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5 shadow-xl ring-1 ring-white/5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <span className="w-1.5 h-4 rounded-full bg-emerald-500"></span>
                  Configuration
                </h2>
                <button onClick={() => setForm(DEFAULT_FORM)} disabled={running} className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 hover:text-emerald-400 disabled:opacity-50 transition-colors">
                  Reset
                </button>
              </div>

              <div className="space-y-4">
                {/* Primary Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <FormLabel text="Map Variations" hint={`Max unique layouts: ${variationInfo.total}`}>
                    <div className="relative">
                      <FormInput type="number" min={1} max={variationInfo.total} value={form.count}
                        onChange={(e) => setForm({ ...form, count: Math.min(Number(e.target.value), variationInfo.total) })}
                      />
                      <div className="absolute right-0 top-0 bottom-0 flex items-center px-3 pointer-events-none text-xs text-slate-500">
                        / {variationInfo.total}
                      </div>
                    </div>
                  </FormLabel>
                  <FormLabel text="Runs / Map" hint="Seeds per map">
                    <FormInput type="number" min={1} max={5} value={form.runs}
                      onChange={(e) => setForm({ ...form, runs: Number(e.target.value) })}
                    />
                  </FormLabel>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormLabel text="Sim Duration" hint="Minutes (1200 = 20h)">
                    <FormInput type="number" min={60} value={form.minutes}
                      onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
                    />
                  </FormLabel>
                  <FormLabel text="Agent Capacity" hint="Auto-filled to max potential">
                    <FormInput type="text" value="Max (Auto)" disabled onChange={() => { }} />
                  </FormLabel>
                </div>

                <div className="pt-4 border-t border-white/5 space-y-4">
                  <div className="pt-4 border-t border-white/5 space-y-4">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Map Parameters</h3>

                    <div className="grid grid-cols-2 gap-3">
                      <FormLabel text="Corridor Width" hint="Tiles (e.g. 2,3)">
                        <FormInput type="text" value={form.corridor}
                          onChange={(e) => setForm({ ...form, corridor: e.target.value })}
                          placeholder="2,3"
                          className="font-mono"
                        />
                      </FormLabel>
                      <FormLabel text="Dorm Row Gap" hint="Vertical spacing">
                        <FormInput type="text" value={form.rowGap}
                          onChange={(e) => setForm({ ...form, rowGap: e.target.value })}
                          placeholder="2,3,4"
                          className="font-mono"
                        />
                      </FormLabel>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormLabel text="Exit Width" hint="Spawn/Despawn zone">
                        <FormInput type="text" value={form.exitWidth}
                          onChange={(e) => setForm({ ...form, exitWidth: e.target.value })}
                          placeholder="10,12"
                          className="font-mono"
                        />
                      </FormLabel>
                      <FormLabel text="Concurrency" hint="Parallel Workers">
                        <FormInput type="number" min={1} max={32} value={form.workers}
                          onChange={(e) => setForm({ ...form, workers: Math.max(1, Number(e.target.value)) })}
                        />
                      </FormLabel>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <FormLabel text="Bar Dimensions (CSV)" hint="Widths, Heights (e.g. 14,16)">
                        <div className="grid grid-cols-2 gap-2">
                          <FormInput placeholder="Widths" value={form.barX} onChange={e => setForm({ ...form, barX: e.target.value })} />
                          <FormInput placeholder="Heights" value={form.barY} onChange={e => setForm({ ...form, barY: e.target.value })} />
                        </div>
                      </FormLabel>
                      <FormLabel text="Gym Dimensions (CSV)" hint="Widths, Heights">
                        <div className="grid grid-cols-2 gap-2">
                          <FormInput placeholder="Widths" value={form.gymX} onChange={e => setForm({ ...form, gymX: e.target.value })} />
                          <FormInput placeholder="Heights" value={form.gymY} onChange={e => setForm({ ...form, gymY: e.target.value })} />
                        </div>
                      </FormLabel>
                    </div>
                  </div>

                  {/* Weight Controls - Read Only */}
                  <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3">Scoring Weights (Fixed)</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {[
                        { l: "Capacity", v: form.wCapacity }, { l: "Utilization", v: form.wUtil },
                        { l: "Congestion", v: form.wCongestion }, { l: "Path Eff.", v: form.wPath },
                      ].map((item) => (
                        <div key={item.l} className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">{item.l}</span>
                          <span className="font-mono text-slate-200 bg-white/5 px-1.5 rounded">{item.v.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Summary Footer */}
                  <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded-lg p-3 border border-white/5 space-y-1">
                    <div className="flex justify-between"><span>Generating:</span> <span className="text-white">{variationInfo.mapsToGenerate} maps</span></div>
                    <div className="flex justify-between"><span>Total Sims:</span> <span className="text-emerald-400">{variationInfo.totalSimulations.toLocaleString()}</span></div>
                    <div className="flex justify-between border-t border-white/5 pt-1 mt-1"><span>Est Time:</span> <span>~{Math.ceil(variationInfo.totalSimulations * 3 / form.workers / 60)}m</span></div>
                  </div>

                  <button
                    onClick={handleRun}
                    disabled={running}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold shadow-lg shadow-emerald-900/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                  >
                    {running ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Run Sweep
                      </>
                    )}
                  </button>

                  {/* Progress Bar */}
                  {running && (
                    <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  )}

                </div>
              </div>
            </section>

            <section className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4 text-xs text-slate-400">
              <h3 className="text-slate-200 font-semibold mb-2">Scoring Methodology</h3>
              <p className="mb-2">
                Scores are normalized on a <strong>Z-Score Bell Curve</strong> (0-100) relative to the current batch.
              </p>
              <ul className="list-disc pl-4 space-y-1 opacity-80">
                <li><strong>Capacity:</strong> Higher = Better (Target ~150)</li>
                <li><strong>Congestion:</strong> Lower density clusters = Better</li>
                <li><strong>Wait Times:</strong> Lower bar/gym queues = Better</li>
              </ul>
            </section>

            <section className="bg-black/40 border border-white/10 rounded-xl p-4 font-mono text-xs h-48 overflow-y-auto">
              <div className="flex justify-between items-center mb-2 sticky top-0 bg-black/80 p-1 -mx-1 -mt-1 backdrop-blur-sm rounded">
                <span className="font-semibold text-slate-300">Run Log</span>
                <button onClick={() => setRunLog("")} className="text-slate-500 hover:text-white transition-colors">Clear</button>
              </div>
              <div className="whitespace-pre-wrap text-slate-400 font-mono leading-relaxed">
                {runLog || "Ready to run."}
              </div>
            </section>

          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col h-full min-h-[500px]">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl ring-1 ring-white/5 flex-1 flex flex-col">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 border-b border-white/5 pb-4">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="w-1.5 h-5 rounded-full bg-blue-500"></span>
                    Top Ranked Maps
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {ranking?.generatedAt
                      ? `Analysis from ${new Date(ranking.generatedAt).toLocaleTimeString()}`
                      : "No results yet. Run a sweep to generate maps."}
                  </p>
                  {weightsText && <p className="text-[10px] text-slate-500 mt-1 font-mono">{weightsText}</p>}
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={handleCleanup} className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors border border-red-500/10">
                    Cleanup
                  </button>
                  <button onClick={fetchRanking} disabled={loadingRank} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium transition-colors border border-white/10">
                    {loadingRank ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              {/* Legend & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-black/20 p-3 rounded-lg border border-white/5">
                <div className="flex items-center gap-3 text-xs">
                  <LegendSwatch color="#fde68a" label="Bar" />
                  <LegendSwatch color="#a7f3d0" label="Gym" />
                  <LegendSwatch color="#dbeafe" label="Corridor" />
                  <LegendSwatch color="#fb7185" label="Exit" />
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={showHeatmaps} onChange={e => setShowHeatmaps(e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-emerald-500 focus:ring-emerald-500/30" />
                    <span className="text-slate-300">Heatmaps</span>
                  </label>
                  {showHeatmaps && (
                    <input type="range" min={0.1} max={1} step={0.1} value={heatmapOpacity} onChange={e => setHeatmapOpacity(Number(e.target.value))} className="w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                  )}
                  <div className="w-px h-4 bg-white/10"></div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={showMap} onChange={e => setShowMap(e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500/30" />
                    <span className="text-slate-300">Layout</span>
                  </label>
                  {showMap && (
                    <input type="range" min={0.1} max={1} step={0.1} value={mapOpacity} onChange={e => setMapOpacity(Number(e.target.value))} className="w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar min-h-[400px]">
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
                  <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-white/5 rounded-xl">
                    <svg className="w-10 h-10 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-1.447-.894L15 7m0 13V7m0 0L9 4" /></svg>
                    <p>No results generated yet.</p>
                    <p className="text-xs mt-1">Configure the simulation on the left and click &quot;Run Sweep&quot;</p>
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      </div>
    </main>
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


