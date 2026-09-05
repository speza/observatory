import { Effect, Either, Schema } from "effect";
import type { ControlPlaneEventSink } from "../control-plane-events/index.ts";
import type {
  AgentHarness,
  AgentObservation,
  AgentObservationCapability,
  AgentObservationSnapshot,
} from "../plugin-sdk/index.ts";
import type { Universe } from "../universe/universe.ts";
import type {
  AgentEvidence,
  AgentEvidenceSnapshot,
  AgentObservationModule,
  AgentObservationStore,
  StoredAgentObservation,
} from "./types.ts";

const MAX_OBSERVATIONS = 500;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_ID_LENGTH = 200;
const MAX_NATIVE_KIND_LENGTH = 100;
const MAX_NATIVE_VALUE_LENGTH = 1_000;
const MAX_CURSOR_LENGTH = 500;
const MAX_DIAGNOSTICS = 16;
const MAX_DIAGNOSTIC_LENGTH = 300;
const kindNames: readonly AgentObservation["kind"][] = [
  "activity",
  "human-input-request",
  "turn-outcome",
  "context-pressure",
];
const kinds = new Set(kindNames);
const kindNameSet = new Set<string>(kindNames);
const toolCategories = new Set([
  "read",
  "write",
  "execute",
  "search",
  "network",
  "delegate",
  "other",
]);
const healthStates = new Set([
  "unsupported",
  "not-configured",
  "healthy",
  "stale",
  "unavailable",
  "degraded",
]);
const extensionKey = /^[a-z0-9][a-z0-9.-]{0,63}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/u;
const isString = Schema.is(Schema.String);
const isBoolean = Schema.is(Schema.Boolean);
const isExtensionValue = Schema.is(
  Schema.Union(Schema.String, Schema.Number, Schema.Boolean, Schema.Null),
);
const boundedString = (value: string, maximum: number): boolean =>
  isString(value) && value.length > 0 && value.length <= maximum;
const fallbackCapability: AgentObservationCapability = {
  kinds: [],
  acquisition: "metadata",
  delivery: "snapshot",
  configured: false,
  freshnessSeconds: {},
};

const validCapability = (capability: AgentObservationCapability): boolean => {
  try {
    const freshness = Object.entries(capability.freshnessSeconds ?? {});
    return (
      Array.isArray(capability.kinds) &&
      capability.kinds.length <= kinds.size &&
      new Set(capability.kinds).size === capability.kinds.length &&
      capability.kinds.every((kind) => kindNames.includes(kind)) &&
      ["hook", "structured-api", "metadata", "mixed"].includes(capability.acquisition) &&
      ["snapshot", "ephemeral-events-and-snapshot", "retained-events-and-snapshot"].includes(
        capability.delivery,
      ) &&
      isBoolean(capability.configured) &&
      freshness.length <= kinds.size &&
      freshness.every(
        ([kind, seconds]) =>
          kindNameSet.has(kind) &&
          capability.kinds.some((supported) => supported === kind) &&
          Number.isFinite(seconds) &&
          seconds > 0 &&
          seconds <= 7 * 24 * 60 * 60,
      )
    );
  } catch {
    return false;
  }
};

const validSnapshot = (
  snapshot: AgentObservationSnapshot,
  harness: AgentHarness,
  now: number,
): boolean => {
  try {
    return (
      snapshot.schemaVersion === 1 &&
      snapshot.harnessId === harness.harnessId &&
      boundedString(snapshot.providerInstanceId, MAX_ID_LENGTH) &&
      boundedString(snapshot.continuityScopeId, MAX_ID_LENGTH) &&
      (snapshot.cursor === undefined ||
        (isString(snapshot.cursor) && snapshot.cursor.length <= MAX_CURSOR_LENGTH)) &&
      Number.isFinite(snapshot.capturedAt) &&
      snapshot.capturedAt <= now + MAX_CLOCK_SKEW_MS &&
      isBoolean(snapshot.complete) &&
      Array.isArray(snapshot.current) &&
      Array.isArray(snapshot.transitions) &&
      snapshot.current.length <= MAX_OBSERVATIONS &&
      snapshot.transitions.length <= MAX_OBSERVATIONS &&
      healthStates.has(snapshot.health?.state) &&
      Array.isArray(snapshot.health?.diagnostics) &&
      snapshot.health.diagnostics.length <= MAX_DIAGNOSTICS &&
      snapshot.health.diagnostics.every(
        (diagnostic) => isString(diagnostic) && diagnostic.length <= MAX_DIAGNOSTIC_LENGTH,
      ) &&
      (snapshot.health.lastSuccessfulAt === undefined ||
        (Number.isFinite(snapshot.health.lastSuccessfulAt) &&
          snapshot.health.lastSuccessfulAt <= now + MAX_CLOCK_SKEW_MS))
    );
  } catch {
    return false;
  }
};

