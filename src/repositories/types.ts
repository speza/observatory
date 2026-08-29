import type { Effect } from "effect";
import type { PullRequestStatus, RepositoryIdentity } from "../plugin-sdk/index.ts";
import type { WorkspaceDiffSnapshot } from "../workspaces/types.ts";

export type RepositoryStatus = "complete" | "partial" | "unavailable" | "not-applicable";

export interface LocalGitStatus {
  readonly worktree: string;
  readonly repository: RepositoryIdentity;
  readonly branch?: string;
  readonly head: string;
  readonly detached: boolean;
  readonly upstream?: string;
  readonly ahead?: number;
  readonly behind?: number;
  readonly diff: WorkspaceDiffSnapshot;
}

export interface AssociatedPullRequest extends PullRequestStatus {
  readonly association: "confirmed" | "candidate" | "ambiguous";
  readonly headSync: "current" | "local-ahead" | "different" | "unknown";
}

export interface AgentRepositoryStatusSnapshot {
  readonly kind: "agent-repository-status";
  readonly agentId: string;
  readonly status: RepositoryStatus;
  readonly observedAt: number;
  readonly diagnostics: readonly string[];
  readonly git?: LocalGitStatus;
  readonly pullRequests: readonly AssociatedPullRequest[];
  readonly provider?: string;
  readonly providerCached: boolean;
  readonly plugins: readonly {
    readonly id: string;
    readonly state: "ready" | "degraded" | "disabled";
    readonly diagnostics: readonly string[];
  }[];
}

export class RepositoryStatusError extends Error {
  readonly _tag = "RepositoryStatusError" as const;

  constructor(
    readonly kind: "agent-not-found" | "inspection-failed",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryStatusError";
  }
}

export interface AgentRepositoryStatusReader {
  inspect(
    agentId: string,
    options?: { readonly freshness?: "cached" | "refresh" },
  ): Effect.Effect<AgentRepositoryStatusSnapshot, RepositoryStatusError>;
}
