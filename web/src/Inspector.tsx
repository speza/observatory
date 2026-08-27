import { useEffect, useState } from "react";
import type {
  AgentView,
  CommandCentreProjection,
  InspectorProjection,
} from "../../src/projection/types.ts";
import type { Priority } from "../../src/universe/types.ts";
import type { WebCommand, WebCommandResponse } from "../../src/web/protocol.ts";

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
}

const priorities: readonly Priority[] = ["P0", "P1", "P2", "P3"];

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
}: InspectorProps): React.JSX.Element => {
  const goal = projection?.kind === "goal-inspector" ? projection.goal : undefined;
  const agent = projection?.kind === "agent-inspector" ? projection.agent : undefined;
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
          <div className="inspector__controls">
            <button onClick={() => onOpenTerminal(projection.agent)} type="button">
              Open terminal
            </button>
            <button onClick={() => onReviewChanges(projection.agent)} type="button">
              Review workspace changes
            </button>
            <label>
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
            {projection.agent.hostHealth === "live" && confirming !== "agent-close" ? (
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
                {projection.agent.hostHealth === "live" ? "Archive only…" : "Archive Agent…"}
              </button>
            ) : null}
            {confirming === "agent-archive" ? (
              <div className="confirm-action">
                <p>
                  {projection.agent.hostHealth === "live"
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
          <dl>
            <div>
              <dt>Runtime</dt>
              <dd>{projection.agent.runtimeState}</dd>
            </div>
            <div>
              <dt>Host fact</dt>
              <dd>{projection.agent.hostHealth}</dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd>{projection.agent.repository ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{projection.agent.branch ?? "Unknown"}</dd>
            </div>
          </dl>
        </>
      ) : null}
      {commandError ? <p className="command-error">{commandError}</p> : null}
      <footer>Commands are validated and persisted by the Universe.</footer>
    </aside>
  );
};
