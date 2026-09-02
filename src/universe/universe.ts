import type { HostSnapshot, HostAgentObservation } from "../hosts/types.ts";
import type { Projection, ProjectionModule, ProjectionQuery } from "../projection/types.ts";
import {
  cloneUniverseState,
  emptyUniverseState,
  isCurrentAttentionState,
  type Clock,
  type ExecutionContainerRef,
  type Goal,
  type GoalId,
  type HostHealth,
  type IdGenerator,
  type Priority,
  type System,
  type SystemId,
  type ProviderSessionFact,
  type AgentId,
  type Agent,
  type NativeConversationRef,
  type UniverseChange,
  type UniverseChangeOutcome,
  type UniverseState,
  type UniverseStore,
} from "./types.ts";
import {
  defaultGoalMapPosition,
  initialGoalMapPosition,
  isMapPosition,
  repairGoalMapPosition,
  type GoalLayoutOccupancy,
} from "../spatial/positions.ts";

export type UniverseCommand =
  | {
      readonly type: "CreateSystem";
      readonly title: string;
      readonly description?: string;
      readonly id?: SystemId;
    }
  | { readonly type: "RenameSystem"; readonly systemId: SystemId; readonly title: string }
  | {
      readonly type: "SetSystemDescription";
      readonly systemId: SystemId;
      readonly description?: string;
    }
  | {
      readonly type: "CreateGoal";
      readonly title: string;
      readonly description?: string;
      readonly priority?: Priority;
      readonly systemId?: SystemId;
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
      readonly type: "AssignGoalToSystem";
      readonly goalId: GoalId;
      readonly systemId?: SystemId;
    }
  | {
      readonly type: "AssignAgent";
      readonly agentId: AgentId;
      readonly goalId: GoalId;
    }
  | {
      readonly type: "AssignAgents";
      readonly agentIds: readonly AgentId[];
      readonly goalId: GoalId;
    }
  | {
      readonly type: "AdoptRelatedAgents";
      readonly goalId: GoalId;
      readonly agentIds: readonly AgentId[];
    }
  | {
      readonly type: "DismissRelatedAgents";
      readonly goalId: GoalId;
      readonly agentIds: readonly AgentId[];
    }
  | { readonly type: "UnassignAgent"; readonly agentId: AgentId }
  | {
      readonly type: "RenameAgent";
      readonly agentId: AgentId;
      readonly displayName: string;
    }
  | {
      readonly type: "SetAgentDescription";
      readonly agentId: AgentId;
      readonly description?: string;
    }
  | {
      readonly type: "AddConversation";
      readonly admissionSource: "provider-catalogue" | "managed-launch";
      readonly resumeEligibility?: "same-site" | "provider-account" | "blocked" | "unknown";
      readonly harnessId: string;
      readonly nativeConversationRef: NativeConversationRef;
      readonly displayName: string;
      readonly workspaceRef?: string;
      readonly observedAt: number;
      readonly goalId?: GoalId;
    }
  | { readonly type: "ArchiveAgent"; readonly agentId: AgentId }
  | { readonly type: "ArchiveAgents"; readonly agentIds: readonly AgentId[] }
  | { readonly type: "CompleteGoal"; readonly goalId: GoalId }
  | { readonly type: "ArchiveGoal"; readonly goalId: GoalId }
  | { readonly type: "AcknowledgeCatchUp" };

export interface CommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly goalId?: GoalId;
  readonly systemId?: SystemId;
  readonly agentId?: AgentId;
  readonly affectedAgentIds?: readonly AgentId[];
  readonly checkpointSequence?: number;
}

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly updatedAgentIds: readonly AgentId[];
  readonly staleAgentIds: readonly AgentId[];
  readonly diagnostics: readonly string[];
  readonly error?: string;
}

export type UniverseObservation =
  | { readonly kind: "host-executions"; readonly snapshot: HostSnapshot }
  | {
      readonly kind: "provider-catalogue";
      readonly harnessId: string;
      readonly continuityScopeId: string;
      readonly observedAt: number;
      readonly complete: boolean;
      readonly sessions: readonly ProviderSessionFact[];
    }
  | { readonly kind: "provider-unavailable"; readonly harnessId: string };

const normalizeText = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const copyExecutionContainer = (
  value: ExecutionContainerRef | undefined,
): ExecutionContainerRef | undefined => {
  const id = normalizeText(value?.id);
  if (!id) return undefined;
  const label = normalizeText(value?.label);
  return label ? { id, label } : { id };
};

const uniqueAgentIds = (agentIds: readonly AgentId[]): AgentId[] => [
  ...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean)),
];

const dismissalKey = (goalId: GoalId, agentId: AgentId): string => `${goalId}\u0000${agentId}`;

const findGoal = (state: UniverseState, goalId: GoalId): Goal | undefined =>
  state.goals.find((goal) => goal.id === goalId);
const findSystem = (state: UniverseState, systemId: SystemId): System | undefined =>
  state.systems.find((system) => system.id === systemId);
const findAgent = (state: UniverseState, agentId: AgentId): Agent | undefined =>
  state.agents.find((agent) => agent.id === agentId);

const goalLayoutOccupancy = (state: UniverseState, excludeGoalId?: GoalId): GoalLayoutOccupancy[] =>
  state.goals
    .filter((goal) => goal.id !== excludeGoalId)
    .map((goal) => ({
      position: goal.mapPosition ?? defaultGoalMapPosition(goal.id),
      agentCount: state.agents.filter(
        (agent) => agent.primaryGoalId === goal.id && agent.archivedAt === undefined,
      ).length,
    }));

const replaceGoal = (state: UniverseState, goal: Goal): void => {
  state.goals = state.goals.map((candidate) => (candidate.id === goal.id ? goal : candidate));
};

const replaceSystem = (state: UniverseState, system: System): void => {
  state.systems = state.systems.map((candidate) =>
    candidate.id === system.id ? system : candidate,
  );
};

const replaceAgent = (state: UniverseState, agent: Agent): void => {
  state.agents = state.agents.map((candidate) => (candidate.id === agent.id ? agent : candidate));
};

const repairUnpinnedGoalPosition = (state: UniverseState, goalId: GoalId): void => {
  const goal = findGoal(state, goalId);
  if (!goal || goal.mapPositionPinned) return;
  const agentCount = state.agents.filter(
    (agent) => agent.primaryGoalId === goal.id && agent.archivedAt === undefined,
  ).length;
  replaceGoal(state, {
    ...goal,
    mapPosition: repairGoalMapPosition(
      goal.id,
      goal.mapPosition ?? defaultGoalMapPosition(goal.id),
      goalLayoutOccupancy(state, goal.id),
      agentCount,
    ),
  });
};

