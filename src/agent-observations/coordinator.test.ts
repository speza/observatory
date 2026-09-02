import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentHarness, AgentObservationSnapshot } from "../plugin-sdk/index.ts";
import { createMemoryStore } from "../persistence/sqlite/sqlite-store.ts";
import { enrichCatchUp, enrichCommandCentre, enrichInspector, enrichMap } from "./projection.ts";
import { hostSnapshot, makeUniverse } from "../universe/test-support.ts";
import { AgentObservationCoordinator } from "./coordinator.ts";

const observedAt = 1_000_000;
const reference = {
  harnessId: "codex",
  continuityScopeId: "scope-test",
  kind: "id",
  value: "sensitive-session-id",
};
const observation = (snapshot: AgentObservationSnapshot) => ({
  schemaVersion: 1 as const,
  describe: () => ({
    kinds: ["activity", "human-input-request", "turn-outcome", "context-pressure"] as const,
    acquisition: "hook" as const,
    delivery: "retained-events-and-snapshot" as const,
    configured: true,
    freshnessSeconds: { activity: 120, "human-input-request": 30 },
  }),
  snapshot: () => Effect.succeed(snapshot),
});

const harness = (snapshot: AgentObservationSnapshot): AgentHarness => ({
  harnessId: "codex",
  observationSource: observation(snapshot),
  describe: () => ({ harnessId: "codex", label: "Codex" }),
  availability: () => Effect.succeed({ available: true, message: "available" }),
  snapshotSessions: () =>
    Effect.succeed({
      harnessId: "codex",
      providerInstanceId: "codex-local-test",
      continuityScopeId: "scope-test",
      observedAt,
      complete: true,
      sessions: [],
      diagnostics: [],
    }),
  planStart: () => Effect.succeed({ harnessId: "codex", executable: "codex", args: [] }),
  planResume: () => Effect.succeed({ harnessId: "codex", executable: "codex", args: [] }),
  proveContinuity: () => Effect.succeed({ kind: "unknown", reason: "test" }),
});

