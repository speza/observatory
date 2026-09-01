import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { loadPluginRegistry } from "../../src/plugins/registry.ts";
import { createPiObservationExtension } from "./pi-observation-extension.ts";
import { recordProviderHook } from "./provider-observation-hook.ts";
import {
  observationInstallManifest,
  observationScope,
} from "./provider-observation-installation.ts";
import { ProviderObservationJournal } from "./provider-observation-journal.ts";
import { inspectProviderObservations } from "../../scripts/doctor-provider-observations.ts";

const harnessesPath = join(import.meta.dir);

describe("provider observation hooks", () => {
  test("normalises provider events without retaining raw provider fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-hook-"));
    const outbox = join(root, "claude.jsonl");
    try {
      await recordProviderHook(
        "claude",
        {
          hook_event_name: "PermissionRequest",
          session_id: "session-1",
          tool_name: "Bash",
        },
        { outbox, providerRoot: join(root, "projects"), now: 100 },
      );
      await writeFile(
        outbox,
        (await readFile(outbox, "utf8")).replace("request:permission", "request:legacy"),
      );
      await recordProviderHook(
        "claude",
        {
          hook_event_name: "PostToolUse",
          session_id: "session-1",
          tool_name: "Bash",
          tool_use_id: "tool-1",
        },
        { outbox, providerRoot: join(root, "projects"), now: 101 },
      );
      const text = await readFile(outbox, "utf8");
      expect(text).not.toContain("command");
      expect(text).not.toContain("prompt");
      expect(text).not.toContain("tool-1");
      expect(text).toContain('"state":"open"');
      expect(text).toContain('"state":"resolved"');
      expect(text).toContain('"current":false');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a resolved request tombstone removes the retained current claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-source-"));
    const projects = join(root, "projects");
    const outbox = join(root, "claude.jsonl");
    await mkdir(projects, { recursive: true });
    await writeFile(join(projects, "sessions-index.json"), JSON.stringify({ entries: [] }));
    try {
      const emit = (event: string, now: number) =>
        recordProviderHook(
          "claude",
          {
            hook_event_name: event,
            session_id: "session-1",
            tool_name: "Bash",
          },
          { outbox, providerRoot: projects, now },
        );
      await emit("PermissionRequest", 100);
      await emit("PostToolUse", 101);
      const registry = await Effect.runPromise(
        loadPluginRegistry({
          packages: [
            {
              path: harnessesPath,
              config: { claudeProjectsRoot: projects, claudeObservationOutbox: outbox },
            },
          ],
        }),
      );
      const claude = registry.agentHarnesses().find(({ harnessId }) => harnessId === "claude")!;
      const snapshot = await Effect.runPromise(
        claude.observationSource!.snapshot({ providerInstanceId: "", limit: 20 }),
      );
      expect(snapshot.current).toEqual([
        expect.objectContaining({ kind: "activity", payload: { phase: "responding" } }),
      ]);
      expect(snapshot.transitions).toHaveLength(3);
      const first = await Effect.runPromise(
        claude.observationSource!.snapshot({ providerInstanceId: "", limit: 1 }),
      );
      const second = await Effect.runPromise(
        claude.observationSource!.snapshot({
          providerInstanceId: "",
          afterCursor: first.cursor,
          limit: 1,
        }),
      );
      const third = await Effect.runPromise(
        claude.observationSource!.snapshot({
          providerInstanceId: "",
          afterCursor: second.cursor,
          limit: 1,
        }),
      );
      expect([first, second, third].flatMap(({ transitions }) => transitions)).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("new work supersedes the previous completed outcome", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-turn-"));
    const projects = join(root, "projects");
    const outbox = join(root, "claude.jsonl");
    await mkdir(projects, { recursive: true });
    await writeFile(join(projects, "sessions-index.json"), JSON.stringify({ entries: [] }));
    try {
      await recordProviderHook(
        "claude",
        { hook_event_name: "Stop", session_id: "session-1" },
        { outbox, providerRoot: projects, now: 100 },
      );
      await recordProviderHook(
        "claude",
        { hook_event_name: "UserPromptSubmit", session_id: "session-1" },
        { outbox, providerRoot: projects, now: 101 },
      );
      const registry = await Effect.runPromise(
        loadPluginRegistry({
          packages: [
            {
              path: harnessesPath,
              config: { claudeProjectsRoot: projects, claudeObservationOutbox: outbox },
            },
          ],
        }),
      );
      const source = registry
        .agentHarnesses()
        .find(({ harnessId }) => harnessId === "claude")!.observationSource!;
      const snapshot = await Effect.runPromise(
        source.snapshot({ providerInstanceId: "", limit: 20 }),
      );
      expect(snapshot.current).toEqual([
        expect.objectContaining({ kind: "activity", payload: { phase: "responding" } }),
      ]);
      expect(snapshot.transitions).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("tool completion does not fabricate a permission resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-tool-"));
    const outbox = join(root, "codex.jsonl");
    try {
      await recordProviderHook(
        "codex",
        {
          hook_event_name: "PostToolUse",
          session_id: "session-1",
          turn_id: "turn-1",
          tool_name: "shell",
          tool_use_id: "tool-1",
        },
        { outbox, providerRoot: join(root, "codex"), now: 100 },
      );
      const text = await readFile(outbox, "utf8");
      expect(text).not.toContain('"state":"resolved"');
      expect(text).toContain('"phase":"responding"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("compacts retained transitions and repairs malformed historic rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-compact-"));
    const outbox = join(root, "codex.jsonl");
    const providerRoot = join(root, "codex");
    const continuityScopeId = observationScope("codex", providerRoot);
    const rows = Array.from({ length: 1_100 }, (_, index) => ({
      current: true,
      sequence: index + 1,
      transition: true,
      observation: {
        schemaVersion: 1,
        observationId: "activity",
        revision: index + 1,
        nativeConversationRef: {
          harnessId: "codex",
          continuityScopeId,
          kind: "id",
          value: "session-1",
        },
        providerInstanceId: `codex-local-${continuityScopeId}`,
        observedAt: index + 1,
        source: { mechanism: "hook" },
        kind: "activity",
        payload: { phase: "responding" },
      },
    }));
    await writeFile(outbox, `${rows.map((row) => JSON.stringify(row)).join("\n")}\nnot-json\n`);
    try {
      await recordProviderHook(
        "codex",
        { hook_event_name: "Stop", session_id: "session-1" },
        { outbox, providerRoot, now: 2_000 },
      );
      const text = await readFile(outbox, "utf8");
      expect(text).not.toContain("not-json");
      expect(text.trim().split("\n").length).toBeLessThanOrEqual(1_002);
      const snapshot = await Effect.runPromise(
        new ProviderObservationJournal({
          harnessId: "codex",
          path: outbox,
          root: providerRoot,
        }).snapshot({ providerInstanceId: "", afterCursor: "1", limit: 20 }),
      );
      expect(snapshot.health.state).toBe("degraded");
      expect(snapshot.health.diagnostics).toContain(
        "Observation transition history was compacted beyond the requested cursor.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("foreign journal rows cannot influence current provider state", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-foreign-"));
    const outbox = join(root, "codex.jsonl");
    const providerRoot = join(root, "codex");
    await writeFile(
      outbox,
      `${JSON.stringify({
        current: true,
        sequence: 1,
        transition: true,
        observation: {
          schemaVersion: 1,
          observationId: "activity",
          revision: 1,
          nativeConversationRef: {
            harnessId: "claude",
            continuityScopeId: "foreign",
            kind: "id",
            value: "session-1",
          },
          providerInstanceId: "claude-local-foreign",
          observedAt: Date.now(),
          source: { mechanism: "hook" },
          kind: "activity",
          payload: { phase: "responding" },
        },
      })}\n`,
    );
    try {
      const journal = new ProviderObservationJournal({
        harnessId: "codex",
        path: outbox,
        root: providerRoot,
      });
      const snapshot = await Effect.runPromise(
        journal.snapshot({ providerInstanceId: "", limit: 20 }),
      );
      expect(snapshot.current).toEqual([]);
      expect(snapshot.health.state).toBe("degraded");
      expect((await journal.inspect()).invalidRows).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not claim a truncated current snapshot is complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-bounded-"));
    const projects = join(root, "projects");
    const outbox = join(root, "claude.jsonl");
    await mkdir(projects, { recursive: true });
    await writeFile(join(projects, "sessions-index.json"), JSON.stringify({ entries: [] }));
    try {
      await recordProviderHook(
        "claude",
        { hook_event_name: "SessionStart", session_id: "session-1" },
        { outbox, providerRoot: projects, now: Date.now() },
      );
      await recordProviderHook(
        "claude",
        { hook_event_name: "SessionStart", session_id: "session-2" },
        { outbox, providerRoot: projects, now: Date.now() },
      );
      const registry = await Effect.runPromise(
        loadPluginRegistry({
          packages: [
            {
              path: harnessesPath,
              config: { claudeProjectsRoot: projects, claudeObservationOutbox: outbox },
            },
          ],
        }),
      );
      const source = registry
        .agentHarnesses()
        .find(({ harnessId }) => harnessId === "claude")!.observationSource!;
      const snapshot = await Effect.runPromise(
        source.snapshot({ providerInstanceId: "", limit: 1 }),
      );
      expect(snapshot.current).toHaveLength(1);
      expect(snapshot.complete).toBe(false);
      expect(snapshot.health.state).toBe("degraded");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Pi reports completion only after the agent is settled", () => {
    const registered: string[] = [];
    createPiObservationExtension()({
      on: (event) => {
        registered.push(event);
      },
    });
    expect(registered).toContain("agent_settled");
    expect(registered).not.toContain("agent_end");
  });

  test("the installer composes with existing provider configuration and is idempotent", async () => {
    const home = await mkdtemp(join(tmpdir(), "ao-observation-install-"));
    const claudeRoot = join(home, "custom-claude-projects");
    const claudeOutbox = join(home, "custom-observations", "claude.jsonl");
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: "existing-hook" }] }] } }),
    );
    await writeFile(join(home, ".codex", "hooks.json"), JSON.stringify({ hooks: {} }));
    await writeFile(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ packages: ["npm:existing-package"] }),
    );
    try {
      const install = async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            resolve(import.meta.dir, "../../scripts/install-provider-observation-hooks.ts"),
            "--home",
            home,
            "--claude-root",
            claudeRoot,
            "--claude-outbox",
            claudeOutbox,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(await child.exited).toBe(0);
      };
      await install();
      await install();
      const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
      const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
      const pi = JSON.parse(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8"));
      expect(JSON.stringify(claude)).toContain("existing-hook");
      expect(JSON.stringify(claude).match(/provider-observation-hook\.js/g)).toHaveLength(10);
      expect(JSON.stringify(claude)).not.toContain(resolve(import.meta.dir, "../../scripts"));
      expect(JSON.stringify(claude)).toContain('"async":false');
      expect(codex.hooks.SessionEnd[0].hooks[0].timeout).toBe(3);
      expect(JSON.stringify(claude)).toContain(claudeRoot);
      expect(JSON.stringify(claude)).toContain(claudeOutbox);
      expect(await readFile(claudeOutbox, "utf8")).toBe("");
      expect(pi.packages).toEqual(["npm:existing-package"]);
      expect(pi.extensions).toHaveLength(1);
      expect(pi.extensions[0]).toContain("/.local/share/observatory/hooks/build-");
      expect(pi.extensions[0]).not.toContain(resolve(import.meta.dir, "../"));
      expect(await import(`${pi.extensions[0]}?test=${Date.now()}`)).toMatchObject({
        default: expect.any(Function),
      });
      const manifest = JSON.parse(await readFile(observationInstallManifest(home), "utf8"));
      expect(manifest.commandHook).toContain(`build-${manifest.buildId}`);
      const piBundle = await readFile(manifest.piExtension, "utf8");
      expect(piBundle).not.toContain("Bun.");

      const node = Bun.which("node");
      expect(node).toBeDefined();
      const piLock = `${manifest.providers.pi.outbox}.lock`;
      await writeFile(piLock, JSON.stringify({ pid: process.pid, token: "node-smoke-owner" }));
      const nodeSmoke = Bun.spawn(
        [
          node!,
          "--input-type=module",
          "--eval",
          `import { unlink } from "node:fs/promises";
let sessionStart;
const extension = await import(${JSON.stringify(`file://${manifest.piExtension}`)});
extension.default({ on(name, handler) { if (name === "session_start") sessionStart = handler; } });
setTimeout(() => void unlink(${JSON.stringify(piLock)}), 30);
await sessionStart(
  { type: "session_start" },
  { sessionManager: { getSessionId: () => "node-smoke-session" } },
);`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const nodeSmokeError = await new Response(nodeSmoke.stderr).text();
      expect(nodeSmokeError).toBe("");
      expect(await nodeSmoke.exited).toBe(0);

      const doctor = await inspectProviderObservations(home);
      expect(doctor.providers).toHaveLength(3);
      expect(
        doctor.providers.every(({ configured, bundlePresent }) => configured && bundlePresent),
      ).toBe(true);
      expect(doctor.providers.every(({ trust }) => trust === "unknown")).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
