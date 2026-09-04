import type { WorkspaceDiffFileStatus } from "../../../src/workspaces/types.ts";

const STATUS_LABELS = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  untracked: "untracked",
} as const satisfies Readonly<Record<WorkspaceDiffFileStatus, string>>;

const STATUS_BADGES = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
} as const satisfies Readonly<Record<WorkspaceDiffFileStatus, string>>;

interface ReviewFileStatusProps {
  readonly status: WorkspaceDiffFileStatus;
  readonly binary?: boolean;
}

export const ReviewFileStatus = ({
  status,
  binary = false,
}: ReviewFileStatusProps): React.JSX.Element => {
  const label = binary ? "binary" : STATUS_LABELS[status];
  return (
    <span
      aria-label={label}
      className={`review-file-status review-file-status--${binary ? "binary" : status}`}
      role="img"
      title={label}
    >
      {binary ? "B" : STATUS_BADGES[status]}
    </span>
  );
};
