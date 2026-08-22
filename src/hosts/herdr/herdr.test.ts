import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHerdrSnapshot, HerdrHostAdapter } from "./adapter.ts";
import type { CommandRunner, TerminalCommandRunner, TerminalProcess } from "./runner.ts";
import type { HostTerminalEvent } from "../types.ts";
import { FixedClock } from "../../universe/test-support.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/herdr/sanitized-snapshot.json", import.meta.url), "utf8"),
) as unknown;

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly options: { readonly interactive?: boolean }[] = [];
  private result: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  constructor(result: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }) {
    this.result = result;
  }
  setResult(result: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }): void {
    this.result = result;
  }
  async run(argv: readonly string[], options?: { readonly interactive?: boolean }) {
    this.calls.push([...argv]);
    this.options.push(options ?? {});
    return this.result;
  }
}

class FakeTerminalProcess implements TerminalProcess {
  readonly writes: (string | Uint8Array)[] = [];
  killed = false;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array> = (async function* () {})();
  readonly exited = Promise.resolve(0);

  constructor(events: readonly HostTerminalEvent[]) {
    this.stdout = (async function* () {
      const encoder = new TextEncoder();
      for (const event of events) {
        yield encoder.encode(
          JSON.stringify(
            event.kind === "frame"
              ? {
                  type: "terminal.frame",
                  data_base64: btoa(String.fromCharCode(...event.frame.bytes)),
                }
              : { type: "terminal.closed", reason: event.reason },
          ) + "\n",
        );
      }
    })();
  }

  async write(value: string | Uint8Array): Promise<void> {
    this.writes.push(value);
  }

  kill(): void {
    this.killed = true;
  }
}

class FakeTerminalRunner implements TerminalCommandRunner {
  readonly calls: string[][] = [];
  readonly process: FakeTerminalProcess;

  constructor(events: readonly HostTerminalEvent[]) {
    this.process = new FakeTerminalProcess(events);
  }

  spawnTerminal(argv: readonly string[]): TerminalProcess {
    this.calls.push([...argv]);
    return this.process;
  }
}

