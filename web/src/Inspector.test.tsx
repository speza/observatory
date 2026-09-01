import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { hostSnapshot, makeUniverse } from "../../src/universe/test-support.ts";
import { Inspector } from "./Inspector.tsx";

describe("Inspector", () => {
  test("shows bounded operational IDs without duplicating repository facts", () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "execution-visible",
          displayName: "Imported session",
          runtimeState: "idle",
          runtimeStateSource: "test",
          observedAt: fixture.clock.now(),
          repository: "synthetic/project",
          branch: "main",
          worktree: "/synthetic/project",
          hostLocator: "opaque:execution-visible",
          harnessEvidence: {
            detectedHarnessId: "codex",
            nativeConversationRef: {
              harnessId: "codex",
              kind: "session-id",
              value: "provider-visible",
            },
            restoreState: "not-restored",
            source: "native-integration",
            observedAt: fixture.clock.now(),
          },
        },
      ]),
    );
    const projection = fixture.universe.project({
      kind: "inspector",
      now: fixture.clock.now(),
      target: { type: "agent", id: "agent-1" },
    });
    const commandCentre = fixture.universe.project({
      kind: "command-centre",
      now: fixture.clock.now(),
    });
    if (projection.kind !== "agent-inspector") throw new Error("Expected Agent inspector.");
    if (commandCentre.kind !== "command-centre") throw new Error("Expected command centre.");

    const markup = renderToStaticMarkup(
      <Inspector
        commandCentre={commandCentre}
        commandPending={false}
        onClose={() => {}}
        onCloseAndArchive={async () => true}
        onCommand={async () => undefined}
        onOpenTerminal={() => {}}
        onRetry={() => {}}
        onReviewChanges={() => {}}
        onResume={async () => {}}
        projection={{
          ...projection,
          agent: {
            ...projection.agent,
            providerEvidence: {
              providerLabel: "Codex",
              mechanism: "hook",
              health: "healthy",
              activity: "using-tool",
              toolCategory: "execute",
              request: { kind: "permission", state: "open" },
              outcome: "response-completed",
              contextBand: "elevated",
              compaction: "completed",
              hostConflict: { hostState: "waiting", providerActivity: "using-tool" },
              supportedKinds: [
                "activity",
                "human-input-request",
                "turn-outcome",
                "context-pressure",
              ],
            },
          },
        }}
      />,
    );

    expect(markup).toContain("Agent ID");
    expect(markup).toContain("provider-visible");
    expect(markup).toContain("execution-visible");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("PROVIDER OBSERVATIONS / NOT ACCEPTED STATE");
    expect(markup).toContain("permission · open");
    expect(markup).toContain("Provider reported response completed");
    expect(markup).toContain("does not complete this Agent or its Goal");
    expect(markup).toContain(
      "Evidence conflict: the provider reports using tool activity while the host reports waiting.",
    );
    expect(markup).not.toContain("<dt>Repository</dt>");
    expect(markup).not.toContain("<dt>Branch</dt>");
  });
});
