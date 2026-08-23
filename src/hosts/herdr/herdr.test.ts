import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { readFileSync } from "node:fs";
import { parseHerdrSnapshot, HerdrHostAdapter } from "./adapter.ts";
import { openHerdrTerminal } from "./terminal.ts";
import type { CommandRunner, TerminalCommandRunner, TerminalProcess } from "./runner.ts";
import type { HostTerminalEvent } from "../types.ts";
import { FixedClock } from "../../universe/test-support.ts";
import { parseJsonValue } from "./protocol.ts";

const fixture = parseJsonValue(
  readFileSync(new URL("../../../fixtures/herdr/sanitized-snapshot.json", import.meta.url), "utf8"),
);

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly options: { readonly interactive?: boolean }[] = [];
  private readonly queuedResults: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }[];
  private result: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  constructor(
    result: {
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    },
    queuedResults: readonly {
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }[] = [],
  ) {
    this.result = result;
    this.queuedResults = [...queuedResults];
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
    return this.queuedResults.shift() ?? this.result;
  }
}

class FakeTerminalProcess implements TerminalProcess {
  readonly writes: (string | Uint8Array)[] = [];
  killed = false;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array> = (async function* () {})();
  readonly exited = Promise.resolve(0);

  constructor(
    events: readonly HostTerminalEvent[],
    encoding: "base64" | "bytes" | "text" = "base64",
  ) {
    this.stdout = (async function* () {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      for (const event of events) {
        yield encoder.encode(
          JSON.stringify(
            event.kind === "frame"
              ? encoding === "base64"
                ? {
                    type: "terminal.frame",
                    data_base64: btoa(String.fromCharCode(...event.frame.bytes)),
                  }
                : encoding === "bytes"
                  ? {
                      type: "terminal.frame",
                      bytes: btoa(String.fromCharCode(...event.frame.bytes)),
                    }
                  : { type: "terminal.frame", data: decoder.decode(event.frame.bytes) }
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

  constructor(
    events: readonly HostTerminalEvent[],
    encoding: "base64" | "bytes" | "text" = "base64",
  ) {
    this.process = new FakeTerminalProcess(events, encoding);
  }

  spawnTerminal(argv: readonly string[]): TerminalProcess {
    this.calls.push([...argv]);
    return this.process;
  }
}

describe("Herdr adapter", () => {
  test("offers the initial curated launch set", async () => {
    const adapter = new HerdrHostAdapter({ clock: new FixedClock(12_345) });
    expect(await Effect.runPromise(adapter.listLaunchOptions())).toEqual([
      { kind: "claude", label: "Claude Code", description: "Claude Code CLI" },
      { kind: "codex", label: "Codex", description: "Codex CLI" },
      { kind: "pi", label: "Pi", description: "Pi coding agent" },
    ]);
  });

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

    const incomplete = parseHerdrSnapshot(
      { result: { snapshot: { panes: [], workspaces: [] } } },
      101,
    );
    expect(incomplete.available).toBe(false);
    expect(incomplete.error).toContain("required session inventory");
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
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({
        hostKind: "herdr",
        nativeId: "fixture-w2:p1",
      }),
    );
    expect(access.supported).toBe(true);
    expect(access.capabilities).toEqual(["embedded-terminal", "native-handoff"]);
    expect(access.mode).toBe("attach");
    expect(access.target?.kind).toBe("herdr-agent-attach");
    expect(access.target?.token).toBe("fixture-w2:p1");
    expect(await Effect.runPromise(adapter.activate(access))).toEqual({
      ok: true,
      message: "Attached to the real Herdr session fixture-w2:p1.",
    });
    expect(runner.calls.at(-1)).toEqual(["herdr", "agent", "attach", "fixture-w2:p1"]);
    expect(runner.options.at(-1)).toEqual({ interactive: true });
  });

  test("launches through a Herdr workspace and agent command without leaking pane topology", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });
    const result = await Effect.runPromise(
      adapter.launch({
        requestId: "launch-herdr-test",
        workingDirectory: "/sandbox/alpha",
        agentKind: "codex",
        agentName: "launch-check",
        prompt: "start safely",
      }),
    );
    expect(result.ok).toBe(true);
    expect(runner.calls).toContainEqual([
      "herdr",
      "workspace",
      "create",
      "--cwd",
      "/sandbox/alpha",
      "--label",
      "launch-check",
      "--no-focus",
    ]);
    expect(runner.calls).toContainEqual([
      "herdr",
      "agent",
      "start",
      "launch-check",
      "--kind",
      "codex",
      "--pane",
      "fixture-w1:p2",
      "--timeout",
      "30000",
    ]);
    expect(runner.calls).toContainEqual([
      "herdr",
      "agent",
      "prompt",
      "fixture-w1:p2",
      "start safely",
    ]);
  });

  test("generates distinct names from the request suffix when no name is supplied", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });

