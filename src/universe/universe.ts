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
  type ProviderSessionFact,
  type AgentId,
  type Agent,
  type NativeConversationRef,
  type UniverseChange,
  type UniverseChangeOutcome,
  type UniverseState,
  type UniverseStore,
} from "./types.ts";
import { isPlausibleUnidentifiedExecution } from "./execution-ambiguity.ts";
import {
  defaultGoalMapPosition,
  initialGoalMapPosition,
  isMapPosition,
  repairGoalMapPosition,
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
      readonly type: "BindAgentIdentity";
      readonly agentId: AgentId;
      readonly harnessId: string;
      readonly nativeConversationRef?: NativeConversationRef;
    }
  | {
      readonly type: "AdoptProviderSession";
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
  readonly agentId?: AgentId;
  readonly affectedAgentIds?: readonly AgentId[];
  readonly checkpointSequence?: number;
}

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly addedAgentIds: readonly AgentId[];
  readonly updatedAgentIds: readonly AgentId[];
  readonly staleAgentIds: readonly AgentId[];
  readonly diagnostics: readonly string[];
  readonly error?: string;
}

const normalizeText = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const copyOptional = (value: string | undefined): string | undefined => normalizeText(value);

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

  reconcileProviderSessions(options: {
    readonly harnessId: string;
    readonly continuityScopeId: string;
    readonly observedAt: number;
    readonly complete: boolean;
    readonly sessions: readonly ProviderSessionFact[];
  }): void {
    const next = cloneUniverseState(this.state);
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
      };
    });
    this.store.save(next);
    this.state = next;
  }

  markProviderUnavailable(harnessId: string): void {
    const next = cloneUniverseState(this.state);
    next.agents = next.agents.map((agent) =>
      agent.harnessId === harnessId && agent.nativeConversationRef
        ? {
            ...agent,
            providerContinuity: "unknown" as const,
            resumeCapability: "unknown" as const,
          }
        : agent,
    );
    this.store.save(next);
    this.state = next;
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
        const description = normalizeText(command.description);
        const goal = {
          id,
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
      case "BindAgentIdentity": {
        const agent = findAgent(next, command.agentId);
        const harnessId = normalizeText(command.harnessId);
        if (!agent) return { ok: false, error: "Agent not found." };
        if (!harnessId) return { ok: false, error: "Harness id is required." };
        const nativeConversationRef = command.nativeConversationRef;
        if (
          nativeConversationRef &&
          (nativeConversationRef.harnessId !== harnessId ||
            !normalizeText(nativeConversationRef.kind) ||
            !normalizeText(nativeConversationRef.value))
        )
          return { ok: false, error: "Native conversation reference is invalid." };
        const boundConversation = nativeConversationRef
          ? { ...nativeConversationRef }
          : agent.nativeConversationRef;
        if (
          boundConversation &&
          next.agents.some(
            (candidate) =>
              candidate.id !== agent.id &&
              candidate.nativeConversationRef &&
              nativeConversationKey(candidate.nativeConversationRef) ===
                nativeConversationKey(boundConversation),
          )
        )
          return { ok: false, error: "Native conversation is already bound to another Agent." };
        replaceAgent(next, {
          ...agent,
          harnessId,
          nativeConversationRef: boundConversation,
          continuity: boundConversation ? "proved" : agent.continuity,
        });
        result = { ok: true, agentId: agent.id };
        break;
      }
      case "AdoptProviderSession": {
        const harnessId = normalizeText(command.harnessId);
        const displayName = normalizeText(command.displayName);
        const reference = command.nativeConversationRef;
        const continuityScopeId = normalizeText(reference.continuityScopeId);
        if (!harnessId || !displayName)
          return { ok: false, error: "Harness id and Agent name are required." };
        if (
          reference.harnessId !== harnessId ||
          !continuityScopeId ||
          !normalizeText(reference.kind) ||
          !normalizeText(reference.value)
        )
          return { ok: false, error: "Scoped provider session reference is invalid." };
        const goal = command.goalId ? findGoal(next, command.goalId) : undefined;
        if (command.goalId && !goal) return { ok: false, error: "Goal not found." };
        if (goal?.status === "archived")
          return { ok: false, error: "Archived goals cannot receive agents." };
        const referenceKey = nativeConversationKey(reference);
        const existing = next.agents.find(
          (agent) =>
            agent.nativeConversationRef &&
            nativeConversationKey(agent.nativeConversationRef) === referenceKey,
        );
        if (existing) {
          if (goal && existing.primaryGoalId !== goal.id)
            replaceAgent(next, { ...existing, primaryGoalId: goal.id });
          result = { ok: true, agentId: existing.id, goalId: goal?.id };
          break;
        }
        const agentId = this.ids.next("agent");
        next.agents.push({
          id: agentId,
          harnessId,
          nativeConversationRef: { ...reference, continuityScopeId },
          continuity: "proved",
          providerContinuity: "confirmed",
          executionPresence: "absent",
          resumeCapability: "eligible",
          observationHealth: "fresh",
          providerObservedAt: command.observedAt,
          executionHistory: [],
          conflictingExecutions: [],
          displayName,
          displayNameSource: "host",
          primaryGoalId: goal?.id,
          runtimeState: "unknown",
          runtimeStateSource: `${harnessId}.provider-catalogue`,
          hostHealth: "stale",
          lastSeenAt: command.observedAt,
          lastObservedAt: command.observedAt,
          lastChangedAt: now,
          worktree: normalizeText(command.workspaceRef),
          provider: harnessId,
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
    const duplicate = isDuplicateObservation(snapshot.agents);
    if (duplicate) {
      return {
        accepted: false,
        addedAgentIds: [],
        updatedAgentIds: [],
        staleAgentIds: [],
        diagnostics: [duplicate],
        error: duplicate,
      };
    }

    const next = cloneUniverseState(this.state);
    const diagnostics = [...snapshot.diagnostics];
    const addedAgentIds: AgentId[] = [];
    const updatedAgentIds: AgentId[] = [];
    const staleAgentIds: AgentId[] = [];
    const now = snapshot.observedAt;
    const previousHost = this.state.hosts.find(
      (candidate) => candidate.hostInstanceId === snapshot.hostInstanceId,
    );
    if (previousHost?.lastObservedAt !== undefined && now < previousHost.lastObservedAt) {
      const error = `Out-of-order ${snapshot.hostKind} snapshot ignored: ${now} is older than ${previousHost.lastObservedAt}.`;
      return {
        accepted: false,
        addedAgentIds: [],
        updatedAgentIds: [],
        staleAgentIds: [],
        diagnostics: [...diagnostics, error],
        error,
      };
    }
    const hostStatusValue: HostHealth["status"] = snapshot.available ? "live" : "unavailable";
    const hostStatus = {
      hostKind: snapshot.hostKind,
      hostInstanceId: snapshot.hostInstanceId,
      status: hostStatusValue,
      diagnosticCount: diagnostics.length,
    };
    if (snapshot.available) Object.assign(hostStatus, { lastObservedAt: now });
    else if (previousHost?.lastObservedAt !== undefined)
      Object.assign(hostStatus, { lastObservedAt: previousHost.lastObservedAt });
    if (snapshot.error) Object.assign(hostStatus, { lastError: snapshot.error });
    replaceHost(next, hostStatus);

    if (!snapshot.available) {
      next.agents = next.agents.map((agent) => {
        if (
          agent.execution?.hostInstanceId !== snapshot.hostInstanceId ||
          agent.hostHealth === "unavailable"
        )
          return agent;
        staleAgentIds.push(agent.id);
        return {
          ...agent,
          hostHealth: "unavailable" as const,
          executionPresence: "unknown" as const,
          observationHealth: "unavailable" as const,
          conflictingExecutions: [],
        };
      });
    } else {
      const observedIds = new Set(snapshot.agents.map((agent) => agent.nativeId.trim()));
      const conversationExecutions = new Map<string, Agent["conflictingExecutions"]>();
      for (const observation of snapshot.agents) {
        const reference = nativeConversationFromObservation(observation);
        if (!reference) continue;
        const key = nativeConversationKey(reference);
        conversationExecutions.set(key, [
          ...(conversationExecutions.get(key) ?? []),
          {
            hostKind: snapshot.hostKind,
            hostInstanceId: snapshot.hostInstanceId,
            nativeId: observation.nativeId.trim(),
            hostLocator: observation.hostLocator,
            observedAt: observation.observedAt,
          },
        ]);
      }
      next.agents = next.agents.map((agent) => {
        if (
          agent.execution?.hostInstanceId !== snapshot.hostInstanceId ||
          observedIds.has(agent.execution.nativeId) ||
          agent.execution.observedAt > now
        )
          return agent;
        if (!observedIds.has(agent.execution.nativeId)) {
          staleAgentIds.push(agent.id);
          return {
            ...agent,
            execution: undefined,
            executionHistory: appendExecutionHistory(agent, agent.execution),
            hostHealth: "stale" as const,
            executionPresence: "absent" as const,
            observationHealth: "fresh" as const,
            conflictingExecutions: [],
            executionObservedAt: now,
            continuity: agent.nativeConversationRef ? agent.continuity : ("unknown" as const),
          };
        }
        return agent;
      });

      for (const observation of snapshot.agents) {
        const observedConversation = nativeConversationFromObservation(observation);
        const byConversation = observedConversation
          ? next.agents.find(
              (agent) =>
                agent.nativeConversationRef &&
                nativeConversationKey(agent.nativeConversationRef) ===
                  nativeConversationKey(observedConversation),
            )
          : undefined;
        let byExecution = next.agents.find((agent) =>
          executionMatches(agent, snapshot.hostInstanceId, observation.nativeId),
        );
        const detachExecution = (agent: Agent, continuity: "replaced" | "unknown"): void => {
          replaceAgent(next, {
            ...agent,
            execution: undefined,
            executionHistory: appendExecutionHistory(agent, agent.execution),
            executionPresence: "absent",
            executionObservedAt: now,
            observationHealth: "fresh",
            runtimeState: "unknown",
            runtimeStateSource: "observatory.continuity",
            hostHealth: "stale",
            attentionSince: undefined,
            continuity,
          });
          if (!staleAgentIds.includes(agent.id)) staleAgentIds.push(agent.id);
        };
        if (byConversation && byExecution && byConversation.id !== byExecution.id) {
          detachExecution(byExecution, "replaced");
          byExecution = undefined;
        }
        if (
          !byConversation &&
          byExecution &&
          ((byExecution.nativeConversationRef &&
            observedConversation &&
            nativeConversationKey(byExecution.nativeConversationRef) !==
              nativeConversationKey(observedConversation)) ||
            (byExecution.runtimeStateSource === "observatory.process-start" &&
              Boolean(byExecution.nativeConversationRef) &&
              !observedConversation))
        ) {
          detachExecution(byExecution, observedConversation ? "replaced" : "unknown");
          byExecution = undefined;
        }
        const existing = byConversation ?? byExecution;
        if (!existing) {
          const id = this.ids.next("agent");
          const agent = this.agentFromObservation(id, snapshot, observation);
          next.agents = [...next.agents, agent];
          addedAgentIds.push(id);
          continue;
        }
        const conflicts = observedConversation
          ? (conversationExecutions.get(nativeConversationKey(observedConversation)) ?? [])
          : [];
        if (conflicts.length > 1) {
          replaceAgent(next, {
            ...existing,
            executionPresence: "conflict",
            resumeCapability: "blocked",
            observationHealth: "fresh",
            executionObservedAt: observation.observedAt,
            conflictingExecutions: conflicts,
          });
          diagnostics.push(
            `Multiple live executions claim the provider conversation for ${existing.displayName}; resume is blocked.`,
          );
          if (!updatedAgentIds.includes(existing.id)) updatedAgentIds.push(existing.id);
          continue;
        }
        if (observation.observedAt < existing.lastObservedAt) {
          diagnostics.push(
            `Ignored an older observation for ${observation.nativeId.trim()}: ${observation.observedAt} is older than ${existing.lastObservedAt}.`,
          );
          continue;
        }
        const stateChanged = existing.runtimeState !== observation.runtimeState;
        const currentAttention = isCurrentAttentionState(observation.runtimeState);
        const updated = {
          ...existing,
          runtimeState: observation.runtimeState,
          runtimeStateSource: observation.runtimeStateSource,
          hostHealth: "live" as const,
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
          executionPresence: "live" as const,
          executionObservedAt: observation.observedAt,
          observationHealth: "fresh" as const,
          harnessId:
            observation.harnessEvidence?.detectedHarnessId ??
            observedConversation?.harnessId ??
            existing.harnessId,
          nativeConversationRef: observedConversation ?? existing.nativeConversationRef,
          continuity: observedConversation ? ("proved" as const) : existing.continuity,
        };
        if (existing.displayNameSource === "host")
          Object.assign(updated, { displayName: observation.displayName });
        Object.assign(updated, {
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
        });
        replaceAgent(next, updated);
        updatedAgentIds.push(existing.id);
      }

      for (const agent of next.agents) {
        if (
          agent.providerContinuity !== "confirmed" ||
          !agent.nativeConversationRef ||
          agent.execution ||
          agent.executionPresence === "conflict" ||
          agent.conflictingExecutions.length > 0 ||
          !agent.harnessId ||
          !agent.worktree
        )
          continue;
        const possiblyLive = snapshot.agents.some((observation) =>
          isPlausibleUnidentifiedExecution(
            { harnessId: agent.harnessId, workspaceRef: agent.worktree },
            observation,
          ),
        );
        const executionPresence = possiblyLive ? ("unknown" as const) : ("absent" as const);
        if (
          agent.executionPresence === executionPresence &&
          agent.observationHealth === "fresh" &&
          agent.executionObservedAt === now
        )
          continue;
        replaceAgent(next, {
          ...agent,
          executionPresence,
          observationHealth: "fresh",
          executionObservedAt: now,
        });
        if (!updatedAgentIds.includes(agent.id)) updatedAgentIds.push(agent.id);
      }
    }

    appendChanges(this.state, next, now);
    try {
      this.store.save(next);
    } catch (error) {
      return {
        accepted: false,
        addedAgentIds: [],
        updatedAgentIds: [],
        staleAgentIds: [],
        diagnostics,
        error: `Reconciliation rolled back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    this.state = next;
    return {
      accepted: true,
      addedAgentIds,
      updatedAgentIds,
      staleAgentIds,
      diagnostics,
    };
  }

  private agentFromObservation(
    id: string,
    snapshot: HostSnapshot,
    observation: HostAgentObservation,
  ): Agent {
    const attentionSince = isCurrentAttentionState(observation.runtimeState)
      ? observation.observedAt
      : undefined;
    const agent = {
      id,
      execution: {
        hostKind: snapshot.hostKind,
        hostInstanceId: snapshot.hostInstanceId,
        nativeId: observation.nativeId.trim(),
        hostLocator: observation.hostLocator,
        observedAt: observation.observedAt,
      },
      harnessId:
        observation.harnessEvidence?.detectedHarnessId ??
        nativeConversationFromObservation(observation)?.harnessId,
      nativeConversationRef: nativeConversationFromObservation(observation),
      continuity: nativeConversationFromObservation(observation)
        ? ("proved" as const)
        : ("unknown" as const),
      providerContinuity: nativeConversationFromObservation(observation)?.continuityScopeId
        ? ("confirmed" as const)
        : ("unknown" as const),
      executionPresence: "live" as const,
      resumeCapability: "unknown" as const,
      observationHealth: "fresh" as const,
      providerObservedAt: nativeConversationFromObservation(observation)?.continuityScopeId
        ? observation.observedAt
        : undefined,
      executionObservedAt: observation.observedAt,
      executionHistory: [],
      conflictingExecutions: [],
      displayName: observation.displayName,
      displayNameSource: "host" as const,
      runtimeState: observation.runtimeState,
      runtimeStateSource: observation.runtimeStateSource,
      hostHealth: "live" as const,
      lastSeenAt: observation.observedAt,
      lastObservedAt: observation.observedAt,
      lastChangedAt: observation.observedAt,
    };
    Object.assign(agent, {
      attentionSince,
      repository: copyOptional(observation.repository),
      branch: copyOptional(observation.branch),
      worktree: copyOptional(observation.worktree),
      provider: copyOptional(observation.provider),
      executionContainer: copyExecutionContainer(observation.executionContainer),
    });
    return agent;
  }
}

export const createEmptyUniverse = (
  store: UniverseStore,
  clock: Clock,
  ids: IdGenerator,
  projections: ProjectionModule,
): Universe => {
  const state = store.load();
  if (state.goals.length === 0 && state.agents.length === 0) store.save(emptyUniverseState());
  return new Universe(store, clock, ids, projections);
};
