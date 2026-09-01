import type { Effect } from "effect";
import type {
  AgentObservation,
  AgentObservationCapability,
  AgentObservationKind,
  AgentObservationSnapshot,
} from "../plugin-sdk/index.ts";

export type StoredAgentObservation = AgentObservation & { readonly receivedAt: number };

export interface StoredObservationSource {
  readonly pluginId: string;
  readonly harnessId: string;
  readonly providerInstanceId: string;
  readonly continuityScopeId: string;
  readonly capability: AgentObservationCapability;
  readonly health: AgentObservationSnapshot["health"];
  readonly cursor?: string;
  readonly capturedAt: number;
}

export interface AgentObservationStore {
  observationSource(harnessId: string): StoredObservationSource | undefined;
  reconcileAgentObservations(
    snapshot: AgentObservationSnapshot,
    capability: AgentObservationCapability,
    receivedAt: number,
    pluginId: string,
  ): void;
  markObservationSourceUnavailable(
    harnessId: string,
    capability: AgentObservationCapability,
    observedAt: number,
    diagnostic: string,
    pluginId: string,
  ): void;
  agentObservationSources(): readonly StoredObservationSource[];
  currentAgentObservations(): readonly StoredAgentObservation[];
  agentObservationTransitions(afterSequence: number): readonly AgentEvidenceTransition[];
  observationCheckpoint():
    | { readonly sequence: number; readonly acknowledgedAt: number }
    | undefined;
  acknowledgeAgentObservations(at: number): number;
}

export interface AgentEvidenceTransition {
  readonly sequence: number;
  readonly observation: StoredAgentObservation;
}

export interface AgentEvidence {
  readonly agentId: string;
  readonly harnessId: string;
  readonly providerLabel: string;
  readonly pluginId: string;
  readonly health: StoredObservationSource["health"]["state"];
  readonly capturedAt?: number;
  readonly kinds: readonly AgentObservationKind[];
  readonly freshnessSeconds: Partial<Record<AgentObservationKind, number>>;
  readonly current: readonly StoredAgentObservation[];
}

export interface AgentEvidenceSnapshot {
  readonly generatedAt: number;
  readonly agents: readonly AgentEvidence[];
  readonly transitions: readonly (AgentEvidenceTransition & { readonly agentId: string })[];
  readonly checkpoint?: { readonly sequence: number; readonly acknowledgedAt: number };
}

export interface AgentObservationModule {
  refresh(): Effect.Effect<{
    readonly observedSources: number;
    readonly diagnostics: readonly string[];
  }>;
  snapshot(): AgentEvidenceSnapshot;
  acknowledge(at: number): number;
}
