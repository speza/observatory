import { Option, Schema } from "effect";
import { WebPrioritySchema } from "./vocabulary.ts";
import type {
  AgentView as ProjectionAgentView,
  CatchUpProjection as ProjectionCatchUp,
  CatchUpSubject as ProjectionCatchUpSubject,
  CommandCentreProjection as ProjectionCommandCentre,
  DiscoveredExecutionView as ProjectionDiscoveredExecution,
  EvidenceCatchUpGroup as ProjectionEvidenceCatchUpGroup,
  GoalView as ProjectionGoalView,
  InspectorProjection as ProjectionInspector,
  MapAgentView as ProjectionMapAgentView,
  MapDiscoveredExecutionView as ProjectionMapDiscoveredExecution,
  MapGoalView as ProjectionMapGoalView,
  MapWorkspaceView as ProjectionMapWorkspace,
  SearchProjection as ProjectionSearch,
  SystemView as ProjectionSystemView,
  UniverseMapProjection as ProjectionUniverseMap,
} from "../../projection/types.ts";

/**
 * The transport-neutral read contract. Shapes mirror the projection module's
 * views; the closing assertions hold the contract to those views, so a
 * projection change that breaks the wire fails here at compile time.
 */

const RuntimeState = Schema.Literal("idle", "working", "waiting", "blocked", "done", "unknown");
const MapPosition = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const AttentionReason = Schema.Literal(
  "blocked",
  "waiting",
  "archived-running",
  "runtime-complete",
  "ended-externally",
  "runtime-unknown",
  "provider-input",
  "provider-failure",
  "provider-complete",
  "context-pressure",
  "provider-stale",
  "provider-conflict",
);
const AttentionAction = Schema.Literal("respond", "review", "resolve", "monitor");
const SupportingAttentionSignal = Schema.Struct({
  id: Schema.String,
  reason: AttentionReason,
  action: AttentionAction,
  startedAt: Schema.Number,
  lastChangedAt: Schema.Number,
  ageMs: Schema.Number,
  explanation: Schema.String,
});
const AttentionItem = Schema.Struct({
  id: Schema.String,
  targetType: Schema.Literal("agent", "host"),
  targetId: Schema.String,
  agentId: Schema.optional(Schema.String),
  goalId: Schema.optional(Schema.String),
  reason: AttentionReason,
  action: AttentionAction,
  requiresHumanInput: Schema.Boolean,
  startedAt: Schema.Number,
  lastChangedAt: Schema.Number,
  ageMs: Schema.Number,
  priority: WebPrioritySchema,
  runtimeState: RuntimeState,
  explanation: Schema.String,
  supportingSignals: Schema.optional(Schema.Array(SupportingAttentionSignal)),
});
const AttentionProjection = Schema.Struct({
  items: Schema.Array(AttentionItem),
  currentCount: Schema.Number,
  uncertaintyCount: Schema.Number,
});
const HostHealth = Schema.Struct({
  hostKind: Schema.String,
  hostInstanceId: Schema.String,
  status: Schema.Literal("live", "stale", "unavailable"),
  lastObservedAt: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
  diagnosticCount: Schema.Number,
});
const OptionalHostHealth = Schema.optionalToRequired(HostHealth, Schema.UndefinedOr(HostHealth), {
  decode: Option.getOrUndefined,
  encode: Option.fromNullable,
});
const ExecutionPresentation = Schema.Struct({
  group: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
});
const AgentFields = {
  id: Schema.String,
  execution: Schema.optional(
    Schema.Struct({
      hostKind: Schema.String,
    }),
  ),
  harnessId: Schema.optional(Schema.String),
  continuity: Schema.Literal("proved", "interrupted", "replaced", "unknown"),
  providerContinuity: Schema.Literal("confirmed", "missing", "unknown"),
  executionPresence: Schema.Literal("live", "absent", "unknown", "conflict"),
  resumeCapability: Schema.Literal("eligible", "blocked", "unsupported", "unknown"),
  observationHealth: Schema.Literal("fresh", "stale", "unavailable"),
  providerObservedAt: Schema.optional(Schema.Number),
  executionObservedAt: Schema.optional(Schema.Number),
  canResume: Schema.Boolean,
  lifecycleState: Schema.Literal(
    "running",
    "dormant",
    "runtime-unknown",
    "conversation-unavailable",
    "conflict",
  ),
  executionConflictCount: Schema.Number,
  displayName: Schema.String,
  displayNameSource: Schema.Literal("human", "provider", "fallback"),
  description: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  primaryGoalId: Schema.optional(Schema.String),
  runtimeState: RuntimeState,
  runtimeStateSource: Schema.String,
  hostHealth: Schema.Literal("live", "stale", "unavailable"),
  lastSeenAt: Schema.Number,
  lastObservedAt: Schema.Number,
  lastChangedAt: Schema.Number,
  attentionSince: Schema.optional(Schema.Number),
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  archivedAt: Schema.optional(Schema.Number),
  goalTitle: Schema.optional(Schema.String),
  systemTitle: Schema.optional(Schema.String),
  workspaceLabel: Schema.optional(Schema.String),
  executionPresentation: Schema.optional(ExecutionPresentation),
  attention: Schema.optional(AttentionItem),
  providerEvidence: Schema.optional(
    Schema.Struct({
      providerLabel: Schema.String,
      mechanism: Schema.optional(Schema.Literal("hook", "structured-api", "metadata")),
      health: Schema.Literal(
        "unsupported",
        "not-configured",
        "healthy",
        "stale",
        "unavailable",
        "degraded",
      ),
      observedAt: Schema.optional(Schema.Number),
      ageMs: Schema.optional(Schema.Number),
      activity: Schema.optional(Schema.Literal("responding", "using-tool", "compacting", "idle")),
      toolCategory: Schema.optional(
        Schema.Literal("read", "write", "execute", "search", "network", "delegate", "other"),
      ),
      request: Schema.optional(
        Schema.Struct({
          kind: Schema.Literal("permission", "question", "plan-approval", "other"),
          state: Schema.Literal("open", "resolved", "withdrawn"),
        }),
      ),
      outcome: Schema.optional(Schema.Literal("response-completed", "failed", "interrupted")),
      failureCategory: Schema.optional(Schema.String),
      contextBand: Schema.optional(Schema.Literal("normal", "elevated", "critical")),
      compaction: Schema.optional(Schema.Literal("started", "completed")),
      hostConflict: Schema.optional(
        Schema.Struct({
          hostState: Schema.Literal("waiting", "blocked", "done"),
          providerActivity: Schema.Literal("responding", "using-tool", "compacting"),
        }),
      ),
      supportedKinds: Schema.Array(
        Schema.Literal("activity", "human-input-request", "turn-outcome", "context-pressure"),
      ),
    }),
  ),
};
const AgentView = Schema.Struct(AgentFields);
const MapAgentView = Schema.Struct({ ...AgentFields, mapPosition: MapPosition });
const GoalFields = {
  id: Schema.String,
  systemId: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.String),
  priority: WebPrioritySchema,
  status: Schema.Literal("active", "completed", "archived"),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  archivedAt: Schema.optional(Schema.Number),
  mapPosition: Schema.optional(MapPosition),
  mapPositionPinned: Schema.optional(Schema.Boolean),
};
const GoalView = Schema.Struct({
  ...GoalFields,
  agents: Schema.Array(AgentView),
  attentionCount: Schema.Number,
  staleCount: Schema.Number,
});
const SystemView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  agents: Schema.Array(AgentView),
  goals: Schema.Array(GoalView),
  agentCount: Schema.Number,
  workingCount: Schema.Number,
  attentionCount: Schema.Number,
  staleCount: Schema.Number,
});
const DiscoveredExecutionFields = {
  type: Schema.Literal("discovered-execution"),
  handle: Schema.String,
  displayName: Schema.String,
  hostKind: Schema.String,
  runtimeState: RuntimeState,
  runtimeStateSource: Schema.String,
  presence: Schema.Literal("live", "unknown"),
  observationHealth: Schema.Literal("fresh", "unknown", "unavailable"),
  lastObservedAt: Schema.Number,
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  executionPresentation: Schema.optional(ExecutionPresentation),
  conversation: Schema.optional(Schema.Struct({ kind: Schema.String, id: Schema.String })),
  conversationIdentified: Schema.Boolean,
  conversationTitle: Schema.optional(Schema.String),
  resumeEligibility: Schema.optional(
    Schema.Literal("same-site", "provider-account", "blocked", "unknown"),
  ),
  admission: Schema.Union(
    Schema.Struct({
      status: Schema.Literal("available"),
      resumeEligibility: Schema.Literal("same-site", "provider-account", "blocked", "unknown"),
    }),
    Schema.Struct({ status: Schema.Literal("unavailable"), explanation: Schema.String }),
  ),
  conversationConflictCount: Schema.Number,
};
const DiscoveredExecution = Schema.Struct(DiscoveredExecutionFields);
const MapDiscoveredExecution = Schema.Struct({
  ...DiscoveredExecutionFields,
  mapPosition: MapPosition,
});
const MapGoalView = Schema.Struct({
  ...GoalFields,
  mapPosition: MapPosition,
  agents: Schema.Array(MapAgentView),
  attentionCount: Schema.Number,
  staleCount: Schema.Number,
  radiusX: Schema.Number,
  radiusY: Schema.Number,
});
const MapWorkspace = Schema.Struct({
  label: Schema.String,
  mapPosition: MapPosition,
  agents: Schema.Array(MapAgentView),
  goalIds: Schema.Array(Schema.String),
  attentionCount: Schema.Number,
  uncertaintyCount: Schema.Number,
});
const PortfolioCounts = Schema.Struct({
  systems: Schema.Number,
  goals: Schema.Number,
  agents: Schema.Number,
  attention: Schema.Number,
  uncertainty: Schema.Number,
  unassigned: Schema.Number,
  stale: Schema.Number,
  discovered: Schema.optional(Schema.Number),
});
const CommandCentre = Schema.Struct({
  kind: Schema.Literal("command-centre"),
  generatedAt: Schema.Number,
  host: OptionalHostHealth,
  attention: AttentionProjection,
  systems: Schema.Array(SystemView),
  goals: Schema.Array(GoalView),
  unassigned: Schema.Array(AgentView),
  truncated: Schema.optional(Schema.Boolean),
  omittedAgentCount: Schema.optional(Schema.Number),
  discoveredExecutions: Schema.optional(Schema.Array(DiscoveredExecution)),
  counts: PortfolioCounts,
});
const UniverseMap = Schema.Struct({
  kind: Schema.Literal("universe-map"),
  generatedAt: Schema.Number,
  host: OptionalHostHealth,
  attention: AttentionProjection,
  workspaces: Schema.Array(MapWorkspace),
  workspaceLess: Schema.Array(MapAgentView),
  goals: Schema.Array(MapGoalView),
  unassigned: Schema.Array(MapAgentView),
  discoveredExecutions: Schema.optional(Schema.Array(MapDiscoveredExecution)),
  inboxPosition: MapPosition,
  truncated: Schema.optional(Schema.Boolean),
  omittedAgentCount: Schema.optional(Schema.Number),
  counts: PortfolioCounts,
});
const UniverseChange = Schema.Struct({
  sequence: Schema.Number,
  occurredAt: Schema.Number,
  outcome: Schema.Literal("new", "changed", "attention", "finished", "stale"),
  targetType: Schema.Literal("system", "goal", "agent"),
  targetId: Schema.String,
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  summary: Schema.String,
});
const EvidenceCatchUpGroup = Schema.Struct({
  kind: Schema.Literal("activity", "human-input-request", "turn-outcome", "context-pressure"),
  label: Schema.String,
  items: Schema.Array(
    Schema.Struct({
      sequence: Schema.Number,
      agentId: Schema.String,
      occurredAt: Schema.Number,
      summary: Schema.String,
    }),
  ),
});
const CatchUpSubject = Schema.Struct({
  id: Schema.String,
  subjectType: Schema.Literal("system", "goal", "unassigned"),
  subjectId: Schema.optional(Schema.String),
  title: Schema.String,
  occurredAt: Schema.Number,
  sequence: Schema.Number,
  outcome: Schema.Literal("new", "changed", "attention", "finished", "stale"),
  affectedTargetCount: Schema.Number,
  transitionCount: Schema.Number,
  summaries: Schema.Array(
    Schema.Struct({
      kind: Schema.Literal(
        "attention",
        "attention-resolved",
        "finished",
        "new",
        "changed",
        "stale",
        "stale-resolved",
      ),
      count: Schema.Number,
      label: Schema.String,
    }),
  ),
  transitions: Schema.Array(UniverseChange),
  evidenceTransitionCount: Schema.optional(Schema.Number),
  evidenceGroups: Schema.optional(Schema.Array(EvidenceCatchUpGroup)),
});
const CatchUp = Schema.Struct({
  kind: Schema.Literal("catch-up"),
  generatedAt: Schema.Number,
  sinceAt: Schema.optional(Schema.Number),
  throughSequence: Schema.Number,
  evidenceThroughSequence: Schema.Number,
  transitionCount: Schema.Number,
  pending: Schema.Boolean,
  subjects: Schema.Array(CatchUpSubject),
  counts: Schema.Record({
    key: Schema.Literal("new", "changed", "attention", "finished", "stale"),
    value: Schema.Number,
  }),
  truncated: Schema.optional(Schema.Boolean),
  omittedTransitionCount: Schema.optional(Schema.Number),
  evidenceTransitionCount: Schema.optional(Schema.Number),
});
export const PortfolioResponseSchema = Schema.Struct({
  map: UniverseMap,
  commandCentre: CommandCentre,
  catchUp: CatchUp,
});
export type PortfolioResponse = Schema.Schema.Type<typeof PortfolioResponseSchema>;