const replaceHost = (state: UniverseState, host: HostHealth): void => {
  state.hosts = [
    ...state.hosts.filter((candidate) => candidate.hostInstanceId !== host.hostInstanceId),
    host,
  ];
};

const change = (
  sequence: number,
  occurredAt: number,
  outcome: UniverseChangeOutcome,
  targetType: UniverseChange["targetType"],
  targetId: string,
  summary: string,
  goalId?: GoalId,
): UniverseChange => {
  const item: UniverseChange = {
    sequence,
    occurredAt,
    outcome,
    targetType,
    targetId,
    summary,
  };
  if (goalId) Object.assign(item, { goalId });
  return item;
};

const samePosition = (left: Goal["mapPosition"], right: Goal["mapPosition"]): boolean =>
  left?.x === right?.x && left?.y === right?.y;

const deriveChanges = (
  previous: UniverseState,
  next: UniverseState,
  occurredAt: number,
): UniverseChange[] => {
  let sequence = previous.changes.at(-1)?.sequence ?? 0;
  const changes: UniverseChange[] = [];
  const append = (
    outcome: UniverseChangeOutcome,
    targetType: UniverseChange["targetType"],
    targetId: string,
    summary: string,
    goalId?: GoalId,
  ): void => {
    sequence += 1;
    changes.push(change(sequence, occurredAt, outcome, targetType, targetId, summary, goalId));
  };

  const previousGoals = new Map(previous.goals.map((goal) => [goal.id, goal]));
  const previousSystems = new Map((previous.systems ?? []).map((system) => [system.id, system]));
  for (const system of next.systems) {
    const before = previousSystems.get(system.id);
    if (!before) {
      append("new", "system", system.id, `New system · ${system.title}`);
      continue;
    }
    if (before.title !== system.title) {
      append("changed", "system", system.id, `Renamed system · ${before.title} → ${system.title}`);
      continue;
    }
    if (before.description !== system.description)
      append("changed", "system", system.id, `Updated system · ${system.title}`);
  }
  for (const goal of next.goals) {
    const before = previousGoals.get(goal.id);
    if (!before) {
      append("new", "goal", goal.id, `New goal · ${goal.title}`, goal.id);
      continue;
    }
    if (before.status !== goal.status) {
      const verb = goal.status === "completed" ? "Completed" : "Archived";
      append("finished", "goal", goal.id, `${verb} goal · ${goal.title}`, goal.id);
      continue;
    }
    if (before.title !== goal.title) {
      append("changed", "goal", goal.id, `Renamed goal · ${before.title} → ${goal.title}`, goal.id);
      continue;
    }
    if (before.priority !== goal.priority) {
      append(
        "changed",
        "goal",
        goal.id,
        `Priority changed · ${goal.title} · ${before.priority} → ${goal.priority}`,
        goal.id,
      );
      continue;
    }
    if (before.systemId !== goal.systemId) {
      const destination = goal.systemId
        ? (next.systems.find((system) => system.id === goal.systemId)?.title ?? "another system")
        : "no system";
      append(
        "changed",
        "goal",
        goal.id,
        `System changed · ${goal.title} → ${destination}`,
        goal.id,
      );
      continue;
    }
    if (
      before.description !== goal.description ||
      !samePosition(before.mapPosition, goal.mapPosition) ||
      before.mapPositionPinned !== goal.mapPositionPinned
    )
      append("changed", "goal", goal.id, `Updated goal · ${goal.title}`, goal.id);
  }

  const nextGoals = new Map(next.goals.map((goal) => [goal.id, goal]));
  const previousAgents = new Map(previous.agents.map((agent) => [agent.id, agent]));
  for (const agent of next.agents) {
    const before = previousAgents.get(agent.id);
    const goalId = agent.primaryGoalId ?? before?.primaryGoalId;
    if (!before) {
      append("new", "agent", agent.id, `New agent observed · ${agent.displayName}`, goalId);
      continue;
    }
    if (before.archivedAt === undefined && agent.archivedAt !== undefined) {
      append("finished", "agent", agent.id, `Archived agent · ${agent.displayName}`, goalId);
      continue;
    }
    if (before.primaryGoalId !== agent.primaryGoalId) {
      const destination = agent.primaryGoalId
        ? (nextGoals.get(agent.primaryGoalId)?.title ?? "another goal")
        : "unassigned inbox";
      append(
        "changed",
        "agent",
        agent.id,
        `Assignment changed · ${agent.displayName} → ${destination}`,
        goalId,
      );
      continue;
    }
    if (before.hostHealth !== agent.hostHealth) {
      const recovered = agent.hostHealth === "live";
      append(
        recovered ? "changed" : "stale",
        "agent",
        agent.id,
        recovered
          ? `Agent returned live · ${agent.displayName}`
          : `Host observation ${agent.hostHealth} · ${agent.displayName}`,
        goalId,
      );
      continue;
    }
    if (before.runtimeState !== agent.runtimeState) {
      const outcome: UniverseChangeOutcome =
        agent.runtimeState === "blocked" || agent.runtimeState === "waiting"
          ? "attention"
          : agent.runtimeState === "done"
            ? "finished"
            : "changed";
      append(
        outcome,
        "agent",
        agent.id,
        `Agent state · ${agent.displayName} · ${before.runtimeState} → ${agent.runtimeState}`,
        goalId,
      );
      continue;
    }
    if (before.displayName !== agent.displayName || before.description !== agent.description)
      append("changed", "agent", agent.id, `Updated agent · ${agent.displayName}`, goalId);
  }
  return changes;
};

const appendChanges = (previous: UniverseState, next: UniverseState, now: number): void => {
  next.changes = [...previous.changes, ...deriveChanges(previous, next, now)];
};

const changedAgentIds = (previous: readonly Agent[], next: readonly Agent[]): readonly string[] => {
  const previousById = new Map(previous.map((agent) => [agent.id, JSON.stringify(agent)]));
  return next
    .filter((agent) => {
      const before = previousById.get(agent.id);
      return before !== undefined && JSON.stringify(agent) !== before;
    })
    .map((agent) => agent.id);
};

const isDuplicateObservation = (agents: readonly HostAgentObservation[]): string | undefined => {
  const seen = new Set<string>();
  for (const agent of agents) {
    const key = agent.nativeId.trim();
    if (!key) return "Host observation has an empty native identifier.";
    if (seen.has(key)) return `Duplicate native identity from host: ${key}`;
    seen.add(key);
  }
  return undefined;
};

