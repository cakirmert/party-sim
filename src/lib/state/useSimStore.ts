import { create } from "zustand";
import type { SimSpeed } from "@/lib/engine/Types";

interface SimState {
  // sim controls
  speed: SimSpeed;
  paused: boolean;
  setSpeed: (s: SimSpeed) => void;
  setPaused: (p: boolean) => void;
  // agents & resets
  agentCount: number;     // 1..maxAgents
  maxAgents: number;
  setAgentCount: (n: number) => void;
  setMaxAgents: (n: number) => void;
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

  agentCount: 50,
  maxAgents: 120,
  setMaxAgents: (n) => set({ maxAgents: Math.max(1, Math.floor(n)) }),
  setAgentCount: (n) => set((state) => {
    const max = Math.max(1, Math.floor(state.maxAgents));
    const next = Math.max(1, Math.min(max, Math.floor(n)));
    return { agentCount: next };
  }),
  resetNonce: 0,
  bumpReset: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),

  selectedAgentId: null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  toast: null,
  setToast: (msg) => set({ toast: msg }),
}));
