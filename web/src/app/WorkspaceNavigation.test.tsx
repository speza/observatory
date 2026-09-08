import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { WorkspaceNavigation, type NavigationView } from "./WorkspaceNavigation.tsx";

const fixture = () => {
  const { universe, clock } = makeUniverse();
  universe.execute({ type: "CreateSystem", title: "Example system" });
  universe.execute({ type: "CreateGoal", title: "Example goal", systemId: "system-1" });
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot([
      {
        nativeId: "a",
        displayName: "Needs a response",
        runtimeState: "blocked",
        runtimeStateSource: "test",
        hostLocator: "test:a",
        observedAt: clock.now(),
      },
      {
        nativeId: "b",
        displayName: "Quiet worker",
        runtimeState: "working",
        runtimeStateSource: "test",
        hostLocator: "test:b",
        observedAt: clock.now(),
      },
      {
        nativeId: "c",
        displayName: "Unassigned decision",
        runtimeState: "blocked",
        runtimeStateSource: "test",
        hostLocator: "test:c",
        observedAt: clock.now(),
      },
    ]),
  );
  universe.execute({ type: "AssignAgents", agentIds: ["agent-1", "agent-2"], goalId: "goal-1" });
  return { universe, clock };
};

describe("Workspace navigation views", () => {
  test("filters attention within its owning system and goal, including unassigned decisions", () => {
    const { universe, clock } = fixture();
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    const render = (view: NavigationView) =>
      renderToStaticMarkup(
        <WorkspaceNavigation
          projection={projection}
          view={view}
          onSystem={() => {}}
          onSelect={() => {}}
        />,
      );
    const attention = render("attention");
    expect(attention).toContain("Example system");
    expect(attention).toContain("Example goal");
    expect(attention).toContain("Needs a response");
    expect(attention).toContain("Unassigned decision");
    expect(attention).not.toContain("Quiet worker");
    const unassigned = render("unassigned");
    expect(unassigned).toContain("Unassigned decision");
    expect(unassigned).not.toContain("Example goal");
    expect(unassigned).not.toContain("Needs a response");
    expect(render("all")).toContain("Quiet worker");
  });
  test("an assignment removes the agent from Unassigned and places it under its goal", () => {
    const { universe, clock } = fixture();
    universe.execute({ type: "AssignAgent", agentId: "agent-3", goalId: "goal-1" });
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    const markup = renderToStaticMarkup(
      <WorkspaceNavigation
        projection={projection}
        view="unassigned"
        onSystem={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain("No unassigned agents.");
    expect(markup).not.toContain("Unassigned decision");
    expect(projection.goals[0]?.agents.some((agent) => agent.id === "agent-3")).toBe(true);
  });

  test("keeps monitor-only uncertainty out of Needs you", () => {
    const { universe, clock } = fixture();
    universe.reconcile({
      ...hostSnapshot([], clock.now()),
      available: false,
      complete: false,
    });
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");

    expect(projection.attention.currentCount).toBe(0);
    expect(projection.attention.uncertaintyCount).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(
      <WorkspaceNavigation
        projection={projection}
        view="attention"
        onSystem={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain("Nothing needs your attention.");
    expect(markup).not.toContain("Needs a response");
    expect(markup).not.toContain("Unassigned decision");
  });

  test("uses one selected row for disclosure and selection", () => {
    const { universe, clock } = fixture();
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    const markup = renderToStaticMarkup(
      <WorkspaceNavigation
        projection={projection}
        systemId="system-1"
        view="all"
        onSystem={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain('<summary aria-current="true"');
    expect(markup).not.toContain("<summary><button");
  });
});
