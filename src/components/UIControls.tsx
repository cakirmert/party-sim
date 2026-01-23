"use client";

import React, { useEffect, useRef } from "react";
import { useSimStore } from "@/lib/state/useSimStore";
import { Engine } from "@/lib/engine/Engine";
import { GridMap } from "@/lib/engine/GridMap";
import { AGENT_TYPES } from "@/lib/engine/Agent";
import { getAgentColor } from "./utils";
import type { MetricsMap, SimSpeed } from "@/lib/engine/Types";
import { calculateLiveScore, ScoringMetrics, ScoreBreakdown } from "@/lib/scoring";
import { FormLabel, FormInput, SectionHeader, FormGrid } from "./FormElements";

import { ScoreInfo } from "@/components/ScoreInfo";

const SPEED_OPTIONS: SimSpeed[] = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

type Props = { engineRef: React.MutableRefObject<Engine | null> };

export default function UIControls({ engineRef }: Props) {
  const speed = useSimStore(s => s.speed);
  const paused = useSimStore(s => s.paused);
  const setSpeed = useSimStore(s => s.setSpeed);
  const setPaused = useSimStore(s => s.setPaused);

  const agentCount = useSimStore(s => s.agentCount);
  const maxAgents = useSimStore(s => s.maxAgents);
  const setAgentCount = useSimStore(s => s.setAgentCount);
  const bumpReset = useSimStore(s => s.bumpReset);
  const bumpRestart = useSimStore(s => s.bumpRestart);
  const mapParams = useSimStore(s => s.mapParams);
  const setMapParams = useSimStore(s => s.setMapParams);
  const [showMapParams, setShowMapParams] = React.useState(false);

  const setSelectedAgentId = useSimStore(s => s.setSelectedAgentId);
  const setToast = useSimStore(s => s.setToast);

  const fileRef = useRef<HTMLInputElement>(null);
  const calculateMetricsRef = useRef<() => void>(() => { });

  const handleStep = () => {
    const eng = engineRef.current;
    if (!eng) return;
    setPaused(true);
    eng.stepOnce();
  };

  const tps = useSimStore(s => s.tps);
  const [showScore, setShowScore] = React.useState(true);

  const calculatePathEfficiency = (): number => {
    const eng = engineRef.current;
    if (!eng?.pathsMetrics.length) return 100; // Default if no paths yet

    let totalEff = 0;
    eng.pathsMetrics.forEach(pm => {
      totalEff += pm.efficiency;
    });

    return totalEff / eng.pathsMetrics.length;
  };

  const calculateCorridorCongestion = (): number => {
    const eng = engineRef.current;
    const densities = eng?.corridorDensityValues;
    let densitiesAverage = 0;

    densities?.forEach((d) => {
      densitiesAverage += d;
    })

    densitiesAverage /= densities?.length || 1;

    const numberOfTiles = eng?.corridorBoundingBoxes?.reduce((acc, box) => acc + (box.tiles || 0), 0) || 1;

    return densitiesAverage / (numberOfTiles);
  };

  const calculateMaxOccupancy = () => {
    const eng = engineRef.current;

    const barRatio = eng?.maxBarOccupancy.map((occ) => {
      return occ / (eng.barBoundingBox?.tiles || 1);
    });

    const gymRatio = eng?.maxGymOccupancy.map((occ) => {
      return occ / (eng.gymBoundingBox?.tiles || 1);
    });

    return { barRatio, gymRatio };
  }

  const calculateMetrics = () => {
    const pathEfficiency = calculatePathEfficiency();
    const corridorCongestion = calculateCorridorCongestion();
    const maxOccupancy = calculateMaxOccupancy();
    console.log({ pathEfficiency, corridorCongestion, maxOccupancy });
  };

  calculateMetricsRef.current = calculateMetrics;

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let frame: number | null = null;

    const attach = () => {
      const eng = engineRef.current;

      if (!eng) {
        frame = requestAnimationFrame(attach);
        return;
      }

      unsub = eng.events.on((evt) => {
        if (evt.type === "WEEK_COMPLETED") {
          console.log("Week completed!");
          console.log("====================");
          calculateMetricsRef.current();
          console.log("====================");
          engineRef.current?.resetMetrics();
        }
      });
    };
    attach();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (unsub) unsub();
    };
  }, [engineRef]);

  const [liveScore, setLiveScore] = React.useState<any>(null);

  useEffect(() => {
    let frameId = 0;
    let tick = 0;

    const loop = () => {
      frameId = requestAnimationFrame(loop);
      tick++;
      const storeScore = useSimStore.getState().liveScore;
      if (storeScore !== liveScore) {
        setLiveScore(storeScore);
      }
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [liveScore]);

  return (
    <div className="flex flex-col gap-2">

      {/* Top Bar: Controls */}
      {/* Top Bar: Controls */}
      <div className="flex flex-col xl:flex-row items-center justify-between gap-4 bg-white/95 backdrop-blur shadow-sm p-4 rounded-2xl border border-slate-200 relative z-50">

        {/* Left: Transport & Speed */}
        <div className="flex items-center gap-4 w-full xl:w-auto justify-center xl:justify-start">

          {/* Play/Pause Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 border border-slate-200">
            <button
              className={`h-10 px-5 rounded-lg transition font-bold text-sm flex items-center justify-center gap-2 ${!paused ? "bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-200" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"}`}
              onClick={() => setPaused(false)}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              Play
            </button>
            <button
              className={`h-10 px-5 rounded-lg transition font-bold text-sm flex items-center justify-center gap-2 ${paused ? "bg-white text-amber-600 shadow-sm ring-1 ring-amber-200" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/50"}`}
              onClick={() => setPaused(true)}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              Pause
            </button>
          </div>

          <button className="h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition text-xs font-bold uppercase tracking-wider shadow-sm" onClick={handleStep}>
            Step
          </button>

          <div className="w-px h-10 bg-slate-200 mx-2 hidden sm:block"></div>

          {/* Bigger Speed Slider */}
          <div className="hidden sm:flex flex-col justify-center bg-slate-50/50 rounded-xl px-4 py-2 border border-slate-200 min-w-[240px]">
            <div className="flex justify-between w-full text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">
              <span>Simulation Speed</span>
              <span className="text-slate-800">{speed}×</span>
            </div>
            <input
              type="range"
              min="0"
              max={SPEED_OPTIONS.length - 1}
              step="1"
              value={SPEED_OPTIONS.indexOf(speed)}
              onChange={(e) => setSpeed(SPEED_OPTIONS[Number(e.target.value)])}
              className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-200 rounded-full appearance-none hover:bg-slate-300 transition-colors"
            />
            <div className="relative w-full h-3 mt-1">
              {SPEED_OPTIONS.map((opt, i) => {
                const pct = (i / (SPEED_OPTIONS.length - 1)) * 100;
                return (
                  <span
                    key={opt}
                    className={`absolute text-[9px] font-bold transform -translate-x-1/2 ${speed === opt ? "text-indigo-600" : "text-slate-300"}`}
                    style={{ left: `${pct}%` }}
                  >
                    {opt}×
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center: Sim State */}
        <div className="flex items-center gap-6 w-full xl:w-auto justify-center">
          <div className="flex flex-col items-center px-6 border-r border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Ticks/sec</span>
            <span className="text-2xl font-mono font-black text-slate-700 leading-none tracking-tight">{tps.toFixed(0)}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Agents</span>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={9999} value={agentCount}
                  onChange={(e) => setAgentCount(Number(e.target.value))}
                  className="w-16 h-8 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-sm shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <button className="h-8 px-3 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 transition text-[10px] font-bold uppercase tracking-wide" onClick={() => bumpRestart()}>
                  Set
                </button>
              </div>
              <span className="text-sm text-slate-400 font-medium">/ {useSimStore.getState().capacity}</span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 w-full xl:w-auto justify-center xl:justify-end">
          <button
            className="h-11 px-5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-2 group"
            onClick={() => engineRef.current?.triggerEmergency()}
            title="Trigger Emergency Evacuation"
          >
            <span className="group-hover:animate-pulse">⚠️</span> Evacuate
          </button>

          <div className="w-px h-10 bg-slate-200 mx-1 hidden sm:block"></div>

          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200 shadow-sm">
            <button
              className={`h-9 px-3 rounded-lg border transition text-xs font-bold uppercase tracking-wide ${showMapParams ? "bg-white border-indigo-200 text-indigo-600 shadow-sm" : "bg-transparent border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              onClick={() => setShowMapParams(v => !v)}
            >
              Config
            </button>
            <button
              className={`h-9 px-3 rounded-lg border transition text-xs font-bold uppercase tracking-wide ${showScore ? "bg-white border-emerald-200 text-emerald-600 shadow-sm" : "bg-transparent border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              onClick={() => setShowScore(v => !v)}
            >
              Scores
            </button>
            <button className="h-9 px-3 rounded-lg border border-transparent hover:bg-white hover:border-slate-200 text-slate-500 hover:text-slate-700 transition text-xs font-bold uppercase tracking-wide" onClick={() => {
              bumpReset();
            }}>
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Live Score Panel (Light Theme) */}
      {showScore && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
          {!liveScore ? (
            <div className="text-sm text-slate-500 italic py-2">Waiting for scoring data (starts at 06:00)...</div>
          ) : (
            <div className="flex flex-wrap items-stretch gap-6">
              <div className="flex flex-col justify-center pr-6 border-r border-slate-200">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Total Score</span>
                  <ScoreInfo score={liveScore} />
                </div>
                <span className={`text-4xl font-black ${(!liveScore || liveScore.total === undefined || isNaN(liveScore.total)) ? "text-slate-300" : liveScore.total >= 80 ? "text-emerald-500" : liveScore.total >= 50 ? "text-amber-500" : "text-rose-500"}`}>
                  {(!liveScore || liveScore.total === undefined || isNaN(liveScore.total)) ? "Calculating..." : Number(liveScore.total).toFixed(0)}
                </span>
              </div>

              <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-4">
                {engineRef.current?.emergencyMode ? (
                  <ScoreCard
                    label="Evacuation"
                    val={liveScore?.emergencyEfficiency}
                    sub="Emergency Efficiency"
                    color="bg-rose-500"
                  />
                ) : (
                  <>
                    <ScoreCard
                      label="Capacity"
                      val={liveScore?.capacity}
                      sub="Occupancy vs Capacity"
                      color="bg-blue-500"
                      title="Weight: 40%"
                    />
                    <ScoreCard
                      label="Room Usage"
                      val={liveScore?.utilization}
                      sub="Room Occupancy vs Capacity"
                      color="bg-cyan-500"
                      title="Weight: 20%"
                    />
                    <ScoreCard
                      label="Congestion"
                      val={liveScore?.congestion}
                      sub="Routes Density"
                      color="bg-amber-500"
                      title="Weight: 25%"
                    />
                    <ScoreCard
                      label="Path Eff."
                      val={liveScore?.path}
                      sub="Avg Proximity to POIs"
                      color="bg-indigo-500"
                      title="Weight: 15%"
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Map Params Panel */}
      {showMapParams && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
          <SectionHeader text="Map Generation Parameters" />

          <div className="space-y-6">
            {/* Primary Config */}
            <section>
              <FormGrid>
                <FormLabel text="Corridor Width" hint="Main walkway tiles">
                  <FormInput
                    type="number"
                    min={2}
                    max={12}
                    value={mapParams.corridorWidth}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ corridorWidth: Number(e.target.value) })}
                    title="Main vertical corridor width. Max 12."
                  />
                </FormLabel>
                <FormLabel text="Dorm Row Gap" hint="Vertical spacing">
                  <FormInput
                    type="number"
                    min={1}
                    max={4}
                    value={mapParams.dormRowGap}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ dormRowGap: Number(e.target.value) })}
                    title="Gap between stacked room rows. Max 4 to prevent room loss."
                  />
                </FormLabel>
                <FormLabel text="Exit Width" hint="Total exit span">
                  <FormInput
                    type="number"
                    min={4}
                    max={20}
                    value={mapParams.exitWidth}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ exitWidth: Number(e.target.value) })}
                  />
                </FormLabel>
                <FormLabel text="Bands" hint="Vertical sections (0=auto)">
                  <FormInput
                    type="number"
                    min={0}
                    max={8}
                    value={mapParams.bandCount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ bandCount: Number(e.target.value) })}
                    title="Number of vertical bands (0 = auto-fill)."
                  />
                </FormLabel>
              </FormGrid>
            </section>

            {/* POI Dimensions */}
            <section className="pt-4 border-t border-white/5">
              <FormGrid>
                <FormLabel text="Bar Dimensions" hint="Width × Height">
                  <div className="flex gap-2">
                    <FormInput
                      type="number"
                      min={4}
                      max={24}
                      value={mapParams.barWidth}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ barWidth: Number(e.target.value) })}
                      placeholder="W"
                    />
                    <FormInput
                      type="number"
                      min={4}
                      max={16}
                      value={mapParams.barHeight}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ barHeight: Number(e.target.value) })}
                      placeholder="H"
                    />
                  </div>
                </FormLabel>
                <FormLabel text="Gym Dimensions" hint="Width × Height">
                  <div className="flex gap-2">
                    <FormInput
                      type="number"
                      min={4}
                      max={20}
                      value={mapParams.gymWidth}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ gymWidth: Number(e.target.value) })}
                      placeholder="W"
                    />
                    <FormInput
                      type="number"
                      min={4}
                      max={12}
                      value={mapParams.gymHeight}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMapParams({ gymHeight: Number(e.target.value) })}
                      placeholder="H"
                    />
                  </div>
                </FormLabel>
              </FormGrid>
            </section>
          </div>
        </div>
      )}

      {/* Helper Tools */}
      <div className="flex items-center gap-2 justify-end text-xs text-slate-500  rounded-lg px-3 py-1.5 ">
        <button className="hover:text-slate-800 underline" onClick={() => {
          const eng = engineRef.current;
          if (eng) {
            const json = eng.map.toJSON();
            const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "map.json"; a.click();
            URL.revokeObjectURL(url);
          }
        }}>Save Map JSON</button>
        <span>|</span>
        <button className="hover:text-slate-800 underline" onClick={() => fileRef.current?.click()}>Load Map JSON</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const txt = await file.text();
              const json = JSON.parse(txt);
              if (!json || !json.width || !json.height || !json.tiles) throw new Error("Expected MapJSON with tiles");
              const eng = engineRef.current!;
              eng.dispatch({ type: "MAP_LOAD_JSON", map: json });
              setToast("Map loaded.");
            } catch (error: unknown) {
              console.error(error);
              setToast("Failed to load map.json (must include tiles).");
            }
          }} />
      </div>
    </div>
  );
}

function ScoreCard({ label, val, sub, color, title }: { label: string; val: number | undefined | null; sub: string; color: string; title?: string }) {
  const isLoading = val === undefined || val === null || isNaN(val);
  const safeVal = (val === undefined || val === null || isNaN(val)) ? 0 : val;
  const w = Math.min(100, Math.max(0, safeVal));
  return (
    <div className="flex flex-col gap-1 min-w-[120px]" title={title}>
      <div className="flex justify-between items-baseline">
        <span className="text-sm font-bold text-slate-700">{label}</span>
        <span className="text-[10px] font-mono font-medium text-slate-500 animate-pulse">
          {isLoading ? "Calculating..." : safeVal.toFixed(0)}
        </span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
        <div className={`h-full rounded-full transition-all duration-500 ${isLoading ? "bg-slate-200" : color}`} style={{ width: `${w}%` }}></div>
      </div>
      <span className="text-[10px] text-slate-400">{sub}</span>
    </div>
  );
}

