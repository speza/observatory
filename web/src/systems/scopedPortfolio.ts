import type {
  AgentView,
  CommandCentreProjection,
  UniverseMapProjection,
} from "../../../src/projection/types.ts";
import type { PortfolioResponse } from "../../../src/web/protocol/index.ts";

export interface ScopedPortfolio {
  readonly commandCentre: CommandCentreProjection;
  readonly map: UniverseMapProjection;
  readonly workingAgentCount: number;
}

const agentsFor = (projection: CommandCentreProjection): readonly AgentView[] => [
  ...projection.goals.flatMap((goal) => goal.agents),
  ...projection.systems.flatMap((system) => system.agents),
  ...projection.unassigned,
];

export const scopePortfolio = (
  portfolio: PortfolioResponse,
  selectedSystemId: string | undefined,
): ScopedPortfolio => {
  const commandCentre = selectedSystemId
    ? scopeCommandCentre(portfolio.commandCentre, selectedSystemId)
    : portfolio.commandCentre;
  const map = selectedSystemId
    ? {
        ...portfolio.map,
        goals: portfolio.map.goals.filter((goal) => goal.systemId === selectedSystemId),
        workspaces: portfolio.map.workspaces.flatMap((workspace) => {
          const goalIds = new Set(commandCentre.goals.map((goal) => goal.id));
          const agents = workspace.agents.filter((agent) =>
            agent.primaryGoalId
              ? goalIds.has(agent.primaryGoalId)
              : agent.systemId === selectedSystemId,
          );
          return agents.length === 0
            ? []
            : [
                {
                  ...workspace,
                  agents,
                  goalIds: [...new Set(agents.flatMap((agent) => agent.primaryGoalId ?? []))],
                  attentionCount: agents.filter((agent) => agent.attention?.requiresHumanInput)
                    .length,
                  uncertaintyCount: agents.filter(
                    (agent) =>
                      agent.observationHealth !== "fresh" ||
                      agent.executionPresence === "unknown" ||
                      agent.executionPresence === "conflict",
                  ).length,
                },
              ];
        }),
        workspaceLess: portfolio.map.workspaceLess.filter((agent) =>
          agent.primaryGoalId
            ? commandCentre.goals.some((goal) => goal.id === agent.primaryGoalId)
            : agent.systemId === selectedSystemId,
        ),
        unassigned: [],
        counts: commandCentre.counts,
      }
    : portfolio.map;

  return {
    commandCentre,
    map,
    workingAgentCount: agentsFor(commandCentre).filter(
      (agent) => agent.runtimeState === "working" && agent.executionPresence === "live",
    ).length,
  };
};

const scopeCommandCentre = (
  projection: CommandCentreProjection,
  selectedSystemId: string,
): CommandCentreProjection => {
  const goals = projection.goals.filter((goal) => goal.systemId === selectedSystemId);
  const goalIds = new Set(goals.map((goal) => goal.id));
  const directAgents =
    projection.systems.find((system) => system.id === selectedSystemId)?.agents ?? [];
  const agents = [...goals.flatMap((goal) => goal.agents), ...directAgents];
  const attentionItems = projection.attention.items.filter(
    (item) =>
      item.targetType === "host" ||
      (item.goalId ? goalIds.has(item.goalId) : agents.some((agent) => agent.id === item.agentId)),
  );

  return {
    ...projection,
    systems: projection.systems
      .filter((system) => system.id === selectedSystemId)
      .map((system) => ({ ...system, agents: directAgents })),
    goals,
    unassigned: [],
    attention: {
      items: attentionItems,
      currentCount: attentionItems.filter((item) => item.requiresHumanInput).length,
      uncertaintyCount: attentionItems.filter((item) => !item.requiresHumanInput).length,
    },
    counts: {
      ...projection.counts,
      systems: 1,
      goals: goals.length,
      agents: agents.length,
      attention:
        directAgents.filter((agent) => agent.attention?.requiresHumanInput).length +
        goals.reduce((total, goal) => total + goal.attentionCount, 0),
      uncertainty:
        directAgents.filter(
          (agent) =>
            agent.observationHealth !== "fresh" ||
            agent.executionPresence === "unknown" ||
            agent.executionPresence === "conflict",
        ).length + goals.reduce((total, goal) => total + goal.staleCount, 0),
      stale: agents.filter((agent) => agent.observationHealth !== "fresh").length,
    },
  };
};
