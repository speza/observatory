import { Schema } from "effect";
import type { WebCommand } from "./protocol.ts";

const MAX_COMMAND_BYTES = 16_384;

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));
const Title = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
const Description = Schema.String.pipe(Schema.maxLength(8_000));
const Priority = Schema.Literal("P0", "P1", "P2", "P3");
const MapCoordinate = Schema.Number.pipe(Schema.finite(), Schema.between(-10_000, 10_000));
const Sequence = Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER));

const WebCommandSchema: Schema.Schema<WebCommand> = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("CreateSystem"),
    title: Title,
    description: Schema.optional(Description),
  }),
  Schema.Struct({ type: Schema.Literal("RenameSystem"), systemId: Id, title: Title }),
  Schema.Struct({
    type: Schema.Literal("SetSystemDescription"),
    systemId: Id,
    description: Schema.optional(Description),
  }),
  Schema.Struct({
    type: Schema.Literal("CreateGoal"),
    title: Title,
    description: Schema.optional(Description),
    priority: Priority,
    systemId: Schema.optional(Id),
  }),
  Schema.Struct({
    type: Schema.Literal("RenameGoal"),
    goalId: Id,
    title: Title,
  }),
  Schema.Struct({
    type: Schema.Literal("SetGoalDescription"),
    goalId: Id,
    description: Schema.optional(Description),
  }),
  Schema.Struct({
    type: Schema.Literal("SetGoalPriority"),
    goalId: Id,
    priority: Priority,
  }),
  Schema.Struct({
    type: Schema.Literal("SetGoalMapPosition"),
    goalId: Id,
    position: Schema.Struct({ x: MapCoordinate, y: MapCoordinate }),
  }),
  Schema.Struct({ type: Schema.Literal("ResetGoalMapPosition"), goalId: Id }),
  Schema.Struct({
    type: Schema.Literal("AssignGoalToSystem"),
    goalId: Id,
    systemId: Schema.optional(Id),
  }),
  Schema.Struct({
    type: Schema.Literal("AssignAgent"),
    agentId: Id,
    goalId: Id,
  }),
  Schema.Struct({
    type: Schema.Literal("AssignAgents"),
    agentIds: Schema.Array(Id).pipe(Schema.minItems(1), Schema.maxItems(500)),
    goalId: Id,
  }),
  Schema.Struct({ type: Schema.Literal("UnassignAgent"), agentId: Id }),
  Schema.Struct({ type: Schema.Literal("ArchiveAgent"), agentId: Id }),
  Schema.Struct({
    type: Schema.Literal("ArchiveAgents"),
    agentIds: Schema.Array(Id).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
  Schema.Struct({ type: Schema.Literal("CompleteGoal"), goalId: Id }),
  Schema.Struct({ type: Schema.Literal("ArchiveGoal"), goalId: Id }),
  Schema.Struct({
    type: Schema.Literal("AcknowledgeCatchUp"),
    throughSequence: Sequence,
    evidenceThroughSequence: Sequence,
  }),
);

export class WebCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const decodeWebCommand = (text: string): WebCommand => {
  if (text.length > MAX_COMMAND_BYTES) throw new WebCommandError("Command body is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(WebCommandSchema))(text);
  } catch {
    throw new WebCommandError("Command body does not match the web command contract.", 400);
  }
};
