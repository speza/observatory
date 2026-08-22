import { describe, expect, test } from "bun:test";
import { makeUniverse, hostSnapshot } from "./test-support.ts";

const observation = (
  nativeId: string,
  displayName = nativeId,
  runtimeState: "idle" | "working" | "waiting" | "blocked" | "done" | "unknown" = "idle",
) => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "test-host",
  observedAt: 1_000_000,
  repository: "repo",
  branch: "main",
  worktree: `/worktrees/${nativeId}`,
  provider: "test-provider",
  hostLocator: `opaque:${nativeId}`,
});

describe("Universe", () => {
  test("enforces goal lifecycle and direct assignment through its interface", () => {
    const { universe, clock } = makeUniverse();
    expect(
      universe.execute({
        type: "CreateGoal",
        title: "  Ship the slice  ",
        priority: "P0",
        description: "Walk the live path.",
      }),
    ).toEqual({ ok: true, goalId: "goal-1" });
    expect(
      universe.reconcile(hostSnapshot([observation("pane-1", "live session", "working")])).accepted,
    ).toBe(true);
    expect(
      universe.execute({
        type: "AssignSession",
        sessionId: "session-1",
        goalId: "goal-1",
      }).ok,
    ).toBe(true);
    expect(
      universe.execute({
        type: "RenameGoal",
        goalId: "goal-1",
        title: "Ship it",
      }).ok,
    ).toBe(true);
    expect(
      universe.execute({
        type: "SetGoalPriority",
        goalId: "goal-1",
        priority: "P1",
      }).ok,
    ).toBe(true);
    clock.value = 1_001_000;
    expect(universe.execute({ type: "CompleteGoal", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.status).toBe("completed");
    expect(universe.execute({ type: "ArchiveGoal", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.status).toBe("archived");
  });

  test("keeps deterministic goal placement and persists pinned movement", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "First" });
    universe.execute({ type: "CreateGoal", title: "Second" });
    const before = universe.snapshot().goals.map((goal) => goal.mapPosition);
    expect(before[0]).toBeDefined();
    expect(before[1]).toBeDefined();
    expect(before[0]).not.toEqual(before[1]);
    expect(
      universe.execute({
        type: "SetGoalMapPosition",
        goalId: "goal-1",
        position: { x: 42.4, y: -17.2 },
      }),
    ).toEqual({ ok: true, goalId: "goal-1" });
    const moved = universe.snapshot().goals[0];
    expect(moved?.mapPosition).toEqual({ x: 42, y: -17 });
    expect(moved?.mapPositionPinned).toBe(true);
    expect(universe.execute({ type: "ResetGoalMapPosition", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.mapPositionPinned).toBe(false);
  });

  test("does not allow assignment to an archived goal", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Old goal" });
    universe.reconcile(hostSnapshot([observation("pane-1")]));
    universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
    universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
    expect(
      universe.execute({
        type: "AssignSession",
        sessionId: "session-1",
        goalId: "goal-1",
      }),
    ).toEqual({ ok: false, error: "Archived goals cannot receive sessions." });
  });

  test("preserves human session metadata across reconciliation", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Goal" });
    universe.reconcile(hostSnapshot([observation("pane-1", "host title", "working")]));
    universe.execute({
      type: "AssignSession",
      sessionId: "session-1",
      goalId: "goal-1",
    });
    universe.execute({
      type: "RenameSession",
      sessionId: "session-1",
      displayName: "My accepted name",
    });
    universe.execute({
      type: "SetSessionDescription",
      sessionId: "session-1",
      description: "Human context",
    });
    clock.value = 1_002_000;
    universe.reconcile(
      hostSnapshot(
        [
          {
            ...observation("pane-1", "new host title", "blocked"),
            observedAt: 1_002_000,
          },
        ],
        1_002_000,
      ),
    );
    const session = universe.snapshot().sessions[0];
    expect(session?.displayName).toBe("My accepted name");
    expect(session?.description).toBe("Human context");
    expect(session?.primaryGoalId).toBe("goal-1");
    expect(session?.runtimeState).toBe("blocked");
  });

  test("is idempotent and marks missing live sessions stale", () => {
    const { universe } = makeUniverse();
    const first = universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));
    const second = universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));
    expect(first.addedSessionIds).toHaveLength(2);
    expect(second.addedSessionIds).toHaveLength(0);
    expect(universe.snapshot().sessions).toHaveLength(2);
    const stale = universe.reconcile(hostSnapshot([observation("pane-1")], 1_001_000));
    expect(stale.staleSessionIds).toEqual(["session-2"]);
    expect(
      universe.snapshot().sessions.find((session) => session.nativeId === "pane-2")?.hostHealth,
    ).toBe("stale");
  });

  test("rejects duplicate native identities without guessing", () => {
    const { universe } = makeUniverse();
    const result = universe.reconcile(hostSnapshot([observation("same"), observation("same")]));
    expect(result.accepted).toBe(false);
    expect(result.error).toContain("Duplicate native identity");
    expect(universe.snapshot().sessions).toHaveLength(0);
  });

  test("rolls back a command when persistence fails", () => {
    const { universe, store } = makeUniverse();
    store.failNextSave = true;
    expect(universe.execute({ type: "CreateGoal", title: "Must not appear" }).ok).toBe(false);
    expect(universe.snapshot().goals).toHaveLength(0);
  });
});
