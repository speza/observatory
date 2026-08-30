import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { SqliteUniverseStore } from "./sqlite-store.ts";
import { makeUniverse, hostSnapshot } from "../../universe/test-support.ts";

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
      setup.universe.reconcile(hostSnapshot([observation]));
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

  test("migrations create the complete current schema", () => {
    const store = new SqliteUniverseStore(":memory:");
    const versions = store.db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version")
      .all();
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
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
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_sessions'",
        )
        .all(),
    ).toHaveLength(1);
    store.close();
  });

  test("persists provider and execution lifetimes independently across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-continuity-sqlite-"));
    const databasePath = join(directory, "universe.sqlite");
    try {
      const first = new SqliteUniverseStore(databasePath);
      const fixture = makeUniverse({ store: first });
      fixture.universe.execute({
        type: "AdoptProviderSession",
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
      fixture.universe.reconcile(
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
      fixture.universe.reconcile(hostSnapshot([], 1_001_000));
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

  test("migrates a version 2 Agent execution identity without treating it as continuity proof", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-v2-migration-"));
    const databasePath = join(directory, "universe.sqlite");
    try {
      const legacy = new Database(databasePath, { create: true });
      legacy.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES (1, 1), (2, 2);
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          host_kind TEXT NOT NULL,
          native_id TEXT NOT NULL,
          host_locator TEXT NOT NULL,
          display_name TEXT NOT NULL,
          display_name_source TEXT NOT NULL,
          description TEXT,
          primary_goal_id TEXT,
          runtime_state TEXT NOT NULL,
          runtime_state_source TEXT NOT NULL,
          host_health TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          last_observed_at INTEGER NOT NULL,
          last_changed_at INTEGER NOT NULL,
          attention_since INTEGER,
          repository TEXT,
          branch TEXT,
          worktree TEXT,
          provider TEXT,
          execution_container_id TEXT,
          execution_container_label TEXT,
          archived_at INTEGER
        );
        INSERT INTO agents VALUES (
          'legacy-agent', 'herdr', 'pane-1', 'opaque', 'Legacy', 'host', NULL, NULL,
          'working', 'herdr.agent_status', 'live', 10, 10, 10, NULL,
          'repo', 'main', '/repo', 'codex', NULL, NULL, NULL
        );
      `);
      legacy.close();

      const migrated = new SqliteUniverseStore(databasePath);
      const agent = migrated.load().agents[0];
      expect(agent).toMatchObject({
        id: "legacy-agent",
        execution: { hostKind: "herdr", nativeId: "pane-1", hostLocator: "opaque" },
        continuity: "unknown",
      });
      expect(agent?.harnessId).toBeUndefined();
      expect(agent?.nativeConversationRef).toBeUndefined();
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("migrates version 4 launch receipts to durable recovery without losing deduplication", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-v4-launch-migration-"));
    const databasePath = join(directory, "universe.sqlite");
    try {
      const legacy = new Database(databasePath, { create: true });
      legacy.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO schema_migrations VALUES (1, 1), (2, 2), (3, 3), (4, 4);
        CREATE TABLE launch_receipts (
          request_id TEXT PRIMARY KEY,
          intent_fingerprint TEXT NOT NULL,
          result_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO launch_receipts VALUES (
          'legacy-request',
          'legacy-fingerprint',
          '{"status":"pending","message":"Waiting for observation.","requestId":"legacy-request"}',
          4
        );
      `);
      legacy.close();

      const migrated = new SqliteUniverseStore(databasePath);
      expect(
        migrated.db
          .query<{ name: string }, []>("PRAGMA table_info(launch_receipts)")
          .all()
          .map((column) => column.name),
      ).toContain("recovery_json");
      expect(
        migrated.reserveLaunchReceipt({
          requestId: "legacy-request",
          intentFingerprint: "legacy-fingerprint",
          result: {
            status: "pending",
            message: "Waiting for observation.",
            requestId: "legacy-request",
          },
        }),
      ).toMatchObject({
        kind: "existing",
        receipt: { recovery: undefined },
      });
      migrated.close();
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
      setup.universe.execute({ type: "AcknowledgeCatchUp" });
      first.close();

      const second = new SqliteUniverseStore(databasePath);
      expect(second.load().changes).toHaveLength(1);
      expect(second.load().operatorCheckpoint?.lastSequence).toBe(1);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists the explicit archive marker for stale agents", () => {
    const store = new SqliteUniverseStore(":memory:");
    const setup = makeUniverse({ store });
    setup.universe.reconcile(hostSnapshot([observation]));
    setup.clock.value = 1_001_000;
    setup.universe.reconcile(hostSnapshot([], setup.clock.value));
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
