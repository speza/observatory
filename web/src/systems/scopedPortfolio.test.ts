import { describe, expect, test } from "bun:test";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { scopePortfolio } from "./scopedPortfolio.ts";
import { NO_SYSTEM_SCOPE } from "./systemScope.ts";

const fixture = makeUniverse();
fixture.universe.execute({ type: "CreateSystem", title: "Observatory" });
fixture.universe.execute({ type: "CreateGoal", title: "Grouped", systemId: "system-1" });
fixture.universe.execute({ type: "CreateGoal", title: "Ungrouped" });
admitObservedConversationsAndReconcile(
  fixture.universe,
  hostSnapshot([
    {
      nativeId: "grouped",
      displayName: "Grouped agent",
      runtimeState: "working",
      runtimeStateSource: "test",
      hostLocator: "test:grouped",
      observedAt: fixture.clock.now(),
    },
    {
      nativeId: "ungrouped",
      displayName: "Ungrouped agent",
      runtimeState: "idle",
      runtimeStateSource: "test",
      hostLocator: "test:ungrouped",
      observedAt: fixture.clock.now(),
    },
  ]),
);
fixture.universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
fixture.universe.execute({ type: "AssignAgent", agentId: "agent-2", goalId: "goal-2" });
const map = fixture.universe.project({ kind: "universe-map", now: fixture.clock.now() });
const commandCentre = fixture.universe.project({
  kind: "command-centre",
  now: fixture.clock.now(),
});
const catchUp = fixture.universe.project({ kind: "catch-up", now: fixture.clock.now() });
if (
  map.kind !== "universe-map" ||
  commandCentre.kind !== "command-centre" ||
  catchUp.kind !== "catch-up"
)
  throw new Error("Expected portfolio projections.");
const portfolio = { map, commandCentre, catchUp };

describe("scopePortfolio", () => {
  test("keeps the map, lens counts, and working count in one System scope", () => {
    const scoped = scopePortfolio(portfolio, "system-1");

    expect(scoped.commandCentre.goals.map((goal) => goal.id)).toEqual(["goal-1"]);
    expect(scoped.map.goals.map((goal) => goal.id)).toEqual(["goal-1"]);
    expect(scoped.commandCentre.counts.goals).toBe(1);
    expect(scoped.commandCentre.counts.agents).toBe(1);
    expect(scoped.workingAgentCount).toBe(1);
  });

  test("represents ungrouped Goals as an explicit scope", () => {
    const scoped = scopePortfolio(portfolio, NO_SYSTEM_SCOPE);

    expect(scoped.commandCentre.systems).toEqual([]);
    expect(scoped.commandCentre.goals.map((goal) => goal.id)).toEqual(["goal-2"]);
    expect(scoped.map.goals.map((goal) => goal.id)).toEqual(["goal-2"]);
    expect(scoped.workingAgentCount).toBe(0);
  });
});
