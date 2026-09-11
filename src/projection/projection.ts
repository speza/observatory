import { evaluateAttention, formatAge, type AttentionItem } from "../attention/attention.ts";
import {
  priorityRank,
  type Goal,
  type HostHealth,
  type Agent,
  type System,
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
  CatchUpSubject,
  CatchUpSummaryKind,
  SearchResult,
  SystemView,
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

const textCollator = new Intl.Collator("en", { sensitivity: "variant" });
const compareText = (left: string, right: string): number => textCollator.compare(left, right);

const hostHealthRank = {
  live: 0,
  stale: 1,
  unavailable: 2,
} satisfies Record<HostHealth["status"], number>;

const compareAgents = (left: AgentView, right: AgentView): number => {
  if (Boolean(left.attention) !== Boolean(right.attention)) return left.attention ? -1 : 1;
  if (left.attention && right.attention && left.attention.startedAt !== right.attention.startedAt) {
    return left.attention.startedAt - right.attention.startedAt;
  }
  if (left.hostHealth !== right.hostHealth)
    return hostHealthRank[left.hostHealth] - hostHealthRank[right.hostHealth];
  return compareText(left.displayName, right.displayName) || compareText(left.id, right.id);
};

const hostFor = (hosts: readonly HostHealth[]): HostHealth | undefined => {
  if (hosts.length === 0) return undefined;
  return [...hosts].sort((left, right) => {
    const rank = { unavailable: 0, stale: 1, live: 2 };
    return (
      rank[left.status] - rank[right.status] ||
      compareText(left.hostKind, right.hostKind) ||
      compareText(left.hostInstanceId, right.hostInstanceId)
    );
  })[0];
};

const lifecycleState = (agent: Agent): AgentView["lifecycleState"] => {
  if (agent.executionPresence === "conflict" || agent.conflictingExecutions.length > 0)
    return "conflict";
  if (agent.providerContinuity === "missing") return "conversation-unavailable";
  if (agent.executionPresence === "live") return "running";
  if (agent.executionPresence === "absent") return "dormant";
  return "runtime-unknown";
};

const agentIsUncertain = (agent: Pick<Agent, "observationHealth" | "executionPresence">): boolean =>
  agent.observationHealth !== "fresh" ||
  agent.executionPresence === "unknown" ||
  agent.executionPresence === "conflict";

const hasUnresolvedExecution = (agent: Agent): boolean =>
  agent.executionPresence === "live" ||
  agent.executionPresence === "conflict" ||
  (agent.executionPresence === "unknown" && agent.execution !== undefined);

const publicAgent = (agent: Agent) => {
  const {
    execution,
    executionContainer: _executionContainer,
    nativeConversationRef: _nativeConversationRef,
    executionHistory: _executionHistory,
    conflictingExecutions,
    ...publicFields
  } = agent;
  const state = lifecycleState(agent);
  const canResume =
    agent.providerContinuity === "confirmed" &&
    agent.resumeCapability === "eligible" &&
    (state === "dormant" ||
      (state === "runtime-unknown" &&
        agent.execution === undefined &&
        agent.observationHealth === "fresh"));
  return {
    ...publicFields,
    execution: execution ? { hostKind: execution.hostKind } : undefined,
    lifecycleState: state,
    executionConflictCount: conflictingExecutions.length,
    canResume,
  };
};

const projectCommandCentre = (
  state: {
    readonly systems?: readonly System[];
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
  maximumAgents?: number,
): CommandCentreProjection => {
  const goalsById = new Map(state.goals.map((goal) => [goal.id, goal]));
  const projectedAgents = state.agents.filter(
    (agent) =>
      includeArchived ||
      hasUnresolvedExecution(agent) ||
      (agent.archivedAt === undefined &&
        goalsById.get(agent.primaryGoalId ?? "")?.status !== "archived"),
  );
  const attention = evaluateAttention(now, state.goals, projectedAgents, state.hosts);
  const attentionByAgent = byAttention(attention.items);
  const allViews = projectedAgents.map((agent): AgentView => {
    return {
      ...publicAgent(agent),
      goalTitle: agent.primaryGoalId ? goalsById.get(agent.primaryGoalId)?.title : undefined,
      attention: attentionByAgent.get(agent.id),
    };
  });

  const maximum = maximumAgents === undefined ? undefined : Math.max(0, Math.floor(maximumAgents));
  const truncated = maximum !== undefined && allViews.length > maximum;
  let views = allViews;
  if (truncated && maximum !== undefined) {
    const truncationRank = (view: AgentView): number => {
      const item = attentionByAgent.get(view.id);
      if (item?.requiresHumanInput) return 0;
      return item ? 1 : 2;
    };
    views = [...allViews]
      .sort((left, right) => {
        const rankDelta = truncationRank(left) - truncationRank(right);
        if (rankDelta !== 0) return rankDelta;
        const leftPriority = priorityRank(
          goalsById.get(left.primaryGoalId ?? "")?.priority ?? "P3",
        );
        const rightPriority = priorityRank(
          goalsById.get(right.primaryGoalId ?? "")?.priority ?? "P3",
        );
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return compareAgents(left, right);
      })
      .slice(0, maximum);
  }
  const visibleAttention = truncated
    ? (() => {
        const visibleIds = new Set(views.map((view) => view.id));
        const items = attention.items.filter(
          (item) =>
            item.targetType === "host" ||
            (item.agentId !== undefined && visibleIds.has(item.agentId)),
        );
        return {
          items,
          currentCount: items.filter((item) => item.requiresHumanInput).length,
          uncertaintyCount: items.filter((item) => !item.requiresHumanInput).length,
        };
      })()
    : attention;

  const viewsByGoal = new Map<string, AgentView[]>();
  const unassignedViews: AgentView[] = [];
  let visibleStaleCount = 0;
  for (const view of views) {
    if (agentIsUncertain(view)) visibleStaleCount += 1;
    if (view.primaryGoalId) {
      const bucket = viewsByGoal.get(view.primaryGoalId);
      if (bucket) bucket.push(view);
      else viewsByGoal.set(view.primaryGoalId, [view]);
    } else {
      unassignedViews.push(view);
    }
  }

  const goalViews = state.goals
    .filter((goal) => includeArchived || goal.status !== "archived" || viewsByGoal.has(goal.id))
    .map((goal): GoalView => {
      const agents = [...(viewsByGoal.get(goal.id) ?? [])].sort(compareAgents);
      return {
        ...goal,
        agents,
        attentionCount: agents.filter((agent) => agent.attention?.requiresHumanInput).length,
        staleCount: agents.filter(agentIsUncertain).length,
      };
    })
    .sort((left, right) => {
      if (left.attentionCount !== right.attentionCount)
        return right.attentionCount - left.attentionCount;
      if (priorityRank(left.priority) !== priorityRank(right.priority))
        return priorityRank(left.priority) - priorityRank(right.priority);
      if (left.status !== right.status) {
        const rank = { active: 0, completed: 1, archived: 2 };
        return rank[left.status] - rank[right.status];
      }
      return compareText(left.title, right.title) || compareText(left.id, right.id);
    });

  const unassigned = [...unassignedViews].sort(compareAgents);
  const goalsBySystem = new Map<string, GoalView[]>();
  for (const goal of goalViews) {
    if (!goal.systemId) continue;
    const bucket = goalsBySystem.get(goal.systemId);
    if (bucket) bucket.push(goal);
    else goalsBySystem.set(goal.systemId, [goal]);
  }
  const systems = (state.systems ?? [])
    .map((system): SystemView => {
      const goals = goalsBySystem.get(system.id) ?? [];
      let agentCount = 0;
      let workingCount = 0;
      let attentionCount = 0;
      let staleCount = 0;
      for (const goal of goals) {
        attentionCount += goal.attentionCount;
        staleCount += goal.staleCount;
        for (const agent of goal.agents) {
          agentCount += 1;
          if (agent.executionPresence === "live" && agent.runtimeState === "working")
            workingCount += 1;
        }
      }
      return {
        ...system,
        goals,
        agentCount,
        workingCount,
        attentionCount,
        staleCount,
      };
    })
    .sort((left, right) => {
      if (left.attentionCount !== right.attentionCount)
        return right.attentionCount - left.attentionCount;
      return compareText(left.title, right.title) || compareText(left.id, right.id);
    });
  const projection: CommandCentreProjection = {
    kind: "command-centre",
    generatedAt: now,
    host: hostFor(state.hosts),
    attention: visibleAttention,
    systems,
    goals: goalViews,
    unassigned,
    counts: {
      goals: goalViews.length,
      systems: systems.length,
      agents: views.length,
      attention: visibleAttention.currentCount,
      uncertainty: visibleAttention.uncertaintyCount,
      unassigned: unassigned.length,
      stale: visibleStaleCount,
    },
  };
  if (truncated && maximum !== undefined)
    Object.assign(projection, {
      truncated: true,
      omittedAgentCount: allViews.length - maximum,
    });
  return projection;
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
  maximumAgents?: number,
): CodeContextProjection => {
  const commandCentre = projectCommandCentre(state, now, includeArchived, maximumAgents);
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
        staleCount: sortedAgents.filter(agentIsUncertain).length,
      };
    })
    .sort((left, right) => {
      if (left.attentionCount !== right.attentionCount)
        return right.attentionCount - left.attentionCount;
      if (left.staleCount !== right.staleCount) return right.staleCount - left.staleCount;
      return compareText(left.label, right.label) || compareText(left.key, right.key);
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
  maximumAgents?: number,
): CodeContextMapProjection => {
  const codeContexts = projectCodeContexts(state, now, includeArchived, maximumAgents);
  const occupied: {
    readonly position: { readonly x: number; readonly y: number };
    readonly agentCount: number;
  }[] = [];
  const positions = new Map<string, { readonly x: number; readonly y: number }>();

  // Contexts are derived nodes, so their layout is recomputed from a stable
  // key and deterministic ordering on every projection. No position is
  // accepted into Universe state and no goal layout is affected.
  for (const context of [...codeContexts.contexts].sort((left, right) =>
    compareText(left.key, right.key),
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
  const rawAgentsById = new Map(state.agents.map((agent) => [agent.id, agent]));
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
    const executionContainer = rawAgentsById.get(agent.id)?.executionContainer;
    const executionContainerId = opaqueContextValue(executionContainer?.id);
    const sharedExecutionContainer = executionContainerId
      ? targetAgents.find(
          (target) =>
            opaqueContextValue(rawAgentsById.get(target.id)?.executionContainer?.id) ===
            executionContainerId,
        )
      : undefined;
    if (sharedExecutionContainer) {
      const label =
        executionContainer?.label?.trim() ??
        rawAgentsById.get(sharedExecutionContainer.id)?.executionContainer?.label?.trim();
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
      compareText(left.agent.displayName, right.agent.displayName) ||
      compareText(left.agent.id, right.agent.id)
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
    readonly systems?: readonly System[];
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  includeArchived = false,
  maximumAgents?: number,
): UniverseMapProjection => {
  return mapFromCommandCentre(projectCommandCentre(state, now, includeArchived, maximumAgents));
};

export const mapFromCommandCentre = (
  commandCentre: CommandCentreProjection,
): UniverseMapProjection => {
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
  const projection: UniverseMapProjection = {
    kind: "universe-map",
    generatedAt: commandCentre.generatedAt,
    host: commandCentre.host,
    attention: commandCentre.attention,
    goals: mapGoals,
    unassigned: mapUnassigned,
    inboxPosition,
    counts: commandCentre.counts,
  };
  if (commandCentre.truncated)
    Object.assign(projection, {
      truncated: true,
      omittedAgentCount: commandCentre.omittedAgentCount ?? 0,
    });
  return projection;
};

const searchable = (value: string | undefined): string => value?.toLowerCase() ?? "";

const projectSearch = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
  },
  query: string,
  limit?: number,
): SearchProjection => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { kind: "search", query, results: [] };
  const maximum = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit));
  const results: SearchResult[] = [];
  const goalsById = new Map(state.goals.map((goal) => [goal.id, goal]));
  for (const goal of state.goals) {
    if (results.length >= maximum) break;
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
    if (results.length >= maximum) break;
    const haystack = [
      agent.displayName,
      agent.description,
      agent.execution?.hostKind,
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
        context: agent.primaryGoalId
          ? `agent · ${goalsById.get(agent.primaryGoalId)?.title ?? "Goal unavailable"}`
          : "unassigned agent",
        status: agent.archivedAt === undefined ? agent.runtimeState : "archived",
      };
      if (agent.primaryGoalId) Object.assign(result, { goalId: agent.primaryGoalId });
      results.push(result);
    }
  }
  return { kind: "search", query, results };
};

