import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  HarnessError,
  type AgentHarness,
  type ProviderSessionSnapshot,
} from "../plugin-sdk/index.ts";
import { SqliteUniverseStore } from "../persistence/sqlite/sqlite-store.ts";
import { hostSnapshot, makeUniverse } from "../universe/test-support.ts";
import type { Agent } from "../universe/types.ts";
import { ConversationTracker } from "./tracker.ts";

const conversation = (value = "native-secret-id", title = "Regression work") => ({
  nativeConversationRef: {
    harnessId: "codex",
    continuityScopeId: "scope-test",
    kind: "id",
    value,
  },
  nativeConversationAliases: [
    {
      harnessId: "codex",
      continuityScopeId: "scope-test",
      kind: "path",
      value: `/synthetic/${value}.jsonl`,
    },
  ],
  providerInstanceId: "codex-local-test",
  homeSiteRef: "local",
  createdAt: 900_000,
  lastActiveAt: 950_000,
  title,
  workspaceRef: "/synthetic/project",
  resumeEligibility: "same-site" as const,
  provenance: "provider-index" as const,
});

const providerSnapshot = (
  sessions: ProviderSessionSnapshot["sessions"] = [conversation()],
  observedAt = 1_000_000,
): ProviderSessionSnapshot => ({
  harnessId: "codex",
  providerInstanceId: "codex-local-test",
  continuityScopeId: "scope-test",
  observedAt,
  complete: true,
  diagnostics: [],
  sessions,
});

