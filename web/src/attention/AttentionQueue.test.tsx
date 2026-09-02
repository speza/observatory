import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { hostSnapshot, makeUniverse } from "../../../src/universe/test-support.ts";
import { AttentionQueue } from "./AttentionQueue.tsx";

describe("AttentionQueue", () => {
  test("renders one decision subject with supporting evidence", () => {
    const fixture = makeUniverse();
    fixture.universe.execute({ type: "CreateGoal", title: "Ship safely", priority: "P1" });
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "blocked-result",
          displayName: "Blocked result",
          runtimeState: "blocked",
          runtimeStateSource: "test",
          observedAt: fixture.clock.now(),
          hostLocator: "opaque:blocked-result",
        },
      ]),
    );
    fixture.universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-1" });
    const projected = fixture.universe.project({
      kind: "command-centre",
      now: fixture.clock.now(),
    });
    if (projected.kind !== "command-centre") throw new Error("Expected command centre.");
    const item = projected.attention.items[0];
    if (!item) throw new Error("Expected attention item.");
    const projection = {
      ...projected,
      attention: {
        items: [
          {
            ...item,
            supportingSignals: [
              {
                id: "agent-1:provider-complete",
                reason: "provider-complete" as const,
                action: "review" as const,
                startedAt: fixture.clock.now(),
                lastChangedAt: fixture.clock.now(),
                ageMs: 0,
                explanation: "Codex reports the response complete.",
              },
            ],
          },
        ],
        currentCount: 1,
        uncertaintyCount: 0,
      },
    };

    const markup = renderToStaticMarkup(
      <AttentionQueue onClose={() => {}} onSelect={() => {}} projection={projection} />,
    );

    expect(markup).toContain("Respond");
    expect(markup).toContain("Blocked result");
    expect(markup).toContain("Also observed: Codex reports the response complete.");
    expect(markup.match(/Blocked result/gu)).toHaveLength(1);
  });
});
