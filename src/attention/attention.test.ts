import { describe, expect, test } from "bun:test";
import { evaluateAttention } from "./attention.ts";
import type { Goal, Agent } from "../universe/types.ts";

const goal = (id: string, priority: Goal["priority"]): Goal => ({
  id,
  title: id,
  priority,
  status: "active",
  createdAt: 0,
  updatedAt: 0,
});
const agent = (
  id: string,
  state: Agent["runtimeState"],
  goalId: string,
  attentionSince: number,
  lastChangedAt = attentionSince,
): Agent => {
  const result: Agent = {
    id,
    execution: {
      hostKind: "herdr",
      hostInstanceId: "herdr:local",
      nativeId: id,
      hostLocator: id,
      observedAt: 10_000,
    },
    continuity: "proved",
    providerContinuity: "confirmed",
    executionPresence: "live",
    resumeCapability: "eligible",
    observationHealth: "fresh",
    executionHistory: [],
    conflictingExecutions: [],
    displayName: id,
    displayNameSource: "fallback",
    primaryGoalId: goalId,
    runtimeState: state,
    runtimeStateSource: "herdr.agent_status",
    hostHealth: "live",
    lastSeenAt: 10_000,
    lastObservedAt: 10_000,
    lastChangedAt,
  };
  if (attentionSince) Object.assign(result, { attentionSince });
  return result;
};

describe("attention", () => {
  test("orders human input, priority, wait duration, then recent host change", () => {
    const projection = evaluateAttention(
      20_000,
      [goal("p1", "P1"), goal("p0", "P0")],
      [
        agent("working-p0", "working", "p0", 0),
        agent("new-p0", "blocked", "p0", 18_000),
        agent("old-p1", "waiting", "p1", 5_000),
        agent("old-p0", "blocked", "p0", 5_000, 19_000),
      ],
    );
    expect(projection.items.map((item) => item.agentId)).toEqual(["old-p0", "new-p0", "old-p1"]);
    expect(projection.currentCount).toBe(3);
    expect(projection.items[0]?.explanation).toContain("blocked");
  });

  test("does not promote stale last-known blocked state as current attention", () => {
    const projection = evaluateAttention(
      20_000,
      [goal("p0", "P0")],
      [
        {
          ...agent("stale", "blocked", "p0", 5_000),
          hostHealth: "stale",
          executionPresence: "unknown",
          observationHealth: "stale",
        },
        agent("current", "blocked", "p0", 15_000),
      ],
    );
    expect(projection.currentCount).toBe(1);
    expect(projection.uncertaintyCount).toBe(1);
    expect(projection.items[1]?.reason).toBe("runtime-unknown");
    expect(projection.items[1]?.explanation).toContain("not current");
  });

  test("surfaces a live archived conversation without treating it as active work", () => {
    const projection = evaluateAttention(
      20_000,
      [goal("p0", "P0")],
      [{ ...agent("archived", "working", "p0", 0), archivedAt: 5_000 }],
    );

    expect(projection.currentCount).toBe(1);
    expect(projection.items[0]?.reason).toBe("archived-running");
    expect(projection.items[0]?.explanation).toContain("archived conversation");
  });
});
