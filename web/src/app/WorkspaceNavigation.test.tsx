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
import { onlySelection, type Selection, type SelectionModel } from "./selection.ts";
/** Click a rendered row through happy-dom so modifier intent is exercised end to end. */
const click = (
  browser: Window,
  selector: string,
  index: number,
  modifiers: {
    readonly metaKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
  },
): void => {
  const target = browser.document.querySelectorAll(selector)[index];
  if (!target) throw new Error(`Expected ${selector} at index ${index}.`);
  target.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, ...modifiers }));
};

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
  const [selection, setSelection] = useState<SelectionModel>();
  return (
    <WorkspaceNavigation
      projection={projection}
      systemId="system-1"
      view="all"
      selection={selection}
      onSystem={() => {}}
      onSelect={(next) => {
        onSelect(next);
        setSelection(onlySelection(next));
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

  test("starts discovered executions in a collapsed section", () => {
    const { universe, clock } = makeUniverse();
    universe.reconcile(
      hostSnapshot([
        {
          nativeId: "discovered",
          displayName: "Discovered execution",
          runtimeState: "idle",
          runtimeStateSource: "test",
          hostLocator: "test:discovered",
          observedAt: clock.now(),
        },
      ]),
    );
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    const markup = renderToStaticMarkup(
      <WorkspaceNavigation
        projection={projection}
        view="all"
        onSystem={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('<details class="workspace-tree__discovered-section">');
    expect(markup).not.toContain('<details class="workspace-tree__discovered-section" open>');
    expect(markup).toContain("Discovered in Herdr");
    expect(markup).toContain("Discovered execution");
  });

  test("agent rows show their qualified workspace as muted context", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          nativeId: "placed",
          displayName: "Placed worker",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:placed",
          observedAt: clock.now(),
          executionContainer: { id: "ctx-1", label: "Review workspace" },
        },
      ]),
    );
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    const markup = renderToStaticMarkup(
      <WorkspaceNavigation projection={projection} onSystem={() => {}} onSelect={() => {}} />,
    );
    expect(markup).toContain("workspace-tree__context");
    expect(markup).toContain("Review workspace");
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

describe("Workspace navigation multi-select", () => {
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

  test("a plain click stays navigation while modifiers defer to the set handler", async () => {
    const { universe, clock } = fixture();
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    const navigated: Selection[] = [];
    const gesture: {
      agentId: string;
      additive: boolean;
      range: boolean;
      order: readonly string[];
    }[] = [];
    await act(async () =>
      root.render(
        <WorkspaceNavigation
          projection={projection}
          systemId="system-1"
          view="all"
          onSystem={() => {}}
          onSelect={(next) => navigated.push(next)}
          onSelectAgent={(agentId, intent, order) => gesture.push({ agentId, ...intent, order })}
        />,
      ),
    );
    expect(document.querySelectorAll(".workspace-tree__agent").length).toBeGreaterThan(1);

    await act(async () => click(browser, ".workspace-tree__agent", 0, { metaKey: true }));
    expect(navigated).toEqual([]);
    expect(gesture).toHaveLength(1);
    expect(gesture[0]?.agentId).toBe("agent-1");
    expect(gesture[0]?.additive).toBe(true);
    expect(gesture[0]?.range).toBe(false);
    expect(gesture[0]?.order[0]).toBe("agent-1");
    expect(gesture[0]?.order).toContain("agent-3");

    await act(async () => click(browser, ".workspace-tree__agent", 1, { shiftKey: true }));
    expect(gesture[1]?.agentId).toBe("agent-2");
    expect(gesture[1]?.range).toBe(true);

    await act(async () => click(browser, ".workspace-tree__agent", 0, {}));
    expect(navigated).toEqual([{ type: "agent", id: "agent-1" }]);
    expect(gesture).toHaveLength(2);
  });

  test("shows batch membership and the inspector subject distinctly", async () => {
    const { universe, clock } = fixture();
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");
    await act(async () =>
      root.render(
        <WorkspaceNavigation
          projection={projection}
          systemId="system-1"
          view="all"
          onSystem={() => {}}
          onSelect={() => {}}
          selection={{
            subject: { type: "agent", id: "agent-2" },
            agentIds: new Set(["agent-1", "agent-2"]),
            anchor: "agent-1",
          }}
        />,
      ),
    );
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".workspace-tree__agent")];
    const selected = rows.filter((row) => row.getAttribute("aria-pressed") === "true");
    expect(selected.map((row) => row.textContent)).toHaveLength(2);
    const current = rows.filter((row) => row.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Quiet worker");
  });
});