const nativeConversationKey = (reference: NativeConversationRef): string =>
  `${reference.harnessId}\u0000${reference.continuityScopeId ?? "legacy"}\u0000${reference.kind}\u0000${reference.value}`;

const isScopeEnrichment = (
  current: NativeConversationRef,
  observed: NativeConversationRef,
): boolean =>
  current.continuityScopeId === undefined &&
  observed.continuityScopeId !== undefined &&
  current.harnessId === observed.harnessId &&
  current.kind === observed.kind &&
  current.value === observed.value;

const sameConversationWithoutScope = (
  current: NativeConversationRef,
  observed: NativeConversationRef,
): boolean =>
  current.harnessId === observed.harnessId &&
  current.kind === observed.kind &&
  current.value === observed.value;

const resolveConversationAgent = (
  agents: readonly Agent[],
  reference: NativeConversationRef,
): Agent | undefined => {
  const exact = agents.find(
    (agent) =>
      agent.nativeConversationRef &&
      nativeConversationKey(agent.nativeConversationRef) === nativeConversationKey(reference),
  );
  if (exact || !reference.continuityScopeId) return exact;

  const compatible = agents.filter(
    (agent) =>
      agent.nativeConversationRef &&
      sameConversationWithoutScope(agent.nativeConversationRef, reference),
  );
  const unscoped = compatible.filter(
    (agent) => agent.nativeConversationRef?.continuityScopeId === undefined,
  );
  const conflictingScope = compatible.some(
    (agent) =>
      agent.nativeConversationRef?.continuityScopeId !== undefined &&
      agent.nativeConversationRef.continuityScopeId !== reference.continuityScopeId,
  );
  return unscoped.length === 1 && !conflictingScope ? unscoped[0] : undefined;
};

const appendDistinctExecutions = (
  left: readonly NonNullable<Agent["execution"]>[],
  right: readonly NonNullable<Agent["execution"]>[],
): Agent["executionHistory"] => {
  const executions = [...left];
  for (const execution of right)
    if (
      !executions.some(
        (candidate) =>
          candidate.hostInstanceId === execution.hostInstanceId &&
          candidate.nativeId === execution.nativeId,
      )
    )
      executions.push(execution);
  return executions;
};

const nativeConversationFromObservation = (
  observation: HostAgentObservation,
): NativeConversationRef | undefined => {
  const reference = observation.harnessEvidence?.nativeConversationRef;
  const harnessId = normalizeText(reference?.harnessId);
  const kind = normalizeText(reference?.kind);
  const value = normalizeText(reference?.value);
  const continuityScopeId = normalizeText(reference?.continuityScopeId);
  if (!harnessId || !kind || !value) return undefined;
  return continuityScopeId
    ? { harnessId, continuityScopeId, kind, value }
    : { harnessId, kind, value };
};

const executionMatches = (agent: Agent, hostInstanceId: string, nativeId: string): boolean =>
  agent.execution?.hostInstanceId === hostInstanceId &&
  agent.execution.nativeId === nativeId.trim();

const appendExecutionHistory = (
  agent: Agent,
  binding: Agent["execution"],
): Agent["executionHistory"] =>
  binding &&
  !agent.executionHistory.some(
    (candidate) =>
      candidate.hostInstanceId === binding.hostInstanceId &&
      candidate.nativeId === binding.nativeId,
  )
    ? [...agent.executionHistory, binding]
    : agent.executionHistory;

interface ReconciliationDraft {
  readonly state: UniverseState;
  readonly diagnostics: string[];
  readonly updatedAgentIds: AgentId[];
  readonly staleAgentIds: AgentId[];
}

const rejectedReconciliation = (
  error: string,
  diagnostics: readonly string[] = [],
): ReconciliationResult => ({
  accepted: false,
  updatedAgentIds: [],
  staleAgentIds: [],
  diagnostics: [...diagnostics, error],
  error,
});

const hostHealthFromSnapshot = (
  snapshot: HostSnapshot,
  previous: HostHealth | undefined,
  diagnosticCount: number,
): HostHealth => {
  const health: HostHealth = {
    hostKind: snapshot.hostKind,
    hostInstanceId: snapshot.hostInstanceId,
    status: snapshot.available ? "live" : "unavailable",
    diagnosticCount,
  };
  if (snapshot.available) Object.assign(health, { lastObservedAt: snapshot.observedAt });
  else if (previous?.lastObservedAt !== undefined)
    Object.assign(health, { lastObservedAt: previous.lastObservedAt });
  if (snapshot.error) Object.assign(health, { lastError: snapshot.error });
  return health;
};

const markHostUnavailable = (draft: ReconciliationDraft, hostInstanceId: string): void => {
  draft.state.agents = draft.state.agents.map((agent) => {
    if (agent.execution?.hostInstanceId !== hostInstanceId || agent.hostHealth === "unavailable")
      return agent;
    draft.staleAgentIds.push(agent.id);
    return {
      ...agent,
      hostHealth: "unavailable",
      executionPresence: "unknown",
      observationHealth: "unavailable",
      conflictingExecutions: [],
    };
  });
};

const indexConversationExecutions = (
  snapshot: HostSnapshot,
): Map<string, Agent["conflictingExecutions"]> => {
  const executions = new Map<string, Agent["conflictingExecutions"]>();
  for (const observation of snapshot.agents) {
    const reference = nativeConversationFromObservation(observation);
    if (!reference) continue;
    const key = nativeConversationKey(reference);
    executions.set(key, [
      ...(executions.get(key) ?? []),
      {
        hostKind: snapshot.hostKind,
        hostInstanceId: snapshot.hostInstanceId,
        nativeId: observation.nativeId.trim(),
        hostLocator: observation.hostLocator,
        observedAt: observation.observedAt,
      },
    ]);
  }
  return executions;
};

const detachMissingExecutions = (draft: ReconciliationDraft, snapshot: HostSnapshot): void => {
  const observedIds = new Set(snapshot.agents.map((agent) => agent.nativeId.trim()));
  draft.state.agents = draft.state.agents.map((agent) => {
    if (
      agent.execution?.hostInstanceId !== snapshot.hostInstanceId ||
      observedIds.has(agent.execution.nativeId) ||
      agent.execution.observedAt > snapshot.observedAt
    )
      return agent;
    draft.staleAgentIds.push(agent.id);
    return {
      ...agent,
      execution: undefined,
      executionHistory: appendExecutionHistory(agent, agent.execution),
      hostHealth: "stale",
      executionPresence: "absent",
      observationHealth: "fresh",
      conflictingExecutions: [],
      executionObservedAt: snapshot.observedAt,
      continuity: agent.nativeConversationRef ? agent.continuity : "unknown",
    };
  });
};

