import { useEffect, useState } from "react";
import type {
  AgentView,
  CommandCentreProjection,
  InspectorProjection,
} from "../../src/projection/types.ts";
import type { Priority } from "../../src/universe/types.ts";
import type { WebCommand, WebCommandResponse } from "../../src/web/protocol.ts";
import { RepositoryStatus } from "./RepositoryStatus.tsx";

interface InspectorProps {
  readonly projection?: InspectorProjection;
  readonly error?: string;
  readonly commandCentre: CommandCentreProjection;
  readonly commandError?: string;
  readonly commandPending: boolean;
  readonly onCommand: (command: WebCommand) => Promise<WebCommandResponse | undefined>;
  readonly onCloseAndArchive: (agentIds: readonly string[]) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onOpenTerminal: (agent: AgentView) => void;
  readonly onRetry: () => void;
  readonly onReviewChanges: (agent: AgentView) => void;
  readonly onResume: (agent: AgentView) => Promise<void>;
}

const priorities: readonly Priority[] = ["P0", "P1", "P2", "P3"];

const decisionTitle = {
  respond: "Response needed",
  review: "Review result",
  resolve: "Resolve lifecycle",
  monitor: "Monitor uncertainty",
} as const;

const copyIdentifier = (value: string): void => {
  void navigator.clipboard.writeText(value);
};

