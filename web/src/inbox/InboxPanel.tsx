import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandCentreProjection } from "../../../src/projection/types.ts";
import { AgentLogo } from "../shared/AgentLogo.tsx";
import type { Selection } from "../app/selection.ts";

interface InboxPanelProps {
  readonly projection: CommandCentreProjection;
  readonly pending: boolean;
  readonly error?: string;
  readonly focusedAgentId?: string;
  readonly onAssign: (agentIds: readonly string[], goalId: string) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
}

export const InboxPanel = ({
  projection,
  pending,
  error,
  focusedAgentId,
  onAssign,
  onClose,
  onSelect,
}: InboxPanelProps): React.JSX.Element => {
  const focusedAgentRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [goalId, setGoalId] = useState(
    projection.goals.find((goal) => goal.status === "active")?.id ?? "",
  );
  const activeGoals = useMemo(
    () => projection.goals.filter((goal) => goal.status === "active"),
    [projection.goals],
  );
  const allSelected =
    projection.unassigned.length > 0 &&
    projection.unassigned.every((agent) => selectedIds.includes(agent.id));

  useEffect(() => {
    const available = new Set(projection.unassigned.map((agent) => agent.id));
    setSelectedIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
    if (goalId && !activeGoals.some((goal) => goal.id === goalId)) {
      setGoalId(activeGoals[0]?.id ?? "");
    }
  }, [activeGoals, goalId, projection.unassigned]);

  useEffect(() => {
    focusedAgentRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedAgentId]);

  const toggleAgent = (agentId: string): void => {
    setSelectedIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    );
  };

  const toggleAll = (): void => {
    setSelectedIds(allSelected ? [] : projection.unassigned.map((agent) => agent.id));
  };

  return (
    <aside aria-label="Unassigned inbox" className="inbox-panel">
      <header>
        <div>
          <p className="overline">INBOX / UNASSIGNED</p>
          <h2>Work awaiting a home</h2>
        </div>
        <button aria-label="Close inbox" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="inbox-panel__toolbar">
        <button onClick={toggleAll} type="button">
          {allSelected ? "Clear selection" : "Select all"}
        </button>
        <span>{selectedIds.length} selected</span>
      </div>
      <div className="inbox-panel__body">
        {projection.unassigned.length === 0 ? (
          <p className="inbox-panel__empty">No observed agents are waiting for organisation.</p>
        ) : (
          projection.unassigned.map((agent) => (
            <div
              className={`inbox-panel__item ${agent.id === focusedAgentId ? "is-focused" : ""}`}
              key={agent.id}
              ref={agent.id === focusedAgentId ? focusedAgentRef : undefined}
            >
              <input
                aria-label={`Select ${agent.displayName}`}
                checked={selectedIds.includes(agent.id)}
                onChange={() => toggleAgent(agent.id)}
                type="checkbox"
              />
              <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
              <button
                aria-current={agent.id === focusedAgentId ? "true" : undefined}
                className="inbox-panel__agent"
                onClick={() => onSelect({ type: "agent", id: agent.id })}
                type="button"
              >
                <strong>{agent.displayName}</strong>
                <small>{agent.goalTitle ?? "Unassigned observation"}</small>
                <em>{agent.lifecycleState}</em>
              </button>
            </div>
          ))
        )}
      </div>
      {error ? <p className="command-error">{error}</p> : null}
      <footer className="inbox-panel__assign">
        <label>
          <span>Assign selected to</span>
          <select
            disabled={activeGoals.length === 0 || pending}
            onChange={(event) => setGoalId(event.target.value)}
            value={goalId}
          >
            <option value="">Choose a goal</option>
            {activeGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.priority} · {goal.title}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={pending || selectedIds.length === 0 || !goalId}
          onClick={() => {
            void onAssign(selectedIds, goalId).then((succeeded) => {
              if (succeeded) setSelectedIds([]);
            });
          }}
          type="button"
        >
          {pending ? "Assigning…" : `Assign ${selectedIds.length || "selected"}`}
        </button>
      </footer>
    </aside>
  );
};
