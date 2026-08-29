import type { Effect } from "effect";
import type { HostSnapshot, HostAgentObservation } from "../hosts/types.ts";
import type { ReconciliationResult } from "../universe/universe.ts";
import type {
  OpaqueNativeConversationRef,
  ProviderSessionProvenance,
  ProviderSessionSnapshot,
} from "../plugin-sdk/index.ts";

export interface StoredProviderSession {
  readonly handle: string;
  readonly nativeConversationRef: OpaqueNativeConversationRef;
  readonly nativeConversationAliases: readonly OpaqueNativeConversationRef[];
  readonly providerInstanceId: string;
  readonly homeSiteRef?: string;
  readonly createdAt?: number;
  readonly lastActiveAt?: number;
  readonly title?: string;
  readonly workspaceRef?: string;
  readonly resumeEligibility: "same-site" | "provider-account" | "blocked" | "unknown";
  readonly provenance: ProviderSessionProvenance;
  readonly observedAt: number;
}

export interface RecoveredSessionView {
  readonly handle: string;
  readonly harnessId: string;
  readonly providerLabel: string;
  readonly title: string;
  readonly workspaceRef?: string;
  readonly createdAt?: number;
  readonly lastActiveAt?: number;
  readonly resumeEligibility: StoredProviderSession["resumeEligibility"];
  readonly provenance: ProviderSessionProvenance;
  readonly executionState: "exact-live" | "possibly-live" | "absent" | "unknown";
}

export interface ProviderSessionRefreshResult {
  readonly observedProviders: number;
  readonly discoveredSessions: number;
  readonly diagnostics: readonly string[];
}

export interface TrackedProviderSession {
  readonly agentId: string;
  readonly goalId?: string;
}

export interface ProviderSessionStore {
  reconcileProviderSessions(snapshot: ProviderSessionSnapshot): void;
  providerSessions(): readonly StoredProviderSession[];
  providerSession(handle: string): StoredProviderSession | undefined;
}

export interface ProviderSessionRecoveryModule {
  refresh(): Effect.Effect<ProviderSessionRefreshResult>;
  candidates(): readonly RecoveredSessionView[];
  track(handle: string, goalId?: string): TrackedProviderSession;
  reconcileHost(snapshot: HostSnapshot): ReconciliationResult;
  observedExecution(handle: string): HostAgentObservation | undefined;
}
