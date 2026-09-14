import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window, type Element as HappyElement } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UniverseMapProjection } from "../../../src/projection/types.ts";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { Atlas } from "./Atlas.tsx";

/** happy-dom has no layout engine; the camera only needs the observer contract. */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

interface CameraTransform {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

const projectionFixture = (): UniverseMapProjection => {
  const { universe, clock } = makeUniverse();
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot(
      Array.from({ length: 4 }, (_, index) => ({
        nativeId: `pane-${index}`,
        displayName: `Agent ${index}`,
        runtimeState: "working" as const,
        runtimeStateSource: "test",
        hostLocator: `test:pane-${index}`,
        observedAt: clock.now(),
      })),
    ),
  );
  const projection = universe.project({ kind: "universe-map", now: clock.now() });
  if (projection.kind !== "universe-map") throw new Error("Expected a universe map.");
  return projection;
};

const transformOf = (container: HappyElement): CameraTransform => {
  const transform = container.querySelector(".atlas__world")?.getAttribute("transform") ?? "";
  const match = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/u.exec(transform);
  if (!match) throw new Error(`Unexpected world transform: ${transform}`);
  return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
};

/** World point -> client coordinates on the untransformed, at-origin SVG surface. */
const toClient = (camera: CameraTransform, world: WorldPoint) => ({
  clientX: world.x * camera.zoom + camera.panX,
  clientY: world.y * camera.zoom + camera.panY,
});

const cardWorldPoint = (card: HappyElement): WorldPoint => {
  const x = Number(card.getAttribute("data-screen-x"));
  const y = Number(card.getAttribute("data-screen-y"));
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error("Expected projected Agent card coordinates.");
  return { x, y };
};

/** A card-sized marquee centred on one card, in world coordinates. */
const cardCorners = (point: WorldPoint) => ({
  start: { x: point.x - 105, y: point.y - 47 },
  end: { x: point.x + 105, y: point.y + 47 },
});

const surfaceOf = (browser: Window): HappyElement => {
  const surface = browser.document.querySelector(".atlas__world")?.closest("svg");
  if (!surface) throw new Error("Expected the Atlas surface.");
  return surface;
};

describe("Atlas marquee selection", () => {
  let browser: Window;
  let root: Root;
  let selected: (readonly string[])[] = [];
  let cleared = 0;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    browser = new Window();
    browser.happyDOM.setViewport({ width: 1440, height: 900 });
    selected = [];
    cleared = 0;
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      Element: browser.Element,
      ResizeObserver: StubResizeObserver,
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

  const drag = async (from: WorldPoint, to: WorldPoint): Promise<void> => {
    const camera = transformOf(browser.document.body);
    const surface = surfaceOf(browser);
    await act(async () => {
      surface.dispatchEvent(
        new browser.PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          shiftKey: true,
          ...toClient(camera, from),
        }),
      );
      surface.dispatchEvent(
        new browser.PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          shiftKey: true,
          ...toClient(camera, to),
        }),
      );
      surface.dispatchEvent(
        new browser.PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          shiftKey: true,
        }),
      );
    });
  };

  const mount = async (projection: UniverseMapProjection): Promise<void> => {
    await act(async () =>
      root.render(
        <Atlas
          onClearSelection={() => {
            cleared += 1;
          }}
          onSelect={() => {}}
          onSelectAgents={(agentIds) => selected.push(agentIds)}
          projection={projection}
          reservedLeft={0}
          reservedRight={0}
        />,
      ),
    );
  };

  const cardAt = (index: number): HappyElement => {
    const card = [...browser.document.querySelectorAll("[data-agent-id]")][index];
    if (!card) throw new Error(`Expected an Agent card at index ${index}.`);
    return card;
  };

  test("dragging the empty canvas selects the covered cards only", async () => {
    await mount(projectionFixture());
    expect(browser.document.querySelectorAll("[data-agent-id]").length).toBe(4);

    const corners = cardCorners(cardWorldPoint(cardAt(1)));
    await drag(corners.start, corners.end);

    expect(selected).toEqual([["agent-2"]]);
  });

  test("a multi-card drag returns every covered Agent in projection order", async () => {
    const projection = projectionFixture();
    await mount(projection);

    const start = cardCorners(cardWorldPoint(cardAt(0))).start;
    const end = cardCorners(cardWorldPoint(cardAt(3))).end;
    await drag(start, end);

    expect(selected).toHaveLength(1);
    const ids = selected[0] ?? [];
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.every((id) => projection.workspaceLess.some((agent) => agent.id === id))).toBe(true);
    expect([...ids].sort()).toEqual([...ids]);
  });

  test("the pointer release does not clear the selection a marquee just made", async () => {
    await mount(projectionFixture());

    const corners = cardCorners(cardWorldPoint(cardAt(2)));
    await drag(corners.start, corners.end);
    expect(selected).toEqual([["agent-3"]]);

    const hitArea = browser.document.querySelector(".atlas__hit-area");
    if (!hitArea) throw new Error("Expected the canvas background.");
    await act(async () =>
      hitArea.dispatchEvent(new browser.MouseEvent("click", { bubbles: true })),
    );
    expect(cleared).toBe(0);

    await act(async () =>
      hitArea.dispatchEvent(new browser.MouseEvent("click", { bubbles: true })),
    );
    expect(cleared).toBe(1);
  });

  test("a Shift click that draws no marquee keeps the background clear behaviour", async () => {
    await mount(projectionFixture());
    const hitArea = browser.document.querySelector(".atlas__hit-area");
    const surface = surfaceOf(browser);
    if (!hitArea) throw new Error("Expected the canvas background.");

    await act(async () => {
      surface.dispatchEvent(
        new browser.PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          shiftKey: true,
          clientX: 40,
          clientY: 40,
        }),
      );
      surface.dispatchEvent(
        new browser.PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          shiftKey: true,
          clientX: 40,
          clientY: 40,
        }),
      );
      hitArea.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }));
    });

    // No marquee was drawn, so this click is an ordinary background click.
    expect(cleared).toBe(1);
    expect(selected).toEqual([]);
  });

  test("an unmodified drag pans without selecting anything", async () => {
    await mount(projectionFixture());
    const before = transformOf(browser.document.body);
    const surface = surfaceOf(browser);

    await act(async () => {
      surface.dispatchEvent(
        new browser.PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 10,
          clientY: 10,
        }),
      );
      surface.dispatchEvent(
        new browser.PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: 400,
          clientY: 260,
        }),
      );
      surface.dispatchEvent(
        new browser.PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: 400,
          clientY: 260,
        }),
      );
    });

    expect(selected).toEqual([]);
    expect(browser.document.querySelector(".atlas__marquee")).toBeNull();
    expect(transformOf(browser.document.body).panX).not.toBe(before.panX);
  });
});