const validObservation = (
  observation: AgentObservation,
  harness: AgentHarness,
  providerInstanceId: string,
  continuityScopeId: string,
  capturedAt: number,
  pluginId: string,
): boolean => {
  try {
    if (
      observation.schemaVersion !== 1 ||
      !observation.observationId.trim() ||
      observation.observationId.length > MAX_ID_LENGTH ||
      !kinds.has(observation.kind) ||
      !boundedString(observation.nativeConversationRef.kind, MAX_NATIVE_KIND_LENGTH) ||
      !boundedString(observation.nativeConversationRef.value, MAX_NATIVE_VALUE_LENGTH) ||
      observation.nativeConversationRef.harnessId !== harness.harnessId ||
      observation.nativeConversationRef.continuityScopeId !== continuityScopeId ||
      observation.providerInstanceId !== providerInstanceId ||
      !["hook", "structured-api", "metadata"].includes(observation.source.mechanism) ||
      (observation.source.providerVersion !== undefined &&
        !boundedString(observation.source.providerVersion, 80)) ||
      !Number.isFinite(observation.observedAt) ||
      observation.observedAt > capturedAt + MAX_CLOCK_SKEW_MS ||
      JSON.stringify(observation.payload).length > 2_048 ||
      JSON.stringify(observation.extensions ?? {}).length > 2_048 ||
      Object.keys(observation.extensions ?? {}).length > 16 ||
      !Object.entries(observation.extensions ?? {}).every(
        ([key, value]) =>
          extensionKey.test(key) && key.startsWith(`${pluginId}/`) && isExtensionValue(value),
      )
    )
      return false;
    if (observation.kind === "activity")
      return (
        ["responding", "using-tool", "compacting", "idle"].includes(observation.payload.phase) &&
        (observation.payload.toolCategory === undefined ||
          toolCategories.has(observation.payload.toolCategory))
      );
    if (observation.kind === "human-input-request")
      return (
        observation.payload.requestId.length > 0 &&
        observation.payload.requestId.length <= 200 &&
        ["permission", "question", "plan-approval", "other"].includes(
          observation.payload.requestKind,
        ) &&
        ["open", "resolved", "withdrawn"].includes(observation.payload.state) &&
        (observation.payload.toolCategory === undefined ||
          toolCategories.has(observation.payload.toolCategory))
      );
    if (observation.kind === "turn-outcome")
      return (
        ["response-completed", "failed", "interrupted"].includes(observation.payload.outcome) &&
        (observation.payload.turnId === undefined ||
          boundedString(observation.payload.turnId, MAX_ID_LENGTH)) &&
        (observation.payload.failureCategory === undefined ||
          [
            "rate-limit",
            "authentication",
            "billing",
            "provider-overloaded",
            "context-limit",
            "tool",
            "unknown",
          ].includes(observation.payload.failureCategory))
      );
    return (
      (observation.payload.usedRatio !== undefined ||
        observation.payload.compaction !== undefined) &&
      (observation.payload.usedRatio === undefined ||
        (Number.isFinite(observation.payload.usedRatio) &&
          observation.payload.usedRatio >= 0 &&
          observation.payload.usedRatio <= 1)) &&
      (observation.payload.compaction === undefined ||
        ["started", "completed"].includes(observation.payload.compaction))
    );
  } catch {
    return false;
  }
};

export class AgentObservationCoordinator implements AgentObservationModule {
  constructor(
    private readonly harnesses: {
      agentHarnesses(): readonly AgentHarness[];
      agentHarnessPluginId?(harnessId: string): string | undefined;
    },
    private readonly store: AgentObservationStore,
    private readonly universe: Universe,
    private readonly now: () => number,
    private readonly events?: ControlPlaneEventSink,
  ) {}