const detachReplacedExecution = (
  draft: ReconciliationDraft,
  agent: Agent,
  observedAt: number,
  continuity: "replaced" | "unknown",
): void => {
  replaceAgent(draft.state, {
    ...agent,
    execution: undefined,
    executionHistory: appendExecutionHistory(agent, agent.execution),
    executionPresence: "absent",
    executionObservedAt: observedAt,
    observationHealth: "fresh",
    runtimeState: "unknown",
    runtimeStateSource: "observatory.continuity",
    hostHealth: "stale",
    attentionSince: undefined,
    continuity,
  });
  if (!draft.staleAgentIds.includes(agent.id)) draft.staleAgentIds.push(agent.id);
};

const displayNameRank = (source: Agent["displayNameSource"]): number =>
  source === "human" ? 2 : source === "provider" ? 1 : 0;

const consolidateLegacyConversationVariants = (
  draft: ReconciliationDraft,
  canonical: Agent,
): Agent => {
  const reference = canonical.nativeConversationRef;
  if (!reference?.continuityScopeId) return canonical;
  const legacy = draft.state.agents.filter(
    (candidate) =>
      candidate.id !== canonical.id &&
      candidate.nativeConversationRef !== undefined &&
      candidate.nativeConversationRef.continuityScopeId === undefined &&
      sameConversationWithoutScope(candidate.nativeConversationRef, reference),
  );
  if (legacy.length === 0) return canonical;

  let merged = canonical;
  for (const duplicate of legacy) {
    if (
      merged.primaryGoalId &&
      duplicate.primaryGoalId &&
      merged.primaryGoalId !== duplicate.primaryGoalId
    )
      draft.diagnostics.push(
        `Consolidated duplicate Agent ${duplicate.id} into ${merged.id}; retained the canonical Goal assignment.`,
      );
    const duplicateNameWins =
      displayNameRank(duplicate.displayNameSource) > displayNameRank(merged.displayNameSource);
    merged = Object.assign({}, merged, {
      displayName: duplicateNameWins ? duplicate.displayName : merged.displayName,
      displayNameSource: duplicateNameWins ? duplicate.displayNameSource : merged.displayNameSource,
      description: merged.description ?? duplicate.description,
      primaryGoalId: merged.primaryGoalId ?? duplicate.primaryGoalId,
      executionHistory: appendDistinctExecutions(
        merged.executionHistory,
        duplicate.executionHistory,
      ),
      lastSeenAt: Math.max(merged.lastSeenAt, duplicate.lastSeenAt),
      lastObservedAt: Math.max(merged.lastObservedAt, duplicate.lastObservedAt),
      lastChangedAt: Math.max(merged.lastChangedAt, duplicate.lastChangedAt),
      repository: merged.repository ?? duplicate.repository,
      branch: merged.branch ?? duplicate.branch,
      worktree: merged.worktree ?? duplicate.worktree,
      provider: merged.provider ?? duplicate.provider,
      archivedAt:
        merged.archivedAt === undefined
          ? duplicate.archivedAt
          : duplicate.archivedAt === undefined
            ? merged.archivedAt
            : Math.min(merged.archivedAt, duplicate.archivedAt),
    });
    draft.state.agents = draft.state.agents.filter((candidate) => candidate.id !== duplicate.id);
    const dismissals = new Map<string, (typeof draft.state.relatedAgentDismissals)[number]>();
    for (const dismissal of draft.state.relatedAgentDismissals) {
      const normalized =
        dismissal.agentId === duplicate.id ? { ...dismissal, agentId: merged.id } : dismissal;
      const key = dismissalKey(normalized.goalId, normalized.agentId);
      const previous = dismissals.get(key);
      if (!previous || normalized.dismissedAt < previous.dismissedAt)
        dismissals.set(key, normalized);
    }
    draft.state.relatedAgentDismissals = [...dismissals.values()];
    draft.diagnostics.push(
      `Consolidated legacy duplicate Agent ${duplicate.id} into scoped Agent ${merged.id}.`,
    );
  }
  replaceAgent(draft.state, merged);
  if (!draft.updatedAgentIds.includes(merged.id)) draft.updatedAgentIds.push(merged.id);
  return merged;
};

