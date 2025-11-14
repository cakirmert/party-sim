"use client";

import React, { useEffect, useState } from "react";
import type { Engine } from "@/lib/engine/Engine";
import type { Vec2 } from "@/lib/engine/Types";
import { useSimStore } from "@/lib/state/useSimStore";

type Props = { engineRef: React.MutableRefObject<Engine | null> };

type InspectorSnapshot = {
  id: string;
  state: string;
  roomId?: string;
  pos?: Vec2 | null;
  dest?: Vec2 | null;
  pathLen: number;
  facing?: { x: number; y: number } | null;
  offMap?: { untilMinute: number; reason: string } | null;
  status: "in-world" | "off-map";
};

export default function AgentInspector({ engineRef }: Props) {
  const selectedId = useSimStore(s=>s.selectedAgentId);
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
          pathLen: a.path?.length ?? 0,
          facing: a.facing,
          offMap: a.offMap ?? null,
          status: "in-world",
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
          pathLen: 0,
          facing: null,
          offMap: { untilMinute: off.untilMinute, reason: off.reason },
          status: "off-map",
        });
        return;
      }
      setSnapshot(null);
    };
    const unsub = eng.events.on(()=>sync());
    sync();
    return () => { unsub(); };
  }, [engineRef, selectedId]);

  if (!selectedId) return null;
  const Shell: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
    <div className="text-sm bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-slate-700">
      {title && <div className="font-semibold mb-1 text-slate-800">{title}</div>}
      {children}
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
      <div><b>Path len:</b> {snapshot.pathLen}</div>
      <div><b>Facing:</b> {snapshot.facing ? `(${snapshot.facing.x.toFixed(2)}, ${snapshot.facing.y.toFixed(2)})` : "-"}</div>
      {snapshot.offMap && (
        <div><b>Off-map:</b> until {fmtTime(snapshot.offMap.untilMinute)} ({snapshot.offMap.reason})</div>
      )}
      <div className="mt-2 text-xs text-slate-500">Tip: Pause first, then click an agent on the canvas to inspect.</div>
    </Shell>
  );
}