const liveProviderExecution = (nativeId: string, kind = "id", value = "native-secret-id") => ({
  nativeId,
  displayName: "Codex execution",
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

const semanticAgentFacts = (agent: Agent) => ({
  conversation: agent.nativeConversationRef,
  execution: agent.execution,
  presence: agent.executionPresence,
  goal: agent.primaryGoalId,
});

const harnessFor = (snapshot: () => ProviderSessionSnapshot): AgentHarness => ({
  harnessId: "codex",
  describe: () => ({ harnessId: "codex", label: "Codex" }),
  availability: () => Effect.succeed({ available: true, message: "available" }),
  snapshotSessions: () => Effect.succeed(snapshot()),
  planStart: () => Effect.succeed({ harnessId: "codex", executable: "codex", args: [] }),
  planResume: ({ nativeConversationRef }) =>
    Effect.succeed({
      harnessId: "codex",
      executable: "codex",
      args: ["resume", nativeConversationRef.value],
      nativeConversationRef,
    }),
  proveContinuity: () => Effect.succeed({ kind: "unknown", reason: "not observed" }),
});

const trackerFixture = (snapshot: () => ProviderSessionSnapshot = () => providerSnapshot()) => {
  const store = new SqliteUniverseStore(":memory:");
  const fixture = makeUniverse({ store });
  const harness = harnessFor(snapshot);
  const tracker = new ConversationTracker(
    {
      agentHarnesses: () => [harness],
      agentHarness: (harnessId) => (harnessId === harness.harnessId ? harness : undefined),
    },
    store,
    fixture.universe,
  );
  return { ...fixture, store, tracker };
};

describe("conversation tracker", () => {
  test("keeps the first dormant catalogue in history until explicitly added", async () => {
    const fixture = trackerFixture();

    expect(await Effect.runPromise(fixture.tracker.refresh())).toMatchObject({
      observedProviders: 1,
      discoveredConversations: 1,
      admittedConversations: 0,
    });
    const history = fixture.tracker.history();
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain("native-secret-id");

    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Durable goal" });
    const added = fixture.tracker.add(history[0]!.handle, goal.goalId);
    expect(fixture.tracker.history()).toEqual([]);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      id: added.agentId,
      primaryGoalId: goal.goalId,
      displayName: "Regression work",
      displayNameSource: "provider",
      execution: undefined,
      executionPresence: "unknown",
    });
    fixture.store.close();
  });

  test("automatically admits an exact live conversation without import", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());

    const reconciled = fixture.tracker.observeHost(
      hostSnapshot([
        liveProviderExecution("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );

    expect(reconciled.accepted).toBe(true);
    expect(reconciled.addedAgentIds).toHaveLength(1);
    expect(fixture.tracker.history()).toEqual([]);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      nativeConversationRef: { value: "native-secret-id", continuityScopeId: "scope-test" },
      execution: { nativeId: "pane-live" },
      executionPresence: "live",
    });
    fixture.store.close();
  });

  test("automatically admits conversations first observed after the durable baseline", async () => {
    let snapshot = providerSnapshot();
    const fixture = trackerFixture(() => snapshot);
    await Effect.runPromise(fixture.tracker.refresh());
    snapshot = providerSnapshot(
      [conversation(), conversation("new-conversation", "New native work")],
      1_001_000,
    );

    const refreshed = await Effect.runPromise(fixture.tracker.refresh());

    expect(refreshed.admittedConversations).toBe(1);
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      displayName: "New native work",
      executionPresence: "unknown",
      primaryGoalId: undefined,
    });
    expect(fixture.tracker.history()).toHaveLength(1);
    fixture.store.close();
  });

  test("provider-first and host-first observations converge to the same Agent", async () => {
    const providerFirst = trackerFixture();
    await Effect.runPromise(providerFirst.tracker.refresh());
    providerFirst.tracker.observeHost(
      hostSnapshot([
        liveProviderExecution("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );

    const hostFirst = trackerFixture();
    hostFirst.tracker.observeHost(
      hostSnapshot([
        liveProviderExecution("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );
    await Effect.runPromise(hostFirst.tracker.refresh());

    expect(semanticAgentFacts(hostFirst.universe.snapshot().agents[0]!)).toEqual(
      semanticAgentFacts(providerFirst.universe.snapshot().agents[0]!),
    );
    providerFirst.store.close();
    hostFirst.store.close();
  });

  test("canonicalizes a provider-declared alias without transferring Agent metadata", async () => {
    const fixture = trackerFixture();
    fixture.tracker.observeHost(
      hostSnapshot([
        liveProviderExecution("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );
    fixture.universe.execute({ type: "CreateGoal", title: "Existing assignment" });
    fixture.universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    fixture.universe.execute({
      type: "RenameAgent",
      agentId: "agent-1",
      displayName: "Human name",
    });

    await Effect.runPromise(fixture.tracker.refresh());

    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      displayName: "Human name",
      displayNameSource: "human",
      primaryGoalId: "goal-1",
      nativeConversationRef: {
        kind: "id",
        value: "native-secret-id",
        continuityScopeId: "scope-test",
      },
      execution: { nativeId: "pane-live" },
    });
    fixture.store.close();
  });

  test("does not create a durable Agent for an unidentified host execution", () => {
    const fixture = trackerFixture();
    const unidentified = {
      ...liveProviderExecution("unidentified-pane"),
      harnessEvidence: {
        detectedHarnessId: "codex",
        restoreState: "unknown" as const,
        source: "process" as const,
        observedAt: 1_000_000,
      },
    };

    const result = fixture.tracker.observeHost(hostSnapshot([unidentified]));

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("no durable Agent was created");
    expect(fixture.universe.snapshot().agents).toEqual([]);
    fixture.store.close();
  });

  test("preserves the Agent and marks its execution absent after host loss", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.observeHost(hostSnapshot([liveProviderExecution("pane-before-restart")]));
    fixture.tracker.observeHost(hostSnapshot([], 1_001_000));

    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      execution: undefined,
      providerContinuity: "confirmed",
      executionPresence: "absent",
      resumeCapability: "eligible",
      executionHistory: [{ nativeId: "pane-before-restart" }],
    });
    fixture.store.close();
  });

  test("preserves provider uncertainty when the catalogue is unavailable", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.observeHost(hostSnapshot([liveProviderExecution("pane-live")]));
    const unavailableHarness: AgentHarness = {
      ...harnessFor(() => providerSnapshot()),
      snapshotSessions: () =>
        Effect.fail(new HarnessError("catalogue", "Provider catalogue unavailable.")),
    };
    const unavailable = new ConversationTracker(
      {
        agentHarnesses: () => [unavailableHarness],
        agentHarness: () => unavailableHarness,
      },
      fixture.store,
      fixture.universe,
    );

    await Effect.runPromise(unavailable.refresh());

    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      providerContinuity: "unknown",
      resumeCapability: "unknown",
    });
    fixture.store.close();
  });

  test("rejects an ambiguous unscoped host identity instead of choosing a provider scope", () => {
    const fixture = trackerFixture();
    const other = {
      ...conversation(),
      nativeConversationRef: {
        ...conversation().nativeConversationRef,
        continuityScopeId: "scope-other",
      },
      nativeConversationAliases: conversation().nativeConversationAliases.map((alias) => ({
        ...alias,
        continuityScopeId: "scope-other",
      })),
      providerInstanceId: "codex-other-test",
    };
    fixture.store.reconcileProviderCatalogue(providerSnapshot());
    fixture.store.reconcileProviderCatalogue({
      ...providerSnapshot([other]),
      providerInstanceId: "codex-other-test",
      continuityScopeId: "scope-other",
    });
    const scopedExecution = liveProviderExecution("pane-live");
    fixture.universe.reconcile(
      hostSnapshot([
        {
          ...scopedExecution,
          harnessEvidence: {
            ...scopedExecution.harnessEvidence,
            nativeConversationRef: {
              ...scopedExecution.harnessEvidence.nativeConversationRef,
              continuityScopeId: "scope-test",
            },
          },
        },
      ]),
    );

    const result = fixture.tracker.observeHost(
      hostSnapshot([liveProviderExecution("pane-live")], 1_001_000),
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain("cannot replace its scoped conversation");
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]?.nativeConversationRef).toMatchObject({
      continuityScopeId: "scope-test",
    });
    fixture.store.close();
  });
});
