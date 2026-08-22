import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteUniverseStore } from "./sqlite-store.ts";
import { makeUniverse, hostSnapshot } from "../../universe/test-support.ts";

const observation = {
  nativeId: "pane-1",
  displayName: "session",
  runtimeState: "working" as const,
  runtimeStateSource: "fixture",
  observedAt: 1_000_000,
  repository: "repo",
  branch: "main",
  worktree: "/tree",
  provider: "codex",
  hostLocator: "opaque:pane-1",
};

describe("SQLite persistence", () => {
  test("persists accepted goals, assignments and host observations across store restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-v0-sqlite-"));
    const databasePath = join(directory, "universe.sqlite");
    const first = new SqliteUniverseStore(databasePath);
    try {
      const setup = makeUniverse({ store: first });
      setup.universe.execute({
        type: "CreateGoal",
        title: "Persisted",
        priority: "P1",
      });
      setup.universe.execute({
        type: "SetGoalMapPosition",
        goalId: "goal-1",
        position: { x: 123, y: -45 },
      });
      setup.universe.reconcile(hostSnapshot([observation]));
      setup.universe.execute({
        type: "AssignSession",
        sessionId: "session-1",
        goalId: "goal-1",
      });
      const state = first.load();
      expect(state.goals[0]?.title).toBe("Persisted");
      expect(state.goals[0]?.mapPosition).toEqual({ x: 123, y: -45 });
      expect(state.goals[0]?.mapPositionPinned).toBe(true);
      expect(state.sessions[0]?.primaryGoalId).toBe("goal-1");
      first.close();

      const second = new SqliteUniverseStore(databasePath);
      try {
        expect(second.load()).toEqual(state);
        const recovered = makeUniverse({ store: second }).universe;
        expect(recovered.reconcile(hostSnapshot([observation])).accepted).toBe(
          true,
        );
        expect(recovered.snapshot().sessions[0]?.primaryGoalId).toBe("goal-1");
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
      .query("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    const columns = store.db
      .query("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("last_changed_at");
    expect(columns.map((column) => column.name)).toContain(
      "display_name_source",
    );
    const goalColumns = store.db
      .query("PRAGMA table_info(goals)")
      .all() as Array<{ name: string }>;
    expect(goalColumns.map((column) => column.name)).toContain("map_x");
    expect(goalColumns.map((column) => column.name)).toContain("map_pinned");
    store.close();
  });

  test("a failed write leaves the previous SQLite state intact", () => {
    const store = new SqliteUniverseStore(":memory:");
    const setup = makeUniverse({ store });
    setup.universe.execute({ type: "CreateGoal", title: "Stable" });
    const before = store.load();
    const original = store.db.prepare.bind(store.db);
    store.db.prepare = ((sql: string) => {
      if (sql.includes("INSERT INTO goals"))
        throw new Error("injected SQL failure");
      return original(sql);
    }) as typeof store.db.prepare;
    expect(() =>
      store.save({
        ...before,
        goals: [
          ...before.goals,
          { ...before.goals[0]!, id: "goal-extra", title: "Extra" },
        ],
      }),
    ).toThrow("injected SQL failure");
    expect(store.load()).toEqual(before);
    store.close();
  });
});
