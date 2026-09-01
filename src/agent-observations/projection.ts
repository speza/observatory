import { compareAttention, composeAttention, type AttentionItem } from "../attention/attention.ts";
import type { AgentObservationKind } from "../plugin-sdk/index.ts";
import { priorityRank, type Priority } from "../universe/types.ts";
import type {
  AgentView,
  CatchUpProjection,
  CommandCentreProjection,
  GoalView,
  InspectorProjection,
  ProviderEvidenceView,
  SystemView,
  UniverseMapProjection,
} from "../projection/types.ts";
import type { AgentEvidence, AgentEvidenceSnapshot, StoredAgentObservation } from "./types.ts";

const MAX_FRESHNESS_MS = {
  activity: 2 * 60_000,
  "human-input-request": 30 * 60_000,
  "turn-outcome": 24 * 60 * 60_000,
  "context-pressure": 10 * 60_000,
} satisfies Record<AgentObservationKind, number>;

const latest = (evidence: AgentEvidence, kind: AgentObservationKind) =>
  evidence.current
    .filter((item) => item.kind === kind)
    .sort(
      (left, right) =>
        right.observedAt - left.observedAt || (right.revision ?? 0) - (left.revision ?? 0),
    )[0];

const freshnessMs = (evidence: AgentEvidence, kind: AgentObservationKind): number => {
  const advertised = evidence.freshnessSeconds[kind];
  return Math.min(
    MAX_FRESHNESS_MS[kind],
    advertised !== undefined && Number.isFinite(advertised) && advertised > 0
      ? advertised * 1_000
      : MAX_FRESHNESS_MS[kind],
  );
};

const evidenceView = (
  evidence: AgentEvidence,
  now: number,
  agent?: AgentView,
): ProviderEvidenceView => {
  const freshItems = evidence.current.filter(
    (item) => now - item.observedAt <= freshnessMs(evidence, item.kind),
  );
  const retainedRequest = latest(evidence, "human-input-request");
  const requestIsStaleAndOpen =
    retainedRequest?.kind === "human-input-request" &&
    retainedRequest.payload.state === "open" &&
    now - retainedRequest.observedAt > freshnessMs(evidence, "human-input-request");
  const items = requestIsStaleAndOpen ? [...freshItems, retainedRequest] : freshItems;
  const current = { ...evidence, current: items };
  const activity = latest(current, "activity");
  const request = latest(current, "human-input-request");
  const retainedOutcome = latest(current, "turn-outcome");
  const outcomeSuperseded =
    retainedOutcome?.kind === "turn-outcome" &&
    ((activity?.kind === "activity" &&
      activity.observedAt > retainedOutcome.observedAt &&
      activity.payload.phase !== "idle") ||
      (agent?.hostHealth === "live" &&
        agent.observationHealth === "fresh" &&
        agent.runtimeState === "working" &&
        agent.lastObservedAt > retainedOutcome.observedAt));
  const outcome = outcomeSuperseded ? undefined : retainedOutcome;
  const context = latest(current, "context-pressure");
  const conflictingActivity =
    evidence.health === "healthy" &&
    agent?.hostHealth === "live" &&
    agent.observationHealth === "fresh" &&
    (agent.runtimeState === "waiting" ||
      agent.runtimeState === "blocked" ||
      agent.runtimeState === "done") &&
    activity?.kind === "activity" &&
    !(request?.kind === "human-input-request" && request.payload.state === "open") &&
    (activity.payload.phase === "responding" ||
      activity.payload.phase === "using-tool" ||
      activity.payload.phase === "compacting") &&
    activity.observedAt >= agent.lastObservedAt
      ? {
          hostState: agent.runtimeState,
          providerActivity: activity.payload.phase,
        }
      : undefined;
  const newest = items.reduce((value, item) => Math.max(value, item.observedAt), 0);
  const newestObservation = items.find((item) => item.observedAt === newest);
  const view: ProviderEvidenceView = {
    providerLabel: evidence.providerLabel,
    mechanism: newestObservation?.source.mechanism,
    health: evidence.health === "healthy" && requestIsStaleAndOpen ? "stale" : evidence.health,
    observedAt: newest || evidence.capturedAt,
    ageMs:
      newest || evidence.capturedAt
        ? Math.max(0, now - (newest || evidence.capturedAt!))
        : undefined,
    activity: activity?.kind === "activity" ? activity.payload.phase : undefined,
    toolCategory: activity?.kind === "activity" ? activity.payload.toolCategory : undefined,
    request:
      request?.kind === "human-input-request"
        ? { kind: request.payload.requestKind, state: request.payload.state }
        : undefined,
    outcome: outcome?.kind === "turn-outcome" ? outcome.payload.outcome : undefined,
    failureCategory: outcome?.kind === "turn-outcome" ? outcome.payload.failureCategory : undefined,
    contextBand:
      context?.kind !== "context-pressure" || context.payload.usedRatio === undefined
        ? undefined
        : context.payload.usedRatio >= 0.9
          ? "critical"
          : context.payload.usedRatio >= 0.75
            ? "elevated"
            : "normal",
    compaction: context?.kind === "context-pressure" ? context.payload.compaction : undefined,
    hostConflict: conflictingActivity,
    supportedKinds: evidence.kinds,
  };
  return view;
};

