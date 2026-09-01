import type { AttentionAction, AttentionItem } from "../../src/attention/attention.ts";
import type { AgentView, CommandCentreProjection } from "../../src/projection/types.ts";
import { AgentLogo } from "./AgentLogo.tsx";
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
    agent,
    title: agent?.displayName ?? item.targetId,
    context: agent?.goalTitle ?? "Host observation",
  };
};

const sections: readonly { readonly action: AttentionAction; readonly title: string }[] = [
  { action: "respond", title: "Respond" },
  { action: "review", title: "Review results" },
  { action: "resolve", title: "Resolve" },
  { action: "monitor", title: "Monitor" },
];

export const AttentionQueue = ({
  projection,
  onClose,
  onSelect,
}: AttentionQueueProps): React.JSX.Element => {
  const agents = [...projection.goals.flatMap((goal) => goal.agents), ...projection.unassigned];
  const section = (title: string, items: readonly AttentionItem[]): React.JSX.Element | null => {
    if (items.length === 0) return null;
    return (
      <section className="queue-section">
        <div className="queue-section__title">
          <span>{title}</span>
          <b>{items.length}</b>
        </div>
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
              {label.agent ? (
                <AgentLogo harnessId={label.agent.harnessId} provider={label.agent.provider} />
              ) : (
                <i aria-hidden="true" />
              )}
              <span>
                <strong>{label.title}</strong>
                <small>{item.explanation}</small>
                {(item.supportingSignals?.length ?? 0) > 0 ? (
                  <span className="queue-item__supporting">
                    {item.supportingSignals?.map((signal) => (
                      <span key={signal.id}>Also observed: {signal.explanation}</span>
                    ))}
                  </span>
                ) : null}
                <em>{label.context}</em>
              </span>
            </button>
          );
        })}
      </section>
    );
  };
  const visibleSections = sections.flatMap(({ action, title }) => {
    const items = projection.attention.items.filter((item) => item.action === action);
    return items.length ? [{ action, title, items }] : [];
  });
  return (
    <aside className="attention-queue" aria-label="Needs you">
      <header>
        <div>
          <p className="overline">NEEDS YOU</p>
          <h2>Work requiring judgment</h2>
        </div>
        <button aria-label="Close needs-you queue" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="attention-queue__body">
        {visibleSections.length > 0 ? (
          visibleSections.map(({ action, title, items }) => (
            <div key={action}>{section(title, items)}</div>
          ))
        ) : (
          <p className="queue-empty">No current decisions or watch items.</p>
        )}
      </div>
      <footer>One subject per item · evidence remains independently sourced</footer>
    </aside>
  );
};
