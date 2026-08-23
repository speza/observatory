import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { createMockScenario } from "../hosts/mock/scenarios.ts";
import { FixedClock, makeUniverse } from "../universe/test-support.ts";
import type {
  PreparedWorkspace,
  WorkspaceProvider,
  WorkspaceSelection,
} from "../workspaces/types.ts";
import { createStartSessionCoordinator } from "./coordinator.ts";

class TestWorkspaceProvider implements WorkspaceProvider {
  listChoices() {
    return Effect.succeed([] as const);
  }

  prepare(_selection: WorkspaceSelection) {
    return Effect.succeed({
      path: "/synthetic/project",
      repository: "synthetic/project",
      branch: "main",
      worktree: false,
      warnings: [],
    } satisfies PreparedWorkspace);
  }
}

describe("session launch coordinator", () => {
  test("launches, reconciles and assigns a session exactly once", async () => {
    const clock = new FixedClock(60_000);
    const { universe } = makeUniverse({ clock });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    await Effect.runPromise(host.snapshot()).then((snapshot) => universe.reconcile(snapshot));
    const goal = universe.execute({ type: "CreateGoal", title: "Launch proof" });
    expect(goal.ok).toBe(true);
    const refresh = Effect.gen(function* () {
      const snapshot = yield* host.snapshot();
      const result = universe.reconcile(snapshot);
      return result.accepted ? "refreshed" : "rejected";
    });
    const coordinator = createStartSessionCoordinator({
      universe,
      host,
      workspace: new TestWorkspaceProvider(),
      refresh,
    });
    const intent = {
      requestId: "launch-coordinator-test",
      goal: { kind: "goal", goalId: goal.goalId! } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      agent: { kind: "codex" },
      sessionName: "coordinator session",
    };
    const first = await Effect.runPromise(coordinator.start(intent));
    expect(first.status).toBe("started");
    expect(first.sessionId).toBeDefined();
    expect(
      universe.snapshot().sessions.find((session) => session.id === first.sessionId)?.primaryGoalId,
    ).toBe(goal.goalId);
    const second = await Effect.runPromise(coordinator.start(intent));
    expect(second.status).toBe("already-observed");
    expect(
      universe.snapshot().sessions.filter((session) => session.provider === "codex"),
    ).toHaveLength(1);
  });
});
