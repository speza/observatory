import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  type Goal,
  type HostHealth,
  type Agent,
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

interface AgentRow {
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
  execution_container_id: string | null;
  execution_container_label: string | null;
  host_locator: string;
  archived_at: number | null;
}

interface RelatedAgentDismissalRow {
  goal_id: string;
  agent_id: string;
  dismissed_at: number;
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
const asRuntimeState = (value: string): Agent["runtimeState"] =>
  value === "idle" ||
  value === "working" ||
  value === "waiting" ||
  value === "blocked" ||
  value === "done" ||
  value === "unknown"
    ? value
    : "unknown";
const asHealth = (value: string): Agent["hostHealth"] =>
  value === "live" || value === "stale" || value === "unavailable" ? value : "stale";
const asSource = (value: string): Agent["displayNameSource"] =>
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
    const agents = this.db
      .query<AgentRow, []>("SELECT * FROM agents ORDER BY display_name, id")
      .all()
      .map((row) => {
        const agent = {
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
        if (row.description) Object.assign(agent, { description: row.description });
        if (row.primary_goal_id) Object.assign(agent, { primaryGoalId: row.primary_goal_id });
        if (row.attention_since !== null)
          Object.assign(agent, { attentionSince: row.attention_since });
        if (row.repository) Object.assign(agent, { repository: row.repository });
        if (row.branch) Object.assign(agent, { branch: row.branch });
        if (row.worktree) Object.assign(agent, { worktree: row.worktree });
        if (row.provider) Object.assign(agent, { provider: row.provider });
        if (row.execution_container_id)
          Object.assign(agent, {
            executionContainer: row.execution_container_label
              ? { id: row.execution_container_id, label: row.execution_container_label }
              : { id: row.execution_container_id },
          });
        if (row.archived_at !== null) Object.assign(agent, { archivedAt: row.archived_at });
        return agent;
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
    const relatedAgentDismissals = this.db
      .query<RelatedAgentDismissalRow, []>(
        "SELECT goal_id, agent_id, dismissed_at FROM related_agent_dismissals ORDER BY goal_id, agent_id",
      )
      .all()
      .map((row) => ({
        goalId: row.goal_id,
        agentId: row.agent_id,
        dismissedAt: row.dismissed_at,
      }));
    return { version: 1, goals, agents, hosts, relatedAgentDismissals };
  }

  save(state: UniverseState): void {
    const write = this.db.transaction(() => {
      this.db.exec(
        "DELETE FROM related_agent_dismissals; DELETE FROM agents; DELETE FROM goals; DELETE FROM hosts;",
      );
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
      const agent = this.db.prepare(
        "INSERT INTO agents (id, host_kind, native_id, display_name, display_name_source, description, primary_goal_id, runtime_state, runtime_state_source, host_health, last_seen_at, last_observed_at, last_changed_at, attention_since, repository, branch, worktree, provider, execution_container_id, execution_container_label, host_locator, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of state.agents) {
        agent.run(
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
          row.executionContainer?.id ?? null,
          row.executionContainer?.label ?? null,
          row.hostLocator,
          row.archivedAt ?? null,
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
      const dismissal = this.db.prepare(
        "INSERT INTO related_agent_dismissals (goal_id, agent_id, dismissed_at) VALUES (?, ?, ?)",
      );
      for (const row of state.relatedAgentDismissals ?? [])
        dismissal.run(row.goalId, row.agentId, row.dismissedAt);
    });
    write();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        archived_at INTEGER,
        map_x REAL,
        map_y REAL,
        map_pinned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        host_kind TEXT NOT NULL,
        native_id TEXT NOT NULL,
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
        host_locator TEXT NOT NULL,
        archived_at INTEGER,
        UNIQUE(host_kind, native_id),
        FOREIGN KEY(primary_goal_id) REFERENCES goals(id)
      );
      CREATE TABLE IF NOT EXISTS hosts (
        host_kind TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        last_observed_at INTEGER,
        last_error TEXT,
        diagnostic_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS related_agent_dismissals (
        goal_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        dismissed_at INTEGER NOT NULL,
        PRIMARY KEY(goal_id, agent_id),
        FOREIGN KEY(goal_id) REFERENCES goals(id),
        FOREIGN KEY(agent_id) REFERENCES agents(id)
      );
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
        VALUES (1, unixepoch() * 1000);
    `);
  }
}

export const createMemoryStore = (): SqliteUniverseStore => new SqliteUniverseStore(":memory:");
