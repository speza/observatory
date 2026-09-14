import type { AttentionItem, AttentionProjection } from "../attention/attention.ts";
import type { AgentObservationKind } from "../plugin-sdk/index.ts";
import type {
  Goal,
  HostHealth,
  MapPosition,
  OperatorCheckpoint,
  RelatedAgentDismissal,
  Agent,
  System,
  UniverseChange,
  RuntimeState,
} from "../universe/types.ts";

export type ProjectionQuery =
  | {
      readonly kind: "command-centre";
      readonly now: number;
      readonly includeArchived?: boolean;
      readonly maximumAgents?: number;
    }
  | {
      readonly kind: "universe-map";
      readonly now: number;
      readonly includeArchived?: boolean;
      readonly maximumAgents?: number;
    }
  | {
      readonly kind: "code-contexts";
      readonly now: number;
      readonly includeArchived?: boolean;
      readonly maximumAgents?: number;
    }
  | {
      readonly kind: "code-context-map";
      readonly now: number;
      readonly includeArchived?: boolean;
      readonly maximumAgents?: number;
    }
  | {
      readonly kind: "related-agents";
      readonly now: number;
      readonly goalId: string;
      readonly includeDismissed?: boolean;
    }
  | { readonly kind: "search"; readonly query: string; readonly limit?: number }
  | {
      readonly kind: "catch-up";
      readonly now: number;
      readonly maximumTransitions?: number;
    }
  | {
      readonly kind: "inspector";
      readonly now: number;
      readonly target: {
        readonly type: "goal" | "agent" | "discovered-execution";
        readonly id: string;
      };
    };

export type AgentLifecycleState =
  | "running"
  | "dormant"
  | "runtime-unknown"
  | "conversation-unavailable"
  | "conflict";

export interface AgentView extends Omit<
  Agent,
  | "execution"
  | "executionContainer"
  | "nativeConversationRef"
  | "executionHistory"
  | "conflictingExecutions"
> {
  readonly execution?: Pick<NonNullable<Agent["execution"]>, "hostKind">;
  readonly goalTitle?: string;
  readonly systemTitle?: string;
  readonly attention?: AttentionItem;
  readonly canResume: boolean;
  readonly lifecycleState: AgentLifecycleState;
  readonly executionConflictCount: number;
  readonly providerEvidence?: ProviderEvidenceView;
}

export interface ProviderEvidenceView {
  readonly providerLabel: string;
  readonly mechanism?: "hook" | "structured-api" | "metadata";
  readonly health:
    | "unsupported"
    | "not-configured"
    | "healthy"
    | "stale"
    | "unavailable"
    | "degraded";
  readonly observedAt?: number;
  readonly ageMs?: number;
  readonly activity?: "responding" | "using-tool" | "compacting" | "idle";
  readonly toolCategory?:
    | "read"
    | "write"
    | "execute"
    | "search"
    | "network"
    | "delegate"
    | "other";
  readonly request?: {
    readonly kind: "permission" | "question" | "plan-approval" | "other";
    readonly state: "open" | "resolved" | "withdrawn";
  };
  readonly outcome?: "response-completed" | "failed" | "interrupted";
  readonly failureCategory?: string;
  readonly contextBand?: "normal" | "elevated" | "critical";
  readonly compaction?: "started" | "completed";
  readonly hostConflict?: {
    readonly hostState: "waiting" | "blocked" | "done";
    readonly providerActivity: "responding" | "using-tool" | "compacting";
  };
  readonly supportedKinds: readonly AgentObservationKind[];
}

export interface GoalView extends Goal {
  readonly agents: readonly AgentView[];
  readonly attentionCount: number;
  readonly staleCount: number;
}

export interface SystemView extends System {
  /** Agents placed directly in this System without a Goal. */
  readonly agents: readonly AgentView[];
  readonly goals: readonly GoalView[];
  readonly agentCount: number;
  readonly workingCount: number;
  readonly attentionCount: number;
  readonly staleCount: number;
}

export type DiscoveredExecutionPresence = "live" | "unknown";
export type DiscoveredExecutionObservationHealth = "fresh" | "unknown" | "unavailable";

