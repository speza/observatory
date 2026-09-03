import type { AgentView } from "../../../src/projection/types.ts";

export const orderTerminalAgents = (
  agents: readonly AgentView[],
  recentIds: readonly string[],
  current?: AgentView,
): readonly AgentView[] => {
  const observed = agents.filter((agent) => agent.execution !== undefined);
  const currentAgent = current
    ? (agents.find((agent) => agent.id === current.id) ?? current)
    : undefined;
  const eligible =
    currentAgent && !observed.some((agent) => agent.id === currentAgent.id)
      ? [currentAgent, ...observed]
      : observed;
  const byId = new Map(eligible.map((agent) => [agent.id, agent]));
  return [
    ...recentIds.flatMap((id) => {
      const agent = byId.get(id);
      if (!agent) return [];
      byId.delete(id);
      return [agent];
    }),
    ...byId.values(),
  ];
};

export const filterTerminalAgents = (
  agents: readonly AgentView[],
  query: string,
): readonly AgentView[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return agents;
  return agents.filter((agent) =>
    [agent.displayName, agent.goalTitle, agent.lifecycleState, agent.execution?.hostKind]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalized)),
  );
};

export const cycleTerminalAgent = (
  agents: readonly AgentView[],
  currentId: string,
  delta: number,
): AgentView | undefined => {
  if (agents.length < 2) return undefined;
  const currentIndex = agents.findIndex((agent) => agent.id === currentId);
  const index = currentIndex < 0 ? 0 : currentIndex;
  return agents[(index + delta + agents.length) % agents.length];
};
