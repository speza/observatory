import {
  priorityRank,
  type Goal,
  type HostHealth,
  type Priority,
  type RuntimeState,
  type Agent,
} from "../universe/types.ts";
import { displayHostKind } from "../hosts/types.ts";

export type AttentionReason =
  | "blocked"
  | "waiting"
  | "archived-running"
  | "runtime-complete"
  | "ended-externally"
  | "runtime-unknown"
  | "provider-input"
  | "provider-failure"
  | "provider-complete"
  | "context-pressure"
  | "provider-stale"
  | "provider-conflict";

export type AttentionAction = "respond" | "review" | "resolve" | "monitor";

export interface SupportingAttentionSignal {
  readonly id: string;
  readonly reason: AttentionReason;
  readonly action: AttentionAction;
  readonly startedAt: number;
  readonly lastChangedAt: number;
  readonly ageMs: number;
  readonly explanation: string;
}

export interface AttentionItem {
  readonly id: string;
  readonly targetType: "agent" | "host";
  readonly targetId: string;
  readonly agentId?: string;
  readonly goalId?: string;
  readonly reason: AttentionReason;
  readonly action: AttentionAction;
  readonly requiresHumanInput: boolean;
  readonly startedAt: number;
  readonly lastChangedAt: number;
  readonly ageMs: number;
  readonly priority: Priority;
  readonly runtimeState: RuntimeState;
  readonly explanation: string;
  readonly supportingSignals?: readonly SupportingAttentionSignal[];
}

export interface AttentionProjection {
  readonly items: readonly AttentionItem[];
  readonly currentCount: number;
  readonly uncertaintyCount: number;
}

const attentionReason = (state: RuntimeState): AttentionReason | undefined => {
  if (state === "blocked") return "blocked";
  if (state === "waiting") return "waiting";
  return undefined;
};

const goalPriorities = (goals: readonly Goal[]): Map<string, Priority> =>
  new Map(goals.map((goal) => [goal.id, goal.priority]));

const actionRank = (action: AttentionAction): number =>
  ({ respond: 0, review: 1, resolve: 2, monitor: 3 })[action];

const reasonRank = (reason: AttentionReason): number =>
  ({
    "provider-failure": 0,
    "provider-input": 1,
    blocked: 2,
    waiting: 3,
    "provider-complete": 4,
    "runtime-complete": 5,
    "archived-running": 6,
    "ended-externally": 7,
    "provider-conflict": 8,
    "provider-stale": 9,
    "runtime-unknown": 10,
    "context-pressure": 11,
  })[reason];

export const compareAttention = (left: AttentionItem, right: AttentionItem): number => {
  if (left.requiresHumanInput !== right.requiresHumanInput) return left.requiresHumanInput ? -1 : 1;
  const priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDifference !== 0) return priorityDifference;
  const actionDifference = actionRank(left.action) - actionRank(right.action);
  if (actionDifference !== 0) return actionDifference;
  if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt;
  if (left.lastChangedAt !== right.lastChangedAt) return right.lastChangedAt - left.lastChangedAt;
  return left.id.localeCompare(right.id);
};

const compareClaims = (left: AttentionItem, right: AttentionItem): number =>
  actionRank(left.action) - actionRank(right.action) ||
  reasonRank(left.reason) - reasonRank(right.reason) ||
  left.startedAt - right.startedAt ||
  right.lastChangedAt - left.lastChangedAt ||
  left.id.localeCompare(right.id);

export const composeAttention = (claims: readonly AttentionItem[]): AttentionProjection => {
  const bySubject = new Map<string, AttentionItem[]>();
  for (const claim of claims) {
    const key = `${claim.targetType}:${claim.targetId}`;
    const subjectClaims = bySubject.get(key) ?? [];
    subjectClaims.push(claim);
    bySubject.set(key, subjectClaims);
  }
  const items = [...bySubject.values()].map((subjectClaims) => {
    const [primary, ...supporting] = [...subjectClaims].sort(compareClaims);
    if (!primary) throw new Error("An attention subject must contain a claim.");
    return {
      ...primary,
      supportingSignals: supporting.map((claim) => ({
        id: claim.id,
        reason: claim.reason,
        action: claim.action,
        startedAt: claim.startedAt,
        lastChangedAt: claim.lastChangedAt,
        ageMs: claim.ageMs,
        explanation: claim.explanation,
      })),
    };
  });
  items.sort(compareAttention);
  return {
    items,
    currentCount: items.filter((item) => item.requiresHumanInput).length,
    uncertaintyCount: items.filter((item) => !item.requiresHumanInput).length,
  };
};

