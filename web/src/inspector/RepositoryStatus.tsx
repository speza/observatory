import { useEffect, useState } from "react";
import type { AgentView } from "../../../src/projection/types.ts";
import type { WebAgentRepositoryStatusResponse } from "../../../src/web/protocol.ts";
import { summarizeIntegrationReadiness } from "../../../src/repositories/review-summary.ts";
import { fetchAgentRepositoryStatus } from "../api/client.ts";
import { GitHubMark } from "../shared/GitHubMark.tsx";

interface RepositoryStatusProps {
  readonly agent: AgentView;
  readonly onReviewChanges: (agent: AgentView) => void;
}

const abbreviated = (value: string): string => value.slice(0, 8);
const NO_PULL_REQUEST = "No pull request found for this repository and branch.";
const CLIENT_CACHE_TTL_MS = 60_000;
const snapshotCache = new Map<
  string,
  { readonly snapshot: WebAgentRepositoryStatusResponse; readonly storedAt: number }
>();

const cachedSnapshot = (agentId: string): WebAgentRepositoryStatusResponse | undefined => {
  const cached = snapshotCache.get(agentId);
  if (!cached || Date.now() - cached.storedAt > CLIENT_CACHE_TTL_MS) {
    snapshotCache.delete(agentId);
    return undefined;
  }
  return cached.snapshot;
};

