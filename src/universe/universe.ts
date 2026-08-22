import type { HostSnapshot, HostSessionObservation } from "../hosts/types.ts";
import type { Projection, ProjectionModule, ProjectionQuery } from "../projection/types.ts";
import {
  cloneUniverseState,
  emptyUniverseState,
  isCurrentAttentionState,
  type Clock,
  type Goal,
  type GoalId,
  type HostHealth,
  type IdGenerator,
  type Priority,
  type SessionId,
  type TrackedSession,
  type UniverseState,
  type UniverseStore,
} from "./types.ts";
import {
  defaultGoalMapPosition,
  initialGoalMapPosition,
  isMapPosition,
  type GoalLayoutOccupancy,
} from "../spatial/positions.ts";

export type UniverseCommand =
  | {
      readonly type: "CreateGoal";
      readonly title: string;
      readonly description?: string;
      readonly priority?: Priority;
      readonly id?: GoalId;
    }
  | {
      readonly type: "RenameGoal";
      readonly goalId: GoalId;
      readonly title: string;
    }
  | {
      readonly type: "SetGoalDescription";
      readonly goalId: GoalId;
      readonly description?: string;
    }
  | {
      readonly type: "SetGoalPriority";
      readonly goalId: GoalId;
      readonly priority: Priority;
    }
  | {
      readonly type: "SetGoalMapPosition";
      readonly goalId: GoalId;
      readonly position: { readonly x: number; readonly y: number };
      readonly pinned?: boolean;
    }
  | { readonly type: "ResetGoalMapPosition"; readonly goalId: GoalId }
  | {
      readonly type: "AssignSession";
      readonly sessionId: SessionId;
      readonly goalId: GoalId;
    }
  | { readonly type: "UnassignSession"; readonly sessionId: SessionId }
  | {
      readonly type: "RenameSession";
      readonly sessionId: SessionId;
      readonly displayName: string;
    }
  | {
      readonly type: "SetSessionDescription";
      readonly sessionId: SessionId;
      readonly description?: string;
    }
  | { readonly type: "CompleteGoal"; readonly goalId: GoalId }
  | { readonly type: "ArchiveGoal"; readonly goalId: GoalId };

export interface CommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly goalId?: GoalId;
  readonly sessionId?: SessionId;
}

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly addedSessionIds: readonly SessionId[];
  readonly updatedSessionIds: readonly SessionId[];
  readonly staleSessionIds: readonly SessionId[];
  readonly diagnostics: readonly string[];
  readonly error?: string;
}

const normalizeText = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const copyOptional = (value: string | undefined): string | undefined => normalizeText(value);

const findGoal = (state: UniverseState, goalId: GoalId): Goal | undefined =>
  state.goals.find((goal) => goal.id === goalId);
const findSession = (state: UniverseState, sessionId: SessionId): TrackedSession | undefined =>
  state.sessions.find((session) => session.id === sessionId);

const goalLayoutOccupancy = (state: UniverseState, excludeGoalId?: GoalId): GoalLayoutOccupancy[] =>
  state.goals
    .filter((goal) => goal.id !== excludeGoalId)
    .map((goal) => ({
      position: goal.mapPosition ?? defaultGoalMapPosition(goal.id),
      sessionCount: state.sessions.filter((session) => session.primaryGoalId === goal.id).length,
    }));

const replaceGoal = (state: UniverseState, goal: Goal): void => {
  state.goals = state.goals.map((candidate) => (candidate.id === goal.id ? goal : candidate));
};

const replaceSession = (state: UniverseState, session: TrackedSession): void => {
  state.sessions = state.sessions.map((candidate) =>
    candidate.id === session.id ? session : candidate,
  );
};

const replaceHost = (state: UniverseState, host: HostHealth): void => {
  state.hosts = [...state.hosts.filter((candidate) => candidate.hostKind !== host.hostKind), host];
};

const isDuplicateObservation = (
  sessions: readonly HostSessionObservation[],
): string | undefined => {
  const seen = new Set<string>();
  for (const session of sessions) {
    const key = session.nativeId.trim();
    if (!key) return "Host observation has an empty native identifier.";
    if (seen.has(key)) return `Duplicate native identity from host: ${key}`;
    seen.add(key);
  }
  return undefined;
};

export class Universe {
  private state: UniverseState;

  constructor(
    private readonly store: UniverseStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly projections: ProjectionModule,
  ) {
    this.state = store.load();
  }

  snapshot(): UniverseState {
    return cloneUniverseState(this.state);
  }

  project(query: ProjectionQuery): Projection {
    return this.projections.project(this.state, query);
  }

