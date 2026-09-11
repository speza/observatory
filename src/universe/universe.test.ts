import { describe, expect, test } from "bun:test";
import { ControlPlaneEventHub, type ControlPlaneEvent } from "../control-plane-events/index.ts";
import { createProjectionModule } from "../projection/projection.ts";
import { createEmptyUniverse, Universe } from "./universe.ts";
import {
  DEFAULT_SYSTEM_ID,
  emptyUniverseState,
  safeConversationReference,
  type Agent,
} from "./types.ts";
import {
  makeUniverse,
  hostSnapshot,
  SequenceIds,
  admitObservedConversationsAndReconcile,
} from "./test-support.ts";
const observation = (
  nativeId: string,
  displayName = nativeId,
  runtimeState: "idle" | "working" | "waiting" | "blocked" | "done" | "unknown" = "idle",
  observedAt = 1_000_000,
) => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "test-host",
  observedAt,
  repository: "repo",
  branch: "main",
  worktree: `/worktrees/${nativeId}`,
  provider: "test-provider",
  hostLocator: `opaque:${nativeId}`,
});

const observedConversation = (
  nativeId: string,
  conversationId: string,
  observedAt = 1_000_000,
) => ({
  ...observation(nativeId, "identity worker", "working", observedAt),
  harnessEvidence: {
    detectedHarnessId: "codex",
    nativeConversationRef: { harnessId: "codex", kind: "session-id", value: conversationId },
    restoreState: "host-restored" as const,
    source: "native-integration" as const,
    observedAt,
  },
});

const scopedConversation = (nativeId: string, conversationId: string, observedAt = 1_000_000) => ({
  ...observedConversation(nativeId, conversationId, observedAt),
  harnessEvidence: {
    ...observedConversation(nativeId, conversationId, observedAt).harnessEvidence,
    nativeConversationRef: {
      harnessId: "codex",
      continuityScopeId: "scope-test",
      kind: "session-id",
      value: conversationId,
    },
  },
});

const conversationAlias = (value: string, scope: string) => ({
  harnessId: "codex",
  continuityScopeId: scope,
  kind: "id",
  value,
});

const hostOnlyObservation = (
  nativeId: string,
  displayName = nativeId,
  runtimeState: "idle" | "working" | "waiting" | "blocked" | "done" | "unknown" = "working",
  observedAt = 1_000_000,
) => ({
  ...observation(nativeId, displayName, runtimeState, observedAt),
  harnessEvidence: {
    detectedHarnessId: "codex",
    restoreState: "unknown" as const,
    source: "process" as const,
    observedAt,
  },
});

const safeReference = (kind: string, value: string) =>
  safeConversationReference({ harnessId: "codex", kind, value });

