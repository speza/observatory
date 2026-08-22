export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const GOAL_STATUSES = ["active", "completed", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const RUNTIME_STATES = [
  "idle",
  "working",
  "waiting",
  "blocked",
  "done",
  "unknown",
] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

export type GoalId = string;
export type SessionId = string;

export interface MapPosition {
  readonly x: number;
  readonly y: number;
}

export interface Goal {
  readonly id: GoalId;
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

export interface TrackedSession {
  readonly id: SessionId;
  readonly hostKind: string;
  readonly nativeId: string;
  readonly displayName: string;
  readonly displayNameSource: "host" | "human";
  readonly description?: string;
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
  /** Opaque to the Universe module and only interpreted by the host adapter. */
  readonly hostLocator: string;
}

export interface HostHealth {
  readonly hostKind: string;
  readonly status: "live" | "stale" | "unavailable";
  readonly lastObservedAt?: number;
  readonly lastError?: string;
  readonly diagnosticCount: number;
}

export interface UniverseState {
  readonly version: 1;
  goals: Goal[];
  sessions: TrackedSession[];
  hosts: HostHealth[];
}

export interface UniverseStore {
  load(): UniverseState;
  save(state: UniverseState): void;
  close?(): void;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(kind: "goal" | "session"): string;
}

export const priorityRank = (priority: Priority): number =>
  PRIORITIES.indexOf(priority);

export const isCurrentAttentionState = (state: RuntimeState): boolean =>
  state === "blocked" || state === "waiting";

export const emptyUniverseState = (): UniverseState => ({
  version: 1,
  goals: [],
  sessions: [],
  hosts: [],
});

export const cloneUniverseState = (state: UniverseState): UniverseState => ({
  version: 1,
  goals: state.goals.map((goal) => ({
    ...goal,
    ...(goal.mapPosition ? { mapPosition: { ...goal.mapPosition } } : {}),
  })),
  sessions: state.sessions.map((session) => ({ ...session })),
  hosts: state.hosts.map((host) => ({ ...host })),
});
