import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AgentView } from "../../../src/projection/types.ts";
import { Schema } from "effect";
import type {
  WebWorkspaceReviewFileResponse,
  WebWorkspaceReviewResponse,
} from "../../../src/web/protocol.ts";
import type {
  WorkspaceDiffFile,
  WorkspaceReviewFileView,
  WorkspaceReviewTreeEntry,
} from "../../../src/workspaces/types.ts";
import { fetchWorkspaceReview, fetchWorkspaceReviewFile } from "../api/client.ts";
import type { TerminalAppearance } from "../settings/browserSettings.ts";
import { ModalDialog } from "../shared/ModalDialog.tsx";
import { TerminalDeck } from "../terminal/TerminalDeck.tsx";
import { ReviewEvidence } from "./ReviewEvidence.tsx";
import { ReviewFileStatus } from "./ReviewFileStatus.tsx";
import { reduceReviewLocation } from "./reviewLocation.ts";

const SyntaxSourceView = lazy(() =>
  import("./SyntaxSourceView.tsx").then(({ SyntaxSourceView: Component }) => ({
    default: Component,
  })),
);

const DiffViews = lazy(() =>
  import("./WorkingTreeDiff.tsx").then(({ ChangedFileList, FileDiff }) => ({
    default: ({
      file,
      files,
      mode,
      theme,
      generatedAt,
    }: {
      readonly file?: WorkspaceDiffFile;
      readonly files: readonly WorkspaceDiffFile[];
      readonly mode: "unified" | "split";
      readonly theme: "light" | "dark";
      readonly generatedAt: number;
    }) =>
      file ? (
        <div className="review-workspace__selected-diff">
          <FileDiff file={file} mode={mode} theme={theme} />
        </div>
      ) : (
        <ChangedFileList files={files} generatedAt={generatedAt} mode={mode} theme={theme} />
      ),
  })),
);

type Theme = "light" | "dark";
type DiffMode = "unified" | "split";
interface ReviewPaneLayout {
  readonly terminalRatio: number;
}

const REVIEW_LAYOUT_KEY = "observatory.review-layout.v4";
const ReviewPaneLayoutSchema = Schema.Struct({ terminalRatio: Schema.Number });
const decodePaneLayout = Schema.decodeUnknownSync(Schema.parseJson(ReviewPaneLayoutSchema));
const DEFAULT_PANE_LAYOUT: ReviewPaneLayout = { terminalRatio: 0.5 };
const TERMINAL_RATIO = { minimum: 0.2, maximum: 0.8 } as const;

const boundedRatio = (value: number): number =>
  Math.min(TERMINAL_RATIO.maximum, Math.max(TERMINAL_RATIO.minimum, value));

const readPaneLayout = (): ReviewPaneLayout => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return DEFAULT_PANE_LAYOUT;
  try {
    const encoded = browserWindow.localStorage.getItem(REVIEW_LAYOUT_KEY);
    if (!encoded) return DEFAULT_PANE_LAYOUT;
    const parsed = decodePaneLayout(encoded);
    return { terminalRatio: boundedRatio(parsed.terminalRatio) };
  } catch {
    return DEFAULT_PANE_LAYOUT;
  }
};

interface WorkspaceReviewProps {
  readonly agent: AgentView;
  readonly theme: Theme;
  readonly terminalAppearance: TerminalAppearance;
  readonly onTerminalAppearanceChange: (appearance: TerminalAppearance) => void;
  readonly onClose: () => void;
}

interface TreeRow {
  readonly entry: WorkspaceReviewTreeEntry;
  readonly path: string;
  readonly depth: number;
}

const pathIndex = (entries: readonly WorkspaceReviewTreeEntry[]): ReadonlyMap<string, string> => {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const paths = new Map<string, string>();
  const pathFor = (entry: WorkspaceReviewTreeEntry): string => {
    const existing = paths.get(entry.id);
    if (existing) return existing;
    const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    const path = parent ? `${pathFor(parent)}/${entry.name}` : entry.name;
    paths.set(entry.id, path);
    return path;
  };
  for (const entry of entries) pathFor(entry);
  return paths;
};