describe("Herdr adapter", () => {
  test("parses recognized agents into sessions and ignores non-agent panes", () => {
    const snapshot = parseHerdrSnapshot(fixture, 12_345);
    expect(snapshot.available).toBe(true);
    expect(snapshot.sessions).toHaveLength(3);
    expect(
      snapshot.sessions.find((session) => session.nativeId === "fixture-w2:p1")?.runtimeState,
    ).toBe("blocked");
    expect(
      snapshot.sessions.find((session) => session.nativeId === "fixture-w1:p1")?.provider,
    ).toBe("codex");
    expect(snapshot.sessions[0]?.hostLocator).toContain("paneId");
    expect(snapshot.sessions[0]?.hostLocator).not.toContain("terminal output");
    expect(snapshot.sessions.some((session) => session.nativeId === "fixture-w1:p2")).toBe(false);
  });

  test("removes Herdr's animated working marker from the display name", () => {
    const snapshot = parseHerdrSnapshot(
      {
        result: {
          snapshot: {
            panes: [
              {
                pane_id: "working",
                terminal_id: "term",
                workspace_id: "w",
                tab_id: "t",
              },
            ],
            agents: [{ pane_id: "working", name: "◑ Model override", agent_status: "working" }],
            workspaces: [],
          },
        },
      },
      99,
    );

    expect(snapshot.sessions[0]?.displayName).toBe("Model override");
  });

  test("skips malformed observations without throwing", () => {
    const snapshot = parseHerdrSnapshot(
      {
        result: {
          snapshot: {
            panes: [
              {
                pane_id: "good",
                terminal_id: "term",
                workspace_id: "w",
                tab_id: "t",
                agent_status: "idle",
              },
              { pane_id: "bad" },
            ],
            agents: [{ pane_id: "good", agent: "codex" }, { pane_id: "bad" }],
            workspaces: [],
          },
        },
      },
      99,
    );
    expect(snapshot.available).toBe(true);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.diagnostics).toHaveLength(1);
  });

  test("preserves duplicate identities for reconciliation to reject", () => {
    const pane = {
      pane_id: "duplicate",
      terminal_id: "term",
      workspace_id: "w",
      tab_id: "t",
      agent_status: "idle",
    };
    const snapshot = parseHerdrSnapshot(
      {
        result: {
          snapshot: {
            panes: [pane],
            agents: [
              { pane_id: "duplicate", agent: "codex" },
              { pane_id: "duplicate", agent: "codex" },
            ],
            workspaces: [],
          },
        },
      },
      99,
    );
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.diagnostics[0]).toContain("duplicate");
  });

  test("reports unavailable and empty host responses", () => {
    const malformed = parseHerdrSnapshot({ hello: "world" }, 99);
    expect(malformed.available).toBe(false);
    expect(malformed.error).toContain("Malformed");
    const empty = parseHerdrSnapshot(
      { result: { snapshot: { panes: [], agents: [], workspaces: [] } } },
      100,
    );
    expect(empty.available).toBe(true);
    expect(empty.sessions).toHaveLength(0);
  });

  test("does not treat panes as sessions when the agent list is empty", () => {
    const snapshot = parseHerdrSnapshot(
      {
        result: {
          snapshot: {
            panes: [
              {
                pane_id: "shell",
                terminal_id: "term",
                workspace_id: "w",
                tab_id: "t",
                agent_status: "unknown",
              },
            ],
            agents: [],
            workspaces: [],
          },
        },
      },
      99,
    );
    expect(snapshot.sessions).toHaveLength(0);
    expect(snapshot.diagnostics).toHaveLength(0);
  });

  test("keeps attachment targets opaque and uses direct interactive attach", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });
    await adapter.snapshot();
    const access = await adapter.access({
      hostKind: "herdr",
      nativeId: "fixture-w2:p1",
    });
    expect(access.supported).toBe(true);
    expect(access.mode).toBe("attach");
    expect(access.target?.kind).toBe("herdr-agent-attach");
    expect(access.target?.token).toBe("fixture-w2:p1");
    expect(await adapter.activate(access)).toEqual({
      ok: true,
      message: "Attached to the real Herdr session fixture-w2:p1.",
    });
    expect(runner.calls.at(-1)).toEqual(["herdr", "agent", "attach", "fixture-w2:p1"]);
    expect(runner.options.at(-1)).toEqual({ interactive: true });
  });

  test("does not claim access for unavailable or unknown sessions", async () => {
    const runner = new FakeRunner({
      exitCode: 1,
      stdout: "",
      stderr: "socket unavailable",
    });
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });
    const snapshot = await adapter.snapshot();
    expect(snapshot.available).toBe(false);
    expect((await adapter.access({ hostKind: "herdr", nativeId: "missing" })).supported).toBe(
      false,
    );
  });

  test("clears live attachment targets when Herdr becomes unavailable", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });
    await adapter.snapshot();
    expect((await adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" })).supported).toBe(
      true,
    );
    runner.setResult({ exitCode: 1, stdout: "", stderr: "socket unavailable" });
    await adapter.snapshot();
    expect((await adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" })).supported).toBe(
      false,
    );
  });

  test("opens a host-owned terminal stream without leaking Herdr protocol details", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("hello") } },
      { kind: "closed", reason: "done" },
    ]);
    const adapter = new HerdrHostAdapter({
      runner,
      terminalRunner,
      clock: new FixedClock(100),
    });
    await adapter.snapshot();
    const access = await adapter.access({
      hostKind: "herdr",
      nativeId: "fixture-w2:p1",
    });
    expect(access.terminalTarget).toEqual({
      kind: "herdr-terminal-control",
      token: "fixture-w2:p1",
    });
    const opened = await adapter.openTerminal(access, { columns: 80, rows: 24 });
    expect(opened.ok).toBe(true);
    expect(opened.terminal).toBeDefined();
    expect(terminalRunner.calls[0]).toEqual([
      "herdr",
      "terminal",
      "session",
      "control",
      "fixture-w2:p1",
      "--takeover",
      "--cols",
      "80",
      "--rows",
      "24",
    ]);
    const events: HostTerminalEvent[] = [];
    for await (const event of opened.terminal!.events) events.push(event);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("frame");
    expect(events[1]).toEqual({ kind: "closed", reason: "done" });
    expect(await opened.terminal!.send({ kind: "text", value: "x" })).toEqual({
      ok: true,
      message: "Input sent to the Herdr terminal.",
    });
    expect(await opened.terminal!.resize({ columns: 90, rows: 30 })).toEqual({
      ok: true,
      message: "Resized Herdr terminal to 90×30.",
    });
    expect((await opened.terminal!.release()).ok).toBe(true);
    expect(terminalRunner.process.killed).toBe(true);
    expect(terminalRunner.process.writes).toHaveLength(3);
  });
});