    await Effect.runPromise(
      adapter.launch({
        requestId: "launch-m123456789-abc123",
        workingDirectory: "/sandbox/alpha",
        agentKind: "codex",
      }),
    );
    await Effect.runPromise(
      adapter.launch({
        requestId: "launch-m123456789-def456",
        workingDirectory: "/sandbox/alpha",
        agentKind: "codex",
      }),
    );

    const names = runner.calls
      .filter((call) => call[0] === "herdr" && call[1] === "agent" && call[2] === "start")
      .map((call) => call[3]);
    expect(names).toEqual(["codex-launch-m123456789-abc123", "codex-launch-m123456789-def456"]);
  });

  test("returns Herdr's structured launch error to the caller", async () => {
    const runner = new FakeRunner(
      {
        exitCode: 0,
        stdout: JSON.stringify(fixture),
        stderr: "",
      },
      [
        {
          exitCode: 0,
          stdout: JSON.stringify(fixture),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            result: {
              root_pane: { pane_id: "duplicate-name:p1" },
            },
          }),
          stderr: "",
        },
        {
          exitCode: 1,
          stdout: JSON.stringify({
            error: {
              code: "agent_name_taken",
              message: "agent name codex-launch-m is already used",
            },
          }),
          stderr: "",
        },
      ],
    );
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });

    const result = await Effect.runPromise(
      adapter.launch({
        requestId: "launch-m123456789-duplicate",
        workingDirectory: "/sandbox/alpha",
        agentKind: "codex",
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: "agent name codex-launch-m is already used",
    });
  });

  test("uses the workspace creation response for the new root pane", async () => {
    const runner = new FakeRunner(
      {
        exitCode: 0,
        stdout: JSON.stringify(fixture),
        stderr: "",
      },
      [
        {
          exitCode: 0,
          stdout: JSON.stringify(fixture),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            result: { root_pane: { pane_id: "created-workspace:p1" } },
          }),
          stderr: "",
        },
      ],
    );
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });

    const result = await Effect.runPromise(
      adapter.launch({
        requestId: "launch-herdr-root-pane",
        workingDirectory: "/sandbox/alpha",
        agentKind: "codex",
        agentName: "root-pane-check",
      }),
    );

    expect(result.ok).toBe(true);
    expect(runner.calls).toContainEqual([
      "herdr",
      "agent",
      "start",
      "root-pane-check",
      "--kind",
      "codex",
      "--pane",
      "created-workspace:p1",
      "--timeout",
      "30000",
    ]);
    expect(runner.calls.filter((call) => call.join(" ") === "herdr api snapshot")).toHaveLength(2);
  });

  test("retries while the new root shell is settling", async () => {
    const runner = new FakeRunner(
      {
        exitCode: 0,
        stdout: JSON.stringify(fixture),
        stderr: "",
      },
      [
        {
          exitCode: 0,
          stdout: JSON.stringify(fixture),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            result: { root_pane: { pane_id: "settling-workspace:p1" } },
          }),
          stderr: "",
        },
        {
          exitCode: 1,
          stdout: "",
          stderr: JSON.stringify({ error: { code: "agent_pane_busy" } }),
        },
        {
          exitCode: 0,
          stdout: JSON.stringify(fixture),
          stderr: "",
        },
      ],
    );
    const adapter = new HerdrHostAdapter({
      runner,
      clock: new FixedClock(100),
    });

    const result = await Effect.runPromise(
      adapter.launch({
        requestId: "launch-herdr-settling-pane",
        workingDirectory: "/sandbox/alpha",
        agentKind: "codex",
        agentName: "settling-pane-check",
      }),
    );

    expect(result.ok).toBe(true);
    expect(
      runner.calls.filter(
        (call) => call[0] === "herdr" && call[1] === "agent" && call[2] === "start",
      ),
    ).toHaveLength(2);
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
    const snapshot = await Effect.runPromise(adapter.snapshot());
    expect(snapshot.available).toBe(false);
    const missing = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "missing" }),
    );
    expect(missing.supported).toBe(false);
    expect(missing.capabilities).toEqual([]);
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
    await Effect.runPromise(adapter.snapshot());
    expect(
      (await Effect.runPromise(adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" })))
        .supported,
    ).toBe(true);
    runner.setResult({ exitCode: 1, stdout: "", stderr: "socket unavailable" });
    await Effect.runPromise(adapter.snapshot());
    expect(
      (await Effect.runPromise(adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" })))
        .supported,
    ).toBe(false);
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
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({
        hostKind: "herdr",
        nativeId: "fixture-w2:p1",
      }),
    );
    expect(access.terminalTarget).toEqual({
      kind: "herdr-terminal-control",
      token: "fixture-w2:p1",
    });
    const opened = await Effect.runPromise(adapter.openTerminal(access, { columns: 80, rows: 24 }));
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
    const events = Array.from(await Effect.runPromise(Stream.runCollect(opened.terminal!.events)));
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("frame");
    expect(events[1]).toEqual({ kind: "closed", reason: "done" });
    expect(await Effect.runPromise(opened.terminal!.send({ kind: "text", value: "x" }))).toEqual({
      ok: true,
      message: "Input sent to the Herdr terminal.",
    });
    expect(
      await Effect.runPromise(
        opened.terminal!.send({
          kind: "scroll",
          direction: "up",
          lines: 12,
          source: "wheel",
          column: 4,
          row: 5,
        }),
      ),
    ).toEqual({
      ok: true,
      message: "Input sent to the Herdr terminal.",
    });
    expect(JSON.parse(String(terminalRunner.process.writes[1]))).toEqual({
      type: "terminal.scroll",
      direction: "up",
      lines: 12,
      source: "wheel",
      column: 4,
      row: 5,
      modifiers: 0,
    });
    await Effect.runPromise(
      opened.terminal!.send({
        kind: "scroll",
        direction: "down",
        lines: 23,
        source: "page-key",
      }),
    );
    expect(JSON.parse(String(terminalRunner.process.writes[2]))).toMatchObject({
      type: "terminal.scroll",
      direction: "down",
      lines: 23,
      source: "page_key",
    });
    expect(await Effect.runPromise(opened.terminal!.resize({ columns: 90, rows: 30 }))).toEqual({
      ok: true,
      message: "Resized Herdr terminal to 90×30.",
    });
    expect((await Effect.runPromise(opened.terminal!.release())).ok).toBe(true);
    expect(terminalRunner.process.killed).toBe(true);
    expect(terminalRunner.process.writes).toHaveLength(5);
  });

  test("treats untagged terminal frame data as text", async () => {
    const terminalRunner = new FakeTerminalRunner(
      [{ kind: "frame", frame: { bytes: new TextEncoder().encode("test") } }],
      "text",
    );
    const terminal = openHerdrTerminal(terminalRunner, "target", { columns: 80, rows: 24 });
    const events = Array.from(await Effect.runPromise(Stream.runCollect(terminal.events)));
    expect(events[0]).toMatchObject({
      kind: "frame",
      frame: { bytes: new TextEncoder().encode("test") },
    });
    await Effect.runPromise(terminal.release());
  });

  test("decodes Herdr's base64-encoded bytes frame field", async () => {
    const terminalRunner = new FakeTerminalRunner(
      [{ kind: "frame", frame: { bytes: new TextEncoder().encode("hello") } }],
      "bytes",
    );
    const terminal = openHerdrTerminal(terminalRunner, "target", { columns: 80, rows: 24 });
    const events = Array.from(await Effect.runPromise(Stream.runCollect(terminal.events)));

    expect(events[0]).toMatchObject({
      kind: "frame",
      frame: { bytes: new TextEncoder().encode("hello") },
    });
    await Effect.runPromise(terminal.release());
  });
});
