import { evaluateAttention, formatAge, type AttentionItem } from "../attention/attention.ts";
import {
  priorityRank,
  type Goal,
  type HostHealth,
  type Agent,
  type UniverseChange,
  type OperatorCheckpoint,
} from "../universe/types.ts";
import {
  defaultGoalMapPosition,
  initialGoalMapPosition,
  mapInboxAnchor,
  agentSatellitePositions,
  unassignedAgentPositions,
} from "../spatial/positions.ts";
import type {
  CommandCentreProjection,
  CodeContextMapProjection,
  CodeContextMapView,
  CodeContextProjection,
  CodeContextView,
  CodeContextMapAgentView,
  GoalView,
  InspectorProjection,
  Projection,
  ProjectionModule,
  RelatedAgentCandidate,
  RelatedAgentEvidence,
  RelatedAgentsProjection,
  SearchProjection,
  CatchUpProjection,
  SearchResult,
  AgentView,
  UniverseMapProjection,
} from "./types.ts";

const byAttention = (attention: readonly AttentionItem[]): Map<string, AttentionItem> => {
  const result = new Map<string, AttentionItem>();
  for (const item of attention) {
    if (item.agentId && !result.has(item.agentId)) result.set(item.agentId, item);
  }
  return result;
};

const compareAgents = (left: AgentView, right: AgentView): number => {
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
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
): CommandCentreProjection => {
  const projectedAgents = state.agents.filter(
    (agent) => includeArchived || agent.archivedAt === undefined,
  );
  const activeAgents = state.agents.filter((agent) => agent.archivedAt === undefined);
  const goalsById = new Map(state.goals.map((goal) => [goal.id, goal]));
  const attentionAgents = activeAgents.filter(
    (agent) => includeArchived || goalsById.get(agent.primaryGoalId ?? "")?.status !== "archived",
  );
  const attention = evaluateAttention(now, state.goals, attentionAgents, state.hosts);
  const attentionByAgent = byAttention(attention.items);
  const views = projectedAgents.map((agent): AgentView => ({
    ...agent,
    goalTitle: agent.primaryGoalId ? goalsById.get(agent.primaryGoalId)?.title : undefined,
    attention: attentionByAgent.get(agent.id),
  }));

  const goalViews = state.goals
    .filter((goal) => includeArchived || goal.status !== "archived")
    .map((goal): GoalView => {
      const agents = views.filter((agent) => agent.primaryGoalId === goal.id).sort(compareAgents);
      return {
        ...goal,
        agents,
        attentionCount: agents.filter((agent) => agent.attention?.requiresHumanInput).length,
        staleCount: agents.filter((agent) => agent.hostHealth !== "live").length,
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

  const unassigned = views.filter((agent) => !agent.primaryGoalId).sort(compareAgents);
  const visibleAgents = views.filter(
    (agent) => includeArchived || goalsById.get(agent.primaryGoalId ?? "")?.status !== "archived",
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
      agents: visibleAgents.length,
      attention: attention.currentCount,
      uncertainty: attention.uncertaintyCount,
      unassigned: unassigned.length,
      stale: visibleAgents.filter((agent) => agent.hostHealth !== "live").length,
    },
  };
};

const normalizeContextValue = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalized || undefined;
};

const contextLeaf = (value: string): string => value.split("/").at(-1) || value;

const codeContextFor = (agent: AgentView): Pick<CodeContextView, "key" | "label" | "source"> => {
  const repository = normalizeContextValue(agent.repository);
  if (repository)
    return {
      key: `repository:${repository}`,
      label: repository,
      source: "repository",
    };

  const worktree = normalizeContextValue(agent.worktree);
  if (worktree)
    return {
      key: `worktree:${worktree}`,
      label: contextLeaf(worktree),
      source: "worktree",
    };

  return {
    key: "unknown",
    label: "Unknown workspace",
    source: "unknown",
  };
};

const projectCodeContexts = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
): CodeContextProjection => {
  const commandCentre = projectCommandCentre(state, now, includeArchived);
  const agents = [
    ...commandCentre.goals.flatMap((goal) => goal.agents),
    ...commandCentre.unassigned,
  ];
  const grouped = new Map<
    string,
    Pick<CodeContextView, "key" | "label" | "source"> & { readonly agents: AgentView[] }
  >();

  for (const agent of agents) {
    const context = codeContextFor(agent);
    const existing = grouped.get(context.key);
    if (existing) {
      existing.agents.push(agent);
      continue;
    }
    grouped.set(context.key, { ...context, agents: [agent] });
  }

  const contexts = [...grouped.values()]
    .map((context): CodeContextView => {
      const sortedAgents = context.agents.sort(compareAgents);
      return {
        ...context,
        agents: sortedAgents,
        worktreeCount: new Set(
          sortedAgents
            .map((agent) => normalizeContextValue(agent.worktree))
            .filter((worktree): worktree is string => worktree !== undefined),
        ).size,
        attentionCount: sortedAgents.filter((agent) => agent.attention?.requiresHumanInput).length,
        staleCount: sortedAgents.filter((agent) => agent.hostHealth !== "live").length,
      };
    })
    .sort((left, right) => {
      if (left.attentionCount !== right.attentionCount)
        return right.attentionCount - left.attentionCount;
      if (left.staleCount !== right.staleCount) return right.staleCount - left.staleCount;
      return left.label.localeCompare(right.label) || left.key.localeCompare(right.key);
    });

  return {
    kind: "code-contexts",
    generatedAt: now,
    host: commandCentre.host,
    attention: commandCentre.attention,
    contexts,
    counts: {
      ...commandCentre.counts,
      contexts: contexts.length,
    },
  };
};

