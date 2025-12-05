"use client";

import React, { useEffect, useRef } from "react";
import { useSimStore } from "@/lib/state/useSimStore";
import { Engine } from "@/lib/engine/Engine";
import { GridMap } from "@/lib/engine/GridMap";
import { AGENT_TYPES } from "@/lib/engine/Agent";
import { getAgentColor } from "./utils";
import type { MetricsMap, SimSpeed } from "@/lib/engine/Types";

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
  const calculateMetricsRef = useRef<() => void>(() => {});

  const handleStep = () => {
    const eng = engineRef.current;
    if (!eng) return;
    setPaused(true);
    eng.stepOnce();
  };

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

  return (
    <div className="flex flex-wrap items-center gap-2 bg-white/90 p-3 rounded-lg border border-slate-200 shadow-sm">
      <button className="px-3 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => setPaused(!paused)}>
        {paused ? "Play" : "Pause"}
      </button>
      <button className="px-3 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={handleStep}>
        Step
      </button>
      <button className="px-3 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => setSelectedAgentId(null)}>
        Clear Selection
      </button>

      <span className="ml-2 text-sm flex items-center gap-1">
        Speed
        <span className="text-xs text-slate-500 cursor-help" title="Changes real-time playback only; sim minutes per tick stay the same. Higher speeds can cost more CPU.">?</span>
        :
      </span>
      {SPEED_OPTIONS.map(s => (
        <button
          key={s}
          className={`px-2 py-1 rounded transition ${speed === s ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-800 hover:bg-slate-300"}`}
          onClick={() => setSpeed(s)}>{s}×</button>
      ))}

      <span className="ml-4 text-sm flex items-center gap-1">
        Agents (capacity {useSimStore.getState().capacity} / max {maxAgents})
        <span className="text-xs text-slate-500 cursor-help" title="More agents increase room generation and crowding; reset to apply. Capacity comes from room count.">?</span>
        :
      </span>
      <input
        type="number" min={1} max={9999} value={agentCount}
        onChange={(e) => setAgentCount(Number(e.target.value))}
        className="w-20 bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
      />
      <div className="flex items-center gap-1">
        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => bumpReset()}>
          Reset @06:00
        </button>
        <span className="text-xs text-slate-500 cursor-help" title="Rebuilds rooms with current capacity and respawns everyone at 06:00. Use after changing agent count.">?</span>
        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => setShowMapParams(v => !v)}>
          {showMapParams ? "Hide map params" : "Edit map params"}
        </button>
      </div>

      {showMapParams && (
        <div className="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 bg-slate-50 border border-slate-200 rounded p-2">
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Corridor width
            <input
              type="number"
              min={2}
              max={8}
              value={mapParams.corridorWidth}
              onChange={e => setMapParams({ corridorWidth: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Main vertical corridor width. Wider reduces room count but eases flow."
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Cross height
            <input
              type="number"
              min={0}
              max={4}
              value={mapParams.crossHeight}
              onChange={e => setMapParams({ crossHeight: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Horizontal corridor thickness between bands."
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Band height
            <input
              type="number"
              min={8}
              max={14}
              value={mapParams.bandHeight}
              onChange={e => setMapParams({ bandHeight: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Height of each dorm band. Taller bands fit more stacked rows."
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
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Door corridor
            <input
              type="number"
              min={1}
              max={5}
              value={mapParams.dormRowGap}
              onChange={e => setMapParams({ dormRowGap: Number(e.target.value) })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
              title="Gap between stacked room rows (doors open into this)."
            />
          </label>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="ml-4 flex items-center gap-3">
          {AGENT_TYPES.map((type) => (
            <div key={type} className="flex gap-1">
              <p>{type}</p>
              <div className="flex flex-col justify-center">
                <div style={{ backgroundColor: getAgentColor(type) }} className="w-3 h-3 rounded border border-slate-300" />
              </div>
            </div>
          ))}
        </div>

        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => {
          const eng = engineRef.current;
          if (!eng) return;
          const json = eng.map.toJSON();
          const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "map.json"; a.click();
          URL.revokeObjectURL(url);
        }}>Save Map</button>

        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={calculateMetrics}>
          Get Metrics
        </button>


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
        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => fileRef.current?.click()}>
          Load Map
        </button>
      </div>
    </div>
  );
}