describe("Universe", () => {
  test("publishes committed changes but not failed writes or timestamp-only host refreshes", () => {
    const events = new ControlPlaneEventHub();
    const received: ControlPlaneEvent[] = [];
    events.subscribe((batch) => received.push(...batch));
    const { universe, store } = makeUniverse({ events });

    universe.execute({ type: "CreateSystem", title: "System" });
    expect(received.map((event) => event.type)).toEqual(["system-changed"]);

    store.failNextSave = true;
    universe.execute({ type: "RenameSystem", systemId: "system-1", title: "Failed" });
    expect(received).toHaveLength(1);

    universe.observe({ kind: "host-executions", snapshot: hostSnapshot([], 1_000_000) });
    expect(received.at(-1)?.type).toBe("execution-evidence-changed");
    const afterInitialHost = received.length;
    universe.observe({ kind: "host-executions", snapshot: hostSnapshot([], 2_000_000) });
    expect(received).toHaveLength(afterInitialHost);
  });

  test("preserves a universe that contains systems but no goals or agents", () => {
    const { universe, store, clock } = makeUniverse();
    universe.execute({ type: "CreateSystem", title: "Long-running system" });
    const saves = store.saves;

    const reloaded = createEmptyUniverse(store, clock, new SequenceIds(), createProjectionModule());

    expect(reloaded.snapshot().systems.find((system) => system.id === "system-1")?.title).toBe(
      "Long-running system",
    );
    expect(store.saves).toBe(saves);
  });

  test("seeds one Default system and routes unfiled goals into it", () => {
    const { universe } = makeUniverse();
    expect(universe.snapshot().systems).toMatchObject([
      { id: DEFAULT_SYSTEM_ID, title: "Default" },
    ]);
    expect(universe.execute({ type: "CreateGoal", title: "Unsorted" })).toEqual({
      ok: true,
      goalId: "goal-1",
      systemId: DEFAULT_SYSTEM_ID,
    });
    expect(universe.execute({ type: "AssignGoalToSystem", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.systemId).toBe(DEFAULT_SYSTEM_ID);

    universe.execute({ type: "CreateSystem", title: "Observatory" });
    expect(
      universe.execute({
        type: "AssignGoalToSystem",
        goalId: "goal-1",
        systemId: "system-1",
      }),
    ).toEqual({ ok: true, goalId: "goal-1", systemId: "system-1" });
    expect(universe.execute({ type: "AssignGoalToSystem", goalId: "goal-1" })).toEqual({
      ok: true,
      goalId: "goal-1",
      systemId: DEFAULT_SYSTEM_ID,
    });
  });

  test("adopts legacy unfiled goals into the Default system on load", () => {
    const state = emptyUniverseState();
    state.goals.push({
      id: "goal-legacy",
      title: "Legacy unfiled goal",
      priority: "P2",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });

    const { universe } = makeUniverse({ state });
    const snapshot = universe.snapshot();

    expect(snapshot.systems).toMatchObject([{ id: DEFAULT_SYSTEM_ID, title: "Default" }]);
    expect(snapshot.goals[0]?.systemId).toBe(DEFAULT_SYSTEM_ID);
  });

  test("organises goals into durable human-authored systems", () => {
    const { universe } = makeUniverse();
    expect(
      universe.execute({
        type: "CreateSystem",
        title: "  Observatory  ",
        description: "Agent supervision across repositories.",
      }),
    ).toEqual({ ok: true, systemId: "system-1" });
    expect(
      universe.execute({
        type: "CreateGoal",
        title: "Ship the Atlas",
        systemId: "system-1",
      }),
    ).toEqual({ ok: true, goalId: "goal-1", systemId: "system-1" });
    expect(
      universe.execute({
        type: "CreateGoal",
        title: "Invalid",
        systemId: "missing",
      }),
    ).toEqual({ ok: false, error: "System not found." });
    expect(
      universe.execute({
        type: "RenameSystem",
        systemId: "system-1",
        title: "Observatory product",
      }).ok,
    ).toBe(true);
    expect(
      universe.execute({
        type: "AssignGoalToSystem",
        goalId: "goal-1",
      }).ok,
    ).toBe(true);

    const state = universe.snapshot();
    expect(state.systems.find((system) => system.id === "system-1")?.title).toBe(
      "Observatory product",
    );
    expect(state.goals[0]?.systemId).toBe(DEFAULT_SYSTEM_ID);
  });

  test("enforces goal lifecycle and direct assignment through its interface", () => {
    const { universe, clock } = makeUniverse();
    expect(
      universe.execute({
        type: "CreateGoal",
        title: "  Ship the slice  ",
        priority: "P0",
        description: "Walk the live path.",
      }),
    ).toEqual({ ok: true, goalId: "goal-1", systemId: DEFAULT_SYSTEM_ID });
    expect(
      admitObservedConversationsAndReconcile(
        universe,
        hostSnapshot([observation("pane-1", "live agent", "working")]),
      ).accepted,
    ).toBe(true);
    expect(
      universe.execute({
        type: "AssignAgent",
        agentId: "agent-1",
        goalId: "goal-1",
      }).ok,
    ).toBe(true);
    expect(
      universe.execute({
        type: "RenameGoal",
        goalId: "goal-1",
        title: "Ship it",
      }).ok,
    ).toBe(true);
    expect(
      universe.execute({
        type: "SetGoalPriority",
        goalId: "goal-1",
        priority: "P1",
      }).ok,
    ).toBe(true);
    clock.value = 1_001_000;
    expect(universe.execute({ type: "CompleteGoal", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.status).toBe("completed");
    expect(universe.execute({ type: "ArchiveGoal", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.status).toBe("archived");
  });

  test("keeps deterministic goal placement and persists pinned movement", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "First" });
    universe.execute({ type: "CreateGoal", title: "Second" });
    const before = universe.snapshot().goals.map((goal) => goal.mapPosition);
    expect(before[0]).toBeDefined();
    expect(before[1]).toBeDefined();
    expect(before[0]).not.toEqual(before[1]);
    expect(
      universe.execute({
        type: "SetGoalMapPosition",
        goalId: "goal-1",
        position: { x: 42.4, y: -17.2 },
      }),
    ).toEqual({ ok: true, goalId: "goal-1" });
    const moved = universe.snapshot().goals[0];
    expect(moved?.mapPosition).toEqual({ x: 42, y: -17 });
    expect(moved?.mapPositionPinned).toBe(true);
    expect(universe.execute({ type: "ResetGoalMapPosition", goalId: "goal-1" }).ok).toBe(true);
    expect(universe.snapshot().goals[0]?.mapPositionPinned).toBe(false);
  });

  test("repairs an unpinned goal position as assigned agents expand its footprint", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Admin" });
    universe.execute({ type: "CreateGoal", title: "Observatory" });
    universe.execute({ type: "CreateGoal", title: "Copilot" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(Array.from({ length: 18 }, (_, index) => observation(`pane-${index}`))),
    );
    const goalsBefore = universe.snapshot().goals;
    const crowdedGoal = goalsBefore[2];
    expect(crowdedGoal).toBeDefined();
    if (!crowdedGoal) return;

    expect(
      universe.execute({
        type: "AssignAgents",
        agentIds: Array.from({ length: 15 }, (_, index) => `agent-${index + 1}`),
        goalId: crowdedGoal.id,
      }).ok,
    ).toBe(true);
    const goalsAfter = universe.snapshot().goals;
    expect(goalsAfter[0]?.mapPosition).toEqual(goalsBefore[0]?.mapPosition);
    expect(goalsAfter[1]?.mapPosition).toEqual(goalsBefore[1]?.mapPosition);
    expect(goalsAfter[2]?.mapPosition).not.toEqual(crowdedGoal.mapPosition);
    expect(goalsAfter[2]?.mapPositionPinned).toBe(false);
  });

  test("never auto-moves a pinned goal when its agent footprint expands", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Pinned" });
    universe.execute({ type: "CreateGoal", title: "Neighbour" });
    universe.execute({
      type: "SetGoalMapPosition",
      goalId: "goal-1",
      position: { x: 0, y: 0 },
    });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(Array.from({ length: 15 }, (_, index) => observation(`pane-${index}`))),
    );
    universe.execute({
      type: "AssignAgents",
      agentIds: Array.from({ length: 15 }, (_, index) => `agent-${index + 1}`),
      goalId: "goal-1",
    });
    expect(universe.snapshot().goals[0]?.mapPosition).toEqual({ x: 0, y: 0 });
    expect(universe.snapshot().goals[0]?.mapPositionPinned).toBe(true);
  });

  test("does not allow assignment to an archived goal", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Old goal" });
    admitObservedConversationsAndReconcile(universe, hostSnapshot([observation("pane-1")]));
    universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
    universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
    expect(
      universe.execute({
        type: "AssignAgent",
        agentId: "agent-1",
        goalId: "goal-1",
      }),
    ).toEqual({ ok: false, error: "Archived goals cannot receive agents." });
  });

  test("assigns multiple agents atomically", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Batch destination" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1"), observation("pane-2")]),
    );

    expect(
      universe.execute({
        type: "AssignAgents",
        agentIds: ["agent-1", "missing", "agent-2"],
        goalId: "goal-1",
      }),
    ).toEqual({ ok: false, error: "Agent missing not found." });
    expect(universe.snapshot().agents.every((agent) => !agent.primaryGoalId)).toBe(true);

    expect(
      universe.execute({
        type: "AssignAgents",
        agentIds: ["agent-1", "agent-2"],
        goalId: "goal-1",
      }),
    ).toEqual({
      ok: true,
      goalId: "goal-1",
      affectedAgentIds: ["agent-1", "agent-2"],
    });
    expect(universe.snapshot().agents.map((agent) => agent.primaryGoalId)).toEqual([
      "goal-1",
      "goal-1",
    ]);
  });

  test("adopts related agents in a human-controlled batch and preserves dismissal state", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Primary outcome" });
    universe.execute({ type: "CreateGoal", title: "Other outcome" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          ...observation("target"),
          executionContainer: { id: "container-1", label: "Primary outcome" },
        },
        {
          ...observation("candidate"),
          executionContainer: { id: "container-1", label: "Primary outcome" },
        },
        {
          ...observation("assigned"),
          executionContainer: { id: "container-1", label: "Primary outcome" },
        },
      ]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "AssignAgent", agentId: "agent-3", goalId: "goal-2" });

    expect(
      universe.execute({
        type: "DismissRelatedAgents",
        goalId: "goal-1",
        agentIds: ["agent-2"],
      }),
    ).toEqual({
      ok: true,
      goalId: "goal-1",
      affectedAgentIds: ["agent-2"],
    });
    expect(universe.snapshot().relatedAgentDismissals).toEqual([
      { goalId: "goal-1", agentId: "agent-2", dismissedAt: 1_000_000 },
    ]);

    expect(
      universe.execute({
        type: "AdoptRelatedAgents",
        goalId: "goal-1",
        agentIds: ["agent-2", "agent-3"],
      }),
    ).toEqual({
      ok: false,
      error: "assigned is already attached to another goal.",
    });
    expect(universe.snapshot().agents[1]?.primaryGoalId).toBeUndefined();
    expect(universe.snapshot().agents[2]?.primaryGoalId).toBe("goal-2");

    expect(
      universe.execute({
        type: "AdoptRelatedAgents",
        goalId: "goal-1",
        agentIds: ["agent-2"],
      }),
    ).toEqual({
      ok: true,
      goalId: "goal-1",
      affectedAgentIds: ["agent-2"],
    });
    expect(universe.snapshot().agents[1]?.primaryGoalId).toBe("goal-1");
    expect(universe.snapshot().relatedAgentDismissals).toEqual([]);
  });

  test("preserves human agent metadata across reconciliation", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Goal" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "host title", "working")]),
    );
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-1",
      goalId: "goal-1",
    });
    universe.execute({
      type: "RenameAgent",
      agentId: "agent-1",
      displayName: "My accepted name",
    });
    universe.execute({
      type: "SetAgentDescription",
      agentId: "agent-1",
      description: "Human context",
    });
    clock.value = 1_002_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        [
          {
            ...observation("pane-1", "new host title", "blocked"),
            observedAt: 1_002_000,
          },
        ],
        1_002_000,
      ),
    );
    const agent = universe.snapshot().agents[0];
    expect(agent?.displayName).toBe("My accepted name");
    expect(agent?.description).toBe("Human context");
    expect(agent?.primaryGoalId).toBe("goal-1");
    expect(agent?.runtimeState).toBe("blocked");
  });

  test("is idempotent and detaches missing executions without losing Agent identity", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1"), observation("pane-2")]),
    );
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1"), observation("pane-2")]),
    );
    expect(universe.snapshot().agents.every((agent) => agent.continuity === "proved")).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(2);
    const stale = admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1")], 1_001_000),
    );
    expect(stale.staleAgentIds).toEqual(["agent-2"]);
    expect(universe.snapshot().agents.find((agent) => agent.id === "agent-2")).toMatchObject({
      execution: undefined,
      executionPresence: "absent",
      observationHealth: "fresh",
      executionHistory: [{ nativeId: "pane-2" }],
    });
  });

  test("does not infer execution absence from an incomplete host inventory", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(universe, hostSnapshot([observation("pane-1")]));

    clock.value += 1_000;
    const result = admitObservedConversationsAndReconcile(universe, {
      ...hostSnapshot([], clock.now()),
      complete: false,
      diagnostics: ["Synthetic inventory record was skipped."],
    });

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("did not prove any execution absent");
    expect(universe.snapshot().agents[0]).toMatchObject({
      hostHealth: "live",
      executionPresence: "live",
      execution: { nativeId: "pane-1" },
    });
  });

  test("binds a recognised host execution only after explicit admission", () => {
    const { universe } = makeUniverse();
    expect(universe.reconcile(hostSnapshot([])).accepted).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(0);

    const promoted = observation("shell-pane", "promoted agent", "working");
    const untracked = universe.reconcile(hostSnapshot([promoted]));
    expect(untracked.diagnostics.join(" ")).toContain("untracked");
    expect(universe.snapshot().agents).toEqual([]);
    const discovered = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (discovered.kind !== "command-centre") throw new Error("wrong projection");
    expect(discovered.discoveredExecutions).toHaveLength(1);

    admitObservedConversationsAndReconcile(universe, hostSnapshot([promoted], 1_001_000));
    expect(universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      execution: { nativeId: "shell-pane" },
      displayName: "promoted agent",
    });
    expect(universe.project({ kind: "command-centre", now: 1_001_000 })).toMatchObject({
      counts: { agents: 1, discovered: 0 },
      discoveredExecutions: [],
    });
  });

  test("rejects out-of-order snapshots without regressing accepted state", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "newer", "blocked", 2_000_000)], 2_000_000),
    );
    const older = admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "older", "idle", 1_000_000)], 1_000_000),
    );
    expect(older.accepted).toBe(false);
    expect(older.error).toContain("Out-of-order");
    expect(universe.snapshot().agents[0]?.runtimeState).toBe("blocked");
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(2_000_000);
  });

  test("ignores an older agent observation inside a newer snapshot", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "newer", "blocked", 2_000_000)], 2_000_000),
    );
    const result = admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "older", "idle", 1_000_000)], 3_000_000),
    );
    expect(result.accepted).toBe(true);
    expect(result.updatedAgentIds).toHaveLength(0);
    expect(result.diagnostics.join(" ")).toContain("Ignored an older observation");
    expect(universe.snapshot().agents[0]?.runtimeState).toBe("blocked");
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(3_000_000);
  });

  test("preserves host observation age while the host is unavailable", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1")], 1_000_000),
    );
    admitObservedConversationsAndReconcile(universe, {
      hostKind: "test-host",
      hostInstanceId: "test-host:default",
      available: false,
      complete: false,
      observedAt: 1_010_000,
      agents: [],
      diagnostics: [],
      error: "socket unavailable",
    });
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(1_000_000);
    const projection = universe.project({ kind: "command-centre", now: 1_010_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.attention.items.find((item) => item.targetType === "host")?.ageMs).toBe(
      10_000,
    );
  });

  test("does not use one host instance to prove another instance absent", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-a")], 1_000_000),
    );
    admitObservedConversationsAndReconcile(universe, {
      ...hostSnapshot([], 1_001_000),
      hostInstanceId: "test-host:remote-b",
    });
    expect(universe.snapshot().agents[0]).toMatchObject({
      execution: { hostInstanceId: "test-host:default", nativeId: "pane-a" },
      executionPresence: "live",
    });
    expect(universe.snapshot().hosts).toHaveLength(2);
  });

  test("normalizes native identities at the reconciliation boundary", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation(" pane-1 ", "first")], 1_000_000),
    );
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "second", "idle", 1_001_000)], 1_001_000),
    );
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]?.execution?.nativeId).toBe("pane-1");
  });

  test("archives Agents without deleting their identity or assignment", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Keep the context" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1"), observation("pane-2")]),
    );
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-2",
      goalId: "goal-1",
    });
    expect(universe.execute({ type: "ArchiveAgent", agentId: "agent-1" })).toEqual({
      ok: true,
      agentId: "agent-1",
    });

    clock.value = 1_001_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-2")], clock.value),
    );
    const archived = universe.snapshot().agents.find((agent) => agent.id === "agent-1");
    expect(archived?.archivedAt).toBe(1_000_000);

    const active = universe.project({ kind: "command-centre", now: clock.value });
    if (active.kind !== "command-centre") throw new Error("wrong projection");
    expect(active.unassigned.map((agent) => agent.id)).toEqual([]);
    expect(active.goals[0]?.agents.map((agent) => agent.id)).toEqual(["agent-2"]);
    expect(active.counts.stale).toBe(0);
    expect(active.counts.uncertainty).toBe(0);

    clock.value = 1_002_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1"), observation("pane-2")], clock.value),
    );
    const rediscovered = universe.snapshot().agents.find((agent) => agent.id === "agent-1");
    expect(rediscovered?.hostHealth).toBe("live");
    expect(rediscovered?.archivedAt).toBe(1_000_000);
    expect(universe.snapshot().agents).toHaveLength(2);
  });

  test("archives multiple Agents atomically", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1"), observation("pane-2")]),
    );

    expect(
      universe.execute({ type: "ArchiveAgents", agentIds: ["agent-1", "agent-2", "agent-1"] }),
    ).toEqual({ ok: true, affectedAgentIds: ["agent-1", "agent-2"] });
    expect(universe.snapshot().agents.map((agent) => agent.archivedAt)).toEqual([
      clock.now(),
      clock.now(),
    ]);
  });

  test("rejects duplicate native identities without guessing", () => {
    const { universe } = makeUniverse();
    universe.reconcile(hostSnapshot([hostOnlyObservation("same")], 1_000_000));
    const result = universe.reconcile(
      hostSnapshot([hostOnlyObservation("same"), hostOnlyObservation("same")], 1_001_000),
    );
    expect(result.accepted).toBe(false);
    expect(result.error).toContain("Duplicate native identity");
    expect(universe.snapshot().agents).toHaveLength(0);
    const projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions?.[0]).toMatchObject({
      presence: "unknown",
      observationHealth: "unknown",
    });
  });

  test("rebinds the same proven conversation to a new execution and retains its goal", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Durable work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    clock.value += 1_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-2", "conversation-a", clock.now())], clock.now()),
    );
    const agents = universe.snapshot().agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: "agent-1",
      primaryGoalId: "goal-1",
      continuity: "proved",
      execution: { nativeId: "pane-2" },
    });
  });

  test("blocks resume when two executions claim one scoped provider conversation", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "conversation-conflict",
      },
      displayName: "Conflicted work",
      workspaceRef: "/worktrees/conflict",
      observedAt: 1_000_000,
    });
    const conflicting = ["pane-a", "pane-b"].map((nativeId) => ({
      ...observedConversation(nativeId, "conversation-conflict"),
      harnessEvidence: {
        ...observedConversation(nativeId, "conversation-conflict").harnessEvidence,
        nativeConversationRef: {
          harnessId: "codex",
          continuityScopeId: "scope-test",
          kind: "id",
          value: "conversation-conflict",
        },
      },
    }));
    const result = admitObservedConversationsAndReconcile(universe, hostSnapshot(conflicting));
    expect(result.accepted).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      executionPresence: "conflict",
      resumeCapability: "blocked",
    });
    expect(universe.snapshot().agents[0]?.conflictingExecutions).toHaveLength(2);
  });

  test("ignores stale provider catalogues and reports only meaningful provider updates", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "conversation-provider-order",
      },
      displayName: "Provider ordering",
      observedAt: 1_000_000,
    });
    const session = {
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "conversation-provider-order",
      },
      observedAt: 2_000_000,
      resumeEligibility: "same-site" as const,
    };
    const fresh = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 2_000_000,
      complete: true,
      sessions: [session],
    });
    const unchanged = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 2_000_001,
      complete: false,
      sessions: [session],
    });
    const stale = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 1_500_000,
      complete: true,
      sessions: [],
    });

    expect(fresh.updatedAgentIds).toEqual(["agent-1"]);
    expect(unchanged.updatedAgentIds).toEqual([]);
    expect(stale.accepted).toBe(false);
    expect(stale.error).toContain("Out-of-order codex provider catalogue ignored");
    expect(universe.snapshot().agents[0]).toMatchObject({
      providerContinuity: "confirmed",
      resumeCapability: "eligible",
      providerObservedAt: 2_000_000,
    });
    const unavailable = universe.observe({ kind: "provider-unavailable", harnessId: "codex" });
    const repeatedUnavailable = universe.observe({
      kind: "provider-unavailable",
      harnessId: "codex",
    });
    expect(unavailable.updatedAgentIds).toEqual(["agent-1"]);
    expect(repeatedUnavailable.updatedAgentIds).toEqual([]);
  });

  test("marks a proved conversation execution absent without losing continuity", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    clock.value += 1_000;
    admitObservedConversationsAndReconcile(universe, hostSnapshot([], clock.now()));
    expect(universe.snapshot().agents[0]).toMatchObject({
      continuity: "proved",
      hostHealth: "stale",
      executionPresence: "absent",
      observationHealth: "fresh",
    });
  });

  test("does not transfer a goal when a pane now contains a different conversation", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Original work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    clock.value += 1_000;
    const result = universe.reconcile(
      hostSnapshot([observedConversation("pane-1", "conversation-b", clock.now())], clock.now()),
    );
    const original = universe.snapshot().agents.find((agent) => agent.id === "agent-1");
    expect(result.diagnostics.join(" ")).toContain("untracked");
    expect(original).toMatchObject({ primaryGoalId: "goal-1", continuity: "replaced" });
    expect(original?.execution).toBeUndefined();
    expect(universe.snapshot().agents).toHaveLength(1);
  });

  test("does not rebind an admitted Agent when an unidentified target is reused", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Original work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    clock.value += 1_000;
    const replacement = {
      ...hostOnlyObservation("pane-1", "Unidentified replacement", "working", clock.now()),
      hostLocator: "opaque:replacement-pane",
    };
    const result = universe.reconcile(hostSnapshot([replacement], clock.now()));

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("untracked");
    expect(universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      primaryGoalId: "goal-1",
      execution: undefined,
      continuity: "unknown",
    });
    expect(universe.project({ kind: "command-centre", now: clock.now() })).toMatchObject({
      counts: { discovered: 1, agents: 1 },
    });
  });

  test("does not transfer metadata when a reused execution changes from unscoped A to scoped B", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Original work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "RenameAgent", agentId: "agent-1", displayName: "Human name" });

    clock.value += 1_000;
    const replacement = observedConversation("pane-1", "conversation-b", clock.now());
    const result = universe.reconcile(
      hostSnapshot(
        [
          {
            ...replacement,
            harnessEvidence: {
              ...replacement.harnessEvidence,
              nativeConversationRef: {
                ...replacement.harnessEvidence.nativeConversationRef,
                continuityScopeId: "scope-test",
              },
            },
          },
        ],
        clock.now(),
      ),
    );

    expect(result.diagnostics.join(" ")).toContain("untracked");
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      displayName: "Human name",
      primaryGoalId: "goal-1",
      continuity: "replaced",
      execution: undefined,
      nativeConversationRef: { value: "conversation-a" },
    });
    expect(universe.snapshot().agents[0]?.nativeConversationRef?.continuityScopeId).toBeUndefined();
  });

  test("enriches only the scope of the same exact conversation", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Scoped work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "RenameAgent", agentId: "agent-1", displayName: "Human name" });

    clock.value += 1_000;
    const scoped = observedConversation("pane-1", "conversation-a", clock.now());
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        [
          {
            ...scoped,
            harnessEvidence: {
              ...scoped.harnessEvidence,
              nativeConversationRef: {
                ...scoped.harnessEvidence.nativeConversationRef,
                continuityScopeId: "scope-test",
              },
            },
          },
        ],
        clock.now(),
      ),
    );

    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      displayName: "Human name",
      primaryGoalId: "goal-1",
      nativeConversationRef: { value: "conversation-a", continuityScopeId: "scope-test" },
      execution: { nativeId: "pane-1" },
    });
  });

  test("ignores an unscoped observation that would downgrade a scoped execution", () => {
    const { universe, clock } = makeUniverse();
    const scoped = observedConversation("pane-1", "conversation-a");
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          ...scoped,
          harnessEvidence: {
            ...scoped.harnessEvidence,
            nativeConversationRef: {
              ...scoped.harnessEvidence.nativeConversationRef,
              continuityScopeId: "scope-test",
            },
          },
        },
      ]),
    );

    clock.value += 1_000;
    const result = universe.reconcile(
      hostSnapshot([observedConversation("pane-1", "conversation-a", clock.now())], clock.now()),
    );

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("Ignored unscoped provider identity");
    expect(result.updatedAgentIds).toEqual([]);
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      continuity: "proved",
      nativeConversationRef: {
        value: "conversation-a",
        continuityScopeId: "scope-test",
      },
      execution: { nativeId: "pane-1" },
    });
  });

  test("uses exact process evidence without downgrading a scoped conversation", () => {
    const { universe, clock } = makeUniverse();
    const scoped = {
      ...observation("pane-1", "OpenCode", "working"),
      harnessEvidence: {
        detectedHarnessId: "opencode",
        nativeConversationRef: {
          harnessId: "opencode",
          continuityScopeId: "scope-test",
          kind: "id",
          value: "ses_process",
        },
        restoreState: "unknown" as const,
        source: "native-integration" as const,
        observedAt: 1_000_000,
      },
    };
    admitObservedConversationsAndReconcile(universe, hostSnapshot([scoped]));

    clock.value += 1_000;
    const result = universe.reconcile(
      hostSnapshot(
        [
          {
            ...observation("pane-1", "OpenCode", "working", clock.now()),
            harnessEvidence: {
              detectedHarnessId: "opencode",
              nativeConversationRef: {
                harnessId: "opencode",
                kind: "id",
                value: "ses_process",
              },
              restoreState: "unknown" as const,
              source: "process" as const,
              observedAt: clock.now(),
            },
          },
        ],
        clock.now(),
      ),
    );

    expect(result.accepted).toBe(true);
    expect(universe.snapshot().agents[0]).toMatchObject({
      continuity: "proved",
      execution: { nativeId: "pane-1" },
      nativeConversationRef: {
        harnessId: "opencode",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "ses_process",
      },
    });
  });

  test("uses scoped provider admission to enrich one compatible managed launch", () => {
    const { universe } = makeUniverse();
    expect(
      universe.execute({
        type: "AddConversation",
        admissionSource: "managed-launch",
        harnessId: "codex",
        nativeConversationRef: {
          harnessId: "codex",
          kind: "session-id",
          value: "conversation-a",
        },
        displayName: "Host fallback",
        observedAt: 1_000_000,
      }),
    ).toMatchObject({ ok: true, agentId: "agent-1" });
    expect(universe.snapshot().agents[0]).toMatchObject({
      displayNameSource: "fallback",
      providerContinuity: "unknown",
      resumeCapability: "unknown",
      providerObservedAt: undefined,
    });

    expect(
      universe.execute({
        type: "AddConversation",
        admissionSource: "provider-catalogue",
        resumeEligibility: "same-site",
        harnessId: "codex",
        nativeConversationRef: {
          harnessId: "codex",
          continuityScopeId: "scope-test",
          kind: "session-id",
          value: "conversation-a",
        },
        displayName: "Provider title",
        observedAt: 1_001_000,
      }),
    ).toMatchObject({ ok: true, agentId: "agent-1" });
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      nativeConversationRef: { continuityScopeId: "scope-test" },
      displayName: "Provider title",
      displayNameSource: "provider",
      providerContinuity: "confirmed",
      resumeCapability: "eligible",
      providerObservedAt: 1_001_000,
    });
  });

  test("canonicalizes one compatible managed launch from provider catalogue evidence", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "managed-launch",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        kind: "session-id",
        value: "conversation-a",
      },
      displayName: "Host fallback",
      observedAt: 1_000_000,
    });

    const result = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 1_001_000,
      complete: false,
      sessions: [
        {
          nativeConversationRef: {
            harnessId: "codex",
            continuityScopeId: "scope-test",
            kind: "session-id",
            value: "conversation-a",
          },
          observedAt: 1_001_000,
          resumeEligibility: "same-site",
          title: "Provider title",
        },
      ],
    });

    expect(result.accepted).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      nativeConversationRef: { continuityScopeId: "scope-test" },
      displayName: "Provider title",
      displayNameSource: "provider",
      providerContinuity: "confirmed",
      resumeCapability: "eligible",
    });
  });

  test("consolidates a persisted legacy duplicate into its scoped Agent", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Preserved assignment" });
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "session-id",
        value: "conversation-a",
      },
      displayName: "Provider name",
      observedAt: clock.now(),
    });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-2", goalId: "goal-1" });
    universe.execute({ type: "RenameAgent", agentId: "agent-2", displayName: "Human name" });

    clock.value += 1_000;
    const scoped = observedConversation("pane-1", "conversation-a", clock.now());
    const result = admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        [
          {
            ...scoped,
            harnessEvidence: {
              ...scoped.harnessEvidence,
              nativeConversationRef: {
                ...scoped.harnessEvidence.nativeConversationRef,
                continuityScopeId: "scope-test",
              },
            },
          },
        ],
        clock.now(),
      ),
    );

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("Consolidated duplicate Agent");
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      displayName: "Human name",
      displayNameSource: "human",
      primaryGoalId: "goal-1",
      nativeConversationRef: {
        value: "conversation-a",
        continuityScopeId: "scope-test",
      },
      execution: { nativeId: "pane-1" },
    });
  });

  test("requires strong identity evidence after process restart", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Restarted work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    universe.invalidateRuntimeFacts();
    expect(universe.snapshot().agents[0]).toMatchObject({
      primaryGoalId: "goal-1",
      continuity: "proved",
      hostHealth: "stale",
      executionPresence: "unknown",
      observationHealth: "stale",
    });
    clock.value += 1_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        [
          {
            ...observation("pane-1", "weak", "working", clock.now()),
            harnessEvidence: {
              detectedHarnessId: "codex",
              restoreState: "unknown" as const,
              source: "process" as const,
              observedAt: clock.now(),
            },
          },
        ],
        clock.now(),
      ),
    );
    const afterWeakEvidence = universe.snapshot().agents;
    expect(afterWeakEvidence.find((agent) => agent.id === "agent-1")).toMatchObject({
      primaryGoalId: "goal-1",
      continuity: "unknown",
    });
    expect(
      afterWeakEvidence.find((agent) => agent.id === "agent-2")?.primaryGoalId,
    ).toBeUndefined();
  });

  test("shows a host-only execution without admitting it as a durable Agent", () => {
    const { universe, clock } = makeUniverse();
    const hostOnly = hostOnlyObservation(
      "pane-host-only",
      "Host-only work",
      "working",
      clock.now(),
    );
    universe.reconcile(hostSnapshot([hostOnly]));
    const commandCentre = universe.project({ kind: "command-centre", now: clock.now() });
    if (commandCentre.kind !== "command-centre") throw new Error("wrong projection");
    const discovery = commandCentre.discoveredExecutions?.[0];
    expect(universe.snapshot().agents).toEqual([]);
    expect(commandCentre.counts).toMatchObject({ agents: 0, unassigned: 0, discovered: 1 });
    expect(discovery).toMatchObject({
      displayName: "Host-only work",
      runtimeState: "working",
      conversationIdentified: false,
      admission: { status: "unavailable" },
    });
    expect(commandCentre.unassigned).toEqual([]);
    const map = universe.project({ kind: "universe-map", now: clock.now() });
    if (map.kind !== "universe-map") throw new Error("wrong projection");
    expect(map.discoveredExecutions).toHaveLength(1);
    const search = universe.project({ kind: "search", query: "Host-only" });
    if (search.kind !== "search") throw new Error("wrong projection");
    expect(search.results).toMatchObject([
      { type: "discovered-execution", label: "Host-only work" },
    ]);
    const inspector = universe.project({
      kind: "inspector",
      now: clock.now(),
      target: { type: "discovered-execution", id: discovery!.handle },
    });
    expect(inspector).toMatchObject({
      kind: "discovered-execution-inspector",
      lines: expect.arrayContaining(["conversation not identified"]),
    });

    universe.invalidateRuntimeFacts();
    clock.value += 1_000;
    universe.reconcile(hostSnapshot([{ ...hostOnly, observedAt: clock.now() }], clock.now()));
    expect(universe.snapshot().agents).toEqual([]);
    expect(universe.project({ kind: "command-centre", now: clock.now() })).toMatchObject({
      counts: { agents: 0, discovered: 1 },
    });
  });

  test("does not publish discovery changes for timestamp-only host refreshes", () => {
    const events = new ControlPlaneEventHub();
    const received: ControlPlaneEvent[] = [];
    events.subscribe((batch) => received.push(...batch));
    const { universe, clock } = makeUniverse({ events });
    const observationAt = clock.now();
    universe.reconcile(
      hostSnapshot([hostOnlyObservation("pane-quiet", "Quiet", "working", observationAt)]),
    );
    expect(received.map((event) => event.type)).toContain("discovered-execution-changed");

    received.length = 0;
    clock.value += 1_000;
    universe.reconcile(
      hostSnapshot(
        [hostOnlyObservation("pane-quiet", "Quiet", "working", clock.now())],
        clock.now(),
      ),
    );
    expect(received).toEqual([]);
  });

  test("keeps a non-displayable conversation identified without exposing its value", () => {
    const { universe, clock } = makeUniverse();
    universe.reconcile(
      hostSnapshot([
        {
          ...observation("pane-hidden", "Hidden conversation", "working", clock.now()),
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: {
              harnessId: "codex",
              continuityScopeId: "scope-hidden",
              kind: "path",
              value: "/synthetic/private-transcript.jsonl",
            },
            restoreState: "unknown" as const,
            source: "native-integration" as const,
            observedAt: clock.now(),
          },
        },
      ]),
    );

    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    const discovery = projection.discoveredExecutions?.[0];
    expect(discovery?.conversationIdentified).toBe(true);
    expect(discovery?.conversation).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain("/synthetic/private-transcript.jsonl");
  });

  test("accepts only bounded opaque conversation references for display", () => {
    expect(safeReference("session-id", "01a08cea-e177-7323-b71a-39968420fecb")).toEqual({
      kind: "session-id",
      id: "01a08cea-e177-7323-b71a-39968420fecb",
    });
    for (const value of [
      "file:///Users/secret/transcript.jsonl",
      "~/secret.jsonl",
      "../secret.jsonl",
      "C:secret.jsonl",
      "docs/private/session.jsonl",
      "a\\b",
      "x".repeat(129),
    ])
      expect(safeReference("id", value)).toBeUndefined();
    expect(safeReference("path", "opaque-id")).toBeUndefined();
    expect(safeReference("../escaped", "opaque-id")).toBeUndefined();
  });

  test("retains discovery through uncertain host refreshes but removes it on complete absence", () => {
    const { universe } = makeUniverse();
    const first = hostSnapshot([hostOnlyObservation("pane-uncertain")], 1_000_000);
    universe.reconcile(first);
    universe.reconcile({
      ...hostSnapshot([], 1_001_000),
      complete: false,
      diagnostics: ["Synthetic inventory record was skipped."],
    });
    let projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions?.[0]).toMatchObject({
      presence: "unknown",
      observationHealth: "unknown",
    });
    universe.reconcile({
      ...hostSnapshot([], 1_002_000),
      available: false,
      complete: false,
      error: "host unavailable",
    });
    projection = universe.project({ kind: "command-centre", now: 1_002_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions?.[0]).toMatchObject({
      presence: "unknown",
      observationHealth: "unavailable",
    });
    universe.reconcile(hostSnapshot([], 1_003_000));
    projection = universe.project({ kind: "command-centre", now: 1_003_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toEqual([]);
    universe.reconcile(first);
    projection = universe.project({ kind: "command-centre", now: 1_003_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toEqual([]);
  });

  test("keeps discovery identities separate by execution and host instance", () => {
    const { universe } = makeUniverse();
    universe.reconcile(
      hostSnapshot([
        hostOnlyObservation("pane-a", "same title"),
        hostOnlyObservation("pane-b", "same title"),
      ]),
    );
    universe.reconcile({
      ...hostSnapshot([hostOnlyObservation("pane-a", "same title")], 1_001_000),
      hostInstanceId: "test-host:other",
    });
    const projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toHaveLength(3);
    expect(projection.discoveredExecutions?.map((item) => item.displayName)).toEqual([
      "same title",
      "same title",
      "same title",
    ]);
  });

  test("does not rediscover an execution covered by a pending launch", () => {
    const { universe } = makeUniverse();
    const pending = hostOnlyObservation("pending-pane");
    universe.reconcile(hostSnapshot([pending]), [
      { hostKind: "test-host", hostInstanceId: "test-host:default", nativeId: "pending-pane" },
    ]);
    let projection = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toEqual([]);
    universe.reconcile(hostSnapshot([{ ...pending, observedAt: 1_001_000 }], 1_001_000));
    projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toHaveLength(1);
  });

  test("does not let a pending launch on another host suppress discovery", () => {
    const { universe } = makeUniverse();
    const pending = hostOnlyObservation("shared-native-id");
    universe.reconcile(hostSnapshot([pending]), [
      { hostKind: "other-host", hostInstanceId: "test-host:default", nativeId: "shared-native-id" },
    ]);

    const projection = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions).toHaveLength(1);
  });

  test("keeps a non-discoverable execution bound without creating a discovery", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-non-discoverable", "Worker", "working", clock.now())]),
    );
    expect(universe.snapshot().agents[0]?.execution?.nativeId).toBe("pane-non-discoverable");

    const result = universe.reconcile(
      hostSnapshot(
        [
          {
            ...observation("pane-non-discoverable", "Worker", "working", clock.now() + 1_000),
            discoverable: false,
          },
        ],
        clock.now() + 1_000,
      ),
    );

    expect(result.accepted).toBe(true);
    expect(universe.snapshot().agents[0]).toMatchObject({
      executionPresence: "live",
      execution: { nativeId: "pane-non-discoverable" },
    });
    const projection = universe.project({ kind: "command-centre", now: clock.now() + 1_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions ?? []).toEqual([]);
  });

  test("omits the host execution container from discovery projections", () => {
    const { universe, clock } = makeUniverse();
    universe.reconcile(
      hostSnapshot([
        {
          ...hostOnlyObservation("container-pane"),
          executionContainer: { id: "container-secret", label: "Workspace" },
        },
      ]),
    );
    const commandCentre = universe.project({ kind: "command-centre", now: clock.now() });
    if (commandCentre.kind !== "command-centre") throw new Error("wrong projection");
    expect(commandCentre.discoveredExecutions).toHaveLength(1);
    expect(JSON.stringify(commandCentre)).not.toContain("container-secret");
    const map = universe.project({ kind: "universe-map", now: clock.now() });
    if (map.kind !== "universe-map") throw new Error("wrong projection");
    expect(JSON.stringify(map)).not.toContain("container-secret");
  });

  test("offers explicit admission for an unscoped discovery with one exact catalogue session", () => {
    const { universe } = makeUniverse();
    universe.reconcile(
      hostSnapshot([
        {
          ...observation("unscoped-primary", "Unscoped primary", "working", 1_000_000),
          harnessEvidence: {
            detectedHarnessId: "opencode",
            nativeConversationRef: { harnessId: "opencode", kind: "id", value: "ses-unscoped" },
            restoreState: "unknown" as const,
            source: "process" as const,
            observedAt: 1_000_000,
          },
        },
      ]),
    );
    universe.observe({
      kind: "provider-catalogue",
      harnessId: "opencode",
      continuityScopeId: "scope-primary",
      observedAt: 1_001_000,
      complete: true,
      sessions: [
        {
          nativeConversationRef: {
            harnessId: "opencode",
            continuityScopeId: "scope-primary",
            kind: "id",
            value: "ses-unscoped",
          },
          observedAt: 1_001_000,
          resumeEligibility: "same-site",
          title: "Scoped primary",
        },
      ],
    });
    const projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.discoveredExecutions?.[0]).toMatchObject({
      conversationIdentified: true,
      conversationTitle: "Scoped primary",
      admission: { status: "available", resumeEligibility: "same-site" },
    });
    expect(
      universe.resolveDiscoveredExecution(projection.discoveredExecutions?.[0]?.handle ?? "")
        ?.nativeConversationRef?.continuityScopeId,
    ).toBeUndefined();
  });

  test("invalidates a discovery handle when its host target is reused", () => {
    const { universe } = makeUniverse();
    universe.reconcile(hostSnapshot([hostOnlyObservation("reused-pane")], 1_000_000));
    const first = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (first.kind !== "command-centre") throw new Error("wrong projection");
    const oldHandle = first.discoveredExecutions?.[0]?.handle;
    expect(oldHandle).toBeDefined();
    universe.reconcile(
      hostSnapshot(
        [
          {
            ...hostOnlyObservation("reused-pane", "replacement", "working", 1_001_000),
            hostLocator: "opaque:replacement-pane",
          },
        ],
        1_001_000,
      ),
    );
    const second = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (second.kind !== "command-centre") throw new Error("wrong projection");
    const newHandle = second.discoveredExecutions?.[0]?.handle;
    expect(newHandle).toBeDefined();
    expect(newHandle).not.toBe(oldHandle);
    expect(universe.resolveDiscoveredExecution(oldHandle!)).toBeUndefined();
  });

  test("rebuilds unadmitted discovery after a process restart without durable history", () => {
    const { universe, store, clock } = makeUniverse();
    const snapshot = hostSnapshot([hostOnlyObservation("restart-pane")]);
    universe.reconcile(snapshot);
    const semanticChanges = store.state.changes;
    universe.invalidateRuntimeFacts();
    const restarted = new Universe(store, clock, new SequenceIds(), createProjectionModule());
    expect(restarted.project({ kind: "command-centre", now: clock.now() })).toMatchObject({
      discoveredExecutions: [],
      counts: { discovered: 0 },
    });
    expect(store.state.changes).toEqual(semanticChanges);
    restarted.reconcile(
      hostSnapshot(
        [hostOnlyObservation("restart-pane", "restart", "working", 1_001_000)],
        1_001_000,
      ),
    );
    expect(restarted.snapshot().agents).toEqual([]);
    expect(restarted.project({ kind: "command-centre", now: 1_001_000 })).toMatchObject({
      counts: { discovered: 1, agents: 0 },
    });
  });

  test("enriches a host-only discovery in place when scoped catalogue identity arrives later", () => {
    const { universe } = makeUniverse();
    const hostOnly = {
      ...observation("pane-late-identity", "Late identity", "working"),
      harnessEvidence: {
        detectedHarnessId: "codex",
        nativeConversationRef: {
          harnessId: "codex",
          kind: "session-id",
          value: "late-conversation",
        },
        restoreState: "unknown" as const,
        source: "process" as const,
        observedAt: 1_000_000,
      },
    };
    universe.reconcile(hostSnapshot([hostOnly]));
    const before = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (before.kind !== "command-centre") throw new Error("wrong projection");
    const handle = before.discoveredExecutions?.[0]?.handle;
    expect(handle).toBeDefined();
    expect(before.discoveredExecutions?.[0]?.admission.status).toBe("unavailable");

    universe.reconcile(
      hostSnapshot(
        [
          {
            ...hostOnly,
            observedAt: 1_001_000,
            harnessEvidence: {
              detectedHarnessId: "codex",
              nativeConversationRef: {
                harnessId: "codex",
                continuityScopeId: "scope-late",
                kind: "session-id",
                value: "late-conversation",
              },
              restoreState: "host-restored",
              source: "native-integration",
              observedAt: 1_001_000,
            },
          },
        ],
        1_001_000,
      ),
    );
    universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-late",
      observedAt: 1_002_000,
      complete: true,
      sessions: [
        {
          nativeConversationRef: {
            harnessId: "codex",
            continuityScopeId: "scope-late",
            kind: "session-id",
            value: "late-conversation",
          },
          observedAt: 1_002_000,
          resumeEligibility: "same-site",
          title: "Late catalogue work",
        },
      ],
    });
    const after = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (after.kind !== "command-centre") throw new Error("wrong projection");
    expect(after.discoveredExecutions).toHaveLength(1);
    expect(after.discoveredExecutions?.[0]).toMatchObject({
      handle,
      conversationIdentified: true,
      conversationTitle: "Late catalogue work",
      admission: { status: "available" },
    });
  });

  test("preserves a discovery handle when the same execution gains conversation identity", () => {
    const { universe } = makeUniverse();
    universe.reconcile(hostSnapshot([hostOnlyObservation("arrival-pane")], 1_000_000));
    const before = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (before.kind !== "command-centre") throw new Error("wrong projection");
    const handle = before.discoveredExecutions?.[0]?.handle;
    expect(handle).toBeDefined();
    expect(before.discoveredExecutions?.[0]?.conversationIdentified).toBe(false);

    universe.reconcile(
      hostSnapshot(
        [{ ...observedConversation("arrival-pane", "arrival-conversation", 1_001_000) }],
        1_001_000,
      ),
    );
    const after = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (after.kind !== "command-centre") throw new Error("wrong projection");
    expect(after.discoveredExecutions).toHaveLength(1);
    expect(after.discoveredExecutions?.[0]).toMatchObject({
      handle,
      conversationIdentified: true,
    });
    expect(universe.resolveDiscoveredExecution(handle ?? "")).toBeDefined();
  });

  test("preserves execution conflicts while admitting one durable Agent", () => {
    const { universe } = makeUniverse();
    const makeClaim = (nativeId: string) => {
      const claimed = observedConversation(nativeId, "same conversation", 1_000_000);
      return {
        ...claimed,
        harnessEvidence: {
          ...claimed.harnessEvidence,
          nativeConversationRef: {
            ...claimed.harnessEvidence.nativeConversationRef,
            continuityScopeId: "scope-conflict",
          },
        },
      };
    };
    const claims = [makeClaim("pane-conflict-a"), makeClaim("pane-conflict-b")];
    universe.reconcile(hostSnapshot(claims));
    const before = universe.project({ kind: "command-centre", now: 1_000_000 });
    if (before.kind !== "command-centre") throw new Error("wrong projection");
    expect(before.discoveredExecutions).toHaveLength(2);
    expect(before.discoveredExecutions?.every((item) => item.conversationConflictCount === 2)).toBe(
      true,
    );
    const firstClaim = claims[0];
    if (!firstClaim) throw new Error("Expected the first conflict claim.");
    const reference = firstClaim.harnessEvidence.nativeConversationRef;
    expect(
      universe.execute({
        type: "AddConversation",
        admissionSource: "provider-catalogue",
        resumeEligibility: "same-site",
        harnessId: reference.harnessId,
        nativeConversationRef: reference,
        displayName: "Admitted conflict",
        observedAt: 1_000_000,
      }).ok,
    ).toBe(true);
    universe.reconcile(hostSnapshot(claims, 1_001_000));
    const after = universe.snapshot();
    expect(after.agents).toHaveLength(1);
    expect(after.agents[0]).toMatchObject({ executionPresence: "conflict" });
    expect(after.agents[0]?.conflictingExecutions).toHaveLength(2);
    expect(universe.project({ kind: "command-centre", now: 1_001_000 })).toMatchObject({
      discoveredExecutions: [],
      counts: { agents: 1, discovered: 0 },
    });
  });

  test("restores the same Agent after restart when the conversation is proven", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Recover exact work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-1", "conversation-a")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.invalidateRuntimeFacts();

    clock.value += 1_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observedConversation("pane-9", "conversation-a", clock.now())], clock.now()),
    );
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      primaryGoalId: "goal-1",
      continuity: "proved",
      hostHealth: "live",
      execution: { nativeId: "pane-9" },
    });
  });

  test("rolls back a command when persistence fails", () => {
    const { universe, store } = makeUniverse();
    store.failNextSave = true;
    expect(universe.execute({ type: "CreateGoal", title: "Must not appear" }).ok).toBe(false);
    expect(universe.snapshot().goals).toHaveLength(0);
  });

  test("rolls back reconciliation when persistence fails", () => {
    const { universe, store } = makeUniverse();
    const before = universe.snapshot();
    store.failNextSave = true;

    const result = universe.reconcile(hostSnapshot([observation("pane-1")]));

    expect(result.accepted).toBe(false);
    expect(result.error).toContain("Reconciliation rolled back");
    expect(universe.snapshot()).toEqual(before);
  });

  test("validates and monotonically acknowledges only the requested boundary", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Displayed" });
    universe.execute({ type: "RenameGoal", goalId: "goal-1", title: "Newer" });
    const before = universe.snapshot();
    for (const throughSequence of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 3]) {
      expect(universe.execute({ type: "AcknowledgeCatchUp", throughSequence }).ok).toBe(false);
      expect(universe.snapshot()).toEqual(before);
    }
    expect(universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 1 })).toEqual({
      ok: true,
      checkpointSequence: 1,
    });
    const checkpoint = universe.snapshot().operatorCheckpoint;
    clock.value += 1_000;
    for (const throughSequence of [1, 0, 1]) {
      expect(universe.execute({ type: "AcknowledgeCatchUp", throughSequence })).toEqual({
        ok: true,
        checkpointSequence: 1,
      });
      expect(universe.snapshot().operatorCheckpoint).toEqual(checkpoint);
      expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
        pending: true,
        transitionCount: 1,
      });
    }
  });

  test("records deterministic semantic changes and acknowledges a durable catch-up cursor", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Catch up", priority: "P2" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "worker", "working")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    expect(universe.snapshot().changes.map((item) => item.summary)).toEqual([
      "New goal · Catch up",
      "New agent observed · worker",
      "Agent returned live · worker",
      "Assignment changed · worker → Catch up",
    ]);
    expect(universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 4 })).toEqual({
      ok: true,
      checkpointSequence: 4,
    });
    expect(universe.snapshot().operatorCheckpoint).toEqual({
      lastSequence: 4,
      acknowledgedAt: clock.now(),
    });

    clock.value += 1_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-1", "worker", "blocked", clock.now())], clock.now()),
    );
    expect(universe.snapshot().changes.at(-1)).toMatchObject({
      sequence: 5,
      outcome: "attention",
      summary: "Agent state · worker · working → blocked",
    });
  });

  test("preserves a consolidated duplicate's live execution as history", () => {
    const legacy: Agent = {
      id: "agent-legacy",
      harnessId: "codex",
      nativeConversationRef: { harnessId: "codex", kind: "session-id", value: "conversation-a" },
      continuity: "proved",
      providerContinuity: "unknown",
      executionPresence: "live",
      resumeCapability: "unknown",
      observationHealth: "fresh",
      executionHistory: [],
      conflictingExecutions: [],
      displayName: "legacy",
      displayNameSource: "fallback",
      runtimeState: "working",
      runtimeStateSource: "test-host",
      hostHealth: "live",
      lastSeenAt: 1_000_000,
      lastObservedAt: 1_000_000,
      lastChangedAt: 1_000_000,
      execution: {
        hostKind: "test-host",
        hostInstanceId: "test-host:default",
        nativeId: "pane-2",
        hostLocator: "opaque:pane-2",
        observedAt: 1_000_000,
      },
    };
    const canonical: Agent = {
      ...legacy,
      id: "agent-canonical",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "session-id",
        value: "conversation-a",
      },
      execution: undefined,
      executionPresence: "unknown",
      displayName: "canonical",
    };
    const state = emptyUniverseState();
    state.systems.push({
      id: DEFAULT_SYSTEM_ID,
      title: "Default",
      createdAt: 1,
      updatedAt: 1,
    });
    state.agents.push(canonical, legacy);
    const { universe, clock } = makeUniverse({ state });
    clock.value = 1_001_000;

    const result = universe.reconcile(
      hostSnapshot(
        [
          scopedConversation("pane-1", "conversation-a", clock.now()),
          {
            ...observation("pane-2", "weak pane", "working", clock.now()),
            harnessEvidence: {
              detectedHarnessId: "codex",
              nativeConversationRef: {
                harnessId: "codex",
                kind: "session-id",
                value: "conversation-a",
              },
              restoreState: "unknown" as const,
              source: "hook" as const,
              observedAt: clock.now(),
            },
          },
        ],
        clock.now(),
      ),
    );

    expect(result.accepted).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(1);
    const merged = universe.snapshot().agents[0];
    expect(merged?.id).toBe("agent-canonical");
    expect(merged?.executionHistory.map((binding) => binding.nativeId)).toContain("pane-2");
    expect(merged?.conflictingExecutions.map((binding) => binding.nativeId)).toEqual([
      "pane-1",
      "pane-2",
    ]);
    expect(merged).toMatchObject({
      executionPresence: "conflict",
      resumeCapability: "blocked",
    });
  });

  test("restores provider resume eligibility when an execution conflict clears", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "session-id",
        value: "conversation-a",
      },
      displayName: "Work",
      observedAt: 1_000_000,
    });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([scopedConversation("pane-a", "conversation-a")]),
    );
    clock.value = 1_001_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        [
          scopedConversation("pane-a", "conversation-a", clock.now()),
          scopedConversation("pane-b", "conversation-a", clock.now()),
        ],
        clock.now(),
      ),
    );
    expect(universe.snapshot().agents[0]?.resumeCapability).toBe("blocked");

    clock.value = 1_002_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([scopedConversation("pane-a", "conversation-a", clock.now())], clock.now()),
    );
    expect(universe.snapshot().agents[0]).toMatchObject({
      executionPresence: "live",
      providerContinuity: "confirmed",
      providerResumeEligibility: "same-site",
      resumeCapability: "eligible",
      conflictingExecutions: [],
    });
  });

  test("merges two agents canonicalised onto the same alias target", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: conversationAlias("alias-1", "scope-c"),
      displayName: "First",
      observedAt: 1_000_000,
    });
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: conversationAlias("alias-2", "scope-c"),
      displayName: "Second",
      observedAt: 1_000_000,
    });

    const result = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-c",
      observedAt: 1_100_000,
      complete: true,
      sessions: [
        {
          nativeConversationRef: conversationAlias("canonical", "scope-c"),
          observedAt: 1_100_000,
          resumeEligibility: "same-site",
          nativeConversationAliases: [
            conversationAlias("alias-1", "scope-c"),
            conversationAlias("alias-2", "scope-c"),
          ],
        },
      ],
    });

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("Consolidated duplicate Agent");
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]?.nativeConversationRef).toMatchObject({
      value: "canonical",
      continuityScopeId: "scope-c",
    });
  });

  test("keeps provider freshness monotonic across per-session timestamps", () => {
    const { universe } = makeUniverse();
    const reference = {
      harnessId: "codex",
      continuityScopeId: "scope-test",
      kind: "id",
      value: "conversation-a",
    };
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: reference,
      displayName: "Work",
      observedAt: 2_000_000,
    });
    const newer = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 2_500_000,
      complete: false,
      sessions: [
        { nativeConversationRef: reference, observedAt: 1_000_000, resumeEligibility: "same-site" },
      ],
    });
    const stale = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 1_500_000,
      complete: true,
      sessions: [],
    });

    expect(newer.accepted).toBe(true);
    expect(universe.snapshot().agents[0]?.providerObservedAt).toBe(2_000_000);
    expect(stale.accepted).toBe(false);
    expect(stale.error).toContain("Out-of-order");
    expect(universe.snapshot().agents[0]?.providerContinuity).toBe("confirmed");
  });

  test("rejects archived agents, unknown priorities and non-finite observation times", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Destination" });
    admitObservedConversationsAndReconcile(universe, hostSnapshot([observation("pane-1")]));
    universe.execute({ type: "ArchiveAgent", agentId: "agent-1" });

    expect(universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" })).toEqual(
      { ok: false, error: "Archived agents cannot be assigned." },
    );
    expect(
      universe.execute({ type: "AssignAgents", agentIds: ["agent-1"], goalId: "goal-1" }),
    ).toEqual({ ok: false, error: "Archived agents cannot be assigned." });
    expect(
      universe.execute({
        type: "AddConversation",
        admissionSource: "managed-launch",
        harnessId: "test-harness",
        nativeConversationRef: {
          harnessId: "test-harness",
          continuityScopeId: "test-scope",
          kind: "conversation-id",
          value: "pane-1",
        },
        displayName: "Re-added",
        observedAt: 1_000_000,
      }),
    ).toEqual({ ok: false, error: "Archived agents cannot be added." });

    // SAFETY: Simulates an untrusted JavaScript caller bypassing the priority union.
    const invalidPriority = "P9" as never;
    expect(
      universe.execute({ type: "CreateGoal", title: "Bad", priority: invalidPriority }),
    ).toEqual({ ok: false, error: "Unknown goal priority." });
    expect(
      universe.execute({ type: "SetGoalPriority", goalId: "goal-1", priority: invalidPriority }),
    ).toEqual({ ok: false, error: "Unknown goal priority." });
    expect(
      universe.execute({
        type: "AddConversation",
        admissionSource: "managed-launch",
        harnessId: "test-harness",
        nativeConversationRef: {
          harnessId: "test-harness",
          kind: "conversation-id",
          value: "pane-9",
        },
        displayName: "Bad time",
        observedAt: Number.NaN,
      }),
    ).toEqual({ ok: false, error: "Observation time is invalid." });
  });

  test("rejects a provider catalogue that escapes its declared scope", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "managed-launch",
      harnessId: "codex",
      nativeConversationRef: { harnessId: "codex", kind: "id", value: "conversation-a" },
      displayName: "Work",
      observedAt: 1_000_000,
    });

    const result = universe.observe({
      kind: "provider-catalogue",
      harnessId: "codex",
      continuityScopeId: "scope-test",
      observedAt: 1_100_000,
      complete: false,
      sessions: [
        {
          nativeConversationRef: {
            harnessId: "codex",
            continuityScopeId: "other-scope",
            kind: "id",
            value: "conversation-a",
          },
          observedAt: 1_100_000,
          resumeEligibility: "same-site",
        },
      ],
    });

    expect(result.accepted).toBe(false);
    expect(result.error).toContain("escaped its declared");
    expect(universe.snapshot().agents[0]?.nativeConversationRef?.continuityScopeId).toBeUndefined();
  });

  test("blocks resume when an unscoped execution claims a scoped conversation", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: "same-site",
      harnessId: "codex",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "session-id",
        value: "conversation-a",
      },
      displayName: "Work",
      observedAt: 1_000_000,
    });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([scopedConversation("pane-a", "conversation-a")]),
    );

    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        scopedConversation("pane-a", "conversation-a"),
        {
          ...observation("pane-b", "weak pane", "working"),
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: {
              harnessId: "codex",
              kind: "session-id",
              value: "conversation-a",
            },
            restoreState: "unknown" as const,
            source: "hook" as const,
            observedAt: 1_000_000,
          },
        },
      ]),
    );

    expect(universe.snapshot().agents[0]).toMatchObject({
      executionPresence: "conflict",
      resumeCapability: "blocked",
    });
    expect(universe.snapshot().agents[0]?.conflictingExecutions).toHaveLength(2);
  });

  test("rolls back runtime invalidation when persistence fails", () => {
    const { universe, store } = makeUniverse();
    admitObservedConversationsAndReconcile(universe, hostSnapshot([observation("pane-1")]));
    const before = universe.snapshot();
    store.failNextSave = true;

    const result = universe.invalidateRuntimeFacts();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Runtime invalidation rolled back");
    expect(universe.snapshot()).toEqual(before);
  });

  test("marks a provider unavailable using the conversation harness identity", () => {
    const state = emptyUniverseState();
    state.agents.push({
      id: "agent-legacy",
      nativeConversationRef: {
        harnessId: "codex",
        continuityScopeId: "scope-test",
        kind: "id",
        value: "conversation-a",
      },
      continuity: "proved",
      providerContinuity: "confirmed",
      executionPresence: "absent",
      resumeCapability: "eligible",
      observationHealth: "fresh",
      executionHistory: [],
      conflictingExecutions: [],
      displayName: "Legacy",
      displayNameSource: "provider",
      runtimeState: "unknown",
      runtimeStateSource: "codex",
      hostHealth: "stale",
      lastSeenAt: 1,
      lastObservedAt: 1,
      lastChangedAt: 1,
      providerObservedAt: 1,
    });
    const { universe } = makeUniverse({ state });

    const result = universe.observe({ kind: "provider-unavailable", harnessId: "codex" });

    expect(result.updatedAgentIds).toEqual(["agent-legacy"]);
    expect(universe.snapshot().agents[0]).toMatchObject({
      providerContinuity: "unknown",
      resumeCapability: "unknown",
    });
  });

  test("does not share execution container references with snapshots or emit no-op changes", () => {
    const events = new ControlPlaneEventHub();
    const received: ControlPlaneEvent[] = [];
    events.subscribe((batch) => received.push(...batch));
    const { universe, clock } = makeUniverse({ events });
    universe.execute({ type: "CreateGoal", title: "Same" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          ...observation("pane-1"),
          executionContainer: { id: "container-1", label: "Container" },
        },
      ]),
    );

    const snapshot = universe.snapshot();
    const container = snapshot.agents[0]?.executionContainer;
    expect(container).toBeDefined();
    if (container) {
      Object.assign(container, { id: "mutated" });
      expect(universe.snapshot().agents[0]?.executionContainer?.id).toBe("container-1");
    }

    const updatedAt = universe.snapshot().goals[0]?.updatedAt;
    const eventCount = received.length;
    clock.value += 1_000;
    expect(universe.execute({ type: "RenameGoal", goalId: "goal-1", title: "Same" }).ok).toBe(true);
    expect(received).toHaveLength(eventCount);
    expect(universe.snapshot().goals[0]?.updatedAt).toBe(updatedAt);
  });
});
