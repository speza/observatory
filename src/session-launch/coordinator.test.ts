import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { ControlPlaneEventHub, type ControlPlaneEvent } from "../control-plane-events/index.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { createMockScenario } from "../hosts/mock/scenarios.ts";
import { FixedClock, makeUniverse } from "../universe/test-support.ts";
import type {
  PreparedWorkspace,
  WorkspaceProvider,
  WorkspaceSelection,
} from "../workspaces/types.ts";
import { createStartAgentCoordinator } from "./coordinator.ts";
import type { AgentHarness } from "../plugin-sdk/index.ts";
import { SqliteUniverseStore } from "../persistence/sqlite/sqlite-store.ts";

const codexHarness: AgentHarness = {
  harnessId: "codex",
  describe: () => ({ harnessId: "codex", label: "Codex" }),
  availability: () =>
    Effect.succeed({ available: true, version: "test", message: "Codex is available." }),
  snapshotSessions: () =>
    Effect.succeed({
      harnessId: "codex",
      providerInstanceId: "codex-test",
      continuityScopeId: "test",
      observedAt: 0,
      complete: true,
      sessions: [],
      diagnostics: [],
    }),
  planStart: ({ prompt }) =>
    Effect.succeed({
      harnessId: "codex",
      executable: "codex",
      args: prompt ? [prompt] : [],
    }),
  planResume: ({ nativeConversationRef }) =>
    Effect.succeed({
      harnessId: "codex",
      executable: "codex",
      args: ["resume", nativeConversationRef.value],
      nativeConversationRef,
    }),
  proveContinuity: ({ observation, launchExecutionRef }) =>
    Effect.succeed(
      observation !== undefined &&
        observation.executionRef === launchExecutionRef &&
        observation.detectedHarnessId === "codex"
        ? { kind: "same", nativeConversationRef: observation.nativeConversationRef, reason: "same" }
        : { kind: "unknown", reason: "unknown" },
    ),
};

class TestWorkspaceProvider implements WorkspaceProvider {
  listChoices() {
    return Effect.succeed([] as const);
  }

  prepare(_selection: WorkspaceSelection) {
    return Effect.succeed({
      path: "/synthetic/project",
      repository: "synthetic/project",
      branch: "main",
      worktree: false,
      warnings: [],
    } satisfies PreparedWorkspace);
  }
}

