"use client";

import React, { useEffect, useRef } from "react";
import { useSimStore } from "@/lib/state/useSimStore";
import { Engine } from "@/lib/engine/Engine";
import { GridMap } from "@/lib/engine/GridMap";
import { AGENT_TYPES } from "@/lib/engine/Agent";
import { getAgentColor } from "./utils";
import type { MetricsMap, SimSpeed } from "@/lib/engine/Types";
import { calculateLiveScore } from "@/lib/scoring";

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

  const simTime = useSimStore(s => s.simTime);
  const tps = useSimStore(s => s.tps);

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
      // Poll store for live score to avoid passing it via props if we want, 
      // but here we are using local state which is fine. 
      // Actually, we should sync with store liveScore if it exists.
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
      <div className="flex flex-wrap items-center gap-2 bg-white/90 p-3 rounded-lg border border-slate-200 shadow-sm relative z-50">

        {/* Time & Playback */}
        <div className="flex items-center gap-3 bg-slate-100 rounded-lg p-1.5 border border-slate-200">
          <div className="flex flex-col items-center px-1 min-w-[70px]">
            <span className="text-2xl font-bold font-mono leading-none text-slate-800">{simTime}</span>
            <span className="text-[9px] text-slate-400 font-bold tracking-wider">TPS: {tps}</span>
          </div>
          <div className="h-8 w-[1px] bg-slate-300"></div>
          <div className="flex items-center gap-1">
            <button
              className={`px-3 py-1 rounded transition font-medium ${!paused ? "bg-white text-emerald-600 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}
              onClick={() => setPaused(false)}
            >
              Play
            </button>
            <button
              className={`px-3 py-1 rounded transition font-medium ${paused ? "bg-white text-rose-600 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}
              onClick={() => setPaused(true)}
            >
              Pause
            </button>
          </div>
        </div>

        <button className="px-3 py-1.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 transition text-xs font-medium" onClick={handleStep}>
          Step
        </button>

        {/* Speed Slider */}
        <div className="ml-2 flex flex-col justify-center bg-slate-100 rounded px-3 py-1 border border-slate-200">
          <div className="flex justify-between w-48 text-[9px] text-slate-400 font-mono uppercase tracking-wider mb-0.5">
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
            className="w-48 accent-emerald-500 cursor-pointer h-1.5 bg-slate-300 rounded-lg appearance-none"
            list="speed-options"
          />
          <div className="flex justify-between w-48 text-[8px] text-slate-500 font-mono mt-1">
            {SPEED_OPTIONS.map((s) => (
              <span key={s} className="cursor-pointer hover:text-emerald-600" onClick={() => setSpeed(s)}>{s}</span>
            ))}
          </div>
        </div>

        <span className="ml-4 text-sm flex items-center gap-1">
          Agents ({agentCount}/{useSimStore.getState().capacity})
          <span className="text-xs text-slate-500 cursor-help" title="Capacity based on room count. Change value and click Apply to update.">?</span>
        </span>

        <div className="flex items-center gap-1">
          <input
            type="number" min={1} max={9999} value={agentCount}
            onChange={(e) => setAgentCount(Number(e.target.value))}
            className="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm text-right"
          />
          <button className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-200 transition text-xs font-semibold" onClick={() => bumpReset()}>
            Apply
          </button>

          <div className="w-[1px] h-6 bg-slate-300 mx-1"></div>

          <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition text-xs" onClick={() => {
            // Trigger full reset if needed, or just let user change map params to force it
            bumpReset();
          }}>
            Reset
          </button>

          <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition text-xs" onClick={() => setShowMapParams(v => !v)}>
            {showMapParams ? "Hide Params" : "Map Params"}
          </button>
        </div>

        {/* Live Score Display */}
        {liveScore && (
          <div className="ml-auto flex items-center gap-4 px-3 py-1.5 bg-slate-800 text-slate-100 rounded shadow-lg border border-slate-700">
            <div className="flex flex-col items-center leading-tight">
              <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Total Score</span>
              <span className={`text-2xl font-bold ${liveScore.total >= 80 ? "text-emerald-400" : liveScore.total >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                {Number(liveScore.total).toFixed(0)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs border-l border-slate-600 pl-3">
              <ScoreBar label="Space Usage" val={liveScore.capacity} color="text-blue-400" />
              <ScoreBar label="Flow Eff." val={liveScore.path} color="text-purple-400" />
              <ScoreBar label="Congestion" val={liveScore.congestion} color="text-amber-400" />
              <ScoreBar label="Utilization" val={liveScore.utilization} color="text-cyan-400" />
            </div>
          </div>
        )}
        {!liveScore && (
          <div className="ml-auto px-3 py-1 text-xs text-slate-500 italic">
            Gathering data (Wait 1h)...
          </div>
        )}

      </div>

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
              eng["map"] = GridMap.fromJSON(json);
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

function ScoreBar({ label, val, color }: { label: string, val: number, color: string }) {
  const w = Math.min(100, Math.max(0, val));
  return (
    <div className="flex flex-col w-20">
      <div className="flex justify-between text-[9px] text-slate-400 uppercase mb-0.5">
        <span>{label}</span>
        <span className={color}>{val}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color.replace('text-', 'bg-')}`} style={{ width: `${w}%` }}></div>
      </div>
    </div>
  )
}
