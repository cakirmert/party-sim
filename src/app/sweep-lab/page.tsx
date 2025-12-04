"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type MapRow = {
  map: string;
  rank: number;
  score: number;
  metrics: Record<string, number>;
  params?: Record<string, unknown> | null;
  mapFile?: string;
  heatmap?: string | null;
};

type RankingResponse = {
  generatedAt?: string;
  weights?: Record<string, unknown>;
  maps: MapRow[];
};

const DEFAULT_FORM = {
  count: 12,
  runs: 2,
  agents: 80,
  minutes: 720,
  seed: "ui-seed",
  corridor: "8,10,12",
  bandHeight: "8,10,12",
  bandCount: "3",
  barSize: "14x5,16x6",
  gymSize: "8x5,10x6",
  exitWidth: "8,10",
  outside: "3,4",
  heatmap: true,
};

export default function SweepLabPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string>("");
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [loadingRank, setLoadingRank] = useState(false);
  const [showHeatmaps, setShowHeatmaps] = useState(true);

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
    setRunLog("Running sweep from UI...\n");
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
      await fetchRanking();
    } catch (err) {
      setRunLog((prev) => `${prev}\n${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const mapLink = (mapFile?: string) => {
    if (!mapFile) return null;
    const normalized = mapFile.replace(/\\/g, "/");
    if (normalized.startsWith("public/")) {
      return `/${normalized.slice("public/".length)}`;
    }
    return null;
  };

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
            <Link href="/" className="px-3 py-2 rounded bg-white/10 border border-white/20 hover:bg-white/20 text-sm">
              ← Back to sim
            </Link>
            <Link href="/map-editor" className="px-3 py-2 rounded bg-blue-500 text-white text-sm shadow">
              Open map editor
            </Link>
          </div>
        </div>

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
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Map count</span>
                <input
                  type="number"
                  min={1}
                  value={form.count}
                  onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Runs/seed</span>
                <input
                  type="number"
                  min={1}
                  value={form.runs}
                  onChange={(e) => setForm({ ...form, runs: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Agents</span>
                <input
                  type="number"
                  min={1}
                  value={form.agents}
                  onChange={(e) => setForm({ ...form, agents: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Sim minutes</span>
                <input
                  type="number"
                  min={1}
                  value={form.minutes}
                  onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-slate-300">Seed</span>
                <input
                  type="text"
                  value={form.seed}
                  onChange={(e) => setForm({ ...form, seed: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-slate-300">Corridor widths (csv)</span>
                <input
                  type="text"
                  value={form.corridor}
                  onChange={(e) => setForm({ ...form, corridor: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-slate-300">Band heights (csv)</span>
                <input
                  type="text"
                  value={form.bandHeight}
                  onChange={(e) => setForm({ ...form, bandHeight: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Band count</span>
                <input
                  type="text"
                  value={form.bandCount}
                  onChange={(e) => setForm({ ...form, bandCount: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Exit width</span>
                <input
                  type="text"
                  value={form.exitWidth}
                  onChange={(e) => setForm({ ...form, exitWidth: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Outside height</span>
                <input
                  type="text"
                  value={form.outside}
                  onChange={(e) => setForm({ ...form, outside: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Bar sizes (e.g. 14x5,16x6)</span>
                <input
                  type="text"
                  value={form.barSize}
                  onChange={(e) => setForm({ ...form, barSize: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-300">Gym sizes (e.g. 8x5,10x6)</span>
                <input
                  type="text"
                  value={form.gymSize}
                  onChange={(e) => setForm({ ...form, gymSize: e.target.value })}
                  className="bg-slate-900 border border-white/10 rounded px-2 py-1"
                />
              </label>
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
              <p className="text-xs text-slate-400">Note: very large runs (e.g. 10,000 maps) will take time. Keep this tab open while it processes.</p>
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
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showHeatmaps} onChange={(e) => setShowHeatmaps(e.target.checked)} />
                Show heatmaps
              </label>
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
                  </div>
                  <div className="grid md:grid-cols-4 gap-2 text-xs text-slate-300">
                    <Metric label="Path" value={m.metrics?.avgPathLength} />
                    <Metric label="Peak corridor" value={m.metrics?.corridorPeakDensity} />
                    <Metric label="Stuck rate" value={m.metrics?.stuckRate} />
                    <Metric label="Exit ok" value={m.metrics?.exitSuccess} />
                  </div>
                  {m.params && (
                    <details className="text-xs text-slate-400">
                      <summary className="cursor-pointer text-slate-200">Params</summary>
                      <pre className="mt-1 bg-slate-900/70 border border-white/10 rounded p-2 overflow-auto max-h-40">{JSON.stringify(m.params, null, 2)}</pre>
                    </details>
                  )}
                  {showHeatmaps && m.heatmap && (
                    <div className="mt-1 rounded overflow-hidden border border-white/10 bg-black/30">
                      <img src={m.heatmap} alt={`${m.map} heatmap`} className="w-full object-contain" />
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
