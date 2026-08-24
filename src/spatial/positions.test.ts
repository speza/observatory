import { describe, expect, test } from "bun:test";
import {
  defaultGoalMapPosition,
  goalLayoutFootprint,
  initialGoalMapPosition,
  mapInboxAnchor,
  agentSatellitePosition,
  agentSatellitePositions,
  unassignedAgentPosition,
  unassignedAgentPositions,
} from "./positions.ts";

const goalOccupancy = (...positions: readonly { x: number; y: number }[]) =>
  positions.map((position) => ({ position, agentCount: 0 }));

describe("spatial positions", () => {
  test("is deterministic for durable goal and agent identities", () => {
    expect(defaultGoalMapPosition("goal-a")).toEqual(defaultGoalMapPosition("goal-a"));
    expect(agentSatellitePosition({ x: 4, y: -3 }, "goal-a", "agent-a", 0, 3)).toEqual(
      agentSatellitePosition({ x: 4, y: -3 }, "goal-a", "agent-a", 0, 3),
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

  test("keeps satellite cards separated when agents share a goal", () => {
    const agentIds = Array.from({ length: 12 }, (_, index) => `agent-${index}`);
    const first = agentSatellitePositions({ x: 0, y: 0 }, "goal-a", agentIds);
    const second = agentSatellitePositions({ x: 0, y: 0 }, "goal-a", [...agentIds, "agent-z"]);
    expect(new Set([...first.values()].map((position) => `${position.x}:${position.y}`)).size).toBe(
      agentIds.length,
    );
    expect(second.get("agent-0")).toEqual(first.get("agent-0"));
    expect(second.get("agent-11")).toEqual(first.get("agent-11"));
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
    const second = initialGoalMapPosition("goal-b", [{ position: first, agentCount: 20 }], 0);
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
    expect(unassignedAgentPosition(anchor, "agent-a")).toEqual(
      unassignedAgentPosition(anchor, "agent-a"),
    );
    expect(unassignedAgentPosition(anchor, "agent-a")).not.toEqual(
      unassignedAgentPosition(anchor, "agent-b"),
    );
  });

  test("keeps a twenty-agent inbox as a stable expanding orbit", () => {
    const anchor = mapInboxAnchor([
      { x: 45, y: 0 },
      { x: 13, y: -24 },
    ]);
    const ids = Array.from({ length: 20 }, (_, index) => `agent-${index}`);
    const positions = unassignedAgentPositions(anchor, ids);
    expect(
      new Set([...positions.values()].map((position) => `${position.x}:${position.y}`)).size,
    ).toBe(ids.length);
    expect(
      [...positions.values()].some(
        (position) => Math.abs(position.x - anchor.x) > 72 || Math.abs(position.y - anchor.y) > 32,
      ),
    ).toBe(true);
    const expanded = unassignedAgentPositions(anchor, [...ids, "agent-z"]);
    expect(expanded.get("agent-0")).toEqual(positions.get("agent-0"));
    expect(expanded.get("agent-19")).toEqual(positions.get("agent-19"));
  });
});
