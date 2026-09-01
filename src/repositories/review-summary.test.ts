import { describe, expect, test } from "bun:test";
import type { AgentRepositoryStatusSnapshot, AssociatedPullRequest } from "./types.ts";
import { NO_PULL_REQUEST_DIAGNOSTIC, summarizeIntegrationReadiness } from "./review-summary.ts";

const pullRequest = (overrides: Partial<AssociatedPullRequest> = {}): AssociatedPullRequest => ({
  providerId: "synthetic",
  repository: { host: "example.test", owner: "observatory", name: "synthetic" },
  number: 42,
  url: "https://example.test/observatory/synthetic/pull/42",
  title: "Synthetic result",
  state: "open",
  draft: false,
  baseBranch: "main",
  headBranch: "result",
  head: "remote-head",
  checks: "passing",
  review: "approved",
  mergeability: "mergeable",
  association: "confirmed",
  headSync: "current",
  ...overrides,
});

const snapshot = (
  overrides: Partial<AgentRepositoryStatusSnapshot> = {},
): AgentRepositoryStatusSnapshot => ({
  kind: "agent-repository-status",
  agentId: "agent-1",
  status: "complete",
  observedAt: 1,
  diagnostics: [],
  git: {
    worktree: "/synthetic",
    repository: { host: "example.test", owner: "observatory", name: "synthetic" },
    branch: "result",
    head: "local-head",
    detached: false,
    diff: {
      kind: "working-tree-diff",
      status: "clean",
      worktree: "/synthetic",
      repository: "synthetic",
      files: [],
      additions: 0,
      deletions: 0,
      truncated: false,
      generatedAt: 1,
    },
  },
  pullRequests: [pullRequest()],
  providerCached: false,
  plugins: [],
  ...overrides,
});

const kinds = (value: AgentRepositoryStatusSnapshot): readonly string[] =>
  summarizeIntegrationReadiness(value).warnings.map((warning) => warning.kind);

describe("integration review summary", () => {
  test("reports dirty and untracked work", () => {
    const base = snapshot();
    expect(
      summarizeIntegrationReadiness(
        snapshot({
          git: base.git && {
            ...base.git,
            diff: {
              ...base.git.diff,
              status: "changed",
              files: [
                {
                  path: "new.ts",
                  status: "untracked",
                  additions: 2,
                  deletions: 0,
                  binary: false,
                  hunks: [],
                },
              ],
              additions: 2,
            },
          },
        }),
      ).warnings,
    ).toEqual([
      {
        kind: "dirty-worktree",
        message: "Local worktree has 1 changed file, including 1 untracked.",
      },
    ]);
  });

  test("reports every actionable confirmed pull-request condition", () => {
    expect(
      kinds(
        snapshot({
          pullRequests: [
            pullRequest({
              headSync: "local-ahead",
              checks: "failing",
              review: "changes-requested",
              mergeability: "conflicting",
            }),
          ],
        }),
      ),
    ).toEqual(["local-ahead", "failing-checks", "changes-requested", "conflict"]);
  });

  test("preserves ambiguous association without promoting candidate PR facts", () => {
    const ambiguous = pullRequest({
      association: "ambiguous",
      checks: "failing",
      review: "changes-requested",
      mergeability: "conflicting",
    });
    expect(kinds(snapshot({ status: "partial", pullRequests: [ambiguous] }))).toEqual([
      "ambiguous-association",
    ]);
  });

  test("makes unavailable and provider failures explicit", () => {
    expect(
      summarizeIntegrationReadiness(
        snapshot({ status: "unavailable", git: undefined, diagnostics: ["Worktree is missing."] }),
      ).warnings[0]?.message,
    ).toBe("Repository integration evidence is unavailable: Worktree is missing.");
    expect(
      summarizeIntegrationReadiness(
        snapshot({ status: "partial", diagnostics: ["GitHub request failed."] }),
      ).warnings[0]?.message,
    ).toBe("Repository integration evidence is unavailable: GitHub request failed.");
  });

  test("keeps no pull request informational rather than warning", () => {
    const result = summarizeIntegrationReadiness(
      snapshot({ pullRequests: [], diagnostics: [NO_PULL_REQUEST_DIAGNOSTIC] }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.information).toEqual(["No pull request found; a pull request is not required."]);
  });
});
