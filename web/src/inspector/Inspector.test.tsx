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
        onOpenDiscoveredTerminal={() => {}}
        onAdmitDiscovered={async () => undefined}
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
        onOpenDiscoveredTerminal={() => {}}
        onAdmitDiscovered={async () => undefined}
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
    expect(markup).not.toContain("execution-visible");
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

const batchFixture = () => {
  const { universe, clock } = makeUniverse();
  universe.execute({ type: "CreateGoal", title: "Batch destination" });
  universe.execute({ type: "CreateGoal", title: "Archived destination" });
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot(
      ["Alpha worker", "Beta worker", "Gamma worker"].map((displayName, index) => ({
        nativeId: `m${index}`,
        displayName,
        runtimeState: "idle" as const,
        runtimeStateSource: "test",
        hostLocator: `opaque:${index}`,
        observedAt: clock.now(),
      })),
    ),
  );
  universe.execute({ type: "CompleteGoal", goalId: "goal-2" });
  universe.execute({ type: "ArchiveGoal", goalId: "goal-2" });
  const commandCentre = () => {
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre.");
    return projection;
  };
  return { clock, commandCentre, universe };
};

describe("Inspector batch agent selection", () => {
  const agentIds = ["agent-1", "agent-2", "agent-3"];

  test("replaces the single Agent view with batch actions and placement context", () => {
    const { clock, commandCentre, universe } = batchFixture();
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    const projection = universe.project({
      kind: "inspector",
      now: clock.now(),
      target: { type: "agent", id: "agent-1" },
    });
    if (projection.kind !== "agent-inspector") throw new Error("Expected the Agent inspector.");
    const markup = renderToStaticMarkup(
      <Inspector
        batchAgentIds={agentIds}
        commandCentre={commandCentre()}
        commandPending={false}
        onAssignSelected={async () => {}}
        onClearSelection={() => {}}
        onClose={() => {}}
        onCloseAndArchive={async () => true}
        onCommand={async () => undefined}
        onOpenTerminal={() => {}}
        onOpenDiscoveredTerminal={() => {}}
        onAdmitDiscovered={async () => undefined}
        onRetry={() => {}}
        onReviewChanges={() => {}}
        onResume={async () => {}}
        projection={projection}
      />,
    );

    expect(markup).toContain("<h2>3 agents selected</h2>");
    expect(markup).toContain("3 agents · currently in 1 goal · 2 in Inbox");
    expect(markup).toContain("Alpha worker");
    expect(markup).toContain("Gamma worker");
    expect(markup).toContain("Move 3 agents");
    expect(markup).toContain("Clear selection");
    expect(markup).toContain("A Goal clears any direct System placement, and Inbox clears both.");
    expect(markup).toContain('<option value="inbox">No Goal or System</option>');
    // The single-subject controls are gone while a batch is active.
    expect(markup).not.toContain("Assigned goal");
    expect(markup).not.toContain("Review result");
  });

  test("offers only active Goals and names the System destination", () => {
    const { commandCentre } = batchFixture();
    const markup = renderToStaticMarkup(
      <Inspector
        batchAgentIds={agentIds}
        commandCentre={commandCentre()}
        commandPending={false}
        onClose={() => {}}
        onCloseAndArchive={async () => true}
        onCommand={async () => undefined}
        onOpenTerminal={() => {}}
        onOpenDiscoveredTerminal={() => {}}
        onAdmitDiscovered={async () => undefined}
        onRetry={() => {}}
        onReviewChanges={() => {}}
        onResume={async () => {}}
      />,
    );

    expect(markup).toContain('<optgroup label="Goals">');
    expect(markup).toContain("Batch destination");
    expect(markup).not.toContain("Archived destination");
    expect(markup).toContain('<optgroup label="Systems">');
    expect(markup).toContain("Default");
  });
});
