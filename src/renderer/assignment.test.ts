import { describe, expect, test } from "bun:test";
import { filterAssignableAgents } from "./assignment.ts";
import type { AgentView } from "../projection/types.ts";

const agent = (overrides: Partial<AgentView> = {}): AgentView => ({
  id: overrides.id ?? "agent-1",
  hostKind: "mock",
  nativeId: "native-1",
  displayName: "Model router implementation",
  displayNameSource: "host",
  runtimeState: "working",
  runtimeStateSource: "mock",
  hostHealth: "live",
  lastSeenAt: 1,
  lastObservedAt: 1,
  lastChangedAt: 1,
  hostLocator: "mock://agent-1",
  ...overrides,
});

describe("assignment picker", () => {
  test("starts with the complete inbox and matches useful agent metadata", () => {
    const agents = [
      agent(),
      agent({ id: "agent-2", displayName: "Memory reminders", repository: "observatory" }),
    ];

    expect(filterAssignableAgents(agents, "")).toEqual(agents);
    expect(filterAssignableAgents(agents, "observatory").map((item) => item.id)).toEqual([
      "agent-2",
    ]);
    expect(filterAssignableAgents(agents, "ROUTER").map((item) => item.id)).toEqual(["agent-1"]);
  });

  test("returns an empty result when the inbox input has no match", () => {
    const agents = [agent()];
    expect(filterAssignableAgents(agents, "missing")).toHaveLength(0);
  });
});
