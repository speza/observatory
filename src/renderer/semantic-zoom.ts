import type { RuntimeState, TrackedSession } from "../universe/types.ts";

export type SemanticZoomLevel = "overview" | "context" | "detail";

export type SemanticZoomLens = "portfolio" | "attention" | "goal" | "inbox";

const levelRank: Record<SemanticZoomLevel, number> = {
  overview: 0,
  context: 1,
  detail: 2,
};

const WORKING_MARKERS = ["◐", "◓", "◑", "◒"] as const;

export const nextSemanticZoom = (level: SemanticZoomLevel): SemanticZoomLevel => {
  if (level === "overview") return "context";
  if (level === "context") return "detail";
  return "overview";
};

export const semanticZoomLevel = (input: {
  readonly lens: SemanticZoomLens;
  readonly preference: SemanticZoomLevel;
  readonly selected?: boolean;
  readonly attention?: boolean;
}): SemanticZoomLevel => {
  if (input.lens === "goal" || input.lens === "inbox") return "detail";
  const contextual = Boolean(input.selected || input.attention);
  if (input.preference === "detail" || (input.preference === "context" && contextual))
    return "detail";
  if (input.preference === "context" || contextual) return "context";
  return "overview";
};

export const sessionMarker = (
  hostHealth: TrackedSession["hostHealth"],
  runtimeState: RuntimeState,
  phase = 0,
): string => {
  if (hostHealth !== "live") return "?";
  if (runtimeState === "blocked" || runtimeState === "waiting") return "!";
  if (runtimeState === "done") return "✓";
  if (runtimeState === "working")
    return WORKING_MARKERS[Math.floor(Math.max(0, phase) * 2) % WORKING_MARKERS.length] ?? "◐";
  if (runtimeState === "unknown") return "?";
  return "·";
};

export const sessionLabelBudget = (
  level: SemanticZoomLevel,
  terminalWidth: number,
  inbox: boolean,
): number => {
  const narrow = terminalWidth < 100;
  if (level === "detail") return narrow ? 24 : 40;
  if (level === "context") return narrow ? 16 : inbox ? 30 : 28;
  return narrow ? 9 : inbox ? 22 : 20;
};

export const goalLabelBudget = (level: SemanticZoomLevel, terminalWidth: number): number => {
  const narrow = terminalWidth < 100;
  if (level === "detail") return narrow ? 26 : 42;
  if (level === "context") return narrow ? 18 : 32;
  return narrow ? 14 : 26;
};

export const isAtLeast = (level: SemanticZoomLevel, minimum: SemanticZoomLevel): boolean =>
  levelRank[level] >= levelRank[minimum];
