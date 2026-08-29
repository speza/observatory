import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockHostAdapter } from "../../src/hosts/mock/adapter.ts";
import { createMockScenario } from "../../src/hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "../../src/hosts/mock/seed.ts";
import { FixedClock, hostSnapshot, makeUniverse } from "../../src/universe/test-support.ts";
import type { Projection, UniverseMapProjection } from "../../src/projection/types.ts";
import { Atlas, focusedLabelOffsets } from "./Atlas.tsx";
import { atlasContentBounds, atlasGoalSpacingScale } from "./atlasGeometry.ts";

interface RenderedGoal {
  readonly id: string;
  readonly radius: number;
  readonly x: number;
  readonly y: number;
}

interface RenderedAgent {
  readonly goalId: string;
  readonly orbitRadiusX: number;
  readonly orbitRadiusY: number;
  readonly x: number;
  readonly y: number;
}

const mapProjection = (projection: Projection): UniverseMapProjection => {
  if (projection.kind !== "universe-map") throw new Error("Expected a universe-map projection.");
  return projection;
};

const renderedGoals = (markup: string): readonly RenderedGoal[] =>
  Array.from(
    markup.matchAll(
      /data-goal-id="([^"]+)" data-radius="([^"]+)" data-screen-x="([^"]+)" data-screen-y="([^"]+)"/gu,
    ),
    (match) => ({
      id: match[1] ?? "",
      radius: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
    }),
  );

