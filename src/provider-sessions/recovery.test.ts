import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HarnessError, type AgentHarness } from "../plugin-sdk/index.ts";
import { SqliteUniverseStore } from "../persistence/sqlite/sqlite-store.ts";
import { hostSnapshot, makeUniverse } from "../universe/test-support.ts";
import { ProviderSessionRecovery } from "./recovery.ts";

const liveProviderExecution = (nativeId: string, kind = "id", value = "native-secret-id") => ({
  nativeId,
  displayName: "Codex recovery",
  runtimeState: "working" as const,
  runtimeStateSource: "test-host",
  observedAt: 1_000_000,
  worktree: "/synthetic/project",
  hostLocator: `opaque:${nativeId}`,
  harnessEvidence: {
    detectedHarnessId: "codex",
    nativeConversationRef: { harnessId: "codex", kind, value },
    restoreState: "host-restored" as const,
    source: "native-integration" as const,
    observedAt: 1_000_000,
  },
});

const harness: AgentHarness = {
  harnessId: "codex",
  describe: () => ({ harnessId: "codex", label: "Codex" }),
  availability: () => Effect.succeed({ available: true, message: "available" }),
  snapshotSessions: () =>
    Effect.succeed({
      harnessId: "codex",
      providerInstanceId: "codex-local-test",
      continuityScopeId: "scope-test",
      observedAt: 1_000_000,
      complete: true,
      diagnostics: [],
      sessions: [
        {
          nativeConversationRef: {
            harnessId: "codex",
            continuityScopeId: "scope-test",
            kind: "id",
            value: "native-secret-id",
          },
          nativeConversationAliases: [
            {
              harnessId: "codex",
              continuityScopeId: "scope-test",
              kind: "path",
              value: "/synthetic/session.jsonl",
            },
          ],
          providerInstanceId: "codex-local-test",
          homeSiteRef: "local",
          createdAt: 900_000,
          lastActiveAt: 950_000,
          title: "Recovered regression work",
          workspaceRef: "/synthetic/project",
          resumeEligibility: "same-site",
          provenance: "provider-index",
        },
      ],
    }),
  planStart: () => Effect.succeed({ harnessId: "codex", executable: "codex", args: [] }),
  planResume: ({ nativeConversationRef }) =>
    Effect.succeed({
      harnessId: "codex",
      executable: "codex",
      args: ["resume", nativeConversationRef.value],
      nativeConversationRef,
    }),
  proveContinuity: () => Effect.succeed({ kind: "unknown", reason: "not observed" }),
};

const registry = {
  agentHarnesses: (): readonly AgentHarness[] => [harness],
  agentHarness: (harnessId: string): AgentHarness | undefined =>
    harnessId === harness.harnessId ? harness : undefined,
};

