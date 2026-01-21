"use client";

import React, { useEffect, useRef } from "react";
import { useSimStore } from "@/lib/state/useSimStore";
import { Engine } from "@/lib/engine/Engine";
import { GridMap } from "@/lib/engine/GridMap";
import { AGENT_TYPES } from "@/lib/engine/Agent";
import { getAgentColor } from "./utils";
import type { MetricsMap, SimSpeed } from "@/lib/engine/Types";
import { calculateLiveScore } from "@/lib/scoring";
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

  const calculateRoomsPath = (): number => {
    const eng = engineRef.current;
    const metrics: MetricsMap = {};

    eng?.pathsMetrics.forEach((pm) => {
      if (!metrics[pm.room!]) metrics[pm.room!] = { totalLength: 0, count: 0 };
      metrics[pm.room!].totalLength += pm.length;
      metrics[pm.room!].count += 1;
    });

    let totalLength = 0;;
    let totalCount = 0;

    Object.values(metrics).forEach((rm) => {
      totalLength += rm.totalLength;
      totalCount += rm.count;
    });

    return totalLength / (totalCount || 1);
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
    const roomsPath = calculateRoomsPath();
    const corridorCongestion = calculateCorridorCongestion();
    const maxOccupancy = calculateMaxOccupancy();
    console.log({ roomsPath, corridorCongestion, maxOccupancy });
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
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/90 p-3 rounded-xl border border-slate-200 shadow-sm relative z-50">

        {/* Left: Transport & Speed */}
        <div className="flex items-center gap-3">
          {/* Playback */}
          <div className="flex items-center gap-1 bg-slate-100/50 rounded-lg p-1 border border-slate-200">
            <button
              className={`w-16 py-1.5 rounded-md transition font-bold text-xs flex items-center justify-center gap-1 ${!paused ? "bg-white text-emerald-600 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              onClick={() => setPaused(false)}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              PLAY
            </button>
            <button
              className={`w-16 py-1.5 rounded-md transition font-bold text-xs flex items-center justify-center gap-1 ${paused ? "bg-white text-rose-500 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              onClick={() => setPaused(true)}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              PAUSE
            </button>
          </div>

          <button className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition text-xs font-semibold shadow-sm h-full" onClick={handleStep}>
            Step
          </button>

          <div className="w-px h-8 bg-slate-200 mx-1"></div>

          {/* Speed Slider */}
          <div className="flex flex-col justify-center bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200 min-w-[200px]">
            <div className="flex justify-between w-64 text-[9px] text-slate-400 font-mono uppercase tracking-wider mb-1">
              <span>Speed</span>
              <span className="text-slate-800 font-bold">{speed}×</span>
            </div>
            <input
              type="range"
              min="0"
              max={SPEED_OPTIONS.length - 1}
              step="1"
              value={SPEED_OPTIONS.indexOf(speed)}
              onChange={(e) => setSpeed(SPEED_OPTIONS[Number(e.target.value)])}
              className="w-64 accent-emerald-500 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
              list="speed-options"
            />
            <div className="flex justify-between w-64 text-[8px] text-slate-400 font-mono mt-1 select-none">
              {SPEED_OPTIONS.map((s) => (
                <span key={s} className="cursor-pointer hover:text-emerald-600 w-3 text-center" onClick={() => setSpeed(s)}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Sim State */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center px-4 border-r border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">TPS</span>
            <span className="text-lg font-mono font-bold text-slate-700 leading-none">{tps.toFixed(0)}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-400 font-medium">Agents</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={1} max={9999} value={agentCount}
                  onChange={(e) => setAgentCount(Number(e.target.value))}
                  className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs text-right shadow-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <button className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition text-[10px] font-bold uppercase tracking-wide" onClick={() => bumpRestart()}>
                  Set
                </button>
              </div>
            </div>
            <span className="text-xs text-slate-400">/ {useSimStore.getState().capacity}</span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition text-xs font-bold uppercase shadow-sm flex items-center gap-1"
            onClick={() => engineRef.current?.triggerEmergency()}
            title="Trigger Emergency Evacuation"
          >
            ⚠️ Evacuate
          </button>

          <div className="w-px h-8 bg-slate-200 mx-2"></div>

          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
            <button
              className={`px-3 py-1.5 rounded-md border transition text-xs font-semibold ${showMapParams ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-transparent text-slate-500 hover:text-slate-700"}`}
              onClick={() => setShowMapParams(v => !v)}
            >
              Config
            </button>
            <button
              className={`px-3 py-1.5 rounded-md border transition text-xs font-semibold ${showScore ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-transparent text-slate-500 hover:text-slate-700"}`}
              onClick={() => setShowScore(v => !v)}
            >
              Scores
            </button>
            <button className="px-3 py-1.5 rounded-md border border-transparent hover:bg-white hover:border-slate-200 text-slate-500 hover:text-slate-700 transition text-xs font-semibold" onClick={() => {
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
                <span className={`text-4xl font-black ${liveScore.total >= 80 ? "text-emerald-500" : liveScore.total >= 50 ? "text-amber-500" : "text-rose-500"}`}>
                  {Number(liveScore.total).toFixed(0)}
                </span>
              </div>

              <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-4">
                {engineRef.current?.emergencyMode ? (
                  <ScoreCard
                    label="Evacuation"
                    val={liveScore.emergencyEfficiency}
                    sub="Emergency Efficiency"
                    color="bg-rose-500"
                  />
                ) : (
                  <>
                    <ScoreCard
                      label="Capacity"
                      val={liveScore.capacity}
                      sub="Occupancy vs Capacity"
                      color="bg-blue-500"
                    />
                    <ScoreCard
                      label="Room Usage"
                      val={liveScore.utilization}
                      sub="Room Occupancy vs Capacity"
                      color="bg-cyan-500"
                    />
                    <ScoreCard
                      label="Congestion"
                      val={liveScore.congestion}
                      sub="Congestion"
                      color="bg-amber-500"
                    />
                    <ScoreCard
                      label="Path Efficiency"
                      val={liveScore.path}
                      sub="Avg. Path Overhead"
                      color="bg-indigo-500"
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
        <div className="w-full grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 bg-slate-50 border border-slate-200 rounded p-2 z-40 relative shadow-lg">
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Row Gap
            <input
              type="number"
              min={1}
              max={4}
              value={mapParams.dormRowGap}
              onChange={e => setMapParams({ dormRowGap: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Gap between stacked room rows. Max 4 to prevent room loss."
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Bar W×H
            <div className="flex gap-1">
              <input
                type="number"
                min={4}
                max={24}
                value={mapParams.barWidth}
                onChange={e => setMapParams({ barWidth: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              />
              <input
                type="number"
                min={4}
                max={16}
                value={mapParams.barHeight}
                onChange={e => setMapParams({ barHeight: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              />
            </div>
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Gym W×H
            <div className="flex gap-1">
              <input
                type="number"
                min={4}
                max={20}
                value={mapParams.gymWidth}
                onChange={e => setMapParams({ gymWidth: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              />
              <input
                type="number"
                min={4}
                max={12}
                value={mapParams.gymHeight}
                onChange={e => setMapParams({ gymHeight: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              />
            </div>
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Exit Width
            <input
              type="number"
              min={4}
              max={20}
              value={mapParams.exitWidth}
              onChange={e => setMapParams({ exitWidth: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Corridor Width
            <input
              type="number"
              min={2}
              max={12}
              value={mapParams.corridorWidth}
              onChange={e => setMapParams({ corridorWidth: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Main vertical corridor width. Max 12."
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Bands
            <input
              type="number"
              min={0}
              max={8}
              value={mapParams.bandCount}
              onChange={e => setMapParams({ bandCount: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Number of vertical bands (0 = auto-fill)."
            />
          </label>
        </div>
      )}

      {/* Helper Tools */}
      <div className="flex items-center gap-2 justify-end text-xs text-slate-500 px-3">
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

function ScoreCard({ label, val, sub, color, title }: { label: string, val: number, sub: string, color: string, title?: string }) {
  const safeVal = val ?? 0;
  const w = Math.min(100, Math.max(0, safeVal));
  return (
    <div className="flex flex-col gap-1 min-w-[120px]" title={title}>
      <div className="flex justify-between items-baseline">
        <span className="text-sm font-bold text-slate-700">{label}</span>
        <span className="text-sm font-mono font-medium text-slate-500">{safeVal.toFixed(0)}</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${w}%` }}></div>
      </div>
      <span className="text-[10px] text-slate-400">{sub}</span>
    </div>
  )
}