const treeRows = (
  entries: readonly WorkspaceReviewTreeEntry[],
  expanded: ReadonlySet<string>,
  query: string,
): readonly TreeRow[] => {
  const paths = pathIndex(entries);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery)
    return entries
      .filter(
        (entry) =>
          entry.kind === "file" &&
          (paths.get(entry.id) ?? entry.name).toLocaleLowerCase().includes(normalizedQuery),
      )
      .map((entry) => ({ entry, path: paths.get(entry.id) ?? entry.name, depth: 0 }));

  const children = new Map<string | undefined, WorkspaceReviewTreeEntry[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  const rows: TreeRow[] = [];
  const append = (parentId: string | undefined, depth: number): void => {
    for (const entry of children.get(parentId) ?? []) {
      rows.push({ entry, path: paths.get(entry.id) ?? entry.name, depth });
      if (entry.kind === "directory" && expanded.has(entry.id)) append(entry.id, depth + 1);
    }
  };
  append(undefined, 0);
  return rows;
};

const availableViews = (
  file: WorkspaceDiffFile | undefined,
): readonly (WorkspaceReviewFileView | "diff")[] => {
  if (!file) return ["source"];
  if (file.status === "deleted") return ["diff", "baseline"];
  if (file.status === "added" || file.status === "untracked") return ["source", "diff"];
  return ["source", "diff", "baseline"];
};

