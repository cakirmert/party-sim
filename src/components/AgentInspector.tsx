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
  stepsTaken?: number;
  pathEfficiency?: number;
  avoidanceCount?: number;
  isSmoker?: boolean;
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
        let eff = 0;
        if (a.pathStartPos) {
          const dist = Math.hypot(a.pos.x - a.pathStartPos.x, a.pos.y - a.pathStartPos.y);
          eff = (dist / Math.max(1, a.stepsTaken)) * 100;
        }
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
          stepsTaken: a.stepsTaken,
          pathEfficiency: eff,
          avoidanceCount: a.avoidanceCount,
          isSmoker: a.isSmoker,
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

  const getFlavorText = (s: InspectorSnapshot) => {
    if (s.offMap) return `Away (${s.offMap.reason})`;
    if (s.state === "AtBar") {
      if (s.agentType === "PartyAnimal") return "Partying Hard!";
      if (s.agentType === "Bookworm") return "Reluctantly Socializing";
      if (s.agentType === "WorkingStudent") return "Networking";
      return "Enjoying a Drink";
    }
    if (s.state === "AtGym") {
      if (s.agentType === "GymRat") return "Crushing It!";
      return "Working Out";
    }
    if (s.state === "InRoom") {
      if (s.agentType === "Bookworm") return "Reading Quietly";
      if (s.agentType === "PartyAnimal") return "Power Napping";
      return "Resting";
    }
    if (s.state === "Idle") return "Pondering Life";
    if (s.state === "Wander") return "Going somewhere...";
    return s.state;
  };

  if (!snapshot) {
    return (
      <div className="text-sm text-slate-500 italic flex items-center justify-center h-64 min-w-[300px] bg-slate-50 rounded-lg border border-slate-100">
        Click an agent to inspect details.
      </div>
    );
  }

  return (
    <div className="text-sm text-slate-700 animate-in fade-in slide-in-from-bottom-2 h-64 min-w-[300px] flex flex-col">
      <div className="flex items-baseline justify-between border-b border-slate-100 pb-2 mb-2">
        <div className="flex flex-col">
          <span className="font-bold text-lg text-slate-800 flex items-center gap-2">
            {snapshot.name}
            {snapshot.isSmoker && <span title="Smoker" className="text-base">🚬</span>}
          </span>
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
        <div className="col-span-2">
          <span className="text-slate-500 text-xs uppercase tracking-wide">Status</span> <br />
          <span className="font-medium text-indigo-600">
            {snapshot.agentType} • {getFlavorText(snapshot)}
          </span>
        </div>

        {snapshot.status === "in-world" && (
          <>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide">Path Eff.</span> <br />
              {snapshot.pathEfficiency ? <span className={snapshot.pathEfficiency > 80 ? "text-emerald-600" : "text-amber-600"}>{snapshot.pathEfficiency.toFixed(0)}%</span> : "-"}
            </div>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide">Congestion</span> <br />
              {snapshot.avoidanceCount || 0} events
            </div>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide">Steps</span> <br />
              {snapshot.stepsTaken ? snapshot.stepsTaken.toFixed(0) : 0}
            </div>
            <div><span className="text-slate-500 text-xs uppercase tracking-wide">Room</span> <br />
              {snapshot.roomId?.replace("R", "Room ") ?? "-"}
            </div>
          </>
        )}

        {snapshot.offMap && (
          <div className="col-span-2 bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-100 mt-1 text-xs">
            Returns at {fmtTime(snapshot.offMap.untilMinute)}
          </div>
        )}

      </div>
    </div>
  );
}