const projectCodeContextMap = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
): CodeContextMapProjection => {
  const codeContexts = projectCodeContexts(state, now, includeArchived);
  const occupied: {
    readonly position: { readonly x: number; readonly y: number };
    readonly agentCount: number;
  }[] = [];
  const positions = new Map<string, { readonly x: number; readonly y: number }>();

  // Contexts are derived nodes, so their layout is recomputed from a stable
  // key and deterministic ordering on every projection. No position is
  // accepted into Universe state and no goal layout is affected.
  for (const context of [...codeContexts.contexts].sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    const mapPosition = initialGoalMapPosition(
      `code-context:${context.key}`,
      occupied,
      context.agents.length,
    );
    positions.set(context.key, mapPosition);
    occupied.push({ position: mapPosition, agentCount: context.agents.length });
  }

  const contexts = codeContexts.contexts.map((context): CodeContextMapView => {
    const mapPosition = positions.get(context.key) ?? { x: 0, y: 0 };
    const satellitePositions = agentSatellitePositions(
      mapPosition,
      context.key,
      context.agents.map((agent) => agent.id),
    );
    const radius = goalRadius(context.agents.length);
    const agents = context.agents.map((agent): CodeContextMapAgentView => ({
      ...agent,
      mapPosition: satellitePositions.get(agent.id) ?? mapPosition,
    }));
    return {
      ...context,
      mapPosition,
      radiusX: radius.x,
      radiusY: radius.y,
      agents,
    };
  });

  return {
    kind: "code-context-map",
    generatedAt: now,
    host: codeContexts.host,
    attention: codeContexts.attention,
    contexts,
    counts: codeContexts.counts,
  };
};

const opaqueContextValue = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized || undefined;
};

const relatedEvidenceRank = (strength: RelatedAgentEvidence["strength"]): number =>
  strength === "strong" ? 0 : 1;