describe("agent observation coordination", () => {
  test("persists, correlates and projects provider evidence without changing accepted state", async () => {
    const store = createMemoryStore();
    const fixture = makeUniverse({ store });
    fixture.universe.execute({ type: "CreateSystem", title: "Provider integrations" });
    fixture.universe.execute({
      type: "CreateGoal",
      title: "Review provider evidence",
      priority: "P1",
      systemId: "system-1",
    });
    expect(
      fixture.universe.execute({
        type: "AddConversation",
        admissionSource: "provider-catalogue",
        resumeEligibility: "same-site",
        harnessId: "codex",
        nativeConversationRef: reference,
        displayName: "Observed Codex",
        observedAt,
        goalId: "goal-1",
      }).ok,
    ).toBe(true);
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "pane-1",
          displayName: "Observed Codex",
          runtimeState: "working",
          runtimeStateSource: "test-host",
          observedAt,
          hostLocator: "opaque:pane-1",
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: reference,
            restoreState: "host-restored",
            source: "native-integration",
            observedAt,
          },
        },
      ]),
    );
    const event = {
      schemaVersion: 1 as const,
      observationId: "permission-1",
      nativeConversationRef: reference,
      providerInstanceId: "codex-local-test",
      kind: "human-input-request" as const,
      observedAt,
      source: { mechanism: "hook" as const },
      payload: {
        requestId: "request-1",
        requestKind: "permission" as const,
        state: "open" as const,
      },
    };
    const sourceSnapshot: AgentObservationSnapshot = {
      schemaVersion: 1,
      harnessId: "codex",
      providerInstanceId: "codex-local-test",
      continuityScopeId: "scope-test",
      capturedAt: observedAt,
      complete: true,
      cursor: "1",
      current: [event],
      transitions: [event],
      health: { state: "healthy", lastSuccessfulAt: observedAt, diagnostics: [] },
    };
    const provider = harness(sourceSnapshot);
    const coordinator = new AgentObservationCoordinator(
      { agentHarnesses: () => [provider] },
      store,
      fixture.universe,
      () => observedAt,
    );
    const acceptedBefore = fixture.universe.snapshot();

    expect(await Effect.runPromise(coordinator.refresh())).toEqual({
      observedSources: 1,
      diagnostics: [],
    });
    expect(fixture.universe.snapshot()).toEqual(acceptedBefore);

    const evidence = coordinator.snapshot();
    const commandCentre = fixture.universe.project({ kind: "command-centre", now: observedAt });
    const map = fixture.universe.project({ kind: "universe-map", now: observedAt });
    const catchUp = fixture.universe.project({ kind: "catch-up", now: observedAt });
    const inspector = fixture.universe.project({
      kind: "inspector",
      now: observedAt,
      target: { type: "agent", id: "agent-1" },
    });
    if (
      commandCentre.kind !== "command-centre" ||
      map.kind !== "universe-map" ||
      catchUp.kind !== "catch-up"
    )
      throw new Error("Unexpected projection.");
    if (
      inspector.kind !== "agent-inspector" &&
      inspector.kind !== "goal-inspector" &&
      inspector.kind !== "empty-inspector"
    )
      throw new Error("Unexpected inspector projection.");

    const enriched = enrichCommandCentre(commandCentre, evidence);
    expect(enriched.attention.items[0]).toMatchObject({
      reason: "provider-input",
      requiresHumanInput: true,
      priority: "P1",
    });
    expect(enriched.goals[0]).toMatchObject({ attentionCount: 1 });
    expect(enriched.systems[0]).toMatchObject({ attentionCount: 1 });
    expect(enriched.counts.attention).toBe(1);
    expect(enrichMap(map, evidence).goals[0]).toMatchObject({ attentionCount: 1 });
    expect(
      enrichCatchUp(catchUp, evidence, enriched)
        .subjects.flatMap((subject) => subject.evidenceGroups ?? [])
        .flatMap((group) => group.items)[0]?.summary,
    ).toContain("permission request open");
    expect(enrichInspector(inspector, evidence)).toMatchObject({
      kind: "agent-inspector",
      agent: { providerEvidence: { request: { kind: "permission", state: "open" } } },
    });
    expect(JSON.stringify(enrichCommandCentre(commandCentre, evidence))).not.toContain(
      "sensitive-session-id",
    );
    expect(
      enrichCommandCentre(commandCentre, {
        ...evidence,
        generatedAt: observedAt + 31_000,
      }).attention.items[0],
    ).toMatchObject({ reason: "provider-stale", requiresHumanInput: false });

    coordinator.acknowledge(observedAt + 1);
    expect(coordinator.snapshot().transitions).toEqual([]);
    expect(store.agentObservationTransitions(0)).toEqual([]);

    const withoutPlugin = new AgentObservationCoordinator(
      { agentHarnesses: () => [] },
      store,
      fixture.universe,
      () => observedAt + 2,
    );
    expect(await Effect.runPromise(withoutPlugin.refresh())).toMatchObject({
      diagnostics: ["codex observation source is no longer loaded."],
    });
    expect(withoutPlugin.snapshot().agents[0]?.health).toBe("unavailable");
  });

  test("correlates scoped provider evidence to one compatible unscoped managed launch", async () => {
    const store = createMemoryStore();
    const fixture = makeUniverse({ store });
    expect(
      fixture.universe.execute({
        type: "AddConversation",
        admissionSource: "managed-launch",
        harnessId: "codex",
        nativeConversationRef: {
          harnessId: "codex",
          kind: reference.kind,
          value: reference.value,
        },
        displayName: "Managed launch",
        observedAt,
      }).ok,
    ).toBe(true);
    const event = {
      schemaVersion: 1 as const,
      observationId: "managed-launch-activity",
      nativeConversationRef: reference,
      providerInstanceId: "codex-local-test",
      kind: "activity" as const,
      observedAt,
      source: { mechanism: "hook" as const },
      payload: { phase: "responding" as const },
    };
    const coordinator = new AgentObservationCoordinator(
      {
        agentHarnesses: () => [
          harness({
            schemaVersion: 1,
            harnessId: "codex",
            providerInstanceId: "codex-local-test",
            continuityScopeId: "scope-test",
            capturedAt: observedAt,
            complete: true,
            current: [event],
            transitions: [event],
            health: { state: "healthy", lastSuccessfulAt: observedAt, diagnostics: [] },
          }),
        ],
      },
      store,
      fixture.universe,
      () => observedAt,
    );

    expect(await Effect.runPromise(coordinator.refresh())).toEqual({
      observedSources: 1,
      diagnostics: [],
    });
    expect(coordinator.snapshot().agents[0]?.current).toHaveLength(1);
    expect(coordinator.snapshot().transitions[0]?.agentId).toBe("agent-1");
  });

  test("ignores an older complete snapshot without clearing newer current evidence", async () => {
    const store = createMemoryStore();
    const fixture = makeUniverse({ store });
    fixture.universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: reference,
      displayName: "Tracked conversation",
      observedAt: 2_000_000,
    });
    let sourceSnapshot: AgentObservationSnapshot = {
      schemaVersion: 1,
      harnessId: "codex",
      providerInstanceId: "codex-local-test",
      continuityScopeId: "scope-test",
      capturedAt: 2_000_000,
      complete: true,
      cursor: "2",
      current: [
        {
          schemaVersion: 1,
          observationId: "activity-current",
          revision: 2,
          nativeConversationRef: reference,
          providerInstanceId: "codex-local-test",
          kind: "activity",
          observedAt: 2_000_000,
          source: { mechanism: "hook" },
          payload: { phase: "responding" },
        },
      ],
      transitions: [],
      health: { state: "healthy", lastSuccessfulAt: 2_000_000, diagnostics: [] },
    };
    const base = harness(sourceSnapshot);
    const provider: AgentHarness = {
      ...base,
      observationSource: {
        ...base.observationSource!,
        snapshot: () => Effect.succeed(sourceSnapshot),
      },
    };
    const coordinator = new AgentObservationCoordinator(
      { agentHarnesses: () => [provider] },
      store,
      fixture.universe,
      () => 3_000_000,
    );
    expect(await Effect.runPromise(coordinator.refresh())).toMatchObject({ observedSources: 1 });
    expect(
      store.markObservationSourceUnavailable(
        "codex",
        provider.observationSource!.describe(),
        1_500_000,
        "stale failure",
        "synthetic-plugin",
      ),
    ).toBe(false);
    expect(store.observationSource("codex")?.health.state).toBe("healthy");

    sourceSnapshot = {
      ...sourceSnapshot,
      capturedAt: 1_500_000,
      complete: true,
      cursor: "1",
      current: [],
      health: { state: "stale", lastSuccessfulAt: 1_500_000, diagnostics: [] },
    };
    const stale = await Effect.runPromise(coordinator.refresh());

    expect(stale.observedSources).toBe(0);
    expect(stale.diagnostics).toContain(
      "Codex returned an out-of-order observation snapshot; it was ignored.",
    );
    expect(store.observationSource("codex")?.capturedAt).toBe(2_000_000);
    expect(store.currentAgentObservations()).toHaveLength(1);
    store.close();
  });

  test("keeps conflicting host and provider evidence visible without replacing host attention", async () => {
    const store = createMemoryStore();
    const fixture = makeUniverse({ store });
    fixture.universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: reference,
      displayName: "Conflicting Codex",
      observedAt,
    });
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "pane-1",
          displayName: "Conflicting Codex",
          runtimeState: "waiting",
          runtimeStateSource: "test-host",
          observedAt,
          hostLocator: "opaque:pane-1",
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: reference,
            restoreState: "host-restored",
            source: "native-integration",
            observedAt,
          },
        },
      ]),
    );
    const activity = {
      schemaVersion: 1 as const,
      observationId: "activity-working",
      nativeConversationRef: reference,
      providerInstanceId: "codex-local-test",
      kind: "activity" as const,
      observedAt,
      source: { mechanism: "hook" as const },
      payload: { phase: "using-tool" as const, toolCategory: "execute" as const },
    };
    const outcome = {
      schemaVersion: 1 as const,
      observationId: "response-completed",
      nativeConversationRef: reference,
      providerInstanceId: "codex-local-test",
      kind: "turn-outcome" as const,
      observedAt,
      source: { mechanism: "hook" as const },
      payload: { outcome: "response-completed" as const },
    };
    const coordinator = new AgentObservationCoordinator(
      {
        agentHarnesses: () => [
          harness({
            schemaVersion: 1,
            harnessId: "codex",
            providerInstanceId: "codex-local-test",
            continuityScopeId: "scope-test",
            capturedAt: observedAt,
            complete: true,
            current: [activity, outcome],
            transitions: [activity, outcome],
            health: { state: "healthy", diagnostics: [] },
          }),
        ],
      },
      store,
      fixture.universe,
      () => observedAt,
    );
    await Effect.runPromise(coordinator.refresh());
    const base = fixture.universe.project({ kind: "command-centre", now: observedAt });
    if (base.kind !== "command-centre") throw new Error("Unexpected projection.");
    const enriched = enrichCommandCentre(base, coordinator.snapshot());

    expect(enriched.attention.items).toHaveLength(1);
    expect(enriched.attention.items[0]).toMatchObject({
      reason: "waiting",
      supportingSignals: [{ reason: "provider-complete" }, { reason: "provider-conflict" }],
    });
    expect(enriched.unassigned[0]).toMatchObject({
      attention: {
        reason: "waiting",
        supportingSignals: [{ reason: "provider-complete" }, { reason: "provider-conflict" }],
      },
      providerEvidence: {
        hostConflict: { hostState: "waiting", providerActivity: "using-tool" },
      },
    });

    fixture.universe.reconcile(
      hostSnapshot(
        [
          {
            nativeId: "pane-1",
            displayName: "Conflicting Codex",
            runtimeState: "working",
            runtimeStateSource: "test-host",
            observedAt: observedAt + 1_000,
            hostLocator: "opaque:pane-1",
            harnessEvidence: {
              detectedHarnessId: "codex",
              nativeConversationRef: reference,
              restoreState: "host-restored",
              source: "native-integration",
              observedAt: observedAt + 1_000,
            },
          },
        ],
        observedAt + 1_000,
      ),
    );
    const resumed = fixture.universe.project({
      kind: "command-centre",
      now: observedAt + 1_000,
    });
    if (resumed.kind !== "command-centre") throw new Error("Unexpected projection.");
    const resumedEvidence = { ...coordinator.snapshot(), generatedAt: observedAt + 1_000 };
    expect(enrichCommandCentre(resumed, resumedEvidence).attention.items).toEqual([]);
    expect(
      enrichCommandCentre(resumed, resumedEvidence).unassigned[0]?.providerEvidence?.outcome,
    ).toBeUndefined();
  });

  test("rejects unbounded snapshots and non-namespaced extension claims", async () => {
    const store = createMemoryStore();
    const fixture = makeUniverse({ store });
    const invalidSnapshot: AgentObservationSnapshot = {
      schemaVersion: 1,
      harnessId: "codex",
      providerInstanceId: "codex-local-test",
      continuityScopeId: "scope-test",
      capturedAt: observedAt,
      complete: true,
      current: [],
      transitions: [],
      health: { state: "healthy", diagnostics: ["x".repeat(301)] },
    };
    const invalidCoordinator = new AgentObservationCoordinator(
      { agentHarnesses: () => [harness(invalidSnapshot)] },
      store,
      fixture.universe,
      () => observedAt,
    );
    expect(await Effect.runPromise(invalidCoordinator.refresh())).toMatchObject({
      observedSources: 0,
      diagnostics: ["Codex returned an invalid observation snapshot."],
    });

    const extensionClaim = {
      schemaVersion: 1 as const,
      observationId: "bad-extension",
      nativeConversationRef: reference,
      providerInstanceId: "codex-local-test",
      kind: "activity" as const,
      observedAt,
      source: { mechanism: "hook" as const },
      payload: { phase: "idle" as const },
      extensions: { "another-plugin/key": "not owned" },
    };
    const extensionCoordinator = new AgentObservationCoordinator(
      {
        agentHarnesses: () => [
          harness({
            ...invalidSnapshot,
            current: [extensionClaim],
            health: { state: "healthy", diagnostics: [] },
          }),
        ],
        agentHarnessPluginId: () => "test-plugin",
      },
      store,
      fixture.universe,
      () => observedAt,
    );
    expect(await Effect.runPromise(extensionCoordinator.refresh())).toMatchObject({
      observedSources: 1,
      diagnostics: ["Codex discarded 1 invalid observations."],
    });
    expect(store.currentAgentObservations()).toEqual([]);
  });

  test("deduplicates replayed transitions and retains the higher current revision", () => {
    const store = createMemoryStore();
    const base = {
      schemaVersion: 1 as const,
      observationId: "activity-1",
      nativeConversationRef: reference,
      providerInstanceId: "codex-local-test",
      kind: "activity" as const,
      observedAt,
      source: { mechanism: "hook" as const },
    };
    const capability = {
      kinds: ["activity", "human-input-request", "turn-outcome", "context-pressure"] as const,
      acquisition: "hook" as const,
      delivery: "retained-events-and-snapshot" as const,
      configured: true,
      freshnessSeconds: { activity: 120 },
    };
    const first = { ...base, revision: 2, payload: { phase: "idle" as const } };
    store.reconcileAgentObservations(
      {
        schemaVersion: 1,
        harnessId: "codex",
        providerInstanceId: "codex-local-test",
        continuityScopeId: "scope-test",
        capturedAt: observedAt,
        complete: false,
        current: [first],
        transitions: [first],
        health: { state: "healthy", diagnostics: [] },
      },
      capability,
      observedAt,
      "test-plugin",
    );
    const late = { ...base, revision: 1, payload: { phase: "responding" as const } };
    store.reconcileAgentObservations(
      {
        schemaVersion: 1,
        harnessId: "codex",
        providerInstanceId: "codex-local-test",
        continuityScopeId: "scope-test",
        capturedAt: observedAt,
        complete: false,
        current: [late],
        transitions: [first],
        health: { state: "healthy", diagnostics: [] },
      },
      capability,
      observedAt,
      "test-plugin",
    );
    expect(store.currentAgentObservations()[0]).toMatchObject({
      revision: 2,
      payload: { phase: "idle" },
    });
    expect(store.agentObservationTransitions(0)).toHaveLength(1);
  });

  test("bounds current claims accumulated from partial snapshots", () => {
    const store = createMemoryStore();
    const capability = {
      kinds: ["activity"] as const,
      acquisition: "hook" as const,
      delivery: "retained-events-and-snapshot" as const,
      configured: true,
      freshnessSeconds: { activity: 120 },
    };
    const claims = (offset: number) =>
      Array.from({ length: 500 }, (_, index) => ({
        schemaVersion: 1 as const,
        observationId: `activity-${offset + index}`,
        nativeConversationRef: reference,
        providerInstanceId: "codex-local-test",
        kind: "activity" as const,
        observedAt: observedAt + offset,
        source: { mechanism: "hook" as const },
        payload: { phase: "idle" as const },
      }));
    for (const offset of [0, 500])
      store.reconcileAgentObservations(
        {
          schemaVersion: 1,
          harnessId: "codex",
          providerInstanceId: "codex-local-test",
          continuityScopeId: "scope-test",
          capturedAt: observedAt + offset,
          complete: false,
          current: claims(offset),
          transitions: [],
          health: { state: "healthy", diagnostics: [] },
        },
        capability,
        observedAt + offset,
        "test-plugin",
      );

    expect(store.currentAgentObservations()).toHaveLength(500);
    expect(
      store.currentAgentObservations().every((claim) => claim.observedAt === observedAt + 500),
    ).toBe(true);
  });

  test("coalesces repeated activity transitions in catch-up", () => {
    const activity = (sequence: number, phase: "using-tool" | "idle") => ({
      sequence,
      agentId: "agent-1",
      observation: {
        schemaVersion: 1 as const,
        observationId: `activity-${sequence}`,
        nativeConversationRef: reference,
        providerInstanceId: "codex-local-test",
        kind: "activity" as const,
        observedAt: observedAt + sequence,
        receivedAt: observedAt + sequence,
        source: { mechanism: "hook" as const },
        payload: { phase },
      },
    });
    const projection = enrichCatchUp(
      {
        kind: "catch-up",
        generatedAt: observedAt,
        throughSequence: 0,
        transitionCount: 0,
        pending: false,
        subjects: [],
        counts: { new: 0, changed: 0, attention: 0, finished: 0, stale: 0 },
      },
      {
        generatedAt: observedAt,
        agents: [],
        transitions: [activity(1, "using-tool"), activity(2, "idle"), activity(3, "using-tool")],
      },
    );

    expect(projection.evidenceTransitionCount).toBe(3);
    expect(
      projection.subjects[0]?.evidenceGroups?.[0]?.items.map(({ sequence }) => sequence),
    ).toEqual([3, 2]);
  });
});
