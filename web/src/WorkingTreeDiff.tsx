import { useEffect, useState } from "react";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import type { AgentView } from "../../src/projection/types.ts";
import type { WebWorkingTreeDiffResponse } from "../../src/web/protocol.ts";
import type { WorkspaceDiffFile } from "../../src/workspaces/types.ts";
import { fetchWorkingTreeDiff } from "./api.ts";

type Theme = "light" | "dark";
type DiffMode = "split" | "unified";

interface WorkingTreeDiffProps {
  readonly agent: AgentView;
  readonly embedded?: boolean;
  readonly theme: Theme;
  readonly onClose: () => void;
  readonly onTerminalToggle?: () => void;
  readonly terminalOpen?: boolean;
}

const statusLabel = (status: WebWorkingTreeDiffResponse["status"]): string => {
  if (status === "changed") return "Changes in working tree";
  if (status === "clean") return "Working tree clean";
  if (status === "not-git") return "Not a Git checkout";
  return "Workspace unavailable";
};

const fileStatusLabel = (file: WorkspaceDiffFile): string => {
  if (file.binary) return "binary";
  return file.status;
};

const fileDataFor = (file: WorkspaceDiffFile) => ({
  oldFile: file.oldFile,
  newFile: file.newFile,
  hunks: [...file.hunks],
});

interface ChangedFileListProps {
  readonly files: readonly WorkspaceDiffFile[];
  readonly generatedAt: number;
  readonly mode: DiffMode;
  readonly theme: Theme;
}

export const ChangedFileList = ({
  files,
  generatedAt,
  mode,
  theme,
}: ChangedFileListProps): React.JSX.Element => (
  <div aria-label="Changed files" className="diff-review__body" role="region">
    {files.map((file) => (
      <details className="diff-review__file" key={file.path} open>
        <summary className="diff-review__file-header">
          <span className="diff-review__file-chevron" aria-hidden="true" />
          <span className="diff-review__file-identity">
            <span className="diff-review__file-status">{fileStatusLabel(file)}</span>
            <strong className="diff-review__file-path">{file.path}</strong>
          </span>
          <span className="diff-review__file-counts">
            {file.additions ? <em>+{file.additions}</em> : null}
            {file.deletions ? <i>−{file.deletions}</i> : null}
          </span>
        </summary>
        {file.binary ? (
          <div className="diff-review__binary">Binary or oversized file · content omitted</div>
        ) : file.hunks.length > 0 ? (
          <div className="diff-review__renderer">
            <DiffView
              key={`${file.path}-${mode}-${generatedAt}`}
              data={fileDataFor(file)}
              diffViewFontSize={13}
              diffViewHighlight
              diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
              diffViewTheme={theme}
              diffViewWrap={false}
            />
          </div>
        ) : (
          <pre className="diff-review__raw">
            {file.newFile?.content ?? file.oldFile?.content ?? "No textual hunk available."}
          </pre>
        )}
      </details>
    ))}
  </div>
);

export const WorkingTreeDiff = ({
  agent,
  embedded = false,
  theme,
  onClose,
  onTerminalToggle,
  terminalOpen = false,
}: WorkingTreeDiffProps): React.JSX.Element => {
  const [snapshot, setSnapshot] = useState<WebWorkingTreeDiffResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<DiffMode>("unified");
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setSnapshot(undefined);
    void fetchWorkingTreeDiff(agent.id, controller.signal)
      .then(setSnapshot)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Workspace diff unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agent.id, refreshNonce]);

  const review = (
    <section
      aria-label={`Workspace changes for ${agent.displayName}`}
      aria-modal={embedded ? undefined : "true"}
      className={`diff-review${embedded ? " diff-review--embedded" : ""}`}
      onMouseDown={(event) => event.stopPropagation()}
      role={embedded ? "region" : "dialog"}
    >
      <header className="diff-review__header">
        <div>
          <p className="overline">WORKSPACE REVIEW / READ ONLY</p>
          <h2>{agent.displayName}</h2>
          <p className="diff-review__context">
            {snapshot?.repository ?? agent.repository ?? "Unknown repository"}
            <span>·</span>
            {snapshot?.branch ?? agent.branch ?? "Unknown branch"}
          </p>
        </div>
        <div className="diff-review__header-actions">
          {onTerminalToggle ? (
            <button
              aria-pressed={terminalOpen}
              className="diff-review__terminal-toggle"
              onClick={onTerminalToggle}
              type="button"
            >
              {terminalOpen ? "Hide terminal" : "Open terminal"}
            </button>
          ) : null}
          <div className="diff-review__mode" aria-label="Diff view mode" role="group">
            <button
              aria-pressed={mode === "unified"}
              onClick={() => setMode("unified")}
              type="button"
            >
              Unified
            </button>
            <button aria-pressed={mode === "split"} onClick={() => setMode("split")} type="button">
              Split
            </button>
          </div>
          <button
            aria-label="Refresh workspace changes"
            className="diff-review__refresh"
            disabled={loading}
            onClick={() => setRefreshNonce((value) => value + 1)}
            type="button"
          >
            ↻
          </button>
          <button aria-label="Close workspace review" onClick={onClose} type="button">
            ×
          </button>
        </div>
      </header>

      {snapshot ? (
        <div className="diff-review__summary">
          <span className={`diff-review__status diff-review__status--${snapshot.status}`}>
            <i aria-hidden="true" />
            {statusLabel(snapshot.status)}
          </span>
          <span>{snapshot.files.length} files</span>
          <span className="diff-review__additions">+{snapshot.additions}</span>
          <span className="diff-review__deletions">−{snapshot.deletions}</span>
          {snapshot.head ? <code>{snapshot.head.slice(0, 8)}</code> : null}
        </div>
      ) : null}

      {loading ? <p className="diff-review__empty">Reading the latest workspace state…</p> : null}
      {error ? (
        <div className="diff-review__empty diff-review__empty--error">
          <strong>Could not read workspace changes</strong>
          <span>{error}</span>
          <button onClick={() => setRefreshNonce((value) => value + 1)} type="button">
            Try again
          </button>
        </div>
      ) : null}
      {!loading && !error && snapshot?.status !== "changed" ? (
        <div className="diff-review__empty">
          <strong>{statusLabel(snapshot?.status ?? "unavailable")}</strong>
          <span>{snapshot?.message ?? "No changed files were observed."}</span>
        </div>
      ) : null}
      {!loading && !error && snapshot?.status === "changed" ? (
        <ChangedFileList
          files={snapshot.files}
          generatedAt={snapshot.generatedAt}
          mode={mode}
          theme={theme}
        />
      ) : null}

      {snapshot?.truncated ? (
        <footer className="diff-review__footer">
          Large changes are abbreviated to keep review responsive.
        </footer>
      ) : null}
    </section>
  );
  return embedded ? (
    review
  ) : (
    <div className="diff-review-backdrop" role="presentation" onMouseDown={onClose}>
      {review}
    </div>
  );
};
