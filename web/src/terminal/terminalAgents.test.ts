import { describe, expect, test } from "bun:test";
import type { AgentView } from "../../../src/projection/types.ts";
import { cycleTerminalAgent, filterTerminalAgents, orderTerminalAgents } from "./terminalAgents.ts";

const agent = (id: string, overrides: Partial<AgentView> = {}): AgentView => ({
  id,
  continuity: "proved",
  providerContinuity: "confirmed",
  executionPresence: "live",
  resumeCapability: "eligible",
  observationHealth: "fresh",
  displayName: id,
  displayNameSource: "provider",
  runtimeState: "working",
  runtimeStateSource: "mock",
  hostHealth: "live",
  lastSeenAt: 1_000,
  lastObservedAt: 1_000,
  lastChangedAt: 1_000,
  canResume: true,
  lifecycleState: "running",
  executionConflictCount: 0,
  ...overrides,
});

const atlas = agent("atlas", {
  displayName: "Atlas implementation",
  goalTitle: "Observatory UX",
  execution: { hostKind: "mock", nativeId: "opaque-atlas" },
});
const ledger = agent("ledger", {
  displayName: "Ledger polish",
  goalTitle: "Accessibility",
  execution: { hostKind: "herdr", nativeId: "opaque-ledger" },
});
const dormant = agent("dormant", {
  executionPresence: "absent",
  lifecycleState: "dormant",
});

describe("terminal agent switching", () => {
  test("lists observed executions in recent order without promoting dormant agents", () => {
    expect(orderTerminalAgents([atlas, dormant, ledger], ["ledger"]).map(({ id }) => id)).toEqual([
      "ledger",
      "atlas",
    ]);
  });

  test("keeps the open agent available when its latest execution observation disappears", () => {
    expect(orderTerminalAgents([atlas, dormant], [], dormant).map(({ id }) => id)).toEqual([
      "dormant",
      "atlas",
    ]);
  });

  test("filters by agent, Goal, lifecycle, or host and cycles in both directions", () => {
    const agents = [atlas, ledger];
    expect(filterTerminalAgents(agents, "access")).toEqual([ledger]);
    expect(filterTerminalAgents(agents, "HERDR")).toEqual([ledger]);
    expect(cycleTerminalAgent(agents, "atlas", 1)?.id).toBe("ledger");
    expect(cycleTerminalAgent(agents, "atlas", -1)?.id).toBe("ledger");
  });
});