export interface DiscoveredExecutionView {
  readonly type: "discovered-execution";
  /** Opaque to the browser; the server resolves this to a fresh host target. */
  readonly handle: string;
  readonly displayName: string;
  readonly hostKind: string;
  readonly runtimeState: RuntimeState;
  readonly runtimeStateSource: string;
  readonly presence: DiscoveredExecutionPresence;
  readonly observationHealth: DiscoveredExecutionObservationHealth;
  readonly lastObservedAt: number;
  readonly repository?: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly provider?: string;
  readonly conversation?: {
    readonly kind: string;
    readonly id: string;
  };
  readonly conversationIdentified: boolean;
  readonly conversationTitle?: string;
  readonly resumeEligibility?: "same-site" | "provider-account" | "blocked" | "unknown";
  readonly admission:
    | {
        readonly status: "available";
        readonly resumeEligibility: "same-site" | "provider-account" | "blocked" | "unknown";
      }
    | {
        readonly status: "unavailable";
        readonly explanation: string;
      };
  readonly conversationConflictCount: number;
}

export interface MapDiscoveredExecutionView extends DiscoveredExecutionView {
  readonly mapPosition: MapPosition;
}

export interface CommandCentreProjection {
  readonly kind: "command-centre";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly systems: readonly SystemView[];
  readonly goals: readonly GoalView[];
  readonly unassigned: readonly AgentView[];
  readonly truncated?: boolean;
  readonly omittedAgentCount?: number;
  /** Host evidence that has not been explicitly admitted as an Agent. */
  readonly discoveredExecutions?: readonly DiscoveredExecutionView[];
  readonly counts: {
    readonly goals: number;
    readonly systems: number;
    readonly agents: number;
    readonly attention: number;
    readonly uncertainty: number;
    readonly unassigned: number;
    readonly stale: number;
    /** Kept separate from durable Agent counts and Inbox semantics. */
    readonly discovered?: number;
  };
}

export interface MapAgentView extends AgentView {
  readonly mapPosition: MapPosition;
}

/** A map-only, host-neutral view of one fresh live execution context. */
export interface MapWorkspaceView {
  readonly label: string;
  readonly mapPosition: MapPosition;
  readonly agents: readonly MapAgentView[];
  readonly goalIds: readonly string[];
  readonly attentionCount: number;
  readonly uncertaintyCount: number;
}

export interface MapGoalView extends GoalView {
  readonly mapPosition: MapPosition;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly agents: readonly MapAgentView[];
}

export interface UniverseMapProjection {
  readonly kind: "universe-map";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  /** Fresh live execution contexts. Their opaque grouping identities never leave the server. */
  readonly workspaces: readonly MapWorkspaceView[];
  /** Agents for which fresh execution-context membership cannot be established. */
  readonly workspaceLess: readonly MapAgentView[];
  readonly goals: readonly MapGoalView[];
  readonly unassigned: readonly MapAgentView[];
  readonly discoveredExecutions?: readonly MapDiscoveredExecutionView[];
  readonly inboxPosition: MapPosition;
  readonly truncated?: boolean;
  readonly omittedAgentCount?: number;
  readonly counts: CommandCentreProjection["counts"];
}

export interface CodeContextView {
  readonly key: string;
  readonly label: string;
  readonly source: "repository" | "worktree" | "unknown";
  readonly agents: readonly AgentView[];
  readonly worktreeCount: number;
  readonly attentionCount: number;
  readonly staleCount: number;
}

export interface CodeContextProjection {
  readonly kind: "code-contexts";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly contexts: readonly CodeContextView[];
  readonly counts: CommandCentreProjection["counts"] & {
    readonly contexts: number;
  };
}

export interface CodeContextMapAgentView extends AgentView {
  readonly mapPosition: MapPosition;
}

export interface CodeContextMapView {
  readonly key: string;
  readonly label: string;
  readonly source: CodeContextView["source"];
  readonly agents: readonly CodeContextMapAgentView[];
  readonly worktreeCount: number;
  readonly attentionCount: number;
  readonly staleCount: number;
  readonly mapPosition: MapPosition;
  readonly radiusX: number;
  readonly radiusY: number;
}

export interface CodeContextMapProjection {
  readonly kind: "code-context-map";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly contexts: readonly CodeContextMapView[];
  readonly counts: CodeContextProjection["counts"];
}

export type RelatedEvidenceSignal = "execution-container" | "worktree" | "repository";
export type RelatedEvidenceStrength = "strong" | "supporting";

