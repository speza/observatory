import type { Effect } from "effect";
import type { HostSnapshot } from "../hosts/types.ts";
import type { ReconciliationResult } from "../universe/universe.ts";
import type {
  OpaqueNativeConversationRef,
  ProviderSessionProvenance,
  ProviderSessionSnapshot,
} from "../plugin-sdk/index.ts";

export interface StoredConversation {
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

export interface ConversationCatalogueIngestion {
  readonly accepted: boolean;
  readonly diagnostic?: string;
}

export interface ConversationCatalogueStore {
  reconcileProviderCatalogue(snapshot: ProviderSessionSnapshot): ConversationCatalogueIngestion;
  conversations(): readonly StoredConversation[];
  conversation(handle: string): StoredConversation | undefined;
}

export interface ConversationHistoryView {
  readonly handle: string;
  readonly harnessId: string;
  readonly providerLabel: string;
  readonly title: string;
  readonly workspaceRef?: string;
  readonly createdAt?: number;
  readonly lastActiveAt?: number;
  readonly resumeEligibility: "same-site" | "provider-account" | "blocked" | "unknown";
  readonly provenance: ProviderSessionProvenance;
  readonly runtimeState: "dormant" | "runtime-unknown";
}

export interface ConversationRefreshResult {
  readonly observedProviders: number;
  readonly discoveredConversations: number;
  readonly diagnostics: readonly string[];
}

export interface AddedConversation {
  readonly agentId: string;
  readonly goalId?: string;
  readonly systemId?: string;
}

export interface AdmittedDiscoveredExecution extends AddedConversation {
  readonly message: string;
  readonly partial?: boolean;
}

/**
 * The single composition-level interface for conversation admission and
 * execution correlation. Recognized exact host observations may synchronize
 * identity-only Inbox Agents through this module; provider facts and runtime
 * absence never assign, rename, complete or archive them.
 */
export interface ConversationTrackerModule {
  refresh(): Effect.Effect<ConversationRefreshResult>;
  history(): readonly ConversationHistoryView[];
  add(handle: string, goalId?: string, systemId?: string): AddedConversation;
  readonly admitDiscovered?: (
    handle: string,
    goalId?: string,
    systemId?: string,
  ) => AdmittedDiscoveredExecution;
  observeHost(snapshot: HostSnapshot): ReconciliationResult;
}
