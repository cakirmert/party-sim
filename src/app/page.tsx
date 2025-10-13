"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CanvasRenderer from "@/components/CanvasRenderer";
import UIControls from "@/components/UIControls";
import AgentInspector from "@/components/AgentInspector";
import OutList from "@/components/OutList";
import { useSimStore } from "@/lib/state/useSimStore";
import type { Engine } from "@/lib/engine/Engine";

export default function Page() {
  const engineRef = useRef<Engine | null>(null);
  const toast = useSimStore(s=>s.toast);
  const setToast = useSimStore(s=>s.setToast);
  const paused = useSimStore(s=>s.paused);
  const [timeLabel, setTimeLabel] = useState("--:--:00");

  // Auto-clear toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(()=>setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const eng = engineRef.current;
      if (eng) {
        const minutes = eng.tod.minute;
        const hh = Math.floor(minutes / 60).toString().padStart(2, "0");
        const mm = (minutes % 60).toString().padStart(2, "0");
        setTimeLabel(`${hh}:${mm}:00`);
      } else {
        setTimeLabel("--:--:00");
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="max-w-[1200px] mx-auto p-4 flex flex-col gap-3">
      <h1 className="text-2xl font-bold text-slate-800">Party Simulation</h1>
      <p className="text-sm text-slate-600">
        The dorm layout is generated automatically for the chosen agent count. Use <b>Reset @06:00</b> after changing the count to rebuild rooms and respawn everyone. Shift+Click moves the first agent. Hold Space/MMB to pan. Wheel to zoom.
      </p>
      <div>
        <Link href="/map-editor" className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-white border border-slate-200 text-sm text-blue-600 shadow-sm hover:bg-slate-100">
          Open map editor
        </Link>
      </div>

      <UIControls engineRef={engineRef} />
      <div className="flex items-center gap-3 text-sm">
        <span className="px-3 py-1 rounded bg-white/80 border border-slate-200 text-slate-700 shadow-sm font-mono text-lg" style={{ minWidth: "8ch", display: "inline-block" }}>{timeLabel}</span>
        <span className="px-2 py-1 rounded bg-white/80 border border-slate-200 text-slate-700 shadow-sm">{paused ? "Paused" : "Running"}</span>
      </div>

      <CanvasRenderer engineRef={engineRef} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AgentInspector engineRef={engineRef} />
        <OutList engineRef={engineRef} />
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white border border-slate-200 px-3 py-2 rounded text-sm shadow">
          {toast}
        </div>
      )}
    </main>
  );
}
