import { Effect, Either } from "effect";
import type { AgentHarness } from "../plugin-sdk/index.ts";
import type { HostAgentObservation, HostSnapshot } from "../hosts/types.ts";
import type { ReconciliationResult, Universe } from "../universe/universe.ts";
import type { NativeConversationRef } from "../universe/types.ts";
import type {
  AddedConversation,
  ConversationCatalogueStore,
  ConversationHistoryView,
  ConversationRefreshResult,
  ConversationTrackerModule,
  StoredConversation,
} from "./types.ts";

const referenceKey = (reference: NativeConversationRef): string =>
  `${reference.harnessId}\u0000${reference.continuityScopeId ?? "legacy"}\u0000${reference.kind}\u0000${reference.value}`;

const boundedText = (value: string | undefined, fallback: string): string => {
  const normalized = value?.replaceAll(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};

const HISTORY_ITEMS_PER_HARNESS = 50;

export class ConversationTracker implements ConversationTrackerModule {
  private lastHostSnapshot: HostSnapshot | undefined;

  constructor(
    private readonly harnesses: {
      agentHarnesses(): readonly AgentHarness[];
      agentHarness(harnessId: string): AgentHarness | undefined;
    },
    private readonly store: ConversationCatalogueStore,
    private readonly universe: Universe,
  ) {}

  refresh(): Effect.Effect<ConversationRefreshResult> {
    return Effect.gen(this, function* () {
      const configuredHarnesses = this.harnesses.agentHarnesses();
      const results = yield* Effect.forEach(
        configuredHarnesses,
        (harness) => Effect.either(harness.snapshotSessions()),
        { concurrency: "unbounded" },
      );
      const diagnostics: string[] = [];
      let observedProviders = 0;
      let discoveredConversations = 0;
      let admittedConversations = 0;
      for (const [index, result] of results.entries()) {
        if (Either.isLeft(result)) {
          diagnostics.push(result.left.message);
          const harness = configuredHarnesses[index];
          if (harness)
            this.universe.observe({ kind: "provider-unavailable", harnessId: harness.harnessId });
          continue;
        }
        observedProviders += 1;
        discoveredConversations += result.right.sessions.length;
        diagnostics.push(...result.right.diagnostics);
        const ingestion = this.store.reconcileProviderCatalogue(result.right);
        this.universe.observe({
          kind: "provider-catalogue",
          harnessId: result.right.harnessId,
          continuityScopeId: result.right.continuityScopeId,
          observedAt: result.right.observedAt,
          complete: result.right.complete,
          sessions: result.right.sessions.map((session) => ({
            nativeConversationRef: session.nativeConversationRef,
            nativeConversationAliases: session.nativeConversationAliases,
            observedAt: result.right.observedAt,
            resumeEligibility: session.resumeEligibility,
            title: session.title,
            workspaceRef: session.workspaceRef,
          })),
        });
        if (this.lastHostSnapshot) this.observeHost(this.lastHostSnapshot);
        for (const handle of ingestion.newlyObservedHandles) {
          this.add(handle);
          admittedConversations += 1;
        }
      }
      return {
        observedProviders,
        discoveredConversations,
        admittedConversations,
        diagnostics,
      };
    });
  }

  history(): readonly ConversationHistoryView[] {
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
    const grouped = new Map<string, ConversationHistoryView[]>();
    for (const session of this.store
      .conversations()
      .filter((candidate) => !accepted.has(referenceKey(candidate.nativeConversationRef)))
      .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0))) {
      const view = this.toView(session, labels.get(session.nativeConversationRef.harnessId));
      const conversations = grouped.get(view.harnessId) ?? [];
      if (conversations.length < HISTORY_ITEMS_PER_HARNESS) conversations.push(view);
      grouped.set(view.harnessId, conversations);
    }
    return [...grouped.values()]
      .flat()
      .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0));
  }

  add(handle: string, goalId?: string): AddedConversation {
    const session = this.store.conversation(handle.trim());
    if (!session) throw new Error("Provider conversation not found.");
    const label =
      this.harnesses.agentHarness(session.nativeConversationRef.harnessId)?.describe().label ??
      session.nativeConversationRef.harnessId;
    const result = this.universe.execute({
      type: "AddConversation",
      harnessId: session.nativeConversationRef.harnessId,
      nativeConversationRef: session.nativeConversationRef,
      displayName: boundedText(session.title, `${label} conversation`),
      workspaceRef: session.workspaceRef,
      observedAt: session.observedAt,
      goalId,
    });
    if (!result.ok || !result.agentId)
      throw new Error(result.error ?? "Provider conversation could not be added.");
    if (this.lastHostSnapshot) this.observeHost(this.lastHostSnapshot);
    return { agentId: result.agentId, goalId: result.goalId };
  }

  observeHost(snapshot: HostSnapshot): ReconciliationResult {
    this.lastHostSnapshot = snapshot;
    const sessions = this.store.conversations();
    const agents = snapshot.agents.map((observation) =>
      this.canonicalObservation(observation, sessions),
    );
    const result = this.universe.observe({
      kind: "host-executions",
      snapshot: { ...snapshot, agents },
    });
    if (result.accepted) this.refreshAcceptedProviderFacts(sessions);
    return result;
  }

  private refreshAcceptedProviderFacts(sessions: readonly StoredConversation[]): void {
    const grouped = new Map<string, StoredConversation[]>();
    for (const session of sessions) {
      const reference = session.nativeConversationRef;
      const scope = reference.continuityScopeId;
      if (!scope) continue;
      const key = `${reference.harnessId}\u0000${scope}`;
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    for (const conversations of grouped.values()) {
      const first = conversations[0]!;
      const reference = first.nativeConversationRef;
      this.universe.observe({
        kind: "provider-catalogue",
        harnessId: reference.harnessId,
        continuityScopeId: reference.continuityScopeId!,
        observedAt: Math.max(...conversations.map((conversation) => conversation.observedAt)),
        complete: false,
        sessions: conversations.map((conversation) => ({
          nativeConversationRef: conversation.nativeConversationRef,
          nativeConversationAliases: conversation.nativeConversationAliases,
          observedAt: conversation.observedAt,
          resumeEligibility: conversation.resumeEligibility,
          title: conversation.title,
          workspaceRef: conversation.workspaceRef,
        })),
      });
    }
  }

  private canonicalObservation(
    observation: HostAgentObservation,
    sessions: readonly StoredConversation[],
  ): HostAgentObservation {
    const reference = observation.harnessEvidence?.nativeConversationRef;
    if (!reference) return observation;
    const matches = sessions.filter((session) =>
      [session.nativeConversationRef, ...session.nativeConversationAliases].some(
        (candidate) =>
          candidate.harnessId === reference.harnessId &&
          candidate.kind === reference.kind &&
          candidate.value === reference.value &&
          (!reference.continuityScopeId ||
            candidate.continuityScopeId === reference.continuityScopeId),
      ),
    );
    if (matches.length !== 1) return observation;
    return {
      ...observation,
      harnessEvidence: {
        ...observation.harnessEvidence,
        nativeConversationRef: matches[0]!.nativeConversationRef,
      },
    };
  }

  private toView(session: StoredConversation, label?: string): ConversationHistoryView {
    const providerLabel = boundedText(label, session.nativeConversationRef.harnessId);
    return {
      handle: session.handle,
      harnessId: session.nativeConversationRef.harnessId,
      providerLabel,
      title: boundedText(session.title, `${providerLabel} conversation`),
      workspaceRef: session.workspaceRef,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      resumeEligibility: session.resumeEligibility,
      provenance: session.provenance,
      runtimeState: this.lastHostSnapshot?.available ? "dormant" : "runtime-unknown",
    };
  }
}
