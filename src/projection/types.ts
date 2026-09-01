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
} from "../universe/types.ts";

export type ProjectionQuery =
  | {
      readonly kind: "command-centre";
      readonly now: number;
      readonly includeArchived?: boolean;
    }
  | {
      readonly kind: "universe-map";
      readonly now: number;
      readonly includeArchived?: boolean;
    }
  | {
      readonly kind: "code-contexts";
      readonly now: number;
      readonly includeArchived?: boolean;
    }
  | {
      readonly kind: "code-context-map";
      readonly now: number;
      readonly includeArchived?: boolean;
    }
  | {
      readonly kind: "related-agents";
      readonly now: number;
      readonly goalId: string;
      readonly includeDismissed?: boolean;
    }
  | { readonly kind: "search"; readonly now: number; readonly query: string }
  | { readonly kind: "catch-up"; readonly now: number }
  | {
      readonly kind: "inspector";
      readonly now: number;
      readonly target: {
        readonly type: "goal" | "agent";
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
  "nativeConversationRef" | "executionHistory" | "conflictingExecutions"
> {
  readonly goalTitle?: string;
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
  readonly goals: readonly GoalView[];
  readonly agentCount: number;
  readonly workingCount: number;
  readonly attentionCount: number;
  readonly staleCount: number;
}

export interface CommandCentreProjection {
  readonly kind: "command-centre";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly systems: readonly SystemView[];
  readonly goals: readonly GoalView[];
  readonly unassigned: readonly AgentView[];
  readonly counts: {
    readonly goals: number;
    readonly systems: number;
    readonly agents: number;
    readonly attention: number;
    readonly uncertainty: number;
    readonly unassigned: number;
    readonly stale: number;
  };
}

export interface MapAgentView extends AgentView {
  readonly mapPosition: MapPosition;
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
  readonly goals: readonly MapGoalView[];
  readonly unassigned: readonly MapAgentView[];
  readonly inboxPosition: MapPosition;
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
  readonly type: "goal" | "agent";
  readonly id: string;
  readonly label: string;
  readonly context: string;
  readonly status: string;
  readonly goalId?: string;
}

export interface SearchProjection {
  readonly kind: "search";
  readonly query: string;
  readonly results: readonly SearchResult[];
}

export interface CatchUpGroup {
  readonly outcome: UniverseChange["outcome"];
  readonly label: string;
  readonly items: readonly UniverseChange[];
}

export interface CatchUpProjection {
  readonly kind: "catch-up";
  readonly generatedAt: number;
  readonly sinceAt?: number;
  readonly throughSequence: number;
  readonly transitionCount: number;
  readonly pending: boolean;
  readonly groups: readonly CatchUpGroup[];
  readonly counts: Record<UniverseChange["outcome"], number>;
  readonly evidenceTransitionCount?: number;
  readonly evidenceGroups?: readonly EvidenceCatchUpGroup[];
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
      readonly relatedAgentDismissals?: readonly RelatedAgentDismissal[];
      readonly changes: readonly UniverseChange[];
      readonly operatorCheckpoint?: OperatorCheckpoint;
    },
    query: ProjectionQuery,
  ): Projection;
}
