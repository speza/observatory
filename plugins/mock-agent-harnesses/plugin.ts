import { Effect } from "effect";
import {
  HarnessError,
  type AgentHarness,
  type AgentObservation,
  type AgentObservationSourceV1,
  type ObservatoryPlugin,
} from "../../src/plugin-sdk/index.ts";

const continuityScopeId = "mock-provider-instance";

class MockObservationSource implements AgentObservationSourceV1 {
  readonly schemaVersion = 1 as const;

  constructor(
    private readonly harnessId: string,
    private readonly capturedAt: number,
    private readonly observations: readonly AgentObservation[],
    private readonly supported = true,
  ) {}

  describe() {
    return {
      kinds: this.supported
        ? (["activity", "human-input-request", "turn-outcome", "context-pressure"] as const)
        : [],
      acquisition: "metadata" as const,
      delivery: "retained-events-and-snapshot" as const,
      configured: this.supported,
      freshnessSeconds: this.supported
        ? { activity: 120, "human-input-request": 1_800, "turn-outcome": 86_400 }
        : {},
    };
  }

  snapshot(request: { readonly afterCursor?: string }) {
    return Effect.succeed({
      schemaVersion: 1 as const,
      harnessId: this.harnessId,
      providerInstanceId: `${this.harnessId}-instance`,
      continuityScopeId,
      capturedAt: this.capturedAt,
      complete: true,
      cursor: "1",
      current: this.observations,
      transitions: request.afterCursor ? [] : this.observations,
      health: {
        state: this.supported ? ("healthy" as const) : ("unsupported" as const),
        lastSuccessfulAt: this.supported ? this.capturedAt : undefined,
        diagnostics: this.supported ? [] : ["This synthetic provider has no observation source."],
      },
    });
  }
}

const source = (
  harnessId: string,
  observedAt: number,
  claims: readonly {
    readonly conversationId: string;
    readonly observation: Omit<
      AgentObservation,
      "schemaVersion" | "nativeConversationRef" | "providerInstanceId" | "observedAt" | "source"
    >;
  }[],
): MockObservationSource =>
  new MockObservationSource(
    harnessId,
    observedAt,
    claims.map(({ conversationId, observation }): AgentObservation => ({
      ...observation,
      schemaVersion: 1,
      nativeConversationRef: {
        harnessId,
        continuityScopeId,
        kind: "synthetic-conversation",
        value: conversationId,
      },
      providerInstanceId: `${harnessId}-instance`,
      observedAt,
      source: { mechanism: "metadata" },
    })),
  );

const harness = (
  harnessId: string,
  label: string,
  observedAt: number,
  observationSource: AgentObservationSourceV1,
): AgentHarness => ({
  harnessId,
  observationSource,
  describe: () => ({ harnessId, label, description: "Deterministic mock-only harness" }),
  availability: () =>
    Effect.succeed({ available: false, message: "Available only as mock observation evidence." }),
  snapshotSessions: () =>
    Effect.succeed({
      harnessId,
      providerInstanceId: `${harnessId}-instance`,
      continuityScopeId,
      observedAt,
      complete: true,
      sessions: [],
      diagnostics: [],
    }),
  planStart: () => Effect.fail(new HarnessError("plan-start", "Mock harness cannot launch.")),
  planResume: () => Effect.fail(new HarnessError("plan-resume", "Mock harness cannot resume.")),
  proveContinuity: () => Effect.succeed({ kind: "unknown", reason: "Mock-only harness." }),
});

export const plugin: ObservatoryPlugin = {
  activate: ({ now }) => {
    const observedAt = now();
    return {
      agentHarnesses: [
        harness(
          "claude-mock",
          "Claude Code (mock)",
          observedAt,
          source("claude-mock", observedAt, [
            {
              conversationId: "mock-p03",
              observation: {
                kind: "human-input-request",
                observationId: "permission-p03",
                payload: {
                  requestId: "permission-p03",
                  requestKind: "permission",
                  state: "open",
                  toolCategory: "execute",
                },
              },
            },
            {
              conversationId: "mock-p15",
              observation: {
                kind: "human-input-request",
                observationId: "question-p15",
                payload: {
                  requestId: "question-p15",
                  requestKind: "question",
                  state: "open",
                },
              },
            },
            {
              conversationId: "mock-p06",
              observation: {
                kind: "turn-outcome",
                observationId: "complete-p06",
                payload: { outcome: "response-completed", turnId: "turn-p06" },
              },
            },
          ]),
        ),
        harness(
          "codex-mock",
          "Codex (mock)",
          observedAt,
          source("codex-mock", observedAt, [
            {
              conversationId: "mock-p01",
              observation: {
                kind: "activity",
                observationId: "activity-p01",
                payload: { phase: "using-tool", toolCategory: "write" },
              },
            },
            {
              conversationId: "mock-p04",
              observation: {
                kind: "context-pressure",
                observationId: "context-p04",
                payload: { usedRatio: 0.92 },
              },
            },
            {
              conversationId: "mock-p19",
              observation: {
                kind: "turn-outcome",
                observationId: "complete-p19",
                payload: { outcome: "response-completed", turnId: "turn-p19" },
              },
            },
          ]),
        ),
        harness(
          "pi-mock",
          "Pi (mock)",
          observedAt,
          new MockObservationSource("pi-mock", observedAt, [], false),
        ),
      ],
    };
  },
};