  refresh() {
    return Effect.gen(this, function* () {
      const sources = this.harnesses
        .agentHarnesses()
        .filter((harness) => harness.observationSource !== undefined);
      const results = yield* Effect.forEach(
        sources,
        (harness) => {
          const source = harness.observationSource!;
          const previous = this.store.observationSource(harness.harnessId);
          return Effect.either(
            source.snapshot({
              providerInstanceId: previous?.providerInstanceId ?? "",
              afterCursor: previous?.cursor,
              limit: MAX_OBSERVATIONS,
            }),
          );
        },
        { concurrency: "unbounded" },
      );
      const diagnostics: string[] = [];
      const changedAgentIds = new Set<string>();
      const changedKinds = new Set<AgentObservation["kind"]>();
      const markHarnessChanged = (
        harnessId: string,
        supportedKinds: readonly AgentObservation["kind"][],
      ): void => {
        for (const agent of this.universe.snapshot().agents)
          if (agent.harnessId === harnessId) changedAgentIds.add(agent.id);
        for (const kind of supportedKinds) changedKinds.add(kind);
      };
      let observedSources = 0;
      for (const [index, result] of results.entries()) {
        const harness = sources[index]!;
        const pluginId =
          this.harnesses.agentHarnessPluginId?.(harness.harnessId) ?? "unknown-plugin";
        let capability = fallbackCapability;
        let capabilityAvailable = true;
        try {
          capability = harness.observationSource!.describe();
        } catch {
          capabilityAvailable = false;
        }
        if (!capabilityAvailable || !validCapability(capability)) {
          const diagnostic = `${harness.describe().label} returned an invalid observation capability.`;
          diagnostics.push(diagnostic);
          const changed = this.store.markObservationSourceUnavailable(
            harness.harnessId,
            fallbackCapability,
            this.now(),
            diagnostic,
            pluginId,
          );
          if (changed) markHarnessChanged(harness.harnessId, kindNames);
          continue;
        }
        if (Either.isLeft(result)) {
          const diagnostic = result.left.message.slice(0, 300);
          diagnostics.push(diagnostic);
          const changed = this.store.markObservationSourceUnavailable(
            harness.harnessId,
            capability,
            this.now(),
            diagnostic,
            pluginId,
          );
          if (changed) markHarnessChanged(harness.harnessId, capability.kinds);
          continue;
        }
        const snapshot = result.right;
        if (!validSnapshot(snapshot, harness, this.now())) {
          const diagnostic = `${harness.describe().label} returned an invalid observation snapshot.`;
          diagnostics.push(diagnostic);
          const changed = this.store.markObservationSourceUnavailable(
            harness.harnessId,
            capability,
            this.now(),
            diagnostic,
            pluginId,
          );
          if (changed) markHarnessChanged(harness.harnessId, capability.kinds);
          continue;
        }
        const validCurrent = snapshot.current.filter((item) =>
          capability.kinds.includes(item.kind)
            ? validObservation(
                item,
                harness,
                snapshot.providerInstanceId,
                snapshot.continuityScopeId,
                snapshot.capturedAt,
                pluginId,
              )
            : false,
        );
        const validTransitions = snapshot.transitions.filter((item) =>
          capability.kinds.includes(item.kind)
            ? validObservation(
                item,
                harness,
                snapshot.providerInstanceId,
                snapshot.continuityScopeId,
                snapshot.capturedAt,
                pluginId,
              )
            : false,
        );
        const rejected =
          snapshot.current.length +
          snapshot.transitions.length -
          validCurrent.length -
          validTransitions.length;
        const current = validCurrent.filter(
          (item) => this.universe.resolveAgentId(item.nativeConversationRef) !== undefined,
        );
        const transitions = validTransitions.filter(
          (item) => this.universe.resolveAgentId(item.nativeConversationRef) !== undefined,
        );
        if (rejected > 0)
          diagnostics.push(
            `${harness.describe().label} discarded ${rejected} invalid observations.`,
          );
        const reconciliation = this.store.reconcileAgentObservations(
          { ...snapshot, current, transitions },
          capability,
          this.now(),
          pluginId,
        );
        if (!reconciliation.accepted) {
          diagnostics.push(
            `${harness.describe().label} returned an out-of-order observation snapshot; it was ignored.`,
          );
          continue;
        }
        observedSources += 1;
        if (reconciliation.sourceChanged) markHarnessChanged(harness.harnessId, capability.kinds);
        for (const observation of reconciliation.changedObservations) {
          const agentId = this.universe.resolveAgentId(observation.nativeConversationRef);
          if (agentId) changedAgentIds.add(agentId);
          changedKinds.add(observation.kind);
        }
      }
      const activeHarnessIds = new Set(sources.map(({ harnessId }) => harnessId));
      for (const previous of this.store.agentObservationSources()) {
        if (activeHarnessIds.has(previous.harnessId) || previous.health.state === "unavailable")
          continue;
        const diagnostic = `${previous.harnessId} observation source is no longer loaded.`;
        const changed = this.store.markObservationSourceUnavailable(
          previous.harnessId,
          previous.capability,
          this.now(),
          diagnostic,
          previous.pluginId,
        );
        diagnostics.push(diagnostic);
        if (changed) markHarnessChanged(previous.harnessId, previous.capability.kinds);
      }
      if (changedAgentIds.size > 0 && changedKinds.size > 0)
        this.events?.publish([
          {
            type: "provider-evidence-changed",
            cause: "provider-observation",
            occurredAt: this.now(),
            agentIds: [...changedAgentIds],
            kinds: [...changedKinds],
          },
        ]);
      return { observedSources, diagnostics };
    });
  }

