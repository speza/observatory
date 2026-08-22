import { describe, expect, test } from "bun:test";
import { makeUniverse, hostSnapshot } from "../universe/test-support.ts";

const observation = (
  nativeId: string,
  displayName: string,
  runtimeState: "idle" | "working" | "blocked" = "idle",
) => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "fixture",
  observedAt: 1_000_000,
  repository: "repo",
  branch: "main",
  worktree: "/sandbox/tree",
  provider: "fixture-provider",
  hostLocator: `opaque:${nativeId}`,
});

describe("projections", () => {
  test("keeps the command centre goal-centred and exposes the inbox", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "P0 goal", priority: "P0" });
    universe.execute({ type: "CreateGoal", title: "P2 goal", priority: "P2" });
    universe.reconcile(
      hostSnapshot([
        observation("p1", "blocked session", "blocked"),
        observation("p2", "unassigned"),
      ]),
    );
    universe.execute({
      type: "AssignSession",
      sessionId: "session-1",
      goalId: "goal-1",
    });
    const projection = universe.project({
      kind: "command-centre",
      now: 1_001_000,
    });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.goals[0]?.title).toBe("P0 goal");
    expect(projection.goals[0]?.sessions[0]?.displayName).toBe("blocked session");
    expect(projection.unassigned.map((session) => session.displayName)).toEqual(["unassigned"]);
    expect(projection.counts.attention).toBe(1);
  });

  test("searches accepted goal and session metadata, including archived goals", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "CreateGoal",
      title: "Archive candidate",
      description: "needle description",
    });
    universe.execute({ type: "CreateGoal", title: "Other" });
    universe.reconcile(hostSnapshot([observation("pane", "worker")]));
    universe.execute({
      type: "RenameSession",
      sessionId: "session-1",
      displayName: "Needle worker",
    });
    universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
    universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
    const projection = universe.project({
      kind: "search",
      query: "needle",
      now: 1_000_000,
    });
    if (projection.kind !== "search") throw new Error("wrong projection");
    expect(projection.results.map((result) => result.label)).toEqual([
      "Archive candidate",
      "Needle worker",
    ]);
  });

  test("inspector reports host facts without making infrastructure nodes", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Goal" });
    universe.reconcile(hostSnapshot([observation("pane", "worker")]));
    const projection = universe.project({
      kind: "inspector",
      target: { type: "session", id: "session-1" },
      now: 1_000_000,
    });
    if (projection.kind !== "session-inspector") throw new Error("wrong projection");
    expect(projection.session.hostKind).toBe("test-host");
    expect(projection.session.repository).toBe("repo");
    expect(projection.lines.join("\n")).toContain("worktree");
  });

  test("projects a stable portfolio of goal bodies and direct satellites", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Map goal", priority: "P0" });
    universe.reconcile(
      hostSnapshot([observation("pane-a", "satellite-a"), observation("pane-b", "satellite-b")]),
    );
    universe.execute({
      type: "AssignSession",
      sessionId: "session-1",
      goalId: "goal-1",
    });
    universe.execute({
      type: "AssignSession",
      sessionId: "session-2",
      goalId: "goal-1",
    });
    const first = universe.project({
      kind: "universe-map",
      now: 1_000_000,
    });
    const second = universe.project({
      kind: "universe-map",
      now: 1_000_000,
    });
    expect(first.kind).toBe("universe-map");
    expect(second.kind).toBe("universe-map");
    if (first.kind !== "universe-map" || second.kind !== "universe-map") return;
    expect(first.goals[0]?.mapPosition).toEqual(second.goals[0]?.mapPosition);
    expect(first.goals[0]?.radiusX).toBeGreaterThan(7);
    expect(first.goals[0]?.sessions).toHaveLength(2);
    expect(first.goals[0]?.sessions[0]?.mapPosition).toEqual(
      second.goals[0]?.sessions[0]?.mapPosition,
    );
    expect(first.goals[0]?.priority).toBe("P0");
  });

  test("projects unassigned sessions into a stable neutral inbox sector", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Map goal" });
    universe.reconcile(
      hostSnapshot([observation("assigned", "assigned"), observation("unassigned", "unassigned")]),
    );
    universe.execute({
      type: "AssignSession",
      sessionId: "session-1",
      goalId: "goal-1",
    });
    const first = universe.project({ kind: "universe-map", now: 1_000_000 });
    const second = universe.project({ kind: "universe-map", now: 1_000_000 });
    if (first.kind !== "universe-map" || second.kind !== "universe-map")
      throw new Error("wrong projection");
    expect(first.unassigned).toHaveLength(1);
    expect(first.inboxPosition).toEqual(second.inboxPosition);
    expect(first.unassigned[0]?.mapPosition).toEqual(second.unassigned[0]?.mapPosition);
    expect(first.unassigned[0]?.goalTitle).toBeUndefined();
  });
});
