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
  minutes: 1200, // 20 hours: 6am to 2am
  seed: "ui-seed",
  rowGap: "2,3",
  barX: "14,16",
  barY: "5,6",
  gymX: "8,10",
  gymY: "4,5",
  exitWidth: "10,12",
  heatmap: true,
  resultsDir: "results",
  wCapacity: 0.35,
  wUtil: 0.20,
  wCongestion: 0.15,
  wPath: 0.10,
  wEvacuation: 0.15,
  wWait: 0.05,
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
                  <Label text="Map Variations" hint="Max unique layouts">
                    <input type="number" min={1} max={variationInfo.total} value={form.count}
                      onChange={(e) => setForm({ ...form, count: Math.min(Number(e.target.value), variationInfo.total) })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                    />
                  </Label>
                  <Label text="Runs / Map" hint="Seeds per map">
                    <input type="number" min={1} max={5} value={form.runs}
                      onChange={(e) => setForm({ ...form, runs: Number(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                    />
                  </Label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Label text="Sim Duration" hint="Minutes (1260 = 21h)">
                    <input type="number" min={60} value={form.minutes}
                      onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                    />
                  </Label>
                  <Label text="Concurrency" hint="Threads">
                    <input type="number" min={1} max={32} value={form.workers}
                      onChange={(e) => setForm({ ...form, workers: Math.max(1, Number(e.target.value)) })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                    />
                  </Label>
                </div>

                <Label text="Base Seed" hint="Random seed">
                  <input type="text" value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-slate-300 focus:border-emerald-500/50 outline-none transition-all"
                  />
                </Label>

                {/* Advanced Map Params Collapsible */}
                <details className="group bg-black/20 rounded-lg border border-white/5 open:bg-black/40 transition-colors">
                  <summary className="cursor-pointer p-3 text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-slate-300 flex items-center justify-between select-none">
                    Map Generation Params
                    <svg className="w-4 h-4 transition-transform group-open:rotate-180 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <div className="p-3 pt-0 grid gap-3 text-xs">
                    <Label text="Bar Dimensions (CSV)" hint="Widths, Heights (e.g. 14,16)">
                      <div className="grid grid-cols-2 gap-2">
                        <input placeholder="Widths" value={form.barX} onChange={e => setForm({ ...form, barX: e.target.value })} className="bg-black/50 border border-white/10 rounded px-2 py-1.5" />
                        <input placeholder="Heights" value={form.barY} onChange={e => setForm({ ...form, barY: e.target.value })} className="bg-black/50 border border-white/10 rounded px-2 py-1.5" />
                      </div>
                    </Label>
                    <Label text="Gym Dimensions (CSV)" hint="Widths, Heights">
                      <div className="grid grid-cols-2 gap-2">
                        <input placeholder="Widths" value={form.gymX} onChange={e => setForm({ ...form, gymX: e.target.value })} className="bg-black/50 border border-white/10 rounded px-2 py-1.5" />
                        <input placeholder="Heights" value={form.gymY} onChange={e => setForm({ ...form, gymY: e.target.value })} className="bg-black/50 border border-white/10 rounded px-2 py-1.5" />
                      </div>
                    </Label>
                    <Label text="Layout" hint="Row gaps, Exit widths">
                      <div className="grid grid-cols-2 gap-2">
                        <input placeholder="Gap (2,3)" value={form.rowGap} onChange={e => setForm({ ...form, rowGap: e.target.value })} className="bg-black/50 border border-white/10 rounded px-2 py-1.5" />
                        <input placeholder="Exit (10,12)" value={form.exitWidth} onChange={e => setForm({ ...form, exitWidth: e.target.value })} className="bg-black/50 border border-white/10 rounded px-2 py-1.5" />
                      </div>
                    </Label>
                  </div>
                </details>

                {/* Weight Controls */}
                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3">Scoring Weights</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { l: "Cap", k: "wCapacity" }, { l: "Util", k: "wUtil" }, { l: "Cong", k: "wCongestion" },
                      { l: "Path", k: "wPath" }, { l: "Evac", k: "wEvacuation" }, { l: "Wait", k: "wWait" }
                    ].map((item) => (
                      <div key={item.k} className="flex flex-col gap-1">
                        <span className="text-[9px] text-slate-500 uppercase">{item.l}</span>
                        <input type="number" step={0.05} value={(form as any)[item.k]}
                          onChange={e => setForm({ ...form, [item.k]: Number(e.target.value) })}
                          className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-1 text-xs text-center focus:border-blue-500/50 outline-none"
                        />
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
                    <p className="text-xs mt-1">Configure the simulation on the left and click "Run Sweep"</p>
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
