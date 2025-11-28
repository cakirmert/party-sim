import { AgentType } from "@/lib/engine/Agent";

export const getAgentColor = (agentType: AgentType): string => {
  switch (agentType) {
    case "Bookworm":
      return "#10b981";
    case "PartyAnimal":
      return "#f59e0b";
    case "GymRat":
      return "#3b82f6";
    case "Balanced":
      return "#8b5cf6";
    default:
      return "#6b7280";
  }
};

export const PEAK_TIMES = [
  [420, 540], // 07:00 - 09:00
  [720, 840], // 12:00 - 14:00
  [1080, 1260], // 18:00 - 21:00
]
