import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { BoundedProcessRunner, CodeHostingProvider } from "../plugin-sdk/index.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import { hostSnapshot, makeUniverse } from "../universe/test-support.ts";
import type { WorkspaceDiffReader } from "../workspaces/types.ts";
import { DefaultAgentRepositoryStatusReader, repositoryIdentityFromRemote } from "./reader.ts";

const localGit: BoundedProcessRunner = {
  run: async (argv) => {
    const joined = argv.join(" ");
    const stdout = joined.includes("symbolic-ref")
      ? "feature/status\n"
      : joined.includes("rev-list")
        ? "0 2\n"
        : joined.includes("@{upstream}")
          ? "origin/feature/status\n"
          : joined.includes("remote get-url")
            ? "git@github.com:acme/ao.git\n"
            : "";
    const exitCode = joined.includes("merge-base")
      ? joined.includes("remote-head local-head")
        ? 0
        : 1
      : 0;
    return { exitCode, stdout, stderr: "", stdoutTruncated: false, stderrTruncated: false };
  },
};

const diffReader: WorkspaceDiffReader = {
  inspectWorkingTree: (path, now) =>
    Effect.succeed({
      kind: "working-tree-diff",
      status: "changed",
      worktree: path,
      repository: "ao",
      branch: "feature/status",
      head: "local-head",
      files: [],
      additions: 2,
      deletions: 1,
      truncated: false,
      generatedAt: now,
    }),
};

describe("agent repository status reader", () => {
  test("normalizes common credential-free remote forms", () => {
    expect(repositoryIdentityFromRemote("git@github.com:acme/ao.git")).toEqual({
      host: "github.com",
      owner: "acme",
      name: "ao",
    });
    expect(repositoryIdentityFromRemote("https://token@github.com/acme/ao.git")).toEqual({
      host: "github.com",
      owner: "acme",
      name: "ao",
    });
    expect(repositoryIdentityFromRemote("/local/repository")).toBeUndefined();
  });

  test("joins by trusted Agent worktree and caches remote status by revision", async () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Atlas",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          worktree: "/trusted/worktree",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected agent.");
    let calls = 0;
    const provider: CodeHostingProvider = {
      providerId: "github",
      supports: (repository) => repository.host === "github.com",
      pullRequests: (revision) => {
        calls += 1;
        return Effect.succeed([
          {
            providerId: "github",
            repository: revision.repository,
            number: 42,
            url: "https://github.com/acme/ao/pull/42",
            title: "Repository status",
            state: "open",
            draft: false,
            baseBranch: "main",
            headBranch: revision.branch,
            head: "remote-head",
            checks: "passing",
            review: "approved",
            mergeability: "mergeable",
          },
        ]);
      },
    };
    const plugins: PluginRegistry = {
      agentHarnesses: () => [],
      agentHarness: () => undefined,
      availableAgentHarnesses: () => Effect.succeed([]),
      codeHosts: () => [provider],
      status: () => [
        {
          id: "github",
          displayName: "GitHub",
          version: "1",
          apiVersion: 2,
          capabilities: ["code-host"],
          state: "ready",
          diagnostics: [],
        },
      ],
      close: () => Effect.void,
    };
    const reader = new DefaultAgentRepositoryStatusReader(
      fixture.universe,
      fixture.clock,
      diffReader,
      plugins,
      { runner: localGit },
    );
    const first = await Effect.runPromise(reader.inspect(agent.id));
    const second = await Effect.runPromise(reader.inspect(agent.id));

    expect(first.git?.worktree).toBe("/trusted/worktree");
    expect(first.pullRequests[0]).toMatchObject({
      number: 42,
      association: "confirmed",
      headSync: "local-ahead",
    });
    expect(first.diagnostics).toContain(
      "The local branch contains commits not present in the pull request head.",
    );
    expect(second.providerCached).toBe(true);
    expect(calls).toBe(1);
  });

  test("preserves multiple matching pull requests as ambiguous", async () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Atlas",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          worktree: "/trusted/worktree",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected agent.");
    const base = {
      providerId: "github",
      repository: { host: "github.com", owner: "acme", name: "ao" },
      url: "https://github.com/acme/ao/pull/1",
      title: "One",
      state: "open" as const,
      draft: false,
      baseBranch: "main",
      headBranch: "feature/status",
      head: "local-head",
      checks: "pending" as const,
      review: "review-required" as const,
      mergeability: "unknown" as const,
    };
    const provider: CodeHostingProvider = {
      providerId: "github",
      supports: () => true,
      pullRequests: () =>
        Effect.succeed([
          { ...base, number: 1 },
          { ...base, number: 2, url: "https://github.com/acme/ao/pull/2" },
        ]),
    };
    const plugins: PluginRegistry = {
      agentHarnesses: () => [],
      agentHarness: () => undefined,
      availableAgentHarnesses: () => Effect.succeed([]),
      codeHosts: () => [provider],
      status: () => [],
      close: () => Effect.void,
    };
    const reader = new DefaultAgentRepositoryStatusReader(
      fixture.universe,
      fixture.clock,
      diffReader,
      plugins,
      { runner: localGit },
    );
    const result = await Effect.runPromise(reader.inspect(agent.id));

    expect(result.status).toBe("partial");
    expect(result.pullRequests.every((item) => item.association === "ambiguous")).toBe(true);
  });
});
