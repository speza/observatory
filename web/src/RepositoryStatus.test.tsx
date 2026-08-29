import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentView } from "../../src/projection/types.ts";
import { RepositoryStatus } from "./RepositoryStatus.tsx";

describe("RepositoryStatus", () => {
  test("renders an explicit repository loading surface for a selected Agent", () => {
    const agent = {
      id: "agent-1",
      execution: {
        hostKind: "mock",
        hostInstanceId: "mock:default",
        nativeId: "native-1",
        hostLocator: "mock:native-1",
        observedAt: 1,
      },
      continuity: "proved",
      providerContinuity: "confirmed",
      executionPresence: "live",
      resumeCapability: "eligible",
      observationHealth: "fresh",
      canResume: false,
      lifecycleState: "running",
      executionConflictCount: 0,
      displayName: "Repository agent",
      displayNameSource: "host",
      runtimeState: "working",
      runtimeStateSource: "test",
      hostHealth: "live",
      lastSeenAt: 1,
      lastObservedAt: 1,
      lastChangedAt: 1,
    } satisfies AgentView;

    const markup = renderToStaticMarkup(
      <RepositoryStatus agent={agent} onReviewChanges={() => {}} />,
    );

    expect(markup).toContain("REPOSITORY");
    expect(markup).toContain("Code status");
    expect(markup).toContain("Inspecting local Git and code host");
    expect(markup).toContain("Refresh");
  });
});
