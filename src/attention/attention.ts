import {
  priorityRank,
  type Goal,
  type HostHealth,
  type Priority,
  type RuntimeState,
  type TrackedSession,
} from "../universe/types.ts";
import { displayHostKind } from "../hosts/types.ts";

export type AttentionReason = "blocked" | "waiting" | "host-stale";

export interface AttentionItem {
  readonly id: string;
  readonly targetType: "session" | "host";
  readonly targetId: string;
  readonly sessionId?: string;
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
  sessions: readonly TrackedSession[],
  hosts: readonly HostHealth[] = [],
): AttentionProjection => {
  const priorities = goalPriorities(goals);
  const items: AttentionItem[] = [];

  for (const session of sessions) {
    const priority = priorities.get(session.primaryGoalId ?? "") ?? "P3";
    const currentReason =
      session.hostHealth === "live" ? attentionReason(session.runtimeState) : undefined;
    if (currentReason) {
      const sourceLabel = displayHostKind(session.hostKind);
      const startedAt = session.attentionSince ?? session.lastChangedAt;
      items.push({
        id: `${session.id}:${currentReason}`,
        targetType: "session",
        targetId: session.id,
        sessionId: session.id,
        goalId: session.primaryGoalId,
        reason: currentReason,
        requiresHumanInput: true,
        startedAt,
        lastChangedAt: session.lastChangedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: session.runtimeState,
        explanation:
          currentReason === "blocked"
            ? `${sourceLabel} reports that this session is blocked and may need human input.`
            : `${sourceLabel} reports that this session is waiting for human input.`,
      });
    }

    if (session.hostHealth !== "live") {
      const sourceLabel = displayHostKind(session.hostKind);
      const startedAt = session.lastSeenAt;
      items.push({
        id: `${session.id}:host-stale`,
        targetType: "session",
        targetId: session.id,
        sessionId: session.id,
        goalId: session.primaryGoalId,
        reason: "host-stale",
        requiresHumanInput: false,
        startedAt,
        lastChangedAt: session.lastObservedAt,
        ageMs: age(now, startedAt),
        priority,
        runtimeState: session.runtimeState,
        explanation: `The last ${sourceLabel} observation is ${session.hostHealth}; the last known ${session.runtimeState} state is not current.`,
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
        reason: "host-stale",
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
