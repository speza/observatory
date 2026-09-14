import type {
  ControlPlaneEventSink,
  UnsequencedControlPlaneEvent,
} from "../control-plane-events/index.ts";
import type { HostSnapshot, HostAgentObservation } from "../hosts/types.ts";
import type {
  DiscoveredExecutionView,
  Projection,
  ProjectionModule,
  ProjectionQuery,
} from "../projection/types.ts";
import {
  DEFAULT_SYSTEM_ID,
  PRIORITIES,
  cloneUniverseState,
  compareText,
  isCurrentAttentionState,
  safeConversationReference,
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
  type AgentExecutionBinding,
  type NativeConversationRef,
  type RuntimeInvalidationResult,
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
      readonly type: "AssignAgentToSystem";
      readonly agentId: AgentId;
      readonly systemId: SystemId;
    }
  | {
      readonly type: "AssignAgentsToSystem";
      readonly agentIds: readonly AgentId[];
      readonly systemId: SystemId;
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
      readonly admissionSource: "provider-catalogue" | "managed-launch" | "host-observation";
      readonly resumeEligibility?: "same-site" | "provider-account" | "blocked" | "unknown";
      readonly harnessId: string;
      readonly nativeConversationRef: NativeConversationRef;
      readonly displayName: string;
      readonly workspaceRef?: string;
      readonly observedAt: number;
      readonly goalId?: GoalId;
      readonly systemId?: SystemId;
    }
  | { readonly type: "ArchiveAgent"; readonly agentId: AgentId }
  | { readonly type: "ArchiveAgents"; readonly agentIds: readonly AgentId[] }
  | { readonly type: "CompleteGoal"; readonly goalId: GoalId }
  | { readonly type: "ArchiveGoal"; readonly goalId: GoalId }
  | { readonly type: "AcknowledgeCatchUp"; readonly throughSequence: number };

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
  | {
      readonly kind: "host-executions";
      readonly snapshot: HostSnapshot;
      /** Launch identity is scoped to the exact host target for this snapshot. */
      readonly pendingExecutionKeys?: readonly HostExecutionKey[];
    }
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

const isPriority = (value: string): value is Priority =>
  PRIORITIES.some((priority) => priority === value);

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

export interface HostExecutionKey {
  readonly hostKind: string;
  readonly hostInstanceId: string;
  readonly nativeId: string;
}

/** Server-side only: the browser receives the opaque handle, never this binding. */
export interface DiscoveredExecutionAccess {
  readonly handle: string;
  readonly binding: AgentExecutionBinding;
  readonly nativeConversationRef?: NativeConversationRef;
}

interface DiscoveredExecutionRecord {
  readonly handle: string;
  readonly binding: AgentExecutionBinding;
  readonly displayName: string;
  readonly runtimeState: Agent["runtimeState"];
  readonly runtimeStateSource: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly provider?: string;
  readonly executionContainer?: ExecutionContainerRef;
  readonly nativeConversationRef?: NativeConversationRef;
  readonly presence: "live" | "unknown";
  readonly observationHealth: "fresh" | "unknown" | "unavailable";
  readonly lastObservedAt: number;
  readonly catalogue?: ProviderSessionFact;
}

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

const normalizeAgentAssignments = (state: UniverseState): boolean => {
  let changed = false;
  state.agents = state.agents.map((agent) => {
    if (agent.primaryGoalId !== undefined && agent.systemId !== undefined) {
      changed = true;
      const { systemId: _systemId, ...withoutDirectSystem } = agent;
      return withoutDirectSystem;
    }
    if (agent.systemId !== undefined && !findSystem(state, agent.systemId)) {
      changed = true;
      const { systemId: _systemId, ...withoutMissingSystem } = agent;
      return withoutMissingSystem;
    }
    return agent;
  });
  return changed;
};

const DEFAULT_SYSTEM_TITLE = "Default";
const DEFAULT_SYSTEM_DESCRIPTION = "Work that has not been filed into another System.";

/**
 * Seeds the reserved Default System when missing, files any legacy unfiled
 * Goals into it and removes invalid direct Agent placements. This is a one-way
 * normalisation: System membership becomes total without inventing a Goal or
 * Agent, and a Goal remains authoritative over a conflicting direct System.
 */
const ensureDefaultSystem = (state: UniverseState, now: number): boolean => {
  let changed = false;
  if (!state.systems.some((system) => system.id === DEFAULT_SYSTEM_ID)) {
    state.systems = [
      ...state.systems,
      {
        id: DEFAULT_SYSTEM_ID,
        title: DEFAULT_SYSTEM_TITLE,
        description: DEFAULT_SYSTEM_DESCRIPTION,
        createdAt: now,
        updatedAt: now,
      },
    ];
    changed = true;
  }
  // Create the reserved System before validating direct placements so a
  // legacy Agent already pointing at Default is not moved to Inbox.
  if (normalizeAgentAssignments(state)) changed = true;
  if (state.goals.some((goal) => !goal.systemId)) {
    state.goals = state.goals.map((goal) =>
      goal.systemId ? goal : { ...goal, systemId: DEFAULT_SYSTEM_ID },
    );
    changed = true;
  }
  return changed;
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
    ...state.hosts.filter(
      (candidate) =>
        candidate.hostKind !== host.hostKind || candidate.hostInstanceId !== host.hostInstanceId,
    ),
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
  systemId?: SystemId,
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
  if (systemId) Object.assign(item, { systemId });
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
    systemId?: SystemId,
  ): void => {
    sequence += 1;
    changes.push(
      change(sequence, occurredAt, outcome, targetType, targetId, summary, goalId, systemId),
    );
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
  const systemIdFor = (agent: Agent): SystemId | undefined =>
    agent.primaryGoalId ? nextGoals.get(agent.primaryGoalId)?.systemId : agent.systemId;
  const previousAgents = new Map(previous.agents.map((agent) => [agent.id, agent]));
  for (const agent of next.agents) {
    const before = previousAgents.get(agent.id);
    // A new direct System destination supersedes the old Goal as the
    // catch-up subject; when an Agent becomes unassigned, retain its prior
    // owner so the human can find the transition.
    const goalId =
      agent.primaryGoalId ?? (agent.systemId === undefined ? before?.primaryGoalId : undefined);
    const systemId = systemIdFor(agent) ?? (before ? systemIdFor(before) : undefined);
    if (!before) {
      append(
        "new",
        "agent",
        agent.id,
        `New agent observed · ${agent.displayName}`,
        goalId,
        systemId,
      );
      continue;
    }
    if (before.archivedAt === undefined && agent.archivedAt !== undefined) {
      append(
        "finished",
        "agent",
        agent.id,
        `Archived agent · ${agent.displayName}`,
        goalId,
        systemId,
      );
      continue;
    }
    if (before.primaryGoalId !== agent.primaryGoalId || before.systemId !== agent.systemId) {
      const destination = agent.primaryGoalId
        ? (nextGoals.get(agent.primaryGoalId)?.title ?? "another goal")
        : agent.systemId
          ? (next.systems.find((system) => system.id === agent.systemId)?.title ?? "another system")
          : "unassigned inbox";
      append(
        "changed",
        "agent",
        agent.id,
        `Assignment changed · ${agent.displayName} → ${destination}`,
        goalId,
        systemId,
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
        systemId,
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
        systemId,
      );
      continue;
    }
    if (before.displayName !== agent.displayName || before.description !== agent.description)
      append(
        "changed",
        "agent",
        agent.id,
        `Updated agent · ${agent.displayName}`,
        goalId,
        systemId,
      );
  }
  return changes;
};

const appendChanges = (previous: UniverseState, next: UniverseState, now: number): void => {
  next.changes = [...previous.changes, ...deriveChanges(previous, next, now)];
};

const changedRecordIds = <T extends { readonly id: string }>(
  previous: readonly T[],
  next: readonly T[],
): readonly string[] => {
  const previousById = new Map(previous.map((record) => [record.id, JSON.stringify(record)]));
  const nextById = new Map(next.map((record) => [record.id, JSON.stringify(record)]));
  return [...new Set([...previousById.keys(), ...nextById.keys()])]
    .filter((id) => previousById.get(id) !== nextById.get(id))
    .sort();
};

