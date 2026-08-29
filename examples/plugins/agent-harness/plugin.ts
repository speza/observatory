import { Effect } from "effect";
import type { AgentHarness, ObservatoryPlugin } from "../../../src/plugin-sdk/index.ts";

const harness: AgentHarness = {
  harnessId: "example-agent",
  describe: () => ({ harnessId: "example-agent", label: "Example Agent" }),
  availability: () => Effect.succeed({ available: true, message: "Example Agent is available." }),
  snapshotSessions: () =>
    Effect.succeed({
      harnessId: "example-agent",
      providerInstanceId: "example-local",
      continuityScopeId: "example-scope",
      observedAt: Date.now(),
      complete: true,
      sessions: [],
      diagnostics: [],
    }),
  planStart: ({ prompt }) =>
    Effect.succeed({
      harnessId: "example-agent",
      executable: "example-agent",
      args: prompt ? ["start", "--prompt", prompt] : ["start"],
    }),
  planResume: ({ nativeConversationRef, prompt }) =>
    Effect.succeed({
      harnessId: "example-agent",
      executable: "example-agent",
      args: [
        "resume",
        "--session",
        nativeConversationRef.value,
        ...(prompt ? ["--prompt", prompt] : []),
      ],
      nativeConversationRef,
    }),
  proveContinuity: ({ expectedNativeConversationRef, observation }) => {
    const observed = observation?.nativeConversationRef;
    if (!observed)
      return Effect.succeed({ kind: "unknown", reason: "No native identity evidence." });
    return Effect.succeed(
      expectedNativeConversationRef &&
        observed.harnessId === expectedNativeConversationRef.harnessId &&
        observed.kind === expectedNativeConversationRef.kind &&
        observed.value === expectedNativeConversationRef.value
        ? {
            kind: "same",
            nativeConversationRef: observed,
            reason: "Exact session identity matched.",
          }
        : {
            kind: "replaced",
            nativeConversationRef: observed,
            reason: "A different session was observed.",
          },
    );
  },
};

export const plugin: ObservatoryPlugin = {
  activate: () => ({ agentHarnesses: [harness] }),
};