  execute(command: UniverseCommand): CommandResult {
    const next = cloneUniverseState(this.state);
    const now = this.clock.now();
    let result: CommandResult;

    switch (command.type) {
      case "CreateGoal": {
        const title = normalizeText(command.title);
        if (!title) return { ok: false, error: "Goal title is required." };
        const id = command.id ?? this.ids.next("goal");
        if (next.goals.some((goal) => goal.id === id))
          return { ok: false, error: `Goal ${id} already exists.` };
        const goal: Goal = {
          id,
          title,
          ...(normalizeText(command.description)
            ? { description: normalizeText(command.description) }
            : {}),
          priority: command.priority ?? "P2",
          status: "active",
          createdAt: now,
          updatedAt: now,
          mapPosition: initialGoalMapPosition(id, goalLayoutOccupancy(next)),
          mapPositionPinned: false,
        };
        next.goals = [...next.goals, goal];
        result = { ok: true, goalId: id };
        break;
      }
      case "RenameGoal": {
        const title = normalizeText(command.title);
        const goal = findGoal(next, command.goalId);
        if (!title) return { ok: false, error: "Goal title is required." };
        if (!goal) return { ok: false, error: "Goal not found." };
        replaceGoal(next, { ...goal, title, updatedAt: now });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "SetGoalDescription": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        const description = normalizeText(command.description);
        replaceGoal(next, {
          ...goal,
          ...(description ? { description } : {}),
          ...(description ? {} : { description: undefined }),
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "SetGoalPriority": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        replaceGoal(next, {
          ...goal,
          priority: command.priority,
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "SetGoalMapPosition": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (!isMapPosition(command.position))
          return { ok: false, error: "Goal map position is invalid." };
        replaceGoal(next, {
          ...goal,
          mapPosition: {
            x: Math.round(command.position.x),
            y: Math.round(command.position.y),
          },
          mapPositionPinned: command.pinned ?? true,
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "ResetGoalMapPosition": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        const sessionCount = next.sessions.filter(
          (session) => session.primaryGoalId === goal.id,
        ).length;
        replaceGoal(next, {
          ...goal,
          mapPosition: initialGoalMapPosition(
            goal.id,
            goalLayoutOccupancy(next, goal.id),
            sessionCount,
          ),
          mapPositionPinned: false,
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "AssignSession": {
        const session = findSession(next, command.sessionId);
        const goal = findGoal(next, command.goalId);
        if (!session) return { ok: false, error: "Session not found." };
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status === "archived")
          return {
            ok: false,
            error: "Archived goals cannot receive sessions.",
          };
        replaceSession(next, { ...session, primaryGoalId: goal.id });
        result = { ok: true, sessionId: session.id, goalId: goal.id };
        break;
      }
      case "UnassignSession": {
        const session = findSession(next, command.sessionId);
        if (!session) return { ok: false, error: "Session not found." };
        replaceSession(next, { ...session, primaryGoalId: undefined });
        result = { ok: true, sessionId: session.id };
        break;
      }
      case "RenameSession": {
        const displayName = normalizeText(command.displayName);
        const session = findSession(next, command.sessionId);
        if (!displayName) return { ok: false, error: "Session name is required." };
        if (!session) return { ok: false, error: "Session not found." };
        replaceSession(next, {
          ...session,
          displayName,
          displayNameSource: "human",
        });
        result = { ok: true, sessionId: session.id };
        break;
      }
      case "SetSessionDescription": {
        const session = findSession(next, command.sessionId);
        if (!session) return { ok: false, error: "Session not found." };
        const description = normalizeText(command.description);
        replaceSession(next, {
          ...session,
          ...(description ? { description } : {}),
          ...(description ? {} : { description: undefined }),
        });
        result = { ok: true, sessionId: session.id };
        break;
      }
      case "CompleteGoal": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status === "archived")
          return { ok: false, error: "Archived goals cannot be completed." };
        if (goal.status === "completed") return { ok: true, goalId: goal.id };
        replaceGoal(next, {
          ...goal,
          status: "completed",
          completedAt: now,
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "ArchiveGoal": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status !== "completed")
          return { ok: false, error: "Complete the goal before archiving it." };
        replaceGoal(next, {
          ...goal,
          status: "archived",
          archivedAt: now,
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
    }

    try {
      this.store.save(next);
    } catch (error) {
      return {
        ok: false,
        error: `Command rolled back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    this.state = next;
    return result;
  }

  reconcile(snapshot: HostSnapshot): ReconciliationResult {
    const duplicate = isDuplicateObservation(snapshot.sessions);
    if (duplicate) {
      return {
        accepted: false,
        addedSessionIds: [],
        updatedSessionIds: [],
        staleSessionIds: [],
        diagnostics: [duplicate],
        error: duplicate,
      };
    }

    const next = cloneUniverseState(this.state);
    const diagnostics = [...snapshot.diagnostics];
    const addedSessionIds: SessionId[] = [];
    const updatedSessionIds: SessionId[] = [];
    const staleSessionIds: SessionId[] = [];
    const now = snapshot.observedAt;
    const hostStatus: HostHealth = {
      hostKind: snapshot.hostKind,
      status: snapshot.available ? "live" : "unavailable",
      ...(snapshot.available ? { lastObservedAt: now } : {}),
      ...(snapshot.error ? { lastError: snapshot.error } : {}),
      diagnosticCount: diagnostics.length,
    };
    replaceHost(next, hostStatus);

    if (!snapshot.available) {
      next.sessions = next.sessions.map((session) => {
        if (session.hostKind !== snapshot.hostKind || session.hostHealth === "unavailable")
          return session;
        staleSessionIds.push(session.id);
        return { ...session, hostHealth: "unavailable" as const };
      });
    } else {
      const observedIds = new Set(snapshot.sessions.map((session) => session.nativeId));
      next.sessions = next.sessions.map((session) => {
        if (
          session.hostKind !== snapshot.hostKind ||
          observedIds.has(session.nativeId) ||
          session.hostHealth === "stale"
        )
          return session;
        if (!observedIds.has(session.nativeId)) {
          staleSessionIds.push(session.id);
          return { ...session, hostHealth: "stale" as const };
        }
        return session;
      });

      for (const observation of snapshot.sessions) {
        const existing = next.sessions.find(
          (session) =>
            session.hostKind === snapshot.hostKind && session.nativeId === observation.nativeId,
        );
        if (!existing) {
          const id = this.ids.next("session");
          const session = this.sessionFromObservation(id, snapshot, observation);
          next.sessions = [...next.sessions, session];
          addedSessionIds.push(id);
          continue;
        }
        const stateChanged = existing.runtimeState !== observation.runtimeState;
        const currentAttention = isCurrentAttentionState(observation.runtimeState);
        const updated: TrackedSession = {
          ...existing,
          ...(existing.displayNameSource === "host"
            ? { displayName: observation.displayName }
            : {}),
          runtimeState: observation.runtimeState,
          runtimeStateSource: observation.runtimeStateSource,
          hostHealth: "live",
          lastSeenAt: observation.observedAt,
          lastObservedAt: observation.observedAt,
          lastChangedAt: stateChanged ? observation.observedAt : existing.lastChangedAt,
          ...(currentAttention
            ? {
                attentionSince: stateChanged
                  ? observation.observedAt
                  : (existing.attentionSince ?? observation.observedAt),
              }
            : { attentionSince: undefined }),
          ...(observation.repository
            ? { repository: observation.repository }
            : { repository: undefined }),
          ...(observation.branch ? { branch: observation.branch } : { branch: undefined }),
          ...(observation.worktree ? { worktree: observation.worktree } : { worktree: undefined }),
          ...(observation.provider ? { provider: observation.provider } : { provider: undefined }),
          hostLocator: observation.hostLocator,
        };
        replaceSession(next, updated);
        updatedSessionIds.push(existing.id);
      }
    }

    try {
      this.store.save(next);
    } catch (error) {
      return {
        accepted: false,
        addedSessionIds: [],
        updatedSessionIds: [],
        staleSessionIds: [],
        diagnostics,
        error: `Reconciliation rolled back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    this.state = next;
    return {
      accepted: true,
      addedSessionIds,
      updatedSessionIds,
      staleSessionIds,
      diagnostics,
    };
  }

  private sessionFromObservation(
    id: string,
    snapshot: HostSnapshot,
    observation: HostSessionObservation,
  ): TrackedSession {
    const attentionSince = isCurrentAttentionState(observation.runtimeState)
      ? observation.observedAt
      : undefined;
    return {
      id,
      hostKind: snapshot.hostKind,
      nativeId: observation.nativeId,
      displayName: observation.displayName,
      displayNameSource: "host",
      runtimeState: observation.runtimeState,
      runtimeStateSource: observation.runtimeStateSource,
      hostHealth: "live",
      lastSeenAt: observation.observedAt,
      lastObservedAt: observation.observedAt,
      lastChangedAt: observation.observedAt,
      ...(attentionSince !== undefined ? { attentionSince } : {}),
      ...(observation.repository ? { repository: copyOptional(observation.repository) } : {}),
      ...(observation.branch ? { branch: copyOptional(observation.branch) } : {}),
      ...(observation.worktree ? { worktree: copyOptional(observation.worktree) } : {}),
      ...(observation.provider ? { provider: copyOptional(observation.provider) } : {}),
      hostLocator: observation.hostLocator,
    };
  }
}

export const createEmptyUniverse = (
  store: UniverseStore,
  clock: Clock,
  ids: IdGenerator,
  projections: ProjectionModule,
): Universe => {
  if (store.load().goals.length === 0 && store.load().sessions.length === 0)
    store.save(emptyUniverseState());
  return new Universe(store, clock, ids, projections);
};
