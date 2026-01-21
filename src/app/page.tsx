"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CanvasRenderer from "@/components/CanvasRenderer";
import UIControls from "@/components/UIControls";
import AgentInspector from "@/components/AgentInspector";
import OutList from "@/components/OutList";
import { useSimStore } from "@/lib/state/useSimStore";
import type { Engine } from "@/lib/engine/Engine";
import { DAY_NAMES } from "@/lib/engine/Agent";

export default function Page() {
  const engineRef = useRef<Engine | null>(null);
  const toast = useSimStore(s => s.toast);
  const setToast = useSimStore(s => s.setToast);
  const paused = useSimStore(s => s.paused);
  const [timeLabel, setTimeLabel] = useState("--:--:00");
  const [dayLabel, setDayLabel] = useState<string>(DAY_NAMES[0]);

  // Auto-clear toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const eng = engineRef.current;
      if (eng) {
        const minutes = eng.tod.minute;
        const hh = Math.floor(minutes / 60).toString().padStart(2, "0");
        const mm = Math.floor(minutes % 60).toString().padStart(2, "0");
        setTimeLabel(`${hh}:${mm}:00`);
        setDayLabel(DAY_NAMES[eng.tod.dayOfWeek]);
      } else {
        setTimeLabel("--:--:00");
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-800 font-sans">
      <div className="max-w-[1400px] mx-auto px-4 py-6 flex flex-col gap-5">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-slate-600">
                Party Simulation
              </h1>
            </div>
            <p className="text-slate-500 text-sm max-w-2xl">
              Test layouts in real-time. Agents move autonomously through dorms, bar, and gym.
            </p>
            <p className="text-slate-500 text-sm max-w-2xl">
              Adjust parameters and click <span className="font-bold text-slate-600">Reset</span> to regenerate.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/map-editor" className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md text-sm font-medium transition-all flex items-center gap-2 text-slate-600 shadow-sm">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Map Editor
            </Link>
            <Link href="/sweep-lab" className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
              Sweep Lab
            </Link>
          </div>
        </header>

        {/* Time Display */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
            <span className="text-slate-400 text-sm">Day:</span>
            <span className="font-mono text-lg text-slate-800 font-semibold">{dayLabel}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
            <span className="text-slate-400 text-sm">Time:</span>
            <span className="font-mono text-lg text-slate-800 font-semibold" style={{ minWidth: "9ch" }}>{timeLabel}</span>
          </div>
          <div className={`px-4 py-2 rounded-xl text-sm font-semibold shadow-sm ${paused ? "bg-amber-50 border border-amber-200 text-amber-700" : "bg-emerald-50 border border-emerald-200 text-emerald-700"}`}>
            {paused ? "⏸ Paused" : "▶ Running"}
          </div>
        </div>

        {/* Controls */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <UIControls engineRef={engineRef} />
        </section>

        {/* Canvas */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <CanvasRenderer engineRef={engineRef} />
        </section>

        {/* Bottom Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <AgentInspector engineRef={engineRef} />
          </section>
          <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <OutList engineRef={engineRef} />
          </section>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-4 py-2 rounded-xl text-sm shadow-xl">
            {toast}
          </div>
        )}
      </div>
    </main>
  );
}
