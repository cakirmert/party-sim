"use client";

import React, { useEffect, useState } from "react";
import type { Engine } from "@/lib/engine/Engine";

type Props = { engineRef: React.MutableRefObject<Engine | null> };

export default function OutList({ engineRef }: Props) {
  const [rows, setRows] = useState<{ id: string; reason: string; eta: string; untilMinute: number }[]>([]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const sync = () => {
      const out = eng.getOutList().map(r => {
        const hh = Math.floor(r.untilMinute / 60).toString().padStart(2, "0");
        const mm = (r.untilMinute % 60).toString().padStart(2, "0");
        return { id: r.id, reason: r.reason, eta: `${hh}:${mm}`, untilMinute: r.untilMinute };
      }).sort((a, b) => a.untilMinute - b.untilMinute);
      setRows(out);
    };
    const unsub = eng.events.on(()=>sync());
    sync();
    return () => { unsub(); };
  }, [engineRef]);

  if (rows.length === 0) return null;

  return (
    <div className="text-sm bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-slate-700">
      <div className="font-semibold mb-1 text-slate-800">Out of Building ({rows.length})</div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>ID</th><th>Reason</th><th>ETA</th></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}><td>{r.id}</td><td>{r.reason}</td><td>{r.eta}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
