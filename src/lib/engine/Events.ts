export type EngineEvent =
  | { type: "TICK"; tick: number }
  | { type: "AGENT_ADDED"; id: string }
  | { type: "AGENT_DESPAWNED"; id: string }
  | { type: "AGENT_RESPAWNED"; id: string }
  | { type: "WEEK_COMPLETED"; weeksElapsed: number };

type Listener = (e: EngineEvent) => void;

export class EventBus {
  private ls = new Set<Listener>();
  on(fn: Listener) { this.ls.add(fn); return () => this.ls.delete(fn); }
  emit(e: EngineEvent) { for (const l of this.ls) l(e); }
}
