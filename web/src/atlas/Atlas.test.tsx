import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockHostAdapter } from "../../../src/hosts/mock/adapter.ts";
import { createMockScenario } from "../../../src/hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "../../../src/hosts/mock/seed.ts";
import type { Projection, UniverseMapProjection } from "../../../src/projection/types.ts";
import {
  FixedClock,
  hostSnapshot,
  makeUniverse,
  admitObservedConversationsAndReconcile,
} from "../../../src/universe/test-support.ts";
import { Atlas, snapToAtlasGrid } from "./Atlas.tsx";
import { onlySelection, type SelectionModel } from "../app/selection.ts";
import {
  ATLAS_GRID_STEP,
  atlasContentBounds,
  atlasGoalSpacingScale,
  discoveredDockPlacement,
  workspaceAgentPoints,
  workspaceDimensions,
  workspaceLessPosition,
  workspacePosition,
} from "./atlasGeometry.ts";

const mapProjection = (projection: Projection): UniverseMapProjection => {
  if (projection.kind !== "universe-map") throw new Error("Expected a universe-map projection.");
  return projection;
};

interface RenderOptions {
  readonly selection?: SelectionModel;
  readonly pullRequestUrls?: ReadonlyMap<string, string>;
  readonly onCloseAndArchive?: () => void;
  readonly onOpenTerminal?: () => void;
  readonly onReviewChanges?: () => void;
}

const renderAtlas = (projection: UniverseMapProjection, options: RenderOptions = {}) =>
  renderToStaticMarkup(
    createElement(Atlas, {
      projection,
      reservedLeft: 0,
      reservedRight: 0,
      onSelect: () => undefined,
      ...options,
    }),
  );

