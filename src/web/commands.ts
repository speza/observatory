import { Schema } from "effect";
import type { Universe, UniverseCommand } from "../universe/universe.ts";
import type { WebCommand } from "./protocol.ts";

const MAX_COMMAND_BYTES = 16_384;

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));
const Title = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
const Description = Schema.String.pipe(Schema.maxLength(8_000));
const Priority = Schema.Literal("P0", "P1", "P2", "P3");

const WebCommandSchema: Schema.Schema<WebCommand> = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("CreateGoal"),
    title: Title,
    description: Schema.optional(Description),
    priority: Priority,
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
  Schema.Struct({ type: Schema.Literal("CompleteGoal"), goalId: Id }),
  Schema.Struct({ type: Schema.Literal("ArchiveGoal"), goalId: Id }),
  Schema.Struct({ type: Schema.Literal("AcknowledgeCatchUp") }),
);

export class WebCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const decodeCommand = (text: string): WebCommand => {
  if (text.length > MAX_COMMAND_BYTES) throw new WebCommandError("Command body is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(WebCommandSchema))(text);
  } catch {
    throw new WebCommandError("Command body does not match the web command contract.", 400);
  }
};

export class WebCommandGateway {
  constructor(private readonly universe: Universe) {}

  execute(encoded: string) {
    const command: UniverseCommand = decodeCommand(encoded);
    return this.universe.execute(command);
  }
}
