import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  HarnessError,
  type AgentHarness,
  type ProviderSessionSnapshot,
} from "../plugin-sdk/index.ts";
import { SqliteUniverseStore } from "../persistence/sqlite/sqlite-store.ts";
import { hostSnapshot, makeUniverse } from "../universe/test-support.ts";
import { DEFAULT_SYSTEM_ID, type Agent } from "../universe/types.ts";
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

const manuallyAdmittedDiscovery = (nativeId: string, kind = "id", value = "native-secret-id") => {
  const execution = liveProviderExecution(nativeId, kind, value);
  return {
    ...execution,
    harnessEvidence: {
      ...execution.harnessEvidence,
      source: "unknown" as const,
    },
  };
};

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
  test("updates managed launch titles across refreshes while preserving human names", async () => {
    let snapshot = providerSnapshot([conversation("native-secret-id", "project")]);
    const fixture = trackerFixture(() => snapshot);
    fixture.universe.execute({
      type: "AddConversation",
      admissionSource: "managed-launch",
      harnessId: "codex",
      nativeConversationRef: { harnessId: "codex", kind: "id", value: "native-secret-id" },
      displayName: "project",
      observedAt: 1_000_000,
    });
    await Effect.runPromise(fixture.tracker.refresh());
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      displayName: "project",
      displayNameSource: "provider",
    });
    const original = semanticAgentFacts(fixture.universe.snapshot().agents[0]!);
    const refreshTitle = async (title: string) => {
      snapshot = providerSnapshot(
        [conversation("native-secret-id", title)],
        snapshot.observedAt + 1000,
      );
      await Effect.runPromise(fixture.tracker.refresh());
      expect(fixture.universe.snapshot().agents).toHaveLength(1);
      expect(fixture.universe.snapshot().agents[0]).toMatchObject({
        id: "agent-1",
        displayName: title,
        displayNameSource: "provider",
      });
      expect(semanticAgentFacts(fixture.universe.snapshot().agents[0]!)).toEqual(original);
    };
    await refreshTitle("Fix session naming");
    await refreshTitle("Verify generated titles");
    snapshot = providerSnapshot(
      [conversation("native-secret-id", "   ")],
      snapshot.observedAt + 1000,
    );
    await Effect.runPromise(fixture.tracker.refresh());
    expect(fixture.universe.snapshot().agents[0]?.displayName).toBe("Verify generated titles");

    fixture.universe.execute({
      type: "RenameAgent",
      agentId: "agent-1",
      displayName: "My chosen name",
    });
    snapshot = providerSnapshot(
      [conversation("native-secret-id", "Another provider title")],
      snapshot.observedAt + 1000,
    );
    await Effect.runPromise(fixture.tracker.refresh());
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      displayName: "My chosen name",
      displayNameSource: "human",
    });
    fixture.store.close();
  });

  test("serializes concurrent provider refreshes", async () => {
    let active = 0;
    let maximumActive = 0;
    const store = new SqliteUniverseStore(":memory:");
    const fixture = makeUniverse({ store });
    const base = harnessFor(() => providerSnapshot());
    const delayed: AgentHarness = {
      ...base,
      snapshotSessions: () =>
        Effect.promise(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Bun.sleep(10);
          active -= 1;
          return providerSnapshot();
        }),
    };
    const tracker = new ConversationTracker(
      {
        agentHarnesses: () => [delayed],
        agentHarness: () => delayed,
      },
      store,
      fixture.universe,
    );

    await Promise.all([Effect.runPromise(tracker.refresh()), Effect.runPromise(tracker.refresh())]);

    expect(maximumActive).toBe(1);
    store.close();
  });

  test("keeps the first dormant catalogue in history until explicitly added", async () => {
    const fixture = trackerFixture();

    expect(await Effect.runPromise(fixture.tracker.refresh())).toMatchObject({
      observedProviders: 1,
      discoveredConversations: 1,
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

  test("preserves blocked resume eligibility during explicit admission", async () => {
    const blocked = { ...conversation(), resumeEligibility: "blocked" as const };
    const fixture = trackerFixture(() => providerSnapshot([blocked]));
    await Effect.runPromise(fixture.tracker.refresh());

    fixture.tracker.add(fixture.tracker.history()[0]!.handle);

    expect(fixture.universe.snapshot().agents[0]?.resumeCapability).toBe("blocked");
    fixture.store.close();
  });

  test("ignores an older complete catalogue without regressing provider continuity", async () => {
    let snapshot = providerSnapshot([conversation()], 2_000_000);
    const fixture = trackerFixture(() => snapshot);
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.add(fixture.tracker.history()[0]!.handle);

    snapshot = providerSnapshot([], 1_500_000);
    const stale = await Effect.runPromise(fixture.tracker.refresh());

    expect(stale.diagnostics).toEqual([
      "Ignored out-of-order codex catalogue at 1500000; latest accepted observation is 2000000.",
    ]);
    expect(fixture.store.conversations()).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      providerContinuity: "confirmed",
      resumeCapability: "eligible",
      providerObservedAt: 2_000_000,
    });
    fixture.store.close();
  });

  test("automatically syncs an exact live conversation into the Inbox", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());

    const reconciled = fixture.tracker.observeHost(
      hostSnapshot([
        liveProviderExecution("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );

    expect(reconciled.accepted).toBe(true);
    expect(reconciled.diagnostics.join(" ")).not.toContain("untracked");
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      primaryGoalId: undefined,
      execution: { nativeId: "pane-live" },
      runtimeStateSource: "test-host",
    });
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toEqual([]);
    expect(projection.unassigned).toHaveLength(1);
    expect(fixture.tracker.history()).toHaveLength(0);
    fixture.store.close();
  });

  test("keeps an untrusted exact execution in discovery for explicit admission", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.observeHost(
      hostSnapshot([
        manuallyAdmittedDiscovery("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );
    const before = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (before.kind !== "command-centre") throw new Error("wrong projection");
    const discovery = before.discoveredExecutions?.[0];
    expect(discovery?.admission.status).toBe("available");
    expect(discovery?.conversationIdentified).toBe(true);
    expect(discovery?.conversation).toEqual({ kind: "id", id: "native-secret-id" });
    const admitted = fixture.tracker.admitDiscovered(discovery!.handle);
    expect(admitted).toMatchObject({ message: "Execution added to Observatory Inbox." });
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      id: admitted.agentId,
      execution: { nativeId: "pane-live" },
    });
    expect(fixture.universe.project({ kind: "command-centre", now: 1_000_000 })).toMatchObject({
      discoveredExecutions: [],
      counts: { agents: 1, discovered: 0 },
    });
    fixture.store.close();
  });

  test("admits an unscoped discovery through its unique scoped catalogue entry", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.observeHost(hostSnapshot([manuallyAdmittedDiscovery("pane-unscoped")]));
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    const discovery = projection.discoveredExecutions?.[0];
    expect(discovery?.admission.status).toBe("available");

    const admitted = fixture.tracker.admitDiscovered(discovery!.handle);

    expect(admitted).toMatchObject({ message: "Execution added to Observatory Inbox." });
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "native-secret-id",
      },
      execution: { nativeId: "pane-unscoped" },
    });
    fixture.store.close();
  });

  test("files an admitted discovery through the selected Goal in the Default system", async () => {
    const fixture = trackerFixture();
    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Default work" });
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.observeHost(
      hostSnapshot([
        manuallyAdmittedDiscovery("pane-default", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");

    const admitted = fixture.tracker.admitDiscovered(
      projection.discoveredExecutions![0]!.handle,
      goal.goalId,
    );

    expect(admitted.goalId).toBe(goal.goalId);
    expect(fixture.universe.snapshot().agents[0]?.primaryGoalId).toBe(goal.goalId);
    expect(fixture.universe.snapshot().goals[0]?.systemId).toBe(DEFAULT_SYSTEM_ID);
    fixture.store.close();
  });

  test("refuses to admit an unscoped discovery claimed by two provider scopes", () => {
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
    fixture.tracker.observeHost(hostSnapshot([liveProviderExecution("pane-ambiguous")]));

    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    const discovery = projection.discoveredExecutions?.[0];
    expect(discovery?.admission.status).toBe("available");

    expect(() => fixture.tracker.admitDiscovered(discovery!.handle)).toThrow(
      "Admission identity is ambiguous; refresh the provider catalogue before adding this execution.",
    );
    expect(fixture.universe.snapshot().agents).toEqual([]);
    fixture.store.close();
  });

  test("converges a queued discovery admission with earlier History admission", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.observeHost(
      hostSnapshot([
        manuallyAdmittedDiscovery("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    const handle = projection.discoveredExecutions?.[0]?.handle;
    if (!handle) throw new Error("Expected a discovery handle.");

    const historyAdded = fixture.tracker.add(fixture.tracker.history()[0]!.handle);
    const retried = fixture.tracker.admitDiscovered(handle);

    expect(retried).toMatchObject({
      agentId: historyAdded.agentId,
      message: "Execution was already added to Observatory.",
    });
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    fixture.store.close();
  });

  test("reports partial success when discovered admission cannot assign its Goal", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Finished goal" });
    fixture.universe.execute({ type: "CompleteGoal", goalId: goal.goalId! });
    fixture.universe.execute({ type: "ArchiveGoal", goalId: goal.goalId! });
    fixture.tracker.observeHost(
      hostSnapshot([
        manuallyAdmittedDiscovery("pane-live", "path", "/synthetic/native-secret-id.jsonl"),
      ]),
    );
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    const result = fixture.tracker.admitDiscovered(
      projection.discoveredExecutions![0]!.handle,
      goal.goalId,
    );
    expect(result.partial).toBe(true);
    expect(result.goalId).toBeUndefined();
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]?.primaryGoalId).toBeUndefined();
    fixture.store.close();
  });

  test("keeps newly discovered conversations in history until explicitly added", async () => {
    let snapshot = providerSnapshot();
    const fixture = trackerFixture(() => snapshot);
    await Effect.runPromise(fixture.tracker.refresh());
    snapshot = providerSnapshot(
      [conversation(), conversation("new-conversation", "New native work")],
      1_001_000,
    );

    await Effect.runPromise(fixture.tracker.refresh());

    expect(fixture.universe.snapshot().agents).toEqual([]);
    expect(fixture.tracker.history()).toHaveLength(2);
    expect(fixture.tracker.history().map(({ title }) => title)).toContain("New native work");
    fixture.store.close();
  });

  test("explicit admission binds the same Agent whether host or provider is observed first", async () => {
    const providerFirst = trackerFixture();
    await Effect.runPromise(providerFirst.tracker.refresh());
    providerFirst.tracker.add(providerFirst.tracker.history()[0]!.handle);
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
    expect(hostFirst.universe.snapshot().agents).toHaveLength(1);

    expect(semanticAgentFacts(hostFirst.universe.snapshot().agents[0]!)).toEqual(
      semanticAgentFacts(providerFirst.universe.snapshot().agents[0]!),
    );
    providerFirst.store.close();
    hostFirst.store.close();
  });

  test("canonicalizes a provider-declared alias without transferring Agent metadata", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.add(fixture.tracker.history()[0]!.handle);
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
    expect(result.diagnostics.join(" ")).toContain("untracked");
    expect(fixture.universe.snapshot().agents).toEqual([]);
    fixture.store.close();
  });

  test("automatically promotes an unscoped host identity with unique catalogue evidence", () => {
    const fixture = trackerFixture();
    fixture.store.reconcileProviderCatalogue(providerSnapshot());

    const result = fixture.tracker.observeHost(
      hostSnapshot([liveProviderExecution("unscoped-host", "id", "native-secret-id")]),
    );

    expect(result.accepted).toBe(true);
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toEqual([]);
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "native-secret-id",
      },
      execution: { nativeId: "unscoped-host" },
    });
    fixture.store.close();
  });

  test("removes a host-synced execution from the active map after confirmed host loss", () => {
    const fixture = trackerFixture();
    fixture.tracker.observeHost(hostSnapshot([liveProviderExecution("pane-before-close")]));
    fixture.tracker.observeHost(hostSnapshot([], 1_001_000));

    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      execution: undefined,
      executionPresence: "absent",
      executionHistory: [{ nativeId: "pane-before-close" }],
    });
    const projection = fixture.universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.counts.agents).toBe(0);
    expect(fixture.universe.project({ kind: "search", query: "Codex" })).toMatchObject({
      results: [{ id: "agent-1" }],
    });
    fixture.store.close();
  });

  test("preserves the Agent and marks its execution absent after host loss", async () => {
    const fixture = trackerFixture();
    await Effect.runPromise(fixture.tracker.refresh());
    fixture.tracker.add(fixture.tracker.history()[0]!.handle);
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
    fixture.tracker.add(fixture.tracker.history()[0]!.handle);
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

  test("ignores an ambiguous unscoped host identity instead of choosing a provider scope", () => {
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
    fixture.universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: conversation().nativeConversationRef,
      displayName: "Tracked conversation",
      observedAt: 1_000_000,
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

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("Ignored unscoped provider identity");
    expect(fixture.universe.snapshot().agents).toHaveLength(1);
    expect(fixture.universe.snapshot().agents[0]?.nativeConversationRef).toMatchObject({
      continuityScopeId: "scope-test",
    });
    fixture.store.close();
  });
});