export const Inspector = ({
  projection,
  error,
  commandCentre,
  commandError,
  commandPending,
  onCommand,
  onCloseAndArchive,
  onClose,
  onOpenTerminal,
  onRetry,
  onReviewChanges,
  onResume,
}: InspectorProps): React.JSX.Element => {
  const goal = projection?.kind === "goal-inspector" ? projection.goal : undefined;
  const agent = projection?.kind === "agent-inspector" ? projection.agent : undefined;
  const conversationId =
    projection?.kind === "agent-inspector" ? projection.conversation?.id : undefined;
  const executionId = agent?.execution?.nativeId;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [confirming, setConfirming] = useState<"goal" | "agent-archive" | "agent-close">();

  useEffect(() => {
    setTitle(goal?.title ?? "");
    setDescription(goal?.description ?? "");
    setConfirming(undefined);
  }, [goal?.description, goal?.id, goal?.title, agent?.id]);

  const heading =
    projection?.kind === "goal-inspector"
      ? projection.goal.title
      : projection?.kind === "agent-inspector"
        ? projection.agent.displayName
        : "Selection";
  return (
    <aside className="inspector" aria-label="Selection inspector">
      <header>
        <div>
          <p className="overline">INSPECTOR / OBSERVED STATE</p>
          <h2>{heading}</h2>
        </div>
        <button aria-label="Close inspector" onClick={onClose} type="button">
          ×
        </button>
      </header>
      {!projection && !error ? <p className="inspector__loading">Loading trusted facts…</p> : null}
      {error ? (
        <div className="inspector__error">
          <p>{error}</p>
          <button onClick={onRetry} type="button">
            Try again
          </button>
        </div>
      ) : null}
      {goal ? (
        <div className="inspector__controls">
          <label>
            <span>Goal title</span>
            <input onChange={(event) => setTitle(event.target.value)} value={title} />
          </label>
          <label>
            <span>Description</span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Why this goal exists and what success looks like"
              rows={4}
              value={description}
            />
          </label>
          <button
            disabled={commandPending || !title.trim()}
            onClick={() => {
              void (async () => {
                if (
                  title !== goal.title &&
                  !(await onCommand({ type: "RenameGoal", goalId: goal.id, title }))
                )
                  return;
                if (description !== (goal.description ?? ""))
                  await onCommand({
                    type: "SetGoalDescription",
                    goalId: goal.id,
                    description,
                  });
              })();
            }}
            type="button"
          >
            Save goal details
          </button>
          <label>
            <span>System</span>
            <select
              disabled={commandPending}
              onChange={(event) =>
                void onCommand({
                  type: "AssignGoalToSystem",
                  goalId: goal.id,
                  systemId: event.target.value || undefined,
                })
              }
              value={goal.systemId ?? ""}
            >
              <option value="">No system</option>
              {commandCentre.systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.title}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Priority</legend>
            <div className="priority-picker">
              {priorities.map((priority) => (
                <button
                  aria-pressed={goal.priority === priority}
                  disabled={commandPending}
                  key={priority}
                  onClick={() =>
                    void onCommand({ type: "SetGoalPriority", goalId: goal.id, priority })
                  }
                  type="button"
                >
                  {priority}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="lifecycle-actions">
            {goal.status === "active" ? (
              <button
                disabled={commandPending}
                onClick={() => void onCommand({ type: "CompleteGoal", goalId: goal.id })}
                type="button"
              >
                Mark complete
              </button>
            ) : null}
            {goal.status === "completed" && confirming !== "goal" ? (
              <button onClick={() => setConfirming("goal")} type="button">
                Archive goal…
              </button>
            ) : null}
            {confirming === "goal" ? (
              <div className="confirm-action">
                <p>Archive this completed goal? It will leave active projections.</p>
                <button
                  disabled={commandPending}
                  onClick={() => {
                    void onCommand({ type: "ArchiveGoal", goalId: goal.id }).then((response) => {
                      if (response) onClose();
                    });
                  }}
                  type="button"
                >
                  Confirm archive
                </button>
                <button onClick={() => setConfirming(undefined)} type="button">
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {projection?.kind === "agent-inspector" ? (
        <>
          {projection.agent.attention ? (
            <section className="inspector__decision" aria-label="Current decision">
              <p className="overline">{decisionTitle[projection.agent.attention.action]}</p>
              <h3>{projection.agent.attention.explanation}</h3>
              {(projection.agent.attention.supportingSignals?.length ?? 0) > 0 ? (
                <ul>
                  {projection.agent.attention.supportingSignals?.map((signal) => (
                    <li key={signal.id}>Also observed: {signal.explanation}</li>
                  ))}
                </ul>
              ) : null}
              <p>Evidence is not accepted completion.</p>
            </section>
          ) : null}
          <section className="inspector__agent-summary" aria-label="Agent summary and actions">
            <div className="inspector__status-line">
              <span className={`is-${projection.agent.runtimeState}`} aria-hidden="true" />
              <strong>{projection.agent.runtimeState.replace("-", " ")}</strong>
              <span>
                {projection.agent.harnessId ?? projection.agent.provider ?? "Unknown provider"}
              </span>
            </div>
            <label className="inspector__assignment">
              <span>Assigned goal</span>
              <select
                disabled={commandPending}
                onChange={(event) => {
                  const goalId = event.target.value;
                  void onCommand(
                    goalId
                      ? { type: "AssignAgent", agentId: projection.agent.id, goalId }
                      : { type: "UnassignAgent", agentId: projection.agent.id },
                  );
                }}
                value={projection.agent.primaryGoalId ?? ""}
              >
                <option value="">Unassigned inbox</option>
                {commandCentre.goals
                  .filter((candidate) => candidate.status === "active")
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.priority} · {candidate.title}
                    </option>
                  ))}
              </select>
            </label>
            <nav className="inspector__actions" aria-label="Agent actions">
              {projection.agent.canResume ? (
                <button
                  className="is-primary"
                  disabled={commandPending}
                  onClick={() => void onResume(projection.agent)}
                  type="button"
                >
                  Resume conversation
                </button>
              ) : null}
              {projection.agent.executionPresence === "live" ? (
                <button
                  className={
                    projection.agent.canResume || projection.agent.attention?.action === "review"
                      ? undefined
                      : "is-primary"
                  }
                  onClick={() => onOpenTerminal(projection.agent)}
                  type="button"
                >
                  Open terminal
                </button>
              ) : null}
              <button
                className={
                  projection.agent.attention?.action === "review" ? "is-primary" : undefined
                }
                onClick={() => onReviewChanges(projection.agent)}
                type="button"
              >
                Review changes
              </button>
            </nav>
          </section>
          <RepositoryStatus
            agent={projection.agent}
            key={projection.agent.id}
            onReviewChanges={onReviewChanges}
          />
          {projection.agent.providerEvidence ? (
            <section className="provider-evidence" aria-label="Provider observations">
              <div className="provider-evidence__heading">
                <div>
                  <p className="overline">PROVIDER SIGNALS</p>
                  <h3>{projection.agent.providerEvidence.providerLabel}</h3>
                </div>
                <strong>{projection.agent.providerEvidence.health.replace("-", " ")}</strong>
              </div>
              <p className="provider-evidence__provenance">
                Observations only · not accepted state
                {projection.agent.providerEvidence.mechanism
                  ? ` · ${projection.agent.providerEvidence.mechanism.replace("-", " ")}`
                  : ""}
              </p>
              <dl>
                <div>
                  <dt>Activity</dt>
                  <dd>
                    {projection.agent.providerEvidence.activity ?? "Unknown"}
                    {projection.agent.providerEvidence.toolCategory
                      ? ` · ${projection.agent.providerEvidence.toolCategory} tool`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Human request</dt>
                  <dd>
                    {projection.agent.providerEvidence.request
                      ? `${projection.agent.providerEvidence.request.kind.replace("-", " ")} · ${projection.agent.providerEvidence.request.state}`
                      : "None observed"}
                  </dd>
                </div>
                <div>
                  <dt>Turn outcome</dt>
                  <dd>
                    {projection.agent.providerEvidence.outcome
                      ? `Provider reported ${projection.agent.providerEvidence.outcome.replaceAll("-", " ")}`
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>
                    {projection.agent.providerEvidence.contextBand ?? "Unknown"}
                    {projection.agent.providerEvidence.compaction
                      ? ` · compaction ${projection.agent.providerEvidence.compaction}`
                      : ""}
                  </dd>
                </div>
              </dl>
              <p className="provider-evidence__note">
                A provider response does not complete this Agent or its Goal.
              </p>
              {projection.agent.providerEvidence.hostConflict ? (
                <p className="provider-evidence__conflict">
                  Evidence conflict: the provider reports{" "}
                  {projection.agent.providerEvidence.hostConflict.providerActivity.replace(
                    "-",
                    " ",
                  )}
                  {" activity while the host reports "}
                  {projection.agent.providerEvidence.hostConflict.hostState}.
                </p>
              ) : null}
            </section>
          ) : null}
          <details className="inspector__disclosure">
            <summary>
              <span>Technical details</span>
              <small>Conversation, runtime and workspace</small>
            </summary>
            <div className="inspector__details-body">
              <h4>Conversation</h4>
              <dl>
                <div>
                  <dt>Provider</dt>
                  <dd>{projection.agent.harnessId ?? projection.agent.provider ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{projection.agent.providerContinuity}</dd>
                </div>
                <div>
                  <dt>Conversation ID</dt>
                  <dd className="inspector__identifier">
                    {conversationId ? (
                      <>
                        <code title={conversationId}>{conversationId}</code>
                        <button onClick={() => copyIdentifier(conversationId)} type="button">
                          Copy
                        </button>
                      </>
                    ) : (
                      "Unavailable"
                    )}
                  </dd>
                </div>
              </dl>
              <h4>Runtime</h4>
              <dl>
                <div>
                  <dt>State</dt>
                  <dd>{projection.agent.lifecycleState}</dd>
                </div>
                <div>
                  <dt>Execution</dt>
                  <dd>{projection.agent.executionPresence}</dd>
                </div>
                <div>
                  <dt>Execution ID</dt>
                  <dd className="inspector__identifier">
                    {executionId ? (
                      <>
                        <code title={executionId}>{executionId}</code>
                        <button onClick={() => copyIdentifier(executionId)} type="button">
                          Copy
                        </button>
                      </>
                    ) : (
                      "No current execution"
                    )}
                  </dd>
                </div>
              </dl>
              <h4>Context</h4>
              <dl>
                <div>
                  <dt>Workspace</dt>
                  <dd title={projection.agent.worktree}>
                    {projection.agent.worktree ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Agent ID</dt>
                  <dd className="inspector__identifier">
                    <code title={projection.agent.id}>{projection.agent.id}</code>
                    <button onClick={() => copyIdentifier(projection.agent.id)} type="button">
                      Copy
                    </button>
                  </dd>
                </div>
              </dl>
            </div>
          </details>
          <details className="inspector__disclosure inspector__disclosure--lifecycle">
            <summary>
              <span>Agent lifecycle</span>
              <small>Close or archive this Agent</small>
            </summary>
            <div className="inspector__lifecycle-actions">
              {projection.agent.executionPresence === "live" && confirming !== "agent-close" ? (
                <button onClick={() => setConfirming("agent-close")} type="button">
                  Close & archive…
                </button>
              ) : null}
              {confirming === "agent-close" ? (
                <div className="confirm-action">
                  <p>
                    {projection.agent.runtimeState === "done"
                      ? "Close this host execution and archive its Observatory record? Runtime done is not verification."
                      : `Stop this ${projection.agent.runtimeState} Agent in the host and archive its Observatory record?`}
                  </p>
                  <button
                    disabled={commandPending}
                    onClick={() => {
                      void onCloseAndArchive([projection.agent.id]).then((succeeded) => {
                        if (succeeded) onClose();
                      });
                    }}
                    type="button"
                  >
                    Confirm close & archive
                  </button>
                  <button onClick={() => setConfirming(undefined)} type="button">
                    Cancel
                  </button>
                </div>
              ) : null}
              {confirming !== "agent-archive" ? (
                <button onClick={() => setConfirming("agent-archive")} type="button">
                  {projection.agent.executionPresence === "live"
                    ? "Archive only…"
                    : "Archive Agent…"}
                </button>
              ) : null}
              {confirming === "agent-archive" ? (
                <div className="confirm-action">
                  <p>
                    {projection.agent.executionPresence === "live"
                      ? "Hide this Agent from active Observatory views while leaving its host execution running?"
                      : "Archive this ended or unavailable observation? Its identity and history are retained."}
                  </p>
                  <button
                    disabled={commandPending}
                    onClick={() => {
                      void onCommand({ type: "ArchiveAgent", agentId: projection.agent.id }).then(
                        (response) => {
                          if (response) onClose();
                        },
                      );
                    }}
                    type="button"
                  >
                    Confirm archive
                  </button>
                  <button onClick={() => setConfirming(undefined)} type="button">
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
      {commandError ? <p className="command-error">{commandError}</p> : null}
      <footer>Commands are validated and persisted by the Universe.</footer>
    </aside>
  );
};
