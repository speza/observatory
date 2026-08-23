import { describe, expect, test } from "bun:test";
import { makeUniverse, hostSnapshot } from "./test-support.ts";

const observation = (
  nativeId: string,
  displayName = nativeId,
  runtimeState: "idle" | "working" | "waiting" | "blocked" | "done" | "unknown" = "idle",
  observedAt = 1_000_000,
) => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "test-host",
  observedAt,
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

  test("rejects out-of-order snapshots without regressing accepted state", () => {
    const { universe } = makeUniverse();
    universe.reconcile(
      hostSnapshot([observation("pane-1", "newer", "blocked", 2_000_000)], 2_000_000),
    );
    const older = universe.reconcile(
      hostSnapshot([observation("pane-1", "older", "idle", 1_000_000)], 1_000_000),
    );
    expect(older.accepted).toBe(false);
    expect(older.error).toContain("Out-of-order");
    expect(universe.snapshot().sessions[0]?.runtimeState).toBe("blocked");
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(2_000_000);
  });

  test("ignores an older session observation inside a newer snapshot", () => {
    const { universe } = makeUniverse();
    universe.reconcile(
      hostSnapshot([observation("pane-1", "newer", "blocked", 2_000_000)], 2_000_000),
    );
    const result = universe.reconcile(
      hostSnapshot([observation("pane-1", "older", "idle", 1_000_000)], 3_000_000),
    );
    expect(result.accepted).toBe(true);
    expect(result.updatedSessionIds).toHaveLength(0);
    expect(result.diagnostics.join(" ")).toContain("Ignored an older observation");
    expect(universe.snapshot().sessions[0]?.runtimeState).toBe("blocked");
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(3_000_000);
  });

  test("preserves host observation age while the host is unavailable", () => {
    const { universe } = makeUniverse();
    universe.reconcile(hostSnapshot([observation("pane-1")], 1_000_000));
    universe.reconcile({
      hostKind: "test-host",
      available: false,
      observedAt: 1_010_000,
      sessions: [],
      diagnostics: [],
      error: "socket unavailable",
    });
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(1_000_000);
    const projection = universe.project({ kind: "command-centre", now: 1_010_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.attention.items.find((item) => item.targetType === "host")?.ageMs).toBe(
      10_000,
    );
  });

  test("normalizes native identities at the reconciliation boundary", () => {
    const { universe } = makeUniverse();
    universe.reconcile(hostSnapshot([observation(" pane-1 ", "first")], 1_000_000));
    universe.reconcile(
      hostSnapshot([observation("pane-1", "second", "idle", 1_001_000)], 1_001_000),
    );
    expect(universe.snapshot().sessions).toHaveLength(1);
    expect(universe.snapshot().sessions[0]?.nativeId).toBe("pane-1");
  });

  test("archives stale sessions without deleting their identity or assignment", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Keep the context" });
    universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));
    universe.execute({
      type: "AssignSession",
      sessionId: "session-2",
      goalId: "goal-1",
    });
    expect(universe.execute({ type: "ArchiveSession", sessionId: "session-1" })).toEqual({
      ok: false,
      error: "Only stale or unavailable sessions can be archived.",
    });

    clock.value = 1_001_000;
    universe.reconcile(hostSnapshot([observation("pane-2")], clock.value));
    expect(universe.execute({ type: "ArchiveSession", sessionId: "session-1" })).toEqual({
      ok: true,
      sessionId: "session-1",
    });
    const archived = universe.snapshot().sessions.find((session) => session.id === "session-1");
    expect(archived?.archivedAt).toBe(clock.value);

    const active = universe.project({ kind: "command-centre", now: clock.value });
    if (active.kind !== "command-centre") throw new Error("wrong projection");
    expect(active.unassigned.map((session) => session.id)).toEqual([]);
    expect(active.goals[0]?.sessions.map((session) => session.id)).toEqual(["session-2"]);
    expect(active.counts.stale).toBe(0);
    expect(active.counts.uncertainty).toBe(0);

    clock.value = 1_002_000;
    universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")], clock.value));
    const rediscovered = universe.snapshot().sessions.find((session) => session.id === "session-1");
    expect(rediscovered?.hostHealth).toBe("live");
    expect(rediscovered?.archivedAt).toBe(1_001_000);
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
