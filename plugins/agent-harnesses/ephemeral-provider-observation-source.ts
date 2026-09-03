import { Effect } from "effect";
import { createHash, randomUUID } from "node:crypto";
import {
  AGENT_OBSERVATION_SNAPSHOT_LIMIT,
  HarnessObservationError,
  type AgentObservation,
  type AgentObservationCapability,
  type AgentObservationReceiverInput,
  type AgentObservationReceiverV1,
  type AgentObservationSnapshot,
  type AgentObservationSourceV1,
} from "../../src/plugin-sdk/index.ts";
import {
  decodeProviderHookEvent,
  type ProviderLifecycleEvent,
} from "./provider-observation-events.ts";
import {
  observationProviderInstance,
  observationScope,
  type ProviderHarnessId,
} from "./provider-observation-installation.ts";

const MAX_RETAINED_TRANSITIONS = 1_000;

interface ObservationRow {
  readonly current: boolean;
  readonly sequence: number;
  readonly transition: boolean;
  readonly observation: AgentObservation;
}

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

const observationKey = (observation: AgentObservation): string =>
  `${observation.nativeConversationRef.value}\u0000${observation.kind}\u0000${observation.observationId}`;

export interface EphemeralProviderObservationSourceOptions {
  readonly configured: boolean;
  readonly harnessId: ProviderHarnessId;
  readonly root: string;
  readonly now?: () => number;
}

