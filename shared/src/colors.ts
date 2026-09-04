// Participant palette: assigned in join order. The AI is rendered in graphite.
export const PARTICIPANT_COLORS = ["#D4890A", "#178E9E", "#7A5AF8", "#C2410C", "#2E8B57", "#B5179E", "#0F766E", "#9A3412"];
export const AI_COLOR = "#5A6773";

export function pickColor(index: number): string {
  return PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]!;
}
