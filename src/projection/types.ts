import type { AttentionItem, AttentionProjection } from "../attention/attention.ts";
import type {
  Goal,
  HostHealth,
  MapPosition,
  OperatorCheckpoint,
  RelatedAgentDismissal,
  Agent,
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
  | { readonly kind: "closeout"; readonly now: number }
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
  | "resumable"
  | "possibly-running"
  | "unavailable"
  | "unidentified-execution"
  | "continuity-lost"
  | "stale-observation"
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
}

export interface GoalView extends Goal {
  readonly agents: readonly AgentView[];
  readonly attentionCount: number;
  readonly staleCount: number;
}

export interface CommandCentreProjection {
  readonly kind: "command-centre";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly goals: readonly GoalView[];
  readonly unassigned: readonly AgentView[];
  readonly counts: {
    readonly goals: number;
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
}

export interface CloseoutGoalCount {
  readonly goalId?: string;
  readonly goalTitle: string;
  readonly results: number;
  readonly ended: number;
}

export interface CloseoutProjection {
  readonly kind: "closeout";
  readonly generatedAt: number;
  readonly results: readonly AgentView[];
  readonly ended: readonly AgentView[];
  readonly goals: readonly CloseoutGoalCount[];
  readonly counts: {
    readonly results: number;
    readonly ended: number;
    readonly total: number;
  };
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
      readonly providerSession?: {
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
  | CloseoutProjection
  | InspectorProjection;

export interface ProjectionModule {
  project(
    state: {
      readonly goals: readonly Goal[];
      readonly agents: readonly Agent[];
      readonly hosts: readonly HostHealth[];
      readonly relatedAgentDismissals?: readonly RelatedAgentDismissal[];
      readonly changes: readonly UniverseChange[];
      readonly operatorCheckpoint?: OperatorCheckpoint;
    },
    query: ProjectionQuery,
  ): Projection;
}
