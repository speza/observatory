import { Effect } from "effect";
import { hasAgentCapability, type SessionHost } from "../hosts/types.ts";
import type { Universe } from "../universe/universe.ts";
import type {
  AgentCloseoutBatchResult,
  AgentCloseoutCoordinator,
  AgentCloseoutResult,
} from "./types.ts";

const uniqueIds = (agentIds: readonly string[]): string[] => [
  ...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean)),
];

const rejected = (agentId: string, message: string): AgentCloseoutResult => ({
  ok: false,
  agentId,
  status: "rejected",
  message,
});

export const createAgentCloseoutCoordinator = (dependencies: {
  readonly universe: Universe;
  readonly host: SessionHost;
}): AgentCloseoutCoordinator => {
  const closeAndArchive = (agentIdValue: string) =>
    Effect.gen(function* () {
      const agentId = agentIdValue.trim();
      if (!agentId) return rejected(agentId, "An Agent id is required.");

      const initial = dependencies.universe
        .snapshot()
        .agents.find((candidate) => candidate.id === agentId);
      if (!initial) return rejected(agentId, "Agent not found.");
      if (initial.archivedAt !== undefined)
        return {
          ok: true,
          agentId,
          status: "already-archived",
          message: `${initial.displayName} was already archived.`,
        } satisfies AgentCloseoutResult;

      const before = yield* dependencies.host.snapshot();
      if (!before.available)
        return rejected(
          agentId,
          before.error ?? "The session host is unavailable; Agent lifecycle is uncertain.",
        );
      const beforeReconciliation = dependencies.universe.reconcile(before);
      if (!beforeReconciliation.accepted)
        return rejected(
          agentId,
          beforeReconciliation.error ?? "The fresh host observation was rejected.",
        );

      const current = dependencies.universe
        .snapshot()
        .agents.find((candidate) => candidate.id === agentId);
      if (!current) return rejected(agentId, "Agent no longer exists.");
      if (current.archivedAt !== undefined)
        return {
          ok: true,
          agentId,
          status: "already-archived",
          message: `${current.displayName} was already archived.`,
        } satisfies AgentCloseoutResult;

      if (current.hostHealth === "stale") {
        const archive = dependencies.universe.execute({ type: "ArchiveAgent", agentId });
        return archive.ok
          ? ({
              ok: true,
              agentId,
              status: "already-ended-and-archived",
              message: `${current.displayName} had already ended in the host and is now archived.`,
            } satisfies AgentCloseoutResult)
          : rejected(agentId, archive.error ?? "The stale Agent could not be archived.");
      }
      if (current.hostHealth !== "live")
        return rejected(agentId, "The Agent host state is uncertain; no execution was closed.");

      const access = yield* dependencies.host.access({
        hostKind: current.hostKind,
        nativeId: current.nativeId,
      });
      if (!hasAgentCapability(access, "close-agent"))
        return {
          ok: false,
          agentId,
          status: "unsupported",
          message: access.explanation || "This Agent host does not support safe close.",
        } satisfies AgentCloseoutResult;

      const closed = yield* dependencies.host.closeAgent(access);
      if (!closed.ok) return rejected(agentId, closed.message);

      const after = yield* dependencies.host.snapshot();
      if (!after.available)
        return rejected(
          agentId,
          `${closed.message} Observatory could not confirm the resulting host state.`,
        );
      const afterReconciliation = dependencies.universe.reconcile(after);
      if (!afterReconciliation.accepted)
        return rejected(
          agentId,
          `${closed.message} ${afterReconciliation.error ?? "The resulting host observation was rejected."}`,
        );
      const ended = dependencies.universe
        .snapshot()
        .agents.find((candidate) => candidate.id === agentId);
      if (!ended) return rejected(agentId, `${closed.message} Agent record no longer exists.`);
      if (ended.hostHealth === "live")
        return rejected(agentId, `${closed.message} The host still reports the Agent as live.`);

      const archive = dependencies.universe.execute({ type: "ArchiveAgent", agentId });
      return archive.ok
        ? ({
            ok: true,
            agentId,
            status: "closed-and-archived",
            message: `${current.displayName} was closed in the host and archived in Observatory.`,
          } satisfies AgentCloseoutResult)
        : rejected(
            agentId,
            `${closed.message} ${archive.error ?? "The Agent could not be archived."}`,
          );
    });

  return {
    closeAndArchive,
    closeAndArchiveMany: (agentIds) =>
      Effect.gen(function* () {
        const ids = uniqueIds(agentIds);
        if (ids.length === 0)
          return {
            ok: false,
            results: [],
            message: "At least one Agent is required.",
          } satisfies AgentCloseoutBatchResult;
        const results = yield* Effect.forEach(ids, closeAndArchive, { concurrency: 1 });
        const succeeded = results.filter((result) => result.ok).length;
        return {
          ok: succeeded === results.length,
          results,
          message: `${succeeded} of ${results.length} Agents closed and archived.`,
        } satisfies AgentCloseoutBatchResult;
      }),
  };
};
