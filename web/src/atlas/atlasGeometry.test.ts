import { describe, expect, test } from "bun:test";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { goalAgentPoints } from "./atlasGeometry.ts";

const agentIdByNativeId = (
  universe: ReturnType<typeof makeUniverse>["universe"],
  nativeId: string,
): string => {
  const agent = universe
    .snapshot()
    .agents.find((candidate) => candidate.execution?.nativeId === nativeId);
  if (!agent) throw new Error(`Missing Agent for ${nativeId}`);
  return agent.id;
};

describe("Atlas lineage geometry", () => {
  test("keeps a declared family on one orbit and in adjacent slots", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Fan-out" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        ["parent", "child-a", "child-b", "child-c", "other"].map((nativeId) => ({
          nativeId,
          displayName: nativeId,
          runtimeState: "working" as const,
          runtimeStateSource: "test",
          hostLocator: `opaque:${nativeId}`,
          observedAt: clock.now(),
        })),
      ),
    );
    const parentId = agentIdByNativeId(universe, "parent");
    const childIds = ["child-a", "child-b", "child-c"].map((nativeId) =>
      agentIdByNativeId(universe, nativeId),
    );
    for (const childAgentId of childIds) {
      const linked = universe.execute({
        type: "SetAgentSpawnParent",
        childAgentId,
        parentAgentId: parentId,
      });
      expect(linked.ok).toBe(true);
    }
    const otherId = agentIdByNativeId(universe, "other");
    expect(
      universe.execute({
        type: "AssignAgents",
        agentIds: [parentId, ...childIds, otherId],
        goalId: "goal-1",
      }).ok,
    ).toBe(true);

    const projection = universe.project({ kind: "universe-map", now: clock.now() });
    if (projection.kind !== "universe-map" || !projection.goals[0])
      throw new Error("Expected a Goal map projection");
    const goal = projection.goals[0];
    const points = goalAgentPoints(goal, { x: 0, y: 0 }, parentId);
    const indexById = new Map(goal.agents.map((agent, index) => [agent.id, index] as const));
    const familyIndexes = [parentId, ...childIds].map((id) => indexById.get(id) ?? -1);
    expect(familyIndexes.every((index) => index >= 0)).toBe(true);

    const parentPoint = points[familyIndexes[0] ?? -1];
    if (!parentPoint) throw new Error("Missing parent orbit placement");
    for (const index of familyIndexes) expect(points[index]?.band).toBe(parentPoint.band);
    // Children leave the goal ring and cluster in a fan beside the parent.
    for (const index of familyIndexes.slice(1)) {
      const point = points[index];
      if (!point) throw new Error("Missing child orbit placement");
      expect(Math.hypot(point.x - parentPoint.x, point.y - parentPoint.y)).toBeLessThanOrEqual(600);
    }
  });
});
