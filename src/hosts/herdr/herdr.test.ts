import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { readFileSync } from "node:fs";
import { parseHerdrSnapshot, HerdrHostAdapter } from "./adapter.ts";
import { openHerdrTerminal } from "./terminal.ts";
import type { CommandRunner, TerminalCommandRunner, TerminalProcess } from "./runner.ts";
import type { HostTerminalEvent } from "../types.ts";
import { FixedClock } from "../../universe/test-support.ts";
import {
  isRecord,
  nonEmptyRecord,
  parseJsonValue,
  stringValue,
  type JsonRecord,
} from "./protocol.ts";
import { defineSessionHostContractTests } from "../session-host-contract.test-support.ts";

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
  test("parses recognized agents into agents and ignores non-agent panes", () => {
    const snapshot = parseHerdrSnapshot(fixture, 12_345);
    expect(snapshot.available).toBe(true);
    expect(snapshot.agents).toHaveLength(3);
    expect(snapshot.agents.find((agent) => agent.nativeId === "fixture-w2:p1")?.runtimeState).toBe(
      "blocked",
    );
    expect(snapshot.agents.find((agent) => agent.nativeId === "fixture-w1:p1")?.provider).toBe(
      "codex",
    );
    expect(
      snapshot.agents.find((agent) => agent.nativeId === "fixture-w1:p1")?.executionContainer,
    ).toEqual({ id: "fixture-w1", label: "alpha" });
    expect(snapshot.agents[0]?.hostLocator).toContain("paneId");
    expect(snapshot.agents[0]?.hostLocator).not.toContain("terminal output");
    expect(snapshot.agents.some((agent) => agent.nativeId === "fixture-w1:p2")).toBe(false);
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

    expect(snapshot.agents[0]?.displayName).toBe("Model override");
  });

  test("translates native agent session evidence without interpreting its value", () => {
    const snapshot = parseHerdrSnapshot(
      {
        result: {
          snapshot: {
            panes: [
              {
                pane_id: "restored",
                terminal_id: "term",
                workspace_id: "w",
                tab_id: "t",
                cwd: "/ordinary/workspace",
              },
            ],
            agents: [
              {
                pane_id: "restored",
                agent: "codex",
                agent_session_restored: true,
                agent_session: {
                  source: "herdr-integration",
                  agent: "codex",
                  kind: "id",
                  value: "opaque-session-value",
                },
              },
            ],
            workspaces: [],
          },
        },
      },
      99,
    );
    expect(snapshot.agents[0]?.harnessEvidence).toEqual({
      detectedHarnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        kind: "id",
        value: "opaque-session-value",
      },
      restoreState: "host-restored",
      source: "native-integration",
      observedAt: 99,
    });
    expect(snapshot.agents[0]?.worktree).toBe("/ordinary/workspace");
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
    expect(snapshot.agents).toHaveLength(1);
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
    expect(snapshot.agents).toHaveLength(2);
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
    expect(empty.agents).toHaveLength(0);

    const incomplete = parseHerdrSnapshot(
      { result: { snapshot: { panes: [], workspaces: [] } } },
      101,
    );
    expect(incomplete.available).toBe(false);
    expect(incomplete.error).toContain("required agent inventory");
  });

  test("does not treat panes as agents when the agent list is empty", () => {
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
    expect(snapshot.agents).toHaveLength(0);
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
    expect(access.capabilities).toEqual([
      "embedded-terminal",
      "native-handoff",
      "close-agent",
      "linked-terminal",
    ]);
    expect(access.linkedExecutions).toHaveLength(4);
    expect(access.linkedExecutions[0]).toMatchObject({
      kind: "shell",
      label: "Beta implementation",
      source: "observed",
      target: { kind: "herdr-terminal-control", token: "fixture-w2:p2" },
    });
    expect(access.mode).toBe("attach");
    expect(access.target?.kind).toBe("herdr-agent-attach");
    expect(access.target?.token).toBe("fixture-w2:p1");
    expect(await Effect.runPromise(adapter.activate(access))).toEqual({
      ok: true,
      message: "Attached to the real Herdr agent fixture-w2:p1.",
    });
    expect(runner.calls.at(-1)).toEqual(["herdr", "agent", "attach", "fixture-w2:p1"]);
    expect(runner.options.at(-1)).toEqual({ interactive: true });
  });

  test("revalidates an opaque Agent target before closing its Herdr pane", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({ runner, clock: new FixedClock(100) });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );

    expect(await Effect.runPromise(adapter.closeAgent(access))).toEqual({
      ok: true,
      message: "Closed Herdr agent fixture-w2:p1.",
    });
    expect(runner.calls).toContainEqual([
      "herdr",
      "pane",
      "send-keys",
      "fixture-w2:p1",
      "ctrl+c",
      "ctrl+c",
    ]);
    expect(runner.calls.at(-1)).toEqual(["herdr", "pane", "close", "fixture-w2:p1"]);
  });

  test("refuses to close a reused Herdr pane identity", async () => {
    if (!isRecord(fixture)) throw new Error("Sanitized Herdr fixture is not a record.");
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({ runner, clock: new FixedClock(100) });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );
    const result = nonEmptyRecord(fixture.result);
    const snapshot = nonEmptyRecord(result.snapshot);
    runner.setResult({
      exitCode: 0,
      stdout: JSON.stringify({
        ...fixture,
        result: {
          ...result,
          snapshot: {
            ...snapshot,
            panes: Array.isArray(snapshot.panes)
              ? snapshot.panes.map((pane) => {
                  if (!isRecord(pane) || stringValue(pane, "pane_id") !== "fixture-w2:p1")
                    return pane;
                  return { ...pane, terminal_id: "replacement-terminal" };
                })
              : [],
          },
        },
      }),
      stderr: "",
    });

    const closed = await Effect.runPromise(adapter.closeAgent(access));

    expect(closed.ok).toBe(false);
    expect(closed.message).toContain("target changed");
    expect(runner.calls.some((call) => call.slice(0, 3).join(" ") === "herdr pane close")).toBe(
      false,
    );
  });

  test("classifies a recognized sibling pane as an agent linked execution", async () => {
    if (!isRecord(fixture)) throw new Error("Sanitized Herdr fixture is not a record.");
    const result = nonEmptyRecord(fixture.result);
    const snapshot = nonEmptyRecord(result.snapshot);
    const panes = Array.isArray(snapshot.panes) ? snapshot.panes.filter(isRecord) : [];
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents.filter(isRecord) : [];
    const siblingPane = panes.find((pane) => stringValue(pane, "pane_id") === "fixture-w2:p2");
    if (!siblingPane) throw new Error("Fixture sibling pane missing.");
    const promotedFixture: JsonRecord = {
      ...fixture,
      result: {
        ...result,
        snapshot: {
          ...snapshot,
          agents: [
            ...agents,
            {
              ...siblingPane,
              agent: "codex",
              display_agent: "codex",
              agent_status: "working",
              name: "Beta implementation agent",
            },
          ],
        },
      },
    };
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(promotedFixture),
      stderr: "",
    });
    const adapter = new HerdrHostAdapter({ runner, clock: new FixedClock(100) });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );
    expect(access.linkedExecutions).toHaveLength(4);
    expect(access.linkedExecutions[0]).toMatchObject({
      kind: "agent",
      label: "Beta implementation",
    });
    expect(access.linkedExecutions.slice(1).every((execution) => execution.kind === "shell")).toBe(
      true,
    );
  });

  test("executes a structured process plan without choosing a provider command", async () => {
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
      adapter.launchExecution({
        requestId: "launch-herdr-test",
        workingDirectory: "/sandbox/alpha",
        agentName: "launch-check",
        processPlan: {
          harnessId: "codex",
          executable: "codex",
          args: ["--model", "o3's model", "start safely"],
        },
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
      "pane",
      "run",
      "fixture-w1:p2",
      "exec 'codex' '--model' 'o3'\"'\"'s model' 'start safely'",
    ]);
    expect(result.executionRef).toBe("fixture-w1:p2");
  });

  test("reports a plan-known opaque conversation reference through Herdr", async () => {
    if (!isRecord(fixture)) throw new Error("Sanitized Herdr fixture is not a record.");
    const result = nonEmptyRecord(fixture.result);
    const snapshot = nonEmptyRecord(result.snapshot);
    const panes = Array.isArray(snapshot.panes) ? snapshot.panes.filter(isRecord) : [];
    const launchedPane = panes.find((pane) => stringValue(pane, "pane_id") === "fixture-w1:p2");
    if (!launchedPane) throw new Error("Sanitized Herdr launch pane is missing.");
    const observedFixture = {
      ...fixture,
      result: {
        ...result,
        snapshot: {
          ...snapshot,
          agents: [
            ...(Array.isArray(snapshot.agents) ? snapshot.agents : []),
            { ...launchedPane, agent: "codex", agent_status: "idle" },
          ],
        },
      },
    };
    const runner = new FakeRunner(
      { exitCode: 0, stdout: JSON.stringify(observedFixture), stderr: "" },
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({ result: { root_pane: { pane_id: "fixture-w1:p2" } } }),
          stderr: "",
        },
      ],
    );
    const adapter = new HerdrHostAdapter({ runner, clock: new FixedClock(100) });

    await Effect.runPromise(
      adapter.launchExecution({
        requestId: "resume-herdr-test",
        workingDirectory: "/sandbox/alpha",
        processPlan: {
          harnessId: "codex",
          executable: "codex",
          args: ["resume", "opaque-session"],
          nativeConversationRef: {
            harnessId: "codex",
            kind: "id",
            value: "opaque-session",
          },
        },
      }),
    );

    expect(runner.calls).toContainEqual([
      "herdr",
      "pane",
      "report-agent-session",
      "fixture-w1:p2",
      "--source",
      "herdr:codex",
      "--agent",
      "codex",
      "--seq",
      "100000000",
      "--agent-session-id",
      "opaque-session",
    ]);
  });

  test("does not echo process launch diagnostics that may contain session data", async () => {
    const runner = new FakeRunner(
      {
        exitCode: 0,
        stdout: JSON.stringify(fixture),
        stderr: "",
      },
      [
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
              code: "pane_run_failed",
              message: "pane rejected the process command",
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
      adapter.launchExecution({
        requestId: "launch-m123456789-duplicate",
        workingDirectory: "/sandbox/alpha",
        processPlan: { harnessId: "codex", executable: "codex", args: [] },
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: "Herdr could not start codex.",
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
      adapter.launchExecution({
        requestId: "launch-herdr-root-pane",
        workingDirectory: "/sandbox/alpha",
        agentName: "root-pane-check",
        processPlan: { harnessId: "codex", executable: "codex", args: [] },
      }),
    );

    expect(result.ok).toBe(true);
    expect(runner.calls).toContainEqual([
      "herdr",
      "pane",
      "run",
      "created-workspace:p1",
      "exec 'codex'",
    ]);
    expect(result.executionRef).toBe("created-workspace:p1");
    expect(runner.calls.filter((call) => call.join(" ") === "herdr api snapshot")).toHaveLength(1);
  });

  test("does not claim access for unavailable or unknown agents", async () => {
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
    expect(access.terminalTarget).toMatchObject({
      kind: "herdr-terminal-control",
      token: "fixture-w2:p1",
    });
    expect(access.terminalTarget?.fingerprint).toContain('"terminalId":"fixture-term-05"');
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
          kind: "bytes",
          value: Uint8Array.of(0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75),
        }),
      ),
    ).toEqual({
      ok: true,
      message: "Input sent to the Herdr terminal.",
    });
    expect(JSON.parse(String(terminalRunner.process.writes[1]))).toEqual({
      type: "terminal.input",
      bytes: "G1sxMzsydQ==",
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
    expect(JSON.parse(String(terminalRunner.process.writes[2]))).toEqual({
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
    expect(JSON.parse(String(terminalRunner.process.writes[3]))).toMatchObject({
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
    expect(terminalRunner.process.writes).toHaveLength(6);
  });

  test("opens an observed shell-only pane as a transient shell linked execution", async () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    });
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("linked shell") } },
      { kind: "closed", reason: "done" },
    ]);
    const adapter = new HerdrHostAdapter({
      runner,
      terminalRunner,
      clock: new FixedClock(100),
    });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );
    const linkedExecution = access.linkedExecutions[0];
    expect(linkedExecution?.target).toMatchObject({
      kind: "herdr-terminal-control",
      token: "fixture-w2:p2",
    });
    expect(linkedExecution?.target?.fingerprint).toContain('"terminalId":"fixture-term-06"');
    const opened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(linkedExecution!, { columns: 60, rows: 18 }),
    );
    expect(opened.ok).toBe(true);
    expect(terminalRunner.calls[0]).toEqual([
      "herdr",
      "terminal",
      "session",
      "control",
      "fixture-w2:p2",
      "--takeover",
      "--cols",
      "60",
      "--rows",
      "18",
    ]);
    await Effect.runPromise(opened.terminal!.release());
  });

  test("rejects a linked target that disappears before open", async () => {
    if (!isRecord(fixture)) throw new Error("Sanitized Herdr fixture is not a record.");
    const result = nonEmptyRecord(fixture.result);
    const snapshot = nonEmptyRecord(result.snapshot);
    const staleFixture: JsonRecord = {
      ...fixture,
      result: {
        ...result,
        snapshot: {
          ...snapshot,
          panes: Array.isArray(snapshot.panes)
            ? snapshot.panes.filter(
                (pane) => stringValue(nonEmptyRecord(pane), "pane_id") !== "fixture-w2:p2",
              )
            : [],
        },
      },
    };
    const runner = new FakeRunner({ exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" }, [
      { exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" },
      { exitCode: 0, stdout: JSON.stringify(staleFixture), stderr: "" },
    ]);
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("should not open") } },
    ]);
    const adapter = new HerdrHostAdapter({
      runner,
      terminalRunner,
      clock: new FixedClock(100),
    });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );
    const opened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(access.linkedExecutions[0]!, { columns: 60, rows: 18 }),
    );
    expect(opened).toMatchObject({ ok: false });
    expect(opened.message).toContain("no longer available");
    expect(terminalRunner.calls).toHaveLength(0);
  });

  test("rejects a linked target whose pane identity is reused", async () => {
    if (!isRecord(fixture)) throw new Error("Sanitized Herdr fixture is not a record.");
    const result = nonEmptyRecord(fixture.result);
    const snapshot = nonEmptyRecord(result.snapshot);
    const reusedFixture: JsonRecord = {
      ...fixture,
      result: {
        ...result,
        snapshot: {
          ...snapshot,
          panes: Array.isArray(snapshot.panes)
            ? snapshot.panes.map((pane) => {
                const record = nonEmptyRecord(pane);
                return stringValue(record, "pane_id") === "fixture-w2:p2"
                  ? { ...record, terminal_id: "fixture-term-reused" }
                  : pane;
              })
            : [],
        },
      },
    };
    const runner = new FakeRunner({ exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" }, [
      { exitCode: 0, stdout: JSON.stringify(reusedFixture), stderr: "" },
    ]);
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("should not open") } },
    ]);
    const adapter = new HerdrHostAdapter({ runner, terminalRunner, clock: new FixedClock(100) });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );
    const opened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(access.linkedExecutions[0]!, { columns: 60, rows: 18 }),
    );
    expect(opened).toMatchObject({ ok: false });
    expect(opened.message).toContain("no longer available");
    expect(terminalRunner.calls).toHaveLength(0);
  });

  test("rejects a primary target that disappears before open", async () => {
    const emptySnapshot = {
      result: { snapshot: { panes: [], agents: [], workspaces: [] } },
    };
    const runner = new FakeRunner({ exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" }, [
      { exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" },
      { exitCode: 0, stdout: JSON.stringify(emptySnapshot), stderr: "" },
    ]);
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("should not open") } },
    ]);
    const adapter = new HerdrHostAdapter({
      runner,
      terminalRunner,
      clock: new FixedClock(100),
    });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }),
    );
    const opened = await Effect.runPromise(adapter.openTerminal(access, { columns: 60, rows: 18 }));
    expect(opened).toMatchObject({ ok: false });
    expect(opened.message).toContain("no longer available");
    expect(terminalRunner.calls).toHaveLength(0);
  });

  test("creates a fresh linked terminal tab in the agent workspace on every request", async () => {
    const preparedSnapshot = {
      result: {
        snapshot: {
          panes: [
            {
              pane_id: "prepared-agent:p1",
              terminal_id: "prepared-term-01",
              workspace_id: "prepared-workspace",
              tab_id: "prepared-workspace:t1",
              cwd: "/sandbox/prepared",
              foreground_cwd: "/sandbox/prepared",
            },
          ],
          agents: [
            {
              pane_id: "prepared-agent:p1",
              agent: "codex",
              name: "prepared-agent",
              agent_status: "idle",
            },
          ],
          workspaces: [
            {
              workspace_id: "prepared-workspace",
              label: "prepared",
              worktree: { checkout_path: "/sandbox/prepared" },
            },
          ],
        },
      },
    };
    const preparedWithShellSnapshot = {
      ...preparedSnapshot,
      result: {
        ...preparedSnapshot.result,
        snapshot: {
          ...preparedSnapshot.result.snapshot,
          panes: [
            ...preparedSnapshot.result.snapshot.panes,
            {
              pane_id: "prepared-shell:p1",
              terminal_id: "prepared-shell-term-01",
              workspace_id: "prepared-workspace",
              tab_id: "prepared-workspace:t2",
              cwd: "/sandbox/prepared",
              foreground_cwd: "/sandbox/prepared",
              terminal_title_stripped: "AO linked terminal",
            },
          ],
        },
      },
    };
    const preparedWithTwoShellsSnapshot = {
      ...preparedWithShellSnapshot,
      result: {
        ...preparedWithShellSnapshot.result,
        snapshot: {
          ...preparedWithShellSnapshot.result.snapshot,
          panes: [
            ...preparedWithShellSnapshot.result.snapshot.panes,
            {
              pane_id: "prepared-shell:p2",
              terminal_id: "prepared-shell-term-02",
              workspace_id: "prepared-workspace",
              tab_id: "prepared-workspace:t3",
              cwd: "/sandbox/prepared",
              foreground_cwd: "/sandbox/prepared",
              terminal_title_stripped: "AO linked terminal",
            },
          ],
        },
      },
    };
    const runner = new FakeRunner(
      {
        exitCode: 0,
        stdout: JSON.stringify(preparedSnapshot),
        stderr: "",
      },
      [
        {
          exitCode: 0,
          stdout: JSON.stringify(preparedSnapshot),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify(preparedSnapshot),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            result: { root_pane: { pane_id: "prepared-shell:p1" } },
          }),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify(preparedWithShellSnapshot),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify(preparedWithShellSnapshot),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            result: { root_pane: { pane_id: "prepared-shell:p2" } },
          }),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout: JSON.stringify(preparedWithTwoShellsSnapshot),
          stderr: "",
        },
      ],
    );
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("linked shell") } },
      { kind: "closed", reason: "done" },
    ]);
    const adapter = new HerdrHostAdapter({
      runner,
      terminalRunner,
      clock: new FixedClock(100),
    });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "prepared-agent:p1" }),
    );
    const linkedExecution = access.linkedExecutions.find(
      (execution) => execution.source === "prepared",
    );
    expect(linkedExecution).toMatchObject({
      source: "prepared",
      target: { kind: "herdr-prepared-shell", token: "/sandbox/prepared" },
    });
    const opened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(linkedExecution!, { columns: 60, rows: 18 }),
    );
    expect(opened.ok).toBe(true);
    expect(runner.calls[2]).toEqual([
      "herdr",
      "tab",
      "create",
      "--workspace",
      "prepared-workspace",
      "--cwd",
      "/sandbox/prepared",
      "--label",
      "AO linked terminal",
      "--no-focus",
    ]);
    expect(terminalRunner.calls[0]).toContain("prepared-shell:p1");
    await Effect.runPromise(opened.terminal!.release());

    const reopened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(linkedExecution!, { columns: 60, rows: 18 }),
    );
    expect(reopened.ok).toBe(true);
    expect(
      runner.calls.filter(
        (call) => call[0] === "herdr" && call[1] === "tab" && call[2] === "create",
      ),
    ).toHaveLength(2);
    expect(terminalRunner.calls[1]).toContain("prepared-shell:p2");
    await Effect.runPromise(reopened.terminal!.release());
  });

  test("fails closed when linked terminal tab creation leaves multiple candidate panes", async () => {
    const preparedSnapshot = {
      result: {
        snapshot: {
          panes: [
            {
              pane_id: "prepared-agent:p1",
              terminal_id: "prepared-term-01",
              workspace_id: "prepared-workspace",
              tab_id: "prepared-workspace:t1",
              cwd: "/sandbox/prepared",
            },
          ],
          agents: [
            {
              pane_id: "prepared-agent:p1",
              agent: "codex",
              name: "prepared-agent",
              agent_status: "idle",
            },
          ],
          workspaces: [],
        },
      },
    };
    const ambiguousSnapshot = {
      ...preparedSnapshot,
      result: {
        ...preparedSnapshot.result,
        snapshot: {
          ...preparedSnapshot.result.snapshot,
          panes: [
            ...preparedSnapshot.result.snapshot.panes,
            {
              pane_id: "candidate-shell:p1",
              terminal_id: "candidate-term-01",
              workspace_id: "candidate-workspace-01",
              tab_id: "candidate-workspace-01:t1",
              cwd: "/sandbox/prepared",
            },
            {
              pane_id: "candidate-shell:p2",
              terminal_id: "candidate-term-02",
              workspace_id: "candidate-workspace-02",
              tab_id: "candidate-workspace-02:t1",
              cwd: "/sandbox/prepared",
            },
          ],
        },
      },
    };
    const runner = new FakeRunner(
      { exitCode: 0, stdout: JSON.stringify(preparedSnapshot), stderr: "" },
      [
        { exitCode: 0, stdout: JSON.stringify(preparedSnapshot), stderr: "" },
        { exitCode: 0, stdout: JSON.stringify(preparedSnapshot), stderr: "" },
        {
          exitCode: 0,
          stdout: JSON.stringify({ result: {} }),
          stderr: "",
        },
        { exitCode: 0, stdout: JSON.stringify(ambiguousSnapshot), stderr: "" },
      ],
    );
    const terminalRunner = new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("should not open") } },
    ]);
    const adapter = new HerdrHostAdapter({ runner, terminalRunner, clock: new FixedClock(100) });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "prepared-agent:p1" }),
    );
    const opened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(access.linkedExecutions[0]!, { columns: 60, rows: 18 }),
    );
    expect(opened).toMatchObject({ ok: false });
    expect(opened.message).toContain("could not identify its shell pane");
    expect(terminalRunner.calls).toHaveLength(0);
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

defineSessionHostContractTests("Herdr", () => ({
  host: new HerdrHostAdapter({
    runner: new FakeRunner({
      exitCode: 0,
      stdout: JSON.stringify(fixture),
      stderr: "",
    }),
    terminalRunner: new FakeTerminalRunner([
      { kind: "frame", frame: { bytes: new TextEncoder().encode("contract") } },
      { kind: "closed", reason: "done" },
    ]),
    clock: new FixedClock(60_000),
  }),
  agent: { hostKind: "herdr", nativeId: "fixture-w2:p1" },
}));
