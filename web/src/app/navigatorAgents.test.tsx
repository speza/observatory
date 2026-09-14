import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import type { CommandCentreProjection } from "../../../src/projection/types.ts";
import { WorkspaceNavigation } from "./WorkspaceNavigation.tsx";
import { agentsInView } from "./navigatorAgents.ts";

/**
 * Two Systems that each hold a Goal *and* a directly placed Agent. A flat
 * "all Goals, then all direct Agents" walk and a per-System walk disagree here,
 * which is exactly the case that made Shift-click and Shift-arrow extend over
 * different sequences.
 */
const fixture = (): CommandCentreProjection => {
  const { universe, clock } = makeUniverse();
  universe.execute({ type: "CreateSystem", title: "Alpha" });
  universe.execute({ type: "CreateSystem", title: "Beta" });
  universe.execute({ type: "CreateGoal", title: "Alpha goal", systemId: "system-1" });
  universe.execute({ type: "CreateGoal", title: "Beta goal", systemId: "system-2" });
  admitObservedConversationsAndReconcile(
    universe,
    hostSnapshot(
      ["Alphagoal", "Alphadirect", "Betagoal", "Betadirect", "Inboxone", "Inboxtwo"].map(
        (displayName, index) => ({
          nativeId: `o${index}`,
          displayName,
          runtimeState: "idle" as const,
          runtimeStateSource: "test",
          hostLocator: `opaque:${index}`,
          observedAt: clock.now(),
        }),
      ),
    ),
  );
  universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
  universe.execute({ type: "AssignAgentToSystem", agentId: "agent-2", systemId: "system-1" });
  universe.execute({ type: "AssignAgent", agentId: "agent-3", goalId: "goal-2" });
  universe.execute({ type: "AssignAgentToSystem", agentId: "agent-4", systemId: "system-2" });
  const projection = universe.project({ kind: "command-centre", now: clock.now() });
  if (projection.kind !== "command-centre") throw new Error("Expected command centre");
  return projection;
};

const renderAgentNames = (projection: CommandCentreProjection, view: "all" | "attention") => {
  const markup = renderToStaticMarkup(
    <WorkspaceNavigation
      projection={projection}
      view={view}
      onSystem={() => {}}
      onSelect={() => {}}
    />,
  );
  return [
    ...markup.matchAll(/class="workspace-tree__agent[^"]*"[^>]*>.*?<span>([^<]+)<\/span>/gu),
  ].map((match) => match[1]);
};

describe("visible Agent order", () => {
  test("agentsInView matches the order the navigator renders", () => {
    const projection = fixture();

    const rendered = renderAgentNames(projection, "all");
    const shared = agentsInView(projection, "all").map((agent) => agent.displayName);

    // The shared definition of visible order is what the tree draws and what range
    // selection walks, so the two gestures can never disagree.
    expect(rendered).toEqual(shared);
    expect(rendered).toEqual([
      "Alphagoal",
      "Alphadirect",
      "Betagoal",
      "Betadirect",
      "Inboxone",
      "Inboxtwo",
    ]);
  });

  test("the attention view keeps each System's attention Agents in tree order", () => {
    const { universe, clock } = makeUniverse();
    universe.execute({ type: "CreateSystem", title: "Alpha" });
    universe.execute({ type: "CreateSystem", title: "Beta" });
    universe.execute({ type: "CreateGoal", title: "Alpha goal", systemId: "system-1" });
    universe.execute({ type: "CreateGoal", title: "Beta goal", systemId: "system-2" });
    const observations: readonly {
      readonly nativeId: string;
      readonly displayName: string;
      readonly runtimeState: "working" | "blocked";
    }[] = [
      { nativeId: "quiet-a", displayName: "Quietgoala", runtimeState: "working" },
      { nativeId: "loud-a", displayName: "Loudgoala", runtimeState: "blocked" },
      { nativeId: "quiet-b", displayName: "Quietdirectb", runtimeState: "working" },
      { nativeId: "loud-b", displayName: "Louddirectb", runtimeState: "blocked" },
    ];
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot(
        observations.map((entry) => ({
          ...entry,
          runtimeStateSource: "test",
          hostLocator: `opaque:${entry.nativeId}`,
          observedAt: clock.now(),
        })),
      ),
    );
    universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    universe.execute({ type: "AssignAgent", agentId: "agent-2", goalId: "goal-1" });
    universe.execute({ type: "AssignAgentToSystem", agentId: "agent-3", systemId: "system-2" });
    universe.execute({ type: "AssignAgentToSystem", agentId: "agent-4", systemId: "system-2" });
    const projection = universe.project({ kind: "command-centre", now: clock.now() });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre");

    const rendered = renderAgentNames(projection, "attention");
    expect(rendered).toEqual(
      agentsInView(projection, "attention").map((agent) => agent.displayName),
    );
    expect(rendered).toEqual(["Loudgoala", "Louddirectb"]);
  });
});
