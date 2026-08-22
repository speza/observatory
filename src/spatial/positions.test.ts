import { describe, expect, test } from "bun:test";
import {
  defaultGoalMapPosition,
  goalLayoutFootprint,
  initialGoalMapPosition,
  mapInboxAnchor,
  sessionSatellitePosition,
  sessionSatellitePositions,
  unassignedSessionPosition,
  unassignedSessionPositions,
} from "./positions.ts";

const goalOccupancy = (...positions: readonly { x: number; y: number }[]) =>
  positions.map((position) => ({ position, sessionCount: 0 }));

describe("spatial positions", () => {
  test("is deterministic for durable goal and session identities", () => {
    expect(defaultGoalMapPosition("goal-a")).toEqual(defaultGoalMapPosition("goal-a"));
    expect(sessionSatellitePosition({ x: 4, y: -3 }, "goal-a", "session-a", 0, 3)).toEqual(
      sessionSatellitePosition({ x: 4, y: -3 }, "goal-a", "session-a", 0, 3),
    );
  });

  test("does not move occupied initial goal slots when a new goal arrives", () => {
    const first = initialGoalMapPosition("goal-a", []);
    const second = initialGoalMapPosition("goal-b", goalOccupancy(first));
    const third = initialGoalMapPosition("goal-c", goalOccupancy(first, second));
    expect(second).not.toEqual(first);
    expect(third).not.toEqual(first);
    expect(third).not.toEqual(second);
  });

  test("keeps satellite cards separated when sessions share a goal", () => {
    const sessionIds = Array.from({ length: 12 }, (_, index) => `session-${index}`);
    const first = sessionSatellitePositions({ x: 0, y: 0 }, "goal-a", sessionIds);
    const second = sessionSatellitePositions({ x: 0, y: 0 }, "goal-a", [
      ...sessionIds,
      "session-z",
    ]);
    expect(new Set([...first.values()].map((position) => `${position.x}:${position.y}`)).size).toBe(
      sessionIds.length,
    );
    expect(second.get("session-0")).toEqual(first.get("session-0"));
    expect(second.get("session-11")).toEqual(first.get("session-11"));
  });

  test("keeps the first compact portfolio in one legible viewport row", () => {
    const first = initialGoalMapPosition("goal-a", []);
    const second = initialGoalMapPosition("goal-b", goalOccupancy(first));
    const third = initialGoalMapPosition("goal-c", goalOccupancy(first, second));
    expect([first.y, second.y, third.y]).toEqual([0, 0, 0]);
    expect(new Set([first.x, second.x, third.x]).size).toBe(3);
  });

  test("routes a new goal around the footprint of a loaded goal", () => {
    const first = initialGoalMapPosition("goal-a", []);
    const second = initialGoalMapPosition("goal-b", [{ position: first, sessionCount: 20 }], 0);
    const firstFootprint = goalLayoutFootprint(20);
    const secondFootprint = goalLayoutFootprint(0);
    expect(
      Math.abs(second.x - first.x) >= firstFootprint.halfWidth + secondFootprint.halfWidth + 16 ||
        Math.abs(second.y - first.y) >= firstFootprint.halfHeight + secondFootprint.halfHeight + 12,
    ).toBe(true);
  });

  test("keeps the unassigned inbox stable outside the goal row", () => {
    const anchor = mapInboxAnchor([{ x: 0, y: 0 }]);
    expect(anchor).toEqual({ x: -144, y: 0 });
    expect(unassignedSessionPosition(anchor, "session-a")).toEqual(
      unassignedSessionPosition(anchor, "session-a"),
    );
    expect(unassignedSessionPosition(anchor, "session-a")).not.toEqual(
      unassignedSessionPosition(anchor, "session-b"),
    );
  });

  test("keeps a twenty-session inbox as a stable expanding orbit", () => {
    const anchor = mapInboxAnchor([
      { x: 45, y: 0 },
      { x: 13, y: -24 },
    ]);
    const ids = Array.from({ length: 20 }, (_, index) => `session-${index}`);
    const positions = unassignedSessionPositions(anchor, ids);
    expect(
      new Set([...positions.values()].map((position) => `${position.x}:${position.y}`)).size,
    ).toBe(ids.length);
    expect(
      [...positions.values()].some(
        (position) => Math.abs(position.x - anchor.x) > 72 || Math.abs(position.y - anchor.y) > 32,
      ),
    ).toBe(true);
    const expanded = unassignedSessionPositions(anchor, [...ids, "session-z"]);
    expect(expanded.get("session-0")).toEqual(positions.get("session-0"));
    expect(expanded.get("session-19")).toEqual(positions.get("session-19"));
  });
});
