export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const GOAL_STATUSES = ["active", "completed", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const RUNTIME_STATES = ["idle", "working", "waiting", "blocked", "done", "unknown"] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

export type GoalId = string;
export type SystemId = string;
export type AgentId = string;

/** Reserved System that receives Goals created without an explicit System. */
export const DEFAULT_SYSTEM_ID = "system:default";
export type AgentContinuity = "proved" | "interrupted" | "replaced" | "unknown";
export type ProviderContinuity = "confirmed" | "missing" | "unknown";
export type ExecutionPresence = "live" | "absent" | "unknown" | "conflict";
export type ResumeCapability = "eligible" | "blocked" | "unsupported" | "unknown";
export type ObservationHealth = "fresh" | "stale" | "unavailable";

export interface NativeConversationRef {
  readonly harnessId: string;
  readonly continuityScopeId?: string;
  readonly kind: string;
  readonly value: string;
}

export interface AgentExecutionBinding {
  readonly hostKind: string;
  readonly hostInstanceId: string;
  readonly nativeId: string;
  /** Opaque to the Universe module and only interpreted by the host adapter. */
  readonly hostLocator: string;
  readonly observedAt: number;
}

export interface MapPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * An opaque host-observed execution context shared by one or more agents.
 * Observatory may compare refs for evidence, but it does not make the
 * context a durable organisational node or interpret its identifier.
 */
export interface ExecutionContainerRef {
  readonly id: string;
  readonly label?: string;
}

export interface RelatedAgentDismissal {
  readonly goalId: GoalId;
  readonly agentId: AgentId;
  readonly dismissedAt: number;
}

export type UniverseChangeOutcome = "new" | "changed" | "attention" | "finished" | "stale";

export interface UniverseChange {
  readonly sequence: number;
  readonly occurredAt: number;
  readonly outcome: UniverseChangeOutcome;
  readonly targetType: "system" | "goal" | "agent";
  readonly targetId: string;
  readonly goalId?: GoalId;
  /** Direct System context for an Agent without a Goal. */
  readonly systemId?: SystemId;
  readonly summary: string;
}

export interface OperatorCheckpoint {
  readonly lastSequence: number;
  readonly acknowledgedAt: number;
}

export interface System {
  readonly id: SystemId;
  readonly title: string;
  readonly description?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Goal {
  readonly id: GoalId;
  readonly systemId?: SystemId;
  readonly title: string;
  readonly description?: string;
  readonly priority: Priority;
  readonly status: GoalStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
  readonly archivedAt?: number;
  /** Durable world-space layout hint; screen viewport state is renderer-local. */
  readonly mapPosition?: MapPosition;
  readonly mapPositionPinned?: boolean;
}

export interface Agent {
  readonly id: AgentId;
  readonly execution?: AgentExecutionBinding;
  readonly harnessId?: string;
  readonly nativeConversationRef?: NativeConversationRef;
  readonly continuity: AgentContinuity;
  readonly providerContinuity: ProviderContinuity;
  readonly executionPresence: ExecutionPresence;
  /** Raw provider-owned resume evidence; `resumeCapability` is derived from it. */
  readonly providerResumeEligibility?: "same-site" | "provider-account" | "blocked" | "unknown";
  readonly resumeCapability: ResumeCapability;
  readonly observationHealth: ObservationHealth;
  readonly providerObservedAt?: number;
  readonly executionObservedAt?: number;
  /**
   * Durable execution evidence retained without automatic compaction. Bindings
   * are small and support continuity review after panes, hosts or restarts.
   */
  readonly executionHistory: readonly AgentExecutionBinding[];
  readonly conflictingExecutions: readonly AgentExecutionBinding[];
  readonly displayName: string;
  readonly displayNameSource: "human" | "provider" | "fallback";
  readonly description?: string;
  /** Direct System placement used only when the Agent has no Goal. */
  readonly systemId?: SystemId;
  readonly primaryGoalId?: GoalId;
  readonly runtimeState: RuntimeState;
  readonly runtimeStateSource: string;
  readonly hostHealth: "live" | "stale" | "unavailable";
  readonly lastSeenAt: number;
  readonly lastObservedAt: number;
  readonly lastChangedAt: number;
  readonly attentionSince?: number;
  readonly repository?: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly provider?: string;
  /** Optional observed execution context used only for related-agent evidence. */
  readonly executionContainer?: ExecutionContainerRef;
  /** Human-controlled archive marker; archived agents stay in history but leave active projections. */
  readonly archivedAt?: number;
}

export interface HostHealth {
  readonly hostKind: string;
  readonly hostInstanceId: string;
  readonly status: "live" | "stale" | "unavailable";
  readonly lastObservedAt?: number;
  readonly lastError?: string;
  readonly diagnosticCount: number;
}

export interface ProviderSessionFact {
  readonly nativeConversationRef: NativeConversationRef;
  readonly nativeConversationAliases?: readonly NativeConversationRef[];
  readonly observedAt: number;
  readonly resumeEligibility: "same-site" | "provider-account" | "blocked" | "unknown";
  readonly title?: string;
  readonly workspaceRef?: string;
}

export interface UniverseState {
  readonly version: 1;
  systems: System[];
  goals: Goal[];
  agents: Agent[];
  hosts: HostHealth[];
  relatedAgentDismissals: RelatedAgentDismissal[];
  changes: UniverseChange[];
  operatorCheckpoint?: OperatorCheckpoint;
}

export interface UniverseStore {
  load(): UniverseState;
  save(state: UniverseState): void;
  close?(): void;
}

export interface Clock {
  now(): number;
}

/** Outcome of discarding persisted runtime certainty before a fresh host observation. */
export interface RuntimeInvalidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface IdGenerator {
  next(kind: "system" | "goal" | "agent" | "discovery"): string;
}

export const priorityRank = (priority: Priority): number => PRIORITIES.indexOf(priority);

const textCollator = new Intl.Collator("en", { sensitivity: "variant" });

/** Locale-independent ordering for deterministic projections and views. */
export const compareText = (left: string, right: string): number =>
  textCollator.compare(left, right);

/**
 * Reduce an opaque conversation reference to display-safe identity for browser
 * projections. Only a bounded opaque token may leave the server: path-like,
 * drive-like, scheme-like or control-character values are rejected, never
 * partially redacted.
 */
const SAFE_CONVERSATION_KIND = /^[a-z][a-z0-9._-]{0,31}$/u;
const SAFE_CONVERSATION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export const safeConversationReference = (
  reference: NativeConversationRef | undefined,
): { readonly kind: string; readonly id: string } | undefined => {
  if (!reference) return undefined;
  const kind = reference.kind.trim();
  const value = reference.value.trim();
  if (
    !SAFE_CONVERSATION_KIND.test(kind) ||
    kind.includes("path") ||
    !SAFE_CONVERSATION_VALUE.test(value)
  )
    return undefined;
  return { kind, id: value };
};

export const isCurrentAttentionState = (state: RuntimeState): boolean =>
  state === "blocked" || state === "waiting";

export const emptyUniverseState = (): UniverseState => ({
  version: 1,
  systems: [],
  goals: [],
  agents: [],
  hosts: [],
  relatedAgentDismissals: [],
  changes: [],
});

export const cloneUniverseState = (state: UniverseState): UniverseState => {
  const goals = state.goals.map((goal) => {
    const copy = { ...goal };
    if (goal.mapPosition) copy.mapPosition = { ...goal.mapPosition };
    return copy;
  });
  return {
    version: 1,
    systems: (state.systems ?? []).map((system) => ({ ...system })),
    goals,
    agents: state.agents.map((agent) => ({
      ...agent,
      execution: agent.execution ? { ...agent.execution } : undefined,
      executionHistory: agent.executionHistory.map((execution) => ({ ...execution })),
      conflictingExecutions: agent.conflictingExecutions.map((execution) => ({ ...execution })),
      nativeConversationRef: agent.nativeConversationRef
        ? { ...agent.nativeConversationRef }
        : undefined,
      executionContainer: agent.executionContainer ? { ...agent.executionContainer } : undefined,
    })),
    hosts: state.hosts.map((host) => ({ ...host })),
    relatedAgentDismissals: (state.relatedAgentDismissals ?? []).map((dismissal) => ({
      ...dismissal,
    })),
    changes: (state.changes ?? []).map((change) => ({ ...change })),
    operatorCheckpoint: state.operatorCheckpoint ? { ...state.operatorCheckpoint } : undefined,
  };
};