const providerAttention = (
  agent: AgentView,
  evidence: ProviderEvidenceView,
  now: number,
  priority: Priority,
): readonly AttentionItem[] => {
  const base = {
    targetType: "agent" as const,
    targetId: agent.id,
    agentId: agent.id,
    goalId: agent.primaryGoalId,
    lastChangedAt: evidence.observedAt ?? now,
    ageMs: evidence.ageMs ?? 0,
    priority,
    runtimeState: agent.runtimeState,
  };
  if (evidence.request?.state === "open") {
    const stale = evidence.health !== "healthy" || evidence.request === undefined;
    return [
      {
        ...base,
        id: `${agent.id}:provider-input`,
        reason: stale ? "provider-stale" : "provider-input",
        action: stale ? "monitor" : "respond",
        requiresHumanInput: !stale,
        startedAt: evidence.observedAt ?? now,
        explanation: stale
          ? `${evidence.providerLabel} last reported an unresolved ${evidence.request.kind} request, but the observation is stale.`
          : `${evidence.providerLabel} requests ${evidence.request.kind.replace("-", " ")} input. Open the agent terminal to respond.`,
      },
    ];
  }
  if (evidence.outcome === "failed")
    return [
      {
        ...base,
        id: `${agent.id}:provider-failure`,
        reason: "provider-failure",
        action: "respond",
        requiresHumanInput: true,
        startedAt: evidence.observedAt ?? now,
        explanation: `${evidence.providerLabel} reports that the response failed${evidence.failureCategory ? ` (${evidence.failureCategory})` : ""}.`,
      },
    ];
  if (evidence.outcome === "response-completed")
    return [
      {
        ...base,
        id: `${agent.id}:provider-complete`,
        reason: "provider-complete",
        action: "review",
        requiresHumanInput: true,
        startedAt: evidence.observedAt ?? now,
        explanation: `${evidence.providerLabel} reports the response complete. Review code evidence before accepting completion.`,
      },
    ];
  if (evidence.contextBand === "critical" || evidence.contextBand === "elevated")
    return [
      {
        ...base,
        id: `${agent.id}:context-pressure`,
        reason: "context-pressure",
        action: "monitor",
        requiresHumanInput: false,
        startedAt: evidence.observedAt ?? now,
        explanation: `${evidence.providerLabel} reports ${evidence.contextBand} context pressure.`,
      },
    ];
  return [];
};

const providerSignals = (
  agent: AgentView,
  evidence: ProviderEvidenceView,
  now: number,
  priority: Priority,
): readonly AttentionItem[] => {
  const signals = [...providerAttention(agent, evidence, now, priority)];
  if (evidence.hostConflict)
    signals.push({
      id: `${agent.id}:provider-conflict`,
      targetType: "agent",
      targetId: agent.id,
      agentId: agent.id,
      goalId: agent.primaryGoalId,
      reason: "provider-conflict",
      action: "monitor",
      requiresHumanInput: false,
      startedAt: evidence.observedAt ?? now,
      lastChangedAt: evidence.observedAt ?? now,
      ageMs: evidence.ageMs ?? 0,
      priority,
      runtimeState: agent.runtimeState,
      explanation: `${evidence.providerLabel} reports ${evidence.hostConflict.providerActivity.replace("-", " ")} activity while the host reports ${evidence.hostConflict.hostState}. Treat both observations as uncertain.`,
    });
  return signals;
};

