import type { RuntimeState, TrackedSession } from "../universe/types.ts";

export type SemanticZoomLevel = "overview" | "context" | "detail";

export type SemanticZoomLens = "portfolio" | "attention" | "goal" | "inbox";

/** Keep a completed session visibly reviewable for a short, deterministic window. */
export const DONE_REVIEW_WINDOW_MS = 30 * 60 * 1000;

export const isRecentlyDone = (
  session: Pick<TrackedSession, "runtimeState" | "hostHealth" | "lastChangedAt">,
  now: number,
  windowMs = DONE_REVIEW_WINDOW_MS,
): boolean =>
  session.hostHealth === "live" &&
  session.runtimeState === "done" &&
  Math.max(0, now - session.lastChangedAt) <= Math.max(0, windowMs);

/**
 * Scale node geometry with the camera without changing the durable world
 * layout. The neutral scale is one at the default zoom, so focused cards keep
 * their existing size until the user deliberately zooms in or out.
 */
export const perspectiveNodeScale = (zoom: number): number =>
  Math.max(0.75, Math.min(1.5, 0.55 + 0.45 * zoom));

const levelRank = {
  overview: 0,
  context: 1,
  detail: 2,
} satisfies Record<SemanticZoomLevel, number>;

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
  // The selected target is the user's current decision point. Give it the
  // detail tier even when the surrounding portfolio remains compact; the
  // selected card should spend space on identity before secondary metadata.
  if (input.selected) return "detail";
  // Focused lenses used to force every satellite into detail mode. That made
  // the semantic-zoom control ineffective exactly where density is highest.
  // The lens changes the topology; the user's label preference still controls
  // how much each non-selected body says.
  if (input.preference === "detail") return "detail";
  if (input.preference === "context" || input.attention) return "context";
  return "overview";
};

export const sessionMarker = (
  hostHealth: TrackedSession["hostHealth"],
  runtimeState: RuntimeState,
  phase = 0,
): string => {
  if (hostHealth !== "live") return "?";
  if (runtimeState === "blocked") return "!";
  if (runtimeState === "waiting") return "…";
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
