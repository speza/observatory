import type {
  AttentionItem,
  AttentionProjection,
} from "../attention/attention.ts";
import type {
  Goal,
  HostHealth,
  MapPosition,
  TrackedSession,
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
  | { readonly kind: "search"; readonly now: number; readonly query: string }
  | {
      readonly kind: "inspector";
      readonly now: number;
      readonly target: {
        readonly type: "goal" | "session";
        readonly id: string;
      };
    };

export interface SessionView extends TrackedSession {
  readonly goalTitle?: string;
  readonly attention?: AttentionItem;
}

export interface GoalView extends Goal {
  readonly sessions: readonly SessionView[];
  readonly attentionCount: number;
  readonly staleCount: number;
}

export interface CommandCentreProjection {
  readonly kind: "command-centre";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly goals: readonly GoalView[];
  readonly unassigned: readonly SessionView[];
  readonly counts: {
    readonly goals: number;
    readonly sessions: number;
    readonly attention: number;
    readonly uncertainty: number;
    readonly unassigned: number;
    readonly stale: number;
  };
}

export interface MapSessionView extends SessionView {
  readonly mapPosition: MapPosition;
}

export interface MapGoalView extends GoalView {
  readonly mapPosition: MapPosition;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly sessions: readonly MapSessionView[];
}

export interface UniverseMapProjection {
  readonly kind: "universe-map";
  readonly generatedAt: number;
  readonly host: HostHealth | undefined;
  readonly attention: AttentionProjection;
  readonly goals: readonly MapGoalView[];
  readonly unassigned: readonly MapSessionView[];
  readonly inboxPosition: MapPosition;
  readonly counts: CommandCentreProjection["counts"];
}

export interface SearchResult {
  readonly type: "goal" | "session";
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

export type InspectorProjection =
  | {
      readonly kind: "goal-inspector";
      readonly goal: GoalView;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "session-inspector";
      readonly session: SessionView;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "empty-inspector";
      readonly lines: readonly string[];
    };

export type Projection =
  | CommandCentreProjection
  | UniverseMapProjection
  | SearchProjection
  | InspectorProjection;

export interface ProjectionModule {
  project(
    state: {
      readonly goals: readonly Goal[];
      readonly sessions: readonly TrackedSession[];
      readonly hosts: readonly HostHealth[];
    },
    query: ProjectionQuery,
  ): Projection;
}
