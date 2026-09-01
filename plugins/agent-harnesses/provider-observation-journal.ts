import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AGENT_OBSERVATION_SNAPSHOT_LIMIT,
  AgentObservationSchema,
  HarnessObservationError,
  type AgentObservation,
  type AgentObservationCapability,
  type AgentObservationSnapshot,
  type AgentObservationSourceV1,
} from "../../src/plugin-sdk/index.ts";
import {
  observationProviderInstance,
  observationScope,
  type ProviderHarnessId,
} from "./provider-observation-installation.ts";

const MAX_RETAINED_TRANSITIONS = 1_000;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 2_000;
const MALFORMED_LOCK_RECLAIM_MS = 30_000;
const STALE_EVENT_MS = 10 * 60 * 1_000;
const ErrorCodeSchema = Schema.Struct({ code: Schema.String });
const LockRecordSchema = Schema.Struct({ pid: Schema.Number, token: Schema.String });
const ProviderObservationRowSchema = Schema.Struct({
  current: Schema.optional(Schema.Boolean),
  sequence: Schema.optional(Schema.Number),
  transition: Schema.optional(Schema.Boolean),
  observation: AgentObservationSchema,
});

export type ProviderLifecycleEvent =
  | { readonly type: "session-started"; readonly sessionId: string }
  | { readonly type: "turn-started"; readonly sessionId: string; readonly turnId?: string }
  | { readonly type: "tool-started"; readonly sessionId: string; readonly toolName?: string }
  | { readonly type: "tool-completed"; readonly sessionId: string; readonly toolName?: string }
  | {
      readonly type: "permission-requested";
      readonly sessionId: string;
      readonly toolName?: string;
    }
  | { readonly type: "compaction-started"; readonly sessionId: string }
  | { readonly type: "compaction-completed"; readonly sessionId: string }
  | { readonly type: "settled"; readonly sessionId: string; readonly turnId?: string }
  | { readonly type: "session-ended"; readonly sessionId: string };

interface ObservationRow {
  readonly current: boolean;
  readonly sequence: number;
  readonly transition: boolean;
  readonly observation: AgentObservation;
}

interface JournalAnalysis {
  readonly rows: readonly ObservationRow[];
  readonly current: ReadonlyMap<string, ObservationRow>;
  readonly invalidRows: number;
  readonly earliestTransition?: number;
  readonly latestTransition?: number;
  readonly newestObservedAt?: number;
}

export interface ProviderObservationJournalInspection {
  readonly configured: boolean;
  readonly filePresent: boolean;
  readonly byteSize?: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly currentCount: number;
  readonly transitionCount: number;
  readonly earliestTransition?: number;
  readonly latestTransition?: number;
  readonly lastEventAt?: number;
  readonly health: AgentObservationSnapshot["health"]["state"];
  readonly diagnostics: readonly string[];
}

export interface ProviderObservationJournalOptions {
  readonly harnessId: ProviderHarnessId;
  readonly path?: string;
  readonly root: string;
  readonly now?: () => number;
}

const observationKey = (observation: AgentObservation): string =>
  `${observation.nativeConversationRef.value}\u0000${observation.kind}\u0000${observation.observationId}`;

const reduceCurrent = (rows: readonly ObservationRow[]): ReadonlyMap<string, ObservationRow> => {
  const current = new Map<string, ObservationRow>();
  for (const row of [...rows].sort((left, right) => left.sequence - right.sequence)) {
    const key = observationKey(row.observation);
    const previous = current.get(key);
    if ((previous?.observation.revision ?? -1) > (row.observation.revision ?? 0)) continue;
    if (row.current) current.set(key, row);
    else current.delete(key);
  }
  return current;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !Schema.is(ErrorCodeSchema)(error) || error.code !== "ESRCH";
  }
};

