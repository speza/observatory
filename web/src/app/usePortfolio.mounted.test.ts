import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeUniverse } from "../../../src/universe/test-support.ts";
import { projectPortfolio } from "../../../src/web/portfolio.ts";
import type { BrowserProjectionEvent, WebPortfolioResponse } from "../../../src/web/protocol.ts";
import { portfolioDelivery, usePortfolio, type PortfolioState } from "./usePortfolio.ts";

// Closing a transport does not erase callbacks already queued by the browser.
class QueuedEventSource extends EventTarget {
  static readonly OPEN = 1;
  static readonly instances: QueuedEventSource[] = [];
  readyState = QueuedEventSource.OPEN;
  closed = false;

  constructor(_url: string) {
    super();
    QueuedEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(event: BrowserProjectionEvent): void {
    this.dispatchEvent(new MessageEvent(event.kind, { data: JSON.stringify(event) }));
  }
}

const baseline = (epoch: string, revision = 1, pending = false): WebPortfolioResponse => {
  const { universe } = makeUniverse();
  const portfolio = projectPortfolio(universe, epoch.charCodeAt(0));
  if (!portfolio) throw new Error("Expected portfolio fixture.");
  return {
    ...portfolio,
    epoch,
    revision,
    pendingLaunches: pending
      ? [{ requestId: epoch, harnessId: "mock", displayName: epoch, message: "Waiting" }]
      : [],
  };
};

interface PendingFetch {
  readonly signal: AbortSignal | null | undefined;
  readonly resolve: (response: Response) => void;
}

const send = async (source: QueuedEventSource, event: BrowserProjectionEvent) => {
  await act(async () => source.emit(event));
};
const respond = async (request: PendingFetch, data: WebPortfolioResponse) => {
  await act(async () => request.resolve(Response.json(data)));
};
const expectEpoch = (epoch: string) => {
  expect(document.querySelector("output")?.textContent).toBe(String(epoch.charCodeAt(0)));
};

describe("mounted portfolio transport fencing", () => {
  let root: Root;
  let browser: Window;
  let state: PortfolioState;
  let now = 0;
  const requests: PendingFetch[] = [];
  let restoreFetch: () => void;
  let restoreClock: () => void;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(async () => {
    browser = new Window();
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      EventSource: QueuedEventSource,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    QueuedEventSource.instances.length = 0;
    requests.length = 0;
    now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    restoreClock = () => clock.mockRestore();
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        (_input: Parameters<typeof globalThis.fetch>[0], options?: RequestInit) => {
          const deferred = Promise.withResolvers<Response>();
          requests.push({ signal: options?.signal, resolve: deferred.resolve });
          return deferred.promise;
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    restoreFetch = () => fetch.mockRestore();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const Harness = () => {
      state = usePortfolio();
      return createElement("output", null, state.data?.map.generatedAt ?? "loading");
    };
    await act(async () => root.render(createElement(Harness)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
    restoreFetch();
    restoreClock();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    saved.clear();
  });

  const stream = () => QueuedEventSource.instances.at(-1)!;
  const recover = async () => {
    now += 30_001;
    await act(async () => browser.dispatchEvent(new browser.Event("online")));
    return requests.at(-1)!;
  };

  test("REST B fences unseen delayed A SSE before it can retire B or resurrect launches", async () => {
    const old = stream();
    await respond(await recover(), baseline("B"));
    await send(old, portfolioDelivery(baseline("A", 99, true)));
    expectEpoch("B");
    expect(old.closed).toBe(true);
    expect(state.pendingLaunches).toEqual([]);
    await send(stream(), portfolioDelivery(baseline("B", 2, true)));
    expectEpoch("B");
    expect(state.pendingLaunches?.map((launch) => launch.requestId)).toEqual(["B"]);
  });

  test("SSE B fences an older REST response even if fetch ignores abort", async () => {
    const pending = await recover();
    await send(stream(), portfolioDelivery(baseline("B")));
    expect(pending.signal?.aborted).toBe(true);
    await respond(pending, baseline("A", 99, true));
    expectEpoch("B");
    expect(state.pendingLaunches).toEqual([]);
  });

  test("skipped reconnect epochs and stale error/malformed callbacks are inert", async () => {
    await send(stream(), portfolioDelivery(baseline("A")));
    const old = stream();
    await respond(await recover(), baseline("C"));
    const replacement = stream();
    const count = requests.length;
    now += 30_001;
    await act(async () => {
      old.emit(portfolioDelivery(baseline("B", 99, true)));
      old.dispatchEvent(new MessageEvent("snapshot", { data: "malformed" }));
      old.dispatchEvent(new Event("error"));
      old.dispatchEvent(new Event("open"));
    });
    expectEpoch("C");
    expect(state.error).toBeUndefined();
    expect(requests).toHaveLength(count);
    expect(stream()).toBe(replacement);
    await send(replacement, portfolioDelivery(baseline("C", 2)));
    expectEpoch("C");
  });

  test("SSE bootstrap rotates once; same-epoch snapshots neither rotate nor abort", async () => {
    const initial = stream();
    await send(initial, portfolioDelivery(baseline("A")));
    expect(initial.closed).toBe(true);
    expect(QueuedEventSource.instances).toHaveLength(2);
    const pending = await recover();
    await send(stream(), portfolioDelivery(baseline("A", 2)));
    expect(QueuedEventSource.instances).toHaveLength(2);
    expect(pending.signal?.aborted).toBe(false);
    await respond(pending, baseline("A", 3));
    expect(QueuedEventSource.instances).toHaveLength(2);
    expectEpoch("A");
  });

  test("REST-only restart rotates each adopted epoch without waiting for SSE", async () => {
    await respond(await recover(), baseline("A", 10));
    const old = stream();
    await respond(await recover(), baseline("B"));
    expect(old.closed).toBe(true);
    expect(QueuedEventSource.instances).toHaveLength(3);
    expectEpoch("B");
  });

  test("same-epoch partial updates preserve recovery and its newer pending slice", async () => {
    await send(stream(), {
      kind: "pending-launches-replaced",
      epoch: "A",
      revision: 2,
      generatedAt: 1,
      pendingLaunches: [],
      affected: [],
      affectedAll: false,
    });
    const source = stream();
    const pending = await recover();
    await send(source, {
      kind: "pending-launches-replaced",
      epoch: "A",
      revision: 5,
      generatedAt: 1,
      pendingLaunches: [],
      affected: [],
      affectedAll: false,
    });
    expect(pending.signal?.aborted).toBe(false);
    await respond(pending, baseline("A", 4, true));
    expectEpoch("A");
    expect(state.pendingLaunches).toEqual([]);
    expect(stream()).toBe(source);
  });
});
