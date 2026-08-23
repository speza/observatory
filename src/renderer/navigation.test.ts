import { describe, expect, test } from "bun:test";
import type { MapGoalView, MapSessionView, UniverseMapProjection } from "../projection/types.ts";
import {
  clockwiseSessions,
  mapSelectionCandidates,
  nextNavigationSelection,
  type NavigationSelection,
} from "./navigation.ts";

const session = (id: string, x: number, y: number): MapSessionView => {
  const value: MapSessionView = {
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

const goal = (sessions: readonly MapSessionView[]): MapGoalView => {
  const value: MapGoalView = {
    id: "goal-a",
    title: "Goal A",
    description: "",
    priority: "P1",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    mapPosition: { x: 0, y: 0 },
    sessions,
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
      sessions: goals.reduce((total, current) => total + current.sessions.length, 0),
      attention: 0,
      uncertainty: 0,
      unassigned: 0,
      stale: 0,
    },
  };
  return value;
};

describe("map navigation", () => {
  test("orders focused goal sessions clockwise from the top", () => {
    const focused = goal([
      session("left", -1, 0),
      session("bottom", 0, 1),
      session("top", 0, -1),
      session("right", 1, 0),
    ]);
    expect(clockwiseSessions(focused).map((item) => item.id)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
  });

  test("keeps portfolio navigation on goals and focused navigation on sessions", () => {
    const focused = goal([session("session-a", 0, -1), session("session-b", 1, 0)]);
    const projection = mapProjection([focused]);
    expect(mapSelectionCandidates(projection, "portfolio", undefined)).toEqual([
      { type: "goal", id: "goal-a" },
    ]);
    expect(mapSelectionCandidates(projection, "goal", "goal-a")).toEqual([
      { type: "session", id: "session-a" },
      { type: "session", id: "session-b" },
    ]);
  });

  test("wraps selection and chooses the nearest end when entering a lens", () => {
    const candidates: readonly NavigationSelection[] = [
      { type: "session", id: "top" },
      { type: "session", id: "right" },
      { type: "session", id: "bottom" },
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
