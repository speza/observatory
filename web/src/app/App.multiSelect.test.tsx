import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Window,
  type HTMLElement as HappyHTMLElement,
  HTMLButtonElement as HappyButtonElement,
  HTMLSelectElement as HappySelectElement,
} from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Schema } from "effect";
import { projectPortfolio } from "../../../src/web/portfolio.ts";
import type { InspectorProjection } from "../../../src/projection/types.ts";
import { CommandResponseSchema } from "../api/schemas.ts";
import type { WebPortfolioResponse } from "../../../src/web/protocol.ts";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { App } from "./App.tsx";
import { portfolioDelivery } from "./usePortfolio.ts";

interface Fixture {
  readonly portfolio: WebPortfolioResponse;
  readonly inspector: (agentId: string) => InspectorProjection;
}

/** The renderer reads its own portfolio payload, so the fixture is the real server shape. */
const fixture = (options: { readonly assignAll?: boolean } = {}): Fixture => {
  const { universe, clock } = makeUniverse();
  universe.execute({ type: "CreateGoal", title: "Filing destination" });
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot(
      ["Alpha worker", "Beta worker", "Gamma worker"].map((displayName, index) => ({
        nativeId: `f${index}`,
        displayName,
        runtimeState: "idle" as const,
        runtimeStateSource: "test",
        hostLocator: `opaque:${index}`,
        observedAt: clock.now(),
      })),
    ),
  );
  // One Agent in a Goal and two in Inbox is the interesting filing shape; a fully
  // assigned portfolio exercises a range that stays inside one System scope.
  const assigned = options.assignAll ? ["agent-1", "agent-2", "agent-3"] : ["agent-1"];
  for (const agentId of assigned)
    universe.execute({ type: "AssignAgent", agentId, goalId: "goal-1" });
  const portfolio = projectPortfolio(universe, 1);
  if (!portfolio) throw new Error("Expected a portfolio fixture.");
  return {
    portfolio: { ...portfolio, epoch: "multi-select", revision: 1, pendingLaunches: [] },
    inspector: (agentId: string): InspectorProjection => {
      const projection = universe.project({
        kind: "inspector",
        now: clock.now(),
        target: { type: "agent", id: agentId },
      });
      if (projection.kind !== "agent-inspector")
        throw new Error("Expected the Agent inspector projection.");
      return projection;
    },
  };
};

/** happy-dom has no layout engine, so the Atlas camera only needs the observer contract. */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Mount delivers the baseline over the live stream, exactly as production does. */
class QueuedEventSource extends EventTarget {
  static readonly OPEN = 1;
  static readonly instances: QueuedEventSource[] = [];
  readyState = QueuedEventSource.OPEN;

  constructor(_url: string) {
    super();
    QueuedEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = 2;
  }

  emitSnapshot(portfolio: WebPortfolioResponse): void {
    this.dispatchEvent(
      new MessageEvent("snapshot", {
        data: JSON.stringify(portfolioDelivery(portfolio)),
      }),
    );
  }
}

/** Let a resolved request settle inside the React act environment. */
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

interface KeyModifiers {
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
}

const click = (browser: Window, selector: string, index: number, metaKey: boolean): void => {
  const target = browser.document.querySelectorAll(selector)[index];
  if (!target) throw new Error(`Expected ${selector} at index ${index}.`);
  target.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, metaKey }));
};

const selectOption = (browser: Window, selector: string, value: string): void => {
  const found = browser.document.querySelector(selector);
  if (!(found instanceof HappySelectElement)) throw new Error(`Expected a select for ${selector}.`);
  found.value = value;
  found.dispatchEvent(new browser.Event("change", { bubbles: true }));
};

