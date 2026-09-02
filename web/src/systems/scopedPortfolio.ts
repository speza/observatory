import type {
  AgentView,
  CommandCentreProjection,
  UniverseMapProjection,
} from "../../../src/projection/types.ts";
import type { PortfolioResponse } from "../../../src/web/api.ts";
import { NO_SYSTEM_SCOPE } from "./systemScope.ts";

export interface ScopedPortfolio {
  readonly commandCentre: CommandCentreProjection;
  readonly map: UniverseMapProjection;
  readonly workingAgentCount: number;
}

const agentsFor = (projection: CommandCentreProjection): readonly AgentView[] => [
  ...projection.goals.flatMap((goal) => goal.agents),
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
        goals: portfolio.map.goals.filter((goal) =>
          selectedSystemId === NO_SYSTEM_SCOPE
            ? goal.systemId === undefined
            : goal.systemId === selectedSystemId,
        ),
        counts: commandCentre.counts,
      }
    : portfolio.map;

  return {
    commandCentre,
    map,
    workingAgentCount: agentsFor(commandCentre).filter(
      (agent) => agent.runtimeState === "working" && agent.hostHealth === "live",
    ).length,
  };
};

const scopeCommandCentre = (
  projection: CommandCentreProjection,
  selectedSystemId: string,
): CommandCentreProjection => {
  const goals = projection.goals.filter((goal) =>
    selectedSystemId === NO_SYSTEM_SCOPE
      ? goal.systemId === undefined
      : goal.systemId === selectedSystemId,
  );
  const goalIds = new Set(goals.map((goal) => goal.id));
  const agents = goals.flatMap((goal) => goal.agents);
  const attentionItems = projection.attention.items.filter(
    (item) => item.targetType === "host" || (item.goalId ? goalIds.has(item.goalId) : false),
  );

  return {
    ...projection,
    systems: projection.systems.filter((system) => system.id === selectedSystemId),
    goals,
    attention: {
      items: attentionItems,
      currentCount: attentionItems.filter((item) => item.requiresHumanInput).length,
      uncertaintyCount: attentionItems.filter((item) => !item.requiresHumanInput).length,
    },
    counts: {
      ...projection.counts,
      systems: selectedSystemId === NO_SYSTEM_SCOPE ? 0 : 1,
      goals: goals.length,
      agents: agents.length,
      attention: goals.reduce((total, goal) => total + goal.attentionCount, 0),
      uncertainty: goals.reduce((total, goal) => total + goal.staleCount, 0),
      stale: agents.filter((agent) => agent.observationHealth !== "fresh").length,
    },
  };
};
