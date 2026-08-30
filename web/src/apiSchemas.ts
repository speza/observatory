import { Option, Schema } from "effect";

const Priority = Schema.Literal("P0", "P1", "P2", "P3");
const RuntimeState = Schema.Literal("idle", "working", "waiting", "blocked", "done", "unknown");
const MapPosition = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const ExecutionContainer = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
});
const AttentionItem = Schema.Struct({
  id: Schema.String,
  targetType: Schema.Literal("agent", "host"),
  targetId: Schema.String,
  agentId: Schema.optional(Schema.String),
  goalId: Schema.optional(Schema.String),
  reason: Schema.Literal("blocked", "waiting", "host-stale"),
  requiresHumanInput: Schema.Boolean,
  startedAt: Schema.Number,
  lastChangedAt: Schema.Number,
  ageMs: Schema.Number,
  priority: Priority,
  runtimeState: RuntimeState,
  explanation: Schema.String,
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
const AgentFields = {
  id: Schema.String,
  execution: Schema.optional(
    Schema.Struct({
      hostKind: Schema.String,
      hostInstanceId: Schema.String,
      nativeId: Schema.String,
      hostLocator: Schema.String,
      observedAt: Schema.Number,
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
    "resumable",
    "possibly-running",
    "unavailable",
    "unidentified-execution",
    "continuity-lost",
    "stale-observation",
    "conflict",
  ),
  executionConflictCount: Schema.Number,
  displayName: Schema.String,
  displayNameSource: Schema.Literal("host", "human"),
  description: Schema.optional(Schema.String),
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
  executionContainer: Schema.optional(ExecutionContainer),
  archivedAt: Schema.optional(Schema.Number),
  goalTitle: Schema.optional(Schema.String),
  attention: Schema.optional(AttentionItem),
};
const AgentView = Schema.Struct(AgentFields);
const MapAgentView = Schema.Struct({ ...AgentFields, mapPosition: MapPosition });
const GoalFields = {
  id: Schema.String,
  systemId: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.String),
  priority: Priority,
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
  goals: Schema.Array(GoalView),
  agentCount: Schema.Number,
  workingCount: Schema.Number,
  attentionCount: Schema.Number,
  staleCount: Schema.Number,
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
const PortfolioCounts = Schema.Struct({
  systems: Schema.Number,
  goals: Schema.Number,
  agents: Schema.Number,
  attention: Schema.Number,
  uncertainty: Schema.Number,
  unassigned: Schema.Number,
  stale: Schema.Number,
});
const CommandCentre = Schema.Struct({
  kind: Schema.Literal("command-centre"),
  generatedAt: Schema.Number,
  host: OptionalHostHealth,
  attention: AttentionProjection,
  systems: Schema.Array(SystemView),
  goals: Schema.Array(GoalView),
  unassigned: Schema.Array(AgentView),
  counts: PortfolioCounts,
});
const UniverseMap = Schema.Struct({
  kind: Schema.Literal("universe-map"),
  generatedAt: Schema.Number,
  host: OptionalHostHealth,
  attention: AttentionProjection,
  goals: Schema.Array(MapGoalView),
  unassigned: Schema.Array(MapAgentView),
  inboxPosition: MapPosition,
  counts: PortfolioCounts,
});
const UniverseChange = Schema.Struct({
  sequence: Schema.Number,
  occurredAt: Schema.Number,
  outcome: Schema.Literal("new", "changed", "attention", "finished", "stale"),
  targetType: Schema.Literal("system", "goal", "agent"),
  targetId: Schema.String,
  goalId: Schema.optional(Schema.String),
  summary: Schema.String,
});
const CatchUpGroup = Schema.Struct({
  outcome: Schema.Literal("new", "changed", "attention", "finished", "stale"),
  label: Schema.String,
  items: Schema.Array(UniverseChange),
});
const CatchUp = Schema.Struct({
  kind: Schema.Literal("catch-up"),
  generatedAt: Schema.Number,
  sinceAt: Schema.optional(Schema.Number),
  throughSequence: Schema.Number,
  transitionCount: Schema.Number,
  pending: Schema.Boolean,
  groups: Schema.Array(CatchUpGroup),
  counts: Schema.Record({
    key: Schema.Literal("new", "changed", "attention", "finished", "stale"),
    value: Schema.Number,
  }),
});
const CloseoutGoalCount = Schema.Struct({
  goalId: Schema.optional(Schema.String),
  goalTitle: Schema.String,
  results: Schema.Number,
  ended: Schema.Number,
});
const Closeout = Schema.Struct({
  kind: Schema.Literal("closeout"),
  generatedAt: Schema.Number,
  results: Schema.Array(AgentView),
  ended: Schema.Array(AgentView),
  goals: Schema.Array(CloseoutGoalCount),
  counts: Schema.Struct({
    results: Schema.Number,
    ended: Schema.Number,
    total: Schema.Number,
  }),
});

export const PortfolioResponseSchema = Schema.Struct({
  map: UniverseMap,
  commandCentre: CommandCentre,
  catchUp: CatchUp,
  closeout: Closeout,
});

export const InspectorProjectionSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("goal-inspector"),
    goal: GoalView,
    lines: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("agent-inspector"),
    agent: AgentView,
    providerSession: Schema.optional(
      Schema.Struct({
        kind: Schema.String,
        id: Schema.String,
      }),
    ),
    lines: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("empty-inspector"), lines: Schema.Array(Schema.String) }),
);

export const SearchProjectionSchema = Schema.Struct({
  kind: Schema.Literal("search"),
  query: Schema.String,
  results: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("goal", "agent"),
      id: Schema.String,
      label: Schema.String,
      context: Schema.String,
      status: Schema.String,
      goalId: Schema.optional(Schema.String),
    }),
  ),
});

