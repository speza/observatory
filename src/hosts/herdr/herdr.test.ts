import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHerdrSnapshot, HerdrHostAdapter } from "./adapter.ts";
import type { CommandRunner } from "./runner.ts";
import { FixedClock } from "../../universe/test-support.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/herdr/sanitized-snapshot.json", import.meta.url),
    "utf8",
  ),
) as unknown;

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];
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
  async run(argv: readonly string[]) {
    this.calls.push([...argv]);
    return this.result;
  }
}

describe("Herdr adapter", () => {
  test("parses recognized agents into sessions and ignores non-agent panes", () => {
    const snapshot = parseHerdrSnapshot(fixture, 12_345);
    expect(snapshot.available).toBe(true);
    expect(snapshot.sessions).toHaveLength(3);
    expect(
      snapshot.sessions.find((session) => session.nativeId === "fixture-w2:p1")
        ?.runtimeState,
    ).toBe("blocked");
    expect(
      snapshot.sessions.find((session) => session.nativeId === "fixture-w1:p1")
        ?.provider,
    ).toBe("codex");
    expect(snapshot.sessions[0]?.hostLocator).toContain("paneId");
    expect(snapshot.sessions[0]?.hostLocator).not.toContain("terminal output");
    expect(
      snapshot.sessions.some((session) => session.nativeId === "fixture-w1:p2"),
    ).toBe(false);
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

  test("keeps attachment targets opaque and uses the installed focus command", async () => {
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
    expect(access.mode).toBe("focus");
    expect(access.target?.kind).toBe("herdr-agent-focus");
    expect(access.target?.token).toBe("fixture-w2:p1");
    expect(await adapter.activate(access)).toEqual({
      ok: true,
      message: "Focused the real Herdr session fixture-w2:p1.",
    });
    expect(runner.calls.at(-1)).toEqual([
      "herdr",
      "agent",
      "focus",
      "fixture-w2:p1",
    ]);
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
    expect(
      (await adapter.access({ hostKind: "herdr", nativeId: "missing" }))
        .supported,
    ).toBe(false);
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
    expect(
      (await adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }))
        .supported,
    ).toBe(true);
    runner.setResult({ exitCode: 1, stdout: "", stderr: "socket unavailable" });
    await adapter.snapshot();
    expect(
      (await adapter.access({ hostKind: "herdr", nativeId: "fixture-w2:p1" }))
        .supported,
    ).toBe(false);
  });
});
