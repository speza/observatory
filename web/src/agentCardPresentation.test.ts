import { describe, expect, test } from "bun:test";
import type { MapAgentView } from "../../src/projection/types.ts";
import { agentTitleLines, presentAgentCard } from "./agentCardPresentation.ts";

const agent = (overrides: Partial<MapAgentView> = {}): MapAgentView => ({
  id: "agent-1",
  continuity: "proved",
  providerContinuity: "confirmed",
  executionPresence: "live",
  resumeCapability: "eligible",
  observationHealth: "fresh",
  providerObservedAt: 1_000,
  executionObservedAt: 1_000,
  displayName: "Checkout provider-native-observations",
  displayNameSource: "provider",
  runtimeState: "working",
  runtimeStateSource: "mock",
  hostHealth: "live",
  lastSeenAt: 1_000,
  lastObservedAt: 1_000,
  lastChangedAt: 1_000,
  repository: "/work/ao",
  branch: "main",
  canResume: true,
  lifecycleState: "running",
  executionConflictCount: 0,
  mapPosition: { x: 0, y: 0 },
  ...overrides,
});

describe("agent card presentation", () => {
  test("wraps a hyphenated title without clipping its meaning", () => {
    expect(agentTitleLines("Checkout provider-native-observations")).toEqual([
      "Checkout provider-native-",
      "observations",
    ]);
  });

  test("surfaces current provider activity and freshness without treating it as state", () => {
    expect(
      presentAgentCard(
        agent({
          providerEvidence: {
            providerLabel: "Codex",
            health: "healthy",
            ageMs: 4_000,
            activity: "using-tool",
            toolCategory: "execute",
            supportedKinds: ["activity"],
          },
        }),
      ),
    ).toEqual({
      identity: "SESSION",
      titleLines: ["Checkout provider-native-", "observations"],
      detail: "Observed: executing a command · now",
      context: "ao · main",
    });
  });

  test("prioritises an observed human request over background activity", () => {
    expect(
      presentAgentCard(
        agent({
          providerEvidence: {
            providerLabel: "Codex",
            health: "healthy",
            ageMs: 65_000,
            activity: "using-tool",
            toolCategory: "execute",
            request: { kind: "permission", state: "open" },
            supportedKinds: ["activity", "human-input-request"],
          },
        }),
      ).detail,
    ).toBe("Observed: permission needed · 1m ago");
  });

  test("keeps stale provider evidence explicitly uncertain", () => {
    expect(
      presentAgentCard(
        agent({
          providerEvidence: {
            providerLabel: "Codex",
            health: "stale",
            ageMs: 480_000,
            supportedKinds: ["activity"],
          },
        }),
      ).detail,
    ).toBe("Provider observation stale · 8m ago");
  });

  test("uses the durable description when no current provider observation exists", () => {
    expect(
      presentAgentCard(agent({ description: "Maps host facts to semantic state." })).detail,
    ).toBe("Maps host facts to semantic state.");
  });

  test("keeps accepted attention ahead of routine provider activity", () => {
    expect(
      presentAgentCard(
        agent({
          attention: {
            id: "agent-1:blocked",
            targetType: "agent",
            targetId: "agent-1",
            agentId: "agent-1",
            reason: "blocked",
            requiresHumanInput: true,
            startedAt: 1_000,
            lastChangedAt: 1_000,
            ageMs: 120_000,
            priority: "P1",
            runtimeState: "blocked",
            explanation: "The host reports that this agent is blocked.",
          },
          providerEvidence: {
            providerLabel: "Codex",
            health: "healthy",
            ageMs: 2_000,
            activity: "using-tool",
            toolCategory: "execute",
            supportedKinds: ["activity"],
          },
        }),
      ).detail,
    ).toBe("Blocked · may need input · 2m");
  });
});
