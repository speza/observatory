import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { Schema } from "effect";
import {
  type Goal,
  type HostHealth,
  type Agent,
  type System,
  type UniverseState,
  type UniverseStore,
  type UniverseChange,
} from "../../universe/types.ts";
import type {
  LaunchReceipt,
  LaunchRecovery,
  LaunchReceiptStore,
  StartAgentResult,
} from "../../session-launch/types.ts";
import type {
  ConversationCatalogueIngestion,
  ConversationCatalogueStore,
  StoredConversation,
} from "../../conversations/types.ts";
import type {
  AgentObservation,
  AgentObservationCapability,
  AgentObservationSnapshot,
  ProviderSessionSnapshot,
} from "../../plugin-sdk/index.ts";
import type {
  AgentEvidenceTransition,
  AgentObservationReconciliation,
  AgentObservationStore,
  StoredAgentObservation,
  StoredObservationSource,
} from "../../agent-observations/types.ts";

interface GoalRow {
  id: string;
  system_id: string | null;
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

interface SystemRow {
  id: string;
  title: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

interface AgentRow {
  id: string;
  host_kind: string | null;
  native_id: string | null;
  host_locator: string | null;
  host_instance_id: string | null;
  execution_observed_at: number | null;
  harness_id: string | null;
  continuity_scope_id: string | null;
  native_conversation_kind: string | null;
  native_conversation_value: string | null;
  continuity: string;
  provider_continuity: string | null;
  execution_presence: string | null;
  resume_capability: string | null;
  observation_health: string | null;
  provider_observed_at: number | null;
  execution_history_json: string | null;
  conflicting_executions_json: string | null;
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
  archived_at: number | null;
}

interface RelatedAgentDismissalRow {
  goal_id: string;
  agent_id: string;
  dismissed_at: number;
}

interface HostRow {
  host_kind: string;
  host_instance_id: string | null;
  status: string;
  last_observed_at: number | null;
  last_error: string | null;
  diagnostic_count: number;
}

interface UniverseChangeRow {
  sequence: number;
  occurred_at: number;
  outcome: string;
  target_type: string;
  target_id: string;
  goal_id: string | null;
  summary: string;
}

interface OperatorCheckpointRow {
  last_sequence: number;
  acknowledged_at: number;
}

interface LaunchReceiptRow {
  request_id: string;
  intent_fingerprint: string;
  result_json: string;
  recovery_json: string | null;
}

interface ProviderConversationRow {
  handle: string;
  harness_id: string;
  continuity_scope_id: string;
  native_kind: string;
  native_value: string;
  provider_instance_id: string;
  home_site_ref: string | null;
  created_at: number | null;
  last_active_at: number | null;
  title: string | null;
  workspace_ref: string | null;
  resume_eligibility: string;
  provenance: string;
  observed_at: number;
}

interface ProviderConversationAliasRow {
  handle: string;
  harness_id: string;
  continuity_scope_id: string;
  native_kind: string;
  native_value: string;
}

interface ObservationSourceRow {
  plugin_id: string;
  harness_id: string;
  provider_instance_id: string;
  continuity_scope_id: string;
  capability_json: string;
  health_json: string;
  cursor: string | null;
  captured_at: number;
}

interface ObservationRow {
  harness_id: string;
  observation_id: string;
  revision: number;
  observation_json: string;
  received_at: number;
}

interface ObservationTransitionRow extends ObservationRow {
  sequence: number;
}

export const SQLITE_SCHEMA_GENERATION = 3;
const MAX_CURRENT_OBSERVATIONS_PER_SOURCE = 500;

export interface DatabaseResetSummary {
  readonly removedGoals: number;
  readonly removedAgents: number;
  readonly preservedAgents: number;
  readonly clearedLaunchReceipts: number;
}

interface DatabaseResetCounts {
  readonly goals: number;
  readonly agents: number;
  readonly launchReceipts: number;
}

const PreparedWorkspaceSchema = Schema.Struct({
  path: Schema.String,
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  worktree: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
});
const StartAgentResultSchema: Schema.Schema<StartAgentResult> = Schema.Struct({
  status: Schema.Literal("started", "already-observed", "pending", "failed"),
  message: Schema.String,
  requestId: Schema.String,
  goalId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  workspace: Schema.optional(PreparedWorkspaceSchema),
  warnings: Schema.optional(Schema.Array(Schema.String)),
});
const NativeConversationRefSchema = Schema.Struct({
  harnessId: Schema.String,
  continuityScopeId: Schema.optional(Schema.String),
  kind: Schema.String,
  value: Schema.String,
});
const AgentExecutionBindingSchema = Schema.Struct({
  hostKind: Schema.String,
  hostInstanceId: Schema.String,
  nativeId: Schema.String,
  hostLocator: Schema.String,
  observedAt: Schema.Number,
});
const LaunchRecoverySchema: Schema.Schema<LaunchRecovery> = Schema.Struct({
  kind: Schema.Literal("start", "resume"),
  harnessId: Schema.String,
  executionRef: Schema.String,
  displayName: Schema.optional(Schema.String),
  nativeConversationRef: Schema.optional(NativeConversationRefSchema),
  goalId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
});

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
  value === "human" ? "human" : value === "provider" ? "provider" : "fallback";
const asContinuity = (value: string): Agent["continuity"] =>
  value === "proved" || value === "interrupted" || value === "replaced" ? value : "unknown";
const asProviderContinuity = (value: string | null): Agent["providerContinuity"] =>
  value === "confirmed" || value === "missing" ? value : "unknown";
const asExecutionPresence = (value: string | null): Agent["executionPresence"] =>
  value === "live" || value === "absent" || value === "conflict" ? value : "unknown";
const asResumeCapability = (value: string | null): Agent["resumeCapability"] =>
  value === "eligible" || value === "blocked" || value === "unsupported" ? value : "unknown";
const asObservationHealth = (value: string | null): Agent["observationHealth"] =>
  value === "fresh" || value === "unavailable" ? value : "stale";
const executionBindings = (value: string | null): Agent["executionHistory"] => {
  if (!value) return [];
  try {
    return Schema.decodeUnknownSync(Schema.Array(AgentExecutionBindingSchema))(JSON.parse(value));
  } catch {
    return [];
  }
};
const asChangeOutcome = (value: string): UniverseChange["outcome"] =>
  value === "new" ||
  value === "changed" ||
  value === "attention" ||
  value === "finished" ||
  value === "stale"
    ? value
    : "changed";
const asChangeTarget = (value: string): UniverseChange["targetType"] =>
  value === "system" || value === "goal" ? value : "agent";

const conversationHandle = (
  harnessId: string,
  continuityScopeId: string,
  kind: string,
  value: string,
): string =>
  `ps_${createHash("sha256")
    .update(`${harnessId}\u0000${continuityScopeId}\u0000${kind}\u0000${value}`)
    .digest("hex")
    .slice(0, 24)}`;

const observationEventValue = (observation: StoredAgentObservation): string => {
  const { receivedAt: _receivedAt, ...value } = observation;
  return JSON.stringify(value);
};

const observationSourceEventValue = (source: StoredObservationSource | undefined): string => {
  if (!source) return "missing";
  return JSON.stringify({
    pluginId: source.pluginId,
    providerInstanceId: source.providerInstanceId,
    continuityScopeId: source.continuityScopeId,
    capability: source.capability,
    health: { state: source.health.state, diagnostics: source.health.diagnostics },
  });
};

const observationStorageKey = (observation: AgentObservation): string =>
  createHash("sha256")
    .update(
      `${observation.providerInstanceId}\u0000${observation.nativeConversationRef.harnessId}\u0000${observation.nativeConversationRef.continuityScopeId ?? "legacy"}\u0000${observation.nativeConversationRef.kind}\u0000${observation.nativeConversationRef.value}\u0000${observation.observationId}`,
    )
    .digest("hex");

const resumeEligibility = (value: string): StoredConversation["resumeEligibility"] =>
  value === "same-site" || value === "provider-account" || value === "blocked" ? value : "unknown";

const conversationProvenance = (value: string): StoredConversation["provenance"] =>
  value === "provider-index" ? "provider-index" : "session-header";

export class SqliteUniverseStore
  implements UniverseStore, LaunchReceiptStore, ConversationCatalogueStore, AgentObservationStore
{
  readonly db: Database;
  private savedRows = new Map<string, Map<string | number, (string | number | null)[]>>();
  private savedRevision = "";

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initializeSchema();
  }

