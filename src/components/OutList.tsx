"use client";

import React, { useEffect, useState } from "react";
import type { Engine } from "@/lib/engine/Engine";

type Props = { engineRef: React.MutableRefObject<Engine | null> };

export default function OutList({ engineRef }: Props) {
  const [rows, setRows] = useState<{ id: string; name?: string; reason: string; eta: string; untilMinute: number }[]>([]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const sync = () => {
      const out = eng.getOutList().map(r => {
        const hh = Math.floor(r.untilMinute / 60).toString().padStart(2, "0");
        const mm = (r.untilMinute % 60).toString().padStart(2, "0");
        return { id: r.id, name: r.name, reason: r.reason, eta: `${hh}:${mm}`, untilMinute: r.untilMinute };
      }).sort((a, b) => a.untilMinute - b.untilMinute);
      setRows(out);
    };
    const unsub = eng.events.on(() => sync());
    sync();
    return () => { unsub(); };
  }, [engineRef]);

  // if (rows.length === 0) return null; // Keep rendered for layout stability

  return (
    <div className="text-sm bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-slate-700 flex flex-col h-64 min-w-[300px]">
      <div className="font-semibold mb-2 text-slate-800 shrink-0">Out of Building ({rows.length})</div>
      <div className="overflow-y-auto min-h-0 flex-1 pr-1 custom-scrollbar">
        {rows.length === 0 ? (
          <div className="text-slate-400 italic text-xs h-full flex items-center justify-center">No agents outside.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white shadow-sm z-10">
              <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                <th className="pb-2 pl-1">Agent</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2 text-right pr-1">ETA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="py-2 pl-1">
                    <div className="font-medium text-slate-700">{r.name}</div>
                    <div className="text-[10px] font-mono text-slate-400 group-hover:text-slate-500">{r.id.slice(0, 6)}...</div>
                  </td>
                  <td className="py-2 text-slate-600">{r.reason}</td>
                  <td className="py-2 text-right font-mono text-slate-600 pr-1">{r.eta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
