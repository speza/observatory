import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type {
  AgentHarness,
  BoundedProcessRunner,
  OpaqueNativeConversationRef,
  ProcessResult,
} from "../plugin-sdk/index.ts";
import { loadPluginRegistry } from "./registry.ts";

const harnessesPath = resolve(import.meta.dir, "../../plugins/agent-harnesses");

const runner = (exitCode = 0): BoundedProcessRunner => ({
  run: async (argv) => ({
    exitCode,
    stdout: exitCode === 0 ? `${argv[0]} 1.2.3` : "",
    stderr: exitCode === 0 ? "" : "private diagnostic",
    stdoutTruncated: false,
    stderrTruncated: false,
  }),
});

const processResult = (stdout: string, exitCode = 0): ProcessResult => ({
  exitCode,
  stdout,
  stderr: exitCode === 0 ? "" : "private diagnostic with secret-token",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const commandFor = (argv: readonly string[]): string => argv.join("\u0000");

const scriptedRunner = (
  handler: (argv: readonly string[]) => ProcessResult,
): BoundedProcessRunner => ({
  run: async (argv) => handler(argv),
});

const loadHarnesses = async (
  process = runner(),
  config?: Readonly<Record<string, string | number | boolean>>,
): Promise<readonly AgentHarness[]> => {
  const registry = await Effect.runPromise(
    loadPluginRegistry({ packages: [{ path: harnessesPath, config }], runner: process }),
  );
  expect(registry.status()[0]).toMatchObject({
    id: "builtin-agent-harnesses",
    state: "ready",
    capabilities: ["agent-harness"],
  });
  return registry.agentHarnesses();
};

const sessionRef = (harnessId: string, value = "session-123") =>
  ({ harnessId, kind: "id", value }) satisfies OpaqueNativeConversationRef;

describe("agent harness plugins", () => {
  test("loads all built-in harnesses through the contributed registry", async () => {
    const harnesses = await loadHarnesses();

    expect(harnesses.map(({ harnessId }) => harnessId)).toEqual([
      "claude",
      "codex",
      "pi",
      "opencode",
    ]);
    expect(harnesses.map((harness) => harness.describe().label)).toEqual([
      "Claude Code",
      "Codex",
      "Pi",
      "OpenCode",
    ]);
    expect(
      harnesses.every(
        ({ observationSource, observationReceiver }) =>
          observationSource === undefined && observationReceiver === undefined,
      ),
    ).toBe(true);
  });

  test("discovers Claude and Codex from provider metadata without retaining transcript fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-provider-catalogue-"));
    const claudeRoot = join(root, "claude-projects");
    const codexRoot = join(root, "codex");
    const codexSessions = join(codexRoot, "sessions", "2026", "08", "28");
    await mkdir(join(claudeRoot, "synthetic-project"), { recursive: true });
    await mkdir(codexSessions, { recursive: true });
    await writeFile(
      join(claudeRoot, "synthetic-project", "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId: "claude-session",
            firstPrompt: "SECRET_TRANSCRIPT_TEXT",
            summary: "SECRET_SUMMARY_TEXT",
            created: "2026-08-28T10:00:00.000Z",
            modified: "2026-08-28T11:00:00.000Z",
            projectPath: "/synthetic/project",
            isSidechain: false,
          },
        ],
      }),
    );
    await writeFile(
      join(codexRoot, "session_index.jsonl"),
      [
        JSON.stringify({
          id: "codex-session",
          thread_name: "Codex recovery",
          updated_at: "2026-08-28T12:00:00.000Z",
        }),
        JSON.stringify({
          id: "codex-guardian",
          thread_name: "Internal review",
          updated_at: "2026-08-28T12:01:00.000Z",
        }),
      ].join("\n") + "\n",
    );
    await writeFile(
      join(codexSessions, "rollout-codex-session.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-28T09:00:00.000Z",
        payload: {
          id: "codex-session",
          timestamp: "2026-08-28T09:00:00.000Z",
          cwd: "/synthetic/codex",
          source: "cli",
          thread_source: "user",
          base_instructions: "SECRET_TRANSCRIPT_TEXT",
        },
      })}\n`,
    );
    await writeFile(
      join(codexSessions, "rollout-codex-guardian.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-28T09:01:00.000Z",
        payload: {
          id: "codex-guardian",
          parent_thread_id: "codex-session",
          timestamp: "2026-08-28T09:01:00.000Z",
          cwd: "/synthetic/codex",
          source: { subagent: { other: "guardian" } },
          thread_source: "guardian_review",
        },
      })}\n`,
    );

    try {
      const [claude, codex] = await loadHarnesses(runner(), {
        claudeProjectsRoot: claudeRoot,
        codexRoot,
        maxSessions: 20,
      });
      const claudeSnapshot = await Effect.runPromise(claude!.snapshotSessions());
      const codexSnapshot = await Effect.runPromise(codex!.snapshotSessions());

      expect(claudeSnapshot.sessions[0]).toMatchObject({
        workspaceRef: "/synthetic/project",
        resumeEligibility: "same-site",
      });
      expect(codexSnapshot.sessions[0]).toMatchObject({
        title: "Codex recovery",
        workspaceRef: "/synthetic/codex",
      });
      expect(codexSnapshot.sessions).toHaveLength(1);
      expect(JSON.stringify(codexSnapshot.sessions)).not.toContain("codex-guardian");
      expect(JSON.stringify([claudeSnapshot, codexSnapshot])).not.toContain("SECRET_");
      expect(claude!.observationSource).toBeUndefined();
      expect(claude!.observationReceiver).toBeUndefined();
      expect(codex!.observationSource).toBeUndefined();
      expect(codex!.observationReceiver).toBeUndefined();
      expect(claudeSnapshot.sessions[0]?.nativeConversationRef.continuityScopeId).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports bounded availability without exposing process diagnostics", async () => {
    const available = await loadHarnesses();
    expect(await Effect.runPromise(available[0]!.availability())).toMatchObject({
      available: true,
      version: "claude 1.2.3",
    });

    const unavailable = await loadHarnesses(runner(1));
    expect(await Effect.runPromise(unavailable[1]!.availability())).toEqual({
      available: false,
      message: "Codex is unavailable.",
    });
  });

  test("discovers and resumes an exact Pi session", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-pi-catalogue-"));
    const sessions = join(root, "sessions", "synthetic-project");
    await mkdir(sessions, { recursive: true });
    await writeFile(
      join(sessions, "session.jsonl"),
      `${JSON.stringify({
        type: "session",
        id: "pi-session",
        timestamp: "2026-08-28T09:00:00.000Z",
        cwd: "/synthetic/pi",
        prompt: "SECRET_PROMPT",
      })}\n`,
    );
    try {
      const pi = (await loadHarnesses(runner(), { piRoot: root })).find(
        ({ harnessId }) => harnessId === "pi",
      )!;
      const snapshot = await Effect.runPromise(pi.snapshotSessions());
      expect(snapshot.sessions[0]).toMatchObject({
        nativeConversationRef: { value: "pi-session" },
        workspaceRef: "/synthetic/pi",
      });
      expect(JSON.stringify(snapshot)).not.toContain("SECRET_PROMPT");
      expect(
        await Effect.runPromise(
          pi.planResume({
            workingDirectory: "/synthetic/pi",
            nativeConversationRef: sessionRef("pi", "pi-session"),
          }),
        ),
      ).toMatchObject({ executable: "pi", args: ["--session", "pi-session"] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("plans genuinely new sessions without shell command strings", async () => {
    const harnesses = await loadHarnesses();
    const claude = harnesses[0]!;
    const codex = harnesses[1]!;
    const pi = harnesses[2]!;
    const claudePlan = await Effect.runPromise(
      claude.planStart({ workingDirectory: "/repo", prompt: "Do the work" }),
    );
    const codexPlan = await Effect.runPromise(
      codex.planStart({ workingDirectory: "/repo", prompt: "Do the work" }),
    );
    const piPlan = await Effect.runPromise(
      pi.planStart({ workingDirectory: "/repo", prompt: "Do the work" }),
    );

    expect(claudePlan.executable).toBe("claude");
    expect(claudePlan.args[0]).toBe("--session-id");
    expect(claudePlan.nativeConversationRef).toMatchObject({
      harnessId: "claude",
      kind: "id",
    });
    expect(claudePlan.args.at(-1)).toBe("Do the work");
    expect(codexPlan).toMatchObject({ executable: "codex", args: ["Do the work"] });
    expect(codexPlan.nativeConversationRef).toBeUndefined();
    expect(piPlan).toMatchObject({ executable: "pi", args: ["Do the work"] });
    expect(piPlan.nativeConversationRef).toBeUndefined();
    expect(
      (
        await Effect.runPromiseExit(
          codex.planStart({ workingDirectory: "/repo", args: ["resume", "some-session"] }),
        )
      ).pipe(Exit.isFailure),
    ).toBe(true);
    expect(
      (
        await Effect.runPromiseExit(
          claude.planStart({ workingDirectory: "/repo", args: ["--continue"] }),
        )
      ).pipe(Exit.isFailure),
    ).toBe(true);
  });

  test("plans exact resume and rejects another harness reference", async () => {
    const harnesses = await loadHarnesses();
    const claude = harnesses[0]!;
    const codex = harnesses[1]!;

    expect(
      await Effect.runPromise(
        claude.planResume({
          workingDirectory: "/repo",
          nativeConversationRef: sessionRef("claude"),
          prompt: "Continue exactly here",
        }),
      ),
    ).toMatchObject({
      executable: "claude",
      args: ["--resume", "session-123", "Continue exactly here"],
    });
    expect(
      await Effect.runPromise(
        codex.planResume({
          workingDirectory: "/repo",
          nativeConversationRef: sessionRef("codex"),
        }),
      ),
    ).toMatchObject({ executable: "codex", args: ["resume", "session-123"] });
    expect(
      await Effect.runPromise(
        codex.planResume({
          workingDirectory: "/repo",
          nativeConversationRef: sessionRef("codex"),
          args: ["--sandbox", "read-only"],
        }),
      ),
    ).toMatchObject({
      executable: "codex",
      args: ["--sandbox", "read-only", "resume", "session-123"],
    });

    const result = await Effect.runPromiseExit(
      codex.planResume({
        workingDirectory: "/repo",
        nativeConversationRef: sessionRef("claude"),
      }),
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  test("proves same, replaced, absent, and unknown continuity", async () => {
    const harnesses = await loadHarnesses();
    const codex = harnesses[1]!;
    const expected = sessionRef("codex");
    const evidence = {
      executionRef: "pane-1",
      detectedHarnessId: "codex",
      nativeConversationRef: expected,
      source: "native-integration" as const,
      observedAt: 123,
    };

    expect(
      await Effect.runPromise(
        codex.proveContinuity({ expectedNativeConversationRef: expected, observation: evidence }),
      ),
    ).toMatchObject({ kind: "same", nativeConversationRef: expected });
    expect(
      await Effect.runPromise(
        codex.proveContinuity({
          expectedNativeConversationRef: expected,
          observation: { ...evidence, nativeConversationRef: sessionRef("codex", "other") },
        }),
      ),
    ).toMatchObject({ kind: "replaced" });
    expect(
      await Effect.runPromise(codex.proveContinuity({ expectedNativeConversationRef: expected })),
    ).toMatchObject({ kind: "absent" });
    expect(
      await Effect.runPromise(
        codex.proveContinuity({
          expectedNativeConversationRef: expected,
          observation: { ...evidence, nativeConversationRef: undefined },
        }),
      ),
    ).toMatchObject({ kind: "unknown" });
    expect(
      await Effect.runPromise(
        codex.proveContinuity({ observation: evidence, launchExecutionRef: "pane-1" }),
      ),
    ).toMatchObject({ kind: "same" });
  });

  test("catalogues OpenCode root sessions", async () => {
    const process = scriptedRunner((argv) => {
      const command = commandFor(argv);
      if (command === "opencode\u0000--pure\u0000db\u0000path")
        return processResult("/synthetic/opencode-v1.db\n");
      if (argv[0] === "opencode" && argv.includes("session"))
        return processResult(
          JSON.stringify([
            {
              id: "ses_v1_root",
              title: "  OpenCode root  ",
              created: 1_700_000_000_000,
              updated: 1_700_000_001_000,
              directory: "/synthetic/opencode",
              projectId: "private-project-id",
            },
            { id: "", title: "invalid" },
            { id: "ses_v1_child", parentID: "ses_v1_root" },
          ]),
        );
      return processResult("", 1);
    });

    const harnesses = await loadHarnesses(process, { maxSessions: 20 });
    const opencode = harnesses.find(({ harnessId }) => harnessId === "opencode")!;
    const snapshot = await Effect.runPromise(opencode.snapshotSessions());

    expect(snapshot).toMatchObject({
      harnessId: "opencode",
      complete: false,
      sessions: [
        {
          nativeConversationRef: { harnessId: "opencode", kind: "id", value: "ses_v1_root" },
          title: "OpenCode root",
          workspaceRef: "/synthetic/opencode",
          resumeEligibility: "same-site",
          provenance: "provider-index",
        },
      ],
    });
    expect(snapshot.diagnostics).toEqual([
      "1 OpenCode session rows were ignored.",
      "1 OpenCode child sessions were ignored.",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("private-project-id");
  });

  test("queries OpenCode 1 from known workspace hints", async () => {
    const sessionDirectories: string[] = [];
    const processRunner: BoundedProcessRunner = {
      run: async (argv, options) => {
        const command = commandFor(argv);
        if (command === "opencode\u0000--pure\u0000db\u0000path")
          return processResult("/synthetic/opencode-v1.db\n");
        if (argv[0] === "opencode" && argv.includes("session")) {
          sessionDirectories.push(options?.cwd ?? "");
          return processResult(
            JSON.stringify([
              {
                id: options?.cwd === "/synthetic/frontier" ? "ses_frontier" : "ses_observatory",
                title:
                  options?.cwd === "/synthetic/frontier" ? "Frontier work" : "Observatory work",
                directory: options?.cwd ?? "/synthetic/unknown",
                created: 1_700_000_000_000,
                updated: 1_700_000_001_000,
              },
            ]),
          );
        }
        return processResult("", 1);
      },
    };
    const harnesses = await loadHarnesses(processRunner);
    const opencode = harnesses.find(({ harnessId }) => harnessId === "opencode")!;
    const snapshot = await Effect.runPromise(
      opencode.snapshotSessions({ workspaceRefs: ["/synthetic/frontier", "/synthetic/frontier"] }),
    );

    expect(sessionDirectories).toEqual([resolve("."), "/synthetic/frontier"]);
    expect(snapshot.sessions.map((session) => session.title)).toEqual([
      "Observatory work",
      "Frontier work",
    ]);
    expect(snapshot.complete).toBe(true);
  });

  test("gates availability and builds interactive OpenCode plans", async () => {
    const process = scriptedRunner((argv) => {
      if (commandFor(argv) === "opencode\u0000--version") return processResult("opencode 1.2.3");
      if (commandFor(argv) === "opencode\u0000--pure\u0000db\u0000path")
        return processResult("/synthetic/opencode-v1.db");
      return processResult("", 1);
    });
    const harnesses = await loadHarnesses(process);
    const opencode = harnesses.find(({ harnessId }) => harnessId === "opencode")!;

    expect(await Effect.runPromise(opencode.availability())).toMatchObject({
      available: true,
      version: "opencode 1.2.3",
    });
    expect(
      await Effect.runPromise(
        opencode.planStart({
          workingDirectory: "/repo",
          prompt: "Start fresh",
          args: ["--model", "synthetic-model"],
        }),
      ),
    ).toMatchObject({
      executable: "opencode",
      args: ["--prompt", "Start fresh", "--model", "synthetic-model"],
      sensitiveArgumentIndexes: [1],
    });
    expect(
      await Effect.runPromise(
        opencode.planResume({
          workingDirectory: "/repo",
          nativeConversationRef: sessionRef("opencode", "ses_v1_root"),
        }),
      ),
    ).toMatchObject({ executable: "opencode", args: ["--session", "ses_v1_root"] });
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          opencode.planStart({ workingDirectory: "/repo", args: ["--continue"] }),
        ),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          opencode.planResume({
            workingDirectory: "/repo",
            prompt: "Do not drop this",
            nativeConversationRef: sessionRef("opencode", "ses_v1_root"),
          }),
        ),
      ),
    ).toBe(true);
  });

  test("rejects OpenCode lifecycle overrides and extra positionals", async () => {
    const harnesses = await loadHarnesses();
    const opencode = harnesses.find(({ harnessId }) => harnessId === "opencode")!;
    const rejected = [
      ["--session", "ses_other"],
      ["-s", "ses_other"],
      ["-s_ses_other"],
      ["--session=ses_other"],
      ["--continue"],
      ["-c"],
      ["--fork"],
      ["--prompt", "override"],
      ["serve"],
      ["--model", "synthetic-model", "/synthetic/project"],
      ["--model=synthetic-model", "/synthetic/project"],
    ] as const;

    const exits = await Promise.all(
      rejected.map((args) =>
        Effect.runPromiseExit(opencode.planStart({ workingDirectory: "/repo", args: [...args] })),
      ),
    );
    expect(exits.every((exit) => Exit.isFailure(exit))).toBe(true);
    expect(
      await Effect.runPromise(
        opencode.planStart({
          workingDirectory: "/repo",
          args: ["--model", "synthetic-model"],
        }),
      ),
    ).toMatchObject({ args: ["--model", "synthetic-model"] });
  });

  test("keeps OpenCode continuity exact and scoped", async () => {
    const harnesses = await loadHarnesses();
    const opencode = harnesses.find(({ harnessId }) => harnessId === "opencode")!;
    const expected = sessionRef("opencode", "ses_exact");
    const evidence = {
      executionRef: "execution-1",
      detectedHarnessId: "opencode",
      nativeConversationRef: expected,
      source: "native-integration" as const,
      observedAt: 123,
    };

    expect(
      await Effect.runPromise(
        opencode.proveContinuity({
          expectedNativeConversationRef: expected,
          observation: evidence,
        }),
      ),
    ).toMatchObject({ kind: "same", nativeConversationRef: expected });
    expect(
      await Effect.runPromise(
        opencode.proveContinuity({
          expectedNativeConversationRef: { ...expected, continuityScopeId: "scope-a" },
          observation: {
            ...evidence,
            nativeConversationRef: { ...expected, continuityScopeId: "scope-b" },
          },
        }),
      ),
    ).toMatchObject({ kind: "replaced" });
    expect(
      await Effect.runPromise(
        opencode.proveContinuity({
          expectedNativeConversationRef: expected,
          observation: { ...evidence, detectedHarnessId: "codex" },
        }),
      ),
    ).toMatchObject({ kind: "unknown" });
    expect(
      await Effect.runPromise(
        opencode.proveContinuity({ expectedNativeConversationRef: expected }),
      ),
    ).toMatchObject({ kind: "absent" });
    expect(
      await Effect.runPromise(
        opencode.proveContinuity({ observation: evidence, launchExecutionRef: "execution-1" }),
      ),
    ).toMatchObject({ kind: "same" });
  });
});
