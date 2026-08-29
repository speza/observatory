#!/usr/bin/env bun

import { Effect } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HerdrHostAdapter } from "../src/hosts/herdr/adapter.ts";
import { SqliteUniverseStore } from "../src/persistence/sqlite/sqlite-store.ts";
import { loadPluginRegistry } from "../src/plugins/registry.ts";
import { createProjectionModule } from "../src/projection/projection.ts";
import { SystemClock } from "../src/runtime/runtime.ts";
import { createStartAgentCoordinator } from "../src/session-launch/coordinator.ts";
import { Universe } from "../src/universe/universe.ts";
import type { IdGenerator } from "../src/universe/types.ts";
import type { WorkspaceProvider } from "../src/workspaces/types.ts";

if (process.env.AO_LIVE_HARNESS_SMOKE !== "1")
  throw new Error("Set AO_LIVE_HARNESS_SMOKE=1 to run the mutating live Herdr smoke.");

const harnessIds = process.argv.slice(2);
const selectedHarnesses = harnessIds.length > 0 ? harnessIds : ["claude", "codex"];
const directory = mkdtempSync(join(tmpdir(), "ao-live-harness-smoke-"));
const workingDirectory = process.cwd();
const clock = new SystemClock();
const store = new SqliteUniverseStore(join(directory, "observatory.sqlite"));
const host = new HerdrHostAdapter({ clock });
let idSequence = 0;
const ids: IdGenerator = {
  next: (kind) => `${kind}-live-smoke-${++idSequence}`,
};
const workspace: WorkspaceProvider = {
  listChoices: () => Effect.succeed([]),
  prepare: () =>
    Effect.succeed({
      path: workingDirectory,
      worktree: false,
      warnings: [],
    }),
};
const plugins = await Effect.runPromise(
  loadPluginRegistry({
    packages: [{ path: resolve(import.meta.dir, "../plugins/agent-harnesses") }],
    now: () => clock.now(),
  }),
);
const createdExecutions = new Set<string>();
let universe = new Universe(store, clock, ids, createProjectionModule());
const coordinator = () =>
  createStartAgentCoordinator({
    universe,
    host,
    harnesses: plugins,
    workspace,
    receipts: store,
  });
const reconcile = async (): Promise<void> => {
  const result = universe.reconcile(await Effect.runPromise(host.snapshot()));
  if (!result.accepted) throw new Error(result.error ?? "Live Herdr snapshot was rejected.");
};
const retryUntil = async <T>(operation: () => Promise<T>, accepted: (value: T) => boolean) => {
  const attempt = async (remaining: number): Promise<T> => {
    const latest = await operation();
    if (accepted(latest)) return latest;
    if (remaining <= 1)
      throw new Error(`Timed out waiting for live harness evidence: ${JSON.stringify(latest)}`);
    await Bun.sleep(250);
    return attempt(remaining - 1);
  };
  return attempt(80);
};
const cleanup = async (labelPrefix: string): Promise<void> => {
  const snapshot = await Effect.runPromise(host.snapshot());
  await Promise.all(
    snapshot.agents
      .filter(
        (agent) =>
          createdExecutions.has(agent.nativeId) ||
          [agent.displayName, agent.executionContainer?.label].some((label) =>
            label?.startsWith(labelPrefix),
          ),
      )
      .map(async (observation) => {
        const access = await Effect.runPromise(
          host.access({ hostKind: snapshot.hostKind, nativeId: observation.nativeId }),
        );
        await Effect.runPromise(host.closeAgent(access));
      }),
  );
};
const observationSummary = async (labelPrefix: string) => {
  const snapshot = await Effect.runPromise(host.snapshot());
  return snapshot.agents
    .filter((agent) => agent.executionContainer?.label?.startsWith(labelPrefix))
    .map((agent) => ({
      nativeId: agent.nativeId,
      runtimeState: agent.runtimeState,
      harnessId: agent.harnessEvidence?.detectedHarnessId,
      referenceKind: agent.harnessEvidence?.nativeConversationRef?.kind,
      source: agent.harnessEvidence?.source,
      restoreState: agent.harnessEvidence?.restoreState,
    }));
};

