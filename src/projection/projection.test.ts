import { describe, expect, test } from "bun:test";
import {
  admitObservedConversationsAndReconcile,
  makeUniverse,
  hostSnapshot,
} from "../universe/test-support.ts";

const observation = (
  nativeId: string,
  displayName: string,
  runtimeState: "idle" | "working" | "waiting" | "blocked" | "done" = "idle",
  repository = "repo",
  worktree = "/sandbox/tree",
  executionContainer?: { readonly id: string; readonly label?: string },
) => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "fixture",
  observedAt: 1_000_000,
  repository,
  branch: "main",
  worktree,
  provider: "fixture-provider",
  executionContainer,
  hostLocator: `opaque:${nativeId}`,
});

describe("projections", () => {
  test("exposes an ID-backed provider session only in its explicit inspector projection", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          ...observation("pane", "private session"),
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: {
              harnessId: "codex",
              kind: "session-id",
              value: "sensitive-native-reference",
            },
            restoreState: "not-restored",
            source: "native-integration",
            observedAt: clock.now(),
          },
        },
      ]),
    );

    const commandCentre = universe.project({ kind: "command-centre", now: clock.now() });
    const inspector = universe.project({
      kind: "inspector",
      now: clock.now(),
      target: { type: "agent", id: "agent-1" },
    });
    expect(JSON.stringify(commandCentre)).not.toContain("sensitive-native-reference");
    expect(inspector).toMatchObject({
      kind: "agent-inspector",
      conversation: { kind: "session-id", id: "sensitive-native-reference" },
    });
    if (commandCentre.kind !== "command-centre") throw new Error("wrong projection");
    expect(commandCentre.unassigned[0]?.canResume).toBe(false);
  });

  test("never exposes a provider transcript path through the inspector", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          ...observation("pane", "private session"),
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: {
              harnessId: "codex",
              kind: "path",
              value: "/private/provider/transcript.jsonl",
            },
            restoreState: "not-restored",
            source: "native-integration",
            observedAt: clock.now(),
          },
        },
      ]),
    );

    const inspector = universe.project({
      kind: "inspector",
      now: clock.now(),
      target: { type: "agent", id: "agent-1" },
    });
    expect(JSON.stringify(inspector)).not.toContain("/private/provider/transcript.jsonl");
    expect(inspector).not.toHaveProperty("conversation");
  });
  test("keeps the command centre goal-centred and exposes the inbox", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "P0 goal", priority: "P0" });
    universe.execute({ type: "CreateGoal", title: "P2 goal", priority: "P2" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        observation("p1", "blocked agent", "blocked"),
        observation("p2", "unassigned"),
      ]),
    );
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-1",
      goalId: "goal-1",
    });
    const projection = universe.project({
      kind: "command-centre",
      now: 1_001_000,
    });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.goals[0]?.title).toBe("P0 goal");
    expect(projection.goals[0]?.agents[0]?.displayName).toBe("blocked agent");
    expect(projection.unassigned.map((agent) => agent.displayName)).toEqual(["unassigned"]);
    expect(projection.counts.attention).toBe(1);
  });

  test("rolls goals and agent state up into systems without reassigning agents", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateSystem", title: "Observatory" });
    universe.execute({
      type: "CreateGoal",
      title: "Ship systems",
      priority: "P0",
      systemId: "system-1",
    });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("p1", "working agent", "working")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });

    const projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.systems).toMatchObject([
      {
        title: "Observatory",
        agentCount: 1,
        workingCount: 1,
        goals: [{ title: "Ship systems" }],
      },
    ]);
    expect(projection.goals[0]?.agents[0]?.primaryGoalId).toBe("goal-1");
    expect(projection.counts.systems).toBe(1);
  });

  test("groups agents by observed code context without changing goal assignment", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Cross-repository outcome" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        observation("repo-a-1", "repo a worker", "working", "synthetic/repo-a", "/trees/a-1"),
        observation("repo-a-2", "repo a reviewer", "blocked", "synthetic/repo-a", "/trees/a-2"),
        observation("repo-b-1", "repo b worker", "idle", "synthetic/repo-b", "/trees/b-1"),
      ]),
    );
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-1",
      goalId: "goal-1",
    });

    const projection = universe.project({ kind: "code-contexts", now: 1_001_000 });
    if (projection.kind !== "code-contexts") throw new Error("wrong code-context projection");
    expect(projection.contexts.map((context) => context.label)).toEqual([
      "synthetic/repo-a",
      "synthetic/repo-b",
    ]);
    expect(projection.contexts[0]?.agents.map((agent) => agent.displayName)).toEqual([
      "repo a reviewer",
      "repo a worker",
    ]);
    expect(projection.contexts[0]?.attentionCount).toBe(1);
    expect(projection.contexts[0]?.agents).toHaveLength(2);
    expect(projection.contexts[0]?.worktreeCount).toBe(2);
    expect(projection.contexts[1]?.agents[0]?.goalTitle).toBeUndefined();
    expect(projection.counts.contexts).toBe(2);
  });

  test("keeps missing repository identity visibly grouped as an unknown context", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          ...observation("unknown", "unknown workspace"),
          repository: undefined,
          worktree: undefined,
        },
      ]),
    );
    const projection = universe.project({ kind: "code-contexts", now: 1_000_000 });
    if (projection.kind !== "code-contexts") throw new Error("wrong code-context projection");
    expect(projection.contexts[0]?.label).toBe("Unknown workspace");
    expect(projection.contexts[0]?.source).toBe("unknown");
  });

  test("projects observed related-agent evidence without changing goal authority", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Copilot dev mode UI" });
    universe.execute({ type: "CreateGoal", title: "Other accepted work" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        observation("target", "target agent", "working", "synthetic/repo-a", "/trees/target", {
          id: "container-ui",
          label: "Copilot dev mode UI",
        }),
        observation(
          "cross-repo",
          "cross-repo agent",
          "idle",
          "synthetic/repo-b",
          "/trees/cross-repo",
          { id: "container-ui", label: "Copilot dev mode UI" },
        ),
        observation(
          "same-repo",
          "same-repo agent",
          "idle",
          "synthetic/repo-a",
          "/trees/same-repo",
          { id: "container-other", label: "Other context" },
        ),
        observation(
          "assigned",
          "assigned elsewhere",
          "idle",
          "synthetic/repo-c",
          "/trees/assigned",
          { id: "container-ui", label: "Copilot dev mode UI" },
        ),
      ]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "AssignAgent", agentId: "agent-4", goalId: "goal-2" });

    const projection = universe.project({
      kind: "related-agents",
      goalId: "goal-1",
      now: 1_001_000,
      includeDismissed: true,
    });
    if (projection.kind !== "related-agents") throw new Error("wrong related projection");
    expect(projection.candidates.map((candidate) => candidate.agent.displayName)).toEqual([
      "cross-repo agent",
      "same-repo agent",
      "assigned elsewhere",
    ]);
    const crossRepo = projection.candidates[0];
    expect(crossRepo?.confidence).toBe("strong");
    expect(crossRepo?.evidence[0]).toEqual({
      signal: "execution-container",
      strength: "strong",
      label: "same execution container · Copilot dev mode UI",
    });
    expect(projection.candidates[1]?.confidence).toBe("supporting");
    expect(projection.candidates[1]?.evidence[0]?.signal).toBe("repository");
    expect(projection.candidates[2]?.adoptable).toBe(false);
    expect(projection.candidates[2]?.agent.goalTitle).toBe("Other accepted work");
    expect(projection.counts).toEqual({
      candidates: 3,
      adoptable: 2,
      strong: 2,
      supporting: 1,
      dismissed: 0,
    });

    expect(
      universe.execute({
        type: "DismissRelatedAgents",
        goalId: "goal-1",
        agentIds: ["agent-2"],
      }).ok,
    ).toBe(true);
    const hidden = universe.project({ kind: "related-agents", goalId: "goal-1", now: 1_001_000 });
    if (hidden.kind !== "related-agents") throw new Error("wrong related projection");
    expect(hidden.candidates.some((candidate) => candidate.agent.id === "agent-2")).toBe(false);
    const shown = universe.project({
      kind: "related-agents",
      goalId: "goal-1",
      now: 1_001_000,
      includeDismissed: true,
    });
    if (shown.kind !== "related-agents") throw new Error("wrong related projection");
    expect(shown.candidates.find((candidate) => candidate.agent.id === "agent-2")?.dismissed).toBe(
      true,
    );
  });

  test("projects code contexts as a stable map with agents around each context", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        observation("repo-a-1", "repo a worker", "working", "synthetic/repo-a", "/trees/a-1"),
        observation("repo-a-2", "repo a reviewer", "idle", "synthetic/repo-a", "/trees/a-2"),
        observation("repo-b-1", "repo b worker", "blocked", "synthetic/repo-b", "/trees/b-1"),
      ]),
    );
    const first = universe.project({ kind: "code-context-map", now: 1_001_000 });
    const second = universe.project({ kind: "code-context-map", now: 1_001_000 });
    expect(first.kind).toBe("code-context-map");
    expect(second.kind).toBe("code-context-map");
    if (first.kind !== "code-context-map" || second.kind !== "code-context-map") return;
    expect(first.contexts.map((context) => context.label).sort()).toEqual([
      "synthetic/repo-a",
      "synthetic/repo-b",
    ]);
    const firstRepoA = first.contexts.find((context) => context.label === "synthetic/repo-a");
    const secondRepoA = second.contexts.find((context) => context.label === "synthetic/repo-a");
    expect(firstRepoA?.mapPosition).toEqual(secondRepoA?.mapPosition);
    expect(firstRepoA?.agents[0]?.mapPosition).toEqual(secondRepoA?.agents[0]?.mapPosition);
    expect(firstRepoA?.agents).toHaveLength(2);
    expect(firstRepoA?.worktreeCount).toBe(2);
    expect(
      first.contexts.find((context) => context.label === "synthetic/repo-b")?.attentionCount,
    ).toBe(1);
    expect(first.counts.contexts).toBe(2);
  });

  test("searches accepted goal and agent metadata, including archived goals", () => {
    const { universe } = makeUniverse();
    universe.execute({
      type: "CreateGoal",
      title: "Archive candidate",
      description: "needle description",
    });
    universe.execute({ type: "CreateGoal", title: "Other" });
    admitObservedConversationsAndReconcile(universe, hostSnapshot([observation("pane", "worker")]));
    universe.execute({
      type: "RenameAgent",
      agentId: "agent-1",
      displayName: "Needle worker",
    });
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-2" });
    universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
    universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
    const projection = universe.project({
      kind: "search",
      query: "needle",
      now: 1_000_000,
    });
    if (projection.kind !== "search") throw new Error("wrong projection");
    expect(projection.results.map((result) => result.label)).toEqual([
      "Archive candidate",
      "Needle worker",
    ]);
    expect(projection.results[1]?.context).toBe("agent · Other");
  });

  test.each(["blocked", "waiting", "working", "done"] as const)(
    "retains actionable %s work under archived goals",
    (runtimeState) => {
      const { universe } = makeUniverse();
      universe.execute({ type: "CreateGoal", title: "Archived goal" });
      admitObservedConversationsAndReconcile(
        universe,
        hostSnapshot([observation("pane", "Named worker", runtimeState)]),
      );
      universe.execute({
        type: "AssignAgent",
        agentId: "agent-1",
        goalId: "goal-1",
      });
      expect(universe.execute({ type: "CompleteGoal", goalId: "goal-1" }).ok).toBe(true);
      expect(universe.execute({ type: "ArchiveGoal", goalId: "goal-1" }).ok).toBe(true);
      const projection = universe.project({ kind: "command-centre", now: 1_001_000 });
      if (projection.kind !== "command-centre") throw new Error("wrong projection");
      expect(projection.counts.attention).toBe(1);
      expect(projection.counts.agents).toBe(1);
      expect(projection.goals[0]).toMatchObject({
        status: "archived",
        agents: [
          {
            id: "agent-1",
            displayName: "Named worker",
            executionPresence: "live",
            primaryGoalId: "goal-1",
          },
        ],
      });
      const item = projection.attention.items[0];
      expect(item?.reason).toBe(
        runtimeState === "working"
          ? "archived-running"
          : runtimeState === "done"
            ? "runtime-complete"
            : runtimeState,
      );
      expect(JSON.stringify(item)).toContain("Goal is archived");
      expect(
        universe.project({
          kind: "inspector",
          now: 1_001_000,
          target: { type: "agent", id: "agent-1" },
        }),
      ).toMatchObject({
        agent: projection.goals[0]?.agents[0],
      });
      expect(universe.project({ kind: "universe-map", now: 1_001_000 })).toMatchObject({
        goals: [{ status: "archived", agents: [{ id: "agent-1" }] }],
        counts: { agents: 1, attention: 1 },
      });
      expect(universe.project({ kind: "code-contexts", now: 1_001_000 })).toMatchObject({
        contexts: [{ agents: [{ id: "agent-1" }] }],
      });
      expect(universe.snapshot().agents[0]?.archivedAt).toBeUndefined();
    },
  );

  test.each(["restart", "unavailable", "partial", "conflict"] as const)(
    "retains %s execution evidence as uncertainty until confirmed ended",
    (mode) => {
      const { universe } = makeUniverse();
      universe.execute({ type: "CreateGoal", title: "Archived goal" });
      const snapshot = hostSnapshot([observation("pane", "Uncertain worker", "blocked")]);
      admitObservedConversationsAndReconcile(universe, snapshot);
      universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
      universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
      universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
      if (mode === "restart") universe.invalidateRuntimeFacts();
      else if (mode === "conflict") {
        const first = snapshot.agents[0]!;
        universe.reconcile({
          ...snapshot,
          observedAt: 1_001_000,
          agents: [
            { ...first, observedAt: 1_001_000 },
            {
              ...first,
              nativeId: "other-pane",
              hostLocator: "opaque:other-pane",
              observedAt: 1_001_000,
            },
          ],
        });
      } else {
        // A partial snapshot must not promote previously uncertain facts to live.
        if (mode === "partial") universe.invalidateRuntimeFacts();
        universe.reconcile({
          ...hostSnapshot([], 1_001_000),
          available: mode !== "unavailable",
          complete: false,
        });
      }
      const projection = universe.project({ kind: "command-centre", now: 1_002_000 });
      if (projection.kind !== "command-centre") throw new Error("wrong projection");
      expect(projection.counts.agents).toBe(1);
      expect(projection.counts.attention).toBe(0);
      expect(projection.goals[0]?.staleCount).toBe(1);
      expect(projection.goals[0]?.agents[0]?.executionPresence).toBe(
        mode === "conflict" ? "conflict" : "unknown",
      );
      expect(projection.attention.items.find((item) => item.agentId === "agent-1")).toMatchObject({
        reason: "runtime-unknown",
        requiresHumanInput: false,
      });
      universe.reconcile(hostSnapshot([], 1_003_000));
      expect(universe.project({ kind: "command-centre", now: 1_003_000 })).toMatchObject({
        goals: [],
        counts: { agents: 0, attention: 0 },
      });
      expect(universe.snapshot().goals[0]?.status).toBe("archived");
    },
  );

  test("does not expose archived goals for never-observed or confirmed-ended Agents", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Archived goal" });
    universe.execute({
      type: "AddConversation",
      admissionSource: "managed-launch",
      harnessId: "test",
      nativeConversationRef: { harnessId: "test", kind: "id", value: "never-observed" },
      displayName: "Never observed",
      observedAt: 1_000_000,
    });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "Ended worker")]),
    );
    for (const agentId of ["agent-1", "agent-2"])
      universe.execute({ type: "AssignAgent", agentId, goalId: "goal-1" });
    universe.reconcile(hostSnapshot([], 1_001_000));
    universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
    universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
    expect(universe.project({ kind: "command-centre", now: 1_002_000 })).toMatchObject({
      goals: [],
      attention: { items: [] },
      counts: { agents: 0 },
    });
    expect(
      universe.project({ kind: "command-centre", now: 1_002_000, includeArchived: true }),
    ).toMatchObject({ goals: [{ status: "archived" }], counts: { agents: 2 } });
  });

  test("surfaces a live archived Agent as attention without restoring it", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "archived worker", "working")]),
    );
    universe.execute({ type: "ArchiveAgent", agentId: "agent-1" });

    const projection = universe.project({ kind: "command-centre", now: 1_001_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.unassigned).toHaveLength(1);
    expect(projection.unassigned[0]?.displayName).toBe("archived worker");
    expect(projection.counts.agents).toBe(1);
    expect(projection.attention.items).toMatchObject([
      { agentId: "agent-1", reason: "archived-running", requiresHumanInput: true },
    ]);
    expect(universe.snapshot().agents[0]?.archivedAt).toBeDefined();
  });

  test("inspector reports host facts without making infrastructure nodes", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Goal" });
    admitObservedConversationsAndReconcile(universe, hostSnapshot([observation("pane", "worker")]));
    const projection = universe.project({
      kind: "inspector",
      target: { type: "agent", id: "agent-1" },
      now: 1_000_000,
    });
    if (projection.kind !== "agent-inspector") throw new Error("wrong projection");
    expect(projection.agent.execution?.hostKind).toBe("test-host");
    expect(projection.agent.repository).toBe("repo");
    expect(projection.lines.join("\n")).toContain("worktree");
  });

  test("projects a stable portfolio of goal bodies and direct satellites", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Map goal", priority: "P0" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane-a", "satellite-a"), observation("pane-b", "satellite-b")]),
    );
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-1",
      goalId: "goal-1",
    });
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-2",
      goalId: "goal-1",
    });
    const first = universe.project({
      kind: "universe-map",
      now: 1_000_000,
    });
    const second = universe.project({
      kind: "universe-map",
      now: 1_000_000,
    });
    expect(first.kind).toBe("universe-map");
    expect(second.kind).toBe("universe-map");
    if (first.kind !== "universe-map" || second.kind !== "universe-map") return;
    expect(first.goals[0]?.mapPosition).toEqual(second.goals[0]?.mapPosition);
    expect(first.goals[0]?.radiusX).toBeGreaterThan(7);
    expect(first.goals[0]?.agents).toHaveLength(2);
    expect(first.goals[0]?.agents[0]?.mapPosition).toEqual(second.goals[0]?.agents[0]?.mapPosition);
    expect(first.goals[0]?.priority).toBe("P0");
  });

  test("projects unassigned agents into a stable neutral inbox sector", () => {
    const { universe } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Map goal" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("assigned", "assigned"), observation("unassigned", "unassigned")]),
    );
    universe.execute({
      type: "AssignAgent",
      agentId: "agent-1",
      goalId: "goal-1",
    });
    const first = universe.project({ kind: "universe-map", now: 1_000_000 });
    const second = universe.project({ kind: "universe-map", now: 1_000_000 });
    if (first.kind !== "universe-map" || second.kind !== "universe-map")
      throw new Error("wrong projection");
    expect(first.unassigned).toHaveLength(1);
    expect(first.inboxPosition).toEqual(second.inboxPosition);
    expect(first.unassigned[0]?.mapPosition).toEqual(second.unassigned[0]?.mapPosition);
    expect(first.unassigned[0]?.goalTitle).toBeUndefined();
  });

  test("preserves a confirmed-absent unassigned conversation without false attention", () => {
    const { universe } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("live", "live agent"), observation("missing", "stale agent")]),
    );
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("live", "live agent")], 1_005_000),
    );

    const projection = universe.project({ kind: "command-centre", now: 1_005_000 });
    if (projection.kind !== "command-centre") throw new Error("wrong projection");
    expect(projection.counts.stale).toBe(0);
    expect(projection.unassigned).toHaveLength(2);
    const stale = projection.unassigned.find((agent) => agent.displayName === "stale agent");
    expect(stale?.hostHealth).toBe("stale");
    expect(stale?.executionPresence).toBe("absent");
    expect(stale?.observationHealth).toBe("fresh");
    expect(stale?.attention).toBeUndefined();
  });

  test("groups only post-checkpoint changes into a deterministic catch-up projection", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Catch-up goal" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "worker", "working")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 4 });

    clock.value += 1_000;
    universe.execute({ type: "SetGoalPriority", goalId: "goal-1", priority: "P0" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "worker", "done")], clock.now()),
    );
    const projection = universe.project({ kind: "catch-up", now: clock.now() });
    if (projection.kind !== "catch-up") throw new Error("wrong projection");

    expect(projection.pending).toBe(true);
    expect(projection.transitionCount).toBe(2);
    expect(projection.subjects).toHaveLength(1);
    expect(projection.subjects[0]).toMatchObject({
      subjectType: "goal",
      subjectId: "goal-1",
      title: "Catch-up goal",
      affectedTargetCount: 2,
      transitionCount: 2,
      summaries: [
        { kind: "finished", count: 1, label: "1 Agent finished" },
        { kind: "changed", count: 1, label: "1 Goal changed" },
      ],
    });
    expect(projection.counts.finished).toBe(1);
    expect(projection.counts.changed).toBe(1);
    expect(projection.subjects[0]?.transitions.map((item) => item.outcome)).toEqual([
      "finished",
      "changed",
    ]);
  });

  test.each(["blocked", "waiting"] as const)(
    "metadata does not resolve %s attention",
    (runtimeState) => {
      const { universe, clock } = makeUniverse();
      universe.execute({ type: "CreateGoal", title: "Catch up" });
      admitObservedConversationsAndReconcile(
        universe,
        hostSnapshot([observation("pane", "worker", "working")]),
      );
      universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
      universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 4 });
      clock.value += 1_000;
      universe.reconcile(hostSnapshot([observation("pane", "worker", runtimeState)], clock.now()));
      universe.execute({ type: "RenameAgent", agentId: "agent-1", displayName: "Renamed" });
      universe.execute({
        type: "SetAgentDescription",
        agentId: "agent-1",
        description: "Metadata",
      });
      universe.execute({ type: "UnassignAgent", agentId: "agent-1" });
      expect(universe.project({ kind: "command-centre", now: clock.now() })).toMatchObject({
        counts: { attention: 1 },
      });
      expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
        counts: { attention: 1 },
        subjects: [{ summaries: [{ kind: "attention" }] }],
      });
    },
  );

  test.each(["agent", "goal"] as const)(
    "metadata preserves unresolved execution under an archived %s",
    (target) => {
      const { universe, clock } = makeUniverse();
      universe.execute({ type: "CreateGoal", title: "Archived context" });
      admitObservedConversationsAndReconcile(
        universe,
        hostSnapshot([observation("pane", "worker", "working")]),
      );
      universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
      if (target === "agent") universe.execute({ type: "ArchiveAgent", agentId: "agent-1" });
      else {
        universe.execute({ type: "CompleteGoal", goalId: "goal-1" });
        universe.execute({ type: "ArchiveGoal", goalId: "goal-1" });
      }
      const displayed = universe.project({ kind: "catch-up", now: clock.now() });
      if (displayed.kind !== "catch-up") throw new Error("Wrong projection");
      universe.execute({
        type: "AcknowledgeCatchUp",
        throughSequence: displayed.throughSequence,
      });
      universe.execute({ type: "RenameAgent", agentId: "agent-1", displayName: "Renamed" });
      expect(universe.project({ kind: "command-centre", now: clock.now() })).toMatchObject({
        counts: { attention: 1 },
      });
      expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
        counts: { attention: 1, finished: 0 },
        subjects: [{ summaries: [{ kind: "attention" }] }],
      });
      clock.value += 1_000;
      universe.reconcile(hostSnapshot([observation("pane", "worker", "blocked")], clock.now()));
      universe.execute({ type: "SetAgentDescription", agentId: "agent-1", description: "Blocked" });
      expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
        counts: { attention: 1, finished: 0 },
        subjects: [{ summaries: [{ kind: "attention" }] }],
      });
      universe.invalidateRuntimeFacts();
      universe.execute({ type: "SetAgentDescription", agentId: "agent-1", description: "Unknown" });
      expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
        counts: { stale: 1, attention: 0, finished: 0 },
        subjects: [{ summaries: [{ kind: "stale" }] }],
      });
    },
  );

  test("metadata preserves uncertainty until fresh host recovery", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "worker", "working")]),
    );
    universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 2 });
    clock.value += 1_000;
    universe.reconcile({ ...hostSnapshot([], clock.now()), available: false, complete: false });
    universe.execute({ type: "RenameAgent", agentId: "agent-1", displayName: "Renamed" });
    universe.execute({
      type: "SetAgentDescription",
      agentId: "agent-1",
      description: "Still uncertain",
    });
    expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
      counts: { stale: 1 },
      subjects: [{ summaries: [{ kind: "stale" }] }],
    });
    clock.value += 1_000;
    universe.reconcile({ ...hostSnapshot([], clock.now()), complete: false });
    universe.execute({
      type: "SetAgentDescription",
      agentId: "agent-1",
      description: "Partial is not recovery",
    });
    expect(universe.project({ kind: "catch-up", now: clock.now() })).toMatchObject({
      counts: { stale: 1 },
      subjects: [{ summaries: [{ kind: "stale" }] }],
    });
    clock.value += 1_000;
    universe.reconcile(hostSnapshot([observation("pane", "worker", "working")], clock.now()));
    universe.execute({ type: "SetAgentDescription", agentId: "agent-1", description: "Recovered" });
    const recovered = universe.project({ kind: "catch-up", now: clock.now() });
    expect(recovered).toMatchObject({
      counts: { stale: 0 },
      subjects: [{ summaries: [{ kind: "stale-resolved" }] }],
    });
    if (recovered.kind !== "catch-up") throw new Error("Wrong projection");
    expect(recovered.subjects[0]?.transitions.some((item) => item.outcome === "stale")).toBe(true);
  });

  test("synthesises resolved attention from one Agent trajectory", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateGoal", title: "Resolve operator input" });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "worker", "working")]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 4 });

    clock.value += 1_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "worker", "waiting")], clock.now()),
    );
    clock.value += 1_000;
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([observation("pane", "worker", "idle")], clock.now()),
    );
    universe.execute({
      type: "RenameAgent",
      agentId: "agent-1",
      displayName: "Resolved and renamed",
    });

    const projection = universe.project({ kind: "catch-up", now: clock.now() });
    if (projection.kind !== "catch-up") throw new Error("wrong projection");
    expect(projection.subjects).toHaveLength(1);
    expect(projection.subjects[0]?.summaries).toEqual([
      {
        kind: "attention-resolved",
        count: 1,
        label: "1 Agent no longer needs judgment",
      },
    ]);
    expect(projection.subjects[0]?.transitionCount).toBe(3);
    expect(projection.subjects[0]?.transitions.map((item) => item.outcome)).toEqual([
      "changed",
      "changed",
      "attention",
    ]);
  });
});
