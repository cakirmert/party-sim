import { create } from "zustand";
import type { SimSpeed } from "@/lib/engine/Types";

interface SimState {
  // sim controls
  speed: SimSpeed;
  paused: boolean;
  setSpeed: (s: SimSpeed) => void;
  setPaused: (p: boolean) => void;
  // agents & resets
  agentCount: number;     // 1..100
  setAgentCount: (n: number) => void;
  resetNonce: number;     // bump to request a full reset at 06:00
  bumpReset: () => void;
  // renderer / selection
  showPaths: boolean;
  setShowPaths: (v: boolean) => void;
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
  setAgentCount: (n) => set({ agentCount: Math.max(1, Math.min(100, Math.floor(n))) }),
  resetNonce: 0,
  bumpReset: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),

  showPaths: true,
  setShowPaths: (v) => set({ showPaths: v }),
  selectedAgentId: null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  toast: null,
  setToast: (msg) => set({ toast: msg }),
}));
