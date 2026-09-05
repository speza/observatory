import type { AgentObservationModule } from "../agent-observations/types.ts";
import { enrichCatchUp, enrichCommandCentre, enrichMap } from "../agent-observations/projection.ts";
import { mapFromCommandCentre } from "../projection/projection.ts";
import type {
  CatchUpProjection,
  CommandCentreProjection,
  UniverseMapProjection,
} from "../projection/types.ts";
import type { Universe } from "../universe/universe.ts";

export interface PortfolioResponse {
  readonly map: UniverseMapProjection;
  readonly commandCentre: CommandCentreProjection;
  readonly catchUp: CatchUpProjection;
}

export const projectPortfolio = (
  universe: Universe,
  now: number,
  agentObservations?: AgentObservationModule,
): PortfolioResponse | undefined => {
  const commandCentre = universe.project({ kind: "command-centre", now });
  const catchUp = universe.project({ kind: "catch-up", now });
  if (commandCentre.kind !== "command-centre" || catchUp.kind !== "catch-up") return undefined;
  const map = mapFromCommandCentre(commandCentre);
  if (!agentObservations) return { map, commandCentre, catchUp };
  const evidence = agentObservations.snapshot();
  const enrichedCommandCentre = enrichCommandCentre(commandCentre, evidence);
  return {
    map: enrichMap(map, enrichedCommandCentre),
    commandCentre: enrichedCommandCentre,
    catchUp: enrichCatchUp(catchUp, evidence, enrichedCommandCentre),
  };
};
