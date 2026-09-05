import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { Inspector } from "./Inspector.tsx";

describe("Inspector", () => {
  test("shows the selected archived assignment without offering archived destinations", () => {
    const { universe, clock } = makeUniverse();
    for (const title of ["Archived assignment", "Other archived goal"])
      universe.execute({ type: "CreateGoal", title });
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          nativeId: "live",
          displayName: "Named worker",
          runtimeState: "blocked",
          runtimeStateSource: "test",
          hostLocator: "opaque:live",
          observedAt: clock.now(),
        },
      ]),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    for (const goalId of ["goal-1", "goal-2"]) {
      universe.execute({ type: "CompleteGoal", goalId });
      universe.execute({ type: "ArchiveGoal", goalId });
    }
    const projection = universe.project({
      kind: "inspector",
      now: clock.now(),
      target: { type: "agent", id: "agent-1" },
    });
    const commandCentre = universe.project({
      kind: "command-centre",
      now: clock.now(),
      includeArchived: true,
    });
    if (commandCentre.kind !== "command-centre" || projection.kind !== "agent-inspector")
      throw new Error("Wrong projection");
    const markup = renderToStaticMarkup(
      <Inspector
        commandCentre={commandCentre}
        projection={projection}
        commandPending={false}
        onClose={() => {}}
        onCloseAndArchive={async () => true}
        onCommand={async () => undefined}
        onOpenTerminal={() => {}}
        onRetry={() => {}}
        onReviewChanges={() => {}}
        onResume={async () => {}}
      />,
    );
    expect(markup).toContain(
      '<option disabled="" value="goal-1" selected="">P2 · Archived assignment · archived</option>',
    );
    expect(markup).not.toContain("Other archived goal");
    expect(markup).toContain("Open terminal");
    expect(markup).toContain("Goal is archived");
  });

  test("shows bounded operational IDs without duplicating repository facts", () => {
    const fixture = makeUniverse();
    admitObservedConversationsAndReconcile(
      fixture.universe,
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
            attention: {
              id: "agent-1:provider-complete",
              targetType: "agent",
              targetId: "agent-1",
              agentId: "agent-1",
              reason: "provider-complete",
              action: "review",
              requiresHumanInput: true,
              startedAt: fixture.clock.now(),
              lastChangedAt: fixture.clock.now(),
              ageMs: 0,
              priority: "P3",
              runtimeState: "idle",
              explanation: "Codex reports the response complete. Review code evidence.",
              supportingSignals: [
                {
                  id: "agent-1:runtime-complete",
                  reason: "runtime-complete",
                  action: "review",
                  startedAt: fixture.clock.now(),
                  lastChangedAt: fixture.clock.now(),
                  ageMs: 0,
                  explanation: "The host also reports done.",
                },
              ],
            },
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

    expect(markup).toContain("Review result");
    expect(markup).toContain("Codex reports the response complete. Review code evidence.");
    expect(markup).toContain("Also observed: The host also reports done.");
    expect(markup).toContain("Agent ID");
    expect(markup).toContain("provider-visible");
    expect(markup).toContain("execution-visible");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("PROVIDER SIGNALS");
    expect(markup).toContain("Observations only · not accepted state");
    expect(markup).toContain("permission · open");
    expect(markup).toContain("Provider reported response completed");
    expect(markup).toContain("does not complete this Agent or its Goal");
    expect(markup).toContain(
      "Evidence conflict: the provider reports using tool activity while the host reports waiting.",
    );
    expect(markup).not.toContain("<dt>Repository</dt>");
    expect(markup).not.toContain("<dt>Branch</dt>");
    expect(markup).toContain("Technical details");
    expect(markup).toContain("Agent lifecycle");
  });
});
