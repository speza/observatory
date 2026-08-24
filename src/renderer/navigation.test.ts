import { describe, expect, test } from "bun:test";
import type { MapGoalView, MapAgentView, UniverseMapProjection } from "../projection/types.ts";
import {
  clockwiseAgents,
  mapSelectionCandidates,
  nextNavigationSelection,
  type NavigationSelection,
} from "./navigation.ts";

const agent = (id: string, x: number, y: number): MapAgentView => {
  const value: MapAgentView = {
    id,
    displayName: id,
    description: "",
    primaryGoalId: "goal-a",
    goalTitle: "Goal A",
    displayNameSource: "host",
    hostKind: "mock",
    hostHealth: "live",
    nativeId: id,
    runtimeState: "idle",
    runtimeStateSource: "mock",
    lastSeenAt: 0,
    provider: "mock",
    lastObservedAt: 0,
    lastChangedAt: 0,
    hostLocator: id,
    mapPosition: { x, y },
  };
  return value;
};

const goal = (agents: readonly MapAgentView[]): MapGoalView => {
  const value: MapGoalView = {
    id: "goal-a",
    title: "Goal A",
    description: "",
    priority: "P1",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    mapPosition: { x: 0, y: 0 },
    agents,
    attentionCount: 0,
    staleCount: 0,
    radiusX: 5,
    radiusY: 3,
  };
  return value;
};

const mapProjection = (goals: readonly MapGoalView[]): UniverseMapProjection => {
  const value: UniverseMapProjection = {
    kind: "universe-map",
    generatedAt: 0,
    host: undefined,
    attention: { items: [], currentCount: 0, uncertaintyCount: 0 },
    goals,
    unassigned: [],
    inboxPosition: { x: -100, y: 0 },
    counts: {
      goals: goals.length,
      agents: goals.reduce((total, current) => total + current.agents.length, 0),
      attention: 0,
      uncertainty: 0,
      unassigned: 0,
      stale: 0,
    },
  };
  return value;
};

describe("map navigation", () => {
  test("orders focused goal agents clockwise from the top", () => {
    const focused = goal([
      agent("left", -1, 0),
      agent("bottom", 0, 1),
      agent("top", 0, -1),
      agent("right", 1, 0),
    ]);
    expect(clockwiseAgents(focused).map((item) => item.id)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
  });

  test("keeps portfolio navigation on goals and focused navigation on agents", () => {
    const focused = goal([agent("agent-a", 0, -1), agent("agent-b", 1, 0)]);
    const projection = mapProjection([focused]);
    expect(mapSelectionCandidates(projection, "portfolio", undefined)).toEqual([
      { type: "goal", id: "goal-a" },
    ]);
    expect(mapSelectionCandidates(projection, "goal", "goal-a")).toEqual([
      { type: "agent", id: "agent-a" },
      { type: "agent", id: "agent-b" },
    ]);
  });

  test("wraps selection and chooses the nearest end when entering a lens", () => {
    const candidates: readonly NavigationSelection[] = [
      { type: "agent", id: "top" },
      { type: "agent", id: "right" },
      { type: "agent", id: "bottom" },
    ];
    expect(nextNavigationSelection(candidates, candidates[2], 1)).toEqual(candidates[0]);
    expect(nextNavigationSelection(candidates, candidates[0], -1)).toEqual(candidates[2]);
    expect(nextNavigationSelection(candidates, { type: "goal", id: "other" }, 1)).toEqual(
      candidates[0],
    );
    expect(nextNavigationSelection(candidates, { type: "goal", id: "other" }, -1)).toEqual(
      candidates[2],
    );
  });
});
