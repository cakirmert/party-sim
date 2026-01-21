import { AgentType } from "@/lib/engine/Agent";

export const getAgentColor = (agentType: AgentType): string => {
  switch (agentType) {
    case "Bookworm":
      return "#10b981"; // Original Green
    case "PartyAnimal":
      return "#f59e0b"; // Original Amber/Orange
    case "GymRat":
      return "#3b82f6"; // Original Blue
    case "Balanced":
      return "#8b5cf6"; // Original Purple
    case "Workaholic":
      return "#64748b"; // Slate (New)
    case "NatureLover":
      return "#84cc16"; // Lime (New)
    default:
      return "#6b7280";
  }
};

export const PEAK_TIMES = [
  [420, 540], // 07:00 - 09:00
  [720, 840], // 12:00 - 14:00
  [1080, 1260], // 18:00 - 21:00
]
