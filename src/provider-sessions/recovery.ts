import { Effect, Either } from "effect";
import type { AgentHarness } from "../plugin-sdk/index.ts";
import type { HostAgentObservation, HostSnapshot } from "../hosts/types.ts";
import type { Universe } from "../universe/universe.ts";
import type { NativeConversationRef } from "../universe/types.ts";
import { isPlausibleUnidentifiedExecution } from "../universe/execution-ambiguity.ts";
import type {
  ProviderSessionRecoveryModule,
  ProviderSessionRefreshResult,
  ProviderSessionStore,
  RecoveredSessionView,
  StoredProviderSession,
  TrackedProviderSession,
} from "./types.ts";

const referenceKey = (reference: NativeConversationRef): string =>
  `${reference.harnessId}\u0000${reference.continuityScopeId ?? "legacy"}\u0000${reference.kind}\u0000${reference.value}`;

const boundedText = (value: string | undefined, fallback: string): string => {
  const normalized = value?.replaceAll(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};

const RECOVERY_CANDIDATES_PER_HARNESS = 50;

export class ProviderSessionRecovery implements ProviderSessionRecoveryModule {
  private lastHostSnapshot: HostSnapshot | undefined;
  private readonly observedExecutions = new Map<string, HostAgentObservation>();
  constructor(
    private readonly harnesses: {
      agentHarnesses(): readonly AgentHarness[];
      agentHarness(harnessId: string): AgentHarness | undefined;
    },
    private readonly store: ProviderSessionStore,
    private readonly universe: Universe,
  ) {}

  refresh(): Effect.Effect<ProviderSessionRefreshResult> {
    return Effect.gen(this, function* () {
      const configuredHarnesses = this.harnesses.agentHarnesses();
      const results = yield* Effect.forEach(
        configuredHarnesses,
        (harness) => Effect.either(harness.snapshotSessions()),
        { concurrency: "unbounded" },
      );
      const diagnostics: string[] = [];
      let observedProviders = 0;
      let discoveredSessions = 0;
      for (const [index, result] of results.entries()) {
        if (Either.isLeft(result)) {
          diagnostics.push(result.left.message);
          const harness = configuredHarnesses[index];
          if (harness) this.universe.markProviderUnavailable(harness.harnessId);
          continue;
        }
        observedProviders += 1;
        discoveredSessions += result.right.sessions.length;
        diagnostics.push(...result.right.diagnostics);
        this.store.reconcileProviderSessions(result.right);
        this.universe.reconcileProviderSessions({
          harnessId: result.right.harnessId,
          continuityScopeId: result.right.continuityScopeId,
          observedAt: result.right.observedAt,
          complete: result.right.complete,
          sessions: result.right.sessions.map((session) => ({
            nativeConversationRef: session.nativeConversationRef,
            observedAt: result.right.observedAt,
            resumeEligibility: session.resumeEligibility,
          })),
        });
      }
      return { observedProviders, discoveredSessions, diagnostics };
    });
  }

  candidates(): readonly RecoveredSessionView[] {
    const accepted = new Set(
      this.universe
        .snapshot()
        .agents.flatMap((agent) =>
          agent.nativeConversationRef ? [referenceKey(agent.nativeConversationRef)] : [],
        ),
    );
    const labels = new Map(
      this.harnesses
        .agentHarnesses()
        .map((harness) => [harness.harnessId, harness.describe().label] as const),
    );
    const grouped = new Map<string, RecoveredSessionView[]>();
    for (const view of this.store
      .providerSessions()
      .filter((session) => !accepted.has(referenceKey(session.nativeConversationRef)))
      .map((session) => this.toView(session, labels.get(session.nativeConversationRef.harnessId)))
      .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0))) {
      const sessions = grouped.get(view.harnessId) ?? [];
      if (sessions.length < RECOVERY_CANDIDATES_PER_HARNESS) sessions.push(view);
      grouped.set(view.harnessId, sessions);
    }
    return [...grouped.values()]
      .flat()
      .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0));
  }

  track(handle: string, goalId?: string): TrackedProviderSession {
    const session = this.store.providerSession(handle.trim());
    if (!session) throw new Error("Recovered provider session not found.");
    const label =
      this.harnesses.agentHarness(session.nativeConversationRef.harnessId)?.describe().label ??
      session.nativeConversationRef.harnessId;
    const result = this.universe.execute({
      type: "AdoptProviderSession",
      harnessId: session.nativeConversationRef.harnessId,
      nativeConversationRef: session.nativeConversationRef,
      displayName: boundedText(session.title, `${label} session`),
      workspaceRef: session.workspaceRef,
      observedAt: session.observedAt,
      goalId,
    });
    if (!result.ok || !result.agentId)
      throw new Error(result.error ?? "Recovered provider session could not be tracked.");
    if (this.lastHostSnapshot) this.reconcileHost(this.lastHostSnapshot);
    return { agentId: result.agentId, goalId: result.goalId };
  }

  reconcileHost(snapshot: HostSnapshot) {
    this.lastHostSnapshot = snapshot;
    this.observedExecutions.clear();
    const sessions = this.store.providerSessions();
    const matchingSessions = (reference: NativeConversationRef): readonly StoredProviderSession[] =>
      sessions.filter((session) =>
        [session.nativeConversationRef, ...session.nativeConversationAliases].some(
          (candidate) =>
            candidate.harnessId === reference.harnessId &&
            candidate.kind === reference.kind &&
            candidate.value === reference.value &&
            (!reference.continuityScopeId ||
              candidate.continuityScopeId === reference.continuityScopeId),
        ),
      );
    for (const observation of snapshot.agents) {
      const reference = observation.harnessEvidence?.nativeConversationRef;
      if (!reference) continue;
      const matches = matchingSessions(reference);
      if (matches.length !== 1) continue;
      const session = matches[0]!;
      const canonicalKey = referenceKey(session.nativeConversationRef);
      const state = this.universe.snapshot();
      if (
        state.agents.some(
          (agent) =>
            agent.nativeConversationRef &&
            referenceKey(agent.nativeConversationRef) === canonicalKey,
        )
      )
        continue;
      const legacy = state.agents.find(
        (agent) =>
          agent.nativeConversationRef?.harnessId === reference.harnessId &&
          agent.nativeConversationRef.kind === reference.kind &&
          agent.nativeConversationRef.value === reference.value,
      );
      if (!legacy) continue;
      const bound = this.universe.execute({
        type: "BindAgentIdentity",
        agentId: legacy.id,
        harnessId: session.nativeConversationRef.harnessId,
        nativeConversationRef: session.nativeConversationRef,
      });
      if (bound.ok)
        this.universe.reconcileProviderSessions({
          harnessId: session.nativeConversationRef.harnessId,
          continuityScopeId: session.nativeConversationRef.continuityScopeId!,
          observedAt: session.observedAt,
          complete: false,
          sessions: [
            {
              nativeConversationRef: session.nativeConversationRef,
              observedAt: session.observedAt,
              resumeEligibility: session.resumeEligibility,
            },
          ],
        });
    }
    const accepted = new Set(
      this.universe
        .snapshot()
        .agents.flatMap((agent) =>
          agent.nativeConversationRef ? [referenceKey(agent.nativeConversationRef)] : [],
        ),
    );
    const agents = snapshot.agents.flatMap((observation) => {
      const reference = observation.harnessEvidence?.nativeConversationRef;
      if (!reference) return [observation];
      const matches = matchingSessions(reference);
      if (matches.length !== 1) return [observation];
      const session = matches[0]!;
      const canonical = session.nativeConversationRef;
      const scopedObservation = {
        ...observation,
        harnessEvidence: {
          ...observation.harnessEvidence,
          nativeConversationRef: canonical,
        },
      };
      if (!accepted.has(referenceKey(canonical))) {
        this.observedExecutions.set(session.handle, scopedObservation);
        return [];
      }
      return [scopedObservation];
    });
    return this.universe.reconcile({ ...snapshot, agents });
  }

  observedExecution(handle: string): HostAgentObservation | undefined {
    const observation = this.observedExecutions.get(handle);
    return observation ? structuredClone(observation) : undefined;
  }

  private toView(session: StoredProviderSession, label?: string): RecoveredSessionView {
    const providerLabel = boundedText(label, session.nativeConversationRef.harnessId);
    const executionState = this.observedExecutions.has(session.handle)
      ? ("exact-live" as const)
      : !this.lastHostSnapshot?.available
        ? ("unknown" as const)
        : this.lastHostSnapshot.agents.some((observation) =>
              isPlausibleUnidentifiedExecution(
                {
                  harnessId: session.nativeConversationRef.harnessId,
                  workspaceRef: session.workspaceRef,
                },
                observation,
              ),
            )
          ? ("possibly-live" as const)
          : ("absent" as const);
    return {
      handle: session.handle,
      harnessId: session.nativeConversationRef.harnessId,
      providerLabel,
      title: boundedText(session.title, `${providerLabel} session`),
      workspaceRef: session.workspaceRef,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      resumeEligibility: session.resumeEligibility,
      provenance: session.provenance,
      executionState,
    };
  }
}