const CommandResult = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  affectedAgentIds: Schema.optional(Schema.Array(Schema.String)),
  checkpointSequence: Schema.optional(Schema.Number),
});
export const CommandResponseSchema = Schema.Struct({
  result: CommandResult,
  portfolio: PortfolioResponseSchema,
});

const PreparedWorkspace = Schema.Struct({
  path: Schema.String,
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  worktree: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
});
const StartAgentResult = Schema.Struct({
  status: Schema.Literal("started", "already-observed", "pending", "failed"),
  message: Schema.String,
  requestId: Schema.String,
  goalId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  workspace: Schema.optional(PreparedWorkspace),
  warnings: Schema.optional(Schema.Array(Schema.String)),
});
export const StartAgentResponseSchema = Schema.Struct({
  result: StartAgentResult,
  portfolio: PortfolioResponseSchema,
});

const AgentCloseoutResult = Schema.Struct({
  ok: Schema.Boolean,
  agentId: Schema.String,
  status: Schema.Literal(
    "closed-and-archived",
    "already-ended-and-archived",
    "already-archived",
    "unsupported",
    "rejected",
  ),
  message: Schema.String,
});
export const CloseoutResponseSchema = Schema.Struct({
  result: Schema.Struct({
    ok: Schema.Boolean,
    results: Schema.Array(AgentCloseoutResult),
    message: Schema.String,
  }),
  portfolio: PortfolioResponseSchema,
});

const DiffFileContent = Schema.Struct({
  fileName: Schema.String,
  fileLang: Schema.optional(Schema.String),
  content: Schema.String,
});
const DiffFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.optional(Schema.String),
  status: Schema.Literal("added", "modified", "deleted", "renamed", "copied", "untracked"),
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
  oldFile: Schema.optional(DiffFileContent),
  newFile: Schema.optional(DiffFileContent),
  hunks: Schema.Array(Schema.String),
});
export const WorkingTreeDiffResponseSchema = Schema.Struct({
  kind: Schema.Literal("working-tree-diff"),
  status: Schema.Literal("clean", "changed", "not-git", "unavailable"),
  worktree: Schema.String,
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  files: Schema.Array(DiffFile),
  additions: Schema.Number,
  deletions: Schema.Number,
  truncated: Schema.Boolean,
  generatedAt: Schema.Number,
  message: Schema.optional(Schema.String),
  agentId: Schema.String,
  agentName: Schema.String,
  goalTitle: Schema.optional(Schema.String),
});

const RepositoryIdentity = Schema.Struct({
  host: Schema.String,
  owner: Schema.String,
  name: Schema.String,
});
const RepositoryPluginStatus = Schema.Struct({
  id: Schema.String,
  state: Schema.Literal("ready", "degraded", "disabled"),
  diagnostics: Schema.Array(Schema.String),
});
const RepositoryPullRequest = Schema.Struct({
  providerId: Schema.String,
  repository: RepositoryIdentity,
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literal("open", "closed", "merged"),
  draft: Schema.Boolean,
  baseBranch: Schema.String,
  headBranch: Schema.String,
  head: Schema.String,
  author: Schema.optional(Schema.String),
  checks: Schema.Literal("passing", "pending", "failing", "unknown"),
  review: Schema.Literal("approved", "changes-requested", "review-required", "unknown"),
  mergeability: Schema.Literal("mergeable", "conflicting", "unknown"),
  updatedAt: Schema.optional(Schema.String),
  association: Schema.Literal("confirmed", "candidate", "ambiguous"),
  headSync: Schema.Literal("current", "local-ahead", "different", "unknown"),
});
export const AgentRepositoryStatusResponseSchema = Schema.Struct({
  kind: Schema.Literal("agent-repository-status"),
  agentId: Schema.String,
  status: Schema.Literal("complete", "partial", "unavailable", "not-applicable"),
  observedAt: Schema.Number,
  diagnostics: Schema.Array(Schema.String),
  git: Schema.optional(
    Schema.Struct({
      worktree: Schema.String,
      repository: RepositoryIdentity,
      branch: Schema.optional(Schema.String),
      head: Schema.String,
      detached: Schema.Boolean,
      upstream: Schema.optional(Schema.String),
      ahead: Schema.optional(Schema.Number),
      behind: Schema.optional(Schema.Number),
      diff: WorkingTreeDiffResponseSchema.omit("agentId", "agentName", "goalTitle"),
    }),
  ),
  pullRequests: Schema.Array(RepositoryPullRequest),
  provider: Schema.optional(Schema.String),
  providerCached: Schema.Boolean,
  plugins: Schema.Array(RepositoryPluginStatus),
});
