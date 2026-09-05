import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentHarness } from "../plugin-sdk/index.ts";
import { ProviderObservationIngress } from "./ingress.ts";
import type { AgentObservationModule } from "./types.ts";

const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

interface TestIngressBody {
  readonly harnessId: string;
  readonly input: Readonly<Record<string, string>>;
}

const request = (authToken: string, body: TestIngressBody, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:4310/api/provider-observations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const harness = (received: unknown[]): AgentHarness => ({
  harnessId: "codex",
  observationReceiver: {
    receive: (input) => {
      received.push(input);
      return Effect.succeed(1);
    },
  },
  describe: () => ({ harnessId: "codex", label: "Codex" }),
  availability: () => Effect.succeed({ available: true, message: "available" }),
  snapshotSessions: () =>
    Effect.succeed({
      harnessId: "codex",
      providerInstanceId: "codex-test",
      continuityScopeId: "scope-test",
      observedAt: 1,
      complete: true,
      sessions: [],
      diagnostics: [],
    }),
  planStart: () => Effect.succeed({ harnessId: "codex", executable: "codex", args: [] }),
  planResume: () => Effect.succeed({ harnessId: "codex", executable: "codex", args: [] }),
  proveContinuity: () => Effect.succeed({ kind: "unknown", reason: "test" }),
});

const observations = (refreshes: { count: number }): AgentObservationModule => ({
  refresh: () => {
    refreshes.count += 1;
    return Effect.succeed({ observedSources: 1, diagnostics: [] });
  },
  snapshot: () => ({ generatedAt: 1, throughSequence: 0, agents: [], transitions: [] }),
  acknowledge: () => 0,
});

describe("provider observation ingress", () => {
  test("authenticates, dispatches through the harness receiver and refreshes evidence", async () => {
    const received: unknown[] = [];
    const refreshes = { count: 0 };
    const provider = harness(received);
    const ingress = new ProviderObservationIngress(
      token,
      { agentHarness: (id) => (id === "codex" ? provider : undefined) },
      observations(refreshes),
    );
    const response = await ingress.fetch(
      request(token, { harnessId: "codex", input: { type: "SessionStart" } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1 });
    expect(received).toEqual([{ type: "SessionStart" }]);
    expect(refreshes.count).toBe(1);
  });

  test("rejects unauthenticated, malformed, oversized and unknown-source requests", async () => {
    const ingress = new ProviderObservationIngress(
      token,
      { agentHarness: () => undefined },
      observations({ count: 0 }),
    );
    expect(
      (
        await ingress.fetch(
          request("wrong", { harnessId: "codex", input: { type: "SessionStart" } }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await ingress.fetch(
          new Request("http://127.0.0.1:4310/api/provider-observations", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: "not-json",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await ingress.fetch(
          request(token, { harnessId: "codex", input: {} }, { "content-length": "999999" }),
        )
      ).status,
    ).toBe(413);
    expect((await ingress.fetch(request(token, { harnessId: "unknown", input: {} }))).status).toBe(
      404,
    );
  });
});
