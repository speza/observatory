import { describe, expect, test } from "bun:test";
import type { WebAgentRepositoryStatusResponse } from "../../src/web/protocol.ts";
import { CloseoutRepositoryEvidenceLoader } from "./closeoutRepositoryEvidence.ts";

const snapshot = (agentId: string): WebAgentRepositoryStatusResponse => ({
  kind: "agent-repository-status",
  agentId,
  status: "complete",
  observedAt: 1,
  diagnostics: ["No pull request found for this repository and branch."],
  pullRequests: [],
  providerCached: false,
  plugins: [],
});

describe("Closeout repository evidence loader", () => {
  test("bounds a 75-Agent portfolio and reuses loaded evidence", async () => {
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    const releases: (() => void)[] = [];
    const loader = new CloseoutRepositoryEvidenceLoader(
      async (agentId) => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return snapshot(agentId);
      },
      () => {},
      4,
    );
    const agentIds = Array.from({ length: 75 }, (_, index) => `agent-${index + 1}`);

    loader.setAgentIds(agentIds);
    expect(calls).toBe(4);
    const releaseAll = async (): Promise<void> => {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      if (releases.length > 0 || calls < agentIds.length) await releaseAll();
    };
    await releaseAll();
    await Promise.resolve();
    expect(calls).toBe(75);
    expect(maximumActive).toBe(4);
    expect([...loader.statuses().values()].every((item) => item.state === "ready")).toBe(true);

    loader.setAgentIds(agentIds);
    expect(calls).toBe(75);
    loader.dispose();
  });

  test("cancels removed Agents and ignores stale responses", async () => {
    let resolveRequest: ((value: WebAgentRepositoryStatusResponse) => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const loader = new CloseoutRepositoryEvidenceLoader(
      (agentId, { signal }) => {
        observedSignal = signal;
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
      () => {},
      1,
    );

    loader.setAgentIds(["removed"]);
    loader.setAgentIds([]);
    resolveRequest?.(snapshot("removed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(observedSignal?.aborted).toBe(true);
    expect(loader.statuses().has("removed")).toBe(false);
    loader.dispose();
  });
});
