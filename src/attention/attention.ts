import {
  priorityRank,
  type Goal,
  type HostHealth,
  type Priority,
  type RuntimeState,
  type Agent,
} from "../universe/types.ts";
import { displayHostKind } from "../hosts/types.ts";

export type AttentionReason = "blocked" | "waiting" | "archived-running" | "runtime-unknown";

export interface AttentionItem {
  readonly id: string;
  readonly targetType: "agent" | "host";
  readonly targetId: string;
  readonly agentId?: string;
  readonly goalId?: string;
  readonly reason: AttentionReason;
  readonly requiresHumanInput: boolean;
  readonly startedAt: number;
  readonly lastChangedAt: number;
  readonly ageMs: number;
  readonly priority: Priority;
  readonly runtimeState: RuntimeState;
  readonly explanation: string;
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

const sortAttention = (left: AttentionItem, right: AttentionItem): number => {
  if (left.requiresHumanInput !== right.requiresHumanInput) return left.requiresHumanInput ? -1 : 1;
  const priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDifference !== 0) return priorityDifference;
  if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt;
  if (left.lastChangedAt !== right.lastChangedAt) return right.lastChangedAt - left.lastChangedAt;
  return left.id.localeCompare(right.id);
};

const age = (now: number, startedAt: number): number => Math.max(0, now - startedAt);

export const evaluateAttention = (
  now: number,
  goals: readonly Goal[],
  agents: readonly Agent[],
  hosts: readonly HostHealth[] = [],
): AttentionProjection => {
  const priorities = goalPriorities(goals);
  const items: AttentionItem[] = [];

  for (const agent of agents) {
    const priority = priorities.get(agent.primaryGoalId ?? "") ?? "P3";
    if (agent.archivedAt !== undefined && agent.executionPresence === "live") {
      const startedAt = agent.lastSeenAt;
      items.push({
        id: `${agent.id}:archived-running`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: "archived-running",
        requiresHumanInput: true,
        startedAt,
        lastChangedAt: agent.lastChangedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation:
          "This archived conversation has a live execution. Restore it or stop the execution.",
      });
      continue;
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

    if (agent.observationHealth !== "fresh" || agent.executionPresence === "unknown") {
      const sourceLabel = displayHostKind(agent.execution?.hostKind ?? "host");
      const startedAt = agent.lastSeenAt;
      items.push({
        id: `${agent.id}:runtime-unknown`,
        targetType: "agent",
        targetId: agent.id,
        agentId: agent.id,
        goalId: agent.primaryGoalId,
        reason: "runtime-unknown",
        requiresHumanInput: false,
        startedAt,
        lastChangedAt: agent.lastObservedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: agent.runtimeState,
        explanation: `The last ${sourceLabel} observation is ${agent.hostHealth}; the last known ${agent.runtimeState} state is not current.`,
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

  items.sort(sortAttention);
  return {
    items,
    currentCount: items.filter((item) => item.requiresHumanInput).length,
    uncertaintyCount: items.filter((item) => !item.requiresHumanInput).length,
  };
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