const reconcileObservation = (
  draft: ReconciliationDraft,
  snapshot: HostSnapshot,
  observation: HostAgentObservation,
  conversationExecutions: ReadonlyMap<string, Agent["conflictingExecutions"]>,
): void => {
  const observedConversation = nativeConversationFromObservation(observation);
  const byConversation = observedConversation
    ? draft.state.agents.find(
        (agent) =>
          agent.nativeConversationRef &&
          nativeConversationKey(agent.nativeConversationRef) ===
            nativeConversationKey(observedConversation),
      )
    : undefined;
  let byExecution = draft.state.agents.find((agent) =>
    executionMatches(agent, snapshot.hostInstanceId, observation.nativeId),
  );

  if (byConversation && byExecution && byConversation.id !== byExecution.id) {
    detachReplacedExecution(draft, byExecution, snapshot.observedAt, "replaced");
    byExecution = undefined;
  }
  if (
    !byConversation &&
    byExecution &&
    ((byExecution.nativeConversationRef &&
      observedConversation &&
      nativeConversationKey(byExecution.nativeConversationRef) !==
        nativeConversationKey(observedConversation) &&
      !isScopeEnrichment(byExecution.nativeConversationRef, observedConversation)) ||
      (byExecution.runtimeStateSource === "observatory.process-start" &&
        Boolean(byExecution.nativeConversationRef) &&
        !observedConversation))
  ) {
    detachReplacedExecution(
      draft,
      byExecution,
      snapshot.observedAt,
      observedConversation ? "replaced" : "unknown",
    );
    byExecution = undefined;
  }

  let existing = byConversation ?? byExecution;
  if (!existing) {
    draft.diagnostics.push(
      `Observed untracked ${snapshot.hostKind} execution ${observation.nativeId.trim()}; no durable Agent was created.`,
    );
    return;
  }

  existing = consolidateLegacyConversationVariants(draft, existing);

  const conflicts = observedConversation
    ? (conversationExecutions.get(nativeConversationKey(observedConversation)) ?? [])
    : [];
  if (conflicts.length > 1) {
    replaceAgent(draft.state, {
      ...existing,
      executionPresence: "conflict",
      resumeCapability: "blocked",
      observationHealth: "fresh",
      executionObservedAt: observation.observedAt,
      conflictingExecutions: conflicts,
    });
    draft.diagnostics.push(
      `Multiple live executions claim the provider conversation for ${existing.displayName}; resume is blocked.`,
    );
    if (!draft.updatedAgentIds.includes(existing.id)) draft.updatedAgentIds.push(existing.id);
    return;
  }

  if (observation.observedAt < existing.lastObservedAt) {
    draft.diagnostics.push(
      `Ignored an older observation for ${observation.nativeId.trim()}: ${observation.observedAt} is older than ${existing.lastObservedAt}.`,
    );
    return;
  }

  const stateChanged = existing.runtimeState !== observation.runtimeState;
  const currentAttention = isCurrentAttentionState(observation.runtimeState);
  const updated: Agent = {
    ...existing,
    runtimeState: observation.runtimeState,
    runtimeStateSource: observation.runtimeStateSource,
    hostHealth: "live",
    lastSeenAt: observation.observedAt,
    lastObservedAt: observation.observedAt,
    lastChangedAt: stateChanged ? observation.observedAt : existing.lastChangedAt,
    execution: {
      hostKind: snapshot.hostKind,
      hostInstanceId: snapshot.hostInstanceId,
      nativeId: observation.nativeId.trim(),
      hostLocator: observation.hostLocator,
      observedAt: observation.observedAt,
    },
    executionHistory:
      existing.execution &&
      (existing.execution.hostInstanceId !== snapshot.hostInstanceId ||
        existing.execution.nativeId !== observation.nativeId.trim())
        ? appendExecutionHistory(existing, existing.execution)
        : existing.executionHistory,
    conflictingExecutions: [],
    executionPresence: "live",
    executionObservedAt: observation.observedAt,
    observationHealth: "fresh",
    harnessId:
      observation.harnessEvidence?.detectedHarnessId ??
      observedConversation?.harnessId ??
      existing.harnessId,
    nativeConversationRef: observedConversation ?? existing.nativeConversationRef,
    continuity: observedConversation ? "proved" : existing.continuity,
    displayName:
      existing.displayNameSource === "fallback" ? observation.displayName : existing.displayName,
    attentionSince: currentAttention
      ? stateChanged
        ? observation.observedAt
        : (existing.attentionSince ?? observation.observedAt)
      : undefined,
    repository: observation.repository,
    branch: observation.branch,
    worktree: observation.worktree,
    provider: observation.provider,
    executionContainer: copyExecutionContainer(observation.executionContainer),
  };
  replaceAgent(draft.state, updated);
  draft.updatedAgentIds.push(existing.id);
};

