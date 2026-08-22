import { evaluateAttention, formatAge, type AttentionItem } from "../attention/attention.ts";
import {
  priorityRank,
  type Goal,
  type HostHealth,
  type TrackedSession,
} from "../universe/types.ts";
import {
  defaultGoalMapPosition,
  mapInboxAnchor,
  sessionSatellitePositions,
  unassignedSessionPositions,
} from "../spatial/positions.ts";
import type {
  CommandCentreProjection,
  GoalView,
  InspectorProjection,
  Projection,
  ProjectionModule,
  SearchProjection,
  SearchResult,
  SessionView,
  UniverseMapProjection,
} from "./types.ts";

const byAttention = (attention: readonly AttentionItem[]): Map<string, AttentionItem> => {
  const result = new Map<string, AttentionItem>();
  for (const item of attention) {
    if (item.sessionId && !result.has(item.sessionId)) result.set(item.sessionId, item);
  }
  return result;
};

const compareSessions = (left: SessionView, right: SessionView): number => {
  if (Boolean(left.attention) !== Boolean(right.attention)) return left.attention ? -1 : 1;
  if (left.attention && right.attention && left.attention.startedAt !== right.attention.startedAt) {
    return left.attention.startedAt - right.attention.startedAt;
  }
  if (left.hostHealth !== right.hostHealth) return left.hostHealth === "live" ? -1 : 1;
  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
};

const hostFor = (hosts: readonly HostHealth[]): HostHealth | undefined => {
  if (hosts.length === 0) return undefined;
  return [...hosts].sort((left, right) => {
    const rank = { unavailable: 0, stale: 1, live: 2 };
    return rank[left.status] - rank[right.status] || left.hostKind.localeCompare(right.hostKind);
  })[0];
};

