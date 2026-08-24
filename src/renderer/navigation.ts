import type { MapGoalView, MapAgentView, UniverseMapProjection } from "../projection/types.ts";

export type NavigationSelection = {
  readonly type: "goal" | "agent";
  readonly id: string;
};

export type NavigationLens = "portfolio" | "attention" | "goal" | "inbox";

const FULL_TURN = Math.PI * 2;

const compareMapPosition = (
  left: { readonly mapPosition: { readonly x: number; readonly y: number }; readonly id: string },
  right: { readonly mapPosition: { readonly x: number; readonly y: number }; readonly id: string },
): number =>
  left.mapPosition.y - right.mapPosition.y ||
  left.mapPosition.x - right.mapPosition.x ||
  left.id.localeCompare(right.id);

/**
 * Sort direct agents in the same clockwise order a person sees around a
 * goal: top, right, bottom, left. World y increases down the terminal, so a
 * screen-space angle is the useful coordinate here.
 */
export const clockwiseAgents = (
  goal: Pick<MapGoalView, "mapPosition" | "agents">,
): readonly MapAgentView[] => {
  const ordered = [...goal.agents];
  ordered.sort((left, right) => {
    const angle = (agent: MapAgentView): number => {
      const radians =
        Math.atan2(
          agent.mapPosition.y - goal.mapPosition.y,
          agent.mapPosition.x - goal.mapPosition.x,
        ) +
        Math.PI / 2;
      return (radians + FULL_TURN) % FULL_TURN;
    };
    const angleDelta = angle(left) - angle(right);
    if (angleDelta !== 0) return angleDelta;
    const distance = (agent: MapAgentView): number => {
      const x = agent.mapPosition.x - goal.mapPosition.x;
      const y = agent.mapPosition.y - goal.mapPosition.y;
      return x * x + y * y;
    };
    return distance(left) - distance(right) || left.id.localeCompare(right.id);
  });
  return ordered;
};

/** Return only the nodes that belong to the current map lens. */
export const mapSelectionCandidates = (
  projection: UniverseMapProjection,
  lens: NavigationLens,
  focusGoalId: string | undefined,
): readonly NavigationSelection[] => {
  if (lens === "goal") {
    const goal = focusGoalId
      ? projection.goals.find((candidate) => candidate.id === focusGoalId)
      : undefined;
    return goal ? clockwiseAgents(goal).map((agent) => ({ type: "agent", id: agent.id })) : [];
  }
  if (lens === "inbox")
    return projection.unassigned.map((agent) => ({ type: "agent", id: agent.id }));
  return [...projection.goals]
    .sort(compareMapPosition)
    .map((goal) => ({ type: "goal", id: goal.id }));
};

/** Move one step through a stable circular selection sequence. */
export const nextNavigationSelection = (
  candidates: readonly NavigationSelection[],
  selected: NavigationSelection | undefined,
  direction: number,
): NavigationSelection | undefined => {
  if (candidates.length === 0) return undefined;
  const currentIndex = selected
    ? candidates.findIndex(
        (candidate) => candidate.type === selected.type && candidate.id === selected.id,
      )
    : -1;
  if (currentIndex < 0) return candidates[direction > 0 ? 0 : candidates.length - 1];
  const start = currentIndex;
  const nextIndex = (start + direction + candidates.length) % candidates.length;
  return candidates[nextIndex];
};