const catchUpSummaryOrder: readonly CatchUpSummaryKind[] = [
  "attention",
  "finished",
  "stale",
  "attention-resolved",
  "stale-resolved",
  "new",
  "changed",
];

const catchUpOutcomeRank = {
  attention: 0,
  finished: 1,
  stale: 2,
  new: 3,
  changed: 4,
} satisfies Record<UniverseChange["outcome"], number>;

const catchUpOutcome = (
  change: UniverseChange,
  agent: Agent | undefined,
  attention: AttentionItem | undefined,
): UniverseChange["outcome"] => {
  if (change.outcome !== "changed" || !agent) return change.outcome;
  if (agentIsUncertain(agent)) return "stale";
  if (agent.executionPresence === "live" && agent.runtimeState === "done") return "finished";
  if (attention?.requiresHumanInput) return "attention";
  if (agent.archivedAt !== undefined) return "finished";
  if (agent.runtimeState === "unknown" && agent.executionPresence !== "absent") return "stale";
  return "changed";
};

const catchUpSummaryKind = (
  changes: readonly UniverseChange[],
  agent: Agent | undefined,
  attention: AttentionItem | undefined,
): CatchUpSummaryKind => {
  const latest = changes.at(-1);
  if (!latest) return "changed";
  const outcome = catchUpOutcome(latest, agent, attention);
  if (outcome !== "changed") return outcome;
  // A generic metadata event is not resolution evidence. Current typed Agent
  // state must establish recovery; historical transitions remain untouched.
  if (!agent) return "changed";
  if (changes.slice(0, -1).some((item) => item.outcome === "attention"))
    return "attention-resolved";
  if (changes.slice(0, -1).some((item) => item.outcome === "stale")) return "stale-resolved";
  return "changed";
};