const projectRelatedAgents = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
    readonly relatedAgentDismissals?: readonly {
      readonly goalId: string;
      readonly agentId: string;
      readonly dismissedAt: number;
    }[];
  },
  now: number,
  goalId: string,
  includeDismissed = false,
): RelatedAgentsProjection => {
  const commandCentre = projectCommandCentre(state, now);
  const goal = commandCentre.goals.find((candidate) => candidate.id === goalId);
  if (!goal) {
    return {
      kind: "related-agents",
      generatedAt: now,
      goal: undefined,
      candidates: [],
      counts: { candidates: 0, adoptable: 0, strong: 0, supporting: 0, dismissed: 0 },
    };
  }

  const targetAgents = goal.agents;
  const dismissedAtByAgent = new Map(
    (state.relatedAgentDismissals ?? [])
      .filter((dismissal) => dismissal.goalId === goal.id)
      .map((dismissal) => [dismissal.agentId, dismissal.dismissedAt]),
  );
  const otherAgents = [
    ...commandCentre.goals
      .filter((candidate) => candidate.id !== goal.id)
      .flatMap((candidate) => candidate.agents),
    ...commandCentre.unassigned,
  ];
  const candidates = otherAgents.flatMap((agent): RelatedAgentCandidate[] => {
    const evidence: RelatedAgentEvidence[] = [];
    const executionContainerId = opaqueContextValue(agent.executionContainer?.id);
    const sharedExecutionContainer = executionContainerId
      ? targetAgents.find(
          (target) => opaqueContextValue(target.executionContainer?.id) === executionContainerId,
        )
      : undefined;
    if (sharedExecutionContainer) {
      const label =
        agent.executionContainer?.label?.trim() ??
        sharedExecutionContainer.executionContainer?.label?.trim();
      evidence.push({
        signal: "execution-container",
        strength: "strong",
        label: `same execution container${label ? ` · ${label}` : ""}`,
      });
    }

    const worktree = normalizeContextValue(agent.worktree);
    if (
      worktree &&
      targetAgents.some((target) => normalizeContextValue(target.worktree) === worktree)
    ) {
      evidence.push({
        signal: "worktree",
        strength: "strong",
        label: `same worktree · ${contextLeaf(worktree)}`,
      });
    }

    const repository = normalizeContextValue(agent.repository);
    if (
      repository &&
      targetAgents.some((target) => normalizeContextValue(target.repository) === repository)
    ) {
      evidence.push({
        signal: "repository",
        strength: "supporting",
        label: `same repository · ${repository}`,
      });
    }
    if (evidence.length === 0) return [];

    evidence.sort(
      (left, right) => relatedEvidenceRank(left.strength) - relatedEvidenceRank(right.strength),
    );
    const dismissedAt = dismissedAtByAgent.get(agent.id);
    if (dismissedAt !== undefined && !includeDismissed) return [];
    const confidence = evidence.some((item) => item.strength === "strong")
      ? "strong"
      : "supporting";
    const candidate: RelatedAgentCandidate = {
      agent,
      evidence,
      confidence,
      adoptable: agent.primaryGoalId === undefined,
      dismissed: dismissedAt !== undefined,
    };
    if (dismissedAt !== undefined) Object.assign(candidate, { dismissedAt });
    return [candidate];
  });

  candidates.sort((left, right) => {
    if (left.dismissed !== right.dismissed) return left.dismissed ? 1 : -1;
    if (left.adoptable !== right.adoptable) return left.adoptable ? -1 : 1;
    if (left.confidence !== right.confidence)
      return relatedEvidenceRank(left.confidence) - relatedEvidenceRank(right.confidence);
    if (Boolean(left.agent.attention) !== Boolean(right.agent.attention))
      return left.agent.attention ? -1 : 1;
    return (
      left.agent.displayName.localeCompare(right.agent.displayName) ||
      left.agent.id.localeCompare(right.agent.id)
    );
  });

  return {
    kind: "related-agents",
    generatedAt: now,
    goal,
    candidates,
    counts: {
      candidates: candidates.length,
      adoptable: candidates.filter((candidate) => candidate.adoptable).length,
      strong: candidates.filter((candidate) => candidate.confidence === "strong").length,
      supporting: candidates.filter((candidate) => candidate.confidence === "supporting").length,
      dismissed: candidates.filter((candidate) => candidate.dismissed).length,
    },
  };
};

interface GoalRadius {
  readonly x: number;
  readonly y: number;
}