  load(): UniverseState {
    const systems = this.db
      .query<SystemRow, []>("SELECT * FROM systems ORDER BY created_at, id")
      .all()
      .map((row): System => ({
        id: row.id,
        title: row.title,
        description: row.description ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    const goals = this.db
      .query<GoalRow, []>("SELECT * FROM goals ORDER BY created_at, id")
      .all()
      .map((row) => {
        const goal = {
          id: row.id,
          systemId: row.system_id ?? undefined,
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
          displayName: row.display_name,
          displayNameSource: asSource(row.display_name_source),
          runtimeState: asRuntimeState(row.runtime_state),
          runtimeStateSource: row.runtime_state_source,
          hostHealth: asHealth(row.host_health),
          lastSeenAt: row.last_seen_at,
          lastObservedAt: row.last_observed_at,
          lastChangedAt: row.last_changed_at,
          continuity: asContinuity(row.continuity),
          providerContinuity: asProviderContinuity(row.provider_continuity),
          executionPresence: asExecutionPresence(row.execution_presence),
          resumeCapability: asResumeCapability(row.resume_capability),
          observationHealth: asObservationHealth(row.observation_health),
          providerObservedAt: row.provider_observed_at ?? undefined,
          executionObservedAt: row.execution_observed_at ?? undefined,
          executionHistory: executionBindings(row.execution_history_json),
          conflictingExecutions: executionBindings(row.conflicting_executions_json),
        };
        if (row.host_kind && row.native_id && row.host_locator)
          Object.assign(agent, {
            execution: {
              hostKind: row.host_kind,
              hostInstanceId: row.host_instance_id ?? `${row.host_kind}:legacy`,
              nativeId: row.native_id,
              hostLocator: row.host_locator,
              observedAt: row.execution_observed_at ?? row.last_observed_at,
            },
          });
        if (row.harness_id) Object.assign(agent, { harnessId: row.harness_id });
        if (row.harness_id && row.native_conversation_kind && row.native_conversation_value)
          Object.assign(agent, {
            nativeConversationRef: {
              harnessId: row.harness_id,
              continuityScopeId: row.continuity_scope_id ?? undefined,
              kind: row.native_conversation_kind,
              value: row.native_conversation_value,
            },
          });
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
          hostInstanceId: row.host_instance_id ?? `${row.host_kind}:legacy`,
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
    const changes = this.db
      .query<UniverseChangeRow, []>("SELECT * FROM universe_changes ORDER BY sequence")
      .all()
      .map((row) => {
        const item: UniverseChange = {
          sequence: row.sequence,
          occurredAt: row.occurred_at,
          outcome: asChangeOutcome(row.outcome),
          targetType: asChangeTarget(row.target_type),
          targetId: row.target_id,
          summary: row.summary,
        };
        if (row.goal_id) Object.assign(item, { goalId: row.goal_id });
        return item;
      });
    const checkpoint = this.db
      .query<OperatorCheckpointRow, []>(
        "SELECT last_sequence, acknowledged_at FROM operator_checkpoint WHERE singleton = 1",
      )
      .get();
    return {
      version: 1,
      systems,
      goals,
      agents,
      hosts,
      relatedAgentDismissals,
      changes,
      operatorCheckpoint: checkpoint
        ? { lastSequence: checkpoint.last_sequence, acknowledgedAt: checkpoint.acknowledged_at }
        : undefined,
    };
  }

  save(state: UniverseState): void {
    const write = this.db.transaction(() => {
      if (this.storageRevision() !== this.savedRevision) this.savedRows.clear();
      // Rows may move between parents, and execution identities may swap. Check
      // references against the complete snapshot at commit, not an intermediate row.
      this.db.exec("PRAGMA defer_foreign_keys = ON");
      const system = this.prepareSnapshotTable(
        "systems",
        "id, title, description, created_at, updated_at",
        ["id"],
      );
      for (const row of state.systems)
        system.run(row.id, row.title, row.description ?? null, row.createdAt, row.updatedAt);
      const goal = this.prepareSnapshotTable(
        "goals",
        "id, system_id, title, description, priority, status, created_at, updated_at, completed_at, archived_at, map_x, map_y, map_pinned",
        ["id"],
      );
      for (const row of state.goals) {
        goal.run(
          row.id,
          row.systemId ?? null,
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
      const agent = this.prepareSnapshotTable(
        "agents",
        "id, host_kind, host_instance_id, native_id, host_locator, execution_observed_at, harness_id, continuity_scope_id, native_conversation_kind, native_conversation_value, continuity, provider_continuity, execution_presence, resume_capability, observation_health, provider_observed_at, execution_history_json, conflicting_executions_json, display_name, display_name_source, description, primary_goal_id, runtime_state, runtime_state_source, host_health, last_seen_at, last_observed_at, last_changed_at, attention_since, repository, branch, worktree, provider, execution_container_id, execution_container_label, archived_at",
        ["id"],
      );
      for (const row of state.agents) {
        agent.run(
          row.id,
          row.execution?.hostKind ?? null,
          row.execution?.hostInstanceId ?? null,
          row.execution?.nativeId ?? null,
          row.execution?.hostLocator ?? null,
          row.execution?.observedAt ?? row.executionObservedAt ?? null,
          row.harnessId ?? null,
          row.nativeConversationRef?.continuityScopeId ?? null,
          row.nativeConversationRef?.kind ?? null,
          row.nativeConversationRef?.value ?? null,
          row.continuity,
          row.providerContinuity,
          row.executionPresence,
          row.resumeCapability,
          row.observationHealth,
          row.providerObservedAt ?? null,
          JSON.stringify(row.executionHistory),
          JSON.stringify(row.conflictingExecutions),
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
          row.archivedAt ?? null,
        );
      }
      const host = this.prepareSnapshotTable(
        "hosts",
        "host_kind, host_instance_id, status, last_observed_at, last_error, diagnostic_count",
        ["host_instance_id"],
      );
      for (const row of state.hosts)
        host.run(
          row.hostKind,
          row.hostInstanceId,
          row.status,
          row.lastObservedAt ?? null,
          row.lastError ?? null,
          row.diagnosticCount,
        );
      const dismissal = this.prepareSnapshotTable(
        "related_agent_dismissals",
        "goal_id, agent_id, dismissed_at",
        ["goal_id", "agent_id"],
      );
      for (const row of state.relatedAgentDismissals ?? [])
        dismissal.run(row.goalId, row.agentId, row.dismissedAt);
      const change = this.prepareSnapshotTable(
        "universe_changes",
        "sequence, occurred_at, outcome, target_type, target_id, goal_id, summary",
        ["sequence"],
      );
      for (const row of state.changes)
        change.run(
          row.sequence,
          row.occurredAt,
          row.outcome,
          row.targetType,
          row.targetId,
          row.goalId ?? null,
          row.summary,
        );
      const checkpoint = this.prepareSnapshotTable(
        "operator_checkpoint",
        "singleton, last_sequence, acknowledged_at",
        ["singleton"],
      );
      if (state.operatorCheckpoint)
        checkpoint.run(
          1,
          state.operatorCheckpoint.lastSequence,
          state.operatorCheckpoint.acknowledgedAt,
        );
      const tables = [system, goal, agent, host, dismissal, change, checkpoint];
      for (const table of tables) table.finish();
      if (this.db.query("PRAGMA foreign_key_check").get())
        throw new Error("FOREIGN KEY constraint failed");
      return {
        rows: new Map(tables.map((table) => [table.name, table.rows])),
        revision: this.storageRevision(),
      };
    });
    const saved = write.immediate();
    // A caller-owned outer transaction can still roll back after this save.
    // Never cache its uncommitted result. Failed writes never publish bookkeeping.
    if (!this.db.inTransaction) {
      this.savedRows = saved.rows;
      this.savedRevision = saved.revision;
    } else {
      this.savedRows.clear();
      this.savedRevision = "";
    }
  }

  private storageRevision(): string {
    const changes = this.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
    const version = this.db
      .query<{ data_version: number }, []>("PRAGMA data_version")
      .get()!.data_version;
    return `${changes}:${version}`;
  }

  private prepareSnapshotTable(table: string, columnList: string, keys: readonly string[]) {
    // Only static identifiers from save() enter SQL. Compare storage bindings,
    // not load()'s normalized domain objects. Cache values never alias caller state.
    const columns = columnList.split(", ");
    const keyIndexes = keys.map((key) => columns.indexOf(key));
    type Value = string | number | null;
    const keyOf = (row: readonly Value[]) =>
      keys.length === 1
        ? (row[keyIndexes[0]!] ?? "null")
        : JSON.stringify(keyIndexes.map((index) => row[index]));
    const previous =
      this.savedRows.get(table) ??
      new Map(
        this.db
          .query<Record<string, Value>, []>(`SELECT ${columnList} FROM ${table}`)
          .all()
          .map((record) => {
            const row = columns.map((column) => record[column]!);
            return [keyOf(row), row];
          }),
      );
    const insert = this.db.prepare(
      `INSERT INTO ${table} (${columnList}) VALUES (${columns.map(() => "?").join(", ")})`,
    );
    const remove = this.db.prepare(
      `DELETE FROM ${table} WHERE ${keys.map((key) => `${key} IS ?`).join(" AND ")}`,
    );
    const pending: Value[][] = [];
    const rows = new Map<string | number, Value[]>();
    return {
      name: table,
      rows,
      run: (...row: Value[]) => {
        const key = keyOf(row);
        if (rows.has(key)) throw new Error(`Duplicate snapshot key in ${table}`);
        rows.set(key, row);
        const stored = previous.get(key);
        if (stored && row.every((value, index) => value === stored[index])) return;
        if (stored) remove.run(...keyIndexes.map((index) => stored[index]!));
        pending.push(row);
      },
      finish: () => {
        for (const [key, row] of previous)
          if (!rows.has(key)) remove.run(...keyIndexes.map((index) => row[index]!));
        // Delete all changed/removed identities before inserting, so swaps obey
        // the live execution unique index without rewriting unchanged Agents.
        for (const row of pending) insert.run(...row);
      },
    };
  }

  close(): void {
    this.db.close();
  }

  reconcileProviderCatalogue(snapshot: ProviderSessionSnapshot): ConversationCatalogueIngestion {
    const write = this.db.transaction((): ConversationCatalogueIngestion => {
      const freshness = this.db
        .query<{ harness_id: string; continuity_scope_id: string; observed_at: number }, [string]>(
          "SELECT harness_id, continuity_scope_id, observed_at FROM provider_catalogue_freshness WHERE provider_instance_id = ?",
        )
        .get(snapshot.providerInstanceId);
      if (
        freshness &&
        (freshness.harness_id !== snapshot.harnessId ||
          freshness.continuity_scope_id !== snapshot.continuityScopeId)
      )
        throw new Error("Provider instance identity changed its declared catalogue scope.");
      if (freshness && snapshot.observedAt < freshness.observed_at)
        return {
          accepted: false,
          diagnostic: `Ignored out-of-order ${snapshot.harnessId} catalogue at ${snapshot.observedAt}; latest accepted observation is ${freshness.observed_at}.`,
        };
      if (snapshot.complete)
        this.db
          .prepare("DELETE FROM provider_conversations WHERE provider_instance_id = ?")
          .run(snapshot.providerInstanceId);
      const upsert = this.db.prepare(`
        INSERT INTO provider_conversations (
          handle, harness_id, continuity_scope_id, native_kind, native_value,
          provider_instance_id, home_site_ref, created_at, last_active_at, title,
          workspace_ref, resume_eligibility, provenance, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(handle) DO UPDATE SET
          provider_instance_id = excluded.provider_instance_id,
          home_site_ref = excluded.home_site_ref,
          created_at = COALESCE(excluded.created_at, provider_conversations.created_at),
          last_active_at = COALESCE(excluded.last_active_at, provider_conversations.last_active_at),
          title = COALESCE(excluded.title, provider_conversations.title),
          workspace_ref = COALESCE(excluded.workspace_ref, provider_conversations.workspace_ref),
          resume_eligibility = excluded.resume_eligibility,
          provenance = excluded.provenance,
          observed_at = excluded.observed_at
      `);
      const deleteAliases = this.db.prepare(
        "DELETE FROM provider_conversation_aliases WHERE handle = ?",
      );
      const insertAlias = this.db.prepare(
        "INSERT OR IGNORE INTO provider_conversation_aliases (handle, harness_id, continuity_scope_id, native_kind, native_value) VALUES (?, ?, ?, ?, ?)",
      );
      for (const session of snapshot.sessions) {
        const reference = session.nativeConversationRef;
        if (
          reference.harnessId !== snapshot.harnessId ||
          reference.continuityScopeId !== snapshot.continuityScopeId ||
          session.providerInstanceId !== snapshot.providerInstanceId
        )
          throw new Error("Provider session escaped its declared snapshot scope.");
        const handle = conversationHandle(
          reference.harnessId,
          snapshot.continuityScopeId,
          reference.kind,
          reference.value,
        );
        upsert.run(
          handle,
          reference.harnessId,
          snapshot.continuityScopeId,
          reference.kind,
          reference.value,
          session.providerInstanceId,
          session.homeSiteRef ?? null,
          session.createdAt ?? null,
          session.lastActiveAt ?? null,
          session.title?.slice(0, 160) ?? null,
          session.workspaceRef ?? null,
          session.resumeEligibility,
          session.provenance,
          snapshot.observedAt,
        );
        deleteAliases.run(handle);
        for (const alias of session.nativeConversationAliases ?? []) {
          if (
            alias.harnessId !== snapshot.harnessId ||
            alias.continuityScopeId !== snapshot.continuityScopeId
          )
            throw new Error("Provider session alias escaped its declared snapshot scope.");
          insertAlias.run(
            handle,
            alias.harnessId,
            snapshot.continuityScopeId,
            alias.kind,
            alias.value,
          );
        }
      }
      this.db
        .prepare(`
          INSERT INTO provider_catalogue_freshness (
            provider_instance_id, harness_id, continuity_scope_id, observed_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(provider_instance_id) DO UPDATE SET observed_at = excluded.observed_at
        `)
        .run(
          snapshot.providerInstanceId,
          snapshot.harnessId,
          snapshot.continuityScopeId,
          snapshot.observedAt,
        );
      return { accepted: true };
    });
    return write();
  }

  conversations(): readonly StoredConversation[] {
    return this.db
      .query<ProviderConversationRow, []>(
        "SELECT * FROM provider_conversations ORDER BY COALESCE(last_active_at, created_at, observed_at) DESC, handle",
      )
      .all()
      .map((row) => this.conversationFromRow(row));
  }

  conversation(handle: string): StoredConversation | undefined {
    const row = this.db
      .query<ProviderConversationRow, [string]>(
        "SELECT * FROM provider_conversations WHERE handle = ?",
      )
      .get(handle);
    return row ? this.conversationFromRow(row) : undefined;
  }

  observationSource(harnessId: string): StoredObservationSource | undefined {
    const row = this.db
      .query<ObservationSourceRow, [string]>(
        "SELECT * FROM agent_observation_sources WHERE harness_id = ?",
      )
      .get(harnessId);
    return row ? this.observationSourceFromRow(row) : undefined;
  }

  agentObservationSources(): readonly StoredObservationSource[] {
    return this.db
      .query<ObservationSourceRow, []>(
        "SELECT * FROM agent_observation_sources ORDER BY harness_id",
      )
      .all()
      .map((row) => this.observationSourceFromRow(row));
  }

  reconcileAgentObservations(
    snapshot: AgentObservationSnapshot,
    capability: AgentObservationCapability,
    receivedAt: number,
    pluginId: string,
  ): AgentObservationReconciliation {
    return this.db.transaction(() => {
      const previous = this.observationSource(snapshot.harnessId);
      const previousCurrent = this.currentAgentObservations().filter(
        (observation) => observation.nativeConversationRef.harnessId === snapshot.harnessId,
      );
      if (
        previous?.providerInstanceId === snapshot.providerInstanceId &&
        previous.continuityScopeId === snapshot.continuityScopeId &&
        snapshot.capturedAt < previous.capturedAt
      )
        return { accepted: false, sourceChanged: false, changedObservations: [] };
      this.db
        .prepare(`
          INSERT INTO agent_observation_sources (
            harness_id, plugin_id, provider_instance_id, continuity_scope_id, capability_json,
            health_json, cursor, captured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(harness_id) DO UPDATE SET
            plugin_id = excluded.plugin_id,
            provider_instance_id = excluded.provider_instance_id,
            continuity_scope_id = excluded.continuity_scope_id,
            capability_json = excluded.capability_json,
            health_json = excluded.health_json,
            cursor = COALESCE(excluded.cursor, agent_observation_sources.cursor),
            captured_at = excluded.captured_at
        `)
        .run(
          snapshot.harnessId,
          pluginId,
          snapshot.providerInstanceId,
          snapshot.continuityScopeId,
          JSON.stringify(capability),
          JSON.stringify(snapshot.health),
          snapshot.cursor ?? null,
          snapshot.capturedAt,
        );
      if (snapshot.complete)
        this.db
          .prepare("DELETE FROM agent_observation_current WHERE harness_id = ?")
          .run(snapshot.harnessId);
      const upsert = this.db.prepare(`
        INSERT INTO agent_observation_current (
          harness_id, observation_id, revision, observation_json, received_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(harness_id, observation_id) DO UPDATE SET
          revision = excluded.revision,
          observation_json = excluded.observation_json,
          received_at = excluded.received_at
        WHERE excluded.revision >= agent_observation_current.revision
      `);
      for (const observation of snapshot.current)
        upsert.run(
          snapshot.harnessId,
          observationStorageKey(observation),
          observation.revision ?? 0,
          JSON.stringify(observation),
          receivedAt,
        );
      this.db
        .prepare(`
          DELETE FROM agent_observation_current
          WHERE harness_id = ?
            AND observation_id NOT IN (
              SELECT observation_id
              FROM agent_observation_current
              WHERE harness_id = ?
              ORDER BY received_at DESC, observation_id DESC
              LIMIT ${MAX_CURRENT_OBSERVATIONS_PER_SOURCE}
            )
        `)
        .run(snapshot.harnessId, snapshot.harnessId);
      const transition = this.db.prepare(`
        INSERT OR IGNORE INTO agent_observation_transitions (
          harness_id, observation_id, revision, observation_json, received_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      const changed = new Map<string, AgentObservation>();
      for (const observation of snapshot.transitions) {
        const result = transition.run(
          snapshot.harnessId,
          observationStorageKey(observation),
          observation.revision ?? 0,
          JSON.stringify(observation),
          receivedAt,
        );
        if (result.changes > 0) changed.set(observationStorageKey(observation), observation);
      }
      this.db.exec(`
        DELETE FROM agent_observation_transitions
        WHERE sequence NOT IN (
          SELECT sequence FROM agent_observation_transitions ORDER BY sequence DESC LIMIT 5000
        );
      `);
      const nextCurrent = this.currentAgentObservations().filter(
        (observation) => observation.nativeConversationRef.harnessId === snapshot.harnessId,
      );
      const previousById = new Map(
        previousCurrent.map((observation) => [
          observationStorageKey(observation),
          observationEventValue(observation),
        ]),
      );
      const nextById = new Map(
        nextCurrent.map((observation) => [
          observationStorageKey(observation),
          observationEventValue(observation),
        ]),
      );
      for (const observation of [...previousCurrent, ...nextCurrent]) {
        const key = observationStorageKey(observation);
        if (previousById.get(key) !== nextById.get(key)) changed.set(key, observation);
      }
      return {
        accepted: true,
        sourceChanged:
          observationSourceEventValue(previous) !==
          observationSourceEventValue(this.observationSource(snapshot.harnessId)),
        changedObservations: [...changed.values()],
      };
    })();
  }

  markObservationSourceUnavailable(
    harnessId: string,
    capability: AgentObservationCapability,
    observedAt: number,
    diagnostic: string,
    pluginId: string,
  ): boolean {
    const existing = this.observationSource(harnessId);
    if (existing && observedAt < existing.capturedAt) return false;
    this.db
      .prepare(`
        INSERT INTO agent_observation_sources (
          harness_id, plugin_id, provider_instance_id, continuity_scope_id, capability_json,
          health_json, cursor, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(harness_id) DO UPDATE SET
          plugin_id = excluded.plugin_id,
          capability_json = excluded.capability_json,
          health_json = excluded.health_json,
          captured_at = excluded.captured_at
      `)
      .run(
        harnessId,
        pluginId,
        existing?.providerInstanceId ?? "unknown",
        existing?.continuityScopeId ?? "unknown",
        JSON.stringify(capability),
        JSON.stringify({ state: "unavailable", diagnostics: [diagnostic] }),
        existing?.cursor ?? null,
        observedAt,
      );
    return (
      observationSourceEventValue(existing) !==
      observationSourceEventValue(this.observationSource(harnessId))
    );
  }

  currentAgentObservations(): readonly StoredAgentObservation[] {
    return this.db
      .query<ObservationRow, []>(
        "SELECT * FROM agent_observation_current ORDER BY harness_id, observation_id",
      )
      .all()
      .map((row) => this.observationFromRow(row));
  }

  agentObservationTransitions(afterSequence: number): readonly AgentEvidenceTransition[] {
    return this.db
      .query<ObservationTransitionRow, [number]>(
        "SELECT * FROM agent_observation_transitions WHERE sequence > ? ORDER BY sequence",
      )
      .all(afterSequence)
      .map((row) => ({ sequence: row.sequence, observation: this.observationFromRow(row) }));
  }

  observationCheckpoint():
    | { readonly sequence: number; readonly acknowledgedAt: number }
    | undefined {
    const row = this.db
      .query<{ last_sequence: number; acknowledged_at: number }, []>(
        "SELECT last_sequence, acknowledged_at FROM agent_observation_checkpoint WHERE singleton = 1",
      )
      .get();
    return row ? { sequence: row.last_sequence, acknowledgedAt: row.acknowledged_at } : undefined;
  }

  acknowledgeAgentObservations(throughSequence: number, at: number): number {
    const latestTransition =
      this.db
        .query<{ sequence: number }, []>(
          "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_observation_transitions",
        )
        .get()?.sequence ?? 0;
    const previousSequence = this.observationCheckpoint()?.sequence ?? 0;
    if (
      !Number.isSafeInteger(throughSequence) ||
      throughSequence < 0 ||
      throughSequence > Math.max(previousSequence, latestTransition)
    )
      throw new Error("Invalid provider-evidence sequence boundary.");
    if (throughSequence <= previousSequence) return previousSequence;
    const sequence = throughSequence;
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO agent_observation_checkpoint (singleton, last_sequence, acknowledged_at)
          VALUES (1, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            last_sequence = excluded.last_sequence,
            acknowledged_at = excluded.acknowledged_at
        `)
        .run(sequence, at);
      this.db
        .prepare("DELETE FROM agent_observation_transitions WHERE sequence <= ?")
        .run(sequence);
    })();
    return sequence;
  }

  private observationSourceFromRow(row: ObservationSourceRow): StoredObservationSource {
    // SAFETY: These JSON values are written only by reconcileAgentObservations from the typed plugin contract.
    const capability = JSON.parse(row.capability_json) as AgentObservationCapability;
    // SAFETY: Source health is written only from a validated AgentObservationSnapshot.
    const health = JSON.parse(row.health_json) as StoredObservationSource["health"];
    return {
      pluginId: row.plugin_id,
      harnessId: row.harness_id,
      providerInstanceId: row.provider_instance_id,
      continuityScopeId: row.continuity_scope_id,
      capability,
      health,
      cursor: row.cursor ?? undefined,
      capturedAt: row.captured_at,
    };
  }

  private observationFromRow(row: ObservationRow): StoredAgentObservation {
    // SAFETY: Observation JSON is persisted only after coordinator validation of the V1 union.
    const observation = JSON.parse(row.observation_json) as AgentObservation;
    return {
      ...observation,
      receivedAt: row.received_at,
    };
  }

  private conversationFromRow(row: ProviderConversationRow): StoredConversation {
    const aliases = this.db
      .query<ProviderConversationAliasRow, [string]>(
        "SELECT * FROM provider_conversation_aliases WHERE handle = ? ORDER BY native_kind, native_value",
      )
      .all(row.handle)
      .map((alias) => ({
        harnessId: alias.harness_id,
        continuityScopeId: alias.continuity_scope_id,
        kind: alias.native_kind,
        value: alias.native_value,
      }));
    return {
      handle: row.handle,
      nativeConversationRef: {
        harnessId: row.harness_id,
        continuityScopeId: row.continuity_scope_id,
        kind: row.native_kind,
        value: row.native_value,
      },
      nativeConversationAliases: aliases,
      providerInstanceId: row.provider_instance_id,
      homeSiteRef: row.home_site_ref ?? undefined,
      createdAt: row.created_at ?? undefined,
      lastActiveAt: row.last_active_at ?? undefined,
      title: row.title ?? undefined,
      workspaceRef: row.workspace_ref ?? undefined,
      resumeEligibility: resumeEligibility(row.resume_eligibility),
      provenance: conversationProvenance(row.provenance),
      observedAt: row.observed_at,
    };
  }

  backupTo(path: string): void {
    this.db.prepare("VACUUM INTO ?").run(path);
  }

  resetSemanticState(): DatabaseResetSummary {
    const counts = this.resetCounts();
    this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM related_agent_dismissals;
        UPDATE agents
        SET primary_goal_id = NULL,
            archived_at = NULL,
            attention_since = NULL,
            runtime_state = 'unknown',
            runtime_state_source = 'observatory.semantic-reset',
            host_health = 'stale',
            continuity = CASE
              WHEN native_conversation_value IS NOT NULL THEN 'interrupted'
              ELSE 'unknown'
            END;
        DELETE FROM goals;
        DELETE FROM systems;
        DELETE FROM hosts;
        DELETE FROM universe_changes;
        DELETE FROM operator_checkpoint;
        DELETE FROM launch_receipts;
        DELETE FROM provider_conversations;
        DELETE FROM provider_catalogue_freshness;
        DELETE FROM agent_observation_sources;
        DELETE FROM agent_observation_current;
        DELETE FROM agent_observation_transitions;
        DELETE FROM agent_observation_checkpoint;
      `);
    })();
    return {
      removedGoals: counts.goals,
      removedAgents: 0,
      preservedAgents: counts.agents,
      clearedLaunchReceipts: counts.launchReceipts,
    };
  }

  resetAllState(): DatabaseResetSummary {
    const counts = this.resetCounts();
    this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM related_agent_dismissals;
        DELETE FROM agents;
        DELETE FROM goals;
        DELETE FROM systems;
        DELETE FROM hosts;
        DELETE FROM universe_changes;
        DELETE FROM operator_checkpoint;
        DELETE FROM launch_receipts;
        DELETE FROM provider_conversations;
        DELETE FROM provider_catalogue_freshness;
        DELETE FROM agent_observation_sources;
        DELETE FROM agent_observation_current;
        DELETE FROM agent_observation_transitions;
        DELETE FROM agent_observation_checkpoint;
      `);
    })();
    return {
      removedGoals: counts.goals,
      removedAgents: counts.agents,
      preservedAgents: 0,
      clearedLaunchReceipts: counts.launchReceipts,
    };
  }

  private resetCounts(): DatabaseResetCounts {
    return {
      goals:
        this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM goals").get()?.count ??
        0,
      agents:
        this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM agents").get()?.count ??
        0,
      launchReceipts:
        this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM launch_receipts").get()
          ?.count ?? 0,
    };
  }

  private loadLaunchReceipt(requestId: string): LaunchReceipt | undefined {
    const row = this.db
      .query<LaunchReceiptRow, [string]>(
        "SELECT request_id, intent_fingerprint, result_json, recovery_json FROM launch_receipts WHERE request_id = ?",
      )
      .get(requestId);
    if (!row) return undefined;
    const result = Schema.decodeUnknownSync(StartAgentResultSchema)(JSON.parse(row.result_json));
    if (result.requestId !== row.request_id) throw new Error("Launch receipt result is invalid.");
    return {
      requestId: row.request_id,
      intentFingerprint: row.intent_fingerprint,
      result,
      recovery: row.recovery_json
        ? Schema.decodeUnknownSync(LaunchRecoverySchema)(JSON.parse(row.recovery_json))
        : undefined,
    };
  }

  launchReceipts(): readonly LaunchReceipt[] {
    return this.db
      .query<{ request_id: string }, []>(
        "SELECT request_id FROM launch_receipts ORDER BY updated_at, request_id",
      )
      .all()
      .flatMap((row) => {
        const receipt = this.loadLaunchReceipt(row.request_id);
        return receipt ? [receipt] : [];
      });
  }

  reserveLaunchReceipt(receipt: LaunchReceipt) {
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO launch_receipts (request_id, intent_fingerprint, result_json, recovery_json, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        receipt.requestId,
        receipt.intentFingerprint,
        JSON.stringify(receipt.result),
        receipt.recovery ? JSON.stringify(receipt.recovery) : null,
        Date.now(),
      );
    if (inserted.changes === 1) return { kind: "reserved" as const };
    const stored = this.loadLaunchReceipt(receipt.requestId);
    if (!stored) throw new Error("Launch receipt reservation was not persisted.");
    return stored.intentFingerprint === receipt.intentFingerprint
      ? { kind: "existing" as const, receipt: stored }
      : { kind: "conflict" as const };
  }

  saveLaunchReceipt(receipt: LaunchReceipt): void {
    this.db
      .prepare(
        "UPDATE launch_receipts SET result_json = ?, recovery_json = ?, updated_at = ? WHERE request_id = ? AND intent_fingerprint = ?",
      )
      .run(
        JSON.stringify(receipt.result),
        receipt.recovery ? JSON.stringify(receipt.recovery) : null,
        Date.now(),
        receipt.requestId,
        receipt.intentFingerprint,
      );
  }

  private initializeSchema(): void {
    const existingTableCount =
      this.db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .get()?.count ?? 0;
    const generation =
      this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
    if (existingTableCount > 0 && generation !== SQLITE_SCHEMA_GENERATION) {
      this.db.close();
      throw new Error(
        "This Observatory database uses an incompatible schema. Reset it before starting Observatory.",
      );
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS systems (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        system_id TEXT REFERENCES systems(id),
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
        host_kind TEXT,
        host_instance_id TEXT,
        native_id TEXT,
        host_locator TEXT,
        execution_observed_at INTEGER,
        harness_id TEXT,
        continuity_scope_id TEXT,
        native_conversation_kind TEXT,
        native_conversation_value TEXT,
        continuity TEXT NOT NULL DEFAULT 'unknown',
        provider_continuity TEXT NOT NULL DEFAULT 'unknown',
        execution_presence TEXT NOT NULL DEFAULT 'unknown',
        resume_capability TEXT NOT NULL DEFAULT 'unknown',
        observation_health TEXT NOT NULL DEFAULT 'stale',
        provider_observed_at INTEGER,
        execution_history_json TEXT NOT NULL DEFAULT '[]',
        conflicting_executions_json TEXT NOT NULL DEFAULT '[]',
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
        archived_at INTEGER,
        FOREIGN KEY(primary_goal_id) REFERENCES goals(id)
      );
      CREATE TABLE IF NOT EXISTS hosts (
        host_kind TEXT NOT NULL,
        host_instance_id TEXT PRIMARY KEY,
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
      CREATE TABLE IF NOT EXISTS universe_changes (
        sequence INTEGER PRIMARY KEY,
        occurred_at INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        goal_id TEXT,
        summary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_checkpoint (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        last_sequence INTEGER NOT NULL,
        acknowledged_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS launch_receipts (
        request_id TEXT PRIMARY KEY,
        intent_fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        recovery_json TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_conversations (
        handle TEXT PRIMARY KEY,
        harness_id TEXT NOT NULL,
        continuity_scope_id TEXT NOT NULL,
        native_kind TEXT NOT NULL,
        native_value TEXT NOT NULL,
        provider_instance_id TEXT NOT NULL,
        home_site_ref TEXT,
        created_at INTEGER,
        last_active_at INTEGER,
        title TEXT,
        workspace_ref TEXT,
        resume_eligibility TEXT NOT NULL,
        provenance TEXT NOT NULL,
        observed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_conversations_instance
        ON provider_conversations(provider_instance_id);
      CREATE TABLE IF NOT EXISTS provider_conversation_aliases (
        handle TEXT NOT NULL,
        harness_id TEXT NOT NULL,
        continuity_scope_id TEXT NOT NULL,
        native_kind TEXT NOT NULL,
        native_value TEXT NOT NULL,
        PRIMARY KEY(handle, harness_id, continuity_scope_id, native_kind, native_value),
        FOREIGN KEY(handle) REFERENCES provider_conversations(handle) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS provider_conversation_alias_identity
        ON provider_conversation_aliases(harness_id, continuity_scope_id, native_kind, native_value);
      CREATE TABLE IF NOT EXISTS provider_catalogue_freshness (
        provider_instance_id TEXT PRIMARY KEY,
        harness_id TEXT NOT NULL,
        continuity_scope_id TEXT NOT NULL,
        observed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_observation_sources (
        harness_id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        provider_instance_id TEXT NOT NULL,
        continuity_scope_id TEXT NOT NULL,
        capability_json TEXT NOT NULL,
        health_json TEXT NOT NULL,
        cursor TEXT,
        captured_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_observation_current (
        harness_id TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        observation_json TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY(harness_id, observation_id)
      );
      CREATE TABLE IF NOT EXISTS agent_observation_transitions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        harness_id TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        observation_json TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        UNIQUE(harness_id, observation_id, revision)
      );
      CREATE TABLE IF NOT EXISTS agent_observation_checkpoint (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        last_sequence INTEGER NOT NULL,
        acknowledged_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agents_live_execution_identity
        ON agents(host_instance_id, native_id)
        WHERE host_instance_id IS NOT NULL AND native_id IS NOT NULL;
      PRAGMA user_version = ${SQLITE_SCHEMA_GENERATION};
    `);
  }
}

export const createMemoryStore = (): SqliteUniverseStore => new SqliteUniverseStore(":memory:");