export interface RelatedAgentEvidence {
  readonly signal: RelatedEvidenceSignal;
  readonly strength: RelatedEvidenceStrength;
  readonly label: string;
}

export interface RelatedAgentCandidate {
  readonly agent: AgentView;
  readonly evidence: readonly RelatedAgentEvidence[];
  readonly confidence: RelatedEvidenceStrength;
  readonly adoptable: boolean;
  readonly dismissed: boolean;
  readonly dismissedAt?: number;
}

export interface RelatedAgentsProjection {
  readonly kind: "related-agents";
  readonly generatedAt: number;
  readonly goal: GoalView | undefined;
  readonly candidates: readonly RelatedAgentCandidate[];
  readonly counts: {
    readonly candidates: number;
    readonly adoptable: number;
    readonly strong: number;
    readonly supporting: number;
    readonly dismissed: number;
  };
}

export interface SearchResult {
  readonly type: "goal" | "agent" | "discovered-execution";
  readonly id: string;
  readonly label: string;
  readonly context: string;
  readonly status: string;
  readonly goalId?: string;
  readonly systemId?: string;
}

export interface SearchProjection {
  readonly kind: "search";
  readonly query: string;
  readonly results: readonly SearchResult[];
}

export type CatchUpSubjectType = "system" | "goal" | "unassigned";
export type CatchUpSummaryKind =
  | "attention"
  | "attention-resolved"
  | "finished"
  | "new"
  | "changed"
  | "stale"
  | "stale-resolved";

export interface CatchUpSummary {
  readonly kind: CatchUpSummaryKind;
  readonly count: number;
  readonly label: string;
}

export interface CatchUpSubject {
  readonly id: string;
  readonly subjectType: CatchUpSubjectType;
  readonly subjectId?: string;
  readonly title: string;
  readonly occurredAt: number;
  readonly sequence: number;
  readonly outcome: UniverseChange["outcome"];
  readonly affectedTargetCount: number;
  readonly transitionCount: number;
  readonly summaries: readonly CatchUpSummary[];
  readonly transitions: readonly UniverseChange[];
  readonly evidenceTransitionCount?: number;
  readonly evidenceGroups?: readonly EvidenceCatchUpGroup[];
}

export interface CatchUpProjection {
  readonly kind: "catch-up";
  readonly generatedAt: number;
  readonly sinceAt?: number;
  readonly throughSequence: number;
  readonly evidenceThroughSequence: number;
  readonly transitionCount: number;
  readonly pending: boolean;
  readonly subjects: readonly CatchUpSubject[];
  readonly counts: Record<UniverseChange["outcome"], number>;
  readonly truncated?: boolean;
  readonly omittedTransitionCount?: number;
  readonly evidenceTransitionCount?: number;
}

export interface EvidenceCatchUpItem {
  readonly sequence: number;
  readonly agentId: string;
  readonly occurredAt: number;
  readonly summary: string;
}

export interface EvidenceCatchUpGroup {
  readonly kind: AgentObservationKind;
  readonly label: string;
  readonly items: readonly EvidenceCatchUpItem[];
}

export type InspectorProjection =
  | {
      readonly kind: "goal-inspector";
      readonly goal: GoalView;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "agent-inspector";
      readonly agent: AgentView;
      readonly conversation?: {
        readonly kind: string;
        readonly id: string;
      };
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "discovered-execution-inspector";
      readonly execution: DiscoveredExecutionView;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "empty-inspector";
      readonly lines: readonly string[];
    };

export type Projection =
  | CommandCentreProjection
  | UniverseMapProjection
  | CodeContextProjection
  | CodeContextMapProjection
  | RelatedAgentsProjection
  | SearchProjection
  | CatchUpProjection
  | InspectorProjection;

export interface ProjectionModule {
  project(
    state: {
      readonly goals: readonly Goal[];
      readonly systems?: readonly System[];
      readonly agents: readonly Agent[];
      readonly hosts: readonly HostHealth[];
      readonly discoveredExecutions?: readonly DiscoveredExecutionView[];
      readonly relatedAgentDismissals?: readonly RelatedAgentDismissal[];
      readonly changes: readonly UniverseChange[];
      readonly operatorCheckpoint?: OperatorCheckpoint;
    },
    query: ProjectionQuery,
  ): Projection;
}
