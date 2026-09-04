import { useEffect, useState } from "react";
import type { AgentView } from "../../../src/projection/types.ts";
import type { WebAgentRepositoryStatusResponse } from "../../../src/web/protocol.ts";
import { summarizeIntegrationReadiness } from "../../../src/repositories/review-summary.ts";
import { fetchAgentRepositoryStatus } from "../api/client.ts";

interface ReviewEvidenceProps {
  readonly agent: AgentView;
  readonly refreshNonce: number;
}

const evidenceValue = (value: string | number | undefined): string =>
  value === undefined ? "Unknown" : String(value);

export const ReviewEvidence = ({ agent, refreshNonce }: ReviewEvidenceProps): React.JSX.Element => {
  const [snapshot, setSnapshot] = useState<WebAgentRepositoryStatusResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void fetchAgentRepositoryStatus(agent.id, {
      refresh: refreshNonce > 0,
      signal: controller.signal,
    })
      .then(setSnapshot)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Review evidence is unavailable.");
      });
    return () => controller.abort();
  }, [agent.id, refreshNonce]);

  const integration = snapshot ? summarizeIntegrationReadiness(snapshot) : undefined;
  const pullRequest = snapshot?.pullRequests.length === 1 ? snapshot.pullRequests[0] : undefined;

  return (
    <section className="review-evidence" aria-label="Review evidence">
      <header>
        <p className="overline">VERIFICATION</p>
        <h3>Review evidence</h3>
      </header>
      <dl>
        <div>
          <dt>Provider outcome</dt>
          <dd>{agent.providerEvidence?.outcome ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{agent.runtimeState}</dd>
        </div>
        <div>
          <dt>Working tree</dt>
          <dd>{snapshot?.git?.diff.status ?? "Checking…"}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{snapshot?.git?.branch ?? agent.branch ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>{pullRequest?.checks ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{pullRequest?.review ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Mergeability</dt>
          <dd>{pullRequest?.mergeability ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Remote</dt>
          <dd>
            {snapshot?.git
              ? `${evidenceValue(snapshot.git.ahead)} ahead · ${evidenceValue(snapshot.git.behind)} behind`
              : "Unknown"}
          </dd>
        </div>
      </dl>
      {integration?.warnings.length ? (
        <div className="review-evidence__warnings">
          <h4>Requires judgment</h4>
          <ul>
            {integration.warnings.map((warning) => (
              <li key={`${warning.kind}:${warning.message}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {pullRequest?.association === "confirmed" ? (
        <a href={pullRequest.url} rel="noreferrer" target="_blank">
          Open pull request ↗
        </a>
      ) : null}
      {snapshot?.diagnostics.map((diagnostic) => (
        <p className="review-evidence__diagnostic" key={diagnostic}>
          {diagnostic}
        </p>
      ))}
      {error ? <p className="review-evidence__diagnostic">{error}</p> : null}
      {!snapshot && !error ? (
        <p className="review-evidence__loading" role="status">
          Reading repository evidence…
        </p>
      ) : null}
    </section>
  );
};