const goalRadius = (agentCount: number): GoalRadius => ({
  // Size communicates durable scope/agent load. Attention uses a separate
  // badge and outline so it cannot silently inflate a goal's apparent scope.
  x: Math.min(14, 7 + Math.ceil(Math.sqrt(agentCount + 1) * 1.8)),
  y: Math.min(4, 2 + Math.ceil(Math.sqrt(agentCount) / 2)),
});

const projectUniverseMap = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
): UniverseMapProjection => {
  const commandCentre = projectCommandCentre(state, now, includeArchived);
  const mapGoals = commandCentre.goals.map((goal) => {
    const mapPosition = goal.mapPosition ?? defaultGoalMapPosition(goal.id);
    const satellitePositions = agentSatellitePositions(
      mapPosition,
      goal.id,
      goal.agents.map((agent) => agent.id),
    );
    const radius = goalRadius(goal.agents.length);
    const agents = goal.agents.map((agent) => ({
      ...agent,
      mapPosition: satellitePositions.get(agent.id) ?? mapPosition,
    }));
    return {
      ...goal,
      mapPosition,
      radiusX: radius.x,
      radiusY: radius.y,
      agents,
    };
  });
  const occupiedPositions = mapGoals.flatMap((goal) => [
    goal.mapPosition,
    ...goal.agents.map((agent) => agent.mapPosition),
  ]);
  const inboxPosition = mapInboxAnchor(occupiedPositions);
  const unassignedPositions = unassignedAgentPositions(
    inboxPosition,
    commandCentre.unassigned.map((agent) => agent.id),
  );
  const mapUnassigned = commandCentre.unassigned.map((agent) => ({
    ...agent,
    mapPosition: unassignedPositions.get(agent.id) ?? inboxPosition,
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
    readonly agents: readonly Agent[];
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
  for (const agent of state.agents) {
    const haystack = [
      agent.displayName,
      agent.description,
      agent.hostKind,
      agent.nativeId,
      agent.repository,
      agent.branch,
      agent.worktree,
      agent.provider,
      agent.runtimeState,
    ]
      .map(searchable)
      .join(" ");
    if (haystack.includes(normalized)) {
      const result: SearchResult = {
        type: "agent",
        id: agent.id,
        label: agent.displayName,
        context: agent.primaryGoalId ? `agent · ${agent.primaryGoalId}` : "unassigned agent",
        status: agent.archivedAt === undefined ? agent.runtimeState : "archived",
      };
      if (agent.primaryGoalId) Object.assign(result, { goalId: agent.primaryGoalId });
      results.push(result);
    }
  }
  return { kind: "search", query, results };
};

const catchUpLabels = {
  attention: "Needs judgment",
  finished: "Finished",
  new: "New",
  changed: "Changed",
  stale: "Uncertain",
} satisfies Record<UniverseChange["outcome"], string>;

const catchUpOrder: readonly UniverseChange["outcome"][] = [
  "attention",
  "finished",
  "new",
  "changed",
  "stale",
];

const projectCatchUp = (
  state: {
    readonly changes: readonly UniverseChange[];
    readonly operatorCheckpoint?: OperatorCheckpoint;
  },
  now: number,
): CatchUpProjection => {
  const lastSequence = state.operatorCheckpoint?.lastSequence ?? 0;
  const unread = state.changes.filter((item) => item.sequence > lastSequence);
  const latestByTarget = new Map<string, UniverseChange>();
  for (const item of unread) latestByTarget.set(`${item.targetType}:${item.targetId}`, item);
  const summaries = [...latestByTarget.values()];
  const counts: CatchUpProjection["counts"] = {
    new: 0,
    changed: 0,
    attention: 0,
    finished: 0,
    stale: 0,
  };
  for (const item of summaries) counts[item.outcome] += 1;
  const groups = catchUpOrder.flatMap((outcome) => {
    const items = summaries
      .filter((item) => item.outcome === outcome)
      .sort((left, right) => right.occurredAt - left.occurredAt || right.sequence - left.sequence);
    return items.length > 0 ? [{ outcome, label: catchUpLabels[outcome], items }] : [];
  });
  const projection: CatchUpProjection = {
    kind: "catch-up",
    generatedAt: now,
    throughSequence: state.changes.at(-1)?.sequence ?? 0,
    transitionCount: unread.length,
    pending: unread.length > 0,
    groups,
    counts,
  };
  if (state.operatorCheckpoint)
    Object.assign(projection, { sinceAt: state.operatorCheckpoint.acknowledgedAt });
  return projection;
};

const agentView = (
  agent: Agent,
  goals: readonly Goal[],
  attention: readonly AttentionItem[],
): AgentView => ({
  ...agent,
  goalTitle: goals.find((goal) => goal.id === agent.primaryGoalId)?.title,
  attention: attention.find((item) => item.agentId === agent.id),
});

const projectInspector = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  target: { readonly type: "goal" | "agent"; readonly id: string },
): InspectorProjection => {
  const activeAgents = state.agents.filter((agent) => agent.archivedAt === undefined);
  const attention = evaluateAttention(now, state.goals, activeAgents, state.hosts);
  if (target.type === "goal") {
    const goal = state.goals.find((candidate) => candidate.id === target.id);
    if (!goal) return { kind: "empty-inspector", lines: ["Goal no longer exists."] };
    const agents = activeAgents
      .filter((agent) => agent.primaryGoalId === goal.id)
      .map((agent) => agentView(agent, state.goals, attention.items))
      .sort(compareAgents);
    const view: GoalView = {
      ...goal,
      agents,
      attentionCount: agents.filter((agent) => agent.attention?.requiresHumanInput).length,
      staleCount: agents.filter((agent) => agent.hostHealth !== "live").length,
    };
    return {
      kind: "goal-inspector",
      goal: view,
      lines: [
        `status  ${goal.status}`,
        `priority ${goal.priority}`,
        `agents ${agents.length}`,
        `attention ${view.attentionCount} current · ${view.staleCount} stale`,
        ...(goal.description ? [goal.description] : []),
      ],
    };
  }

  const agent = state.agents.find((candidate) => candidate.id === target.id);
  if (!agent) return { kind: "empty-inspector", lines: ["Agent no longer exists."] };
  const view = agentView(agent, state.goals, attention.items);
  const lines = [
    `state   ${agent.runtimeState} · ${agent.hostHealth}`,
    `source  ${agent.runtimeStateSource}`,
    `host    ${agent.hostKind}`,
    `native  ${agent.nativeId}`,
    `repo    ${agent.repository ?? "unknown"}`,
    `branch  ${agent.branch ?? "unknown"}`,
    `worktree ${agent.worktree ?? "unknown"}`,
    `provider ${agent.provider ?? "unknown"}`,
    `goal    ${view.goalTitle ?? "unassigned"}`,
    ...(view.attention
      ? [`why     ${view.attention.explanation}`, `waiting ${formatAge(view.attention.ageMs)}`]
      : []),
    ...(agent.description ? [agent.description] : []),
  ];
  return { kind: "agent-inspector", agent: view, lines };
};

export const createProjectionModule = (): ProjectionModule => ({
  project(state, query): Projection {
    switch (query.kind) {
      case "command-centre":
        return projectCommandCentre(state, query.now, query.includeArchived);
      case "universe-map":
        return projectUniverseMap(state, query.now, query.includeArchived);
      case "code-contexts":
        return projectCodeContexts(state, query.now, query.includeArchived);
      case "code-context-map":
        return projectCodeContextMap(state, query.now, query.includeArchived);
      case "related-agents":
        return projectRelatedAgents(state, query.now, query.goalId, query.includeDismissed);
      case "search":
        return projectSearch(state, query.query);
      case "catch-up":
        return projectCatchUp(state, query.now);
      case "inspector":
        return projectInspector(state, query.now, query.target);
    }
  },
});

export {
  projectCodeContexts,
  projectCodeContextMap,
  projectCommandCentre,
  projectRelatedAgents,
  projectInspector,
  projectSearch,
  projectCatchUp,
  projectUniverseMap,
};
