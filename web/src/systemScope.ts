import type { CommandCentreProjection } from "../../src/projection/types.ts";
import type { Selection } from "./atlasGeometry.ts";

export const NO_SYSTEM_SCOPE = "__no-system__";

export const systemScopeForSelection = (
  selection: Selection,
  projection: CommandCentreProjection,
): string | undefined => {
  const goal =
    selection.type === "goal"
      ? projection.goals.find((candidate) => candidate.id === selection.id)
      : projection.goals.find((candidate) =>
          candidate.agents.some((agent) => agent.id === selection.id),
        );
  if (goal) return goal.systemId ?? NO_SYSTEM_SCOPE;
  if (
    selection.type === "agent" &&
    projection.unassigned.some((agent) => agent.id === selection.id)
  )
    return NO_SYSTEM_SCOPE;
  return undefined;
};
