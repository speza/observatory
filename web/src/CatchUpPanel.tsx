import type { CatchUpProjection, EvidenceCatchUpItem } from "../../src/projection/types.ts";
import type { UniverseChange, UniverseChangeOutcome } from "../../src/universe/types.ts";
import type { Selection } from "./Atlas.tsx";

interface CatchUpPanelProps {
  readonly projection: CatchUpProjection;
  readonly pending: boolean;
  readonly onAcknowledge: () => Promise<void>;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
  readonly onSelectSystem: (systemId: string) => void;
}

const outcomeLabels = {
  attention: "Needs you",
  finished: "Finished",
  new: "New",
  changed: "Changed",
  stale: "Uncertain",
} satisfies Record<UniverseChangeOutcome, string>;

const time = (occurredAt: number): string =>
  new Date(occurredAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const byMostRecent = <T extends { readonly occurredAt: number; readonly sequence: number }>(
  left: T,
  right: T,
): number => right.occurredAt - left.occurredAt || right.sequence - left.sequence;

export const CatchUpPanel = ({
  projection,
  pending,
  onAcknowledge,
  onClose,
  onSelect,
  onSelectSystem,
}: CatchUpPanelProps): React.JSX.Element => {
  const acceptedChanges = projection.groups.flatMap((group) => group.items).sort(byMostRecent);
  const evidenceGroups = projection.evidenceGroups ?? [];
  const providerSignals = evidenceGroups
    .filter((group) => group.kind !== "activity")
    .flatMap((group) => group.items.map((item) => ({ ...item, label: group.label })))
    .sort(byMostRecent);
  const activity = evidenceGroups
    .filter((group) => group.kind === "activity")
    .flatMap((group) => group.items)
    .sort(byMostRecent);
  const since = projection.sinceAt
    ? new Date(projection.sinceAt).toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "your first checkpoint";

  const selectChange = (item: UniverseChange): void => {
    if (item.targetType === "system") onSelectSystem(item.targetId);
    else onSelect({ type: item.targetType, id: item.targetId });
  };

  const evidenceItem = (item: EvidenceCatchUpItem, label?: string): React.JSX.Element => (
    <button
      className="catch-up-event"
      key={`evidence:${item.sequence}`}
      onClick={() => onSelect({ type: "agent", id: item.agentId })}
      type="button"
    >
      <span className="catch-up-event__marker is-observed" />
      <span className="catch-up-event__content">
        {label ? <small>{label}</small> : null}
        <strong>{item.summary}</strong>
      </span>
      <time>{time(item.occurredAt)}</time>
    </button>
  );

  return (
    <aside aria-label="Catch up" className="catch-up-panel">
      <header>
        <div>
          <p className="overline">CATCH UP · SINCE {since}</p>
          <h2>{projection.pending ? "Here’s what changed" : "You’re caught up"}</h2>
          {projection.pending ? (
            <p className="catch-up-panel__intro">
              Start with accepted changes. Provider signals are supporting evidence until you
              inspect them.
            </p>
          ) : null}
        </div>
        <button aria-label="Close catch up" onClick={onClose} type="button">
          ×
        </button>
      </header>

      {projection.pending ? (
        <div className="catch-up-panel__summary" aria-label="Catch-up summary">
          <div className={projection.counts.attention > 0 ? "is-urgent" : undefined}>
            <strong>{projection.counts.attention}</strong>
            <span>Need you</span>
          </div>
          <div>
            <strong>{projection.counts.finished}</strong>
            <span>Finished</span>
          </div>
          <div>
            <strong>{projection.counts.new + projection.counts.changed}</strong>
            <span>New / changed</span>
          </div>
          <div>
            <strong>{projection.counts.stale}</strong>
            <span>Uncertain</span>
          </div>
        </div>
      ) : null}

      {acceptedChanges.length > 0 || providerSignals.length > 0 || activity.length > 0 ? (
        <div className="catch-up-panel__body">
          <section className="catch-up-panel__primary">
            <div className="catch-up-section-title">
              <div>
                <h3>Accepted changes</h3>
                <p>Durable changes Observatory has reconciled.</p>
              </div>
              <b>{acceptedChanges.length}</b>
            </div>
            {acceptedChanges.length > 0 ? (
              <div className="catch-up-events">
                {acceptedChanges.map((item) => (
                  <button
                    className="catch-up-event"
                    key={item.sequence}
                    onClick={() => selectChange(item)}
                    type="button"
                  >
                    <span className={`catch-up-event__marker is-${item.outcome}`} />
                    <span className="catch-up-event__content">
                      <small>{outcomeLabels[item.outcome]}</small>
                      <strong>{item.summary}</strong>
                    </span>
                    <time>{time(item.occurredAt)}</time>
                  </button>
                ))}
              </div>
            ) : (
              <p className="catch-up-section-empty">No accepted changes.</p>
            )}
          </section>

          <aside className="catch-up-panel__evidence" aria-label="Provider signals">
            <div className="catch-up-section-title">
              <div>
                <h3>Provider signals</h3>
                <p>Requests and outcomes reported by agent providers.</p>
              </div>
              <b>{providerSignals.length}</b>
            </div>
            {providerSignals.length > 0 ? (
              <div className="catch-up-events">
                {providerSignals.map((item) => evidenceItem(item, item.label))}
              </div>
            ) : (
              <p className="catch-up-section-empty">No provider requests or outcomes.</p>
            )}
            {activity.length > 0 ? (
              <details className="catch-up-activity">
                <summary>{activity.length} routine activity transitions</summary>
                <div className="catch-up-events">{activity.map((item) => evidenceItem(item))}</div>
              </details>
            ) : null}
          </aside>
        </div>
      ) : (
        <p className="catch-up-panel__empty">Nothing has changed since this checkpoint.</p>
      )}

      <footer>
        <span>
          {acceptedChanges.length} accepted summaries · {projection.transitionCount} transitions ·{" "}
          {projection.evidenceTransitionCount ?? 0} observed provider events
        </span>
        {projection.pending ? (
          <button disabled={pending} onClick={() => void onAcknowledge()} type="button">
            {pending ? "Saving…" : "Mark caught up"}
          </button>
        ) : null}
      </footer>
    </aside>
  );
};