const enrichAgent = (
  agent: AgentView,
  evidence: AgentEvidence | undefined,
  now: number,
  attention: AttentionItem | undefined,
): AgentView => {
  if (!evidence) return agent;
  const providerEvidence = evidenceView(evidence, now, agent);
  return { ...agent, providerEvidence, attention };
};

const compareAgents = (left: AgentView, right: AgentView): number => {
  if (Boolean(left.attention) !== Boolean(right.attention)) return left.attention ? -1 : 1;
  if (left.attention && right.attention) {
    const attention = compareAttention(left.attention, right.attention);
    if (attention !== 0) return attention;
  }
  if (left.hostHealth !== right.hostHealth) return left.hostHealth === "live" ? -1 : 1;
  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
};

const uncertainAgent = (agent: AgentView): boolean =>
  agent.observationHealth !== "fresh" ||
  agent.executionPresence === "unknown" ||
  agent.executionPresence === "conflict" ||
  agent.attention?.requiresHumanInput === false;

const enrichGoal = (goal: GoalView, enrich: (agent: AgentView) => AgentView): GoalView => {
  const agents = goal.agents.map(enrich).sort(compareAgents);
  return {
    ...goal,
    agents,
    attentionCount: agents.filter((agent) => agent.attention?.requiresHumanInput).length,
    staleCount: agents.filter(uncertainAgent).length,
  };
};

const compareGoals = (left: GoalView, right: GoalView): number =>
  right.attentionCount - left.attentionCount ||
  priorityRank(left.priority) - priorityRank(right.priority) ||
  Number(left.status === "completed") - Number(right.status === "completed") ||
  left.title.localeCompare(right.title) ||
  left.id.localeCompare(right.id);

const compareSystems = (left: SystemView, right: SystemView): number =>
  right.attentionCount - left.attentionCount ||
  left.title.localeCompare(right.title) ||
  left.id.localeCompare(right.id);

const expandAttention = (items: readonly AttentionItem[]): readonly AttentionItem[] =>
  items.flatMap((item): readonly AttentionItem[] => {
    const { supportingSignals, ...primary } = item;
    return [
      primary,
      ...(supportingSignals ?? []).map((signal) => ({
        ...primary,
        ...signal,
      })),
    ];
  });

const fuseAgents = (
  goals: readonly GoalView[],
  unassigned: readonly AgentView[],
  baseAttention: readonly AttentionItem[],
  snapshot: AgentEvidenceSnapshot,
) => {
  const byAgent = new Map(snapshot.agents.map((item) => [item.agentId, item]));
  const priorities = new Map(goals.map((goal) => [goal.id, goal.priority]));
  const allAgents = [...goals.flatMap((goal) => goal.agents), ...unassigned];
  const providerItems = allAgents.flatMap((agent) => {
    const evidence = byAgent.get(agent.id);
    return evidence
      ? providerSignals(
          agent,
          evidenceView(evidence, snapshot.generatedAt, agent),
          snapshot.generatedAt,
          priorities.get(agent.primaryGoalId ?? "") ?? "P3",
        )
      : [];
  });
  const items = composeAttention([...providerItems, ...expandAttention(baseAttention)]).items;
  const primaryByAgent = new Map<string, AttentionItem>();
  for (const item of items)
    if (item.agentId && !primaryByAgent.has(item.agentId)) primaryByAgent.set(item.agentId, item);
  return {
    items,
    enrich: (agent: AgentView) =>
      enrichAgent(agent, byAgent.get(agent.id), snapshot.generatedAt, primaryByAgent.get(agent.id)),
  };
};

export const enrichCommandCentre = (
  projection: CommandCentreProjection,
  snapshot: AgentEvidenceSnapshot,
): CommandCentreProjection => {
  const { items, enrich } = fuseAgents(
    projection.goals,
    projection.unassigned,
    projection.attention.items,
    snapshot,
  );
  const goals = projection.goals.map((goal) => enrichGoal(goal, enrich)).sort(compareGoals);
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const systems = projection.systems
    .map((system): SystemView => {
      const systemGoals = system.goals.flatMap((goal) => {
        const enriched = goalsById.get(goal.id);
        return enriched ? [enriched] : [];
      });
      return {
        ...system,
        goals: systemGoals,
        attentionCount: systemGoals.reduce((total, goal) => total + goal.attentionCount, 0),
        staleCount: systemGoals.reduce((total, goal) => total + goal.staleCount, 0),
      };
    })
    .sort(compareSystems);
  return {
    ...projection,
    attention: {
      items,
      currentCount: items.filter((item) => item.requiresHumanInput).length,
      uncertaintyCount: items.filter((item) => !item.requiresHumanInput).length,
    },
    systems,
    goals,
    unassigned: projection.unassigned.map(enrich).sort(compareAgents),
    counts: {
      ...projection.counts,
      attention: items.filter((item) => item.requiresHumanInput).length,
      uncertainty: items.filter((item) => !item.requiresHumanInput).length,
    },
  };
};

