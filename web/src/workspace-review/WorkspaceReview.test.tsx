import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentView } from "../../../src/projection/types.ts";
import type { WorkspaceDiffFile } from "../../../src/workspaces/types.ts";
import { ChangedFileList, WorkingTreeDiff } from "./WorkingTreeDiff.tsx";
import { WorkspaceReview } from "./WorkspaceReview.tsx";

const agent = {
  id: "agent-1",
  continuity: "proved",
  providerContinuity: "confirmed",
  executionPresence: "live",
  resumeCapability: "eligible",
  observationHealth: "fresh",
  canResume: false,
  lifecycleState: "running",
  executionConflictCount: 0,
  displayName: "Review agent",
  displayNameSource: "fallback",
  runtimeState: "working",
  runtimeStateSource: "test",
  repository: "example/observatory",
  branch: "improve/review",
  worktree: "/synthetic/observatory",
  hostHealth: "live",
  lastSeenAt: 1,
  lastObservedAt: 1,
  lastChangedAt: 1,
} satisfies AgentView;

describe("WorkspaceReview", () => {
  test("opens as a full-width diff without starting a terminal", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceReview agent={agent} onClose={() => {}} theme="dark" />,
    );

    expect(markup).toContain('class="workspace-review"');
    expect(markup).not.toContain("workspace-review--terminal-open");
    expect(markup).not.toContain("terminal-deck");
  });

  test("renders every changed file as an initially expanded collapsible section", () => {
    const files = [
      {
        path: "web/src/WorkspaceReview.tsx",
        status: "modified",
        additions: 12,
        deletions: 4,
        binary: false,
        newFile: {
          fileName: "web/src/WorkspaceReview.tsx",
          fileLang: "tsx",
          content: "export const review = true;",
        },
        hunks: [],
      },
      {
        path: "fixtures/review-screenshot.png",
        status: "added",
        additions: 0,
        deletions: 0,
        binary: true,
        hunks: [],
      },
    ] satisfies readonly WorkspaceDiffFile[];

    const markup = renderToStaticMarkup(
      <ChangedFileList files={files} generatedAt={1} mode="unified" theme="dark" />,
    );

    expect(markup).toContain("web/src/WorkspaceReview.tsx");
    expect(markup).toContain("fixtures/review-screenshot.png");
    expect(markup.match(/<details/g)).toHaveLength(2);
    expect(markup.match(/<details[^>]* open=""/g)).toHaveLength(2);
    expect(markup.match(/<summary/g)).toHaveLength(2);
  });

  test("offers the terminal as an explicit diff action", () => {
    const markup = renderToStaticMarkup(
      <WorkingTreeDiff
        agent={agent}
        embedded
        onClose={() => {}}
        onTerminalToggle={() => {}}
        theme="dark"
      />,
    );

    expect(markup).toContain("Open terminal");
    expect(markup).toContain('aria-pressed="false"');
  });
});
