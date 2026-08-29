import { Effect } from "effect";
import {
  CodeHostError,
  type CheckConclusion,
  type CodeHostingProvider,
  type ObservatoryPlugin,
  type PluginContext,
  type PullRequestStatus,
} from "../../src/plugin-sdk/index.ts";

interface GhPullRequest {
  readonly author?: { readonly login?: string };
  readonly baseRefName?: string;
  readonly headRefName?: string;
  readonly headRefOid?: string;
  readonly isDraft?: boolean;
  readonly mergeable?: string;
  readonly number?: number;
  readonly reviewDecision?: string;
  readonly state?: string;
  readonly statusCheckRollup?: readonly {
    readonly status?: string;
    readonly conclusion?: string;
  }[];
  readonly title?: string;
  readonly updatedAt?: string;
  readonly url?: string;
}

const checksFor = (checks: GhPullRequest["statusCheckRollup"]): CheckConclusion => {
  if (!checks || checks.length === 0) return "unknown";
  if (
    checks.some((check) =>
      ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(check.conclusion ?? ""),
    )
  )
    return "failing";
  if (checks.some((check) => check.status !== "COMPLETED" || !check.conclusion)) return "pending";
  return "passing";
};

const errorFor = (stderr: string): CodeHostError => {
  const detail = stderr.toLocaleLowerCase();
  if (detail.includes("auth") || detail.includes("login"))
    return new CodeHostError("authentication-required", "GitHub authentication is required.");
  if (detail.includes("rate limit"))
    return new CodeHostError("rate-limited", "GitHub rate limit reached.");
  return new CodeHostError("unavailable", "GitHub status is unavailable.");
};

const providerFor = (context: PluginContext): CodeHostingProvider => ({
  providerId: "github",
  supports: (repository) => repository.host === "github.com",
  pullRequests: (revision) =>
    Effect.tryPromise({
      try: async () => {
        const result = await context.process.run([
          "gh",
          "pr",
          "list",
          "--repo",
          `${revision.repository.owner}/${revision.repository.name}`,
          "--state",
          "all",
          "--head",
          revision.branch,
          "--limit",
          "20",
          "--json",
          "author,baseRefName,headRefName,headRefOid,isDraft,mergeable,number,reviewDecision,state,statusCheckRollup,title,updatedAt,url",
        ]);
        if (result.exitCode !== 0) throw errorFor(result.stderr);
        if (result.stdoutTruncated)
          throw new CodeHostError("invalid-response", "GitHub response exceeded the safe limit.");
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          throw new CodeHostError("invalid-response", "GitHub returned invalid JSON.");
        }
        if (!Array.isArray(parsed))
          throw new CodeHostError("invalid-response", "GitHub returned an unexpected response.");
        return parsed.map((value): PullRequestStatus => {
          // SAFETY: Required fields are validated immediately below before the observation escapes.
          const item = value as GhPullRequest;
          if (
            !item.number ||
            !item.url ||
            !item.title ||
            !item.baseRefName ||
            !item.headRefName ||
            !item.headRefOid
          )
            throw new CodeHostError(
              "invalid-response",
              "GitHub omitted required pull request fields.",
            );
          const state = item.state?.toLocaleLowerCase();
          return {
            providerId: "github",
            repository: revision.repository,
            number: item.number,
            url: item.url,
            title: item.title,
            state: state === "merged" ? "merged" : state === "closed" ? "closed" : "open",
            draft: item.isDraft === true,
            baseBranch: item.baseRefName,
            headBranch: item.headRefName,
            head: item.headRefOid,
            author: item.author?.login,
            checks: checksFor(item.statusCheckRollup),
            review:
              item.reviewDecision === "APPROVED"
                ? "approved"
                : item.reviewDecision === "CHANGES_REQUESTED"
                  ? "changes-requested"
                  : item.reviewDecision === "REVIEW_REQUIRED"
                    ? "review-required"
                    : "unknown",
            mergeability:
              item.mergeable === "MERGEABLE"
                ? "mergeable"
                : item.mergeable === "CONFLICTING"
                  ? "conflicting"
                  : "unknown",
            updatedAt: item.updatedAt,
          };
        });
      },
      catch: (error) =>
        error instanceof CodeHostError
          ? error
          : new CodeHostError("unavailable", "GitHub status is unavailable."),
    }),
});

export const plugin: ObservatoryPlugin = {
  async activate(context) {
    const availability = await context.process.run(["gh", "--version"], { maxOutputBytes: 8_000 });
    if (availability.exitCode !== 0) throw new Error("GitHub CLI is not available.");
    return { codeHosts: [providerFor(context)] };
  },
};
