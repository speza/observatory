import { describe, expect, test } from "bun:test";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { scopePortfolio } from "./scopedPortfolio.ts";
import { NO_SYSTEM_SCOPE, systemScopeForSelection } from "./systemScope.ts";
import { projectPortfolio } from "../../../src/web/portfolio.ts";
import { orderTerminalAgents } from "../terminal/terminalAgents.ts";

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
  test.each(["system-1", undefined])(
    "keeps archived live work named and actionable in scope %s",
    (systemId) => {
      const { universe, clock } = makeUniverse();
      universe.execute({ type: "CreateSystem", title: "Safety" });
      universe.execute({ type: "CreateSystem", title: "Other" });
      universe.execute({ type: "CreateGoal", title: "Archived context", systemId });
      admitObservedConversationsAndReconcile(
        universe,
        hostSnapshot([
          {
            nativeId: "live",
            displayName: "Safety worker",
            runtimeState: "blocked",
            runtimeStateSource: "test",
            hostLocator: "opaque:live",
            observedAt: clock.now(),
          },
        ]),
      );
      universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
      universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
      universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
      const current = projectPortfolio(universe, clock.now())!;
      const scope = systemId ?? NO_SYSTEM_SCOPE;
      expect(systemScopeForSelection({ type: "agent", id: "agent-1" }, current.commandCentre)).toBe(
        scope,
      );
      for (const selectedScope of [undefined, scope]) {
        const scoped = scopePortfolio(current, selectedScope);
        expect(scoped.commandCentre.counts).toMatchObject({ agents: 1, attention: 1, goals: 1 });
        expect(scoped.commandCentre.attention.currentCount).toBe(1);
        expect(scoped.map.goals[0]?.agents[0]?.id).toBe("agent-1");
        const agents = scoped.commandCentre.goals.flatMap((goal) => goal.agents);
        expect(orderTerminalAgents(agents, [])[0]).toMatchObject({
          id: "agent-1",
          displayName: "Safety worker",
          goalTitle: "Archived context",
          execution: { nativeId: "live" },
        });
      }
      expect(scopePortfolio(current, "system-2").commandCentre.counts).toMatchObject({
        agents: 0,
        attention: 0,
      });
      if (systemId)
        expect(
          current.commandCentre.systems.find((system) => system.id === systemId),
        ).toMatchObject({ agentCount: 1, attentionCount: 1 });

      const observed = hostSnapshot(
        [
          {
            nativeId: "live",
            displayName: "Safety worker",
            runtimeState: "working",
            runtimeStateSource: "test",
            hostLocator: "opaque:live",
            observedAt: clock.now() + 1,
          },
        ],
        clock.now() + 1,
      );
      const execution = observed.agents[0]!;
      universe.reconcile(observed);
      universe.reconcile({
        ...observed,
        agents: [execution, { ...execution, nativeId: "conflict", hostLocator: "opaque:conflict" }],
      });
      const uncertain = projectPortfolio(universe, clock.now() + 1)!;
      expect(scopePortfolio(uncertain, scope).workingAgentCount).toBe(0);
      expect(scopePortfolio(uncertain, undefined).workingAgentCount).toBe(0);
      expect(uncertain.commandCentre.goals[0]?.agents[0]?.executionPresence).toBe("conflict");
      if (systemId)
        expect(
          uncertain.commandCentre.systems.find((system) => system.id === systemId)?.workingCount,
        ).toBe(0);
    },
  );

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
