import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../../../src/universe/test-support.ts";
import { CloseAgentDialog } from "./CloseAgentDialog.tsx";

describe("CloseAgentDialog", () => {
  test("requires confirmation and explains that a live process will stop", () => {
    const fixture = makeUniverse();
    admitObservedConversationsAndReconcile(
      fixture.universe,
      hostSnapshot([
        {
          nativeId: "execution-1",
          displayName: "Working agent",
          runtimeState: "working",
          runtimeStateSource: "test",
          observedAt: fixture.clock.now(),
          hostLocator: "opaque:execution-1",
        },
      ]),
    );
    const projection = fixture.universe.project({
      kind: "command-centre",
      now: fixture.clock.now(),
    });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre.");
    const agent = projection.unassigned[0];
    if (!agent) throw new Error("Expected a projected Agent.");

    const markup = renderToStaticMarkup(
      <CloseAgentDialog
        agent={agent}
        onCancel={() => {}}
        onConfirm={async () => {}}
        pending={false}
      />,
    );

    expect(markup).toContain("Close &amp; archive?");
    expect(markup).toContain("Working agent");
    expect(markup).toContain("currently working");
    expect(markup).toContain("running process will be stopped");
    expect(markup).toContain("Close &amp; archive</button>");
  });
});