  snapshot(): AgentEvidenceSnapshot {
    const generatedAt = this.now();
    const state = this.universe.snapshot();
    const sources = new Map(
      this.store.agentObservationSources().map((source) => [source.harnessId, source]),
    );
    const labels = new Map(
      this.harnesses
        .agentHarnesses()
        .map((harness) => [harness.harnessId, harness.describe().label]),
    );
    const observationsByAgent = new Map<string, StoredAgentObservation[]>();
    for (const observation of this.store.currentAgentObservations()) {
      const agentId = this.universe.resolveAgentId(observation.nativeConversationRef);
      if (!agentId) continue;
      const list = observationsByAgent.get(agentId) ?? [];
      list.push(observation);
      observationsByAgent.set(agentId, list);
    }
    const agents: AgentEvidence[] = state.agents.flatMap((agent) => {
      if (!agent.harnessId) return [];
      const source = sources.get(agent.harnessId);
      const harness = this.harnesses
        .agentHarnesses()
        .find(({ harnessId }) => harnessId === agent.harnessId);
      if (!source && !harness?.observationSource) return [];
      return [
        {
          agentId: agent.id,
          harnessId: agent.harnessId,
          providerLabel: labels.get(agent.harnessId) ?? agent.harnessId,
          pluginId: source?.pluginId ?? "unknown-plugin",
          health:
            source?.health.state ??
            (harness?.observationSource?.describe().configured ? "unavailable" : "not-configured"),
          capturedAt: source?.capturedAt,
          kinds: source?.capability.kinds ?? harness?.observationSource?.describe().kinds ?? [],
          freshnessSeconds:
            source?.capability.freshnessSeconds ??
            harness?.observationSource?.describe().freshnessSeconds ??
            {},
          current: observationsByAgent.get(agent.id) ?? [],
        },
      ];
    });
    const checkpoint = this.store.observationCheckpoint();
    const transitions = this.store
      .agentObservationTransitions(checkpoint?.sequence ?? 0)
      .flatMap((transition) => {
        const agentId = this.universe.resolveAgentId(transition.observation.nativeConversationRef);
        return agentId ? [{ ...transition, agentId }] : [];
      });
    const throughSequence = transitions.reduce(
      (sequence, item) => Math.max(sequence, item.sequence),
      checkpoint?.sequence ?? 0,
    );
    return { generatedAt, throughSequence, agents, transitions, checkpoint };
  }

  acknowledge(throughSequence: number, at: number): number {
    const sequence = this.store.acknowledgeAgentObservations(throughSequence, at);
    this.events?.publish([
      {
        type: "catch-up-changed",
        cause: "provider-observation",
        occurredAt: at,
      },
    ]);
    return sequence;
  }
}