const catchUpNoun = (targetType: UniverseChange["targetType"], count: number): string => {
  const noun = targetType === "agent" ? "Agent" : targetType === "goal" ? "Goal" : "System";
  return count === 1 ? noun : `${noun}s`;
};

const catchUpSummaryLabel = (
  kind: CatchUpSummaryKind,
  targetType: UniverseChange["targetType"],
  count: number,
): string => {
  const noun = catchUpNoun(targetType, count);
  switch (kind) {
    case "attention":
      return `${count} ${noun} ${count === 1 ? "needs" : "need"} judgment`;
    case "attention-resolved":
      return `${count} ${noun} no longer ${count === 1 ? "needs" : "need"} judgment`;
    case "finished":
      return `${count} ${noun} finished`;
    case "new":
      return `${count} new ${noun}`;
    case "stale":
      return `${count} ${noun} became uncertain`;
    case "stale-resolved":
      return `${count} ${noun} returned from uncertainty`;
    case "changed":
      return `${count} ${noun} changed`;
  }
};

const catchUpSubjectFor = (
  item: UniverseChange,
  goals: ReadonlyMap<string, Goal>,
  systems: ReadonlyMap<string, System>,
): Pick<CatchUpSubject, "id" | "subjectType" | "subjectId" | "title"> => {
  const goalId = item.goalId ?? (item.targetType === "goal" ? item.targetId : undefined);
  if (goalId) {
    return {
      id: `goal:${goalId}`,
      subjectType: "goal",
      subjectId: goalId,
      title: goals.get(goalId)?.title ?? "Goal no longer available",
    };
  }
  if (item.targetType === "system") {
    return {
      id: `system:${item.targetId}`,
      subjectType: "system",
      subjectId: item.targetId,
      title: systems.get(item.targetId)?.title ?? "System no longer available",
    };
  }
  return { id: "unassigned", subjectType: "unassigned", title: "Unassigned work" };
};

