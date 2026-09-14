import type { AgentView, CommandCentreProjection } from "../../../src/projection/types.ts";

export type NavigationView = "all" | "attention" | "unassigned";

/** One System's slice of a rendered Agent tree: its Goals and its direct Agents. */
export interface AgentOrderGroup {
  readonly goals: readonly { readonly agents: readonly AgentView[] }[];
  readonly agents: readonly AgentView[];
}

export const needsHumanInput = (agent: AgentView): boolean =>
  agent.attention?.requiresHumanInput === true;

/**
 * Agents in the order a System tree renders them: for each System its Goals'
 * Agents then its directly placed Agents, and Inbox last.
 *
 * This is the single definition of visible order. Range selection reads it so
 * that Shift-click, Shift-arrow and the marquee all extend over the same
 * sequence, and no surface can invent its own.
 */
export const flattenAgentOrder = (
  systems: readonly AgentOrderGroup[],
  unassigned: readonly AgentView[],
): readonly AgentView[] => [
  ...systems.flatMap((system) => [
    ...system.goals.flatMap((goal) => goal.agents),
    ...system.agents,
  ]),
  ...unassigned,
];

/** The Agents one navigation view shows, in the order the navigator renders them. */
export const agentsInView = (
  projection: CommandCentreProjection,
  view: NavigationView,
): readonly AgentView[] => {
  if (view === "all") return flattenAgentOrder(projection.systems, projection.unassigned);
  if (view === "unassigned") return [...projection.unassigned];
  // Needs you keeps each Goal's attention-bearing Agents and filters direct placement.
  const attentionGoals = projection.goals.map((goal) => ({
    ...goal,
    agents: goal.agents.filter(needsHumanInput),
  }));
  return flattenAgentOrder(
    projection.systems.map((system) => ({
      goals: attentionGoals.filter((goal) => goal.systemId === system.id),
      agents: system.agents.filter(needsHumanInput),
    })),
    projection.unassigned.filter(needsHumanInput),
  );
};

/** Every accepted Agent in one projection, regardless of the active view. */
export const allAgents = (projection: CommandCentreProjection): readonly AgentView[] =>
  flattenAgentOrder(projection.systems, projection.unassigned);