const PendingLaunch = Schema.Struct({
  requestId: Schema.String,
  harnessId: Schema.String,
  displayName: Schema.String,
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  message: Schema.String,
});
export const PendingLaunchSchema = PendingLaunch;
export type WebPendingLaunch = Schema.Schema.Type<typeof PendingLaunchSchema>;

export const WebPendingLaunchesResponseSchema = Schema.Struct({
  kind: Schema.Literal("pending-launches"),
  launches: Schema.Array(PendingLaunch),
});
export type WebPendingLaunchesResponse = Schema.Schema.Type<
  typeof WebPendingLaunchesResponseSchema
>;

export const WebPortfolioResponseSchema = Schema.Struct({
  ...PortfolioResponseSchema.fields,
  epoch: Schema.String,
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  pendingLaunches: Schema.Array(PendingLaunch),
});
export type WebPortfolioResponse = Schema.Schema.Type<typeof WebPortfolioResponseSchema>;

const RendererSubject = Schema.Struct({
  type: Schema.Literal("system", "goal", "agent", "discovered-execution"),
  id: Schema.String,
});
export type RendererSubject = Schema.Schema.Type<typeof RendererSubject>;

const ProjectionEventFields = {
  epoch: Schema.String,
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  generatedAt: Schema.Number,
  affected: Schema.Array(RendererSubject),
  affectedAll: Schema.Boolean,
};
export const BrowserProjectionEventSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    ...ProjectionEventFields,
    portfolio: PortfolioResponseSchema,
    pendingLaunches: Schema.Array(PendingLaunch),
  }),
  Schema.Struct({
    kind: Schema.Literal("portfolio-replaced"),
    ...ProjectionEventFields,
    portfolio: PortfolioResponseSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("pending-launches-replaced"),
    ...ProjectionEventFields,
    pendingLaunches: Schema.Array(PendingLaunch),
  }),
);
export type BrowserProjectionEvent = Schema.Schema.Type<typeof BrowserProjectionEventSchema>;
export type BrowserProjectionSnapshot = Extract<
  BrowserProjectionEvent,
  { readonly kind: "snapshot" }
