import type { AgentRepositoryStatusSnapshot } from "./types.ts";

export type IntegrationWarningKind =
  | "dirty-worktree"
  | "local-ahead"
  | "failing-checks"
  | "changes-requested"
  | "conflict"
  | "ambiguous-association"
  | "unavailable";

export interface IntegrationWarning {
  readonly kind: IntegrationWarningKind;
  readonly message: string;
}

export interface IntegrationReviewSummary {
  readonly warnings: readonly IntegrationWarning[];
  readonly information: readonly string[];
}

export const NO_PULL_REQUEST_DIAGNOSTIC = "No pull request found for this repository and branch.";

export const summarizeIntegrationReadiness = (
  snapshot: AgentRepositoryStatusSnapshot,
): IntegrationReviewSummary => {
  const warnings: IntegrationWarning[] = [];
  const information: string[] = [];
  const diff = snapshot.git?.diff;

  if (diff?.status === "changed") {
    const untracked = diff.files.filter((file) => file.status === "untracked").length;
    const detail = untracked > 0 ? `, including ${untracked} untracked` : "";
    warnings.push({
      kind: "dirty-worktree",
      message: `Local worktree has ${diff.files.length} changed file${diff.files.length === 1 ? "" : "s"}${detail}.`,
    });
  } else if (diff?.status === "unavailable") {
    warnings.push({
      kind: "unavailable",
      message: diff.message
        ? `Local worktree evidence is unavailable: ${diff.message}`
        : "Local worktree evidence is unavailable.",
    });
  }

  const ambiguous = snapshot.pullRequests.some(
    (pullRequest) => pullRequest.association === "ambiguous",
  );
  const candidate = snapshot.pullRequests.some(
    (pullRequest) => pullRequest.association === "candidate",
  );
  if (ambiguous) {
    warnings.push({
      kind: "ambiguous-association",
      message: "Pull request association is ambiguous; review the candidates in the Inspector.",
    });
  } else if (candidate) {
    warnings.push({
      kind: "ambiguous-association",
      message: "Pull request association is unconfirmed; review it in the Inspector.",
    });
  }

  for (const pullRequest of snapshot.pullRequests.filter(
    (candidatePullRequest) => candidatePullRequest.association === "confirmed",
  )) {
    if (pullRequest.headSync === "local-ahead")
      warnings.push({
        kind: "local-ahead",
        message: `Local commits are absent from pull request #${pullRequest.number}.`,
      });
    if (pullRequest.checks === "failing")
      warnings.push({
        kind: "failing-checks",
        message: `Pull request #${pullRequest.number} has failing checks.`,
      });
    if (pullRequest.review === "changes-requested")
      warnings.push({
        kind: "changes-requested",
        message: `Pull request #${pullRequest.number} has requested changes.`,
      });
    if (pullRequest.mergeability === "conflicting")
      warnings.push({
        kind: "conflict",
        message: `Pull request #${pullRequest.number} has merge conflicts.`,
      });
    if (
      pullRequest.headSync === "unknown" ||
      pullRequest.checks === "unknown" ||
      pullRequest.review === "unknown" ||
      pullRequest.mergeability === "unknown"
    )
      warnings.push({
        kind: "unavailable",
        message: `Integration evidence for pull request #${pullRequest.number} is incomplete.`,
      });
  }

  const noPullRequest = snapshot.diagnostics.includes(NO_PULL_REQUEST_DIAGNOSTIC);
  if (noPullRequest) information.push("No pull request found; a pull request is not required.");

  const hasAssociationWarning = warnings.some(
    (warning) => warning.kind === "ambiguous-association",
  );
  const needsUnavailableWarning =
    snapshot.status === "unavailable" ||
    snapshot.status === "not-applicable" ||
    (snapshot.status === "partial" && !hasAssociationWarning);
  if (needsUnavailableWarning && !warnings.some((warning) => warning.kind === "unavailable")) {
    const diagnostic = snapshot.diagnostics.find(
      (candidateDiagnostic) => candidateDiagnostic !== NO_PULL_REQUEST_DIAGNOSTIC,
    );
    warnings.push({
      kind: "unavailable",
      message: diagnostic
        ? `Repository integration evidence is unavailable: ${diagnostic}`
        : "Repository integration evidence is unavailable.",
    });
  }

  return { warnings, information };
};