const changedAgentIds = (previous: readonly Agent[], next: readonly Agent[]): readonly string[] =>
  changedRecordIds(previous, next);

const executionEventAgent = (agent: Agent): string => {
  const {
    lastSeenAt: _lastSeenAt,
    lastObservedAt: _lastObservedAt,
    executionObservedAt: _executionObservedAt,
    execution,
    ...stable
  } = agent;
  if (!execution) return JSON.stringify(stable);
  const { observedAt: _observedAt, ...stableExecution } = execution;
  return JSON.stringify({ ...stable, execution: stableExecution });
};

const changedExecutionAgentIds = (
  previous: readonly Agent[],
  next: readonly Agent[],
): readonly string[] => {
  const previousById = new Map(previous.map((agent) => [agent.id, executionEventAgent(agent)]));
  const nextById = new Map(next.map((agent) => [agent.id, executionEventAgent(agent)]));
  return [...new Set([...previousById.keys(), ...nextById.keys()])]
    .filter((id) => previousById.get(id) !== nextById.get(id))
    .sort();
};

const stableHostHealth = ({ lastObservedAt: _lastObservedAt, ...host }: HostHealth): string =>
  JSON.stringify(host);

const hostHealthKey = (host: Pick<HostHealth, "hostKind" | "hostInstanceId">): string =>
  `${host.hostKind.trim()}\u0000${host.hostInstanceId.trim()}`;

