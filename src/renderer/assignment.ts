import type { AgentView } from "../projection/types.ts";

const searchable = (value: string | undefined): string => value?.toLocaleLowerCase() ?? "";

/** Return inbox agents matching the short query used by the assignment picker. */
export const filterAssignableAgents = (
  agents: readonly AgentView[],
  query: string,
): readonly AgentView[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return agents;
  return agents.filter((agent) =>
    [
      agent.displayName,
      agent.description,
      agent.runtimeState,
      agent.provider,
      agent.repository,
      agent.branch,
      agent.worktree,
    ]
      .map(searchable)
      .some((value) => value.includes(normalized)),
  );
};