describe("provider session recovery", () => {
  test("rediscovers candidates without a host and adopts only through a Universe command", async () => {
    const store = new SqliteUniverseStore(":memory:");
    const fixture = makeUniverse({ store });
    const recovery = new ProviderSessionRecovery(registry, store, fixture.universe);

    expect(await Effect.runPromise(recovery.refresh())).toMatchObject({
      observedProviders: 1,
      discoveredSessions: 1,
    });
    const candidates = recovery.candidates();
    expect(candidates).toHaveLength(1);
    expect(JSON.stringify(candidates)).not.toContain("native-secret-id");

    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Recovered goal" });
    const tracked = recovery.track(candidates[0]!.handle, goal.goalId);
    expect(tracked.goalId).toBe(goal.goalId);
    expect(recovery.candidates()).toEqual([]);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      id: tracked.agentId,
      harnessId: "codex",
      primaryGoalId: goal.goalId,
      worktree: "/synthetic/project",
      execution: undefined,
      continuity: "proved",
    });
    store.close();
  });

  test("a fresh empty Observatory database can rebuild recovery candidates", async () => {
    const firstStore = new SqliteUniverseStore(":memory:");
    const firstUniverse = makeUniverse({ store: firstStore }).universe;
    const first = new ProviderSessionRecovery(registry, firstStore, firstUniverse);
    await Effect.runPromise(first.refresh());
    expect(first.candidates()).toHaveLength(1);
    firstStore.close();

    const freshStore = new SqliteUniverseStore(":memory:");
    const freshUniverse = makeUniverse({ store: freshStore }).universe;
    const rediscovered = new ProviderSessionRecovery(registry, freshStore, freshUniverse);
    expect(rediscovered.candidates()).toEqual([]);
    await Effect.runPromise(rediscovered.refresh());
    expect(rediscovered.candidates()).toHaveLength(1);
    freshStore.close();
  });

  test("keeps an exact live provider session in recovery until tracking binds it", async () => {
    const store = new SqliteUniverseStore(":memory:");
    const fixture = makeUniverse({ store });
    const recovery = new ProviderSessionRecovery(registry, store, fixture.universe);
    await Effect.runPromise(recovery.refresh());
    const candidate = recovery.candidates()[0]!;

    expect(
      recovery.reconcileHost(
        hostSnapshot([liveProviderExecution("pane-live", "path", "/synthetic/session.jsonl")]),
      ).accepted,
    ).toBe(true);
    expect(fixture.universe.snapshot().agents).toEqual([]);
    expect(recovery.candidates()[0]).toMatchObject({
      handle: candidate.handle,
      executionState: "exact-live",
    });

    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Keep this work" });
    const tracked = recovery.track(candidate.handle, goal.goalId);
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      id: tracked.agentId,
      primaryGoalId: goal.goalId,
      execution: { nativeId: "pane-live", hostInstanceId: "test-host:default" },
      providerContinuity: "confirmed",
      executionPresence: "live",
    });
    store.close();
  });

  test("marks an unmatched same-workspace execution as possibly live without inferring identity", async () => {
    const store = new SqliteUniverseStore(":memory:");
    const fixture = makeUniverse({ store });
    const recovery = new ProviderSessionRecovery(registry, store, fixture.universe);
    await Effect.runPromise(recovery.refresh());
    const candidate = recovery.candidates()[0]!;

    recovery.reconcileHost(
      hostSnapshot([
        {
          ...liveProviderExecution("unidentified-pane"),
          harnessEvidence: {
            detectedHarnessId: "codex",
            restoreState: "unknown" as const,
            source: "process" as const,
            observedAt: 1_000_000,
          },
        },
      ]),
    );

    expect(recovery.candidates()[0]).toMatchObject({
      handle: candidate.handle,
      executionState: "possibly-live",
    });
    const tracked = recovery.track(candidate.handle);
    expect(
      fixture.universe.snapshot().agents.find((agent) => agent.id === tracked.agentId),
    ).toMatchObject({
      executionPresence: "unknown",
      observationHealth: "fresh",
    });
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre.");
    expect(projection.unassigned.find((agent) => agent.id === tracked.agentId)).toMatchObject({
      lifecycleState: "possibly-running",
      canResume: false,
    });

    recovery.reconcileHost(hostSnapshot([], 1_001_000));
    expect(
      fixture.universe.snapshot().agents.find((agent) => agent.id === tracked.agentId),
    ).toMatchObject({
      executionPresence: "absent",
      observationHealth: "fresh",
    });
    const cleared = fixture.universe.project({ kind: "command-centre", now: 1_001_000 });
    if (cleared.kind !== "command-centre") throw new Error("Expected command centre.");
    expect(cleared.unassigned.find((agent) => agent.id === tracked.agentId)).toMatchObject({
      lifecycleState: "resumable",
      canResume: true,
    });
    store.close();
  });

  test("turns a confirmed provider conversation into one resumable durable Agent after host loss", async () => {
    const store = new SqliteUniverseStore(":memory:");
    const fixture = makeUniverse({ store });
    const recovery = new ProviderSessionRecovery(registry, store, fixture.universe);
    await Effect.runPromise(recovery.refresh());
    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Durable goal" });
    const tracked = recovery.track(recovery.candidates()[0]!.handle, goal.goalId);
    recovery.reconcileHost(hostSnapshot([liveProviderExecution("pane-before-restart")]));
    recovery.reconcileHost(hostSnapshot([], 1_001_000));

    const agent = fixture.universe.snapshot().agents[0]!;
    expect(agent).toMatchObject({
      id: tracked.agentId,
      primaryGoalId: goal.goalId,
      execution: undefined,
      providerContinuity: "confirmed",
      executionPresence: "absent",
      resumeCapability: "eligible",
      observationHealth: "fresh",
      executionHistory: [{ nativeId: "pane-before-restart" }],
    });
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre.");
    expect(projection.goals[0]?.agents[0]).toMatchObject({
      lifecycleState: "resumable",
      canResume: true,
    });
    store.close();
  });

  test("preserves uncertainty when the provider catalogue is unavailable", async () => {
    const store = new SqliteUniverseStore(":memory:");
    const fixture = makeUniverse({ store });
    const recovery = new ProviderSessionRecovery(registry, store, fixture.universe);
    await Effect.runPromise(recovery.refresh());
    recovery.track(recovery.candidates()[0]!.handle);
    const unavailableHarness: AgentHarness = {
      ...harness,
      snapshotSessions: () =>
        Effect.fail(new HarnessError("catalogue", "Provider catalogue unavailable.")),
    };
    const unavailable = new ProviderSessionRecovery(
      {
        agentHarnesses: () => [unavailableHarness],
        agentHarness: () => unavailableHarness,
      },
      store,
      fixture.universe,
    );
    await Effect.runPromise(unavailable.refresh());
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      providerContinuity: "unknown",
      resumeCapability: "unknown",
    });
    await Effect.runPromise(recovery.refresh());
    expect(fixture.universe.snapshot().agents[0]?.providerContinuity).toBe("confirmed");
    store.close();
  });
});