const evidence: { harnessId: string; start: string; resume: string; restart: string }[] = [];
try {
  await reconcile();
  const smokeHarness = async (harnessId: string): Promise<void> => {
    const labelPrefix = `AO harness smoke ${harnessId}`;
    const harnessArgs =
      harnessId === "codex"
        ? ([
            "--sandbox",
            "read-only",
            "--dangerously-bypass-hook-trust",
            "--config",
            "check_for_update_on_startup=false",
          ] as const)
        : harnessId === "claude"
          ? (["--permission-mode", "plan"] as const)
          : undefined;
    const startIntent = {
      requestId: `live-start-${harnessId}-${Date.now()}`,
      goal: { kind: "inbox" } as const,
      workspace: { kind: "existing", path: workingDirectory } as const,
      harness: { id: harnessId, args: harnessArgs },
      agentName: labelPrefix,
      prompt: "Reply with exactly AO_HARNESS_SMOKE_OK, then wait for the operator.",
    };
    const started = await retryUntil(
      () => Effect.runPromise(coordinator().start(startIntent)),
      (result) => result.status === "started" && Boolean(result.agentId),
    );
    const agent = await retryUntil(
      async () => {
        await reconcile();
        return universe.snapshot().agents.find((candidate) => candidate.id === started.agentId);
      },
      (candidate) => Boolean(candidate?.nativeConversationRef && candidate.execution),
    );
    if (!agent?.nativeConversationRef || !agent.execution)
      throw new Error(`${harnessId} did not report an exact native conversation.`);
    createdExecutions.add(agent.execution.nativeId);
    await Bun.sleep(3_000);
    await reconcile();
    const access = await Effect.runPromise(host.access(agent.execution));
    if (!access.capabilities.includes("embedded-terminal"))
      throw new Error(`${harnessId} did not expose the host terminal capability.`);
    const closed = await Effect.runPromise(host.closeAgent(access));
    if (!closed.ok) throw new Error(`${harnessId} could not be closed before exact resume.`);
    await reconcile();

    const resumeIntent = {
      requestId: `live-resume-${harnessId}-${Date.now()}`,
      agentId: agent.id,
      args: harnessArgs,
    };
    let resumed;
    try {
      resumed = await retryUntil(
        () => Effect.runPromise(coordinator().resume(resumeIntent)),
        (result) => result.status === "started" && result.agentId === agent.id,
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; observations=${JSON.stringify(await observationSummary(labelPrefix))}`,
        { cause: error },
      );
    }
    const resumedAgent = universe.snapshot().agents.find((candidate) => candidate.id === agent.id);
    if (resumedAgent?.execution) createdExecutions.add(resumedAgent.execution.nativeId);

    universe = new Universe(store, clock, ids, createProjectionModule());
    universe.invalidateRuntimeFacts();
    await reconcile();
    const restored = universe.snapshot().agents.find((candidate) => candidate.id === agent.id);
    if (restored?.continuity !== "proved" || restored.hostHealth !== "live")
      throw new Error(`${harnessId} did not survive the Observatory restart simulation.`);
    evidence.push({
      harnessId,
      start: started.status,
      resume: resumed.status,
      restart: restored.continuity,
    });
    await cleanup(labelPrefix);
    await reconcile();
  };
  await selectedHarnesses.reduce(
    (previous, harnessId) => previous.then(() => smokeHarness(harnessId)),
    Promise.resolve(),
  );
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  await Promise.all(
    selectedHarnesses.map((harnessId) =>
      cleanup(`AO harness smoke ${harnessId}`).catch(() => undefined),
    ),
  );
  await Effect.runPromise(plugins.close());
  store.close();
}