export const WorkspaceReview = ({
  agent,
  theme,
  terminalAppearance,
  onTerminalAppearanceChange,
  onClose,
}: WorkspaceReviewProps): React.JSX.Element => {
  const [snapshot, setSnapshot] = useState<WebWorkspaceReviewResponse>();
  const [fileSnapshot, setFileSnapshot] = useState<WebWorkspaceReviewFileResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [location, dispatchLocation] = useReducer(reduceReviewLocation, { surface: "changes" });
  const [diffMode, setDiffMode] = useState<DiffMode>("unified");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [paneLayout, setPaneLayout] = useState<ReviewPaneLayout>(readPaneLayout);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const selectedPathRef = useRef<string | undefined>(undefined);

  const reviewMode = location.surface;
  const selectedFileId =
    location.surface === "changes"
      ? location.fileId
      : location.surface === "files"
        ? location.file?.id
        : undefined;
  const fileView: WorkspaceReviewFileView | "diff" =
    location.surface === "changes"
      ? "diff"
      : location.surface === "files"
        ? (location.file?.view ?? "source")
        : "source";
  const paths = useMemo(() => pathIndex(snapshot?.tree ?? []), [snapshot?.tree]);
  const selectedEntry = snapshot?.tree.find((entry) => entry.id === selectedFileId);
  const selectedPath = selectedEntry ? paths.get(selectedEntry.id) : undefined;
  selectedPathRef.current = selectedPath;
  const selectedChange = snapshot?.changes.files.find((file) => file.path === selectedPath);
  const views = availableViews(selectedChange);

  useEffect(() => {
    const controller = new AbortController();
    const retainedPath = selectedPathRef.current;
    setLoading(true);
    setError(undefined);
    void fetchWorkspaceReview(agent.id, controller.signal)
      .then((next) => {
        setSnapshot(next);
        const nextPaths = pathIndex(next.tree);
        const retained = retainedPath
          ? next.tree.find((entry) => nextPaths.get(entry.id) === retainedPath)
          : undefined;
        const nextSelection = retained;
        dispatchLocation({ type: "retain-file", fileId: nextSelection?.id });
        setExpanded(
          new Set(
            next.tree
              .filter((entry) => entry.kind === "directory" && entry.changedDescendants > 0)
              .map((entry) => entry.id),
          ),
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Workspace review is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agent.id, refreshNonce]);

  useEffect(() => {
    setFileSnapshot(undefined);
    if (!snapshot || !selectedFileId || fileView === "diff") return;
    const controller = new AbortController();
    void fetchWorkspaceReviewFile(
      agent.id,
      snapshot.snapshotId,
      selectedFileId,
      fileView,
      controller.signal,
    )
      .then(setFileSnapshot)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setFileSnapshot({
            kind: "workspace-review-file",
            snapshotId: snapshot.snapshotId,
            fileId: selectedFileId,
            displayPath: selectedPath ?? "Unavailable file",
            view: fileView,
            status: "unavailable",
            truncated: false,
            generatedAt: Date.now(),
            message: cause instanceof Error ? cause.message : "File content is unavailable.",
          });
      });
    return () => controller.abort();
  }, [agent.id, fileView, selectedFileId, selectedPath, snapshot]);

  const rows = useMemo(
    () => treeRows(snapshot?.tree ?? [], expanded, query),
    [expanded, query, snapshot?.tree],
  );
  const selectFile = (
    entry: WorkspaceReviewTreeEntry,
    preferred: "source" | "baseline" = "source",
  ) => {
    if (entry.kind !== "file") return;
    dispatchLocation({ type: "open-file", fileId: entry.id, view: preferred });
  };

  useEffect(() => {
    const browserWindow = globalThis.window;
    if (!browserWindow) return;
    try {
      browserWindow.localStorage.setItem(REVIEW_LAYOUT_KEY, JSON.stringify(paneLayout));
    } catch {
      // Browser privacy and quota policies may disable storage; layout remains in memory.
    }
  }, [paneLayout]);

  const setTerminalWidth = (requested: number): void => {
    const containerWidth = panesRef.current?.getBoundingClientRect().width;
    if (!containerWidth) return;
    setPaneLayout({ terminalRatio: boundedRatio(requested / containerWidth) });
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const containerWidth = panesRef.current?.getBoundingClientRect().width;
    if (!containerWidth) return;
    const startX = event.clientX;
    const startWidth = paneLayout.terminalRatio * containerWidth;
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      setTerminalWidth(startWidth + delta);
    };
    const finish = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = event.shiftKey ? 32 : 12;
    const containerWidth = panesRef.current?.getBoundingClientRect().width;
    if (!containerWidth) return;
    setTerminalWidth(paneLayout.terminalRatio * containerWidth + direction * step);
  };

  const paneStyle: CSSProperties & Record<"--review-terminal-width", string> = {
    "--review-terminal-width": `calc(${paneLayout.terminalRatio * 100}% - ${paneLayout.terminalRatio * 5}px)`,
  };

  return (
    <ModalDialog
      ariaLabel={`Workspace review for ${agent.displayName}`}
      className="workspace-review-backdrop"
      onClose={onClose}
    >
      <section
        className={`review-workspace review-workspace--${theme}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-workspace__header">
          <div className="review-workspace__identity">
            <span className="overline">Review</span>
            <h2>{agent.displayName}</h2>
            <p>
              {snapshot?.repository ?? agent.repository ?? "Unknown repository"}
              <span>·</span>
              {snapshot?.branch ?? agent.branch ?? "Unknown branch"}
              {snapshot?.head ? <code>{snapshot.head.slice(0, 8)}</code> : null}
            </p>
          </div>

          <nav className="review-workspace__tabs" aria-label="Review workspace views">
            <button
              aria-pressed={reviewMode === "changes"}
              onClick={() => dispatchLocation({ type: "show", surface: "changes" })}
              type="button"
            >
              Changes <span>{snapshot?.changes.files.length ?? 0}</span>
            </button>
            <button
              aria-pressed={reviewMode === "files"}
              onClick={() => dispatchLocation({ type: "show", surface: "files" })}
              type="button"
            >
              Files
            </button>
            <button
              aria-pressed={reviewMode === "evidence"}
              onClick={() => dispatchLocation({ type: "show", surface: "evidence" })}
              type="button"
            >
              Evidence
            </button>
          </nav>

          {snapshot && reviewMode === "changes" ? (
            <div className="review-workspace__summary">
              <span className={`is-${snapshot.changes.status}`}>{snapshot.changes.status}</span>
              <span>{snapshot.changes.files.length}</span>
              <em>+{snapshot.changes.additions}</em>
              <i>−{snapshot.changes.deletions}</i>
              {snapshot.status !== "complete" ? <strong>{snapshot.status}</strong> : null}
            </div>
          ) : null}

          <div className="review-workspace__header-actions">
            {reviewMode === "changes" ? (
              <div aria-label="Diff layout" className="review-workspace__segmented" role="group">
                <button
                  aria-pressed={diffMode === "unified"}
                  onClick={() => setDiffMode("unified")}
                  type="button"
                >
                  Unified
                </button>
                <button
                  aria-pressed={diffMode === "split"}
                  onClick={() => setDiffMode("split")}
                  type="button"
                >
                  Split
                </button>
              </div>
            ) : null}
            <button
              disabled={loading}
              onClick={() => setRefreshNonce((value) => value + 1)}
              type="button"
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
            <button aria-label="Close workspace review" onClick={onClose} type="button">
              ×
            </button>
          </div>
        </header>

        <div className="review-workspace__panes" ref={panesRef} style={paneStyle}>
          <aside className="review-workspace__terminal">
            <TerminalDeck
              agent={agent}
              embedded
              key={agent.id}
              onClose={onClose}
              onTerminalAppearanceChange={onTerminalAppearanceChange}
              terminalAppearance={terminalAppearance}
              theme={theme}
            />
          </aside>

          <div
            aria-label="Resize terminal"
            aria-orientation="vertical"
            aria-valuemax={Math.round(TERMINAL_RATIO.maximum * 100)}
            aria-valuemin={Math.round(TERMINAL_RATIO.minimum * 100)}
            aria-valuenow={Math.round(paneLayout.terminalRatio * 100)}
            aria-valuetext={`${Math.round(paneLayout.terminalRatio * 100)}% terminal width`}
            className="review-workspace__separator review-workspace__separator--terminal"
            onDoubleClick={() => setPaneLayout(DEFAULT_PANE_LAYOUT)}
            onKeyDown={resizeWithKeyboard}
            onPointerDown={beginResize}
            role="separator"
            tabIndex={0}
          />

          <main
            className={`review-workspace__main review-workspace__main--${reviewMode}${selectedFileId ? " has-file" : ""}`}
          >
            {reviewMode === "evidence" ? (
              <ReviewEvidence agent={agent} refreshNonce={refreshNonce} />
            ) : null}
            {reviewMode === "files" && !loading && !error && snapshot && !selectedFileId ? (
              <section className="review-files" aria-label="Repository files">
                <label className="review-navigator__search">
                  <span>Find file</span>
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter paths…"
                    type="search"
                    value={query}
                  />
                </label>
                <div className="review-navigator__list">
                  {rows.map(({ entry, path, depth }) => (
                    <button
                      aria-expanded={
                        entry.kind === "directory" ? expanded.has(entry.id) : undefined
                      }
                      key={entry.id}
                      onClick={() => {
                        if (entry.kind === "directory") {
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          });
                        } else {
                          selectFile(entry, entry.change === "deleted" ? "baseline" : "source");
                        }
                      }}
                      style={{ paddingLeft: `${16 + depth * 18}px` }}
                      title={path}
                      type="button"
                    >
                      <span
                        className={`review-navigator__marker is-${entry.kind}`}
                        aria-hidden="true"
                      >
                        {entry.kind === "directory" ? (
                          <span
                            className={`review-navigator__chevron${expanded.has(entry.id) ? " is-expanded" : ""}`}
                          />
                        ) : (
                          <span className="review-navigator__file-icon" />
                        )}
                      </span>
                      <strong>{entry.name}</strong>
                      {entry.changedDescendants > 0 ? (
                        <small>{entry.changedDescendants}</small>
                      ) : null}
                      {entry.kind === "file" && entry.change ? (
                        <ReviewFileStatus status={entry.change} />
                      ) : null}
                    </button>
                  ))}
                </div>
                {snapshot && !snapshot.treeComplete ? (
                  <p className="review-navigator__notice">Repository index is incomplete.</p>
                ) : null}
              </section>
            ) : null}
            {reviewMode !== "evidence" && selectedFileId && selectedPath ? (
              <header className="review-file-header">
                <button
                  className="review-file-header__back"
                  onClick={() => dispatchLocation({ type: "back" })}
                  type="button"
                >
                  ← {reviewMode === "changes" ? "All changes" : "Files"}
                </button>
                <strong title={selectedPath}>{selectedPath}</strong>
                <div aria-label="File view" className="review-workspace__segmented" role="group">
                  {views
                    .filter((view) =>
                      reviewMode === "changes" ? view === "diff" : view !== "diff",
                    )
                    .map((view) => (
                      <button
                        aria-pressed={fileView === view}
                        key={view}
                        onClick={() => {
                          if (location.surface === "files" && view !== "diff")
                            dispatchLocation({
                              type: "open-file",
                              fileId: selectedFileId,
                              view,
                            });
                        }}
                        type="button"
                      >
                        {view}
                      </button>
                    ))}
                  {reviewMode === "files" && selectedChange ? (
                    <button
                      onClick={() =>
                        dispatchLocation({ type: "view-change", fileId: selectedFileId })
                      }
                      type="button"
                    >
                      View change
                    </button>
                  ) : null}
                </div>
              </header>
            ) : null}
            {loading && !snapshot ? (
              <div className="review-workspace__empty" role="status">
                Reading workspace…
              </div>
            ) : null}
            {error ? (
              <div className="review-workspace__empty">
                <strong>Review unavailable</strong>
                <span>{error}</span>
              </div>
            ) : null}
            {reviewMode === "changes" && !loading && !error && snapshot && !selectedFileId ? (
              snapshot.changes.status === "changed" ? (
                <Suspense fallback={<div className="review-workspace__empty">Preparing diff…</div>}>
                  <DiffViews
                    files={snapshot.changes.files}
                    generatedAt={snapshot.generatedAt}
                    mode={diffMode}
                    theme={theme}
                  />
                </Suspense>
              ) : (
                <div className="review-workspace__empty">
                  <strong>{snapshot.changes.status}</strong>
                  <span>
                    {snapshot.changes.message ?? "No working-tree changes were observed."}
                  </span>
                </div>
              )
            ) : null}
            {reviewMode === "changes" &&
            !error &&
            snapshot &&
            selectedFileId &&
            fileView === "diff" ? (
              selectedChange ? (
                <Suspense fallback={<div className="review-workspace__empty">Preparing diff…</div>}>
                  <DiffViews
                    file={selectedChange}
                    files={snapshot.changes.files}
                    generatedAt={snapshot.generatedAt}
                    mode={diffMode}
                    theme={theme}
                  />
                </Suspense>
              ) : (
                <div className="review-workspace__empty">This file has no working-tree diff.</div>
              )
            ) : null}
            {reviewMode === "files" && !error && selectedFileId && fileView !== "diff" ? (
              fileSnapshot ? (
                <Suspense
                  fallback={<div className="review-workspace__empty">Preparing source…</div>}
                >
                  <SyntaxSourceView snapshot={fileSnapshot} theme={theme} />
                </Suspense>
              ) : (
                <div className="review-workspace__empty" role="status">
                  Reading {fileView}…
                </div>
              )
            ) : null}
          </main>
        </div>

        {snapshot?.diagnostics.length ? (
          <footer className="review-workspace__footer">{snapshot.diagnostics.join(" ")}</footer>
        ) : null}
      </section>
    </ModalDialog>
  );
};