>;

export const InspectorProjectionSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("goal-inspector"),
    goal: GoalView,
    lines: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("agent-inspector"),
    agent: AgentView,
    conversation: Schema.optional(
      Schema.Struct({
        kind: Schema.String,
        id: Schema.String,
      }),
    ),
    lines: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("discovered-execution-inspector"),
    execution: DiscoveredExecution,
    lines: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("empty-inspector"), lines: Schema.Array(Schema.String) }),
);

export const SearchProjectionSchema = Schema.Struct({
  kind: Schema.Literal("search"),
  query: Schema.String,
  results: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("goal", "agent", "discovered-execution"),
      id: Schema.String,
      label: Schema.String,
      context: Schema.String,
      status: Schema.String,
      goalId: Schema.optional(Schema.String),
      systemId: Schema.optional(Schema.String),
    }),
  ),
});

/**
 * The contract is held to the projections it delivers: every wire shape must be
 * mutually assignable with the transport-neutral view it carries. Each pair is
 * asserted in both directions with one-directional constraints.
 */
type AssertExtends<A extends B, B> = readonly [A, B];
type CommandCentreData = Schema.Schema.Type<typeof CommandCentre>;
type UniverseMapData = Schema.Schema.Type<typeof UniverseMap>;
type CatchUpData = Schema.Schema.Type<typeof CatchUp>;
type AgentViewData = Schema.Schema.Type<typeof AgentView>;
type GoalViewData = Schema.Schema.Type<typeof GoalView>;
type SystemViewData = Schema.Schema.Type<typeof SystemView>;
type DiscoveredExecutionData = Schema.Schema.Type<typeof DiscoveredExecution>;
type MapAgentViewData = Schema.Schema.Type<typeof MapAgentView>;
type MapGoalViewData = Schema.Schema.Type<typeof MapGoalView>;
type MapWorkspaceData = Schema.Schema.Type<typeof MapWorkspace>;
type MapDiscoveredExecutionData = Schema.Schema.Type<typeof MapDiscoveredExecution>;
type AttentionItemData = Schema.Schema.Type<typeof AttentionItem>;
type AttentionProjectionData = Schema.Schema.Type<typeof AttentionProjection>;
type HostHealthData = Schema.Schema.Type<typeof HostHealth>;
type UniverseChangeData = Schema.Schema.Type<typeof UniverseChange>;
type EvidenceCatchUpGroupData = Schema.Schema.Type<typeof EvidenceCatchUpGroup>;
type CatchUpSubjectData = Schema.Schema.Type<typeof CatchUpSubject>;
type InspectorProjectionData = Schema.Schema.Type<typeof InspectorProjectionSchema>;
type SearchProjectionData = Schema.Schema.Type<typeof SearchProjectionSchema>;

