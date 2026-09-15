import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentView } from "../../../src/projection/types.ts";
import { TerminalDeck } from "./TerminalDeck.tsx";

const agent: AgentView = {
  id: "agent-1",
  continuity: "proved",
  providerContinuity: "confirmed",
  executionPresence: "live",
  resumeCapability: "eligible",
  observationHealth: "fresh",
  displayName: "same execution",
  displayNameSource: "provider",
  runtimeState: "working",
  runtimeStateSource: "test",
  hostHealth: "live",
  lastSeenAt: 1_000,
  lastObservedAt: 1_000,
  lastChangedAt: 1_000,
  canResume: false,
  lifecycleState: "running",
  executionConflictCount: 0,
  execution: { hostKind: "herdr" },
  executionPresentation: {
    group: "frontier",
    context: "frontier · release",
    label: "same execution",
  },
};

describe("TerminalDeck execution identity", () => {
  test("shows secondary execution context beside an identically named primary", () => {
    const markup = renderToStaticMarkup(
      <TerminalDeck
        agent={agent}
        onClose={() => {}}
        onTerminalAppearanceChange={() => {}}
        terminalAppearance="dark"
        theme="dark"
      />,
    );

    expect(markup).toContain("same execution");
    expect(markup).toContain("frontier · release");
    expect(markup).toContain('aria-label="same execution terminal deck · frontier · release"');
  });
});
