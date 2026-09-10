import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HerdrHostAdapter } from "./adapter.ts";
import { parseTerminalLayout } from "./layout.ts";
import { FixedClock } from "../../universe/test-support.ts";

const pane = (id: string, tab: string, cwd: string) => ({
  pane_id: id,
  tab_id: tab,
  workspace_id: "fixture-space",
  terminal_id: `terminal-${id}`,
  cwd,
});
const area = { x: 10, y: 2, width: 100, height: 60 };
const fixture = () => ({
  panes: [
    pane("agent", "work", "/project"),
    pane("shell", "work", "/elsewhere"),
    pane("logs", "logs", "/logs"),
  ],
  agents: [
    {
      ...pane("agent", "work", "/project"),
      agent: "codex",
      agent_session: { agent: "codex", kind: "session-id", value: "synthetic-conversation" },
    },
  ],
  workspaces: [{ workspace_id: "fixture-space", label: "Synthetic" }],
  tabs: [
    { tab_id: "work", workspace_id: "fixture-space", label: "Work" },
    { tab_id: "logs", workspace_id: "fixture-space", label: "Logs" },
  ],
  layouts: [
    {
      workspace_id: "fixture-space",
      tab_id: "work",
      zoomed: false,
      area,
      panes: [
        { pane_id: "agent", rect: { ...area, width: 60 } },
        { pane_id: "shell", rect: { ...area, x: 70, width: 40 } },
      ],
    },
    {
      workspace_id: "fixture-space",
      tab_id: "logs",
      zoomed: false,
      area,
      panes: [{ pane_id: "logs", rect: area }],
    },
  ],
});
const fingerprints = new Map(["agent", "shell", "logs"].map((id) => [id, `fingerprint-${id}`]));

describe("host terminal layout translation", () => {
  test("preserves tab order, primary identity and unequal splits with an offset viewport", () => {
    const layout = parseTerminalLayout(fixture(), "agent", fingerprints)!;
    expect(layout.tabs.map((tab) => tab.label)).toEqual(["Work", "Logs"]);
    expect(layout.tabs[0]!.panes).toMatchObject([
      { primary: true, x: 0, y: 0, width: 0.6, height: 1 },
      { primary: false, x: 0.6, y: 0, width: 0.4, height: 1 },
    ]);
  });
  test("rejects missing, duplicate, out-of-bounds, zoomed and stale inventory geometry", () => {
    const missing = fixture();
    missing.layouts[0]!.panes.pop();
    const duplicate = fixture();
    duplicate.layouts[0]!.panes[1]!.pane_id = "agent";
    const outside = fixture();
    outside.layouts[0]!.panes[0]!.rect.width = 200;
    const zoomed = fixture();
    zoomed.layouts[0]!.zoomed = true;
    const overlapping = fixture();
    overlapping.layouts[0]!.panes[1]!.rect.x = 60;
    const missingTab = fixture();
    missingTab.tabs.pop();
    const stale = fixture();
    stale.panes[1]!.tab_id = "logs";
    for (const snapshot of [missing, duplicate, outside, zoomed, stale, overlapping, missingTab])
      expect(parseTerminalLayout(snapshot, "agent", fingerprints)).toBeUndefined();
    expect(parseTerminalLayout(fixture(), "agent", new Map())).toBeUndefined();
    expect(parseTerminalLayout(undefined, "agent", fingerprints)).toBeUndefined();
  });
  test("includes host neighbours with different working directories and clears layout on host loss", async () => {
    let available = true;
    const host = new HerdrHostAdapter({
      clock: new FixedClock(1000),
      runner: {
        run: async () => ({
          exitCode: available ? 0 : 1,
          stdout: JSON.stringify({ result: { snapshot: fixture() } }),
          stderr: "",
        }),
      },
    });
    await Effect.runPromise(host.snapshot());
    const access = await Effect.runPromise(host.access({ hostKind: "herdr", nativeId: "agent" }));
    expect(access.terminalLayout?.tabs).toHaveLength(2);
    expect(
      access.linkedExecutions
        .filter((link) => link.source === "observed")
        .map((link) => link.target?.token),
    ).toEqual(["shell", "logs"]);
    available = false;
    await Effect.runPromise(host.snapshot());
    expect(
      (await Effect.runPromise(host.access({ hostKind: "herdr", nativeId: "agent" })))
        .terminalLayout,
    ).toBeUndefined();
  });
});
