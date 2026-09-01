import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockHostAdapter } from "../../src/hosts/mock/adapter.ts";
import { createMockScenario } from "../../src/hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "../../src/hosts/mock/seed.ts";
import { FixedClock, hostSnapshot, makeUniverse } from "../../src/universe/test-support.ts";
import type { Projection, UniverseMapProjection } from "../../src/projection/types.ts";
import { Atlas, snapToAtlasGrid } from "./Atlas.tsx";
import {
  AGENT_CARD_HEIGHT,
  AGENT_CARD_WIDTH,
  atlasContentBounds,
  atlasGoalSpacingScale,
} from "./atlasGeometry.ts";

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
  test("renders a separated 12-goal and 75-agent world with truthful uncertainty", async () => {
    const clock = new FixedClock(50_000);
    const scenario = createMockScenario("portfolio");
    const host = new MockHostAdapter({ clock, scenario });
    const { universe } = makeUniverse({ clock });
    expect(universe.reconcile(await Effect.runPromise(host.snapshot())).accepted).toBe(true);
    expect(seedMockPortfolio(universe)).toEqual({ createdGoals: 12, assignedAgents: 71 });

    const baseProjection = mapProjection(
      universe.project({ kind: "universe-map", now: clock.now() }),
    );
    const projection: UniverseMapProjection = {
      ...baseProjection,
      goals: baseProjection.goals.map((goal, goalIndex) => ({
        ...goal,
        agents: goal.agents.map((agent, agentIndex) =>
          goalIndex === 0 && agentIndex === 0
            ? { ...agent, description: "Maps host facts to semantic state." }
            : agent,
        ),
      })),
    };
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
    expect(markup).toContain("agent__card");
    expect(markup).toContain("agent__selection");
    expect(markup).toContain("goal__selection");
    expect(markup).toContain("agent__identity");
    expect(markup).toContain("agent__summary");
    expect(markup).toContain("agent__provider-mark");
    expect(markup).toContain("agent__rule");
    expect(markup).not.toContain("agent__state-rail");
    expect(markup).toContain("Maps host facts to semantic s…");
    expect(markup).toContain("agent__attention-wave");
    expect(markup).toContain("agent__working-aura");
    expect(markup).toContain("agent__working-circuit");
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
      const nearestCardX = Math.max(0, Math.abs(agent.x - goal.x) - AGENT_CARD_WIDTH / 2);
      const nearestCardY = Math.max(0, Math.abs(agent.y - goal.y) - AGENT_CARD_HEIGHT / 2);
      expect(Math.hypot(nearestCardX, nearestCardY)).toBeGreaterThanOrEqual(goal.radius + 13.9);
      const orbitEquation =
        ((agent.x - goal.x) / agent.orbitRadiusX) ** 2 +
        ((agent.y - goal.y) / agent.orbitRadiusY) ** 2;
      expect(orbitEquation).toBeCloseTo(1, 3);
      const phase = Math.atan2(
        (agent.y - goal.y) / agent.orbitRadiusY,
        (agent.x - goal.x) / agent.orbitRadiusX,
      );
      const distanceFromCaption = Math.abs(
        Math.atan2(Math.sin(phase - Math.PI / 2), Math.cos(phase - Math.PI / 2)),
      );
      expect(distanceFromCaption).toBeGreaterThanOrEqual(0.719);
    }
    for (let leftIndex = 0; leftIndex < assignedAgents.length; leftIndex += 1) {
      const left = assignedAgents[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < assignedAgents.length; rightIndex += 1) {
        const right = assignedAgents[rightIndex];
        if (!right || left.goalId !== right.goalId) continue;
        expect(
          Math.abs(left.x - right.x) >= AGENT_CARD_WIDTH + 13.9 ||
            Math.abs(left.y - right.y) >= AGENT_CARD_HEIGHT + 9.9,
        ).toBe(true);
      }
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
        ...leftAgents.map((agent) => Math.abs(agent.x - left.x) + AGENT_CARD_WIDTH / 2 + 4),
      );
      const leftHeight = Math.max(
        left.radius,
        ...leftAgents.map((agent) => Math.abs(agent.y - left.y) + AGENT_CARD_HEIGHT / 2 + 4),
      );
      for (let rightIndex = leftIndex + 1; rightIndex < goals.length; rightIndex += 1) {
        const right = goals[rightIndex];
        if (!right) continue;
        const rightAgents = agents.filter((agent) => agent.goalId === right.id);
        const rightWidth = Math.max(
          right.radius,
          ...rightAgents.map((agent) => Math.abs(agent.x - right.x) + AGENT_CARD_WIDTH / 2 + 4),
        );
        const rightHeight = Math.max(
          right.radius,
          ...rightAgents.map((agent) => Math.abs(agent.y - right.y) + AGENT_CARD_HEIGHT / 2 + 4),
        );
        expect(
          Math.abs(left.x - right.x) >= leftWidth + rightWidth + 15.9 ||
            Math.abs(left.y - right.y) >= leftHeight + rightHeight + 15.9,
        ).toBe(true);
      }
    }
  });

  test("anchors the Survey grid to durable world coordinates", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "World origin" });
    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    expect(projection.goals[0]?.mapPosition).toEqual({ x: 0, y: 0 });

    const markup = renderToStaticMarkup(
      createElement(Atlas, {
        projection,
        reservedLeft: 0,
        reservedRight: 0,
        onSelect: () => undefined,
      }),
    );
    const goal = renderedGoals(markup)[0];
    const gridOriginX = Number(markup.match(/data-grid-origin-x="([^"]+)"/u)?.[1]);
    const gridOriginY = Number(markup.match(/data-grid-origin-y="([^"]+)"/u)?.[1]);
    const worldStart = markup.indexOf('class="atlas__world"');
    const gridStart = markup.indexOf('class="atlas__coordinate-grid"');
    const goalStart = markup.indexOf('data-goal-id="goal-1"');

    expect(markup).toContain('data-logical-step="24"');
    expect(goal?.x).toBe(gridOriginX);
    expect(goal?.y).toBe(gridOriginY);
    expect(worldStart).toBeGreaterThan(-1);
    expect(gridStart).toBeGreaterThan(worldStart);
    expect(goalStart).toBeGreaterThan(gridStart);
  });

  test("snaps goal placement to the visible Survey grid", () => {
    expect(snapToAtlasGrid({ x: 11, y: -13 })).toEqual({ x: 0, y: -24 });
    expect(snapToAtlasGrid({ x: 12, y: -12 })).toEqual({ x: 24, y: -24 });
    expect(snapToAtlasGrid({ x: 35, y: 37 })).toEqual({ x: 24, y: 48 });
  });
});