export const enrichMap = (
  projection: UniverseMapProjection,
  snapshot: AgentEvidenceSnapshot,
): UniverseMapProjection => {
  const fusion = fuseAgents(
    projection.goals,
    projection.unassigned,
    projection.attention.items,
    snapshot,
  );
  const items = fusion.items;
  const enrich = <T extends AgentView>(agent: T): T => ({
    ...agent,
    ...fusion.enrich(agent),
  });
  return {
    ...projection,
    goals: projection.goals.map((goal) => {
      const agents = goal.agents.map(enrich);
      return {
        ...goal,
        agents,
        attentionCount: agents.filter((agent) => agent.attention?.requiresHumanInput).length,
        staleCount: agents.filter(uncertainAgent).length,
      };
    }),
    unassigned: projection.unassigned.map(enrich),
    attention: {
      items,
      currentCount: items.filter((item) => item.requiresHumanInput).length,
      uncertaintyCount: items.filter((item) => !item.requiresHumanInput).length,
    },
    counts: {
      ...projection.counts,
      attention: items.filter((item) => item.requiresHumanInput).length,
      uncertainty: items.filter((item) => !item.requiresHumanInput).length,
    },
  };
};

const evidenceCatchUpOutcome = (
  observation: StoredAgentObservation,
): CatchUpProjection["subjects"][number]["outcome"] => {
  if (observation.kind === "human-input-request")
    return observation.payload.state === "open" ? "attention" : "changed";
  if (observation.kind === "turn-outcome")
    return observation.payload.outcome === "failed"
      ? "attention"
      : observation.payload.outcome === "response-completed"
        ? "finished"
        : "changed";
  if (observation.kind === "context-pressure")
    return observation.payload.compaction === "started" ||
      (observation.payload.usedRatio ?? 0) >= 0.75
      ? "stale"
      : "changed";
  return "changed";
};

const transitionSummary = (observation: StoredAgentObservation, provider: string): string => {
  if (observation.kind === "human-input-request")
    return `${provider} ${observation.payload.requestKind.replace("-", " ")} request ${observation.payload.state}.`;
  if (observation.kind === "turn-outcome")
    return `${provider} reported ${observation.payload.outcome.replaceAll("-", " ")}.`;
  if (observation.kind === "context-pressure")
    return observation.payload.compaction
      ? `${provider} compaction ${observation.payload.compaction}.`
      : `${provider} context pressure changed.`;
  return `${provider} activity changed to ${observation.payload.phase.replaceAll("-", " ")}.`;
};