const renderedAgents = (markup: string): readonly RenderedAgent[] =>
  Array.from(
    markup.matchAll(
      /data-agent-id="[^"]+" data-parent-goal-id="([^"]+)" data-screen-x="([^"]+)" data-screen-y="([^"]+)" data-orbit-rx="([^"]+)" data-orbit-ry="([^"]+)"/gu,
    ),
    (match) => ({
      goalId: match[1] ?? "",
      x: Number(match[2]),
      y: Number(match[3]),
      orbitRadiusX: Number(match[4]),
      orbitRadiusY: Number(match[5]),
    }),
  );

describe("production web Atlas", () => {
  test("places every focused agent label in collision-free side columns", () => {
    const candidates = [
      { id: "left-a", labelOnLeft: true, rect: { left: 0, right: 90, top: 10, bottom: 42 } },
      { id: "left-b", labelOnLeft: true, rect: { left: 2, right: 92, top: 20, bottom: 52 } },
      { id: "left-c", labelOnLeft: true, rect: { left: 4, right: 94, top: 30, bottom: 62 } },
      { id: "right-a", labelOnLeft: false, rect: { left: 200, right: 290, top: 14, bottom: 46 } },
      { id: "right-b", labelOnLeft: false, rect: { left: 202, right: 292, top: 24, bottom: 56 } },
    ] as const;
    const offsets = focusedLabelOffsets(candidates);

    expect(offsets.size).toBe(candidates.length);
    for (const labelOnLeft of [true, false]) {
      const column = candidates
        .filter((candidate) => candidate.labelOnLeft === labelOnLeft)
        .map((candidate) => ({
          top: candidate.rect.top + (offsets.get(candidate.id) ?? 0),
          bottom: candidate.rect.bottom + (offsets.get(candidate.id) ?? 0),
        }))
        .sort((left, right) => left.top - right.top);
      for (let index = 1; index < column.length; index += 1) {
        expect((column[index]?.top ?? 0) - (column[index - 1]?.bottom ?? 0)).toBeGreaterThanOrEqual(
          8,
        );
      }
    }
  });

  test("renders a separated 12-goal and 75-agent world with truthful uncertainty", async () => {
    const clock = new FixedClock(50_000);
    const scenario = createMockScenario("portfolio");
    const host = new MockHostAdapter({ clock, scenario });
    const { universe } = makeUniverse({ clock });
    expect(universe.reconcile(await Effect.runPromise(host.snapshot())).accepted).toBe(true);
    expect(seedMockPortfolio(universe)).toEqual({ createdGoals: 12, assignedAgents: 71 });

    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const markup = renderToStaticMarkup(
      createElement(Atlas, {
        projection,
        reservedLeft: 0,
        reservedRight: 0,
        onSelect: () => undefined,
      }),
    );
    const goals = renderedGoals(markup);
    const assignedAgents = renderedAgents(markup);

    expect(goals).toHaveLength(12);
    expect(markup.match(/data-agent-id=/gu)).toHaveLength(71);
    expect(markup).not.toContain("UNASSIGNED");
    expect(markup).toContain("atlas atlas--motion");
    expect(markup).toContain("goal--working");
    expect(markup).toContain("agent--working");
    expect(markup).toContain("agent__attention-wave");
    expect(markup).toContain("agent__working-wave");
    expect(markup).not.toContain("goal__halo");
    expect(markup).not.toContain("goal__quiet-field");
    expect(markup).not.toContain("goal__contour");
    expect(markup).not.toContain("goal-fill-");
    expect(markup).toContain("goal-clip-");
    expect(markup).toContain("ATTN</text>");
    expect(markup).toContain('aria-label="Fit map to screen"');
    const cameraZoom = Number(markup.match(/data-camera-zoom="([^"]+)"/u)?.[1]);
    expect(cameraZoom).toBeGreaterThan(0);
    expect(cameraZoom).toBeLessThanOrEqual(1.15);
    expect(markup).toContain(`scale(${cameraZoom})`);
    const contentBounds = atlasContentBounds(projection, atlasGoalSpacingScale(projection));
    expect((contentBounds.maximumX - contentBounds.minimumX) * cameraZoom).toBeLessThanOrEqual(
      1200 - 96,
    );
    expect((contentBounds.maximumY - contentBounds.minimumY) * cameraZoom).toBeLessThanOrEqual(
      760 - 144,
    );
    expect(assignedAgents).toHaveLength(71);
    expect(new Set(goals.map((goal) => goal.y)).size).toBeGreaterThanOrEqual(10);
    for (const agent of assignedAgents) {
      const goal = goals.find((candidate) => candidate.id === agent.goalId);
      expect(goal).toBeDefined();
      if (!goal) continue;
      expect(Math.hypot(agent.x - goal.x, agent.y - goal.y)).toBeGreaterThanOrEqual(
        goal.radius + 29.9,
      );
      const orbitEquation =
        ((agent.x - goal.x) / agent.orbitRadiusX) ** 2 +
        ((agent.y - goal.y) / agent.orbitRadiusY) ** 2;
      expect(Math.abs(orbitEquation - 1)).toBeLessThan(0.001);
      const phase = Math.atan2(
        (agent.y - goal.y) / agent.orbitRadiusY,
        (agent.x - goal.x) / agent.orbitRadiusX,
      );
      const distanceFromCaption = Math.abs(
        Math.atan2(Math.sin(phase - Math.PI / 2), Math.cos(phase - Math.PI / 2)),
      );
      expect(distanceFromCaption).toBeGreaterThanOrEqual(0.819);
    }
    for (let leftIndex = 0; leftIndex < goals.length; leftIndex += 1) {
      const left = goals[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < goals.length; rightIndex += 1) {
        const right = goals[rightIndex];
        if (!right) continue;
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(
          left.radius + right.radius,
        );
      }
    }

    clock.value += scenario.tickMs;
    expect(universe.reconcile(await Effect.runPromise(host.snapshot())).accepted).toBe(true);
    const staleMarkup = renderToStaticMarkup(
      createElement(Atlas, {
        projection: mapProjection(universe.project({ kind: "universe-map", now: clock.now() })),
        reservedLeft: 0,
        reservedRight: 0,
        onSelect: () => undefined,
      }),
    );
    expect(staleMarkup).not.toContain("agent--uncertain");
  });

  test("expands crowded durable anchors before fitting the map", async () => {
    const clock = new FixedClock(50_000);
    const host = new MockHostAdapter({ clock, scenario: createMockScenario("portfolio") });
    const { universe } = makeUniverse({ clock });
    expect(universe.reconcile(await Effect.runPromise(host.snapshot())).accepted).toBe(true);
    expect(seedMockPortfolio(universe)).toEqual({ createdGoals: 12, assignedAgents: 71 });
    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const crowdedProjection: UniverseMapProjection = {
      ...projection,
      goals: projection.goals.slice(0, 5).map((goal, index) => ({
        ...goal,
        mapPosition: { x: (index % 3) * 36, y: Math.floor(index / 3) * 36 },
      })),
    };
    const markup = renderToStaticMarkup(
      createElement(Atlas, {
        projection: crowdedProjection,
        reservedLeft: 0,
        reservedRight: 0,
        onSelect: () => undefined,
      }),
    );
    const goals = renderedGoals(markup);

    for (let leftIndex = 0; leftIndex < goals.length; leftIndex += 1) {
      const left = goals[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < goals.length; rightIndex += 1) {
        const right = goals[rightIndex];
        if (!right) continue;
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(
          left.radius + right.radius + 15.9,
        );
      }
    }
  });

  test("keeps full agent orbits separated when empty goals are populated later", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "admin" });
    universe.execute({ type: "CreateGoal", title: "observatory - general" });
    universe.execute({ type: "CreateGoal", title: "maia / copilot" });
    universe.reconcile(
      hostSnapshot(
        Array.from({ length: 18 }, (_, index) => ({
          nativeId: `pane-${index}`,
          displayName: `Agent ${index}`,
          runtimeState: "working" as const,
          runtimeStateSource: "test",
          hostLocator: `test:pane-${index}`,
          observedAt: clock.now(),
        })),
      ),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({
      type: "AssignAgents",
      agentIds: ["agent-2", "agent-3"],
      goalId: "goal-2",
    });
    universe.execute({
      type: "AssignAgents",
      agentIds: Array.from({ length: 15 }, (_, index) => `agent-${index + 4}`),
      goalId: "goal-3",
    });

    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const persistedCrowdedProjection: UniverseMapProjection = {
      ...projection,
      goals: projection.goals.map((goal, index) => ({
        ...goal,
        // Reproduce an older accepted row whose anchors were chosen before
        // these goals gained their direct agents.
        mapPosition: { x: index * 144, y: 0 },
      })),
    };
    const markup = renderToStaticMarkup(
      createElement(Atlas, {
        projection: persistedCrowdedProjection,
        reservedLeft: 0,
        reservedRight: 0,
        onSelect: () => undefined,
      }),
    );
    const goals = renderedGoals(markup);
    const agents = renderedAgents(markup);
    expect(
      goals
        .map((goal) => agents.filter((agent) => agent.goalId === goal.id).length)
        .sort((left, right) => left - right),
    ).toEqual([1, 2, 15]);
    for (let leftIndex = 0; leftIndex < goals.length; leftIndex += 1) {
      const left = goals[leftIndex];
      if (!left) continue;
      const leftAgents = agents.filter((agent) => agent.goalId === left.id);
      const leftWidth = Math.max(
        left.radius,
        ...leftAgents.map((agent) => agent.orbitRadiusX + 22),
      );
      const leftHeight = Math.max(
        left.radius,
        ...leftAgents.map((agent) => agent.orbitRadiusY + 22),
      );
      for (let rightIndex = leftIndex + 1; rightIndex < goals.length; rightIndex += 1) {
        const right = goals[rightIndex];
        if (!right) continue;
        const rightAgents = agents.filter((agent) => agent.goalId === right.id);
        const rightWidth = Math.max(
          right.radius,
          ...rightAgents.map((agent) => agent.orbitRadiusX + 22),
        );
        const rightHeight = Math.max(
          right.radius,
          ...rightAgents.map((agent) => agent.orbitRadiusY + 22),
        );
        expect(
          Math.abs(left.x - right.x) >= leftWidth + rightWidth + 15.9 ||
            Math.abs(left.y - right.y) >= leftHeight + rightHeight + 15.9,
        ).toBe(true);
      }
    }
  });
});