/* oxlint-disable no-await-in-loop -- Lock acquisition is intentionally serial. */
const withJournalLock = async <T>(path: string, work: () => Promise<T>): Promise<T> => {
  const lockPath = `${path}.lock`;
  const token = randomUUID();
  const startedAt = Date.now();
  let handle;
  for (;;) {
    try {
      await mkdir(dirname(path), { recursive: true });
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      break;
    } catch (error) {
      if (!Schema.is(ErrorCodeSchema)(error) || error.code !== "EEXIST") throw error;
      let reclaim = false;
      try {
        const lock = Schema.decodeUnknownSync(Schema.parseJson(LockRecordSchema))(
          await readFile(lockPath, "utf8"),
        );
        reclaim = !processIsAlive(lock.pid);
      } catch {
        try {
          reclaim = Date.now() - (await stat(lockPath)).mtimeMs > MALFORMED_LOCK_RECLAIM_MS;
        } catch (metadataError) {
          if (Schema.is(ErrorCodeSchema)(metadataError) && metadataError.code === "ENOENT")
            continue;
          throw metadataError;
        }
      }
      if (reclaim) await unlink(lockPath).catch(() => undefined);
      else if (Date.now() - startedAt >= LOCK_TIMEOUT_MS)
        throw new Error("Provider observation journal is busy.", { cause: error });
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    return await work();
  } finally {
    await handle.close();
    try {
      const lock = Schema.decodeUnknownSync(Schema.parseJson(LockRecordSchema))(
        await readFile(lockPath, "utf8"),
      );
      if (lock.token === token) await unlink(lockPath);
    } catch {
      // Another owner or recovery attempt owns the lock path now.
    }
  }
};
/* oxlint-enable no-await-in-loop */

const writeRows = async (path: string, rows: readonly ObservationRow[]): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

type ToolCategory = "read" | "write" | "execute" | "search" | "network" | "delegate" | "other";
const toolCategory = (name: string | undefined): ToolCategory => {
  const value = name?.toLowerCase() ?? "";
  if (/task|agent|delegate|subagent/u.test(value)) return "delegate";
  if (/web|fetch|http|network|browser/u.test(value)) return "network";
  if (/write|edit|patch|notebook/u.test(value)) return "write";
  if (/bash|shell|exec|command|terminal/u.test(value)) return "execute";
  if (/grep|glob|find|search|list|ls/u.test(value)) return "search";
  if (/read|view|open/u.test(value)) return "read";
  return "other";
};

const compactRows = (rows: readonly ObservationRow[]): readonly ObservationRow[] => {
  const retained = new Map<string, ObservationRow>();
  const active = [...reduceCurrent(rows).values()];
  const openRequests = active.filter(
    ({ observation }) =>
      observation.kind === "human-input-request" && observation.payload.state === "open",
  );
  const boundedCurrent = [
    ...openRequests,
    ...active
      .filter(({ observation }) => observation.kind !== "human-input-request")
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, Math.max(0, AGENT_OBSERVATION_SNAPSHOT_LIMIT - openRequests.length)),
  ];
  for (const row of boundedCurrent)
    retained.set(`${row.sequence}\u0000${observationKey(row.observation)}`, row);
  for (const row of rows
    .filter(({ current, transition }) => transition || !current)
    .slice(-MAX_RETAINED_TRANSITIONS))
    retained.set(`${row.sequence}\u0000${observationKey(row.observation)}`, row);
  return [...retained.values()].sort((left, right) => left.sequence - right.sequence);
};

export class ProviderObservationJournal implements AgentObservationSourceV1 {
  readonly schemaVersion = 1 as const;
  private readonly harnessId: ProviderHarnessId;
  private readonly path: string | undefined;
  private readonly now: () => number;
  private readonly continuityScopeId: string;
  private readonly providerInstanceId: string;

  constructor(options: ProviderObservationJournalOptions) {
    this.harnessId = options.harnessId;
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.continuityScopeId = observationScope(options.harnessId, options.root);
    this.providerInstanceId = observationProviderInstance(
      options.harnessId,
      this.continuityScopeId,
    );
  }

  describe(): AgentObservationCapability {
    return {
      kinds: ["activity", "human-input-request", "turn-outcome", "context-pressure"],
      acquisition: "hook",
      delivery: "retained-events-and-snapshot",
      configured: this.path !== undefined,
      freshnessSeconds: {
        activity: 120,
        "human-input-request": 1_800,
        "turn-outcome": 86_400,
        "context-pressure": 600,
      },
    };
  }

