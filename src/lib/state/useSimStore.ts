import { create } from "zustand";
import type { SimSpeed } from "@/lib/engine/Types";

interface SimState {
  // sim controls
  speed: SimSpeed;
  paused: boolean;
  setSpeed: (s: SimSpeed) => void;
  setPaused: (p: boolean) => void;
  mapParams: {
    corridorWidth: number;
    crossHeight: number;
    bandHeight: number;
    bandCount: number;
    dormRowGap: number;
  };
  setMapParams: (p: Partial<SimState["mapParams"]>) => void;
  // agents & resets
  agentCount: number;     // 1..maxAgents
  maxAgents: number;
  capacity: number;
  setAgentCount: (n: number) => void;
  setMaxAgents: (n: number) => void;
  setCapacity: (n: number) => void;
  resetNonce: number;     // bump to request a full reset at 06:00
  bumpReset: () => void;
  // renderer / selection
  selectedAgentId?: string | null;
  setSelectedAgentId: (id: string | null) => void;
  // UI messages
  toast?: string | null;
  setToast: (msg: string | null) => void;
}

export const useSimStore = create<SimState>((set) => ({
  speed: 1,
  paused: false,
  setSpeed: (s) => set({ speed: s }),
  setPaused: (p) => set({ paused: p }),
  mapParams: {
    corridorWidth: 2,
    crossHeight: 0,
    bandHeight: 12,
    bandCount: 0,
    dormRowGap: 3,
  },
  setMapParams: (p) => set((state) => ({ mapParams: { ...state.mapParams, ...p } })),

  agentCount: 140,
  maxAgents: 200,
  capacity: 200,
  setMaxAgents: (n) => set({ maxAgents: Math.max(1, Math.floor(n)) }),
  setCapacity: (n) => set({ capacity: Math.max(1, Math.floor(n)) }),
  setAgentCount: (n) => set((state) => {
    const max = Math.max(1, Math.floor(state.maxAgents));
    const cap = Math.max(1, Math.floor(state.capacity));
    const limit = Math.min(max, cap);
    const next = Math.max(1, Math.min(limit, Math.floor(n)));
    return { agentCount: next };
  }),
  resetNonce: 0,
  bumpReset: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),

  selectedAgentId: null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  toast: null,
  setToast: (msg) => set({ toast: msg }),
}));