describe("agent launch coordinator", () => {
  test("launches, reconciles and assigns an agent exactly once", async () => {
    const clock = new FixedClock(60_000);
    const { universe } = makeUniverse({ clock });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    await Effect.runPromise(host.snapshot()).then((snapshot) => universe.reconcile(snapshot));
    const goal = universe.execute({ type: "CreateGoal", title: "Launch proof" });
    expect(goal.ok).toBe(true);
    const events = new ControlPlaneEventHub();
    const received: ControlPlaneEvent[] = [];
    events.subscribe((batch) => received.push(...batch));
    const coordinator = createStartAgentCoordinator({
      universe,
      host,
      harnesses: { agentHarness: (id) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
      events,
      now: () => clock.now(),
    });
    const intent = {
      requestId: "launch-coordinator-test",
      goal: { kind: "goal", goalId: goal.goalId! } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      harness: { id: "codex" },
      agentName: "coordinator agent",
    };
    const first = await Effect.runPromise(coordinator.start(intent));
    expect(first.status).toBe("started");
    expect(first.agentId).toBeDefined();
    expect(
      universe.snapshot().agents.find((agent) => agent.id === first.agentId)?.primaryGoalId,
    ).toBe(goal.goalId);
    expect(universe.snapshot().agents.find((agent) => agent.id === first.agentId)).toMatchObject({
      displayName: "coordinator agent",
      displayNameSource: "human",
    });
    expect(
      received
        .filter((event) => event.type === "pending-launch-changed")
        .map((event) => event.requestIds),
    ).toEqual([
      ["launch-coordinator-test"],
      ["launch-coordinator-test"],
      ["launch-coordinator-test"],
    ]);
    const second = await Effect.runPromise(coordinator.start(intent));
    expect(second.status).toBe("already-observed");
    expect(universe.snapshot().agents.filter((agent) => agent.provider === "codex")).toHaveLength(
      1,
    );
  });

  test("coalesces concurrent duplicate requests without launching twice", async () => {
    const clock = new FixedClock(62_000);
    const store = new SqliteUniverseStore(":memory:");
    const { universe } = makeUniverse({ clock, store });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    await Effect.runPromise(host.snapshot()).then((snapshot) => universe.reconcile(snapshot));
    const intent = {
      requestId: "concurrent-launch",
      goal: { kind: "inbox" } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      harness: { id: "codex" },
    };
    const options = {
      universe,
      host,
      harnesses: { agentHarness: (id: string) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
      receipts: store,
    };
    const before = (await Effect.runPromise(host.snapshot())).agents.length;

    const results = await Promise.all([
      Effect.runPromise(createStartAgentCoordinator(options).start(intent)),
      Effect.runPromise(createStartAgentCoordinator(options).start(intent)),
    ]);

    expect(results.filter(({ status }) => status === "started")).toHaveLength(1);
    expect(
      results.some(({ status }) => status === "pending" || status === "already-observed"),
    ).toBe(true);
    expect((await Effect.runPromise(host.snapshot())).agents).toHaveLength(before + 1);
    store.close();
  });

  test("binds provider-owned identity when a later observation reports it", async () => {
    const clock = new FixedClock(65_000);
    const { universe } = makeUniverse({ clock });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    const originalSnapshot = host.snapshot.bind(host);
    let hideProviderIdentity = true;
    host.snapshot = () =>
      originalSnapshot().pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          agents: snapshot.agents.map((agent) =>
            agent.nativeId.startsWith("mock-launch-") && hideProviderIdentity
              ? {
                  ...agent,
                  harnessEvidence: agent.harnessEvidence
                    ? { ...agent.harnessEvidence, nativeConversationRef: undefined }
                    : undefined,
                }
              : agent,
          ),
        })),
      );
    await Effect.runPromise(host.snapshot()).then((snapshot) => universe.reconcile(snapshot));
    const goal = universe.execute({ type: "CreateGoal", title: "Asynchronous identity" });
    const coordinator = createStartAgentCoordinator({
      universe,
      host,
      harnesses: { agentHarness: (id) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
    });

    const started = await Effect.runPromise(
      coordinator.start({
        requestId: "provider-owned-identity",
        goal: { kind: "goal", goalId: goal.goalId! },
        workspace: { kind: "existing", path: "/synthetic/project" },
        harness: { id: "codex" },
      }),
    );
    expect(started.status).toBe("pending");
    expect(started.agentId).toBeUndefined();
    expect(
      universe
        .snapshot()
        .agents.filter((agent) => agent.execution?.nativeId.startsWith("mock-launch-")),
    ).toEqual([]);

    hideProviderIdentity = false;
    clock.value += 1;
    universe.reconcile(await Effect.runPromise(host.snapshot()));
    const recovered = await Effect.runPromise(
      coordinator.start({
        requestId: "provider-owned-identity",
        goal: { kind: "goal", goalId: goal.goalId! },
        workspace: { kind: "existing", path: "/synthetic/project" },
        harness: { id: "codex" },
      }),
    );
    expect(recovered.status).toBe("started");
    expect(
      universe.snapshot().agents.find((agent) => agent.id === recovered.agentId),
    ).toMatchObject({
      nativeConversationRef: {
        harnessId: "codex",
        kind: "session-id",
        value: "mock-conversation-1",
      },
      continuity: "proved",
      primaryGoalId: goal.goalId,
    });
  });

  test("does not relaunch a completed request after coordinator restart", async () => {
    const clock = new FixedClock(70_000);
    const store = new SqliteUniverseStore(":memory:");
    const { universe } = makeUniverse({ clock, store });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    await Effect.runPromise(host.snapshot()).then((snapshot) => universe.reconcile(snapshot));
    const intent = {
      requestId: "durable-launch",
      goal: { kind: "inbox" } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      harness: { id: "codex" },
    };
    const options = {
      universe,
      host,
      harnesses: { agentHarness: (id: string) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
      receipts: store,
    };
    const before = (await Effect.runPromise(host.snapshot())).agents.length;
    const first = await Effect.runPromise(createStartAgentCoordinator(options).start(intent));
    expect(first.status).toBe("started");
    const afterFirst = (await Effect.runPromise(host.snapshot())).agents.length;
    expect(afterFirst).toBe(before + 1);

    const retried = await Effect.runPromise(createStartAgentCoordinator(options).start(intent));
    expect(retried.status).toBe("already-observed");
    expect((await Effect.runPromise(host.snapshot())).agents).toHaveLength(afterFirst);
    store.close();
  });

  test("completes a delayed launch from its durable receipt without relaunching", async () => {
    const clock = new FixedClock(75_000);
    const store = new SqliteUniverseStore(":memory:");
    const { universe } = makeUniverse({ clock, store });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    const originalSnapshot = host.snapshot.bind(host);
    const originalLaunch = host.launchExecution.bind(host);
    let hideOneLaunchedObservation = false;
    host.launchExecution = (request) =>
      originalLaunch(request).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result.ok) hideOneLaunchedObservation = true;
          }),
        ),
      );
    host.snapshot = () =>
      originalSnapshot().pipe(
        Effect.map((snapshot) => {
          if (!hideOneLaunchedObservation) return snapshot;
          hideOneLaunchedObservation = false;
          return {
            ...snapshot,
            agents: snapshot.agents.filter((agent) => !agent.nativeId.startsWith("mock-launch-")),
          };
        }),
      );
    await Effect.runPromise(host.snapshot()).then((snapshot) => universe.reconcile(snapshot));
    const goal = universe.execute({ type: "CreateGoal", title: "Delayed identity" });
    const intent = {
      requestId: "delayed-durable-launch",
      goal: { kind: "goal", goalId: goal.goalId! } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      harness: { id: "codex" },
      agentName: "Durable delayed name",
    };
    const options = {
      universe,
      host,
      harnesses: { agentHarness: (id: string) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
      receipts: store,
    };
    const before = (await Effect.runPromise(host.snapshot())).agents.length;
    const coordinator = createStartAgentCoordinator(options);
    const pending = await Effect.runPromise(coordinator.start(intent));
    expect(pending.status).toBe("pending");
    expect(coordinator.pendingLaunches()).toMatchObject([
      {
        requestId: "delayed-durable-launch",
        harnessId: "codex",
        displayName: "Durable delayed name",
        goalId: goal.goalId,
      },
    ]);

    const recoveredCoordinator = createStartAgentCoordinator(options);
    expect(recoveredCoordinator.pendingLaunches()).toHaveLength(1);
    const recovered = (await Effect.runPromise(recoveredCoordinator.refreshPending()))[0]!;
    expect(recovered).toMatchObject({ status: "started", goalId: goal.goalId });
    expect(recoveredCoordinator.pendingLaunches()).toEqual([]);
    expect(
      universe.snapshot().agents.find((agent) => agent.id === recovered.agentId),
    ).toMatchObject({
      displayName: "Durable delayed name",
      displayNameSource: "human",
      primaryGoalId: goal.goalId,
    });
    expect((await Effect.runPromise(host.snapshot())).agents).toHaveLength(before + 1);
    store.close();
  });

  test("durably records pre-launch failure without creating a requested Goal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "observatory-launch-receipt-"));
    const databasePath = join(directory, "universe.sqlite");
    const clock = new FixedClock(78_000);
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    const unavailableHarness: AgentHarness = {
      ...codexHarness,
      availability: () =>
        Effect.succeed({ available: false, message: "Codex is temporarily unavailable." }),
    };
    const intent = {
      requestId: "failed-before-launch",
      goal: { kind: "new-goal", title: "Should not be created" } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      harness: { id: "codex" },
    };
    const before = (await Effect.runPromise(host.snapshot())).agents.length;
    try {
      const firstStore = new SqliteUniverseStore(databasePath);
      const firstUniverse = makeUniverse({ clock, store: firstStore }).universe;
      const first = await Effect.runPromiseExit(
        createStartAgentCoordinator({
          universe: firstUniverse,
          host,
          harnesses: { agentHarness: () => unavailableHarness },
          workspace: new TestWorkspaceProvider(),
          receipts: firstStore,
        }).start(intent),
      );
      expect(Exit.isFailure(first)).toBe(true);
      expect(firstUniverse.snapshot().goals).toEqual([]);
      firstStore.close();

      const recoveredStore = new SqliteUniverseStore(databasePath);
      const recoveredUniverse = makeUniverse({ clock, store: recoveredStore }).universe;
      const retried = await Effect.runPromise(
        createStartAgentCoordinator({
          universe: recoveredUniverse,
          host,
          harnesses: { agentHarness: () => unavailableHarness },
          workspace: new TestWorkspaceProvider(),
          receipts: recoveredStore,
        }).start(intent),
      );
      expect(retried).toMatchObject({
        status: "already-observed",
        requestId: "failed-before-launch",
      });
      expect(retried.message).toContain("Launch setup failed before process placement");
      expect((await Effect.runPromise(host.snapshot())).agents).toHaveLength(before);
      recoveredStore.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a reused request id with a different intent", async () => {
    const clock = new FixedClock(80_000);
    const { universe } = makeUniverse({ clock });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    const coordinator = createStartAgentCoordinator({
      universe,
      host,
      harnesses: { agentHarness: (id) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
    });
    const base = {
      requestId: "conflicting-launch",
      goal: { kind: "inbox" } as const,
      workspace: { kind: "existing", path: "/synthetic/project" } as const,
      harness: { id: "codex" },
    };
    await Effect.runPromise(coordinator.start(base));
    const failure = await Effect.runPromiseExit(
      coordinator.start({ ...base, prompt: "different intent" }),
    );
    expect(Exit.isFailure(failure)).toBe(true);
    expect(JSON.stringify(failure)).toContain("different launch intent");
  });

  test("resumes one exact absent conversation and rebinds the durable Agent", async () => {
    const clock = new FixedClock(90_000);
    const { universe } = makeUniverse({ clock });
    const host = new MockHostAdapter({ clock, scenario: createMockScenario() });
    const coordinator = createStartAgentCoordinator({
      universe,
      host,
      harnesses: { agentHarness: (id) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
    });
    const started = await Effect.runPromise(
      coordinator.start({
        requestId: "exact-resume-start",
        goal: { kind: "inbox" },
        workspace: { kind: "existing", path: "/synthetic/project" },
        harness: { id: "codex" },
      }),
    );
    const saved = universe.snapshot().agents.find((agent) => agent.id === started.agentId);
    if (!saved?.execution) throw new Error("Expected a launched execution.");
    const access = await Effect.runPromise(host.access(saved.execution));
    await Effect.runPromise(host.closeAgent(access));
    clock.value += 1_000;
    universe.reconcile(await Effect.runPromise(host.snapshot()));
    expect(universe.snapshot().agents.find((agent) => agent.id === saved.id)?.hostHealth).toBe(
      "stale",
    );

    const resumed = await Effect.runPromise(
      coordinator.resume({ requestId: "exact-resume-run", agentId: saved.id }),
    );
    expect(resumed).toMatchObject({ status: "started", agentId: saved.id });
    expect(universe.snapshot().agents.find((agent) => agent.id === saved.id)).toMatchObject({
      continuity: "proved",
      hostHealth: "live",
      executionPresence: "live",
      executionHistory: [{ nativeId: saved.execution.nativeId }],
    });
    const currentExecution = universe.snapshot().agents.find((agent) => agent.id === saved.id)
      ?.execution?.nativeId;
    const duplicate = await Effect.runPromise(
      coordinator.resume({ requestId: "exact-resume-second-click", agentId: saved.id }),
    );
    expect(duplicate).toMatchObject({ status: "already-observed", agentId: saved.id });
    expect(
      universe.snapshot().agents.find((agent) => agent.id === saved.id)?.execution?.nativeId,
    ).toBe(currentExecution);
  });

  test("blocks resume when an unidentified live execution may already own the conversation", async () => {
    const clock = new FixedClock(90_000);
    const { universe } = makeUniverse({ clock });
    const host = new MockHostAdapter({
      clock,
      scenario: {
        name: "ambiguous-resume",
        description: "One unidentified Codex execution in the target workspace.",
        tickMs: 60_000,
        frames: [
          {
            label: "live",
            agents: [
              {
                nativeId: "ambiguous-pane",
                displayName: "Durable Codex work",
                runtimeState: "working",
                runtimeStateSource: "mock",
                worktree: "/synthetic/project",
                hostLocator: "mock-agent:ambiguous-pane",
                harnessEvidence: {
                  detectedHarnessId: "codex",
                  restoreState: "unknown",
                  source: "process",
                  observedAt: 90_000,
                },
              },
            ],
          },
        ],
      },
    });
    const adopted = universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "test",
        kind: "id",
        value: "durable-conversation",
      },
      displayName: "Durable Codex work",
      workspaceRef: "/synthetic/project",
      observedAt: 90_000,
    });
    universe.reconcile(await Effect.runPromise(host.snapshot()));
    const uncertain = universe.snapshot().agents.find((agent) => agent.id === adopted.agentId);
    expect(uncertain).toMatchObject({
      executionHistory: [],
      executionPresence: "unknown",
      observationHealth: "fresh",
    });
    const projected = universe.project({ kind: "command-centre", now: clock.now() });
    if (projected.kind !== "command-centre") throw new Error("Expected command centre.");
    expect(projected.unassigned.find((agent) => agent.id === adopted.agentId)).toMatchObject({
      lifecycleState: "runtime-unknown",
      canResume: false,
    });
    clock.value = 91_000;
    const coordinator = createStartAgentCoordinator({
      universe,
      host,
      harnesses: { agentHarness: (id) => (id === "codex" ? codexHarness : undefined) },
      workspace: new TestWorkspaceProvider(),
    });
    const result = await Effect.runPromiseExit(
      coordinator.resume({ requestId: "ambiguous-resume", agentId: adopted.agentId! }),
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("prevent a duplicate");
    expect(universe.snapshot().agents).toHaveLength(1);
  });
});
