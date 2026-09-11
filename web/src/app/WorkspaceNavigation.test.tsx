import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import type { CommandCentreProjection } from "../../../src/projection/types.ts";
import { WorkspaceNavigation, type NavigationView } from "./WorkspaceNavigation.tsx";
import type { Selection } from "./selection.ts";

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

const TogglingHarness = ({
  projection,
  onSelect,
}: {
  readonly projection: CommandCentreProjection;
  readonly onSelect: (selection: Selection) => void;
}) => {
  const [selection, setSelection] = useState<Selection>();
  return (
    <WorkspaceNavigation
      projection={projection}
      systemId="system-1"
      view="all"
      selection={selection}
      onSystem={() => {}}
      onSelect={(next) => {
        onSelect(next);
        setSelection(next);
      }}
    />
  );
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

  test("separates disclosure toggles from row selection", () => {
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
    expect(markup).toContain('class="workspace-tree__toggle"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Collapse Example system"');
    expect(markup).toContain('<summary aria-current="true"');
    expect(markup).not.toContain("summary aria-expanded");
  });
});

describe("Workspace navigation disclosure", () => {
  let browser: Window;
  let root: Root;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    browser = new Window();
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    saved.clear();
  });

  const renderProjection = () => {
    const { universe, clock } = fixture();
    universe.execute({ type: "CreateGoal", title: "Second goal", systemId: "system-1" });
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    return projection;
  };

  test("toggling a goal disclosure expands it without navigating", async () => {
    const onSelect: unknown[] = [];
    await act(async () =>
      root.render(
        <WorkspaceNavigation
          projection={renderProjection()}
          systemId="system-1"
          view="all"
          onSystem={() => {}}
          onSelect={(selection) => onSelect.push(selection)}
        />,
      ),
    );
    const details = [
      ...document.querySelectorAll<HTMLDetailsElement>(".workspace-tree__goal"),
    ].find((candidate) => candidate.textContent?.includes("Second goal"));
    if (!details) throw new Error("Expected the second goal.");
    const toggle = details.querySelector<HTMLButtonElement>(".workspace-tree__toggle");
    if (!toggle) throw new Error("Expected a disclosure toggle.");

    await act(async () => toggle.click());

    expect(onSelect).toEqual([]);
    expect(details.open).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  test("navigating to a goal keeps another manually expanded goal open", async () => {
    const onSelect: unknown[] = [];
    await act(async () =>
      root.render(
        <TogglingHarness
          projection={renderProjection()}
          onSelect={(selection) => onSelect.push(selection)}
        />,
      ),
    );
    const goals = [...document.querySelectorAll<HTMLDetailsElement>(".workspace-tree__goal")];
    const second = goals.find((candidate) => candidate.textContent?.includes("Second goal"));
    const first = goals.find((candidate) => candidate.textContent?.includes("Example goal"));
    if (!second || !first) throw new Error("Expected both goals.");
    const secondToggle = second.querySelector<HTMLButtonElement>(".workspace-tree__toggle");
    if (!secondToggle) throw new Error("Expected a disclosure toggle.");
    await act(async () => secondToggle.click());
    expect(second.open).toBe(true);

    const firstTitle = [...first.querySelectorAll("span")].find(
      (candidate) => candidate.textContent === "Example goal",
    );
    if (!firstTitle) throw new Error("Expected the first goal title.");
    await act(async () => firstTitle.click());

    expect(onSelect).toEqual([{ type: "goal", id: "goal-1" }]);
    expect(second.open).toBe(true);
    expect(first.open).toBe(true);
  });
});
