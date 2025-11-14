"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import CanvasRenderer from "@/components/CanvasRenderer";
import UIControls from "@/components/UIControls";
import type { Engine } from "@/lib/engine/Engine";
import { useSimStore } from "@/lib/state/useSimStore";

export default function MapEditorPage() {
  const engineRef = useRef<Engine | null>(null);
  const toast = useSimStore(s => s.toast);
  const setToast = useSimStore(s => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  return (
    <main className="max-w-[1200px] mx-auto p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Map Editor</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to simulation
        </Link>
      </div>
      <p className="text-sm text-slate-600 max-w-3xl">
        Use the painter tools to tweak BUILDABLE areas before exporting. LOCKED tiles (generated dorms,
        themed zones) should remain untouched to keep the sim deterministic. Save the result to JSON and
        import it when running the main simulation.
      </p>

      <UIControls engineRef={engineRef} />
      <CanvasRenderer engineRef={engineRef} variant="editor" />

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white border border-slate-200 px-3 py-2 rounded text-sm shadow">
          {toast}
        </div>
      )}
    </main>
  );
}
