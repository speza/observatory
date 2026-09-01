import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatchUpProjection } from "../../src/projection/types.ts";
import { CatchUpPanel } from "./CatchUpPanel.tsx";

describe("CatchUpPanel", () => {
  test("prioritises accepted changes and keeps routine provider activity collapsed", () => {
    const projection: CatchUpProjection = {
      kind: "catch-up",
      generatedAt: 10_000,
      sinceAt: 1_000,
      throughSequence: 12,
      transitionCount: 7,
      pending: true,
      counts: { attention: 1, finished: 1, new: 0, changed: 1, stale: 0 },
      groups: [
        {
          outcome: "attention",
          label: "Needs attention",
          items: [
            {
              sequence: 12,
              occurredAt: 9_000,
              outcome: "attention",
              targetType: "agent",
              targetId: "agent-1",
              summary: "Agent needs input · Release agent",
            },
          ],
        },
        {
          outcome: "finished",
          label: "Finished",
          items: [
            {
              sequence: 11,
              occurredAt: 8_000,
              outcome: "finished",
              targetType: "agent",
              targetId: "agent-2",
              summary: "Agent state · Review agent · working → done",
            },
          ],
        },
      ],
      evidenceTransitionCount: 9,
      evidenceGroups: [
        {
          kind: "human-input-request",
          label: "Provider requests",
          items: [
            {
              sequence: 4,
              agentId: "agent-1",
              occurredAt: 9_500,
              summary: "Codex permission request open.",
            },
          ],
        },
        {
          kind: "activity",
          label: "Provider activity",
          items: [
            {
              sequence: 5,
              agentId: "agent-2",
              occurredAt: 9_800,
              summary: "Codex activity changed to using tool.",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <CatchUpPanel
        onAcknowledge={async () => {}}
        onClose={() => {}}
        onSelect={() => {}}
        onSelectSystem={() => {}}
        pending={false}
        projection={projection}
      />,
    );

    expect(markup).toContain("Here’s what changed");
    expect(markup).toContain("Accepted changes");
    expect(markup).toContain("Provider signals");
    expect(markup).toContain("1 routine activity transitions");
    expect(markup).toContain("2 accepted summaries · 7 transitions");
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
    expect(markup.indexOf("Agent needs input")).toBeLessThan(
      markup.indexOf("Codex permission request open"),
    );
    expect(markup.indexOf("Codex permission request open")).toBeLessThan(
      markup.indexOf("Codex activity changed to using tool"),
    );
  });
});
