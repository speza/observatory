import { Effect } from "effect";
import type {
  BoundedProcessRunner,
  PullRequestStatus,
  RepositoryIdentity,
} from "../plugin-sdk/index.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import { BunBoundedProcessRunner } from "../plugins/process.ts";
import type { Universe } from "../universe/universe.ts";
import type { Clock } from "../universe/types.ts";
import type { WorkspaceDiffReader } from "../workspaces/types.ts";
import {
  RepositoryStatusError,
  type AgentRepositoryStatusReader,
  type AgentRepositoryStatusSnapshot,
  type AssociatedPullRequest,
  type LocalGitStatus,
} from "./types.ts";

interface CachedPullRequests {
  readonly expiresAt: number;
  readonly pullRequests: readonly PullRequestStatus[];
}

interface GitDivergence {
  readonly ahead?: number;
  readonly behind?: number;
}

const git = async (
  runner: BoundedProcessRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> => {
  const result = await runner.run(["git", ...args], { cwd, maxOutputBytes: 64_000 });
  return result.exitCode === 0 && !result.stdoutTruncated
    ? result.stdout.trim() || undefined
    : undefined;
};

export const repositoryIdentityFromRemote = (remote: string): RepositoryIdentity | undefined => {
  const clean = remote.trim().replace(/\.git$/u, "");
  let host: string;
  let path: string;
  const scp = /^(?:[^@]+@)?([^:]+):(.+)$/u.exec(clean);
  if (scp && !clean.includes("://")) {
    host = scp[1]?.toLocaleLowerCase() ?? "";
    path = scp[2] ?? "";
  } else {
    try {
      const url = new URL(clean);
      host = url.hostname.toLocaleLowerCase();
      path = url.pathname.replace(/^\/+|\/+$/gu, "");
    } catch {
      return undefined;
    }
  }
  const [owner, name, ...extra] = path.split("/").filter(Boolean);
  if (!host || !owner || !name || extra.length > 0) return undefined;
  return { host, owner, name };
};

const divergence = (value: string | undefined): GitDivergence => {
  if (!value) return {};
  const [behindText, aheadText] = value.split(/\s+/u);
  const ahead = Number(aheadText);
  const behind = Number(behindText);
  return Number.isInteger(ahead) && Number.isInteger(behind) ? { ahead, behind } : {};
};

const sameRepository = (left: RepositoryIdentity, right: RepositoryIdentity): boolean =>
  left.host === right.host && left.owner === right.owner && left.name === right.name;

const headSyncFor = async (
  runner: BoundedProcessRunner,
  worktree: string,
  localHead: string,
  pullRequestHead: string,
): Promise<AssociatedPullRequest["headSync"]> => {
  if (localHead === pullRequestHead) return "current";
  const localContainsRemote = await runner.run(
    ["git", "merge-base", "--is-ancestor", pullRequestHead, localHead],
    { cwd: worktree, maxOutputBytes: 8_000 },
  );
  if (localContainsRemote.exitCode === 0) return "local-ahead";
  if (localContainsRemote.exitCode > 1) return "unknown";
  const remoteContainsLocal = await runner.run(
    ["git", "merge-base", "--is-ancestor", localHead, pullRequestHead],
    { cwd: worktree, maxOutputBytes: 8_000 },
  );
  return remoteContainsLocal.exitCode <= 1 ? "different" : "unknown";
};

const associate = async (
  runner: BoundedProcessRunner,
  local: LocalGitStatus,
  pullRequests: readonly PullRequestStatus[],
): Promise<readonly AssociatedPullRequest[]> => {
  const candidates = pullRequests.filter(
    (pullRequest) =>
      sameRepository(local.repository, pullRequest.repository) &&
      pullRequest.headBranch === local.branch,
  );
  const ambiguous = candidates.length > 1;
  return Promise.all(
    candidates.map(async (pullRequest) => {
      const headSync = await headSyncFor(runner, local.worktree, local.head, pullRequest.head);
      return {
        ...pullRequest,
        association: ambiguous
          ? "ambiguous"
          : headSync === "current" || headSync === "local-ahead"
            ? "confirmed"
            : "candidate",
        headSync,
      } satisfies AssociatedPullRequest;
    }),
  );
};

export class DefaultAgentRepositoryStatusReader implements AgentRepositoryStatusReader {
  private readonly cache = new Map<string, CachedPullRequests>();
  private readonly runner: BoundedProcessRunner;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly universe: Universe,
    private readonly clock: Clock,
    private readonly diffReader: WorkspaceDiffReader,
    private readonly plugins: PluginRegistry,
    options?: { readonly runner?: BoundedProcessRunner; readonly cacheTtlMs?: number },
  ) {
    this.runner = options?.runner ?? new BunBoundedProcessRunner();
    this.cacheTtlMs = options?.cacheTtlMs ?? 60_000;
  }

  inspect(
    agentId: string,
    options?: { readonly freshness?: "cached" | "refresh" },
  ): Effect.Effect<AgentRepositoryStatusSnapshot, RepositoryStatusError> {
    return Effect.tryPromise({
      try: async () => {
        const now = this.clock.now();
        const agent = this.universe.snapshot().agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new RepositoryStatusError("agent-not-found", "Agent not found.");
        const pluginStatus = this.plugins.status().map(({ id, state, diagnostics }) => ({
          id,
          state,
          diagnostics,
        }));
        if (!agent.worktree)
          return {
            kind: "agent-repository-status",
            agentId,
            status: "unavailable",
            observedAt: now,
            diagnostics: ["This Agent has not reported a workspace path."],
            pullRequests: [],
            providerCached: false,
            plugins: pluginStatus,
          } satisfies AgentRepositoryStatusSnapshot;
        const diff = await Effect.runPromise(
          this.diffReader.inspectWorkingTree(agent.worktree, now),
        );
        if (diff.status === "not-git")
          return {
            kind: "agent-repository-status",
            agentId,
            status: "not-applicable",
            observedAt: now,
            diagnostics: [diff.message ?? "The observed workspace is not a Git checkout."],
            pullRequests: [],
            providerCached: false,
            plugins: pluginStatus,
          } satisfies AgentRepositoryStatusSnapshot;
        if (!diff.head)
          return {
            kind: "agent-repository-status",
            agentId,
            status: "unavailable",
            observedAt: now,
            diagnostics: [diff.message ?? "Local Git status is unavailable."],
            pullRequests: [],
            providerCached: false,
            plugins: pluginStatus,
          } satisfies AgentRepositoryStatusSnapshot;
        const branch = await git(this.runner, agent.worktree, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ]);
        const upstream = branch
          ? await git(this.runner, agent.worktree, [
              "rev-parse",
              "--abbrev-ref",
              "--symbolic-full-name",
              "@{upstream}",
            ])
          : undefined;
        const remoteName = upstream?.split("/")[0] ?? "origin";
        const remote = await git(this.runner, agent.worktree, [
          "remote",
          "get-url",
          "--push",
          remoteName,
        ]);
        const repository = remote ? repositoryIdentityFromRemote(remote) : undefined;
        const counts = upstream
          ? divergence(
              await git(this.runner, agent.worktree, [
                "rev-list",
                "--left-right",
                "--count",
                `${upstream}...HEAD`,
              ]),
            )
          : {};
        if (!repository) {
          return {
            kind: "agent-repository-status",
            agentId,
            status: "partial",
            observedAt: now,
            diagnostics: [
              "No supported code-host repository could be resolved from the push remote.",
            ],
            pullRequests: [],
            providerCached: false,
            plugins: pluginStatus,
          } satisfies AgentRepositoryStatusSnapshot;
        }
        const local: LocalGitStatus = {
          worktree: agent.worktree,
          repository,
          branch,
          head: diff.head,
          detached: !branch,
          upstream,
          ...counts,
          diff,
        };
        if (!branch)
          return {
            kind: "agent-repository-status",
            agentId,
            status: "partial",
            observedAt: now,
            diagnostics: [
              "The checkout has a detached HEAD; pull request association is unavailable.",
            ],
            git: local,
            pullRequests: [],
            providerCached: false,
            plugins: pluginStatus,
          } satisfies AgentRepositoryStatusSnapshot;
        const provider = this.plugins
          .codeHosts()
          .find((candidate) => candidate.supports(repository));
        if (!provider)
          return {
            kind: "agent-repository-status",
            agentId,
            status: "partial",
            observedAt: now,
            diagnostics: ["No enabled plugin supports this code host."],
            git: local,
            pullRequests: [],
            providerCached: false,
            plugins: pluginStatus,
          } satisfies AgentRepositoryStatusSnapshot;
        const cacheKey = `${provider.providerId}:${repository.host}/${repository.owner}/${repository.name}:${branch}:${diff.head}`;
        const cached = this.cache.get(cacheKey);
        let providerCached =
          options?.freshness !== "refresh" && cached !== undefined && cached.expiresAt > now;
        let pullRequests: readonly PullRequestStatus[];
        const diagnostics: string[] = [];
        if (providerCached && cached) pullRequests = cached.pullRequests;
        else {
          try {
            pullRequests = await Effect.runPromise(
              provider.pullRequests({ repository, branch, head: diff.head }),
            );
            this.cache.set(cacheKey, { pullRequests, expiresAt: now + this.cacheTtlMs });
          } catch (error) {
            if (cached) {
              pullRequests = cached.pullRequests;
              providerCached = true;
              diagnostics.push("Provider refresh failed; showing cached pull request status.");
            } else {
              return {
                kind: "agent-repository-status",
                agentId,
                status: "partial",
                observedAt: now,
                diagnostics: [
                  error instanceof Error ? error.message : "Code-host status is unavailable.",
                ],
                git: local,
                pullRequests: [],
                provider: provider.providerId,
                providerCached: false,
                plugins: pluginStatus,
              } satisfies AgentRepositoryStatusSnapshot;
            }
          }
        }
        const associated = await associate(this.runner, local, pullRequests);
        if (associated.length === 0)
          diagnostics.push("No pull request found for this repository and branch.");
        if (associated.some((item) => item.association === "ambiguous"))
          diagnostics.push("Pull request association is ambiguous; no candidate was selected.");
        if (associated.some((item) => item.association === "candidate"))
          diagnostics.push(
            "A pull request matches the repository and branch, but its head is not related to the local HEAD.",
          );
        if (associated.some((item) => item.headSync === "local-ahead"))
          diagnostics.push(
            "The local branch contains commits not present in the pull request head.",
          );
        return {
          kind: "agent-repository-status",
          agentId,
          status: associated.some((item) => item.association !== "confirmed")
            ? "partial"
            : "complete",
          observedAt: now,
          diagnostics,
          git: local,
          pullRequests: associated,
          provider: provider.providerId,
          providerCached,
          plugins: pluginStatus,
        } satisfies AgentRepositoryStatusSnapshot;
      },
      catch: (error) =>
        error instanceof RepositoryStatusError
          ? error
          : new RepositoryStatusError(
              "inspection-failed",
              error instanceof Error ? error.message : "Repository inspection failed.",
            ),
    });
  }
}
