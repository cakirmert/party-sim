"use client";

import React, { useEffect, useState } from "react";
import type { Engine } from "@/lib/engine/Engine";
import type { Vec2 } from "@/lib/engine/Types";
import { useSimStore } from "@/lib/state/useSimStore";
import { AgentType } from "@/lib/engine/Agent";

type Props = { engineRef: React.MutableRefObject<Engine | null> };

type InspectorSnapshot = {
  id: string;
  name: string;
  state: string;
  roomId?: string;
  pos?: Vec2 | null;
  dest?: Vec2 | null;
  facing?: { x: number; y: number } | null;
  offMap?: { untilMinute: number; reason: string } | null;
  status: "in-world" | "off-map";
  agentType?: AgentType;
};

export default function AgentInspector({ engineRef }: Props) {
  const selectedId = useSimStore(s => s.selectedAgentId);
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null);

  const fmtTime = (mins: number) => {
    const hh = Math.floor(mins / 60).toString().padStart(2, "0");
    const mm = (mins % 60).toString().padStart(2, "0");
    return `${hh}:${mm}`;
  };

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !selectedId) { setSnapshot(null); return; }
    const sync = () => {
      const a = eng.getAgents().find(a => a.id === selectedId);
      if (a) {
        setSnapshot({
          id: a.id,
          name: a.name || "Agent",
          state: a.state,
          roomId: a.roomId,
          pos: a.pos,
          dest: a.dest,
          facing: a.facing,
          offMap: a.offMap ?? null,
          status: "in-world",
          agentType: a.agentType,
        });
        return;
      }
      const off = eng.getOutList().find(o => o.id === selectedId);
      if (off) {
        setSnapshot({
          id: off.id,
          name: "Agent", // OutList entries don't carry name yet... need to fix Engine OutRecord? 
          state: "OffMap",
          roomId: undefined,
          pos: null,
          dest: null,
          facing: null,
          offMap: { untilMinute: off.untilMinute, reason: off.reason },
          status: "off-map",
        });
        return;
      }
      setSnapshot(null);
    };
    const unsub = eng.events.on(() => sync());
    sync();
    return () => { unsub(); };
  }, [engineRef, selectedId]);

  if (!selectedId) return null;
  const onClose = () => useSimStore.getState().setSelectedAgentId(null);

  const Shell: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
    <div className="absolute top-20 right-4 w-60 text-sm bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-right-4">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/50 rounded-t-lg">
        <span className="font-semibold text-slate-800">{title}</span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded transition"
          title="Clear Selection"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-3 text-slate-700 space-y-1">
        {children}
      </div>
    </div>
  );

  if (!snapshot) {
    return (
      <div className="text-sm text-slate-500 italic p-2">
        Click an agent to inspect details.
      </div>
    );
  }

  return (
    <div className="text-sm text-slate-700 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-baseline justify-between border-b border-slate-100 pb-2 mb-2">
        <div className="flex flex-col">
          <span className="font-bold text-lg text-slate-800">{snapshot.name}</span>
          <span className="text-xs font-mono text-slate-400">ID: {snapshot.id.slice(0, 8)}...</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 px-2 py-1 hover:bg-slate-100 rounded text-xs transition"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div><span className="text-slate-500 text-xs uppercase tracking-wide">State</span> <br /> {snapshot.state}</div>
        <div><span className="text-slate-500 text-xs uppercase tracking-wide">Type</span> <br /> {snapshot.agentType}</div>
        <div><span className="text-slate-500 text-xs uppercase tracking-wide">Room</span> <br /> {snapshot.roomId?.replace("R", "Room ") ?? "-"}</div>
        <div><span className="text-slate-500 text-xs uppercase tracking-wide">Pos</span> <br /> {snapshot.pos ? `(${snapshot.pos.x}, ${snapshot.pos.y})` : "-"}</div>

        {snapshot.offMap && (
          <div className="col-span-2 bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-100 mt-1 text-xs">
            Off-map ({snapshot.offMap.reason}) until {fmtTime(snapshot.offMap.untilMinute)}
          </div>
        )}
      </div>
    </div>
  );
}