describe("App multi-select filing", () => {
  let browser: Window;
  let root: Root;
  let commands: unknown[];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  const stubFetch = (source: Fixture): void => {
    const handler = async (url: string, init?: { readonly body?: string }): Promise<Response> => {
      if (url.startsWith("/api/portfolio")) return Response.json(source.portfolio);
      if (url.startsWith("/api/inspector")) {
        const agentId = new URL(url, "http://observatory.test").searchParams.get("id") ?? "";
        return Response.json(source.inspector(agentId));
      }
      if (url.startsWith("/api/commands")) {
        const body: unknown = JSON.parse(init?.body ?? "{}");
        commands.push(body);
        const parsed = Schema.decodeUnknownSync(CommandResponseSchema)({
          result: { ok: true, affectedAgentIds: ["agent-1", "agent-2"] },
          portfolio: source.portfolio,
        });
        return Response.json(parsed);
      }
      throw new Error(`Unstubbed request: ${url}`);
    };
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: handler,
    });
  };

  let built: Fixture;

  beforeEach(() => {
    browser = new Window();
    // Below 1200px the workspace collapses its panels; the batch flow needs both open.
    browser.happyDOM.setViewport({ width: 1440, height: 900 });
    commands = [];
    QueuedEventSource.instances.length = 0;
    built = fixture();
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      EventSource: QueuedEventSource,
      Element: browser.Element,
      HTMLElement: browser.HTMLElement,
      ResizeObserver: StubResizeObserver,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    stubFetch(built);
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

  const pressKey = async (key: string, modifiers: KeyModifiers): Promise<void> => {
    await act(async () => {
      browser.window.dispatchEvent(new browser.KeyboardEvent("keydown", { key, ...modifiers }));
    });
  };

  const mount = async (options?: { readonly assignAll?: boolean }): Promise<void> => {
    if (options) {
      built = fixture(options);
      stubFetch(built);
    }
    await act(async () => root.render(<App />));
    const source = QueuedEventSource.instances[0];
    if (!source) throw new Error("Expected the projection stream to open.");
    await act(async () => source.emitSnapshot(built.portfolio));
    if (!browser.document.querySelector(".atlas, .ledger"))
      throw new Error(`App did not mount: ${browser.document.body.innerHTML.slice(0, 600)}`);
  };

  test("modifier clicks open batch filing that submits one AssignAgents command", async () => {
    await mount();
    const goalId = built.portfolio.commandCentre.goals[0]?.id;
    if (!goalId) throw new Error("Expected a Goal fixture.");

    await act(async () => click(browser, ".workspace-tree__agent", 0, true));
    await act(async () => click(browser, ".workspace-tree__agent", 1, true));

    expect(browser.document.querySelector(".inspector__batch")).not.toBeNull();
    expect(browser.document.querySelector(".inspector h2")?.textContent).toBe("2 agents selected");
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "2 agents selected",
    );
    expect(commands).toEqual([]);

    await act(async () => selectOption(browser, ".inspector__batch select", `goal:${goalId}`));
    const move = [...browser.document.querySelectorAll(".inspector__batch button")].find(
      (button) => button instanceof HappyButtonElement && button.textContent?.startsWith("Move"),
    );
    if (!(move instanceof HappyButtonElement)) throw new Error("Expected the batch move action.");
    await act(async () => move.click());

    expect(commands).toEqual([{ type: "AssignAgents", agentIds: ["agent-1", "agent-2"], goalId }]);
    expect(browser.document.querySelector(".launch-notice")?.textContent).toContain(
      "Moved 2 agents to Filing destination.",
    );
  });

  test("select-all covers only the Agents the current view shows", async () => {
    await mount();

    await pressKey("a", { metaKey: true });
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "3 agents selected",
    );

    const unassigned = [
      ...browser.document.querySelectorAll<HappyHTMLElement>(".navigation-attention button"),
    ].find((button) => button.textContent?.includes("Unassigned"));
    if (!unassigned) throw new Error("Expected the Unassigned view button.");
    await act(async () => unassigned.click());

    await pressKey("a", { metaKey: true });
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "2 agents selected",
    );
    expect(
      browser.document.querySelector(".inspector__batch-list")?.textContent ?? "",
    ).not.toContain("Alpha worker");
  });

  test("shift with the navigation keys extends the range from the anchor", async () => {
    await mount({ assignAll: true });

    await act(async () => click(browser, ".workspace-tree__agent", 0, false));
    await flush();
    expect(browser.document.querySelector(".selection-chip")).toBeNull();

    await pressKey("ArrowDown", { shiftKey: true });
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "2 agents selected",
    );

    await pressKey("ArrowDown", { shiftKey: true });
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "3 agents selected",
    );

    await pressKey("ArrowUp", { shiftKey: true });
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "2 agents selected",
    );
  });

  test("Escape collapses the batch before closing the inspector", async () => {
    await mount();

    await act(async () => click(browser, ".workspace-tree__agent", 0, true));
    await act(async () => click(browser, ".workspace-tree__agent", 1, true));
    expect(browser.document.querySelector(".inspector__batch")).not.toBeNull();

    await pressKey("Escape", {});
    await flush();
    expect(browser.document.querySelector(".inspector__batch")).toBeNull();
    // The batch collapses to the inspector subject, not the range anchor.
    expect(browser.document.querySelector(".inspector h2")?.textContent).toBe("Beta worker");

    await pressKey("Escape", {});
    expect(browser.document.querySelector(".inspector")).toBeNull();
  });

  test("a System destination survives an id that contains its own separator", async () => {
    await mount();
    const systemId = built.portfolio.commandCentre.systems[0]?.id;
    if (!systemId) throw new Error("Expected a System fixture.");
    expect(systemId).toContain(":");

    await act(async () => click(browser, ".workspace-tree__agent", 0, true));
    await act(async () => click(browser, ".workspace-tree__agent", 1, true));
    await act(async () => selectOption(browser, ".inspector__batch select", `system:${systemId}`));
    const move = [...browser.document.querySelectorAll(".inspector__batch button")].find(
      (button) => button instanceof HappyButtonElement && button.textContent?.startsWith("Move"),
    );
    if (!(move instanceof HappyButtonElement)) throw new Error("Expected the batch move action.");
    await act(async () => move.click());

    expect(commands).toEqual([
      { type: "AssignAgentsToSystem", agentIds: ["agent-1", "agent-2"], systemId },
    ]);
  });

  test("moving a batch to Inbox clears placement instead of clearing the selection", async () => {
    await mount();

    await act(async () => click(browser, ".workspace-tree__agent", 0, true));
    await act(async () => click(browser, ".workspace-tree__agent", 1, true));
    await act(async () => selectOption(browser, ".inspector__batch select", "inbox"));
    const move = [...browser.document.querySelectorAll(".inspector__batch button")].find(
      (button) => button instanceof HappyButtonElement && button.textContent?.startsWith("Move"),
    );
    if (!(move instanceof HappyButtonElement)) throw new Error("Expected the batch move action.");
    await act(async () => move.click());

    expect(commands).toEqual([{ type: "UnassignAgents", agentIds: ["agent-1", "agent-2"] }]);
    expect(browser.document.querySelector(".launch-notice")?.textContent).toContain(
      "Moved 2 agents to Inbox.",
    );
  });

  test("a batch never outlives the view that shows its Agents", async () => {
    await mount();
    await pressKey("a", { metaKey: true });
    expect(browser.document.querySelector(".selection-chip")?.textContent ?? "").toContain(
      "3 agents selected",
    );

    const unassigned = [
      ...browser.document.querySelectorAll<HappyHTMLElement>(".navigation-attention button"),
    ].find((button) => button.textContent?.includes("Unassigned"));
    if (!unassigned) throw new Error("Expected the Unassigned view button.");
    await act(async () => unassigned.click());

    // The Goal-assigned Agent leaves this lens, so the batch collapses to the subject
    // rather than staying armed with an Agent the operator can no longer see.
    expect(browser.document.querySelector(".selection-chip")).toBeNull();
    expect(browser.document.querySelector(".inspector__batch")).toBeNull();
    expect(browser.document.querySelector(".inspector h2")?.textContent).toBe("Alpha worker");
    expect(commands).toEqual([]);
  });

  test("focus following the inspector never reshapes an armed batch", async () => {
    // One System scope keeps every Agent on the map after a plain click re-scopes.
    await mount({ assignAll: true });
    await act(async () => click(browser, ".workspace-tree__agent", 0, true));
    await act(async () => click(browser, ".workspace-tree__agent", 1, true));
    expect(browser.document.querySelector(".inspector__batch")).not.toBeNull();

    const card = browser.document.querySelector(".agent__card-target");
    if (!card) throw new Error("Expected an Atlas Agent card.");
    await act(async () => card.dispatchEvent(new browser.FocusEvent("focusin", { bubbles: true })));
    await flush();
    expect(browser.document.querySelector(".inspector__batch")).not.toBeNull();

    // With no batch armed, focus still carries the inspector to the focused Agent.
    await act(async () => click(browser, ".workspace-tree__agent", 0, false));
    const secondCard = browser.document.querySelectorAll(".agent__card-target")[1];
    if (!secondCard) throw new Error("Expected a second Atlas Agent card.");
    await act(async () =>
      secondCard.dispatchEvent(new browser.FocusEvent("focusin", { bubbles: true })),
    );
    await flush();
    expect(browser.document.querySelector(".inspector h2")?.textContent).toBe("Beta worker");
  });

  test("a plain click collapses the batch back to one Agent", async () => {
    await mount();

    await act(async () => click(browser, ".workspace-tree__agent", 0, true));
    await act(async () => click(browser, ".workspace-tree__agent", 1, true));
    expect(browser.document.querySelector(".inspector__batch")).not.toBeNull();

    await act(async () => click(browser, ".workspace-tree__agent", 0, false));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(browser.document.querySelector(".inspector__batch")).toBeNull();
    expect(browser.document.querySelector(".selection-chip")).toBeNull();
    expect(browser.document.querySelector(".inspector h2")?.textContent).toBe("Alpha worker");
  });
});
