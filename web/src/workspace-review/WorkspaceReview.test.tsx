import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentView } from "../../../src/projection/types.ts";
import type { WorkspaceDiffFile } from "../../../src/workspaces/types.ts";
import { ChangedFileList, FileDiff } from "./WorkingTreeDiff.tsx";
import { SyntaxSourceView } from "./SyntaxSourceView.tsx";
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
  test("opens with a persistent, application-themed terminal beside the review workspace", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceReview
        agent={agent}
        onClose={() => {}}
        onTerminalAppearanceChange={() => {}}
        terminalAppearance="application"
        theme="dark"
      />,
    );
    const lightMarkup = renderToStaticMarkup(
      <WorkspaceReview
        agent={agent}
        onClose={() => {}}
        onTerminalAppearanceChange={() => {}}
        terminalAppearance="application"
        theme="light"
      />,
    );

    expect(markup).toContain('class="review-workspace review-workspace--dark"');
    expect(markup).toContain("terminal-deck--dark");
    expect(lightMarkup).toContain('class="review-workspace review-workspace--light"');
    expect(lightMarkup).toContain("terminal-deck--light");
    expect(lightMarkup).toContain("Terminal appearance: Auto");

    const darkTerminalMarkup = renderToStaticMarkup(
      <WorkspaceReview
        agent={agent}
        onClose={() => {}}
        onTerminalAppearanceChange={() => {}}
        terminalAppearance="dark"
        theme="light"
      />,
    );
    expect(darkTerminalMarkup).toContain('class="review-workspace review-workspace--light"');
    expect(darkTerminalMarkup).toContain("terminal-deck--dark");
    expect(markup).toContain("Changes");
    expect(markup).toContain("Files");
    expect(markup).toContain("Evidence");
    expect(markup).toContain("TERMINAL DECK");
    expect(markup).toContain('aria-label="Resize terminal"');
    expect(markup).not.toContain('aria-label="Resize file navigator"');
    expect(markup).toContain("terminal-deck");
  });

  test("renders every changed file as an initially collapsed section", () => {
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
    expect(markup).not.toContain('open=""');
    expect(markup.match(/<summary/g)).toHaveLength(2);
    expect(markup).not.toContain("export const review");
  });

  test("syntax-highlights supported changed files", () => {
    const file = {
      path: "src/example.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      oldFile: {
        fileName: "src/example.ts",
        fileLang: "typescript",
        content: "const value = false;\n",
      },
      newFile: {
        fileName: "src/example.ts",
        fileLang: "typescript",
        content: "const value = true;\n",
      },
      hunks: [
        "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-const value = false;\n+const value = true;",
      ],
    } satisfies WorkspaceDiffFile;

    const markup = renderToStaticMarkup(<FileDiff file={file} mode="unified" theme="dark" />);

    expect(markup).toContain("hljs-keyword");
    expect(markup).toContain("hljs-literal");
  });

  test("syntax-highlights source without rendering untrusted markup", () => {
    const markup = renderToStaticMarkup(
      <SyntaxSourceView
        snapshot={{
          kind: "workspace-review-file",
          snapshotId: "snapshot-1",
          fileId: "file-1",
          displayPath: "src/example.ts",
          view: "source",
          status: "available",
          language: "typescript",
          content: "const value = '<script>';",
          truncated: false,
          generatedAt: 1,
        }}
        theme="dark"
      />,
    );

    expect(markup).toContain("hljs-keyword");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  test("bounds source rows rendered for newline-heavy files", () => {
    const markup = renderToStaticMarkup(
      <SyntaxSourceView
        snapshot={{
          kind: "workspace-review-file",
          snapshotId: "snapshot-1",
          fileId: "file-1",
          displayPath: "src/generated.txt",
          view: "source",
          status: "available",
          content: Array.from({ length: 5_100 }, (_, index) => String(index)).join("\n"),
          truncated: false,
          generatedAt: 1,
        }}
        theme="dark"
      />,
    );

    expect(markup.match(/class="review-source__line"/g)).toHaveLength(5_000);
    expect(markup).toContain("Rendering limited to the first 5,000 lines.");
  });

  test("does not initialize diffs beyond the rendered-line limit", () => {
    const file = {
      path: "src/generated.ts",
      status: "modified",
      additions: 5_001,
      deletions: 0,
      binary: false,
      oldFile: { fileName: "src/generated.ts", content: "" },
      newFile: { fileName: "src/generated.ts", content: "" },
      hunks: [
        `--- a/src/generated.ts\n+++ b/src/generated.ts\n@@ -0,0 +1,5001 @@\n${Array.from(
          { length: 5_001 },
          () => "+value",
        ).join("\n")}`,
      ],
    } satisfies WorkspaceDiffFile;

    const markup = renderToStaticMarkup(<FileDiff file={file} mode="unified" theme="dark" />);

    expect(markup).toContain("Diff rendering is limited to 5,000 lines.");
    expect(markup).not.toContain("diff-style-root");
  });
});
