import { useEffect, useMemo, useState } from "react";
import type { WebAgentRepositoryStatusResponse } from "../../src/web/protocol.ts";
import { fetchAgentRepositoryStatus } from "./api.ts";

export type RepositoryEvidenceState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly snapshot: WebAgentRepositoryStatusResponse }
  | { readonly state: "unavailable"; readonly message: string };

type RepositoryStatusFetcher = (
  agentId: string,
  options: { readonly signal: AbortSignal },
) => Promise<WebAgentRepositoryStatusResponse>;

interface PendingEvidence {
  readonly controller: AbortController;
}

export class CloseoutRepositoryEvidenceLoader {
  private readonly evidence = new Map<string, RepositoryEvidenceState>();
  private readonly pending = new Map<string, PendingEvidence>();
  private desired = new Set<string>();
  private queue: string[] = [];
  private active = 0;
  private disposed = false;

  constructor(
    private readonly fetchStatus: RepositoryStatusFetcher,
    private readonly onChange: () => void,
    private readonly concurrency = 4,
  ) {}

  setAgentIds(agentIds: readonly string[]): void {
    const desired = new Set(agentIds);
    this.desired = desired;
    this.queue = this.queue.filter((agentId) => desired.has(agentId));
    for (const [agentId, request] of this.pending) {
      if (!desired.has(agentId)) request.controller.abort();
    }
    for (const agentId of this.evidence.keys()) {
      if (!desired.has(agentId)) this.evidence.delete(agentId);
    }
    for (const agentId of desired) {
      if (this.evidence.has(agentId)) continue;
      this.evidence.set(agentId, { state: "loading" });
      this.queue.push(agentId);
    }
    this.onChange();
    this.pump();
  }

  statuses(): ReadonlyMap<string, RepositoryEvidenceState> {
    return this.evidence;
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
  }

  private pump(): void {
    while (!this.disposed && this.active < this.concurrency) {
      const agentId = this.queue.shift();
      if (!agentId) return;
      if (!this.desired.has(agentId) || this.pending.has(agentId)) continue;
      const controller = new AbortController();
      const request = { controller };
      this.pending.set(agentId, request);
      this.active += 1;
      void this.fetchStatus(agentId, { signal: controller.signal })
        .then((snapshot) => {
          if (!controller.signal.aborted && this.desired.has(agentId))
            this.evidence.set(agentId, { state: "ready", snapshot });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted && this.desired.has(agentId))
            this.evidence.set(agentId, {
              state: "unavailable",
              message:
                cause instanceof Error ? cause.message : "Repository evidence is unavailable.",
            });
        })
        .finally(() => {
          if (this.pending.get(agentId) === request) this.pending.delete(agentId);
          this.active -= 1;
          if (!controller.signal.aborted && this.desired.has(agentId)) this.onChange();
          this.pump();
        });
    }
  }
}

export const useCloseoutRepositoryEvidence = (
  agentIds: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, RepositoryEvidenceState> => {
  const [, setRevision] = useState(0);
  const loader = useMemo(
    () =>
      new CloseoutRepositoryEvidenceLoader(
        (agentId, { signal }) => fetchAgentRepositoryStatus(agentId, { signal }),
        () => setRevision((value) => value + 1),
      ),
    [],
  );
  const membership = enabled ? agentIds.join("\u0000") : "";

  useEffect(() => {
    loader.setAgentIds(enabled ? agentIds : []);
  }, [enabled, loader, membership]);
  useEffect(() => () => loader.dispose(), [loader]);

  return loader.statuses();
};
