import type { AgentObservationModule } from "../agent-observations/types.ts";
import { enrichCatchUp, enrichCommandCentre, enrichMap } from "../agent-observations/projection.ts";
import { mapFromCommandCentre } from "../projection/projection.ts";
import type { Universe } from "../universe/universe.ts";
import type { PortfolioResponse } from "./protocol/index.ts";

export type { PortfolioResponse };

export interface PortfolioLimits {
  readonly maximumAgents?: number;
  readonly maximumTransitions?: number;
}

export const projectPortfolio = (
  universe: Universe,
  now: number,
  agentObservations?: AgentObservationModule,
  limits?: PortfolioLimits,
): PortfolioResponse | undefined => {
  const commandCentre = universe.project({
    kind: "command-centre",
    now,
    maximumAgents: limits?.maximumAgents,
  });
  const catchUp = universe.project({
    kind: "catch-up",
    now,
    maximumTransitions: limits?.maximumTransitions,
  });
  if (commandCentre.kind !== "command-centre" || catchUp.kind !== "catch-up") return undefined;
  const map = mapFromCommandCentre(commandCentre, universe.snapshot().agents);
  if (!agentObservations) return { map, commandCentre, catchUp };
  const evidence = agentObservations.snapshot();
  const enrichedCommandCentre = enrichCommandCentre(commandCentre, evidence);
  return {
    map: enrichMap(map, enrichedCommandCentre),
    commandCentre: enrichedCommandCentre,
    catchUp: enrichCatchUp(catchUp, evidence, enrichedCommandCentre),
  };
};