const changedHostKeys = (
  previous: readonly HostHealth[],
  next: readonly HostHealth[],
): readonly string[] => {
  const previousById = new Map(
    previous.map((host) => [hostHealthKey(host), stableHostHealth(host)]),
  );
  const nextById = new Map(next.map((host) => [hostHealthKey(host), stableHostHealth(host)]));
  return [...new Set([...previousById.keys(), ...nextById.keys()])]
    .filter((id) => previousById.get(id) !== nextById.get(id))
    .sort();
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
          candidate.hostKind === execution.hostKind &&
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

const executionMatches = (
  agent: Agent,
  hostKind: string,
  hostInstanceId: string,
  nativeId: string,
): boolean =>
  agent.execution?.hostKind === hostKind &&
  agent.execution?.hostInstanceId === hostInstanceId &&
  agent.execution.nativeId === nativeId.trim();

const hostExecutionKey = ({ hostKind, hostInstanceId, nativeId }: HostExecutionKey): string =>
  `${hostKind.trim()}\u0000${hostInstanceId.trim()}\u0000${nativeId.trim()}`;

const bindingExecutionKey = (binding: AgentExecutionBinding): string => hostExecutionKey(binding);

const sameNativeConversation = (
  left: NativeConversationRef,
  right: NativeConversationRef,
): boolean =>
  left.harnessId === right.harnessId &&
  left.kind === right.kind &&
  left.value === right.value &&
  left.continuityScopeId === right.continuityScopeId;

const providerFactMatches = (
  reference: NativeConversationRef,
  session: ProviderSessionFact,
): boolean =>
  Boolean(reference.continuityScopeId) &&
  [session.nativeConversationRef, ...(session.nativeConversationAliases ?? [])].some((candidate) =>
    sameNativeConversation(reference, candidate),
  );

/**
 * An unscoped host identity has no provider scope of its own. It may only be
 * matched to a catalogue session by exact primary identity, and only for an
 * explicit human admission; reconciliation never promotes it automatically.
 */
const providerFactMatchesUnscoped = (
  reference: NativeConversationRef,
  session: ProviderSessionFact,
): boolean =>
  !reference.continuityScopeId &&
  [session.nativeConversationRef, ...(session.nativeConversationAliases ?? [])].some(
    (candidate) =>
      candidate.harnessId === reference.harnessId &&
      candidate.kind === reference.kind &&
      candidate.value === reference.value,
  );

const discoveryRecordMatchesAgent = (record: DiscoveredExecutionRecord, agent: Agent): boolean =>
  (agent.execution &&
    bindingExecutionKey(agent.execution) === bindingExecutionKey(record.binding)) === true ||
  (record.nativeConversationRef !== undefined &&
    agent.nativeConversationRef !== undefined &&
    nativeConversationKey(record.nativeConversationRef) ===
      nativeConversationKey(agent.nativeConversationRef));

const catalogueWithoutObservedAt = (
  session: ProviderSessionFact,
): Omit<ProviderSessionFact, "observedAt"> => {
  const { observedAt: _observedAt, ...rest } = session;
  return rest;
};

const stableDiscovery = (record: DiscoveredExecutionRecord): string => {
  const { lastObservedAt: _lastObservedAt, binding, catalogue, ...stable } = record;
  const { observedAt: _bindingObservedAt, ...stableBinding } = binding;
  return JSON.stringify({
    ...stable,
    binding: stableBinding,
    catalogue: catalogue ? catalogueWithoutObservedAt(catalogue) : undefined,
  });
};

const changedDiscoveryHandles = (
  previous: ReadonlyMap<string, DiscoveredExecutionRecord>,
  next: ReadonlyMap<string, DiscoveredExecutionRecord>,
): readonly string[] =>
  [...new Set([...previous.keys(), ...next.keys()])]
    .filter((handle) => {
      const before = previous.get(handle);
      const after = next.get(handle);
      if (!before || !after) return before !== after;
      return stableDiscovery(before) !== stableDiscovery(after);
    })
    .sort();

const MAX_DISCOVERY_ADMISSIONS = 256;
const MAX_CURRENT_DISCOVERED_EXECUTIONS = 512;

const appendExecutionHistory = (
  agent: Agent,
  binding: Agent["execution"],
): Agent["executionHistory"] =>
  binding &&
  !agent.executionHistory.some(
    (candidate) =>
      candidate.hostKind === binding.hostKind &&
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

const isUntrustedSnapshotRejection = (error: string | undefined): boolean =>
  error === "Host observation has an empty native identifier." ||
  error?.startsWith("Duplicate native identity from host:") === true;

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

const markHostUnavailable = (
  draft: ReconciliationDraft,
  hostKind: string,
  hostInstanceId: string,
): void => {
  draft.state.agents = draft.state.agents.map((agent) => {
    if (
      agent.execution?.hostKind !== hostKind ||
      agent.execution.hostInstanceId !== hostInstanceId ||
      agent.hostHealth === "unavailable"
    )
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

interface IndexedExecution {
  readonly reference: NativeConversationRef;
  readonly binding: NonNullable<Agent["conflictingExecutions"]>[number];
}

const conversationValueKey = (reference: NativeConversationRef): string =>
  `${reference.harnessId}\u0000${reference.kind}\u0000${reference.value}`;

const scopeCompatibleConversation = (
  left: NativeConversationRef,
  right: NativeConversationRef,
): boolean =>
  nativeConversationKey(left) === nativeConversationKey(right) ||
  left.continuityScopeId === undefined ||
  right.continuityScopeId === undefined;

const indexConversationExecutions = (snapshot: HostSnapshot): Map<string, IndexedExecution[]> => {
  const executions = new Map<string, IndexedExecution[]>();
  for (const observation of snapshot.agents) {
    const reference = nativeConversationFromObservation(observation);
    if (!reference) continue;
    const key = conversationValueKey(reference);
    executions.set(key, [
      ...(executions.get(key) ?? []),
      {
        reference,
        binding: {
          hostKind: snapshot.hostKind,
          hostInstanceId: snapshot.hostInstanceId,
          nativeId: observation.nativeId.trim(),
          hostLocator: observation.hostLocator,
          observedAt: observation.observedAt,
        },
      },
    ]);
  }
  return executions;
};

const compatibleExecutionBindings = (
  executions: ReadonlyMap<string, readonly IndexedExecution[]>,
  reference: NativeConversationRef,
): Agent["conflictingExecutions"] =>
  (executions.get(conversationValueKey(reference)) ?? [])
    .filter((entry) => scopeCompatibleConversation(entry.reference, reference))
    .map((entry) => entry.binding);

const detachMissingExecutions = (draft: ReconciliationDraft, snapshot: HostSnapshot): void => {
  const observedIds = new Set(snapshot.agents.map((agent) => agent.nativeId.trim()));
  draft.state.agents = draft.state.agents.map((agent) => {
    if (
      agent.execution?.hostKind !== snapshot.hostKind ||
      agent.execution.hostInstanceId !== snapshot.hostInstanceId ||
      observedIds.has(agent.execution.nativeId) ||
      agent.execution.observedAt > snapshot.observedAt
    )
      return agent;
    draft.staleAgentIds.push(agent.id);
    if (!draft.updatedAgentIds.includes(agent.id)) draft.updatedAgentIds.push(agent.id);
    const detached: Agent = {
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
    return { ...detached, resumeCapability: deriveResumeCapability(detached) };
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
  if (!draft.updatedAgentIds.includes(agent.id)) draft.updatedAgentIds.push(agent.id);
};

const displayNameRank = (source: Agent["displayNameSource"]): number =>
  source === "human" ? 2 : source === "provider" ? 1 : 0;

const providerContinuityRank = (continuity: Agent["providerContinuity"]): number =>
  continuity === "confirmed" ? 2 : continuity === "missing" ? 1 : 0;

const combinedProviderObservedAt = (left: Agent, right: Agent): number | undefined => {
  if (left.providerObservedAt === undefined) return right.providerObservedAt;
  if (right.providerObservedAt === undefined) return left.providerObservedAt;
  return Math.max(left.providerObservedAt, right.providerObservedAt);
};

/**
 * Merge every duplicate of one canonical conversation into a single Agent.
 * Executions on the losing records are never dropped: their current binding,
 * history and conflict evidence all move into the keeper's execution history.
 */
const mergeConversationAgents = (
  state: UniverseState,
  keeper: Agent,
  duplicates: readonly Agent[],
  diagnostics: string[],
): Agent => {
  let merged = keeper;
  for (const duplicate of duplicates) {
    if (
      merged.primaryGoalId &&
      duplicate.primaryGoalId &&
      merged.primaryGoalId !== duplicate.primaryGoalId
    )
      diagnostics.push(
        `Consolidated duplicate Agent ${duplicate.id} into ${merged.id}; retained the canonical Goal assignment.`,
      );
    if (
      !merged.primaryGoalId &&
      !duplicate.primaryGoalId &&
      merged.systemId &&
      duplicate.systemId &&
      merged.systemId !== duplicate.systemId
    )
      diagnostics.push(
        `Consolidated duplicate Agent ${duplicate.id} into ${merged.id}; retained the canonical System assignment.`,
      );
    const duplicateNameWins =
      displayNameRank(duplicate.displayNameSource) > displayNameRank(merged.displayNameSource);
    merged = Object.assign({}, merged, {
      displayName: duplicateNameWins ? duplicate.displayName : merged.displayName,
      displayNameSource: duplicateNameWins ? duplicate.displayNameSource : merged.displayNameSource,
      description: merged.description ?? duplicate.description,
      primaryGoalId: merged.primaryGoalId ?? duplicate.primaryGoalId,
      systemId:
        (merged.primaryGoalId ?? duplicate.primaryGoalId)
          ? undefined
          : (merged.systemId ?? duplicate.systemId),
      harnessId: merged.harnessId ?? duplicate.harnessId,
      executionHistory: appendDistinctExecutions(merged.executionHistory, [
        ...duplicate.executionHistory,
        ...(duplicate.execution ? [duplicate.execution] : []),
        ...duplicate.conflictingExecutions,
      ]),
      lastSeenAt: Math.max(merged.lastSeenAt, duplicate.lastSeenAt),
      lastObservedAt: Math.max(merged.lastObservedAt, duplicate.lastObservedAt),
      lastChangedAt: Math.max(merged.lastChangedAt, duplicate.lastChangedAt),
      repository: merged.repository ?? duplicate.repository,
      branch: merged.branch ?? duplicate.branch,
      worktree: merged.worktree ?? duplicate.worktree,
      provider: merged.provider ?? duplicate.provider,
      providerContinuity:
        providerContinuityRank(duplicate.providerContinuity) >
        providerContinuityRank(merged.providerContinuity)
          ? duplicate.providerContinuity
          : merged.providerContinuity,
      providerResumeEligibility:
        merged.providerResumeEligibility ?? duplicate.providerResumeEligibility,
      providerObservedAt: combinedProviderObservedAt(merged, duplicate),
      executionContainer: merged.executionContainer ?? duplicate.executionContainer,
      archivedAt:
        merged.archivedAt === undefined
          ? duplicate.archivedAt
          : duplicate.archivedAt === undefined
            ? merged.archivedAt
            : Math.min(merged.archivedAt, duplicate.archivedAt),
    });
    state.agents = state.agents.filter((candidate) => candidate.id !== duplicate.id);
    const dismissals = new Map<string, (typeof state.relatedAgentDismissals)[number]>();
    for (const dismissal of state.relatedAgentDismissals) {
      const normalized =
        dismissal.agentId === duplicate.id ? { ...dismissal, agentId: merged.id } : dismissal;
      const key = dismissalKey(normalized.goalId, normalized.agentId);
      const previous = dismissals.get(key);
      if (!previous || normalized.dismissedAt < previous.dismissedAt)
        dismissals.set(key, normalized);
    }
    state.relatedAgentDismissals = [...dismissals.values()];
    diagnostics.push(`Consolidated duplicate Agent ${duplicate.id} into ${merged.id}.`);
  }
  replaceAgent(state, merged);
  return merged;
};

/**
 * Any Agent that shares the canonical conversation identity of `canonical`:
 * an exact key match (alias collision) or an unscoped variant of a scoped
 * reference (managed-launch admission before provider scope was known).
 */
const duplicateConversationAgents = (state: UniverseState, canonical: Agent): Agent[] => {
  const reference = canonical.nativeConversationRef;
  if (!reference) return [];
  return state.agents.filter(
    (candidate) =>
      candidate.id !== canonical.id &&
      candidate.nativeConversationRef !== undefined &&
      (nativeConversationKey(candidate.nativeConversationRef) ===
        nativeConversationKey(reference) ||
        (reference.continuityScopeId !== undefined &&
          candidate.nativeConversationRef.continuityScopeId === undefined &&
          sameConversationWithoutScope(candidate.nativeConversationRef, reference))),
  );
};

const consolidateConversationDuplicates = (
  state: UniverseState,
  canonical: Agent,
  diagnostics: string[],
): Agent => {
  const duplicates = duplicateConversationAgents(state, canonical);
  return duplicates.length === 0
    ? canonical
    : mergeConversationAgents(state, canonical, duplicates, diagnostics);
};

const deriveResumeCapability = (agent: Agent): Agent["resumeCapability"] => {
  if (agent.executionPresence === "conflict" || agent.conflictingExecutions.length > 0)
    return "blocked";
  if (agent.providerContinuity !== "confirmed" || agent.providerResumeEligibility === undefined)
    return agent.resumeCapability;
  return agent.providerResumeEligibility === "same-site" ||
    agent.providerResumeEligibility === "provider-account"
    ? "eligible"
    : "blocked";
};

const reconcileObservation = (
  draft: ReconciliationDraft,
  snapshot: HostSnapshot,
  observation: HostAgentObservation,
  conversationExecutions: ReadonlyMap<string, readonly IndexedExecution[]>,
): void => {
  const observedConversation = nativeConversationFromObservation(observation);
  const processEvidence = observation.harnessEvidence?.source === "process";
  const exactByConversation = observedConversation
    ? draft.state.agents.find(
        (agent) =>
          agent.nativeConversationRef &&
          nativeConversationKey(agent.nativeConversationRef) ===
            nativeConversationKey(observedConversation),
      )
    : undefined;
  const compatibleProcessAgents =
    processEvidence && observedConversation && observedConversation.continuityScopeId === undefined
      ? draft.state.agents.filter(
          (agent) =>
            agent.nativeConversationRef !== undefined &&
            sameConversationWithoutScope(agent.nativeConversationRef, observedConversation),
        )
      : [];
  const byConversation =
    exactByConversation ??
    (observedConversation
      ? resolveConversationAgent(draft.state.agents, observedConversation)
      : undefined) ??
    (compatibleProcessAgents.length === 1 ? compatibleProcessAgents[0] : undefined);
  let byExecution = draft.state.agents.find((agent) =>
    executionMatches(agent, snapshot.hostKind, snapshot.hostInstanceId, observation.nativeId),
  );
  const processConversationMatchesExecution = Boolean(
    processEvidence &&
    observedConversation &&
    compatibleProcessAgents.length <= 1 &&
    byExecution?.nativeConversationRef &&
    sameConversationWithoutScope(byExecution.nativeConversationRef, observedConversation),
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
      !isScopeEnrichment(byExecution.nativeConversationRef, observedConversation) &&
      !processConversationMatchesExecution) ||
      (byExecution.runtimeStateSource === "observatory.process-start" &&
        Boolean(byExecution.nativeConversationRef) &&
        !observedConversation) ||
      (byExecution.execution !== undefined &&
        byExecution.execution.hostLocator !== observation.hostLocator &&
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

  const agentCountBeforeConsolidation = draft.state.agents.length;
  existing = consolidateConversationDuplicates(draft.state, existing, draft.diagnostics);
  if (
    draft.state.agents.length !== agentCountBeforeConsolidation &&
    !draft.updatedAgentIds.includes(existing.id)
  )
    draft.updatedAgentIds.push(existing.id);

  const preserveScopedProcessConversation = Boolean(
    processEvidence &&
    observedConversation &&
    existing.nativeConversationRef?.continuityScopeId &&
    observedConversation.continuityScopeId === undefined &&
    sameConversationWithoutScope(existing.nativeConversationRef, observedConversation),
  );

  const conflicts = observedConversation
    ? compatibleExecutionBindings(conversationExecutions, observedConversation)
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
      (existing.execution.hostKind !== snapshot.hostKind ||
        existing.execution.hostInstanceId !== snapshot.hostInstanceId ||
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
    nativeConversationRef: preserveScopedProcessConversation
      ? existing.nativeConversationRef
      : (observedConversation ?? existing.nativeConversationRef),
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
  replaceAgent(draft.state, {
    ...updated,
    resumeCapability: deriveResumeCapability(updated),
  });
  if (!draft.updatedAgentIds.includes(existing.id)) draft.updatedAgentIds.push(existing.id);
};

const planReconciliation = (
  previous: UniverseState,
  snapshot: HostSnapshot,
): ReconciliationDraft | ReconciliationResult => {
  const duplicate = isDuplicateObservation(snapshot.agents);
  if (duplicate) return rejectedReconciliation(duplicate);

  const diagnostics = [...snapshot.diagnostics];
  if (snapshot.agents.length > MAX_CURRENT_DISCOVERED_EXECUTIONS)
    diagnostics.push(
      `${snapshot.hostKind} reported ${snapshot.agents.length} agent executions; discovery is retained as uncertain above the ${MAX_CURRENT_DISCOVERED_EXECUTIONS}-execution safety bound.`,
    );
  const previousHost = previous.hosts.find(
    (candidate) =>
      candidate.hostKind === snapshot.hostKind &&
      candidate.hostInstanceId === snapshot.hostInstanceId,
  );
  if (
    previousHost?.lastObservedAt !== undefined &&
    snapshot.observedAt < previousHost.lastObservedAt
  ) {
    const error = `Out-of-order ${snapshot.hostKind} snapshot ignored: ${snapshot.observedAt} is older than ${previousHost.lastObservedAt}.`;
    return rejectedReconciliation(error, diagnostics);
  }

  const scopeDowngrades = new Set<string>();
  for (const observation of snapshot.agents) {
    const observed = nativeConversationFromObservation(observation);
    if (!observed || observed.continuityScopeId !== undefined) continue;
    // A process argument is host evidence, not a new provider-catalogue
    // identity. It can prove the exact session value while the existing
    // provider-scoped reference remains canonical.
    if (observation.harnessEvidence?.source === "process") continue;
    const current = previous.agents.find((agent) =>
      executionMatches(agent, snapshot.hostKind, snapshot.hostInstanceId, observation.nativeId),
    )?.nativeConversationRef;
    if (current?.continuityScopeId && sameConversationWithoutScope(current, observed)) {
      scopeDowngrades.add(observation.nativeId.trim());
      diagnostics.push(
        `Ignored unscoped provider identity for ${observation.nativeId.trim()}; the scoped conversation remains canonical.`,
      );
    }
  }

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
    markHostUnavailable(draft, snapshot.hostKind, snapshot.hostInstanceId);
    return draft;
  }

  const conversationExecutions = indexConversationExecutions(snapshot);
  if (snapshot.complete) detachMissingExecutions(draft, snapshot);
  else
    draft.diagnostics.push(
      `Incomplete ${snapshot.hostKind} snapshot did not prove any execution absent.`,
    );
  for (const observation of snapshot.agents) {
    if (scopeDowngrades.has(observation.nativeId.trim())) continue;
    reconcileObservation(draft, snapshot, observation, conversationExecutions);
  }
  return draft;
};

export class Universe {
  private state: UniverseState;
  private discoveries = new Map<string, DiscoveredExecutionRecord>();
  private discoveredAdmissions = new Map<
    string,
    { readonly agentId: AgentId; readonly access: DiscoveredExecutionAccess }
  >();

  constructor(
    private readonly store: UniverseStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly projections: ProjectionModule,
    private readonly events?: ControlPlaneEventSink,
  ) {
    this.state = store.load();
    if (ensureDefaultSystem(this.state, this.clock.now())) this.store.save(this.state);
  }

  snapshot(): UniverseState {
    return cloneUniverseState(this.state);
  }

  private retainDiscoveriesAsUnknown(snapshot: HostSnapshot): void {
    const previousDiscoveries = this.discoveries;
    const nextDiscoveries = this.planDiscoveredExecutions(this.state, {
      ...snapshot,
      agents: [],
      complete: false,
    });
    this.discoveries = nextDiscoveries;
    this.publishDiscoveredExecutionChanges(
      changedDiscoveryHandles(previousDiscoveries, nextDiscoveries),
      snapshot.observedAt,
      "host-observation",
    );
  }

  resolveAgentId(reference: NativeConversationRef): AgentId | undefined {
    return resolveConversationAgent(this.state.agents, reference)?.id;
  }

  /** Resolve a browser-safe discovery handle only at the server-side host seam. */
  resolveDiscoveredExecution(handle: string): DiscoveredExecutionAccess | undefined {
    const discovery = this.discoveries.get(handle.trim());
    if (!discovery) return undefined;
    return {
      handle: discovery.handle,
      binding: { ...discovery.binding },
      nativeConversationRef: discovery.nativeConversationRef
        ? { ...discovery.nativeConversationRef }
        : undefined,
    };
  }

  /** Resolve a discovery that was admitted by another path during this process. */
  resolveAdmittedDiscoveredExecution(
    handle: string,
  ): { readonly agentId: AgentId; readonly access: DiscoveredExecutionAccess } | undefined {
    const admitted = this.discoveredAdmissions.get(handle.trim());
    if (!admitted || !this.state.agents.some((agent) => agent.id === admitted.agentId)) {
      if (admitted) this.discoveredAdmissions.delete(handle.trim());
      return undefined;
    }
    return {
      agentId: admitted.agentId,
      access: {
        handle: admitted.access.handle,
        binding: { ...admitted.access.binding },
        nativeConversationRef: admitted.access.nativeConversationRef
          ? { ...admitted.access.nativeConversationRef }
          : undefined,
      },
    };
  }

  private rememberDiscoveryAdmission(discovery: DiscoveredExecutionRecord, agent: Agent): void {
    this.discoveredAdmissions.set(discovery.handle, {
      agentId: agent.id,
      access: {
        handle: discovery.handle,
        binding: { ...discovery.binding },
        nativeConversationRef: discovery.nativeConversationRef
          ? { ...discovery.nativeConversationRef }
          : undefined,
      },
    });
    while (this.discoveredAdmissions.size > MAX_DISCOVERY_ADMISSIONS) {
      const oldest = this.discoveredAdmissions.keys().next().value;
      if (oldest === undefined) break;
      this.discoveredAdmissions.delete(oldest);
    }
  }

  private rememberAdmittedDiscoveries(state: UniverseState): void {
    for (const discovery of this.discoveries.values()) {
      const agent = state.agents.find((candidate) =>
        discoveryRecordMatchesAgent(discovery, candidate),
      );
      if (agent) this.rememberDiscoveryAdmission(discovery, agent);
    }
  }

  project(query: ProjectionQuery): Projection {
    return this.projections.project(
      { ...this.state, discoveredExecutions: this.discoveryViews() },
      query,
    );
  }

  private discoveryViews(): readonly DiscoveredExecutionView[] {
    const liveConversationCounts = new Map<string, number>();
    for (const discovery of this.discoveries.values()) {
      if (discovery.presence !== "live" || !discovery.nativeConversationRef) continue;
      const key = nativeConversationKey(discovery.nativeConversationRef);
      liveConversationCounts.set(key, (liveConversationCounts.get(key) ?? 0) + 1);
    }
    return [...this.discoveries.values()]
      .map((discovery): DiscoveredExecutionView => {
        const conversation = safeConversationReference(discovery.nativeConversationRef);
        const conversationConflictCount = discovery.nativeConversationRef
          ? (liveConversationCounts.get(nativeConversationKey(discovery.nativeConversationRef)) ??
            0)
          : 0;
        const catalogue = discovery.catalogue;
        const reference = discovery.nativeConversationRef;
        const admissionEvidence =
          catalogue !== undefined &&
          reference !== undefined &&
          (reference.continuityScopeId
            ? providerFactMatches(reference, catalogue)
            : providerFactMatchesUnscoped(reference, catalogue));
        const admission = admissionEvidence
          ? {
              status: "available" as const,
              resumeEligibility: catalogue.resumeEligibility,
            }
          : {
              status: "unavailable" as const,
              explanation: !reference
                ? "Conversation identity is not identified; refresh the provider catalogue before adding it."
                : !reference.continuityScopeId
                  ? "Conversation identity is not scoped to a provider catalogue; exact evidence is required before adding it."
                  : "Exact catalogue evidence is not available for this execution.",
            };
        return {
          type: "discovered-execution",
          handle: discovery.handle,
          displayName: discovery.displayName,
          hostKind: discovery.binding.hostKind,
          runtimeState: discovery.runtimeState,
          runtimeStateSource: discovery.runtimeStateSource,
          presence: discovery.presence,
          observationHealth: discovery.observationHealth,
          lastObservedAt: discovery.lastObservedAt,
          repository: discovery.repository,
          branch: discovery.branch,
          worktree: discovery.worktree,
          provider: discovery.provider,
          conversation,
          conversationIdentified: discovery.nativeConversationRef !== undefined,
          conversationTitle: catalogue?.title,
          resumeEligibility: catalogue?.resumeEligibility,
          admission,
          conversationConflictCount,
        };
      })
      .sort(
        (left, right) =>
          compareText(left.displayName, right.displayName) ||
          compareText(left.handle, right.handle),
      );
  }

  private planDiscoveredExecutions(
    state: UniverseState,
    snapshot: HostSnapshot,
    pendingExecutionKeys: readonly HostExecutionKey[] = [],
  ): Map<string, DiscoveredExecutionRecord> {
    const next = new Map(this.discoveries);
    const pending = new Set(pendingExecutionKeys.map(hostExecutionKey));
    const admitted = state.agents;
    const hostMatches = (record: DiscoveredExecutionRecord): boolean =>
      record.binding.hostKind === snapshot.hostKind &&
      record.binding.hostInstanceId === snapshot.hostInstanceId;

    for (const [handle, record] of next) {
      if (admitted.some((agent) => discoveryRecordMatchesAgent(record, agent))) next.delete(handle);
    }

    const markUnknown = (record: DiscoveredExecutionRecord): DiscoveredExecutionRecord => ({
      ...record,
      presence: "unknown",
      observationHealth: snapshot.available ? "unknown" : "unavailable",
    });

    if (!snapshot.available) {
      for (const [handle, record] of next)
        if (hostMatches(record)) next.set(handle, markUnknown(record));
      return next;
    }

    const discoverableCount = snapshot.agents.filter(
      (observation) => observation.discoverable !== false,
    ).length;
    if (discoverableCount > MAX_CURRENT_DISCOVERED_EXECUTIONS) {
      for (const [handle, record] of next)
        if (hostMatches(record)) next.set(handle, markUnknown(record));
      return next;
    }

    const observedKeys = new Set(
      snapshot.agents.map((observation) =>
        hostExecutionKey({
          hostKind: snapshot.hostKind,
          hostInstanceId: snapshot.hostInstanceId,
          nativeId: observation.nativeId,
        }),
      ),
    );
    if (snapshot.complete) {
      for (const [handle, record] of next) {
        if (
          hostMatches(record) &&
          !observedKeys.has(bindingExecutionKey(record.binding)) &&
          record.binding.observedAt <= snapshot.observedAt
        )
          next.delete(handle);
      }
    } else {
      for (const [handle, record] of next)
        if (hostMatches(record)) next.set(handle, markUnknown(record));
    }

    for (const observation of snapshot.agents) {
      const nativeId = observation.nativeId.trim();
      const identity: HostExecutionKey = {
        hostKind: snapshot.hostKind,
        hostInstanceId: snapshot.hostInstanceId,
        nativeId,
      };
      const identityKey = hostExecutionKey(identity);
      const existing = [...next.values()].find(
        (record) => bindingExecutionKey(record.binding) === identityKey,
      );
      if (observation.discoverable === false) {
        if (existing) next.delete(existing.handle);
        continue;
      }
      const observedConversation = nativeConversationFromObservation(observation);
      if (
        pending.has(identityKey) ||
        admitted.some(
          (agent) =>
            executionMatches(agent, snapshot.hostKind, snapshot.hostInstanceId, nativeId) ||
            (observedConversation !== undefined &&
              agent.nativeConversationRef !== undefined &&
              nativeConversationKey(agent.nativeConversationRef) ===
                nativeConversationKey(observedConversation)),
        )
      ) {
        if (existing) next.delete(existing.handle);
        continue;
      }
      if (existing && observation.observedAt < existing.lastObservedAt) continue;
      const scopeEnrichment =
        existing?.nativeConversationRef !== undefined &&
        observedConversation !== undefined &&
        isScopeEnrichment(existing.nativeConversationRef, observedConversation);
      const scopeDowngrade =
        existing?.nativeConversationRef !== undefined &&
        observedConversation !== undefined &&
        existing.nativeConversationRef.continuityScopeId !== undefined &&
        observedConversation.continuityScopeId === undefined &&
        sameConversationWithoutScope(existing.nativeConversationRef, observedConversation);
      const effectiveConversation = scopeDowngrade
        ? existing.nativeConversationRef
        : observedConversation;
      const conversationChanged =
        existing !== undefined &&
        (Boolean(existing.nativeConversationRef) !== Boolean(effectiveConversation) ||
          (existing.nativeConversationRef !== undefined &&
            effectiveConversation !== undefined &&
            !scopeEnrichment &&
            nativeConversationKey(existing.nativeConversationRef) !==
              nativeConversationKey(effectiveConversation)));
      const targetChanged =
        existing !== undefined && existing.binding.hostLocator !== observation.hostLocator;
      const identityReplaced =
        existing !== undefined &&
        existing.nativeConversationRef !== undefined &&
        effectiveConversation !== undefined &&
        !scopeEnrichment &&
        nativeConversationKey(existing.nativeConversationRef) !==
          nativeConversationKey(effectiveConversation);
      const binding: AgentExecutionBinding = {
        hostKind: snapshot.hostKind,
        hostInstanceId: snapshot.hostInstanceId,
        nativeId,
        hostLocator: observation.hostLocator,
        observedAt: observation.observedAt,
      };
      const handle =
        existing && !identityReplaced && !targetChanged
          ? existing.handle
          : this.ids.next("discovery");
      if (existing && handle !== existing.handle) next.delete(existing.handle);
      next.set(handle, {
        handle,
        binding,
        displayName: normalizeText(observation.displayName) ?? "Unnamed execution",
        runtimeState: observation.runtimeState,
        runtimeStateSource: observation.runtimeStateSource,
        repository: normalizeText(observation.repository),
        branch: normalizeText(observation.branch),
        worktree: normalizeText(observation.worktree),
        provider: normalizeText(observation.provider),
        executionContainer: copyExecutionContainer(observation.executionContainer),
        nativeConversationRef: effectiveConversation,
        presence: "live",
        observationHealth: "fresh",
        lastObservedAt: observation.observedAt,
        catalogue:
          existing &&
          !conversationChanged &&
          !targetChanged &&
          existing.nativeConversationRef &&
          effectiveConversation &&
          nativeConversationKey(existing.nativeConversationRef) ===
            nativeConversationKey(effectiveConversation)
            ? existing.catalogue
            : undefined,
      });
    }
    return next;
  }

  private enrichDiscoveredExecutions(
    options: Pick<
      Extract<UniverseObservation, { readonly kind: "provider-catalogue" }>,
      "harnessId" | "continuityScopeId" | "observedAt" | "complete" | "sessions"
    >,
  ): Map<string, DiscoveredExecutionRecord> {
    const next = new Map(this.discoveries);
    for (const [handle, discovery] of next) {
      const reference = discovery.nativeConversationRef;
      if (
        !reference ||
        reference.harnessId !== options.harnessId ||
        (reference.continuityScopeId !== undefined &&
          reference.continuityScopeId !== options.continuityScopeId)
      )
        continue;
      const matching = options.sessions.filter((session) =>
        reference.continuityScopeId
          ? providerFactMatches(reference, session)
          : providerFactMatchesUnscoped(reference, session),
      );
      if (matching.length === 1) {
        const session = matching[0]!;
        if (!discovery.catalogue || session.observedAt >= discovery.catalogue.observedAt)
          next.set(handle, { ...discovery, catalogue: session });
      } else if (options.complete) {
        next.set(handle, { ...discovery, catalogue: undefined });
      }
    }
    return next;
  }

  /** The sole production interface for accepting host and provider observations. */
  observe(observation: UniverseObservation): ReconciliationResult {
    if (observation.kind === "host-executions")
      return this.reconcile(observation.snapshot, observation.pendingExecutionKeys);
    return observation.kind === "provider-unavailable"
      ? this.markProviderUnavailable(observation.harnessId)
      : this.reconcileProviderSessions(observation);
  }

  /** Discard persisted runtime certainty before the first fresh host observation. */
  invalidateRuntimeFacts(): RuntimeInvalidationResult {
    const previous = this.state;
    const next = cloneUniverseState(previous);
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
    try {
      this.store.save(next);
    } catch (error) {
      return {
        ok: false,
        error: `Runtime invalidation rolled back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    this.state = next;
    const discoveredHandles = [...this.discoveries.keys()];
    this.discoveries = new Map();
    this.discoveredAdmissions.clear();
    this.publishExecutionChanges(previous, next, this.clock.now(), discoveredHandles);
    return { ok: true };
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
    const escapedSession = options.sessions.find(
      (session) =>
        session.nativeConversationRef.harnessId !== options.harnessId ||
        session.nativeConversationRef.continuityScopeId !== options.continuityScopeId ||
        (session.nativeConversationAliases ?? []).some(
          (alias) =>
            alias.harnessId !== options.harnessId ||
            alias.continuityScopeId !== options.continuityScopeId,
        ),
    );
    if (escapedSession)
      return rejectedReconciliation(
        `Provider session ${escapedSession.nativeConversationRef.value} escaped its declared ${options.harnessId} catalogue scope.`,
      );
    const next = cloneUniverseState(previous);
    const diagnostics: string[] = [];
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
    const canonicalOwners = new Map<string, Agent>();
    for (const agent of next.agents) {
      const reference = agent.nativeConversationRef;
      if (!reference) continue;
      const key = nativeConversationKey(reference);
      if (!canonicalOwners.has(key)) canonicalOwners.set(key, agent);
    }
    const aliasDuplicates: { readonly ownerId: AgentId; readonly duplicateId: AgentId }[] = [];
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
      const canonicalKey = nativeConversationKey(canonical);
      const owner = canonicalOwners.get(canonicalKey);
      if (owner && owner.id !== agent.id) {
        aliasDuplicates.push({ ownerId: owner.id, duplicateId: agent.id });
        return agent;
      }
      canonicalOwners.set(canonicalKey, agent);
      return { ...agent, nativeConversationRef: canonical };
    });
    for (const { ownerId, duplicateId } of aliasDuplicates) {
      const owner = next.agents.find((candidate) => candidate.id === ownerId);
      const duplicate = next.agents.find((candidate) => candidate.id === duplicateId);
      if (!owner || !duplicate) continue;
      mergeConversationAgents(next, owner, [duplicate], diagnostics);
    }
    const exactKeyOwners = new Map<string, Agent>();
    for (const agent of next.agents) {
      const reference = agent.nativeConversationRef;
      if (!reference || !next.agents.some((candidate) => candidate.id === agent.id)) continue;
      const key = nativeConversationKey(reference);
      const owner = exactKeyOwners.get(key);
      if (!owner) {
        exactKeyOwners.set(key, agent);
        continue;
      }
      exactKeyOwners.set(key, mergeConversationAgents(next, owner, [agent], diagnostics));
    }
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
        providerResumeEligibility: session.resumeEligibility,
        resumeCapability: eligible ? ("eligible" as const) : ("blocked" as const),
        providerObservedAt: Math.max(
          agent.providerObservedAt ?? Number.NEGATIVE_INFINITY,
          session.observedAt,
        ),
        continuity: "proved" as const,
        displayName:
          agent.displayNameSource !== "human" && normalizeText(session.title)
            ? normalizeText(session.title)!
            : agent.displayName,
        displayNameSource:
          agent.displayNameSource !== "human" && normalizeText(session.title)
            ? ("provider" as const)
            : agent.displayNameSource,
        worktree: normalizeText(session.workspaceRef) ?? agent.worktree,
      };
    });
    const updatedAgentIds = changedAgentIds(previous.agents, next.agents);
    const previousDiscoveries = this.discoveries;
    const nextDiscoveries = this.enrichDiscoveredExecutions(options);
    const discoveredHandles = changedDiscoveryHandles(previousDiscoveries, nextDiscoveries);
    try {
      this.store.save(next);
    } catch (error) {
      return rejectedReconciliation(
        `Provider reconciliation rolled back: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.state = next;
    this.discoveries = nextDiscoveries;
    this.publishAgentChanges(previous, next, options.observedAt, "provider-catalogue");
    this.publishDiscoveredExecutionChanges(
      discoveredHandles,
      options.observedAt,
      "provider-catalogue",
    );
    return {
      accepted: true,
      updatedAgentIds,
      staleAgentIds: [],
      diagnostics,
    };
  }

  private markProviderUnavailable(harnessId: string): ReconciliationResult {
    const previous = this.state;
    const next = cloneUniverseState(previous);
    next.agents = next.agents.map((agent) =>
      (agent.nativeConversationRef?.harnessId ?? agent.harnessId) === harnessId &&
      agent.nativeConversationRef
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
    this.publishAgentChanges(previous, next, this.clock.now(), "provider-catalogue");
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
        if (system.title === title) return { ok: true, systemId: system.id };
        replaceSystem(next, { ...system, title, updatedAt: now });
        result = { ok: true, systemId: system.id };
        break;
      }
      case "SetSystemDescription": {
        const system = findSystem(next, command.systemId);
        if (!system) return { ok: false, error: "System not found." };
        const description = normalizeText(command.description);
        if (system.description === description) return { ok: true, systemId: system.id };
        replaceSystem(next, {
          ...system,
          description,
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
        const systemId = command.systemId ?? DEFAULT_SYSTEM_ID;
        if (!findSystem(next, systemId)) return { ok: false, error: "System not found." };
        if (command.priority !== undefined && !isPriority(command.priority))
          return { ok: false, error: "Unknown goal priority." };
        const description = normalizeText(command.description);
        const goal = {
          id,
          systemId,
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
        result = { ok: true, goalId: id, systemId };
        break;
      }
      case "RenameGoal": {
        const title = normalizeText(command.title);
        const goal = findGoal(next, command.goalId);
        if (!title) return { ok: false, error: "Goal title is required." };
        if (!goal) return { ok: false, error: "Goal not found." };
        if (goal.title === title) return { ok: true, goalId: goal.id };
        replaceGoal(next, { ...goal, title, updatedAt: now });
        result = { ok: true, goalId: goal.id };
        break;
      }
      case "SetGoalDescription": {
        const goal = findGoal(next, command.goalId);
        if (!goal) return { ok: false, error: "Goal not found." };
        const description = normalizeText(command.description);
        if (goal.description === (description || undefined)) return { ok: true, goalId: goal.id };
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
        if (!isPriority(command.priority)) return { ok: false, error: "Unknown goal priority." };
        if (goal.priority === command.priority) return { ok: true, goalId: goal.id };
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
        const systemId = command.systemId ?? DEFAULT_SYSTEM_ID;
        if (!findSystem(next, systemId)) return { ok: false, error: "System not found." };
        replaceGoal(next, { ...goal, systemId, updatedAt: now });
        result = { ok: true, goalId: goal.id, systemId };
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
        if (agent.archivedAt !== undefined)
          return { ok: false, error: "Archived agents cannot be assigned." };
        const previousGoalId = agent.primaryGoalId;
        replaceAgent(next, { ...agent, systemId: undefined, primaryGoalId: goal.id });
        next.relatedAgentDismissals = next.relatedAgentDismissals.filter(
          (dismissal) => dismissal.goalId !== goal.id || dismissal.agentId !== command.agentId,
        );
        if (previousGoalId && previousGoalId !== goal.id)
          repairUnpinnedGoalPosition(next, previousGoalId);
        repairUnpinnedGoalPosition(next, goal.id);
        result = { ok: true, agentId: agent.id, goalId: goal.id, systemId: goal.systemId };
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
        const archivedAgentId = agentIds.find(
          (agentId) => findAgent(next, agentId)?.archivedAt !== undefined,
        );
        if (archivedAgentId) return { ok: false, error: "Archived agents cannot be assigned." };
        const selected = new Set(agentIds);
        const previousGoalIds = new Set(
          next.agents
            .filter((agent) => selected.has(agent.id) && agent.primaryGoalId)
            .map((agent) => agent.primaryGoalId!),
        );
        next.agents = next.agents.map((agent) =>
          selected.has(agent.id)
            ? { ...agent, systemId: undefined, primaryGoalId: goal.id }
            : agent,
        );
        next.relatedAgentDismissals = next.relatedAgentDismissals.filter(
          (dismissal) => dismissal.goalId !== goal.id || !selected.has(dismissal.agentId),
        );
        for (const previousGoalId of previousGoalIds)
          if (previousGoalId !== goal.id) repairUnpinnedGoalPosition(next, previousGoalId);
        repairUnpinnedGoalPosition(next, goal.id);
        result = {
          ok: true,
          goalId: goal.id,
          systemId: goal.systemId,
          affectedAgentIds: agentIds,
        };
        break;
      }
      case "AssignAgentToSystem": {
        const agent = findAgent(next, command.agentId);
        const system = findSystem(next, command.systemId);
        if (!agent) return { ok: false, error: "Agent not found." };
        if (!system) return { ok: false, error: "System not found." };
        if (agent.archivedAt !== undefined)
          return { ok: false, error: "Archived agents cannot be assigned." };
        const previousGoalId = agent.primaryGoalId;
        replaceAgent(next, { ...agent, primaryGoalId: undefined, systemId: system.id });
        if (previousGoalId) repairUnpinnedGoalPosition(next, previousGoalId);
        result = { ok: true, agentId: agent.id, systemId: system.id };
        break;
      }
      case "AssignAgentsToSystem": {
        const system = findSystem(next, command.systemId);
        if (!system) return { ok: false, error: "System not found." };
        const agentIds = uniqueAgentIds(command.agentIds);
        if (agentIds.length === 0) return { ok: false, error: "At least one agent is required." };
        const missingAgentId = agentIds.find((agentId) => !findAgent(next, agentId));
        if (missingAgentId) return { ok: false, error: `Agent ${missingAgentId} not found.` };
        const archivedAgentId = agentIds.find(
          (agentId) => findAgent(next, agentId)?.archivedAt !== undefined,
        );
        if (archivedAgentId) return { ok: false, error: "Archived agents cannot be assigned." };
        const selected = new Set(agentIds);
        const previousGoalIds = new Set(
          next.agents
            .filter((agent) => selected.has(agent.id) && agent.primaryGoalId)
            .map((agent) => agent.primaryGoalId!),
        );
        next.agents = next.agents.map((agent) =>
          selected.has(agent.id)
            ? { ...agent, primaryGoalId: undefined, systemId: system.id }
            : agent,
        );
        for (const previousGoalId of previousGoalIds)
          repairUnpinnedGoalPosition(next, previousGoalId);
        result = { ok: true, systemId: system.id, affectedAgentIds: agentIds };
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
        const previousGoalIds = new Set(
          agents
            .filter(
              (agent): agent is Agent => agent !== undefined && agent.primaryGoalId !== undefined,
            )
            .map((agent) => agent.primaryGoalId!),
        );
        next.agents = next.agents.map((agent) =>
          selected.has(agent.id)
            ? { ...agent, systemId: undefined, primaryGoalId: goal.id }
            : agent,
        );
        next.relatedAgentDismissals = next.relatedAgentDismissals.filter(
          (dismissal) => dismissal.goalId !== goal.id || !selected.has(dismissal.agentId),
        );
        for (const previousGoalId of previousGoalIds)
          if (previousGoalId !== goal.id) repairUnpinnedGoalPosition(next, previousGoalId);
        repairUnpinnedGoalPosition(next, goal.id);
        result = {
          ok: true,
          goalId: goal.id,
          systemId: goal.systemId,
          affectedAgentIds: agentIds,
        };
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
        const previousGoalId = agent.primaryGoalId;
        replaceAgent(next, { ...agent, primaryGoalId: undefined, systemId: undefined });
        if (previousGoalId) repairUnpinnedGoalPosition(next, previousGoalId);
        result = { ok: true, agentId: agent.id };
        break;
      }
      case "RenameAgent": {
        const displayName = normalizeText(command.displayName);
        const agent = findAgent(next, command.agentId);
        if (!displayName) return { ok: false, error: "Agent name is required." };
        if (!agent) return { ok: false, error: "Agent not found." };
        if (agent.displayName === displayName && agent.displayNameSource === "human")
          return { ok: true, agentId: agent.id };
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
        if (agent.description === (description || undefined))
          return { ok: true, agentId: agent.id };
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
        if (!Number.isFinite(command.observedAt))
          return { ok: false, error: "Observation time is invalid." };
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
        const system = command.systemId ? findSystem(next, command.systemId) : undefined;
        if (command.goalId && !goal) return { ok: false, error: "Goal not found." };
        if (command.systemId && !system) return { ok: false, error: "System not found." };
        if (goal && system)
          return {
            ok: false,
            error: "An Agent can be assigned to a Goal or directly to a System, not both.",
          };
        if (goal?.status === "archived")
          return { ok: false, error: "Archived goals cannot receive agents." };
        const providerAdmission = command.admissionSource === "provider-catalogue";
        const resumeEligible =
          command.resumeEligibility === "same-site" ||
          command.resumeEligibility === "provider-account";
        const existing = resolveConversationAgent(next.agents, normalizedReference);
        if (existing) {
          if (existing.archivedAt !== undefined)
            return { ok: false, error: "Archived agents cannot be added." };
          const previousGoalId = existing.primaryGoalId;
          const nextGoalId = goal?.id ?? (system ? undefined : existing.primaryGoalId);
          const nextSystemId = goal ? undefined : (system?.id ?? existing.systemId);
          replaceAgent(next, {
            ...existing,
            nativeConversationRef:
              providerAdmission && continuityScopeId
                ? normalizedReference
                : existing.nativeConversationRef,
            providerContinuity: providerAdmission ? "confirmed" : existing.providerContinuity,
            providerResumeEligibility: providerAdmission
              ? command.resumeEligibility
              : existing.providerResumeEligibility,
            resumeCapability: providerAdmission
              ? resumeEligible
                ? "eligible"
                : "blocked"
              : existing.resumeCapability,
            providerObservedAt: providerAdmission
              ? Math.max(
                  existing.providerObservedAt ?? Number.NEGATIVE_INFINITY,
                  command.observedAt,
                )
              : existing.providerObservedAt,
            displayName:
              providerAdmission && existing.displayNameSource === "fallback"
                ? displayName
                : existing.displayName,
            displayNameSource:
              providerAdmission && existing.displayNameSource === "fallback"
                ? "provider"
                : existing.displayNameSource,
            primaryGoalId: nextGoalId,
            systemId: nextSystemId,
            worktree: normalizeText(command.workspaceRef) ?? existing.worktree,
          });
          if (previousGoalId && previousGoalId !== nextGoalId)
            repairUnpinnedGoalPosition(next, previousGoalId);
          if (nextGoalId) repairUnpinnedGoalPosition(next, nextGoalId);
          result = {
            ok: true,
            agentId: existing.id,
            goalId: nextGoalId,
            systemId: goal?.systemId ?? nextSystemId,
          };
          break;
        }
        const agentId = this.ids.next("agent");
        next.agents.push({
          id: agentId,
          harnessId,
          nativeConversationRef: normalizedReference,
          continuity: "proved",
          providerContinuity: providerAdmission ? "confirmed" : "unknown",
          providerResumeEligibility: providerAdmission ? command.resumeEligibility : undefined,
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
          systemId: system?.id,
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
        result = { ok: true, agentId, goalId: goal?.id, systemId: goal?.systemId ?? system?.id };
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
        const checkpointSequence = command.throughSequence;
        if (
          !Number.isSafeInteger(checkpointSequence) ||
          checkpointSequence < 0 ||
          checkpointSequence > (next.changes.at(-1)?.sequence ?? 0)
        )
          return { ok: false, error: "Invalid catch-up sequence boundary." };
        const previousSequence = next.operatorCheckpoint?.lastSequence ?? 0;
        if (checkpointSequence <= previousSequence)
          return { ok: true, checkpointSequence: previousSequence };
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
    const previous = this.state;
    this.state = next;
    this.publishSemanticChanges(
      previous,
      next,
      now,
      command.type === "AddConversation" && command.admissionSource === "host-observation"
        ? "host-observation"
        : "human-command",
    );
    const previousDiscoveries = this.discoveries;
    this.rememberAdmittedDiscoveries(next);
    const nextDiscoveries = new Map(
      [...this.discoveries].filter(([, discovery]) =>
        next.agents.every((agent) => !discoveryRecordMatchesAgent(discovery, agent)),
      ),
    );
    this.discoveries = nextDiscoveries;
    this.publishDiscoveredExecutionChanges(
      changedDiscoveryHandles(previousDiscoveries, nextDiscoveries),
      now,
      "human-command",
    );
    return result;
  }

  reconcile(
    snapshot: HostSnapshot,
    pendingExecutionKeys: readonly HostExecutionKey[] = [],
  ): ReconciliationResult {
    const planned = planReconciliation(this.state, snapshot);
    if ("accepted" in planned) {
      if (isUntrustedSnapshotRejection(planned.error)) this.retainDiscoveriesAsUnknown(snapshot);
      return planned;
    }

    appendChanges(this.state, planned.state, snapshot.observedAt);
    const previousDiscoveries = this.discoveries;
    const nextDiscoveries = this.planDiscoveredExecutions(
      planned.state,
      snapshot,
      pendingExecutionKeys,
    );
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
    const previous = this.state;
    this.state = planned.state;
    this.rememberAdmittedDiscoveries(planned.state);
    this.discoveries = nextDiscoveries;
    this.publishExecutionChanges(
      previous,
      planned.state,
      snapshot.observedAt,
      changedDiscoveryHandles(previousDiscoveries, nextDiscoveries),
    );
    return {
      accepted: true,
      updatedAgentIds: [...new Set(planned.updatedAgentIds)],
      staleAgentIds: planned.staleAgentIds,
      diagnostics: planned.diagnostics,
    };
  }

  private publishSemanticChanges(
    previous: UniverseState,
    next: UniverseState,
    at: number,
    cause: "human-command" | "host-observation",
  ): void {
    const semanticSequence = next.changes.at(-1)?.sequence;
    const systemIds = new Set(changedRecordIds(previous.systems, next.systems));
    const agentIds = changedRecordIds(previous.agents, next.agents);
    const goalIds = new Set(changedRecordIds(previous.goals, next.goals));
    for (const agentId of agentIds) {
      const before = previous.agents.find((agent) => agent.id === agentId);
      const after = next.agents.find((agent) => agent.id === agentId);
      if (before?.primaryGoalId) goalIds.add(before.primaryGoalId);
      if (after?.primaryGoalId) goalIds.add(after.primaryGoalId);
      if (before?.systemId) systemIds.add(before.systemId);
      if (after?.systemId) systemIds.add(after.systemId);
    }
    if (
      JSON.stringify(previous.relatedAgentDismissals) !==
      JSON.stringify(next.relatedAgentDismissals)
    )
      for (const dismissal of [...previous.relatedAgentDismissals, ...next.relatedAgentDismissals])
        goalIds.add(dismissal.goalId);
    const events: UnsequencedControlPlaneEvent[] = [];
    if (systemIds.size > 0)
      events.push({
        type: "system-changed",
        cause,
        occurredAt: at,
        systemIds: [...systemIds],
        semanticSequence,
      });
    if (goalIds.size > 0)
      events.push({
        type: "goal-changed",
        cause,
        occurredAt: at,
        goalIds: [...goalIds],
        semanticSequence,
      });
    if (agentIds.length > 0)
      events.push({
        type: "agent-changed",
        cause,
        occurredAt: at,
        agentIds,
        semanticSequence,
      });
    if (JSON.stringify(previous.operatorCheckpoint) !== JSON.stringify(next.operatorCheckpoint))
      events.push({
        type: "catch-up-changed",
        cause,
        occurredAt: at,
        semanticSequence: next.operatorCheckpoint?.lastSequence ?? semanticSequence ?? 0,
      });
    this.events?.publish(events);
  }

  private publishAgentChanges(
    previous: UniverseState,
    next: UniverseState,
    at: number,
    cause: "provider-catalogue",
  ): void {
    const agentIds = changedRecordIds(previous.agents, next.agents);
    if (agentIds.length > 0)
      this.events?.publish([{ type: "agent-changed", cause, occurredAt: at, agentIds }]);
  }

  private publishExecutionChanges(
    previous: UniverseState,
    next: UniverseState,
    at: number,
    discoveredHandles: readonly string[] = [],
  ): void {
    const agentIds = changedExecutionAgentIds(previous.agents, next.agents);
    const hostKeys = changedHostKeys(previous.hosts, next.hosts);
    if (agentIds.length === 0 && hostKeys.length === 0 && discoveredHandles.length === 0) return;
    const previousStatuses = new Map(
      previous.hosts.map((host) => [hostHealthKey(host), host.status]),
    );
    const nextStatuses = new Map(next.hosts.map((host) => [hostHealthKey(host), host.status]));
    const availabilityChanged = hostKeys.some(
      (hostKey) => previousStatuses.get(hostKey) !== nextStatuses.get(hostKey),
    );
    const events: UnsequencedControlPlaneEvent[] = [];
    if (agentIds.length > 0 || hostKeys.length > 0)
      events.push({
        type: "execution-evidence-changed",
        cause: "host-observation",
        occurredAt: at,
        agentIds,
        hostKeys,
        availabilityChanged,
      });
    if (discoveredHandles.length > 0)
      events.push({
        type: "discovered-execution-changed",
        cause: "host-observation",
        occurredAt: at,
        handles: discoveredHandles,
      });
    this.events?.publish(events);
  }

  private publishDiscoveredExecutionChanges(
    handles: readonly string[],
    at: number,
    cause: "human-command" | "host-observation" | "provider-catalogue",
  ): void {
    if (handles.length === 0) return;
    this.events?.publish([
      {
        type: "discovered-execution-changed",
        cause,
        occurredAt: at,
        handles,
      },
    ]);
  }
}

export const createEmptyUniverse = (
  store: UniverseStore,
  clock: Clock,
  ids: IdGenerator,
  projections: ProjectionModule,
): Universe => new Universe(store, clock, ids, projections);