const age = (now: number, startedAt: number): number => Math.max(0, now - startedAt);

export const evaluateAttention = (
  now: number,
  goals: readonly Goal[],
  agents: readonly Agent[],
  hosts: readonly HostHealth[] = [],
): AttentionProjection => {
  const priorities = goalPriorities(goals);
  const archivedGoalIds = new Set(
    goals.filter((goal) => goal.status === "archived").map((goal) => goal.id),
  );
  const items: AttentionItem[] = [];

  for (const agent of agents) {
    const priority = priorities.get(agent.primaryGoalId ?? "") ?? "P3";
    if (
      (agent.archivedAt !== undefined || archivedGoalIds.has(agent.primaryGoalId ?? "")) &&
      agent.executionPresence === "live"
    ) {
      const startedAt = agent.lastSeenAt;
      items.push({
        id: `${agent.id}:archived-running`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: "archived-running",
        action: "resolve",
        requiresHumanInput: true,
        startedAt,
        lastChangedAt: agent.lastChangedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation:
          agent.archivedAt !== undefined
            ? "This archived conversation has a live execution. Review it and explicitly close the execution when appropriate."
            : "This Agent's Goal is archived, but its execution is still live. Review ongoing work and explicitly close it when appropriate; Goal archive does not stop execution.",
      });
    }
    const currentReason =
      agent.executionPresence === "live" ? attentionReason(agent.runtimeState) : undefined;
    if (currentReason) {
      const sourceLabel = displayHostKind(agent.execution?.hostKind ?? "host");
      const startedAt = agent.attentionSince ?? agent.lastChangedAt;
      items.push({
        id: `${agent.id}:${currentReason}`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: currentReason,
        action: "respond",
        requiresHumanInput: true,
        startedAt,
        lastChangedAt: agent.lastChangedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation:
          currentReason === "blocked"
            ? `${sourceLabel} reports that this agent is blocked and may need human input.`
            : `${sourceLabel} reports that this agent is waiting for human input.`,
      });
    }

    if (agent.executionPresence === "live" && agent.runtimeState === "done") {
      const startedAt = agent.attentionSince ?? agent.lastChangedAt;
      items.push({
        id: `${agent.id}:runtime-complete`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: "runtime-complete",
        action: "review",
        requiresHumanInput: true,
        startedAt,
        lastChangedAt: agent.lastChangedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation: `${displayHostKind(agent.execution?.hostKind ?? "host")} reports that this Agent is done. Review evidence before closing it or accepting its Goal.`,
      });
    }

    if (agent.primaryGoalId && agent.executionPresence === "absent") {
      const startedAt = agent.lastSeenAt;
      items.push({
        id: `${agent.id}:ended-externally`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: "ended-externally",
        action: "resolve",
        requiresHumanInput: true,
        startedAt,
        lastChangedAt: agent.lastChangedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation:
          "A complete host observation confirms that this Agent has no current execution. Review or archive its durable record.",
      });
    }

    if (
      agent.observationHealth !== "fresh" ||
      agent.executionPresence === "unknown" ||
      agent.executionPresence === "conflict"
    ) {
      const sourceLabel = displayHostKind(agent.execution?.hostKind ?? "host");
      const startedAt = agent.lastSeenAt;
      items.push({
        id: `${agent.id}:runtime-unknown`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: "runtime-unknown",
        action: "monitor",
        requiresHumanInput: false,
        startedAt,
        lastChangedAt: agent.lastObservedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation:
          agent.executionPresence === "conflict"
            ? `${sourceLabel} reports conflicting executions for this Agent. Resolve execution identity before acting on a host target.`
            : `The last ${sourceLabel} observation is ${agent.hostHealth}; the last known ${agent.runtimeState} state is not current.`,
      });
    }
  }

  for (const host of hosts) {
    if (host.status === "unavailable") {
      const startedAt = host.lastObservedAt ?? now;
      items.push({
        id: `${host.hostKind}:host-unavailable`,
        targetType: "host",
        targetId: host.hostKind,
        reason: "runtime-unknown",
        action: "monitor",
        requiresHumanInput: false,
        startedAt,
        lastChangedAt: startedAt,
        ageMs: age(now, startedAt),
        priority: "P3",
        runtimeState: "unknown",
        explanation: host.lastError
          ? `${host.hostKind} is unavailable: ${host.lastError}`
          : `${host.hostKind} is unavailable; stored organisation is retained.`,
      });
    }
  }

  return composeAttention(items);
};

export const formatAge = (milliseconds: number): string => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};