describe("production web Atlas", () => {
  test("renders workspace-first geography while preserving Goal semantics and Agent actions", async () => {
    const clock = new FixedClock(50_000);
    const scenario = createMockScenario("portfolio");
    const host = new MockHostAdapter({ clock, scenario });
    const { universe } = makeUniverse({ clock });
    const snapshot = await Effect.runPromise(host.snapshot());
    expect(seedMockPortfolio(universe, snapshot)).toEqual({ createdGoals: 12, assignedAgents: 71 });

    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const pullRequestAgent = projection.workspaces[0]?.agents[0];
    expect(pullRequestAgent).toBeDefined();
    const pullRequestUrl = "https://github.com/acme/observatory/pull/42";
    const markup = renderAtlas(projection, {
      pullRequestUrls: new Map(pullRequestAgent ? [[pullRequestAgent.id, pullRequestUrl]] : []),
      onCloseAndArchive: () => undefined,
      onOpenTerminal: () => undefined,
      onReviewChanges: () => undefined,
    });

    expect(projection.workspaces).toHaveLength(2);
    expect(projection.workspaceLess).toHaveLength(61);
    expect(markup.match(/data-agent-id=/gu)).toHaveLength(75);
    expect(markup.match(/class="workspace-island"/gu)).toHaveLength(2);
    expect(markup).toContain("WORKSPACE · Copilot dev mode UI · 10");
    expect(markup).toContain("WORKSPACE · Observatory control plane · 4");
    expect(markup).toContain("WORKSPACE-LESS / DORMANT");
    expect(markup).toContain("GOAL ·");
    expect(markup).toContain("agent__goal-chip");
    expect(markup).not.toContain("synthetic/copilot-dev-mode-ui");
    expect(markup).not.toContain("goal__body");
    expect(markup).not.toContain("goal__orbits");
    expect(markup).toContain("agent--working");
    expect(markup).toContain("agent__provider-mark");
    expect(markup).toContain("agent__attention-wave");
    expect(markup).toContain("agent__working-aura");
    expect(markup).toContain("agent__working-circuit");
    expect(markup).toContain("agent__state-pulse");
    expect(markup).toMatch(/aria-label="Open [^"]+ terminal"/u);
    expect(markup).toContain('class="agent__quick-action"');
    expect(markup).toContain('class="agent__quick-action agent__quick-action--destructive"');
    expect(markup).toContain('class="agent__quick-action" href="https://github.com');
    expect(markup).toContain('<rect height="20" rx="3" width="22"');
    expect(markup).toContain("Close and archive ");
    expect(markup).toMatch(/aria-label="Review [^"]+ changes"/u);
    expect(markup).toContain(`Open ${pullRequestAgent?.displayName} pull request on GitHub`);
    expect(markup).toContain(`href="${pullRequestUrl}"`);

    const cameraZoom = Number(markup.match(/scale\(([^)]+)\)/u)?.[1]);
    expect(cameraZoom).toBeGreaterThan(0);
    expect(cameraZoom).toBeLessThanOrEqual(1.15);
    const contentBounds = atlasContentBounds(projection, atlasGoalSpacingScale(projection));
    expect((contentBounds.maximumX - contentBounds.minimumX) * cameraZoom).toBeLessThanOrEqual(
      1200 - 96,
    );
    expect((contentBounds.maximumY - contentBounds.minimumY) * cameraZoom).toBeLessThanOrEqual(
      760 - 144,
    );
  });

  test("separates workspace islands and docks the workspace-less territory below them", async () => {
    const clock = new FixedClock(50_000);
    const host = new MockHostAdapter({ clock, scenario: createMockScenario("portfolio") });
    const { universe } = makeUniverse({ clock });
    const snapshot = await Effect.runPromise(host.snapshot());
    seedMockPortfolio(universe, snapshot);
    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const scale = atlasGoalSpacingScale(projection);

    expect(scale).toBeGreaterThan(1);
    const territories = projection.workspaces.map((workspace) => ({
      position: workspace.mapPosition,
      size: workspaceDimensions(workspace),
    }));
    for (let leftIndex = 0; leftIndex < territories.length; leftIndex += 1) {
      const left = territories[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < territories.length; rightIndex += 1) {
        const right = territories[rightIndex];
        if (!right) continue;
        expect(
          Math.abs(left.position.x - right.position.x) * scale >=
            left.size.width / 2 + right.size.width / 2 ||
            Math.abs(left.position.y - right.position.y) * scale >=
              left.size.height / 2 + right.size.height / 2,
        ).toBe(true);
      }
    }
    const workspaceLess = workspaceLessPosition(projection, scale);
    const workspaceLessSize = workspaceDimensions({ agents: projection.workspaceLess });
    expect(
      projection.workspaces.every(
        (workspace) =>
          workspace.mapPosition.y * scale + workspaceDimensions(workspace).height / 2 <
          workspaceLess.y - workspaceLessSize.height / 2,
      ),
    ).toBe(true);
  });

  test("keeps workspace-less Agents visible in one explicit compact area", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        Array.from({ length: 9 }, (_, index) => ({
          nativeId: `pane-${index}`,
          displayName: `Agent ${index}`,
          runtimeState: "working" as const,
          runtimeStateSource: "test",
          hostLocator: `test:pane-${index}`,
          observedAt: clock.now(),
        })),
      ),
    );
    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const markup = renderAtlas(projection);

    expect(projection.workspaces).toHaveLength(0);
    expect(projection.workspaceLess).toHaveLength(9);
    expect(markup.match(/data-agent-id=/gu)).toHaveLength(9);
    expect(markup).toContain('class="workspace-less__frame"');
    expect(markup).toContain("GOAL · UNASSIGNED");
  });

  test("anchors the Survey grid to workspace world coordinates", async () => {
    const clock = new FixedClock(50_000);
    const host = new MockHostAdapter({ clock, scenario: createMockScenario("portfolio") });
    const { universe } = makeUniverse({ clock });
    seedMockPortfolio(universe, await Effect.runPromise(host.snapshot()));
    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const markup = renderAtlas(projection);

    expect(markup).toContain('data-logical-step="24"');
    expect(markup.indexOf('class="atlas__coordinate-grid"')).toBeLessThan(
      markup.indexOf('class="workspace-island"'),
    );
    const scale = atlasGoalSpacingScale(projection);
    for (const workspace of projection.workspaces) {
      const centre = workspacePosition(workspace, scale);
      expect(centre.x % ATLAS_GRID_STEP).toBeCloseTo(0);
      expect(centre.y % ATLAS_GRID_STEP).toBeCloseTo(0);
      for (const point of workspaceAgentPoints(workspace, centre)) {
        expect(point.x % ATLAS_GRID_STEP).toBeCloseTo(0);
        expect(point.y % ATLAS_GRID_STEP).toBeCloseTo(0);
      }
    }
    expect(snapToAtlasGrid({ x: 11, y: -13 })).toEqual({ x: 0, y: -24 });
    expect(snapToAtlasGrid({ x: 12, y: -12 })).toEqual({ x: 24, y: 0 });
    expect(snapToAtlasGrid({ x: 35, y: 37 })).toEqual({ x: 24, y: 48 });
  });

  test("keeps discovered executions in a separate dock below accepted work", () => {
    const { universe, clock } = makeUniverse();
    const accepted = {
      nativeId: "accepted-pane",
      displayName: "Accepted workspace Agent",
      runtimeState: "working" as const,
      runtimeStateSource: "test",
      hostLocator: "test:accepted-pane",
      observedAt: clock.now(),
      executionContainer: { id: "accepted-workspace", label: "Accepted workspace" },
    };
    admitObservedConversationsAndReconcile(universe, hostSnapshot([accepted]));
    universe.reconcile(
      hostSnapshot([
        accepted,
        ...["Alpha", "A discovered execution title that cannot fit inside its card", "Charlie"].map(
          (displayName, index) => ({
            nativeId: `pane-${index}`,
            displayName,
            runtimeState: "working" as const,
            runtimeStateSource: "test",
            hostLocator: `test:pane-${index}`,
            observedAt: clock.now(),
          }),
        ),
      ]),
    );
    const projection = mapProjection(universe.project({ kind: "universe-map", now: clock.now() }));
    const scale = atlasGoalSpacingScale(projection);
    const placement = discoveredDockPlacement(projection, scale);
    const collapsedMarkup = renderAtlas(projection);
    expect(collapsedMarkup).toContain('aria-expanded="false"');
    expect(collapsedMarkup).not.toContain("data-discovery-handle=");
    const markup = renderAtlas(projection, {
      selection: onlySelection({
        type: "discovered-execution",
        id: projection.discoveredExecutions?.[0]?.handle ?? "",
      }),
    });

    expect(placement).toBeDefined();
    expect(markup).toContain('class="discovered-dock__frame"');
    expect(markup).toContain('class="discovered-dock__heading"');
    expect(markup).toContain(
      'class="discovered-execution__name" x="-124" y="-15">A discovered execution title…</text>',
    );
    expect(markup).toContain(
      'aria-label="A discovered execution title that cannot fit inside its card, working, discovered in test-host"',
    );
    const occupiedBottom = Math.max(
      ...projection.workspaces.map(
        (workspace) => workspace.mapPosition.y * scale + workspaceDimensions(workspace).height / 2,
      ),
    );
    expect(placement?.bounds.top).toBeGreaterThan(occupiedBottom);
    expect(markup.indexOf('class="discovered-dock__frame"')).toBeLessThan(
      markup.indexOf('class="discovered-execution__card"'),
    );
    expect(markup.match(/data-discovery-handle=/gu)).toHaveLength(3);
    expect(placement?.bounds.height).toBeGreaterThan(132);
    expect(discoveredDockPlacement(projection, scale * 4)?.bounds.width).toBe(
      placement?.bounds.width,
    );
  });
});
