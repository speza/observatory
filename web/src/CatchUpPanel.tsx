import type {
  CatchUpProjection,
  CatchUpSubject,
  EvidenceCatchUpItem,
} from "../../src/projection/types.ts";
import type { UniverseChange } from "../../src/universe/types.ts";
import type { Selection } from "./Atlas.tsx";

interface CatchUpPanelProps {
  readonly projection: CatchUpProjection;
  readonly pending: boolean;
  readonly onAcknowledge: () => Promise<void>;
  readonly onClose: () => void;
  readonly onOpenInbox: () => void;
  readonly onSelect: (selection: Selection) => void;
  readonly onSelectSystem: (systemId: string) => void;
}

const time = (occurredAt: number): string =>
  new Date(occurredAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export const CatchUpPanel = ({
  projection,
  pending,
  onAcknowledge,
  onClose,
  onOpenInbox,
  onSelect,
  onSelectSystem,
}: CatchUpPanelProps): React.JSX.Element => {
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

  const selectSubject = (subject: CatchUpSubject): void => {
    if (subject.subjectType === "system" && subject.subjectId) onSelectSystem(subject.subjectId);
    else if (subject.subjectType === "goal" && subject.subjectId)
      onSelect({ type: "goal", id: subject.subjectId });
    else onOpenInbox();
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
              Changes are grouped by Goal. Provider observations remain supporting evidence until
              you inspect them.
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

      {projection.subjects.length > 0 ? (
        <div className="catch-up-panel__subjects">
          <div className="catch-up-section-title">
            <div>
              <h3>Changes by Goal</h3>
              <p>One summary for each affected area of work.</p>
            </div>
            <b>{projection.subjects.length}</b>
          </div>
          <div className="catch-up-subjects">
            {projection.subjects.map((subject) => {
              const evidenceGroups = subject.evidenceGroups ?? [];
              const providerSignals = evidenceGroups.filter((group) => group.kind !== "activity");
              const activity = evidenceGroups
                .filter((group) => group.kind === "activity")
                .flatMap((group) => group.items);
              return (
                <article className="catch-up-subject" key={subject.id}>
                  <button
                    className="catch-up-subject__heading"
                    onClick={() => selectSubject(subject)}
                    type="button"
                  >
                    <span className={`catch-up-event__marker is-${subject.outcome}`} />
                    <span>
                      <small>{subject.subjectType}</small>
                      <strong>{subject.title}</strong>
                    </span>
                    <time>{time(subject.occurredAt)}</time>
                  </button>
                  {subject.summaries.length > 0 ? (
                    <ul className="catch-up-subject__summaries">
                      {subject.summaries.map((summary) => (
                        <li
                          className={`is-${summary.kind}`}
                          key={`${summary.kind}:${summary.label}`}
                        >
                          {summary.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {providerSignals.length > 0 ? (
                    <div className="catch-up-subject__evidence">
                      {providerSignals.flatMap((group) =>
                        group.items.map((item) => evidenceItem(item, group.label)),
                      )}
                    </div>
                  ) : null}
                  {subject.transitionCount > 0 || activity.length > 0 ? (
                    <details className="catch-up-activity">
                      <summary>
                        {subject.transitionCount} accepted transition
                        {subject.transitionCount === 1 ? "" : "s"}
                        {activity.length > 0
                          ? ` · ${activity.length} routine provider transition${activity.length === 1 ? "" : "s"}`
                          : ""}
                      </summary>
                      <div className="catch-up-events">
                        {subject.transitions.map((item) => (
                          <button
                            className="catch-up-event"
                            key={`accepted:${item.sequence}`}
                            onClick={() => selectChange(item)}
                            type="button"
                          >
                            <span className={`catch-up-event__marker is-${item.outcome}`} />
                            <span className="catch-up-event__content">
                              <small>Accepted transition</small>
                              <strong>{item.summary}</strong>
                            </span>
                            <time>{time(item.occurredAt)}</time>
                          </button>
                        ))}
                        {activity.map((item) => evidenceItem(item))}
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="catch-up-panel__empty">Nothing has changed since this checkpoint.</p>
      )}

      <footer>
        <span>
          {projection.subjects.length} affected areas · {projection.transitionCount} accepted
          transitions · {projection.evidenceTransitionCount ?? 0} provider transitions
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
