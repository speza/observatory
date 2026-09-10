import { Effect, Either } from "effect";
import type { AgentHarness, AgentHarnessSnapshotRequest } from "../plugin-sdk/index.ts";
import type { HostAgentObservation, HostSnapshot } from "../hosts/types.ts";
import type { HostExecutionKey, ReconciliationResult, Universe } from "../universe/universe.ts";
import type {
  AddedConversation,
  AdmittedDiscoveredExecution,
  ConversationCatalogueStore,
  ConversationHistoryView,
  ConversationRefreshResult,
  ConversationTrackerModule,
  StoredConversation,
} from "./types.ts";

const boundedText = (value: string | undefined, fallback: string): string => {
  const normalized = value?.replaceAll(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};

const HISTORY_ITEMS_PER_HARNESS = 50;

export class ConversationTracker implements ConversationTrackerModule {
  private lastHostSnapshot: HostSnapshot | undefined;
  private readonly refreshSemaphore = Effect.unsafeMakeSemaphore(1);

  constructor(
    private readonly harnesses: {
      agentHarnesses(): readonly AgentHarness[];
      agentHarness(harnessId: string): AgentHarness | undefined;
    },
    private readonly store: ConversationCatalogueStore,
    private readonly universe: Universe,
    private readonly configuredWorkspaceRefs: readonly string[] = [],
    private readonly pendingExecutionKeys?: () => readonly HostExecutionKey[],
  ) {}

  refresh(): Effect.Effect<ConversationRefreshResult> {
    const operation = Effect.gen(this, function* () {
      const configuredHarnesses = this.harnesses.agentHarnesses();
      const snapshotRequest = this.snapshotRequest();
      const results = yield* Effect.forEach(
        configuredHarnesses,
        (harness) => Effect.either(harness.snapshotSessions(snapshotRequest)),
        { concurrency: "unbounded" },
      );
      const diagnostics: string[] = [];
      let observedProviders = 0;
      let discoveredConversations = 0;
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
        if (!ingestion.accepted) {
          if (ingestion.diagnostic) diagnostics.push(ingestion.diagnostic);
          continue;
        }
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
      }
      return {
        observedProviders,
        discoveredConversations,
        diagnostics,
      };
    });
    return this.refreshSemaphore.withPermits(1)(operation);
  }

  private snapshotRequest(): AgentHarnessSnapshotRequest | undefined {
    const workspaceRefs = [
      ...this.configuredWorkspaceRefs,
      ...(this.lastHostSnapshot?.agents.map((agent) => agent.worktree) ?? []),
      ...this.universe.snapshot().agents.map((agent) => agent.worktree),
      ...this.store.conversations().map((conversation) => conversation.workspaceRef),
    ].filter((value): value is string => Boolean(value));
    const uniqueWorkspaceRefs = [...new Set(workspaceRefs)];
    return uniqueWorkspaceRefs.length ? { workspaceRefs: uniqueWorkspaceRefs } : undefined;
  }

  history(): readonly ConversationHistoryView[] {
    const labels = new Map(
      this.harnesses
        .agentHarnesses()
        .map((harness) => [harness.harnessId, harness.describe().label] as const),
    );
    const grouped = new Map<string, ConversationHistoryView[]>();
    for (const session of this.store
      .conversations()
      .filter(
        (candidate) => this.universe.resolveAgentId(candidate.nativeConversationRef) === undefined,
      )
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
      admissionSource: "provider-catalogue",
      resumeEligibility: session.resumeEligibility,
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

  admitDiscovered(handle: string, goalId?: string): AdmittedDiscoveredExecution {
    const normalizedHandle = handle.trim();
    const discovery = this.universe.resolveDiscoveredExecution(normalizedHandle);
    const previouslyAdmitted = discovery
      ? undefined
      : this.universe.resolveAdmittedDiscoveredExecution(normalizedHandle);
    if (previouslyAdmitted) {
      let assignedGoalId: string | undefined;
      let partial = false;
      let message = "Execution was already added to Observatory.";
      if (goalId) {
        const assigned = this.universe.execute({
          type: "AssignAgent",
          agentId: previouslyAdmitted.agentId,
          goalId,
        });
        if (!assigned.ok) {
          partial = true;
          message = `Execution was already added to Observatory, but Goal assignment failed: ${assigned.error ?? "unknown error"}`;
        } else {
          assignedGoalId = assigned.goalId;
          message = "Execution was already added to Observatory and assigned to the Goal.";
        }
      }
      const admittedAgentId = previouslyAdmitted.agentId;
      if (partial)
        return { agentId: admittedAgentId, goalId: assignedGoalId, message, partial: true };
      return { agentId: admittedAgentId, goalId: assignedGoalId, message };
    }
    if (!discovery) throw new Error("Discovered execution is no longer visible.");
    const reference = discovery.nativeConversationRef;
    if (!reference?.continuityScopeId)
      throw new Error("Conversation identity is not identified; refresh the provider catalogue.");
    const matches = this.store
      .conversations()
      .filter((session) =>
        [session.nativeConversationRef, ...session.nativeConversationAliases].some(
          (candidate) =>
            candidate.harnessId === reference.harnessId &&
            candidate.continuityScopeId === reference.continuityScopeId &&
            candidate.kind === reference.kind &&
            candidate.value === reference.value,
        ),
      );
    if (matches.length !== 1)
      throw new Error(
        matches.length === 0
          ? "Exact catalogue evidence is not available; refresh the provider catalogue before adding this execution."
          : "Admission identity is ambiguous; refresh the provider catalogue before adding this execution.",
      );
    const session = matches[0]!;
    const label =
      this.harnesses.agentHarness(session.nativeConversationRef.harnessId)?.describe().label ??
      session.nativeConversationRef.harnessId;
    const admitted = this.universe.execute({
      type: "AddConversation",
      admissionSource: "provider-catalogue",
      resumeEligibility: session.resumeEligibility,
      harnessId: session.nativeConversationRef.harnessId,
      nativeConversationRef: session.nativeConversationRef,
      displayName: boundedText(session.title, `${label} conversation`),
      workspaceRef: session.workspaceRef,
      observedAt: session.observedAt,
    });
    if (!admitted.ok || !admitted.agentId)
      throw new Error(admitted.error ?? "Discovered execution could not be added.");

    let assignedGoalId: string | undefined;
    let partial = false;
    let message = "Execution added to Observatory.";
    if (goalId) {
      const assigned = this.universe.execute({
        type: "AssignAgent",
        agentId: admitted.agentId,
        goalId,
      });
      if (!assigned.ok) {
        partial = true;
        message = `Execution added to Observatory, but Goal assignment failed: ${assigned.error ?? "unknown error"}`;
      } else {
        assignedGoalId = assigned.goalId;
        message = "Execution added to Observatory and assigned to the Goal.";
      }
    }
    if (this.lastHostSnapshot) this.observeHost(this.lastHostSnapshot);
    if (partial)
      return {
        agentId: admitted.agentId,
        goalId: assignedGoalId,
        message,
        partial: true,
      };
    return { agentId: admitted.agentId, goalId: assignedGoalId, message };
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
      pendingExecutionKeys: this.pendingExecutionKeys?.() ?? [],
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
    const match = matches[0]!;
    if (!reference.continuityScopeId) {
      const primaryIdentityMatches = sessions.filter((session) => {
        const candidate = session.nativeConversationRef;
        return (
          candidate.harnessId === reference.harnessId &&
          candidate.kind === reference.kind &&
          candidate.value === reference.value
        );
      });
      const explicitlyAdmitted = this.universe.snapshot().agents.some((agent) => {
        const admitted = agent.nativeConversationRef;
        const candidate = match.nativeConversationRef;
        return (
          admitted !== undefined &&
          admitted.harnessId === candidate.harnessId &&
          admitted.kind === candidate.kind &&
          admitted.value === candidate.value &&
          admitted.continuityScopeId === candidate.continuityScopeId
        );
      });
      if (primaryIdentityMatches.length > 0 && !explicitlyAdmitted) return observation;
    }
    return {
      ...observation,
      harnessEvidence: {
        ...observation.harnessEvidence,
        nativeConversationRef: match.nativeConversationRef,
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
