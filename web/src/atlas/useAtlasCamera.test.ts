import { describe, expect, test } from "bun:test";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import {
  AGENT_CARD_HEIGHT,
  AGENT_CARD_WIDTH,
  goalAgentPoints,
  goalLocalBounds,
} from "./atlasGeometry.ts";
import { fitAtlasBounds } from "./useAtlasCamera.ts";

const goalWithAgents = (count: number) => {
  const { universe, clock } = makeUniverse();
  universe.execute({ type: "CreateGoal", title: "Understand Concurrent Agent Work" });
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot(
      Array.from({ length: count }, (_, index) => ({
        nativeId: `pane-${index}`,
        displayName: `Agent ${index}`,
        runtimeState: "working" as const,
        runtimeStateSource: "test",
        hostLocator: `opaque:pane-${index}`,
        observedAt: clock.now(),
      })),
    ),
  );
  if (count > 0)
    universe.execute({
      type: "AssignAgents",
      goalId: "goal-1",
      agentIds: universe.snapshot().agents.map((agent) => agent.id),
    });
  const projection = universe.project({ kind: "universe-map", now: clock.now() });
  if (projection.kind !== "universe-map" || !projection.goals[0])
    throw new Error("Expected a Goal projection");
  return projection.goals[0];
};

describe("Atlas camera bounds", () => {
  test.each([1, 2, 10])("includes full orbit ellipses and %s Agent cards", (count) => {
    const goal = goalWithAgents(count);
    const bounds = goalLocalBounds(goal);
    for (const orbit of goalAgentPoints(goal, { x: 0, y: 0 })) {
      expect(bounds.left).toBeGreaterThanOrEqual(orbit.radiusX);
      expect(bounds.right).toBeGreaterThanOrEqual(orbit.radiusX);
      expect(bounds.top).toBeGreaterThanOrEqual(orbit.radiusY);
      expect(bounds.bottom).toBeGreaterThanOrEqual(orbit.radiusY);
      expect(bounds.left).toBeGreaterThanOrEqual(-orbit.x + AGENT_CARD_WIDTH / 2);
      expect(bounds.right).toBeGreaterThanOrEqual(orbit.x + AGENT_CARD_WIDTH / 2);
      expect(bounds.top).toBeGreaterThanOrEqual(-orbit.y + AGENT_CARD_HEIGHT / 2);
      expect(bounds.bottom).toBeGreaterThanOrEqual(orbit.y + AGENT_CARD_HEIGHT / 2);
    }
  });

  test.each([
    { width: 1440, height: 900, left: 0, right: 428 },
    { width: 1024, height: 668, left: 0, right: 428 },
    { width: 1440, height: 900, left: 430, right: 0 },
    { width: 1440, height: 900, left: 0, right: 0 },
  ])("fits a complete Goal within viewport and panel reservations %j", (size) => {
    const local = goalLocalBounds(goalWithAgents(10));
    const bounds = {
      minimumX: 9000 - local.left,
      maximumX: 9000 + local.right,
      minimumY: -9000 - local.top,
      maximumY: -9000 + local.bottom,
    };
    const camera = fitAtlasBounds(bounds, size, size.left, size.right, 1.45);
    expect(bounds.minimumX * camera.zoom + camera.panX).toBeGreaterThanOrEqual(size.left + 47.99);
    expect(bounds.maximumX * camera.zoom + camera.panX).toBeLessThanOrEqual(
      size.width - size.right - 47.99,
    );
    expect(bounds.minimumY * camera.zoom + camera.panY).toBeGreaterThanOrEqual(71.99);
    expect(bounds.maximumY * camera.zoom + camera.panY).toBeLessThanOrEqual(size.height - 71.99);
  });

  test("centres absolute world bounds without changing fit zoom under translation", () => {
    const size = { width: 1440, height: 900 };
    const bounds = { minimumX: -400, maximumX: 600, minimumY: -200, maximumY: 300 };
    const shifted = { minimumX: 8600, maximumX: 9600, minimumY: -9200, maximumY: -8700 };
    const first = fitAtlasBounds(bounds, size, 0, 428);
    const second = fitAtlasBounds(shifted, size, 0, 428);
    expect(second.zoom).toBe(first.zoom);
    expect(second.panX + 9000 * second.zoom).toBeCloseTo(first.panX);
    expect(second.panY - 9000 * second.zoom).toBeCloseTo(first.panY);
  });

  test("caps individual Agent focus at the readable zoom instead of filling the viewport", () => {
    const camera = fitAtlasBounds(
      {
        minimumX: -AGENT_CARD_WIDTH / 2 - 4,
        maximumX: AGENT_CARD_WIDTH / 2 + 4,
        minimumY: -AGENT_CARD_HEIGHT / 2 - 4,
        maximumY: AGENT_CARD_HEIGHT / 2 + 4,
      },
      { width: 1024, height: 668 },
      0,
      428,
      1.45,
    );
    expect(camera.zoom).toBe(1.45);
    expect(camera.panX).toBe((1024 - 428) / 2);
  });

  test("keeps a degenerate initial viewport finite", () => {
    const camera = fitAtlasBounds(
      { minimumX: 0, maximumX: 0, minimumY: 0, maximumY: 0 },
      { width: 0, height: 0 },
      0,
      428,
    );
    expect(Object.values(camera).every(Number.isFinite)).toBe(true);
    expect(camera.zoom).toBeGreaterThan(0);
  });
});
