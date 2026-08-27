import type { AttentionItem } from "../../src/attention/attention.ts";
import type { AgentView, CommandCentreProjection } from "../../src/projection/types.ts";
import type { Selection } from "./Atlas.tsx";

interface AttentionQueueProps {
  readonly projection: CommandCentreProjection;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
}

const labelForAttention = (item: AttentionItem, agents: readonly AgentView[]) => {
  const agent = item.agentId
    ? agents.find((candidate) => candidate.id === item.agentId)
    : undefined;
  return {
    title: agent?.displayName ?? item.targetId,
    context: agent?.goalTitle ?? "Host observation",
  };
};

export const AttentionQueue = ({
  projection,
  onClose,
  onSelect,
}: AttentionQueueProps): React.JSX.Element => {
  const agents = [...projection.goals.flatMap((goal) => goal.agents), ...projection.unassigned];
  const current = projection.attention.items.filter((item) => item.requiresHumanInput);
  const uncertain = projection.attention.items.filter((item) => !item.requiresHumanInput);
  const section = (title: string, items: readonly AttentionItem[]): React.JSX.Element => (
    <section className="queue-section">
      <div className="queue-section__title">
        <span>{title}</span>
        <b>{items.length}</b>
      </div>
      {items.length === 0 ? <p className="queue-empty">No signals in this group.</p> : null}
      {items.map((item) => {
        const label = labelForAttention(item, agents);
        const target: Selection | undefined = item.agentId
          ? { type: "agent", id: item.agentId }
          : item.goalId
            ? { type: "goal", id: item.goalId }
            : undefined;
        return (
          <button
            className="queue-item"
            disabled={!target}
            key={item.id}
            onClick={() => {
              if (target) onSelect(target);
            }}
            type="button"
          >
            <i aria-hidden="true" />
            <span>
              <strong>{label.title}</strong>
              <small>{item.explanation}</small>
              <em>{label.context}</em>
            </span>
          </button>
        );
      })}
    </section>
  );
  return (
    <aside className="attention-queue" aria-label="Attention queue">
      <header>
        <div>
          <p className="overline">ATTENTION QUEUE</p>
          <h2>Signals requiring judgment</h2>
        </div>
        <button aria-label="Close attention queue" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="attention-queue__body">
        {section("Needs you", current)}
        {section("Uncertain", uncertain)}
      </div>
      <footer>Observed facts only · no inferred acceptance</footer>
    </aside>
  );
};
