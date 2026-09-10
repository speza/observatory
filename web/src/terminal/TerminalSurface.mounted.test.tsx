import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { WebTerminalLink } from "../../../src/web/protocol.ts";
import { TerminalSurface } from "./TerminalSurface.tsx";

class TerminalSocket extends EventTarget {
  static readonly OPEN = 1;
  static latest: TerminalSocket;
  readonly readyState = TerminalSocket.OPEN;
  readonly sent: string[] = [];
  constructor() {
    super();
    TerminalSocket.latest = this;
  }
  send(message: string): void {
    this.sent.push(message);
  }
  close(): void {}
  frame(): void {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ kind: "frame", bytes: "eA==", deliveryId: 1 }),
      }),
    );
  }
}
class ObservedResize {
  static latest: ObservedResize;
  constructor(readonly callback: () => void) {
    ObservedResize.latest = this;
  }
  observe(): void {}
  disconnect(): void {}
}
const link: WebTerminalLink = {
  id: "link",
  label: "Shell",
  kind: "shell",
  source: "observed",
  available: true,
  explanation: "Synthetic shell",
};

describe("mounted terminal connection and resize lifecycle", () => {
  let root: Root;
  let browser: Window;
  const terminals: Terminal[] = [];
  const terminal = () => terminals.at(-1)!;
  let fitCalls = 0;
  let opens = 0;
  const restore: (() => void)[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    browser = new Window({ url: "http://localhost" });
    terminals.length = 0;
    fitCalls = 0;
    opens = 0;
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      WebSocket: TerminalSocket,
      ResizeObserver: ObservedResize,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    // Stub browser rendering only; retain the real xterm event/input and resize APIs.
    const open = spyOn(Terminal.prototype, "open").mockImplementation(function (this: Terminal) {
      terminals.push(this);
    });
    const focus = spyOn(Terminal.prototype, "focus").mockImplementation(() => {});
    const write = spyOn(Terminal.prototype, "write").mockImplementation((_data, callback) =>
      callback?.(),
    );
    const fit = spyOn(FitAddon.prototype, "fit").mockImplementation(() => {
      fitCalls++;
      terminal().resize(100 + fitCalls, 30);
    });
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof globalThis.fetch>[0]) => {
          if ((input instanceof Request ? input.url : input.toString()).endsWith("/open")) {
            opens++;
            return Response.json({ sessionId: "session", message: "Opened" });
          }
          return Response.json({ ok: true, message: "Released" });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    restore.push(
      () => open.mockRestore(),
      () => focus.mockRestore(),
      () => write.mockRestore(),
      () => fit.mockRestore(),
      () => fetch.mockRestore(),
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
    for (const undo of restore.splice(0)) undo();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    saved.clear();
  });
  const render = async (
    label = "Shell",
    active = false,
    visible = true,
    resizeMode: "fit" | "preserve" = "fit",
  ) => {
    await act(async () =>
      root.render(
        createElement(TerminalSurface, {
          active,
          visible,
          resizeMode,
          launch: undefined,
          agent: {
            id: "agent",
            displayName: "Agent",
            continuity: "proved",
            providerContinuity: "confirmed",
            executionPresence: "live",
            resumeCapability: "eligible",
            observationHealth: "fresh",
            displayNameSource: "provider",
            runtimeState: "working",
            runtimeStateSource: "mock",
            hostHealth: "live",
            lastSeenAt: 1000,
            lastObservedAt: 1000,
            lastChangedAt: 1000,
            canResume: true,
            lifecycleState: "running",
            executionConflictCount: 0,
          },
          link: { ...link, label },
          embedded: true,
          showHeader: false,
          theme: "dark",
          onClose: () => {},
        }),
      ),
    );
  };
  const connect = async () => {
    await act(async () => {
      TerminalSocket.latest.dispatchEvent(new Event("open"));
      TerminalSocket.latest.frame();
      await Bun.sleep(180);
    });
  };

  test("a title update preserves a connected surface and does not reopen it", async () => {
    await render();
    await connect();
    expect(document.querySelector(".is-ready")).not.toBeNull();
    await render("bun run test");
    await act(async () => {
      TerminalSocket.latest.frame();
      await Bun.sleep(180);
    });
    expect(document.querySelector(".is-ready")).not.toBeNull();
    expect(document.querySelector(".terminal-surface__mask")).toBeNull();
    expect(document.querySelector("section")?.getAttribute("aria-label")).toBe(
      "bun run test terminal",
    );
    expect(opens).toBe(1);
  });
  test("visible unfocused panes send their host resize but reject keyboard input", async () => {
    await render();
    await connect();
    TerminalSocket.latest.sent.length = 0;
    await act(async () => {
      ObservedResize.latest.callback();
      terminal().input("should not send", true);
    });
    expect(TerminalSocket.latest.sent.map((message) => JSON.parse(message))).toEqual([
      { kind: "resize", columns: terminal().cols, rows: terminal().rows },
    ]);
    await render("Shell", true);
    TerminalSocket.latest.sent.length = 0;
    await act(async () => terminal().input("focused", true));
    expect(TerminalSocket.latest.sent.map((message) => JSON.parse(message))).toEqual([
      { kind: "input", value: "focused" },
    ]);
  });
  test("hidden panes do not fit or send resize updates", async () => {
    await render();
    await connect();
    await render("Shell", false, false);
    TerminalSocket.latest.sent.length = 0;
    const before = fitCalls;
    await act(async () => ObservedResize.latest.callback());
    expect(fitCalls).toBe(before);
    expect(TerminalSocket.latest.sent).toEqual([]);
  });
  test("preserve mode sends no host resize on connect or viewport change", async () => {
    await render("Shell", true, true, "preserve");
    await connect();
    await act(async () => ObservedResize.latest.callback());
    expect(TerminalSocket.latest.sent).toEqual([]);
  });
});
