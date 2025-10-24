import { AgentType } from "@/lib/engine/Agent";

export const getAgentColor = (agentType: AgentType): string => {
  switch (agentType) {
    case "Bookworm":
      return "#10b981"; // Emerald-500
    case "PartyAnimal":
      return "#f59e0b"; // Amber-500
    case "GymRat":
      return "#3b82f6"; // Blue-500
    case "Balanced":
      return "#8b5cf6"; // Violet-500
    case "Procrastinator":
      return "#ef4444"; // Red-500
    case "Overachiever":
      return "#14b8a6"; // Teal-500
    default:
      return "#6b7280"; // Gray-500 (fallback)
  }
};