/**
 * Universe changes are appended in sequence order, so walk from the tail
 * instead of scanning retained history that predates the checkpoint.
 */
const changesAfter = (
  changes: readonly UniverseChange[],
  lastSequence: number,
): readonly UniverseChange[] => {
  let start = changes.length;
  while (start > 0 && (changes[start - 1]?.sequence ?? 0) > lastSequence) start -= 1;
  return start === 0 ? changes : changes.slice(start);
};

const projectCatchUp = (
  state: {
    readonly systems?: readonly System[];
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly changes: readonly UniverseChange[];
    readonly operatorCheckpoint?: OperatorCheckpoint;
  },
  now: number,
  maximumTransitions?: number,
): CatchUpProjection => {
  const lastSequence = state.operatorCheckpoint?.lastSequence ?? 0;
  const allUnread = changesAfter(state.changes, lastSequence);
  const maximum =
    maximumTransitions === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(maximumTransitions));
  const truncated = allUnread.length > maximum;
  // Keep the oldest unread transitions so acknowledging throughSequence never
  // marks an unread change the operator has not seen.
  const unread = truncated ? allUnread.slice(0, maximum) : allUnread;
  const agents = new Map(state.agents.map((agent) => [agent.id, agent]));
  const attentionAgents = state.agents.filter(
    (agent) => agent.archivedAt === undefined || hasUnresolvedExecution(agent),
  );
  const attentionByAgent = byAttention(evaluateAttention(now, state.goals, attentionAgents).items);
  const agentFor = (item: UniverseChange) =>
    item.targetType === "agent" ? agents.get(item.targetId) : undefined;
  const latestByTarget = new Map<string, UniverseChange>();
  for (const item of unread) latestByTarget.set(`${item.targetType}:${item.targetId}`, item);
  const counts: CatchUpProjection["counts"] = {
    new: 0,
    changed: 0,
    attention: 0,
    finished: 0,
    stale: 0,
  };
  for (const item of latestByTarget.values())
    counts[catchUpOutcome(item, agentFor(item), attentionByAgent.get(item.targetId))] += 1;

  const goals = new Map(state.goals.map((goal) => [goal.id, goal]));
  const systems = new Map((state.systems ?? []).map((system) => [system.id, system]));
  const grouped = new Map<
    string,
    { subject: ReturnType<typeof catchUpSubjectFor>; items: UniverseChange[] }
  >();
  for (const item of unread) {
    const subject = catchUpSubjectFor(item, goals, systems);
    const existing = grouped.get(subject.id);
    if (existing) existing.items.push(item);
    else grouped.set(subject.id, { subject, items: [item] });
  }

  const subjects = [...grouped.values()]
    .map(({ subject, items }): CatchUpSubject => {
      const trajectories = new Map<string, UniverseChange[]>();
      for (const item of items) {
        const key = `${item.targetType}:${item.targetId}`;
        const existing = trajectories.get(key);
        if (existing) existing.push(item);
        else trajectories.set(key, [item]);
      }
      const summaryCounts = new Map<
        string,
        { kind: CatchUpSummaryKind; targetType: UniverseChange["targetType"]; count: number }
      >();
      for (const trajectory of trajectories.values()) {
        const latest = trajectory.at(-1);
        if (!latest) continue;
        const kind = catchUpSummaryKind(
          trajectory,
          agentFor(latest),
          attentionByAgent.get(latest.targetId),
        );
        const key = `${kind}:${latest.targetType}`;
        const existing = summaryCounts.get(key);
        if (existing) existing.count += 1;
        else summaryCounts.set(key, { kind, targetType: latest.targetType, count: 1 });
      }
      const summaries = [...summaryCounts.values()]
        .sort(
          (left, right) =>
            catchUpSummaryOrder.indexOf(left.kind) - catchUpSummaryOrder.indexOf(right.kind) ||
            compareText(left.targetType, right.targetType),
        )
        .map((summary) => ({
          kind: summary.kind,
          count: summary.count,
          label: catchUpSummaryLabel(summary.kind, summary.targetType, summary.count),
        }));
      const latest = [...trajectories.values()]
        .flatMap((trajectory) => trajectory.at(-1) ?? [])
        .map((item) => ({
          ...item,
          outcome: catchUpOutcome(item, agentFor(item), attentionByAgent.get(item.targetId)),
        }))
        .sort(
          (left, right) =>
            catchUpOutcomeRank[left.outcome] - catchUpOutcomeRank[right.outcome] ||
            right.occurredAt - left.occurredAt ||
            right.sequence - left.sequence,
        )[0];
      const newest = items.at(-1);
      return {
        ...subject,
        occurredAt: newest?.occurredAt ?? now,
        sequence: newest?.sequence ?? 0,
        outcome: latest?.outcome ?? "changed",
        affectedTargetCount: trajectories.size,
        transitionCount: items.length,
        summaries,
        transitions: [...items].sort(
          (left, right) => right.occurredAt - left.occurredAt || right.sequence - left.sequence,
        ),
      };
    })
    .sort(
      (left, right) =>
        catchUpOutcomeRank[left.outcome] - catchUpOutcomeRank[right.outcome] ||
        right.occurredAt - left.occurredAt ||
        right.sequence - left.sequence ||
        compareText(left.title, right.title),
    );
  const projection: CatchUpProjection = {
    kind: "catch-up",
    generatedAt: now,
    throughSequence: truncated
      ? (unread.at(-1)?.sequence ?? lastSequence)
      : (state.changes.at(-1)?.sequence ?? 0),
    evidenceThroughSequence: 0,
    transitionCount: unread.length,
    pending: allUnread.length > 0,
    subjects,
    counts,
  };
  if (truncated)
    Object.assign(projection, {
      truncated: true,
      omittedTransitionCount: allUnread.length - unread.length,
    });
  if (state.operatorCheckpoint)
    Object.assign(projection, { sinceAt: state.operatorCheckpoint.acknowledgedAt });
  return projection;
};

