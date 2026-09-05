import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatchUpProjection } from "../../../src/projection/types.ts";
import { CatchUpPanel } from "./CatchUpPanel.tsx";

describe("CatchUpPanel", () => {
  test("leads with Goal summaries and keeps underlying transitions collapsed", () => {
    const projection: CatchUpProjection = {
      kind: "catch-up",
      generatedAt: 10_000,
      sinceAt: 1_000,
      throughSequence: 12,
      evidenceThroughSequence: 5,
      transitionCount: 7,
      pending: true,
      counts: { attention: 1, finished: 1, new: 0, changed: 1, stale: 0 },
      subjects: [
        {
          id: "goal:goal-1",
          subjectType: "goal",
          subjectId: "goal-1",
          title: "Ship a trustworthy result",
          occurredAt: 9_000,
          sequence: 12,
          outcome: "attention",
          affectedTargetCount: 2,
          transitionCount: 7,
          summaries: [
            { kind: "attention", count: 1, label: "1 Agent needs judgment" },
            { kind: "finished", count: 1, label: "1 Agent finished" },
          ],
          transitions: [
            {
              sequence: 12,
              occurredAt: 9_000,
              outcome: "attention",
              targetType: "agent",
              targetId: "agent-1",
              goalId: "goal-1",
              summary: "Agent needs input · Release agent",
            },
            {
              sequence: 11,
              occurredAt: 8_000,
              outcome: "finished",
              targetType: "agent",
              targetId: "agent-2",
              goalId: "goal-1",
              summary: "Agent state · Review agent · working → done",
            },
          ],
          evidenceTransitionCount: 2,
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
        },
      ],
      evidenceTransitionCount: 2,
    };

    const markup = renderToStaticMarkup(
      <CatchUpPanel
        onAcknowledge={async () => {}}
        onClose={() => {}}
        onOpenInbox={() => {}}
        onSelect={() => {}}
        onSelectSystem={() => {}}
        pending={false}
        projection={projection}
      />,
    );

    expect(markup).toContain("Here’s what changed");
    expect(markup).toContain("Changes by Goal");
    expect(markup).toContain("Ship a trustworthy result");
    expect(markup).toContain("1 Agent needs judgment");
    expect(markup).toContain("1 Agent finished");
    expect(markup).toContain("Provider requests");
    expect(markup).toContain("7 accepted transitions · 1 routine provider transition");
    expect(markup).toContain("1 affected areas · 7 accepted transitions");
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
    expect(markup.indexOf("1 Agent needs judgment")).toBeLessThan(
      markup.indexOf("Agent needs input"),
    );
  });
});
