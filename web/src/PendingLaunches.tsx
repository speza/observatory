import type { WebPendingLaunch } from "../../src/web/protocol.ts";

interface PendingLaunchesProps {
  readonly launches: readonly WebPendingLaunch[];
  readonly onDismiss: (requestId: string) => void;
  readonly onOpen: (launch: WebPendingLaunch) => void;
}

export const PendingLaunches = ({
  launches,
  onDismiss,
  onOpen,
}: PendingLaunchesProps): React.JSX.Element | null => {
  if (launches.length === 0) return null;
  return (
    <div className="pending-launches" aria-label="Pending agent launches">
      <span>Starting</span>
      {launches.map((launch) => (
        <div className="pending-launches__item" key={launch.requestId}>
          <button onClick={() => onOpen(launch)} type="button">
            {launch.displayName} · open terminal
          </button>
          <button
            aria-label={`Dismiss ${launch.displayName} pending launch`}
            className="pending-launches__dismiss"
            onClick={() => onDismiss(launch.requestId)}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
