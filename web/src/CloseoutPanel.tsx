import { useEffect, useState } from "react";
import type { AgentView, CloseoutProjection } from "../../src/projection/types.ts";
import type { Selection } from "./Atlas.tsx";

interface CloseoutPanelProps {
  readonly projection: CloseoutProjection;
  readonly pending: boolean;
  readonly error?: string;
  readonly onArchive: (agentIds: readonly string[]) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onCloseAndArchive: (agentIds: readonly string[]) => Promise<boolean>;
  readonly onReview: (agent: AgentView) => void;
  readonly onSelect: (selection: Selection) => void;
}

export const CloseoutPanel = ({
  projection,
  pending,
  error,
  onArchive,
  onClose,
  onCloseAndArchive,
  onReview,
  onSelect,
}: CloseoutPanelProps): React.JSX.Element => {
  const [selectedResults, setSelectedResults] = useState<readonly string[]>([]);
  const [selectedEnded, setSelectedEnded] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState<"results" | "ended">();

  useEffect(() => {
    const resultIds = new Set(projection.results.map((agent) => agent.id));
    const endedIds = new Set(projection.ended.map((agent) => agent.id));
    setSelectedResults((current) => current.filter((id) => resultIds.has(id)));
    setSelectedEnded((current) => current.filter((id) => endedIds.has(id)));
  }, [projection.ended, projection.results]);

  const lane = (
    title: string,
    description: string,
    agents: readonly AgentView[],
    selected: readonly string[],
    setSelected: (value: readonly string[]) => void,
    kind: "results" | "ended",
  ): React.JSX.Element => (
    <section className="closeout-lane">
      <div className="queue-section__title">
        <span>{title}</span>
        <b>{agents.length}</b>
      </div>
      <p className="closeout-lane__description">{description}</p>
      {agents.length === 0 ? <p className="queue-empty">Nothing in this lane.</p> : null}
      {agents.map((agent) => (
        <article className="closeout-item" key={agent.id}>
          <input
            aria-label={`Select ${agent.displayName}`}
            checked={selected.includes(agent.id)}
            onChange={() =>
              setSelected(
                selected.includes(agent.id)
                  ? selected.filter((candidate) => candidate !== agent.id)
                  : [...selected, agent.id],
              )
            }
            type="checkbox"
          />
          <button
            className="closeout-item__identity"
            onClick={() => onSelect({ type: "agent", id: agent.id })}
            type="button"
          >
            <strong>{agent.displayName}</strong>
            <small>{agent.goalTitle ?? "Unassigned"}</small>
            <em>{kind === "results" ? "reported done" : "ended in host"}</em>
          </button>
          <div className="closeout-item__actions">
            {kind === "results" ? (
              <button onClick={() => onReview(agent)} type="button">
                Review
              </button>
            ) : null}
            <button
              disabled={pending}
              onClick={() => {
                void (kind === "results" ? onCloseAndArchive([agent.id]) : onArchive([agent.id]));
              }}
              type="button"
            >
              {kind === "results" ? "Close & archive" : "Archive"}
            </button>
          </div>
        </article>
      ))}
      {selected.length > 0 && confirming !== kind ? (
        <button className="closeout-lane__batch" onClick={() => setConfirming(kind)} type="button">
          {kind === "results"
            ? `Close ${selected.length} selected`
            : `Archive ${selected.length} selected`}
        </button>
      ) : null}
      {confirming === kind ? (
        <div className="confirm-action closeout-lane__confirm">
          <p>
            {kind === "results"
              ? `Close ${selected.length} host executions and archive their Observatory records?`
              : `Archive ${selected.length} Agents already ended in the host?`}
          </p>
          <button
            disabled={pending}
            onClick={() => {
              const action = kind === "results" ? onCloseAndArchive : onArchive;
              void action(selected).then((succeeded) => {
                if (!succeeded) return;
                setSelected([]);
                setConfirming(undefined);
              });
            }}
            type="button"
          >
            Confirm
          </button>
          <button onClick={() => setConfirming(undefined)} type="button">
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );

  return (
    <aside aria-label="Agent closeout" className="closeout-panel">
      <header>
        <div>
          <p className="overline">CLOSEOUT / HOST-SYNCHRONISED</p>
          <h2>Review results and clear ended work</h2>
        </div>
        <button aria-label="Close closeout" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="closeout-panel__body">
        {lane(
          "Results to review",
          "Runtime done is a report, not accepted completion.",
          projection.results,
          selectedResults,
          setSelectedResults,
          "results",
        )}
        {lane(
          "Ended externally",
          "The host confirms these executions are absent.",
          projection.ended,
          selectedEnded,
          setSelectedEnded,
          "ended",
        )}
      </div>
      {error ? <p className="command-error">{error}</p> : null}
      <footer>Closing affects the host; archive only affects Observatory visibility.</footer>
    </aside>
  );
};
