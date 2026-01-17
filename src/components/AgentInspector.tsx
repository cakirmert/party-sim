"use client";

import React, { useEffect, useState } from "react";
import type { Engine } from "@/lib/engine/Engine";
import type { Vec2 } from "@/lib/engine/Types";
import { useSimStore } from "@/lib/state/useSimStore";
import { AgentType } from "@/lib/engine/Agent";

type Props = { engineRef: React.MutableRefObject<Engine | null> };

type InspectorSnapshot = {
  id: string;
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
      <Shell title="Agent inspector">
        <div>Agent not found (may have left via EXIT).</div>
      </Shell>
    );
  }

  return (
    <Shell title="Agent inspector">
      <div><b>ID:</b> {snapshot.id}</div>
      <div><b>Room:</b> {snapshot.roomId ?? "-"}</div>
      <div><b>State:</b> {snapshot.state}</div>
      <div><b>Pos:</b> {snapshot.pos ? `(${snapshot.pos.x},${snapshot.pos.y})` : "-"}</div>
      <div><b>Dest:</b> {snapshot.dest ? `(${snapshot.dest.x},${snapshot.dest.y})` : "-"}</div>
      <div><b>Agent Type:</b> {snapshot.agentType ?? "-"}</div>
      <div><b>Facing:</b> {snapshot.facing ? `(${snapshot.facing.x.toFixed(2)}, ${snapshot.facing.y.toFixed(2)})` : "-"}</div>
      <div>
        <b>Off-map:</b>{" "}
        {snapshot.offMap
          ? `until ${fmtTime(snapshot.offMap.untilMinute)} (${snapshot.offMap.reason})`
          : "-"}
      </div>
      <div className="mt-2 text-xs text-slate-500">Tip: Pause first, then click an agent on the canvas to inspect.</div>
    </Shell>
  );
}
