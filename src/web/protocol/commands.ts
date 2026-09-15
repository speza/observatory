import { Schema } from "effect";
import { WebPrioritySchema } from "./vocabulary.ts";
import { PendingLaunchSchema, WebPortfolioResponseSchema } from "./views.ts";

/**
 * Browser→server request contracts and their responses. Domain types map onto
 * these shapes at the gateway edge.
 */

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));
const Title = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
const Description = Schema.String.pipe(Schema.maxLength(8_000));
const MapCoordinate = Schema.Number.pipe(Schema.finite(), Schema.between(-10_000, 10_000));
const Sequence = Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER));

/** Browser mutations; the gateway validates this contract before `Universe.execute`. */
export const WebCommandSchema = Schema.Union(
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
    priority: WebPrioritySchema,
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
    priority: WebPrioritySchema,
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
  Schema.Struct({
    type: Schema.Literal("AssignAgentToSystem"),
    agentId: Id,
    systemId: Id,
  }),
  Schema.Struct({
    type: Schema.Literal("AssignAgentsToSystem"),
    agentIds: Schema.Array(Id).pipe(Schema.minItems(1), Schema.maxItems(500)),
    systemId: Id,
  }),
  Schema.Struct({ type: Schema.Literal("UnassignAgent"), agentId: Id }),
  Schema.Struct({
    type: Schema.Literal("UnassignAgents"),
    agentIds: Schema.Array(Id).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
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
export type WebCommand = Schema.Schema.Type<typeof WebCommandSchema>;

const CommandResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  affectedAgentIds: Schema.optional(Schema.Array(Schema.String)),
  checkpointSequence: Schema.optional(Schema.Number),
});
export type WebCommandResult = Schema.Schema.Type<typeof CommandResultSchema>;

export const CommandResponseSchema = Schema.Struct({
  result: CommandResultSchema,
  portfolio: WebPortfolioResponseSchema,
});
export type WebCommandResponse = Schema.Schema.Type<typeof CommandResponseSchema>;

const LaunchId = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
const Path = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4_096));
const OptionalName = Schema.optional(Schema.String.pipe(Schema.maxLength(240)));
const OptionalPrompt = Schema.optional(Schema.String.pipe(Schema.maxLength(16_384)));

export const WebWorkspaceSelectionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("existing"), path: Path }),
  Schema.Struct({
    kind: Schema.Literal("worktree"),
    repositoryPath: Path,
    branch: LaunchId,
    base: Schema.optional(LaunchId),
    path: Schema.optional(Path),
  }),
);

export const WebStartAgentRequestSchema = Schema.Struct({
  requestId: LaunchId,
  goalId: Schema.optional(LaunchId),
  systemId: Schema.optional(LaunchId),
  workspace: WebWorkspaceSelectionSchema,
  harnessId: LaunchId,
  agentName: OptionalName,
  prompt: OptionalPrompt,
});
export type WebStartAgentRequest = Schema.Schema.Type<typeof WebStartAgentRequestSchema>;

export const WebResumeAgentRequestSchema = Schema.Struct({
  requestId: LaunchId,
  agentId: LaunchId,
  prompt: OptionalPrompt,
});
export type WebResumeAgentRequest = Schema.Schema.Type<typeof WebResumeAgentRequestSchema>;

const PreparedWorkspaceSchema = Schema.Struct({
  path: Schema.String,
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  worktree: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
});

const StartAgentResultSchema = Schema.Struct({
  status: Schema.Literal("started", "already-observed", "pending", "failed"),
  message: Schema.String,
  requestId: Schema.String,
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  workspace: Schema.optional(PreparedWorkspaceSchema),
  warnings: Schema.optional(Schema.Array(Schema.String)),
});

export const StartAgentResponseSchema = Schema.Struct({
  result: StartAgentResultSchema,
  portfolio: WebPortfolioResponseSchema,
  pendingLaunch: Schema.optional(PendingLaunchSchema),
});
export type WebStartAgentResponse = Schema.Schema.Type<typeof StartAgentResponseSchema>;
export type WebResumeAgentResponse = WebStartAgentResponse;
