import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { hostSnapshot, makeUniverse } from "../../../src/universe/test-support.ts";
import { InboxPanel } from "./InboxPanel.tsx";

describe("InboxPanel", () => {
  test("contains accepted unassigned Agents without provider import candidates", () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Focused inbox Agent",
          runtimeState: "idle",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const projection = fixture.universe.project({
      kind: "command-centre",
      now: fixture.clock.now(),
    });
    if (projection.kind !== "command-centre") throw new Error("Expected command centre.");

    const markup = renderToStaticMarkup(
      <InboxPanel
        focusedAgentId="agent-1"
        onAssign={async () => true}
        onClose={() => {}}
        onSelect={() => {}}
        pending={false}
        projection={projection}
      />,
    );

    expect(markup).toContain("Work awaiting a home");
    expect(markup).not.toContain("Recovered sessions");
    expect(markup).not.toContain("Session import");
    expect(markup).toContain("Focused inbox Agent");
    expect(markup).toContain("inbox-panel__item is-focused");
    expect(markup).toContain('aria-current="true"');
  });
});