export const enrichCatchUp = (
  projection: CatchUpProjection,
  snapshot: AgentEvidenceSnapshot,
  commandCentre?: CommandCentreProjection,
): CatchUpProjection => {
  const providers = new Map(snapshot.agents.map((item) => [item.agentId, item.providerLabel]));
  const labels = {
    activity: "Provider activity",
    "human-input-request": "Provider requests",
    "turn-outcome": "Provider outcomes",
    "context-pressure": "Context pressure",
  } satisfies Record<AgentObservationKind, string>;
  const order: AgentObservationKind[] = [
    "human-input-request",
    "turn-outcome",
    "context-pressure",
    "activity",
  ];
  const agents = commandCentre
    ? [...commandCentre.goals.flatMap((goal) => goal.agents), ...commandCentre.unassigned]
    : [];
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const subjects = new Map(
    projection.subjects.map((subject) => [
      subject.id,
      {
        ...subject,
        evidenceGroups: [...(subject.evidenceGroups ?? [])],
        agentIds: new Set(
          subject.transitions
            .filter((item) => item.targetType === "agent")
            .map((item) => item.targetId),
        ),
      },
    ]),
  );
  const subjectForAgent = (agentId: string) => {
    const agent = agentsById.get(agentId);
    const goalId = agent?.primaryGoalId;
    return goalId
      ? {
          id: `goal:${goalId}`,
          subjectType: "goal" as const,
          subjectId: goalId,
          title: agent.goalTitle ?? "Goal no longer available",
        }
      : { id: "unassigned", subjectType: "unassigned" as const, title: "Unassigned work" };
  };
  for (const kind of order) {
    const matching = snapshot.transitions.filter((item) => item.observation.kind === kind);
    const transitions =
      kind === "activity"
        ? [
            ...new Map(
              matching.map((item) => [
                `${item.agentId}\u0000${item.observation.kind === "activity" ? item.observation.payload.phase : ""}`,
                item,
              ]),
            ).values(),
          ]
        : matching;
    const grouped = new Map<string, typeof transitions>();
    for (const item of transitions
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, 20)) {
      const key = subjectForAgent(item.agentId).id;
      const existing = grouped.get(key);
      if (existing) existing.push(item);
      else grouped.set(key, [item]);
    }
    for (const [subjectId, items] of grouped) {
      const subjectScope = subjectForAgent(items[0]?.agentId ?? "");
      const newest = items[0];
      if (!newest) continue;
      const evidenceItems = items.map((item) => ({
        sequence: item.sequence,
        agentId: item.agentId,
        occurredAt: item.observation.observedAt,
        summary: transitionSummary(
          item.observation,
          providers.get(item.agentId) ?? item.observation.nativeConversationRef.harnessId,
        ),
      }));
      const existing = subjects.get(subjectId) ?? {
        ...subjectScope,
        occurredAt: newest.observation.observedAt,
        sequence: newest.sequence,
        outcome: evidenceCatchUpOutcome(newest.observation),
        affectedTargetCount: 0,
        transitionCount: 0,
        summaries: [],
        transitions: [],
        evidenceGroups: [],
        agentIds: new Set<string>(),
      };
      for (const item of items) existing.agentIds.add(item.agentId);
      const rank = { attention: 0, finished: 1, stale: 2, new: 3, changed: 4 } as const;
      const observedOutcome =
        items
          .map((item) => evidenceCatchUpOutcome(item.observation))
          .sort((left, right) => rank[left] - rank[right])[0] ?? "changed";
      subjects.set(subjectId, {
        ...existing,
        occurredAt: Math.max(existing.occurredAt, newest.observation.observedAt),
        sequence: Math.max(existing.sequence, newest.sequence),
        outcome:
          rank[observedOutcome] < rank[existing.outcome] ? observedOutcome : existing.outcome,
        affectedTargetCount: Math.max(existing.affectedTargetCount, existing.agentIds.size),
        evidenceTransitionCount: (existing.evidenceTransitionCount ?? 0) + items.length,
        evidenceGroups: [
          ...existing.evidenceGroups.filter((group) => group.kind !== kind),
          { kind, label: labels[kind], items: evidenceItems },
        ],
      });
    }
  }

  return {
    ...projection,
    pending: projection.pending || snapshot.transitions.length > 0,
    evidenceTransitionCount: snapshot.transitions.length,
    subjects: [...subjects.values()]
      .map(({ agentIds: _agentIds, ...subject }) => subject)
      .sort((left, right) => {
        const rank = { attention: 0, finished: 1, stale: 2, new: 3, changed: 4 } as const;
        return (
          rank[left.outcome] - rank[right.outcome] ||
          right.occurredAt - left.occurredAt ||
          left.title.localeCompare(right.title)
        );
      }),
  };
};

export const enrichInspector = (
  projection: InspectorProjection,
  snapshot: AgentEvidenceSnapshot,
): InspectorProjection => {
  if (projection.kind !== "agent-inspector") return projection;
  const evidence = snapshot.agents.find((item) => item.agentId === projection.agent.id);
  if (!evidence) return projection;
  const view = evidenceView(evidence, snapshot.generatedAt, projection.agent);
  const attention = composeAttention([
    ...providerSignals(projection.agent, view, snapshot.generatedAt, "P3"),
    ...expandAttention(projection.agent.attention ? [projection.agent.attention] : []),
  ]).items[0];
  return {
    ...projection,
    agent: enrichAgent(projection.agent, evidence, snapshot.generatedAt, attention),
  };
};