const agentView = (
  agent: Agent,
  goals: readonly Goal[],
  attention: readonly AttentionItem[],
): AgentView => {
  return {
    ...publicAgent(agent),
    goalTitle: goals.find((goal) => goal.id === agent.primaryGoalId)?.title,
    attention: attention.find((item) => item.agentId === agent.id),
  };
};

const projectInspector = (
  state: {
    readonly goals: readonly Goal[];
    readonly agents: readonly Agent[];
    readonly hosts: readonly HostHealth[];
  },
  now: number,
  target: { readonly type: "goal" | "agent"; readonly id: string },
): InspectorProjection => {
  const activeAgents = state.agents.filter(
    (agent) => agent.archivedAt === undefined || hasUnresolvedExecution(agent),
  );
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
      staleCount: agents.filter(agentIsUncertain).length,
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
  const conversation = (() => {
    const reference = agent.nativeConversationRef;
    if (!reference) return undefined;
    const kind = reference.kind.trim();
    const value = reference.value.trim();
    if (
      !kind ||
      !value ||
      kind.toLowerCase().includes("path") ||
      value.startsWith("/") ||
      value.startsWith("\\") ||
      /^[A-Za-z]:[\\/]/u.test(value)
    )
      return undefined;
    return { kind, id: value };
  })();
  const lines = [
    `state   ${view.lifecycleState} · ${agent.runtimeState}`,
    `source  ${agent.runtimeStateSource}`,
    `host    ${agent.execution?.hostKind ?? "detached"}`,
    `harness ${agent.harnessId ?? "unknown"}`,
    `continuity ${agent.continuity}`,
    `provider ${agent.providerContinuity} · execution ${agent.executionPresence}`,
    `resume  ${agent.resumeCapability} · observation ${agent.observationHealth}`,
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
  return conversation
    ? { kind: "agent-inspector", agent: view, conversation, lines }
    : { kind: "agent-inspector", agent: view, lines };
};

export const createProjectionModule = (): ProjectionModule => ({
  project(state, query): Projection {
    switch (query.kind) {
      case "command-centre":
        return projectCommandCentre(state, query.now, query.includeArchived, query.maximumAgents);
      case "universe-map":
        return projectUniverseMap(state, query.now, query.includeArchived, query.maximumAgents);
      case "code-contexts":
        return projectCodeContexts(state, query.now, query.includeArchived, query.maximumAgents);
      case "code-context-map":
        return projectCodeContextMap(state, query.now, query.includeArchived, query.maximumAgents);
      case "related-agents":
        return projectRelatedAgents(state, query.now, query.goalId, query.includeDismissed);
      case "search":
        return projectSearch(state, query.query, query.limit);
      case "catch-up":
        return projectCatchUp(state, query.now, query.maximumTransitions);
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