  private async analyze(): Promise<JournalAnalysis> {
    if (!this.path) return { rows: [], current: new Map(), invalidRows: 0 };
    let text: string;
    try {
      const metadata = await stat(this.path);
      if (metadata.size > MAX_JOURNAL_BYTES)
        throw new Error("Observation journal exceeds the safe read limit.");
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (Schema.is(ErrorCodeSchema)(error) && error.code === "ENOENT")
        return { rows: [], current: new Map(), invalidRows: 0 };
      throw error;
    }
    const rows: ObservationRow[] = [];
    let invalidRows = 0;
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      try {
        const decoded = Schema.decodeUnknownSync(Schema.parseJson(ProviderObservationRowSchema))(
          line,
        );
        const observation = decoded.observation;
        const validIdentity =
          observation.nativeConversationRef.harnessId === this.harnessId &&
          observation.nativeConversationRef.continuityScopeId === this.continuityScopeId &&
          observation.providerInstanceId === this.providerInstanceId;
        if (!validIdentity) {
          invalidRows += 1;
          continue;
        }
        rows.push({
          current: decoded.current !== false,
          sequence:
            decoded.sequence !== undefined && Number.isSafeInteger(decoded.sequence)
              ? decoded.sequence
              : index + 1,
          transition: decoded.transition !== false,
          observation,
        });
      } catch {
        invalidRows += 1;
      }
    }
    rows.sort((left, right) => left.sequence - right.sequence);
    const transitions = rows.filter(({ transition }) => transition);
    return {
      rows,
      current: reduceCurrent(rows),
      invalidRows,
      earliestTransition: transitions.at(0)?.sequence,
      latestTransition: transitions.at(-1)?.sequence,
      newestObservedAt: rows.reduce<number | undefined>(
        (latest, row) => Math.max(latest ?? 0, row.observation.observedAt),
        undefined,
      ),
    };
  }

  private diagnostics(analysis: JournalAnalysis): string[] {
    return [
      ...(analysis.invalidRows > 0
        ? [`${analysis.invalidRows} observation journal records were invalid or foreign.`]
        : []),
      ...(analysis.newestObservedAt === undefined
        ? ["No provider hook event has been observed yet."]
        : []),
    ];
  }

  async inspect(): Promise<ProviderObservationJournalInspection> {
    if (!this.path)
      return {
        configured: false,
        filePresent: false,
        validRows: 0,
        invalidRows: 0,
        currentCount: 0,
        transitionCount: 0,
        health: "not-configured",
        diagnostics: ["Provider observation journal is not configured."],
      };
    let metadata;
    try {
      metadata = await stat(this.path);
    } catch (error) {
      if (!Schema.is(ErrorCodeSchema)(error) || error.code !== "ENOENT") throw error;
    }
    const analysis = await this.analyze();
    const diagnostics = this.diagnostics(analysis);
    const stale =
      analysis.newestObservedAt === undefined ||
      this.now() - analysis.newestObservedAt > STALE_EVENT_MS;
    return {
      configured: true,
      filePresent: metadata !== undefined,
      byteSize: metadata?.size,
      validRows: analysis.rows.length,
      invalidRows: analysis.invalidRows,
      currentCount: analysis.current.size,
      transitionCount: analysis.rows.filter(({ transition }) => transition).length,
      earliestTransition: analysis.earliestTransition,
      latestTransition: analysis.latestTransition,
      lastEventAt: analysis.newestObservedAt,
      health: analysis.invalidRows > 0 ? "degraded" : stale ? "stale" : "healthy",
      diagnostics,
    };
  }

  snapshot(request: {
    readonly providerInstanceId: string;
    readonly afterCursor?: string;
    readonly limit: number;
  }) {
    return Effect.tryPromise({
      try: async (): Promise<AgentObservationSnapshot> => {
        const capturedAt = this.now();
        if (!this.path)
          return {
            schemaVersion: 1,
            harnessId: this.harnessId,
            providerInstanceId: this.providerInstanceId,
            continuityScopeId: this.continuityScopeId,
            capturedAt,
            complete: true,
            current: [],
            transitions: [],
            health: {
              state: "not-configured",
              diagnostics: ["Provider observation journal is not configured."],
            },
          };
        const analysis = await this.analyze();
        const afterSequence = Math.max(0, Number.parseInt(request.afterCursor ?? "0", 10) || 0);
        const limit = Math.min(Math.max(1, request.limit), AGENT_OBSERVATION_SNAPSHOT_LIMIT);
        const cursorGap =
          analysis.earliestTransition !== undefined &&
          afterSequence > 0 &&
          afterSequence < analysis.earliestTransition - 1;
        const transitions = analysis.rows
          .filter(({ sequence, transition }) => transition && sequence > afterSequence)
          .slice(0, limit);
        const current = [...analysis.current.values()]
          .sort((left, right) => right.sequence - left.sequence)
          .slice(0, limit)
          .map(({ observation }) => observation);
        const truncatedCurrent = analysis.current.size > limit;
        const diagnostics = [
          ...this.diagnostics(analysis),
          ...(truncatedCurrent
            ? [`Observation current state exceeded the ${limit} record snapshot limit.`]
            : []),
          ...(cursorGap
            ? ["Observation transition history was compacted beyond the requested cursor."]
            : []),
        ];
        const degraded = analysis.invalidRows > 0 || truncatedCurrent || cursorGap;
        const stale =
          analysis.newestObservedAt === undefined ||
          capturedAt - analysis.newestObservedAt > STALE_EVENT_MS;
        return {
          schemaVersion: 1,
          harnessId: this.harnessId,
          providerInstanceId: this.providerInstanceId,
          continuityScopeId: this.continuityScopeId,
          capturedAt,
          complete: !degraded,
          cursor: String(transitions.at(-1)?.sequence ?? afterSequence),
          current,
          transitions: transitions.map(({ observation }) => observation),
          health: {
            state: degraded ? "degraded" : stale ? "stale" : "healthy",
            lastSuccessfulAt: capturedAt,
            diagnostics,
          },
        };
      },
      catch: () =>
        new HarnessObservationError(`${this.harnessId} observation journal could not be read.`),
    });
  }

  async record(event: ProviderLifecycleEvent, observedAt = this.now()): Promise<number> {
    if (!this.path) throw new Error("Provider observation journal is not configured.");
    return withJournalLock(this.path, async () => {
      const analysis = await this.analyze();
      const sequence = analysis.rows.reduce((latest, row) => Math.max(latest, row.sequence), 0) + 1;
      const revision =
        analysis.rows.reduce(
          (latest, row) => Math.max(latest, row.observation.revision ?? row.sequence),
          0,
        ) + 1;
      const rows = this.reduceEvent(event, observedAt, sequence, revision, analysis.current).map(
        (row, index) => ({
          ...row,
          sequence: sequence + index,
          observation: { ...row.observation, revision: revision + index },
        }),
      );
      if (rows.length === 0) return 0;
      await writeRows(this.path, compactRows([...analysis.rows, ...rows]));
      return rows.length;
    });
  }

  private reduceEvent(
    event: ProviderLifecycleEvent,
    observedAt: number,
    sequence: number,
    revision: number,
    retained: ReadonlyMap<string, ObservationRow>,
  ): readonly ObservationRow[] {
    const base = {
      schemaVersion: 1 as const,
      revision,
      nativeConversationRef: {
        harnessId: this.harnessId,
        continuityScopeId: this.continuityScopeId,
        kind: "id",
        value: event.sessionId.slice(0, 1_000),
      },
      providerInstanceId: this.providerInstanceId,
      observedAt,
      source: { mechanism: "hook" as const },
    };
    const row = (
      observation: AgentObservation,
      current = true,
      transition = true,
    ): ObservationRow => ({
      current,
      transition,
      sequence,
      observation,
    });
    const activity = (
      phase: "responding" | "using-tool" | "compacting" | "idle",
      toolName?: string,
    ) =>
      row({
        ...base,
        observationId: "activity",
        kind: "activity",
        payload: {
          phase,
          toolCategory: phase === "using-tool" ? toolCategory(toolName) : undefined,
        },
      });
    const context = (compaction: "started" | "completed") =>
      row({
        ...base,
        observationId: "context-pressure",
        kind: "context-pressure",
        payload: { compaction },
      });
    const pendingRequests = [...retained.values()]
      .map(({ observation }) => observation)
      .filter(
        (
          observation,
        ): observation is Extract<AgentObservation, { readonly kind: "human-input-request" }> =>
          observation.nativeConversationRef.value === event.sessionId &&
          observation.kind === "human-input-request" &&
          observation.payload.state === "open",
      );
    const request = (
      state: "open" | "resolved" | "withdrawn",
      existing?: Extract<AgentObservation, { readonly kind: "human-input-request" }>,
      toolName?: string,
    ) =>
      row(
        {
          ...base,
          observationId: existing?.observationId ?? "request:permission",
          kind: "human-input-request",
          payload: {
            requestId:
              existing?.payload.requestId ?? `${this.harnessId}:${event.sessionId}:permission`,
            requestKind: "permission",
            state,
            toolCategory: toolName ? toolCategory(toolName) : existing?.payload.toolCategory,
          },
        },
        state === "open",
      );
    const closeRequests = (state: "resolved" | "withdrawn") =>
      pendingRequests.map((existing) =>
        request(state, existing, "toolName" in event ? event.toolName : undefined),
      );
    const retainedOutcome = retained.get(`${event.sessionId}\u0000turn-outcome\u0000turn-outcome`);
    const outcome = (current = true) =>
      row(
        {
          ...base,
          observationId: "turn-outcome",
          kind: "turn-outcome",
          payload: {
            turnId: "turnId" in event ? event.turnId?.slice(0, 200) : undefined,
            outcome: "response-completed",
          },
        },
        current,
        current,
      );

    switch (event.type) {
      case "session-started":
        return [activity("idle")];
      case "turn-started":
        return [
          ...(retainedOutcome ? [outcome(false)] : []),
          ...closeRequests("withdrawn"),
          activity("responding"),
        ];
      case "tool-started":
        return [activity("using-tool", event.toolName)];
      case "permission-requested":
        return [request("open", undefined, event.toolName)];
      case "tool-completed":
        return [activity("responding"), ...closeRequests("resolved")];
      case "compaction-started":
        return [activity("compacting"), context("started")];
      case "compaction-completed":
        return [activity("responding"), context("completed")];
      case "settled":
        return [...closeRequests("withdrawn"), activity("idle"), outcome()];
      case "session-ended":
        return [...closeRequests("withdrawn"), activity("idle")];
    }
  }
}
