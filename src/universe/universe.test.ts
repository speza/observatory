import { describe, expect, test } from "bun:test";
import { makeUniverse, hostSnapshot } from "./test-support.ts";

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

describe("Universe", () => {
  test("enforces goal lifecycle and direct assignment through its interface", () => {
    const { universe, clock } = makeUniverse();
    expect(
      universe.execute({
        type: "CreateGoal",
        title: "  Ship the slice  ",
        priority: "P0",
        description: "Walk the live path.",
      }),
    ).toEqual({ ok: true, goalId: "goal-1" });
    expect(
      universe.reconcile(hostSnapshot([observation("pane-1", "live agent", "working")])).accepted,
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
    universe.reconcile(
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
    universe.reconcile(
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
    universe.reconcile(hostSnapshot([observation("pane-1")]));
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
    universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));

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
    universe.reconcile(
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
    universe.reconcile(hostSnapshot([observation("pane-1", "host title", "working")]));
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
    universe.reconcile(
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
    const first = universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));
    const second = universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));
    expect(first.addedAgentIds).toHaveLength(2);
    expect(second.addedAgentIds).toHaveLength(0);
    expect(universe.snapshot().agents.every((agent) => agent.continuity === "unknown")).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(2);
    const stale = universe.reconcile(hostSnapshot([observation("pane-1")], 1_001_000));
    expect(stale.staleAgentIds).toEqual(["agent-2"]);
    expect(universe.snapshot().agents.find((agent) => agent.id === "agent-2")).toMatchObject({
      execution: undefined,
      executionPresence: "absent",
      observationHealth: "fresh",
      executionHistory: [{ nativeId: "pane-2" }],
    });
  });

  test("only reconciles a shell as an Agent after the host recognises it", () => {
    const { universe } = makeUniverse();
    expect(universe.reconcile(hostSnapshot([])).accepted).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(0);

    const promoted = observation("shell-pane", "promoted agent", "working");
    const first = universe.reconcile(hostSnapshot([promoted]));
    expect(first.addedAgentIds).toEqual(["agent-1"]);
    expect(universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      execution: { nativeId: "shell-pane" },
      displayName: "promoted agent",
    });

    const second = universe.reconcile(hostSnapshot([promoted], 1_001_000));
    expect(second.addedAgentIds).toHaveLength(0);
    expect(universe.snapshot().agents).toHaveLength(1);
  });

  test("rejects out-of-order snapshots without regressing accepted state", () => {
    const { universe } = makeUniverse();
    universe.reconcile(
      hostSnapshot([observation("pane-1", "newer", "blocked", 2_000_000)], 2_000_000),
    );
    const older = universe.reconcile(
      hostSnapshot([observation("pane-1", "older", "idle", 1_000_000)], 1_000_000),
    );
    expect(older.accepted).toBe(false);
    expect(older.error).toContain("Out-of-order");
    expect(universe.snapshot().agents[0]?.runtimeState).toBe("blocked");
    expect(universe.snapshot().hosts[0]?.lastObservedAt).toBe(2_000_000);
  });

  test("ignores an older agent observation inside a newer snapshot", () => {
    const { universe } = makeUniverse();
    universe.reconcile(
      hostSnapshot([observation("pane-1", "newer", "blocked", 2_000_000)], 2_000_000),
    );
    const result = universe.reconcile(
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
    universe.reconcile(hostSnapshot([observation("pane-1")], 1_000_000));
    universe.reconcile({
      hostKind: "test-host",
      hostInstanceId: "test-host:default",
      available: false,
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
    universe.reconcile(hostSnapshot([observation("pane-a")], 1_000_000));
    universe.reconcile({
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
    universe.reconcile(hostSnapshot([observation(" pane-1 ", "first")], 1_000_000));
    universe.reconcile(
      hostSnapshot([observation("pane-1", "second", "idle", 1_001_000)], 1_001_000),
    );
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]?.execution?.nativeId).toBe("pane-1");
  });

  test("archives Agents without deleting their identity or assignment", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Keep the context" });
    universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));
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
    universe.reconcile(hostSnapshot([observation("pane-2")], clock.value));
    const archived = universe.snapshot().agents.find((agent) => agent.id === "agent-1");
    expect(archived?.archivedAt).toBe(1_000_000);

    const active = universe.project({ kind: "command-centre", now: clock.value });
    if (active.kind !== "command-centre") throw new Error("wrong projection");
    expect(active.unassigned.map((agent) => agent.id)).toEqual([]);
    expect(active.goals[0]?.agents.map((agent) => agent.id)).toEqual(["agent-2"]);
    expect(active.counts.stale).toBe(0);
    expect(active.counts.uncertainty).toBe(0);

    clock.value = 1_002_000;
    universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")], clock.value));
    const rediscovered = universe.snapshot().agents.find((agent) => agent.id === "agent-1");
    expect(rediscovered?.hostHealth).toBe("stale");
    expect(rediscovered?.archivedAt).toBe(1_000_000);
    expect(universe.snapshot().agents).toHaveLength(3);
  });

  test("archives multiple Agents atomically", () => {
    const { universe, clock } = makeUniverse();
    universe.reconcile(hostSnapshot([observation("pane-1"), observation("pane-2")]));

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
    const result = universe.reconcile(hostSnapshot([observation("same"), observation("same")]));
    expect(result.accepted).toBe(false);
    expect(result.error).toContain("Duplicate native identity");
    expect(universe.snapshot().agents).toHaveLength(0);
  });

  test("rebinds the same proven conversation to a new execution and retains its goal", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Durable work" });
    universe.reconcile(hostSnapshot([observedConversation("pane-1", "conversation-a")]));
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    clock.value += 1_000;
    universe.reconcile(
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
      type: "AdoptProviderSession",
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
    const result = universe.reconcile(hostSnapshot(conflicting));
    expect(result.accepted).toBe(true);
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      executionPresence: "conflict",
      resumeCapability: "blocked",
    });
    expect(universe.snapshot().agents[0]?.conflictingExecutions).toHaveLength(2);
  });

  test("marks a proved conversation execution absent without losing continuity", () => {
    const { universe, clock } = makeUniverse();
    universe.reconcile(hostSnapshot([observedConversation("pane-1", "conversation-a")]));
    clock.value += 1_000;
    universe.reconcile(hostSnapshot([], clock.now()));
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
    universe.reconcile(hostSnapshot([observedConversation("pane-1", "conversation-a")]));
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    clock.value += 1_000;
    universe.reconcile(
      hostSnapshot([observedConversation("pane-1", "conversation-b", clock.now())], clock.now()),
    );
    const original = universe.snapshot().agents.find((agent) => agent.id === "agent-1");
    const replacement = universe.snapshot().agents.find((agent) => agent.id === "agent-2");
    expect(original).toMatchObject({ primaryGoalId: "goal-1", continuity: "replaced" });
    expect(original?.execution).toBeUndefined();
    expect(replacement).toMatchObject({ continuity: "proved", execution: { nativeId: "pane-1" } });
    expect(replacement?.primaryGoalId).toBeUndefined();
  });

  test("requires strong identity evidence after process restart", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Restarted work" });
    universe.reconcile(hostSnapshot([observedConversation("pane-1", "conversation-a")]));
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
    universe.reconcile(
      hostSnapshot([observation("pane-1", "weak", "working", clock.now())], clock.now()),
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

  test("retains a degraded host-only Agent while the same host execution remains live", () => {
    const { universe, clock } = makeUniverse();
    universe.reconcile(hostSnapshot([observation("pane-host-only", "Host-only work")]));
    universe.invalidateRuntimeFacts();
    clock.value += 1_000;
    universe.reconcile(
      hostSnapshot(
        [observation("pane-host-only", "Host-only work", "working", clock.now())],
        clock.now(),
      ),
    );
    expect(universe.snapshot().agents).toHaveLength(1);
    expect(universe.snapshot().agents[0]).toMatchObject({
      id: "agent-1",
      execution: { nativeId: "pane-host-only" },
      executionPresence: "live",
      providerContinuity: "unknown",
    });
  });

  test("restores the same Agent after restart when the conversation is proven", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Recover exact work" });
    universe.reconcile(hostSnapshot([observedConversation("pane-1", "conversation-a")]));
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.invalidateRuntimeFacts();

    clock.value += 1_000;
    universe.reconcile(
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

  test("records deterministic semantic changes and acknowledges a durable catch-up cursor", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Catch up", priority: "P2" });
    universe.reconcile(hostSnapshot([observation("pane-1", "worker", "working")]));
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    expect(universe.snapshot().changes.map((item) => item.summary)).toEqual([
      "New goal · Catch up",
      "New agent observed · worker",
      "Assignment changed · worker → Catch up",
    ]);
    expect(universe.execute({ type: "AcknowledgeCatchUp" })).toEqual({
      ok: true,
      checkpointSequence: 3,
    });
    expect(universe.snapshot().operatorCheckpoint).toEqual({
      lastSequence: 3,
      acknowledgedAt: clock.now(),
    });

    clock.value += 1_000;
    universe.reconcile(
      hostSnapshot([observation("pane-1", "worker", "blocked", clock.now())], clock.now()),
    );
    expect(universe.snapshot().changes.at(-1)).toMatchObject({
      sequence: 4,
      outcome: "attention",
      summary: "Agent state · worker · working → blocked",
    });
  });
});
