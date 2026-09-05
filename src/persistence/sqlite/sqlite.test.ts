import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { SqliteUniverseStore } from "./sqlite-store.ts";
import {
  admitObservedConversationsAndReconcile,
  makeUniverse,
  hostSnapshot,
} from "../../universe/test-support.ts";

const observation = {
  nativeId: "pane-1",
  displayName: "agent",
  runtimeState: "working" as const,
  runtimeStateSource: "fixture",
  observedAt: 1_000_000,
  repository: "repo",
  branch: "main",
  worktree: "/tree",
  provider: "codex",
  harnessEvidence: {
    detectedHarnessId: "codex",
    nativeConversationRef: {
      harnessId: "codex",
      kind: "session-id",
      value: "persisted-session",
    },
    restoreState: "host-restored" as const,
    source: "native-integration" as const,
    observedAt: 1_000_000,
  },
  executionContainer: { id: "container-1", label: "Persisted context" },
  hostLocator: "opaque:pane-1",
};

describe("SQLite persistence", () => {
  test("unchanged long history has zero mutations; append, edits and truncation preserve the save contract", () => {
    const store = new SqliteUniverseStore(":memory:");
    try {
      const state = store.load();
      state.changes = Array.from({ length: 10_000 }, (_, index) => ({
        sequence: index + 1,
        occurredAt: index,
        outcome: "changed",
        targetType: "goal",
        targetId: "goal",
        summary: "Synthetic history",
      }));
      store.save(state);
      const count = () => store.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
      let before = count();
      store.save(structuredClone(state));
      expect(count() - before).toBe(0);
      // Triggers prove that no operation touches an existing historical prefix.
      store.db.exec(`
        CREATE TEMP TRIGGER protect_history_delete BEFORE DELETE ON universe_changes
        BEGIN SELECT RAISE(ABORT, 'history prefix deleted'); END;
        CREATE TEMP TRIGGER protect_history_update BEFORE UPDATE ON universe_changes
        BEGIN SELECT RAISE(ABORT, 'history prefix updated'); END;
      `);
      state.changes.push({ ...state.changes[0]!, sequence: 10_001 });
      before = count();
      store.save(state);
      expect(count() - before).toBe(1);
      store.db.exec("DROP TRIGGER protect_history_delete; DROP TRIGGER protect_history_update;");
      state.changes[0] = { ...state.changes[0]!, summary: "Explicit replacement", goalId: "goal" };
      state.changes.pop();
      store.save(state);
      expect(store.load().changes).toEqual(state.changes);
      state.changes[0] = { ...state.changes[0], goalId: undefined };
      store.save(state);
      expect(store.load().changes).toEqual(state.changes);
      expect(() =>
        store.save({ ...state, changes: [state.changes[0]!, state.changes[0]!] }),
      ).toThrow("Duplicate snapshot key");
      store.save(state);
      expect(store.load().changes).toEqual(state.changes);
    } finally {
      store.close();
    }
  });

  test("changed rows, identity swaps, optional clearing and actual removals round-trip atomically", () => {
    const store = new SqliteUniverseStore(":memory:");
    try {
      const setup = makeUniverse({ store });
      setup.universe.execute({ type: "CreateSystem", title: "System" });
      setup.universe.execute({ type: "CreateGoal", title: "Goal", systemId: "system-1" });
      admitObservedConversationsAndReconcile(setup.universe, hostSnapshot([observation]));
      setup.universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
      setup.universe.execute({
        type: "DismissRelatedAgents",
        goalId: "goal-1",
        agentIds: ["agent-1"],
      });
      const state = store.load();
      state.agents.push({
        ...state.agents[0]!,
        id: "agent-2",
        execution: { ...state.agents[0]!.execution!, nativeId: "pane-2" },
      });
      state.operatorCheckpoint = { lastSequence: 1, acknowledgedAt: 100 };
      store.save(state);
      const before = store.load();
      const count = () => store.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
      const unchangedCount = count();
      store.save(before);
      expect(count() - unchangedCount).toBe(0);
      const refreshed = structuredClone(before);
      refreshed.hosts[0] = { ...refreshed.hosts[0]!, lastObservedAt: 1_000_001 };
      store.save(refreshed);
      expect(count() - unchangedCount).toBe(2);
      store.save(before);
      const next = structuredClone(before);
      next.systems[0] = { ...next.systems[0]!, title: "Changed system" };
      next.goals[0] = { ...next.goals[0]!, title: "Changed goal" };
      next.agents[0] = { ...next.agents[0]!, execution: before.agents[1]!.execution };
      next.agents[1] = { ...next.agents[1]!, execution: before.agents[0]!.execution };
      next.hosts[0] = { ...next.hosts[0]!, lastError: "Synthetic error" };
      next.relatedAgentDismissals[0] = {
        ...next.relatedAgentDismissals[0]!,
        dismissedAt: 1_000_001,
      };
      next.changes[0] = { ...next.changes[0]!, summary: "Changed history" };
      next.operatorCheckpoint = { lastSequence: 2, acknowledgedAt: 101 };
      // Last table fails after all seven semantic tables have been touched.
      store.db.exec(`CREATE TEMP TRIGGER fail_checkpoint BEFORE INSERT ON operator_checkpoint
        BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
      expect(() => store.save(next)).toThrow("late failure");
      expect(store.load()).toEqual(before);
      store.db.exec("DROP TRIGGER fail_checkpoint");
      store.save(next);
      expect(store.load()).toEqual(next);
      const invalid = structuredClone(next);
      invalid.systems = [];
      expect(() => store.save(invalid)).toThrow("FOREIGN KEY");
      expect(store.load()).toEqual(next);
      const duplicateExecution = structuredClone(next);
      duplicateExecution.agents[1] = {
        ...duplicateExecution.agents[1]!,
        execution: duplicateExecution.agents[0]!.execution,
      };
      expect(() => store.save(duplicateExecution)).toThrow("UNIQUE");
      expect(store.load()).toEqual(next);
      store.save(next);
      next.systems = [];
      next.goals = [];
      next.relatedAgentDismissals = [];
      next.hosts = [];
      next.operatorCheckpoint = undefined;
      next.agents = [
        {
          ...next.agents[0],
          primaryGoalId: undefined,
          execution: undefined,
          executionObservedAt: undefined,
          executionContainer: undefined,
          repository: undefined,
          branch: undefined,
          worktree: undefined,
          provider: undefined,
        },
      ];
      store.save(next);
      expect(store.load()).toEqual(next);
      next.agents = [];
      next.changes = [];
      store.save(next);
      expect(store.load()).toEqual(next);
    } finally {
      store.close();
    }
  });

  test("bookkeeping recovers after outer rollback, reset and writes from another connection", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-save-cache-"));
    const path = join(directory, "universe.sqlite");
    const store = new SqliteUniverseStore(path);
    try {
      const setup = makeUniverse({ store });
      setup.universe.execute({ type: "CreateGoal", title: "Stable" });
      const before = store.load();
      const next = structuredClone(before);
      next.goals[0] = { ...next.goals[0]!, title: "Next" };
      expect(() =>
        store.db.transaction(() => {
          store.save(next);
          throw new Error("outer rollback");
        })(),
      ).toThrow("outer rollback");
      expect(store.load()).toEqual(before);
      store.save(next);
      expect(store.load()).toEqual(next);
      store.resetAllState();
      store.save(next);
      expect(store.load()).toEqual(next);
      const other = new SqliteUniverseStore(path);
      try {
        other.save(before);
      } finally {
        other.close();
      }
      store.save(next);
      expect(store.load()).toEqual(next);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("restart and routine saves preserve both explicit checkpoints and newer unread events", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-save-checkpoints-"));
    const path = join(directory, "universe.sqlite");
    let store = new SqliteUniverseStore(path);
    try {
      const setup = makeUniverse({ store });
      setup.universe.execute({ type: "CreateGoal", title: "Seen" });
      setup.universe.execute({ type: "RenameGoal", goalId: "goal-1", title: "Unread" });
      setup.universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 1 });
      const claims = [1, 2].map((sequence) => ({
        schemaVersion: 1 as const,
        observationId: `event-${sequence}`,
        nativeConversationRef: {
          harnessId: "codex",
          continuityScopeId: "scope",
          kind: "id",
          value: "synthetic",
        },
        providerInstanceId: "test",
        kind: "activity" as const,
        observedAt: sequence,
        source: { mechanism: "hook" as const },
        payload: { phase: "idle" as const },
      }));
      store.reconcileAgentObservations(
        {
          schemaVersion: 1,
          harnessId: "codex",
          providerInstanceId: "test",
          continuityScopeId: "scope",
          capturedAt: 2,
          complete: true,
          current: claims,
          transitions: claims,
          health: { state: "healthy", diagnostics: [] },
        },
        {
          kinds: ["activity"],
          acquisition: "hook",
          delivery: "retained-events-and-snapshot",
          configured: true,
          freshnessSeconds: { activity: 120 },
        },
        2,
        "test-plugin",
      );
      store.acknowledgeAgentObservations(1, 3);
      const state = store.load();
      store.save(state);
      store.close();
      store = new SqliteUniverseStore(path);
      const count = () => store.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
      const restartCount = count();
      store.save(state);
      expect(count() - restartCount).toBe(0);
      expect(store.load()).toEqual(state);
      expect(store.observationCheckpoint()).toEqual({ sequence: 1, acknowledgedAt: 3 });
      expect(store.agentObservationTransitions(0).map((event) => event.sequence)).toEqual([2]);
      expect(store.currentAgentObservations()).toHaveLength(2);
      expect(
        makeUniverse({ store }).universe.project({ kind: "catch-up", now: setup.clock.now() }),
      ).toMatchObject({ pending: true, transitionCount: 1 });
      const before = count();
      store.save(state);
      expect(count() - before).toBe(0);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists accepted goals, assignments and host observations across store restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-v0-sqlite-"));
    const databasePath = join(directory, "universe.sqlite");
    const first = new SqliteUniverseStore(databasePath);
    try {
      const setup = makeUniverse({ store: first });
      setup.universe.execute({ type: "CreateSystem", title: "Persisted system" });
      setup.universe.execute({
        type: "CreateGoal",
        title: "Persisted",
        priority: "P1",
        systemId: "system-1",
      });
      setup.universe.execute({
        type: "SetGoalMapPosition",
        goalId: "goal-1",
        position: { x: 123, y: -45 },
      });
      admitObservedConversationsAndReconcile(setup.universe, hostSnapshot([observation]));
      setup.universe.execute({
        type: "AssignAgent",
        agentId: "agent-1",
        goalId: "goal-1",
      });
      setup.universe.execute({
        type: "DismissRelatedAgents",
        goalId: "goal-1",
        agentIds: ["agent-1"],
      });
      const state = first.load();
      expect(state.goals[0]?.title).toBe("Persisted");
      expect(state.systems[0]?.title).toBe("Persisted system");
      expect(state.goals[0]?.systemId).toBe("system-1");
      expect(state.goals[0]?.mapPosition).toEqual({ x: 123, y: -45 });
      expect(state.goals[0]?.mapPositionPinned).toBe(true);
      expect(state.agents[0]?.primaryGoalId).toBe("goal-1");
      expect(state.agents[0]?.executionContainer).toEqual({
        id: "container-1",
        label: "Persisted context",
      });
      expect(state.agents[0]?.nativeConversationRef).toEqual({
        harnessId: "codex",
        kind: "session-id",
        value: "persisted-session",
      });
      expect(state.agents[0]?.continuity).toBe("proved");
      expect(state.relatedAgentDismissals).toEqual([
        { goalId: "goal-1", agentId: "agent-1", dismissedAt: 1_000_000 },
      ]);
      first.close();

      const second = new SqliteUniverseStore(databasePath);
      try {
        expect(second.load()).toEqual(state);
        const recovered = makeUniverse({ store: second }).universe;
        expect(recovered.reconcile(hostSnapshot([observation])).accepted).toBe(true);
        expect(recovered.snapshot().agents[0]?.primaryGoalId).toBe("goal-1");
      } finally {
        second.close();
      }
    } finally {
      first.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("initializes the complete clean-break schema", () => {
    const store = new SqliteUniverseStore(":memory:");
    expect(
      store.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
    ).toBe(3);
    expect(
      store.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .all(),
    ).toEqual([]);
    const columns = store.db.query<{ name: string }, []>("PRAGMA table_info(agents)").all();
    expect(columns.map((column) => column.name)).toContain("last_changed_at");
    expect(columns.map((column) => column.name)).toContain("display_name_source");
    expect(columns.map((column) => column.name)).toContain("archived_at");
    expect(columns.map((column) => column.name)).toContain("execution_container_id");
    expect(columns.map((column) => column.name)).toContain("execution_container_label");
    expect(columns.map((column) => column.name)).toContain("continuity_scope_id");
    const goalColumns = store.db.query<{ name: string }, []>("PRAGMA table_info(goals)").all();
    expect(goalColumns.map((column) => column.name)).toContain("map_x");
    expect(goalColumns.map((column) => column.name)).toContain("map_pinned");
    expect(goalColumns.map((column) => column.name)).toContain("system_id");
    expect(
      store.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'systems'",
        )
        .all(),
    ).toHaveLength(1);
    expect(
      store.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agent_observation_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      "agent_observation_checkpoint",
      "agent_observation_current",
      "agent_observation_sources",
      "agent_observation_transitions",
    ]);
    const dismissalTables = store.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'related_agent_dismissals'",
      )
      .all();
    expect(dismissalTables).toHaveLength(1);
    expect(
      store.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('universe_changes', 'operator_checkpoint') ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual(["operator_checkpoint", "universe_changes"]);
    expect(
      store.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('provider_catalogue_freshness', 'provider_conversations') ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual(["provider_catalogue_freshness", "provider_conversations"]);
    expect(
      store.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_catalogue_baselines'",
        )
        .all(),
    ).toEqual([]);
    store.close();
  });

  test("requires an explicit reset for an incompatible database", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-old-schema-"));
    const databasePath = join(directory, "universe.sqlite");
    try {
      const legacy = new Database(databasePath, { create: true });
      legacy.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES (13, 1);
      `);
      legacy.close();

      expect(() => new SqliteUniverseStore(databasePath)).toThrow("Reset it before starting");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists provider and execution lifetimes independently across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-continuity-sqlite-"));
    const databasePath = join(directory, "universe.sqlite");
    try {
      const first = new SqliteUniverseStore(databasePath);
      const fixture = makeUniverse({ store: first });
      fixture.universe.execute({
        type: "AddConversation",
        admissionSource: "provider-catalogue",
        resumeEligibility: "same-site",
        harnessId: "codex",
        nativeConversationRef: {
          harnessId: "codex",
          continuityScopeId: "scope-persisted",
          kind: "id",
          value: "conversation-persisted",
        },
        displayName: "Persisted continuity",
        workspaceRef: "/tree",
        observedAt: 1_000_000,
      });
      admitObservedConversationsAndReconcile(
        fixture.universe,
        hostSnapshot([
          {
            ...observation,
            harnessEvidence: {
              ...observation.harnessEvidence,
              nativeConversationRef: {
                harnessId: "codex",
                continuityScopeId: "scope-persisted",
                kind: "id",
                value: "conversation-persisted",
              },
            },
          },
        ]),
      );
      admitObservedConversationsAndReconcile(fixture.universe, hostSnapshot([], 1_001_000));
      first.close();

      const second = new SqliteUniverseStore(databasePath);
      expect(second.load().agents[0]).toMatchObject({
        providerContinuity: "confirmed",
        executionPresence: "absent",
        resumeCapability: "eligible",
        observationHealth: "fresh",
        executionHistory: [{ nativeId: "pane-1", hostInstanceId: "test-host:default" }],
      });
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists semantic changes and the operator checkpoint across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-catch-up-sqlite-"));
    const databasePath = join(directory, "universe.sqlite");
    try {
      const first = new SqliteUniverseStore(databasePath);
      const setup = makeUniverse({ store: first });
      setup.universe.execute({ type: "CreateGoal", title: "Persist catch-up" });
      setup.universe.execute({ type: "RenameGoal", goalId: "goal-1", title: "Unseen change" });
      setup.universe.execute({ type: "AcknowledgeCatchUp", throughSequence: 1 });
      first.close();

      const second = new SqliteUniverseStore(databasePath);
      expect(second.load().changes).toHaveLength(2);
      expect(second.load().operatorCheckpoint?.lastSequence).toBe(1);
      expect(
        makeUniverse({ store: second }).universe.project({
          kind: "catch-up",
          now: setup.clock.now(),
        }),
      ).toMatchObject({ pending: true, transitionCount: 1 });
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists the explicit archive marker for stale agents", () => {
    const store = new SqliteUniverseStore(":memory:");
    const setup = makeUniverse({ store });
    admitObservedConversationsAndReconcile(setup.universe, hostSnapshot([observation]));
    setup.clock.value = 1_001_000;
    admitObservedConversationsAndReconcile(setup.universe, hostSnapshot([], setup.clock.value));
    expect(setup.universe.execute({ type: "ArchiveAgent", agentId: "agent-1" })).toEqual({
      ok: true,
      agentId: "agent-1",
    });
    expect(store.load().agents[0]?.archivedAt).toBe(1_001_000);
    store.close();
  });

  test("a failed write leaves the previous SQLite state intact", () => {
    const store = new SqliteUniverseStore(":memory:");
    const setup = makeUniverse({ store });
    setup.universe.execute({ type: "CreateGoal", title: "Stable" });
    const before = store.load();
    const original = store.db.prepare.bind(store.db);
    store.db.prepare = (sql: string) => {
      if (sql.includes("INSERT INTO goals")) throw new Error("injected SQL failure");
      return original(sql);
    };
    expect(() =>
      store.save({
        ...before,
        goals: [...before.goals, { ...before.goals[0]!, id: "goal-extra", title: "Extra" }],
      }),
    ).toThrow("injected SQL failure");
    expect(store.load()).toEqual(before);
    store.close();
  });
});
