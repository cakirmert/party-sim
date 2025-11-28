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
  const setAgentCount = useSimStore(s => s.setAgentCount);
  const bumpReset = useSimStore(s => s.bumpReset);

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

      <span className="ml-2 text-sm">Speed:</span>
      {SPEED_OPTIONS.map(s => (
        <button
          key={s}
          className={`px-2 py-1 rounded transition ${speed === s ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-800 hover:bg-slate-300"}`}
          onClick={() => setSpeed(s)}>{s}×</button>
      ))}

      <span className="ml-4 text-sm">Agents:</span>
      <input
        type="number" min={1} max={100} value={agentCount}
        onChange={(e) => setAgentCount(Number(e.target.value))}
        className="w-20 bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
      />
      <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={() => bumpReset()}>
        Reset @06:00
      </button>

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