const planReconciliation = (
  previous: UniverseState,
  snapshot: HostSnapshot,
): ReconciliationDraft | ReconciliationResult => {
  const duplicate = isDuplicateObservation(snapshot.agents);
  if (duplicate) return rejectedReconciliation(duplicate);

  const diagnostics = [...snapshot.diagnostics];
  const previousHost = previous.hosts.find(
    (candidate) => candidate.hostInstanceId === snapshot.hostInstanceId,
  );
  if (
    previousHost?.lastObservedAt !== undefined &&
    snapshot.observedAt < previousHost.lastObservedAt
  ) {
    const error = `Out-of-order ${snapshot.hostKind} snapshot ignored: ${snapshot.observedAt} is older than ${previousHost.lastObservedAt}.`;
    return rejectedReconciliation(error, diagnostics);
  }

  const scopeDowngrade = snapshot.agents.find((observation) => {
    const observed = nativeConversationFromObservation(observation);
    if (!observed || observed.continuityScopeId !== undefined) return false;
    const current = previous.agents.find((agent) =>
      executionMatches(agent, snapshot.hostInstanceId, observation.nativeId),
    )?.nativeConversationRef;
    return Boolean(current?.continuityScopeId && sameConversationWithoutScope(current, observed));
  });
  if (scopeDowngrade)
    return rejectedReconciliation(
      `Unscoped provider identity for ${scopeDowngrade.nativeId.trim()} cannot replace its scoped conversation without canonical evidence.`,
      diagnostics,
    );

  const draft: ReconciliationDraft = {
    state: cloneUniverseState(previous),
    diagnostics,
    updatedAgentIds: [],
    staleAgentIds: [],
  };
  replaceHost(
    draft.state,
    hostHealthFromSnapshot(snapshot, previousHost, draft.diagnostics.length),
  );

  if (!snapshot.available) {
    markHostUnavailable(draft, snapshot.hostInstanceId);
    return draft;
  }

  const conversationExecutions = indexConversationExecutions(snapshot);
  if (snapshot.complete) detachMissingExecutions(draft, snapshot);
  else
    draft.diagnostics.push(
      `Incomplete ${snapshot.hostKind} snapshot did not prove any execution absent.`,
    );
  for (const observation of snapshot.agents)
    reconcileObservation(draft, snapshot, observation, conversationExecutions);
  return draft;
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

  resolveAgentId(reference: NativeConversationRef): AgentId | undefined {
    return resolveConversationAgent(this.state.agents, reference)?.id;
  }

  project(query: ProjectionQuery): Projection {
    return this.projections.project(this.state, query);
  }

  /** The sole production interface for accepting host and provider observations. */
  observe(observation: UniverseObservation): ReconciliationResult {
    if (observation.kind === "host-executions") return this.reconcile(observation.snapshot);
    return observation.kind === "provider-unavailable"
      ? this.markProviderUnavailable(observation.harnessId)
      : this.reconcileProviderSessions(observation);
  }

  /** Discard persisted runtime certainty before the first fresh host observation. */
  invalidateRuntimeFacts(): void {
    const next = cloneUniverseState(this.state);
    next.agents = next.agents.map((agent) =>
      agent.execution
        ? {
            ...agent,
            runtimeState: "unknown",
            runtimeStateSource: "observatory.process-start",
            hostHealth: "stale",
            executionPresence: "unknown",
            observationHealth: "stale",
            attentionSince: undefined,
            continuity: agent.nativeConversationRef ? agent.continuity : "unknown",
          }
        : agent,
    );
    next.hosts = next.hosts.map((host) =>
      host.status === "live" ? { ...host, status: "stale" as const } : host,
    );
    this.store.save(next);
    this.state = next;
  }

  private reconcileProviderSessions(options: {
    readonly harnessId: string;
    readonly continuityScopeId: string;
    readonly observedAt: number;
    readonly complete: boolean;
    readonly sessions: readonly ProviderSessionFact[];
  }): ReconciliationResult {
    const previous = this.state;
    const latestAcceptedAt = previous.agents.reduce(
      (latest, agent) =>
        agent.nativeConversationRef?.harnessId === options.harnessId &&
        agent.nativeConversationRef.continuityScopeId === options.continuityScopeId
          ? Math.max(latest, agent.providerObservedAt ?? Number.NEGATIVE_INFINITY)
          : latest,
      Number.NEGATIVE_INFINITY,
    );
    if (options.observedAt < latestAcceptedAt)
      return rejectedReconciliation(
        `Out-of-order ${options.harnessId} provider catalogue ignored: ${options.observedAt} is older than ${latestAcceptedAt}.`,
      );
    const next = cloneUniverseState(previous);
    const canonicalAliases = options.sessions.flatMap((session) =>
      (session.nativeConversationAliases ?? []).map((alias) => ({
        alias,
        canonical: session.nativeConversationRef,
      })),
    );
    for (const session of options.sessions) {
      const compatible = resolveConversationAgent(next.agents, session.nativeConversationRef);
      if (compatible && compatible.nativeConversationRef?.continuityScopeId === undefined)
        replaceAgent(next, {
          ...compatible,
          nativeConversationRef: session.nativeConversationRef,
        });
    }
    next.agents = next.agents.map((agent) => {
      const reference = agent.nativeConversationRef;
      if (!reference) return agent;
      const matches = canonicalAliases.filter(
        ({ alias }) =>
          alias.harnessId === reference.harnessId &&
          alias.kind === reference.kind &&
          alias.value === reference.value &&
          (reference.continuityScopeId === undefined ||
            alias.continuityScopeId === reference.continuityScopeId),
      );
      if (matches.length !== 1) return agent;
      const canonical = matches[0]!.canonical;
      const canonicalOwned = next.agents.some(
        (candidate) =>
          candidate.id !== agent.id &&
          candidate.nativeConversationRef &&
          nativeConversationKey(candidate.nativeConversationRef) ===
            nativeConversationKey(canonical),
      );
      return canonicalOwned ? agent : { ...agent, nativeConversationRef: canonical };
    });
    const observed = new Map(
      options.sessions.map((session) => [
        nativeConversationKey(session.nativeConversationRef),
        session,
      ]),
    );
    next.agents = next.agents.map((agent) => {
      const reference = agent.nativeConversationRef;
      if (
        !reference ||
        reference.harnessId !== options.harnessId ||
        reference.continuityScopeId !== options.continuityScopeId
      )
        return agent;
      const session = observed.get(nativeConversationKey(reference));
      if (!session) {
        return options.complete
          ? {
              ...agent,
              providerContinuity: "missing" as const,
              resumeCapability: "blocked" as const,
              providerObservedAt: options.observedAt,
            }
          : agent;
      }
      const eligible =
        session.resumeEligibility === "same-site" ||
        session.resumeEligibility === "provider-account";
      return {
        ...agent,
        providerContinuity: "confirmed" as const,
        resumeCapability: eligible ? ("eligible" as const) : ("blocked" as const),
        providerObservedAt: session.observedAt,
        continuity: "proved" as const,
        displayName:
          agent.displayNameSource === "fallback" && normalizeText(session.title)
            ? normalizeText(session.title)!
            : agent.displayName,
        displayNameSource:
          agent.displayNameSource === "fallback" && normalizeText(session.title)
            ? ("provider" as const)
            : agent.displayNameSource,
        worktree: normalizeText(session.workspaceRef) ?? agent.worktree,
      };
    });
    const updatedAgentIds = changedAgentIds(previous.agents, next.agents);
    try {
      this.store.save(next);
    } catch (error) {
      return rejectedReconciliation(
        `Provider reconciliation rolled back: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.state = next;
    return {
      accepted: true,
      updatedAgentIds,
      staleAgentIds: [],
      diagnostics: [],
    };
  }

  private markProviderUnavailable(harnessId: string): ReconciliationResult {
    const previous = this.state;
    const next = cloneUniverseState(previous);
    next.agents = next.agents.map((agent) =>
      agent.harnessId === harnessId && agent.nativeConversationRef
        ? {
            ...agent,
            providerContinuity: "unknown" as const,
            resumeCapability: "unknown" as const,
          }
        : agent,
    );
    const updatedAgentIds = changedAgentIds(previous.agents, next.agents);
    try {
      this.store.save(next);
    } catch (error) {
      return rejectedReconciliation(
        `Provider availability update rolled back: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.state = next;
    return {
      accepted: true,
      updatedAgentIds,
      staleAgentIds: [],
      diagnostics: [],
    };
  }

  execute(command: UniverseCommand): CommandResult {
    const next = cloneUniverseState(this.state);
    const now = this.clock.now();
    let result: CommandResult;

    switch (command.type) {
      case "CreateSystem": {
        const title = normalizeText(command.title);
        if (!title) return { ok: false, error: "System title is required." };
        const id = command.id ?? this.ids.next("system");
        if (next.systems.some((system) => system.id === id))
          return { ok: false, error: `System ${id} already exists.` };
        const description = normalizeText(command.description);
        const system: System = { id, title, createdAt: now, updatedAt: now };
        next.systems = [...next.systems, description ? { ...system, description } : system];
        result = { ok: true, systemId: id };
        break;
      }
      case "RenameSystem": {
        const title = normalizeText(command.title);
        const system = findSystem(next, command.systemId);
        if (!title) return { ok: false, error: "System title is required." };
        if (!system) return { ok: false, error: "System not found." };
        replaceSystem(next, { ...system, title, updatedAt: now });
        result = { ok: true, systemId: system.id };
        break;
      }
      case "SetSystemDescription": {
        const system = findSystem(next, command.systemId);
        if (!system) return { ok: false, error: "System not found." };
        replaceSystem(next, {
          ...system,
          description: normalizeText(command.description),
          updatedAt: now,
        });
        result = { ok: true, systemId: system.id };
        break;
      }
      case "CreateGoal": {
        const title = normalizeText(command.title);
        if (!title) return { ok: false, error: "Goal title is required." };
        const id = command.id ?? this.ids.next("goal");
        if (next.goals.some((goal) => goal.id === id))
          return { ok: false, error: `Goal ${id} already exists.` };
        if (command.systemId && !findSystem(next, command.systemId))
          return { ok: false, error: "System not found." };
        const description = normalizeText(command.description);
        const goal = {
          id,
          systemId: command.systemId,
          title,
          priority: command.priority ?? "P2",
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
          mapPosition: initialGoalMapPosition(id, goalLayoutOccupancy(next)),
          mapPositionPinned: false,
        };
        if (description) Object.assign(goal, { description });
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
          description: description || undefined,
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
        const agentCount = next.agents.filter(
          (agent) => agent.primaryGoalId === goal.id && agent.archivedAt === undefined,
        ).length;
        replaceGoal(next, {
          ...goal,
          mapPosition: initialGoalMapPosition(
            goal.id,
            goalLayoutOccupancy(next, goal.id),
            agentCount,
          ),
          mapPositionPinned: false,
          updatedAt: now,
        });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "AssignGoalToSystem": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (command.systemId && !findSystem(next, command.systemId))
          return { ok: false, error: "System not found." };
        replaceGoal(next, { ...goal, systemId: command.systemId, updatedAt: now });
        result = { ok: true, goalId: goal.id, systemId: command.systemId };
        break;
      }
      case "AssignAgent": {
        const agent = findAgent(next, command.agentId);
        const goal = findGoal(next, command.goalId);
        if (!agent) return { ok: false, error: "Agent not found." };
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status === "archived")
          return {
            ok: false,
            error: "Archived goals cannot receive agents.",
          };
        replaceAgent(next, { ...agent, primaryGoalId: goal.id });
        next.relatedAgentDismissals = next.relatedAgentDismissals.filter(
          (dismissal) => dismissal.goalId !== goal.id || dismissal.agentId !== command.agentId,
        );
        repairUnpinnedGoalPosition(next, goal.id);
        result = { ok: true, agentId: agent.id, goalId: goal.id };
        break;
      }
      case "AssignAgents": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status === "archived")
          return { ok: false, error: "Archived goals cannot receive agents." };
        const agentIds = uniqueAgentIds(command.agentIds);
        if (agentIds.length === 0) return { ok: false, error: "At least one agent is required." };
        const missingAgentId = agentIds.find((agentId) => !findAgent(next, agentId));
        if (missingAgentId) return { ok: false, error: `Agent ${missingAgentId} not found.` };
        const selected = new Set(agentIds);
        next.agents = next.agents.map((agent) =>
          selected.has(agent.id) ? { ...agent, primaryGoalId: goal.id } : agent,
        );
        next.relatedAgentDismissals = next.relatedAgentDismissals.filter(
          (dismissal) => dismissal.goalId !== goal.id || !selected.has(dismissal.agentId),
        );
        repairUnpinnedGoalPosition(next, goal.id);
        result = { ok: true, goalId: goal.id, affectedAgentIds: agentIds };
        break;
      }
      case "AdoptRelatedAgents": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status === "archived")
          return { ok: false, error: "Archived goals cannot receive agents." };
        const agentIds = uniqueAgentIds(command.agentIds);
        if (agentIds.length === 0)
          return { ok: false, error: "At least one related agent is required." };
        const agents = agentIds.map((agentId) => findAgent(next, agentId));
        const missingIndex = agents.findIndex((agent) => !agent);
        if (missingIndex >= 0)
          return {
            ok: false,
            error: `Agent ${agentIds[missingIndex] ?? ""} not found.`,
          };
        const archived = agents.find((agent) => agent?.archivedAt !== undefined);
        if (archived) return { ok: false, error: "Archived agents cannot be adopted." };
        const assignedElsewhere = agents.find(
          (agent) => agent?.primaryGoalId && agent.primaryGoalId !== goal.id,
        );
        if (assignedElsewhere)
          return {
            ok: false,
            error: `${assignedElsewhere.displayName} is already attached to another goal.`,
          };
        const selected = new Set(agentIds);
        next.agents = next.agents.map((agent) =>
          selected.has(agent.id) ? { ...agent, primaryGoalId: goal.id } : agent,
        );
        next.relatedAgentDismissals = next.relatedAgentDismissals.filter(
          (dismissal) => dismissal.goalId !== goal.id || !selected.has(dismissal.agentId),
        );
        repairUnpinnedGoalPosition(next, goal.id);
        result = { ok: true, goalId: goal.id, affectedAgentIds: agentIds };
        break;
      }
      case "DismissRelatedAgents": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.status === "archived")
          return { ok: false, error: "Archived goals cannot be changed." };
        const agentIds = uniqueAgentIds(command.agentIds);
        if (agentIds.length === 0)
          return { ok: false, error: "At least one related agent is required." };
        const missingIndex = agentIds.findIndex((agentId) => !findAgent(next, agentId));
        if (missingIndex >= 0)
          return {
            ok: false,
            error: `Agent ${agentIds[missingIndex] ?? ""} not found.`,
          };
        const archived = agentIds.some(
          (agentId) => findAgent(next, agentId)?.archivedAt !== undefined,
        );
        if (archived) return { ok: false, error: "Archived agents cannot be dismissed." };
        const existing = new Set(
          next.relatedAgentDismissals.map((dismissal) =>
            dismissalKey(dismissal.goalId, dismissal.agentId),
          ),
        );
        const additions = agentIds.flatMap((agentId) => {
          const key = dismissalKey(goal.id, agentId);
          if (existing.has(key)) return [];
          existing.add(key);
          return [{ goalId: goal.id, agentId, dismissedAt: now }];
        });
        next.relatedAgentDismissals = [...next.relatedAgentDismissals, ...additions];
        result = { ok: true, goalId: goal.id, affectedAgentIds: agentIds };
        break;
      }
      case "UnassignAgent": {
        const agent = findAgent(next, command.agentId);
        if (!agent) return { ok: false, error: "Agent not found." };
        replaceAgent(next, { ...agent, primaryGoalId: undefined });
        result = { ok: true, agentId: agent.id };
        break;
      }
      case "RenameAgent": {
        const displayName = normalizeText(command.displayName);
        const agent = findAgent(next, command.agentId);
        if (!displayName) return { ok: false, error: "Agent name is required." };
        if (!agent) return { ok: false, error: "Agent not found." };
        replaceAgent(next, {
          ...agent,
          displayName,
          displayNameSource: "human",
        });
        result = { ok: true, agentId: agent.id };
        break;
      }
      case "SetAgentDescription": {
        const agent = findAgent(next, command.agentId);
        if (!agent) return { ok: false, error: "Agent not found." };
        const description = normalizeText(command.description);
        replaceAgent(next, {
          ...agent,
          description: description || undefined,
        });
        result = { ok: true, agentId: agent.id };
        break;
      }
      case "AddConversation": {
        const harnessId = normalizeText(command.harnessId);
        const displayName = normalizeText(command.displayName);
        const reference = command.nativeConversationRef;
        const continuityScopeId = normalizeText(reference.continuityScopeId);
        const kind = normalizeText(reference.kind);
        const value = normalizeText(reference.value);
        if (!harnessId || !displayName)
          return { ok: false, error: "Harness id and Agent name are required." };
        if (reference.harnessId !== harnessId || !kind || !value)
          return { ok: false, error: "Provider conversation reference is invalid." };
        if (command.admissionSource === "provider-catalogue" && !continuityScopeId)
          return { ok: false, error: "Provider catalogue admission requires a scoped reference." };
        if (command.admissionSource === "provider-catalogue" && !command.resumeEligibility)
          return { ok: false, error: "Provider catalogue admission requires resume eligibility." };
        if (command.admissionSource === "managed-launch" && command.resumeEligibility)
          return { ok: false, error: "Managed launch admission cannot claim resume eligibility." };
        const normalizedReference: NativeConversationRef = continuityScopeId
          ? { harnessId, continuityScopeId, kind, value }
          : { harnessId, kind, value };
        const goal = command.goalId ? findGoal(next, command.goalId) : undefined;
        if (command.goalId && !goal) return { ok: false, error: "Goal not found." };
        if (goal?.status === "archived")
          return { ok: false, error: "Archived goals cannot receive agents." };
        const providerAdmission = command.admissionSource === "provider-catalogue";
        const resumeEligible =
          command.resumeEligibility === "same-site" ||
          command.resumeEligibility === "provider-account";
        const existing = resolveConversationAgent(next.agents, normalizedReference);
        if (existing) {
          replaceAgent(next, {
            ...existing,
            nativeConversationRef:
              providerAdmission && continuityScopeId
                ? normalizedReference
                : existing.nativeConversationRef,
            providerContinuity: providerAdmission ? "confirmed" : existing.providerContinuity,
            resumeCapability: providerAdmission
              ? resumeEligible
                ? "eligible"
                : "blocked"
              : existing.resumeCapability,
            providerObservedAt: providerAdmission
              ? command.observedAt
              : existing.providerObservedAt,
            displayName:
              providerAdmission && existing.displayNameSource === "fallback"
                ? displayName
                : existing.displayName,
            displayNameSource:
              providerAdmission && existing.displayNameSource === "fallback"
                ? "provider"
                : existing.displayNameSource,
            primaryGoalId: goal?.id ?? existing.primaryGoalId,
            worktree: normalizeText(command.workspaceRef) ?? existing.worktree,
          });
          result = { ok: true, agentId: existing.id, goalId: goal?.id };
          break;
        }
        const agentId = this.ids.next("agent");
        next.agents.push({
          id: agentId,
          harnessId,
          nativeConversationRef: normalizedReference,
          continuity: "proved",
          providerContinuity: providerAdmission ? "confirmed" : "unknown",
          executionPresence: "unknown",
          resumeCapability: providerAdmission
            ? resumeEligible
              ? "eligible"
              : "blocked"
            : "unknown",
          observationHealth: "fresh",
          providerObservedAt: providerAdmission ? command.observedAt : undefined,
          executionHistory: [],
          conflictingExecutions: [],
          displayName,
          displayNameSource: providerAdmission ? "provider" : "fallback",
          primaryGoalId: goal?.id,
          runtimeState: "unknown",
          runtimeStateSource: `${harnessId}.${command.admissionSource}`,
          hostHealth: "stale",
          lastSeenAt: command.observedAt,
          lastObservedAt: command.observedAt,
          lastChangedAt: now,
          worktree: normalizeText(command.workspaceRef),
        });
        if (goal) repairUnpinnedGoalPosition(next, goal.id);
        result = { ok: true, agentId, goalId: goal?.id };
        break;
      }
      case "ArchiveAgent": {
        const agent = findAgent(next, command.agentId);
        if (!agent) return { ok: false, error: "Agent not found." };
        if (agent.archivedAt !== undefined) return { ok: true, agentId: agent.id };
        replaceAgent(next, { ...agent, archivedAt: now });
        result = { ok: true, agentId: agent.id };
        break;
      }
      case "ArchiveAgents": {
        const agentIds = uniqueAgentIds(command.agentIds);
        if (agentIds.length === 0) return { ok: false, error: "At least one agent is required." };
        const missingAgentId = agentIds.find((agentId) => !findAgent(next, agentId));
        if (missingAgentId) return { ok: false, error: `Agent ${missingAgentId} not found.` };
        const selected = new Set(agentIds);
        next.agents = next.agents.map((agent) =>
          selected.has(agent.id) && agent.archivedAt === undefined
            ? { ...agent, archivedAt: now }
            : agent,
        );
        result = { ok: true, affectedAgentIds: agentIds };
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
      case "AcknowledgeCatchUp": {
        const checkpointSequence = next.changes.at(-1)?.sequence ?? 0;
        next.operatorCheckpoint = { lastSequence: checkpointSequence, acknowledgedAt: now };
        result = { ok: true, checkpointSequence };
        break;
      }
    }

    if (command.type !== "AcknowledgeCatchUp") appendChanges(this.state, next, now);

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
    const planned = planReconciliation(this.state, snapshot);
    if ("accepted" in planned) return planned;

    appendChanges(this.state, planned.state, snapshot.observedAt);
    try {
      this.store.save(planned.state);
    } catch (error) {
      return {
        accepted: false,
        updatedAgentIds: [],
        staleAgentIds: [],
        diagnostics: planned.diagnostics,
        error: `Reconciliation rolled back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    this.state = planned.state;
    return {
      accepted: true,
      updatedAgentIds: planned.updatedAgentIds,
      staleAgentIds: planned.staleAgentIds,
      diagnostics: planned.diagnostics,
    };
  }
}

export const createEmptyUniverse = (
  store: UniverseStore,
  clock: Clock,
  ids: IdGenerator,
  projections: ProjectionModule,
): Universe => {
  const state = store.load();
  if (state.systems.length === 0 && state.goals.length === 0 && state.agents.length === 0)
    store.save(emptyUniverseState());
  return new Universe(store, clock, ids, projections);
};
