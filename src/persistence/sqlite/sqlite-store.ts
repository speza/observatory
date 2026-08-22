import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  type Goal,
  type HostHealth,
  type TrackedSession,
  type UniverseState,
  type UniverseStore,
} from "../../universe/types.ts";

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  archived_at: number | null;
  map_x: number | null;
  map_y: number | null;
  map_pinned: number;
}

interface SessionRow {
  id: string;
  host_kind: string;
  native_id: string;
  display_name: string;
  display_name_source: string;
  description: string | null;
  primary_goal_id: string | null;
  runtime_state: string;
  runtime_state_source: string;
  host_health: string;
  last_seen_at: number;
  last_observed_at: number;
  last_changed_at: number;
  attention_since: number | null;
  repository: string | null;
  branch: string | null;
  worktree: string | null;
  provider: string | null;
  host_locator: string;
}

interface HostRow {
  host_kind: string;
  status: string;
  last_observed_at: number | null;
  last_error: string | null;
  diagnostic_count: number;
}

const asPriority = (value: string): Goal["priority"] =>
  value === "P0" || value === "P1" || value === "P2" || value === "P3" ? value : "P2";
const asGoalStatus = (value: string): Goal["status"] =>
  value === "active" || value === "completed" || value === "archived" ? value : "active";
const asRuntimeState = (value: string): TrackedSession["runtimeState"] =>
  value === "idle" ||
  value === "working" ||
  value === "waiting" ||
  value === "blocked" ||
  value === "done" ||
  value === "unknown"
    ? value
    : "unknown";
const asHealth = (value: string): TrackedSession["hostHealth"] =>
  value === "live" || value === "stale" || value === "unavailable" ? value : "stale";
const asSource = (value: string): TrackedSession["displayNameSource"] =>
  value === "human" ? "human" : "host";

export class SqliteUniverseStore implements UniverseStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  load(): UniverseState {
    const goals = this.db
      .query<GoalRow, []>("SELECT * FROM goals ORDER BY created_at, id")
      .all()
      .map((row) => {
        const goal = {
          id: row.id,
          title: row.title,
          priority: asPriority(row.priority),
          status: asGoalStatus(row.status),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        if (row.description) Object.assign(goal, { description: row.description });
        if (row.completed_at !== null) Object.assign(goal, { completedAt: row.completed_at });
        if (row.archived_at !== null) Object.assign(goal, { archivedAt: row.archived_at });
        if (row.map_x !== null && row.map_y !== null)
          Object.assign(goal, {
            mapPosition: { x: row.map_x, y: row.map_y },
            mapPositionPinned: row.map_pinned !== 0,
          });
        return goal;
      });
    const sessions = this.db
      .query<SessionRow, []>("SELECT * FROM sessions ORDER BY display_name, id")
      .all()
      .map((row) => {
        const session = {
          id: row.id,
          hostKind: row.host_kind,
          nativeId: row.native_id,
          displayName: row.display_name,
          displayNameSource: asSource(row.display_name_source),
          runtimeState: asRuntimeState(row.runtime_state),
          runtimeStateSource: row.runtime_state_source,
          hostHealth: asHealth(row.host_health),
          lastSeenAt: row.last_seen_at,
          lastObservedAt: row.last_observed_at,
          lastChangedAt: row.last_changed_at,
          hostLocator: row.host_locator,
        };
        if (row.description) Object.assign(session, { description: row.description });
        if (row.primary_goal_id) Object.assign(session, { primaryGoalId: row.primary_goal_id });
        if (row.attention_since !== null)
          Object.assign(session, { attentionSince: row.attention_since });
        if (row.repository) Object.assign(session, { repository: row.repository });
        if (row.branch) Object.assign(session, { branch: row.branch });
        if (row.worktree) Object.assign(session, { worktree: row.worktree });
        if (row.provider) Object.assign(session, { provider: row.provider });
        return session;
      });
    const hosts = this.db
      .query<HostRow, []>("SELECT * FROM hosts ORDER BY host_kind")
      .all()
      .map((row) => {
        const status: HostHealth["status"] =
          row.status === "live" || row.status === "unavailable" ? row.status : "stale";
        const host = {
          hostKind: row.host_kind,
          status,
          diagnosticCount: row.diagnostic_count,
        };
        if (row.last_observed_at !== null)
          Object.assign(host, { lastObservedAt: row.last_observed_at });
        if (row.last_error) Object.assign(host, { lastError: row.last_error });
        return host;
      });
    return { version: 1, goals, sessions, hosts };
  }