const checkoutSummary = (
  snapshot: WebAgentRepositoryStatusResponse,
): { readonly label: string; readonly detail: string; readonly tone: string } | undefined => {
  const git = snapshot.git;
  if (!git) return undefined;
  if (git.diff.status === "clean")
    return { label: "Working tree clean", detail: "No local file changes", tone: "clean" };
  if (git.diff.status === "changed") {
    const untracked = git.diff.files.filter((file) => file.status === "untracked").length;
    const detail = [
      `${git.diff.files.length} changed file${git.diff.files.length === 1 ? "" : "s"}`,
      `${git.diff.additions} additions`,
      `${git.diff.deletions} deletions`,
      untracked > 0 ? `${untracked} untracked` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return { label: "Local changes", detail, tone: "changed" };
  }
  return {
    label: "Working tree uncertain",
    detail: git.diff.message ?? "Local changes could not be fully inspected",
    tone: "uncertain",
  };
};

export const RepositoryStatus = ({
  agent,
  onReviewChanges,
}: RepositoryStatusProps): React.JSX.Element => {
  const [snapshot, setSnapshot] = useState<WebAgentRepositoryStatusResponse | undefined>(() =>
    cachedSnapshot(agent.id),
  );
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setLoading(true);
    void fetchAgentRepositoryStatus(agent.id, {
      refresh: revision > 0,
      signal: controller.signal,
    })
      .then((nextSnapshot) => {
        snapshotCache.set(agent.id, { snapshot: nextSnapshot, storedAt: Date.now() });
        setSnapshot(nextSnapshot);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Repository status is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agent.id, revision]);

  const pullRequest = snapshot?.pullRequests.length === 1 ? snapshot.pullRequests[0] : undefined;
  const checkout = snapshot ? checkoutSummary(snapshot) : undefined;
  const integration = snapshot ? summarizeIntegrationReadiness(snapshot) : undefined;
  const noPullRequest = snapshot?.diagnostics.includes(NO_PULL_REQUEST);
  const otherDiagnostics = snapshot?.diagnostics.filter(
    (diagnostic) => diagnostic !== NO_PULL_REQUEST,
  );
  const observedRepository = agent.repository;
  return (
    <section className="repository-status" aria-label="Repository status">
      <div className="repository-status__heading">
        <div>
          <p className="overline">REPOSITORY</p>
          <h3>Code status</h3>
        </div>
        <button
          className="repository-status__refresh"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
          type="button"
        >
          {loading && snapshot ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {!snapshot && !error ? (
        <div className="repository-status__loading" role="status">
          {observedRepository ? (
            <div className="repository-status__identity is-observed">
              <div>
                <span>Observed workspace</span>
                <strong>{observedRepository}</strong>
              </div>
            </div>
          ) : null}
          <div className="repository-status__loading-row">
            <span aria-hidden="true" />
            <div>
              <strong>Checking current checkout</strong>
              <p>Reading local Git and code-host status…</p>
            </div>
          </div>
          {agent.branch ? (
            <div className="repository-status__branch is-observed">
              <span>Observed branch</span>
              <code>{agent.branch}</code>
            </div>
          ) : null}
          <div className="repository-status__loading-metadata" aria-hidden="true">
            <span />
            <span />
          </div>
        </div>
      ) : null}
      {error ? <p className="repository-status__diagnostic">{error}</p> : null}
      {snapshot?.git ? (
        <>
          <div className="repository-status__identity">
            {snapshot.git.repository.host === "github.com" ? (
              <GitHubMark className="repository-status__github-mark" />
            ) : null}
            <div>
              <span>{snapshot.git.repository.host}</span>
              <strong>
                {snapshot.git.repository.owner}/{snapshot.git.repository.name}
              </strong>
            </div>
          </div>
          {checkout ? (
            <div className={`repository-status__summary is-${checkout.tone}`}>
              <span aria-hidden="true" />
              <div>
                <strong>{checkout.label}</strong>
                <p>{checkout.detail}</p>
              </div>
            </div>
          ) : null}
          <div className="repository-status__branch">
            <span>BRANCH</span>
            <code>{snapshot.git.branch ?? "Detached HEAD"}</code>
          </div>
          <div className="repository-status__metadata">
            <div>
              <span>HEAD</span>
              <code>{abbreviated(snapshot.git.head)}</code>
            </div>
            <div>
              <span>REMOTE</span>
              <strong>
                {snapshot.git.ahead === undefined
                  ? "Not tracked"
                  : snapshot.git.ahead === 0 && (snapshot.git.behind ?? 0) === 0
                    ? "Up to date"
                    : `${snapshot.git.ahead} ahead · ${snapshot.git.behind ?? 0} behind`}
              </strong>
            </div>
          </div>
        </>
      ) : null}
      {(integration?.warnings.length ?? 0) > 0 ? (
        <ul className="repository-status__warnings" aria-label="Integration warnings">
          {integration?.warnings.map((warning) => (
            <li key={`${warning.kind}:${warning.message}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
      {snapshot?.git?.diff.status === "changed" ? (
        <button
          className="repository-status__review"
          onClick={() => onReviewChanges(agent)}
          type="button"
        >
          Review changes
        </button>
      ) : null}
      {pullRequest ? (
        <article className="repository-status__pr">
          <div>
            <span className={`repository-status__signal is-${pullRequest.checks}`}>
              {pullRequest.checks}
            </span>
            <span>{pullRequest.association}</span>
          </div>
          <h4>
            #{pullRequest.number} · {pullRequest.title}
          </h4>
          <p>
            {pullRequest.baseBranch} ← {pullRequest.headBranch} · {pullRequest.review} ·{" "}
            {pullRequest.mergeability}
          </p>
          {pullRequest.association === "confirmed" ? (
            <a href={pullRequest.url} rel="noreferrer" target="_blank">
              Open on GitHub
            </a>
          ) : null}
        </article>
      ) : null}
      {noPullRequest ? (
        <div className="repository-status__empty">
          <strong>No pull request</strong>
          <p>Nothing on the code host is linked to this branch yet.</p>
        </div>
      ) : null}
      {otherDiagnostics?.map((diagnostic) => (
        <p className="repository-status__diagnostic" key={diagnostic}>
          {diagnostic}
        </p>
      ))}
      {snapshot?.plugins
        .filter((plugin) => plugin.state !== "ready")
        .map((plugin) => (
          <p className="repository-status__diagnostic" key={plugin.id}>
            {plugin.id}: {plugin.diagnostics.join(" ") || plugin.state}
          </p>
        ))}
      {snapshot?.providerCached ? (
        <p className="repository-status__cached">Code-host status from cache</p>
      ) : null}
      {loading && snapshot ? (
        <p className="repository-status__cached" role="status">
          Checking for newer status…
        </p>
      ) : null}
    </section>
  );
};
