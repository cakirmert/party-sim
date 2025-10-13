"use client";

import React, { useRef } from "react";
import { useSimStore } from "@/lib/state/useSimStore";
import { Engine } from "@/lib/engine/Engine";
import { GridMap } from "@/lib/engine/GridMap";

type Props = { engineRef: React.MutableRefObject<Engine | null> };

export default function UIControls({ engineRef }: Props) {
  const speed = useSimStore(s=>s.speed);
  const paused = useSimStore(s=>s.paused);
  const setSpeed = useSimStore(s=>s.setSpeed);
  const setPaused = useSimStore(s=>s.setPaused);

  const agentCount = useSimStore(s=>s.agentCount);
  const setAgentCount = useSimStore(s=>s.setAgentCount);
  const bumpReset = useSimStore(s=>s.bumpReset);

  const showPaths = useSimStore(s=>s.showPaths);
  const setShowPaths = useSimStore(s=>s.setShowPaths);

  const setSelectedAgentId = useSimStore(s=>s.setSelectedAgentId);
  const setToast = useSimStore(s=>s.setToast);

  const fileRef = useRef<HTMLInputElement>(null);

  const handleStep = () => {
    const eng = engineRef.current;
    if (!eng) return;
    setPaused(true);
    eng.stepOnce();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 bg-white/90 p-3 rounded-lg border border-slate-200 shadow-sm">
      <button className="px-3 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={()=>setPaused(!paused)}>
        {paused ? "Play" : "Pause"}
      </button>
      <button className="px-3 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={handleStep}>
        Step
      </button>
      <button className="px-3 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={()=>setSelectedAgentId(null)}>
        Clear Selection
      </button>

      <span className="ml-2 text-sm">Speed:</span>
      {[0.25,0.5,1,2,4,8].map(s=>(
        <button
          key={s}
          className={`px-2 py-1 rounded transition ${speed===s ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-800 hover:bg-slate-300"}`}
          onClick={()=>setSpeed(s as any)}>{s}×</button>
      ))}

      <span className="ml-4 text-sm">Agents:</span>
      <input
        type="number" min={1} max={100} value={agentCount}
        onChange={(e)=>setAgentCount(Number(e.target.value))}
        className="w-20 bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 shadow-sm"
      />
      <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={()=>bumpReset()}>
        Reset @06:00
      </button>

      <label className="ml-4 text-sm flex items-center gap-2">
        <input type="checkbox" checked={showPaths} onChange={(e)=>setShowPaths(e.target.checked)} />
        Show paths
      </label>

      <div className="ml-auto flex items-center gap-2">
        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={()=>{
          const eng = engineRef.current;
          if (!eng) return;
          const json = eng.map.toJSON();
          const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "map.json"; a.click();
          URL.revokeObjectURL(url);
        }}>Save Map</button>

        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={async (e)=>{
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const txt = await file.text();
              const json = JSON.parse(txt);
              if (!json || !json.width || !json.height || !json.tiles) throw new Error("Expected MapJSON with tiles");
              const eng = engineRef.current!;
              eng["map"] = GridMap.fromJSON(json);
              setToast("Map loaded.");
            } catch (err:any) {
              setToast("Failed to load map.json (must include tiles).");
            }
          }} />
        <button className="px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 transition" onClick={()=>fileRef.current?.click()}>
          Load Map
        </button>
      </div>
    </div>
  );
}