  save(state: UniverseState): void {
    const write = this.db.transaction(() => {
      this.db.exec("DELETE FROM sessions; DELETE FROM goals; DELETE FROM hosts;");
      const goal = this.db.prepare(
        "INSERT INTO goals (id, title, description, priority, status, created_at, updated_at, completed_at, archived_at, map_x, map_y, map_pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of state.goals) {
        goal.run(
          row.id,
          row.title,
          row.description ?? null,
          row.priority,
          row.status,
          row.createdAt,
          row.updatedAt,
          row.completedAt ?? null,
          row.archivedAt ?? null,
          row.mapPosition?.x ?? null,
          row.mapPosition?.y ?? null,
          row.mapPositionPinned ? 1 : 0,
        );
      }
      const session = this.db.prepare(
        "INSERT INTO sessions (id, host_kind, native_id, display_name, display_name_source, description, primary_goal_id, runtime_state, runtime_state_source, host_health, last_seen_at, last_observed_at, last_changed_at, attention_since, repository, branch, worktree, provider, host_locator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of state.sessions) {
        session.run(
          row.id,
          row.hostKind,
          row.nativeId,
          row.displayName,
          row.displayNameSource,
          row.description ?? null,
          row.primaryGoalId ?? null,
          row.runtimeState,
          row.runtimeStateSource,
          row.hostHealth,
          row.lastSeenAt,
          row.lastObservedAt,
          row.lastChangedAt,
          row.attentionSince ?? null,
          row.repository ?? null,
          row.branch ?? null,
          row.worktree ?? null,
          row.provider ?? null,
          row.hostLocator,
        );
      }
      const host = this.db.prepare(
        "INSERT INTO hosts (host_kind, status, last_observed_at, last_error, diagnostic_count) VALUES (?, ?, ?, ?, ?)",
      );
      for (const row of state.hosts)
        host.run(
          row.hostKind,
          row.status,
          row.lastObservedAt ?? null,
          row.lastError ?? null,
          row.diagnosticCount,
        );
    });
    write();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );
    const applied = new Set(
      this.db
        .query<{ version: number }, []>("SELECT version FROM schema_migrations")
        .all()
        .map((row) => row.version),
    );
    if (!applied.has(1)) {
      const migration = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE goals (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER,
            archived_at INTEGER
          );
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            host_kind TEXT NOT NULL,
            native_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            description TEXT,
            primary_goal_id TEXT,
            runtime_state TEXT NOT NULL,
            runtime_state_source TEXT NOT NULL,
            host_health TEXT NOT NULL,
            last_seen_at INTEGER NOT NULL,
            last_observed_at INTEGER NOT NULL,
            attention_since INTEGER,
            repository TEXT,
            branch TEXT,
            worktree TEXT,
            provider TEXT,
            host_locator TEXT NOT NULL,
            UNIQUE(host_kind, native_id),
            FOREIGN KEY(primary_goal_id) REFERENCES goals(id)
          );
          CREATE TABLE hosts (
            host_kind TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            last_observed_at INTEGER,
            last_error TEXT,
            diagnostic_count INTEGER NOT NULL DEFAULT 0
          );
          INSERT INTO schema_migrations (version, applied_at) VALUES (1, unixepoch() * 1000);
        `);
      });
      migration();
    }
    const afterOne = new Set(
      this.db
        .query<{ version: number }, []>("SELECT version FROM schema_migrations")
        .all()
        .map((row) => row.version),
    );
    if (!afterOne.has(2)) {
      const migration = this.db.transaction(() => {
        this.db.exec(
          "ALTER TABLE sessions ADD COLUMN display_name_source TEXT NOT NULL DEFAULT 'host'; ALTER TABLE sessions ADD COLUMN last_changed_at INTEGER NOT NULL DEFAULT 0;",
        );
        this.db.exec(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (2, unixepoch() * 1000)",
        );
      });
      migration();
    }
    const afterTwo = new Set(
      this.db
        .query<{ version: number }, []>("SELECT version FROM schema_migrations")
        .all()
        .map((row) => row.version),
    );
    if (!afterTwo.has(3)) {
      const migration = this.db.transaction(() => {
        this.db.exec(
          "ALTER TABLE goals ADD COLUMN map_x REAL; ALTER TABLE goals ADD COLUMN map_y REAL; ALTER TABLE goals ADD COLUMN map_pinned INTEGER NOT NULL DEFAULT 0;",
        );
        this.db.exec(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (3, unixepoch() * 1000)",
        );
      });
      migration();
    }
  }
}

export const createMemoryStore = (): SqliteUniverseStore => new SqliteUniverseStore(":memory:");
