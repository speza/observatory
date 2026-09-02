import { describe, expect, test } from "bun:test";
import { hostSnapshot, makeUniverse } from "../../../src/universe/test-support.ts";
import { NO_SYSTEM_SCOPE, systemScopeForSelection } from "./systemScope.ts";

const fixture = makeUniverse();
fixture.universe.execute({ type: "CreateSystem", title: "Observatory" });
fixture.universe.execute({
  type: "CreateGoal",
  title: "Grouped goal",
  systemId: "system-1",
});
fixture.universe.execute({ type: "CreateGoal", title: "Ungrouped goal" });
fixture.universe.reconcile(
  hostSnapshot([
    {
      nativeId: "assigned",
      displayName: "Assigned agent",
      runtimeState: "working",
      runtimeStateSource: "test",
      hostLocator: "test:assigned",
      observedAt: fixture.clock.now(),
    },
    {
      nativeId: "unassigned",
      displayName: "Unassigned agent",
      runtimeState: "idle",
      runtimeStateSource: "test",
      hostLocator: "test:unassigned",
      observedAt: fixture.clock.now(),
    },
  ]),
);
fixture.universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
const projection = fixture.universe.project({
  kind: "command-centre",
  now: fixture.clock.now(),
});
if (projection.kind !== "command-centre") throw new Error("Expected command centre.");

describe("systemScopeForSelection", () => {
  test("finds the visible Atlas scope for goals and agents", () => {
    expect(systemScopeForSelection({ type: "goal", id: "goal-1" }, projection)).toBe("system-1");
    expect(systemScopeForSelection({ type: "agent", id: "agent-1" }, projection)).toBe("system-1");
    expect(systemScopeForSelection({ type: "goal", id: "goal-2" }, projection)).toBe(
      NO_SYSTEM_SCOPE,
    );
    expect(systemScopeForSelection({ type: "agent", id: "agent-2" }, projection)).toBe(
      NO_SYSTEM_SCOPE,
    );
    expect(systemScopeForSelection({ type: "agent", id: "missing" }, projection)).toBeUndefined();
  });
});
