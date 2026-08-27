import type { Effect } from "effect";
import type { HostError } from "../hosts/errors.ts";

export type AgentCloseoutStatus =
  | "closed-and-archived"
  | "already-ended-and-archived"
  | "already-archived"
  | "unsupported"
  | "rejected";

export interface AgentCloseoutResult {
  readonly ok: boolean;
  readonly agentId: string;
  readonly status: AgentCloseoutStatus;
  readonly message: string;
}

export interface AgentCloseoutBatchResult {
  readonly ok: boolean;
  readonly results: readonly AgentCloseoutResult[];
  readonly message: string;
}

export interface AgentCloseoutCoordinator {
  closeAndArchive(agentId: string): Effect.Effect<AgentCloseoutResult, HostError>;
  closeAndArchiveMany(
    agentIds: readonly string[],
  ): Effect.Effect<AgentCloseoutBatchResult, HostError>;
}