const projectCommandCentre = (
  state: {
    readonly goals: readonly Goal[];
    readonly sessions: readonly TrackedSession[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
): CommandCentreProjection => {
  const attention = evaluateAttention(now, state.goals, state.sessions, state.hosts);
  const attentionBySession = byAttention(attention.items);
  const goalsById = new Map(state.goals.map((goal) => [goal.id, goal]));
  const views = state.sessions.map((session): SessionView => ({
    ...session,
    goalTitle: session.primaryGoalId ? goalsById.get(session.primaryGoalId)?.title : undefined,
    attention: attentionBySession.get(session.id),
  }));

  const goalViews = state.goals
    .filter((goal) => includeArchived || goal.status !== "archived")
    .map((goal): GoalView => {
      const sessions = views
        .filter((session) => session.primaryGoalId === goal.id)
        .sort(compareSessions);
      return {
        ...goal,
        sessions,
        attentionCount: sessions.filter((session) => session.attention?.requiresHumanInput).length,
        staleCount: sessions.filter((session) => session.hostHealth !== "live").length,
      };
    })
    .sort((left, right) => {
      if (left.attentionCount !== right.attentionCount)
        return right.attentionCount - left.attentionCount;
      if (priorityRank(left.priority) !== priorityRank(right.priority))
        return priorityRank(left.priority) - priorityRank(right.priority);
      if (left.status !== right.status) return left.status === "completed" ? 1 : -1;
      return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    });

  const unassigned = views.filter((session) => !session.primaryGoalId).sort(compareSessions);
  const visibleSessions = views.filter(
    (session) =>
      includeArchived || goalsById.get(session.primaryGoalId ?? "")?.status !== "archived",
  );
  return {
    kind: "command-centre",
    generatedAt: now,
    host: hostFor(state.hosts),
    attention,
    goals: goalViews,
    unassigned,
    counts: {
      goals: goalViews.length,
      sessions: visibleSessions.length,
      attention: attention.currentCount,
      uncertainty: attention.uncertaintyCount,
      unassigned: unassigned.length,
      stale: visibleSessions.filter((session) => session.hostHealth !== "live").length,
    },
  };
};

interface GoalRadius {
  readonly x: number;
  readonly y: number;
}

const goalRadius = (sessionCount: number): GoalRadius => ({
  // Size communicates durable scope/session load. Attention uses a separate
  // badge and outline so it cannot silently inflate a goal's apparent scope.
  x: Math.min(14, 7 + Math.ceil(Math.sqrt(sessionCount + 1) * 1.8)),
  y: Math.min(4, 2 + Math.ceil(Math.sqrt(sessionCount) / 2)),
});

const projectUniverseMap = (
  state: {
    readonly goals: readonly Goal[];
    readonly sessions: readonly TrackedSession[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
): UniverseMapProjection => {
  const commandCentre = projectCommandCentre(state, now, includeArchived);
  const mapGoals = commandCentre.goals.map((goal) => {
    const mapPosition = goal.mapPosition ?? defaultGoalMapPosition(goal.id);
    const satellitePositions = sessionSatellitePositions(
      mapPosition,
      goal.id,
      goal.sessions.map((session) => session.id),
    );
    const radius = goalRadius(goal.sessions.length);
    const sessions = goal.sessions.map((session) => ({
      ...session,
      mapPosition: satellitePositions.get(session.id) ?? mapPosition,
    }));
    return {
      ...goal,
      mapPosition,
      radiusX: radius.x,
      radiusY: radius.y,
      sessions,
    };
  });
  const occupiedPositions = mapGoals.flatMap((goal) => [
    goal.mapPosition,
    ...goal.sessions.map((session) => session.mapPosition),
  ]);
  const inboxPosition = mapInboxAnchor(occupiedPositions);
  const unassignedPositions = unassignedSessionPositions(
    inboxPosition,
    commandCentre.unassigned.map((session) => session.id),
  );
  const mapUnassigned = commandCentre.unassigned.map((session) => ({
    ...session,
    mapPosition: unassignedPositions.get(session.id) ?? inboxPosition,
  }));
  return {
    kind: "universe-map",
    generatedAt: now,
    host: commandCentre.host,
    attention: commandCentre.attention,
    goals: mapGoals,
    unassigned: mapUnassigned,
    inboxPosition,
    counts: commandCentre.counts,
  };
};

const searchable = (value: string | undefined): string => value?.toLocaleLowerCase() ?? "";

const projectSearch = (
  state: {
    readonly goals: readonly Goal[];
    readonly sessions: readonly TrackedSession[];
  },
  query: string,
): SearchProjection => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return { kind: "search", query, results: [] };
  const results: SearchResult[] = [];
  for (const goal of state.goals) {
    const haystack = [goal.title, goal.description, goal.priority, goal.status]
      .map(searchable)
      .join(" ");
    if (haystack.includes(normalized)) {
      results.push({
        type: "goal",
        id: goal.id,
        label: goal.title,
        context: "goal metadata",
        status: goal.status,
      });
    }
  }
  for (const session of state.sessions) {
    const haystack = [
      session.displayName,
      session.description,
      session.hostKind,
      session.nativeId,
      session.repository,
      session.branch,
      session.worktree,
      session.provider,
      session.runtimeState,
    ]
      .map(searchable)
      .join(" ");
    if (haystack.includes(normalized)) {
      const result: SearchResult = {
        type: "session",
        id: session.id,
        label: session.displayName,
        context: session.primaryGoalId
          ? `session · ${session.primaryGoalId}`
          : "unassigned session",
        status: session.runtimeState,
      };
      if (session.primaryGoalId) Object.assign(result, { goalId: session.primaryGoalId });
      results.push(result);
    }
  }
  return { kind: "search", query, results };
};

const sessionView = (
  session: TrackedSession,
  goals: readonly Goal[],
  attention: readonly AttentionItem[],
): SessionView => ({
  ...session,
  goalTitle: goals.find((goal) => goal.id === session.primaryGoalId)?.title,
  attention: attention.find((item) => item.sessionId === session.id),
});

const projectInspector = (
  state: {
    readonly goals: readonly Goal[];
    readonly sessions: readonly TrackedSession[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  target: { readonly type: "goal" | "session"; readonly id: string },
): InspectorProjection => {
  const attention = evaluateAttention(now, state.goals, state.sessions, state.hosts);
  if (target.type === "goal") {
    const goal = state.goals.find((candidate) => candidate.id === target.id);
    if (!goal) return { kind: "empty-inspector", lines: ["Goal no longer exists."] };
    const sessions = state.sessions
      .filter((session) => session.primaryGoalId === goal.id)
      .map((session) => sessionView(session, state.goals, attention.items))
      .sort(compareSessions);
    const view: GoalView = {
      ...goal,
      sessions,
      attentionCount: sessions.filter((session) => session.attention?.requiresHumanInput).length,
      staleCount: sessions.filter((session) => session.hostHealth !== "live").length,
    };
    return {
      kind: "goal-inspector",
      goal: view,
      lines: [
        `status  ${goal.status}`,
        `priority ${goal.priority}`,
        `sessions ${sessions.length}`,
        `attention ${view.attentionCount} current · ${view.staleCount} stale`,
        ...(goal.description ? [goal.description] : []),
      ],
    };
  }

  const session = state.sessions.find((candidate) => candidate.id === target.id);
  if (!session) return { kind: "empty-inspector", lines: ["Session no longer exists."] };
  const view = sessionView(session, state.goals, attention.items);
  const lines = [
    `state   ${session.runtimeState} · ${session.hostHealth}`,
    `source  ${session.runtimeStateSource}`,
    `host    ${session.hostKind}`,
    `native  ${session.nativeId}`,
    `repo    ${session.repository ?? "unknown"}`,
    `branch  ${session.branch ?? "unknown"}`,
    `worktree ${session.worktree ?? "unknown"}`,
    `provider ${session.provider ?? "unknown"}`,
    `goal    ${view.goalTitle ?? "unassigned"}`,
    ...(view.attention
      ? [`why     ${view.attention.explanation}`, `waiting ${formatAge(view.attention.ageMs)}`]
      : []),
    ...(session.description ? [session.description] : []),
  ];
  return { kind: "session-inspector", session: view, lines };
};

export const createProjectionModule = (): ProjectionModule => ({
  project(state, query): Projection {
    switch (query.kind) {
      case "command-centre":
        return projectCommandCentre(state, query.now, query.includeArchived);
      case "universe-map":
        return projectUniverseMap(state, query.now, query.includeArchived);
      case "search":
        return projectSearch(state, query.query);
      case "inspector":
        return projectInspector(state, query.now, query.target);
    }
  },
});

export { projectCommandCentre, projectInspector, projectSearch, projectUniverseMap };
