import type { CommandCentreProjection } from "../../../src/projection/types.ts";
import type { Selection } from "../app/selection.ts";

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
  if (goal?.systemId) return goal.systemId;
  if (selection.type !== "agent") return undefined;
  return projection.systems.find((system) =>
    system.agents.some((agent) => agent.id === selection.id),
  )?.id;
};
