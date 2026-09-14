import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommandCentreProjection } from "../../../src/projection/types.ts";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { Ledger } from "./Ledger.tsx";
import type { Selection } from "../app/selection.ts";
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

const fixture = (): CommandCentreProjection => {
  const { universe, clock } = makeUniverse();
  universe.execute({ type: "CreateGoal", title: "Assigned work" });
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot(
      ["First worker", "Second worker", "Third worker"].map((displayName, index) => ({
        nativeId: `l${index}`,
        displayName,
        runtimeState: "idle" as const,
        runtimeStateSource: "test",
        hostLocator: `opaque:${index}`,
        observedAt: clock.now(),
      })),
    ),
  );
  universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
  const projection = universe.project({ kind: "command-centre", now: clock.now() });
  if (projection.kind !== "command-centre") throw new Error("Expected command centre");
  return projection;
};

describe("Ledger agent rows", () => {
  test("marks every selected Agent and names the visible range order", () => {
    const markup = renderToStaticMarkup(
      <Ledger
        projection={fixture()}
        selection={{
          subject: { type: "agent", id: "agent-2" },
          agentIds: new Set(["agent-2", "agent-3"]),
          anchor: "agent-2",
        }}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('class="is-selected"');
  });
});

describe("Ledger multi-select gestures", () => {
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

  test("defers modified clicks to the set handler in row order", async () => {
    const projection = fixture();
    const navigated: Selection[] = [];
    const gesture: {
      agentId: string;
      additive: boolean;
      range: boolean;
      order: readonly string[];
    }[] = [];
    await act(async () =>
      root.render(
        <Ledger
          projection={projection}
          onSelect={(next) => navigated.push(next)}
          onSelectAgent={(agentId, intent, order) => gesture.push({ agentId, ...intent, order })}
        />,
      ),
    );
    expect(document.querySelectorAll(".ledger li button").length).toBeGreaterThan(1);

    await act(async () => click(browser, ".ledger li button", 1, { ctrlKey: true }));
    expect(navigated).toEqual([]);
    expect(gesture[0]?.additive).toBe(true);
    expect(gesture[0]?.range).toBe(false);
    // Row order runs goal Agents first, then direct System Agents, then Inbox.
    expect(gesture[0]?.order).toEqual(["agent-1", "agent-2", "agent-3"]);

    await act(async () => click(browser, ".ledger li button", 2, { shiftKey: true }));
    expect(gesture[1]?.range).toBe(true);

    await act(async () => click(browser, ".ledger li button", 0, {}));
    expect(navigated).toEqual([{ type: "agent", id: "agent-1" }]);
  });
});