export type WireContractChecks = [
  AssertExtends<CommandCentreData, ProjectionCommandCentre>,
  AssertExtends<ProjectionCommandCentre, CommandCentreData>,
  AssertExtends<UniverseMapData, ProjectionUniverseMap>,
  AssertExtends<ProjectionUniverseMap, UniverseMapData>,
  AssertExtends<CatchUpData, ProjectionCatchUp>,
  AssertExtends<ProjectionCatchUp, CatchUpData>,
  AssertExtends<AgentViewData, ProjectionAgentView>,
  AssertExtends<ProjectionAgentView, AgentViewData>,
  AssertExtends<GoalViewData, ProjectionGoalView>,
  AssertExtends<ProjectionGoalView, GoalViewData>,
  AssertExtends<SystemViewData, ProjectionSystemView>,
  AssertExtends<ProjectionSystemView, SystemViewData>,
  AssertExtends<DiscoveredExecutionData, ProjectionDiscoveredExecution>,
  AssertExtends<ProjectionDiscoveredExecution, DiscoveredExecutionData>,
  AssertExtends<MapAgentViewData, ProjectionMapAgentView>,
  AssertExtends<ProjectionMapAgentView, MapAgentViewData>,
  AssertExtends<MapGoalViewData, ProjectionMapGoalView>,
  AssertExtends<ProjectionMapGoalView, MapGoalViewData>,
  AssertExtends<MapWorkspaceData, ProjectionMapWorkspace>,
  AssertExtends<ProjectionMapWorkspace, MapWorkspaceData>,
  AssertExtends<MapDiscoveredExecutionData, ProjectionMapDiscoveredExecution>,
  AssertExtends<ProjectionMapDiscoveredExecution, MapDiscoveredExecutionData>,
  AssertExtends<AttentionItemData, ProjectionCommandCentre["attention"]["items"][number]>,
  AssertExtends<AttentionProjectionData, ProjectionCommandCentre["attention"]>,
  AssertExtends<HostHealthData, NonNullable<ProjectionCommandCentre["host"]>>,
  AssertExtends<UniverseChangeData, ProjectionCatchUpSubject["transitions"][number]>,
  AssertExtends<EvidenceCatchUpGroupData, ProjectionEvidenceCatchUpGroup>,
  AssertExtends<CatchUpSubjectData, ProjectionCatchUpSubject>,
  AssertExtends<ProjectionCatchUpSubject, CatchUpSubjectData>,
  AssertExtends<InspectorProjectionData, ProjectionInspector>,
  AssertExtends<ProjectionInspector, InspectorProjectionData>,
  AssertExtends<SearchProjectionData, ProjectionSearch>,
  AssertExtends<ProjectionSearch, SearchProjectionData>,
];