export class EphemeralProviderObservationSource
  implements AgentObservationSourceV1, AgentObservationReceiverV1
{
  readonly schemaVersion = 1 as const;
  private readonly configured: boolean;
  private readonly harnessId: ProviderHarnessId;
  private readonly now: () => number;
  private readonly continuityScopeId: string;
  private readonly providerInstanceId: string;
  private readonly cursorEpoch = randomUUID();
  private readonly current = new Map<string, ObservationRow>();
  private transitions: ObservationRow[] = [];
  private sequence = 0;
  private revision = 0;
  private lastEventAt?: number;

  constructor(options: EphemeralProviderObservationSourceOptions) {
    this.configured = options.configured;
    this.harnessId = options.harnessId;
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
      delivery: "ephemeral-events-and-snapshot",
      configured: this.configured,
      freshnessSeconds: {
        activity: 120,
        "human-input-request": 1_800,
        "turn-outcome": 86_400,
        "context-pressure": 600,
      },
    };
  }

  receive(input: AgentObservationReceiverInput) {
    return Effect.try({
      try: () => {
        if (!this.configured) return 0;
        const event = decodeProviderHookEvent(this.harnessId, input);
        return event ? this.record(event) : 0;
      },
      catch: () => new HarnessObservationError(`${this.harnessId} hook event was invalid.`),
    });
  }

  snapshot(request: {
    readonly providerInstanceId: string;
    readonly afterCursor?: string;
    readonly limit: number;
  }) {
    return Effect.sync((): AgentObservationSnapshot => {
      const capturedAt = this.now();
      if (!this.configured)
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
            diagnostics: ["Provider observation hooks are not configured."],
          },
        };
      const [requestedEpoch, requestedSequence] = request.afterCursor?.split(":") ?? [];
      const afterSequence =
        requestedEpoch === this.cursorEpoch
          ? Math.max(0, Number.parseInt(requestedSequence ?? "0", 10) || 0)
          : 0;
      const limit = Math.min(Math.max(1, request.limit), AGENT_OBSERVATION_SNAPSHOT_LIMIT);
      const transitions = this.transitions
        .filter(({ sequence }) => sequence > afterSequence)
        .slice(0, limit);
      const current = [...this.current.values()]
        .sort((left, right) => right.sequence - left.sequence)
        .slice(0, limit)
        .map(({ observation }) => observation);
      const truncatedCurrent = this.current.size > limit;
      const truncatedTransitions =
        transitions.length === limit &&
        this.transitions.some(({ sequence }) => sequence > transitions.at(-1)!.sequence);
      const diagnostics = [
        ...(this.lastEventAt === undefined
          ? ["No provider hook event has been received yet."]
          : []),
        ...(truncatedCurrent
          ? [`Observation current state exceeded the ${limit} record snapshot limit.`]
          : []),
      ];
      return {
        schemaVersion: 1,
        harnessId: this.harnessId,
        providerInstanceId: this.providerInstanceId,
        continuityScopeId: this.continuityScopeId,
        capturedAt,
        complete: !truncatedCurrent,
        cursor: `${this.cursorEpoch}:${transitions.at(-1)?.sequence ?? afterSequence}`,
        current,
        transitions: transitions.map(({ observation }) => observation),
        health: {
          state: truncatedCurrent || truncatedTransitions ? "degraded" : "healthy",
          lastSuccessfulAt: capturedAt,
          diagnostics,
        },
      };
    });
  }

  private record(event: ProviderLifecycleEvent): number {
    const observedAt = this.now();
    const rows = this.reduceEvent(event, observedAt);
    for (const row of rows) {
      const key = observationKey(row.observation);
      if (row.current) this.current.set(key, row);
      else this.current.delete(key);
      if (row.transition) this.transitions.push(row);
    }
    this.transitions = this.transitions.slice(-MAX_RETAINED_TRANSITIONS);
    if (rows.length > 0) this.lastEventAt = observedAt;
    return rows.length;
  }

  private reduceEvent(
    event: ProviderLifecycleEvent,
    observedAt: number,
  ): readonly ObservationRow[] {
    const row = (
      observation: Omit<AgentObservation, "revision">,
      current = true,
      transition = true,
    ): ObservationRow => {
      this.sequence += 1;
      this.revision = Math.max(this.revision + 1, observedAt * 1_000 + (this.sequence % 1_000));
      return {
        current,
        transition,
        sequence: this.sequence,
        // SAFETY: The reducer constructs one already-discriminated AgentObservation variant;
        // adding its common optional revision preserves that validated variant.
        observation: { ...observation, revision: this.revision } as AgentObservation,
      };
    };
    const base = {
      schemaVersion: 1 as const,
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
    const pendingRequest = this.current.get(
      `${event.sessionId}\u0000human-input-request\u0000request:permission`,
    )?.observation;
    const request = (state: "open" | "resolved" | "withdrawn", toolName?: string) =>
      row(
        {
          ...base,
          observationId: "request:permission",
          kind: "human-input-request",
          payload: {
            requestId: `${this.harnessId}:permission:${createHash("sha256")
              .update(event.sessionId)
              .digest("hex")
              .slice(0, 24)}`,
            requestKind: "permission",
            state,
            toolCategory:
              toolName === undefined
                ? pendingRequest?.kind === "human-input-request"
                  ? pendingRequest.payload.toolCategory
                  : undefined
                : toolCategory(toolName),
          },
        },
        state === "open",
      );
    const closeRequest = (state: "resolved" | "withdrawn") =>
      pendingRequest ? [request(state, "toolName" in event ? event.toolName : undefined)] : [];
    const retainedOutcome = this.current.has(
      `${event.sessionId}\u0000turn-outcome\u0000turn-outcome`,
    );
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
          ...closeRequest("withdrawn"),
          activity("responding"),
        ];
      case "tool-started":
        return [activity("using-tool", event.toolName)];
      case "permission-requested":
        return [request("open", event.toolName)];
      case "tool-completed":
        return [activity("responding"), ...closeRequest("resolved")];
      case "compaction-started":
        return [activity("compacting"), context("started")];
      case "compaction-completed":
        return [activity("responding"), context("completed")];
      case "settled":
        return [...closeRequest("withdrawn"), activity("idle"), outcome()];
      case "session-ended":
        return [...closeRequest("withdrawn"), activity("idle")];
    }
  }
}
