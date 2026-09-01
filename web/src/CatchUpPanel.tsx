import type { CatchUpProjection } from "../../src/projection/types.ts";
import type { Selection } from "./Atlas.tsx";

interface CatchUpPanelProps {
  readonly projection: CatchUpProjection;
  readonly pending: boolean;
  readonly onAcknowledge: () => Promise<void>;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
  readonly onSelectSystem: (systemId: string) => void;
}

export const CatchUpPanel = ({
  projection,
  pending,
  onAcknowledge,
  onClose,
  onSelect,
  onSelectSystem,
}: CatchUpPanelProps): React.JSX.Element => (
  <aside aria-label="Catch up" className="catch-up-panel">
    <header>
      <div>
        <p className="overline">SINCE YOUR LAST CHECKPOINT</p>
        <h2>{projection.pending ? "What changed while you were away" : "You are caught up"}</h2>
      </div>
      <button aria-label="Close catch up" onClick={onClose} type="button">
        ×
      </button>
    </header>
    {projection.groups.length > 0 || (projection.evidenceGroups?.length ?? 0) > 0 ? (
      <div className="catch-up-panel__groups">
        {projection.groups.map((group) => (
          <section key={group.outcome}>
            <div className="catch-up-panel__group-title">
              <span>{group.label}</span>
              <b>{group.items.length}</b>
            </div>
            {group.items.slice(0, 5).map((item) => (
              <button
                key={item.sequence}
                onClick={() =>
                  item.targetType === "system"
                    ? onSelectSystem(item.targetId)
                    : onSelect({ type: item.targetType, id: item.targetId })
                }
                type="button"
              >
                <span>{item.summary}</span>
                <time>
                  {new Date(item.occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </button>
            ))}
            {group.items.length > 5 ? <p>+ {group.items.length - 5} more</p> : null}
          </section>
        ))}
        {projection.evidenceGroups?.map((group) => (
          <section key={`evidence:${group.kind}`}>
            <div className="catch-up-panel__group-title">
              <span>{group.label} · observed evidence</span>
              <b>{group.items.length}</b>
            </div>
            {group.items.slice(0, 5).map((item) => (
              <button
                key={`evidence:${item.sequence}`}
                onClick={() => onSelect({ type: "agent", id: item.agentId })}
                type="button"
              >
                <span>{item.summary}</span>
                <time>
                  {new Date(item.occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </button>
            ))}
          </section>
        ))}
      </div>
    ) : (
      <p className="catch-up-panel__empty">
        No accepted semantic changes since the last checkpoint.
      </p>
    )}
    <footer>
      <span>
        Checkpoint {projection.throughSequence} · {projection.transitionCount} accepted ·{" "}
        {projection.evidenceTransitionCount ?? 0} observed transitions
      </span>
      {projection.pending ? (
        <button disabled={pending} onClick={() => void onAcknowledge()} type="button">
          {pending ? "Saving…" : "Mark caught up"}
        </button>
      ) : null}
    </footer>
  </aside>
);
