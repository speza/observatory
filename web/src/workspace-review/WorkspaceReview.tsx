import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import type { AgentView } from "../../../src/projection/types.ts";
import { Schema } from "effect";
import type {
  WebWorkspaceReviewFileResponse,
  WebWorkspaceReviewResponse,
} from "../../../src/web/protocol.ts";
import type { WorkspaceDiffFile, WorkspaceReviewTreeEntry } from "../../../src/workspaces/types.ts";
import { fetchWorkspaceReview, fetchWorkspaceReviewFile } from "../api/client.ts";
import type { TerminalAppearance } from "../settings/browserSettings.ts";
import { ModalDialog } from "../shared/ModalDialog.tsx";
import { TerminalDeck } from "../terminal/TerminalDeck.tsx";
import {
  availableFileModes,
  isCurrentFileRequest,
  MAX_OPEN_FILE_TABS,
  readOpenFileTabs,
  reduceOpenFileTabs,
  reviewTabStorage,
  tabPathForKey,
  writeOpenFileTabs,
  type FileRequestToken,
  type ReviewFileResolution,
  type ReviewFileMode,
} from "./openFileTabs.ts";
import { ReviewEvidence } from "./ReviewEvidence.tsx";
import { ReviewFileStatus } from "./ReviewFileStatus.tsx";

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
      scrollRef,
      onScroll,
    }: {
      readonly file?: WorkspaceDiffFile;
      readonly files: readonly WorkspaceDiffFile[];
      readonly mode: "unified" | "split";
      readonly theme: "light" | "dark";
      readonly generatedAt: number;
      readonly scrollRef?: React.Ref<HTMLDivElement>;
      readonly onScroll?: React.UIEventHandler<HTMLDivElement>;
    }) =>
      file ? (
        <div
          aria-label={`${file.path} diff`}
          className="review-workspace__selected-diff"
          onScroll={onScroll}
          ref={scrollRef}
          role="region"
        >
          {file.binary ? (
            <div className="diff-review__binary">Binary or oversized file · content omitted</div>
          ) : (
            <FileDiff file={file} mode={mode} theme={theme} />
          )}
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

const fileResolution = (entry: WorkspaceReviewTreeEntry, path: string): ReviewFileResolution => ({
  path,
  fileId: entry.id,
  change: entry.change,
  contentKind: entry.contentKind,
});

const pathParts = (path: string): { readonly name: string; readonly directory?: string } => {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { name: path }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
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
  const [reviewMode, setReviewMode] = useState<"changes" | "files" | "evidence">("changes");
  const [fileFocused, setFileFocused] = useState(false);
  const [openFiles, dispatchOpenFiles] = useReducer(reduceOpenFileTabs, undefined, () =>
    readOpenFileTabs(reviewTabStorage(), agent.id),
  );
  const [diffMode, setDiffMode] = useState<DiffMode>("unified");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [paneLayout, setPaneLayout] = useState<ReviewPaneLayout>(readPaneLayout);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const fileRequestRef = useRef<FileRequestToken | undefined>(undefined);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingScrollRef = useRef<
    | {
        readonly path: string;
        readonly mode: ReviewFileMode;
        readonly top: number;
        readonly left: number;
      }
    | undefined
  >(undefined);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const changesOverviewRef = useRef<HTMLButtonElement | null>(null);
  const filesOverviewRef = useRef<HTMLButtonElement | null>(null);

  const activeTab = openFiles.tabs.find((tab) => tab.path === openFiles.activePath);
  const selectedFileId = fileFocused ? activeTab?.fileId : undefined;
  const selectedPath = fileFocused ? activeTab?.path : undefined;
  const fileView: ReviewFileMode = activeTab?.mode ?? "source";
  const visibleReviewMode = fileFocused ? (fileView === "diff" ? "changes" : "files") : reviewMode;
  const paths = useMemo(() => pathIndex(snapshot?.tree ?? []), [snapshot?.tree]);
  const selectedChange = snapshot?.changes.files.find((file) => file.path === selectedPath);
  const views = availableFileModes(activeTab?.change);
  const activeFileSnapshot =
    snapshot &&
    selectedFileId &&
    fileSnapshot?.snapshotId === snapshot.snapshotId &&
    fileSnapshot.fileId === selectedFileId &&
    fileSnapshot.view === fileView
      ? fileSnapshot
      : undefined;

  useLayoutEffect(() => {
    setSnapshot(undefined);
    setFileSnapshot(undefined);
    setError(undefined);
    setLoading(true);
    setReviewMode("changes");
    setFileFocused(false);
    dispatchOpenFiles({
      type: "replace",
      state: readOpenFileTabs(reviewTabStorage(), agent.id),
    });
  }, [agent.id]);

  useEffect(() => {
    const controller = new AbortController();
    dispatchOpenFiles({ type: "refresh-start" });
    setFileSnapshot(undefined);
    setLoading(true);
    setError(undefined);
    void fetchWorkspaceReview(agent.id, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSnapshot(next);
        const nextPaths = pathIndex(next.tree);
        dispatchOpenFiles({
          type: "reconcile",
          files: next.tree.flatMap((entry) => {
            const path = nextPaths.get(entry.id);
            return entry.kind === "file" && path
              ? [
                  {
                    path,
                    fileId: entry.id,
                    change: entry.change,
                    contentKind: entry.contentKind,
                  },
                ]
              : [];
          }),
          renames: next.changes.files.flatMap((file) =>
            file.status === "renamed" && file.oldPath
              ? [{ oldPath: file.oldPath, path: file.path }]
              : [],
          ),
          absenceEvidence:
            next.status === "complete" && next.treeComplete
              ? "authoritative"
              : next.status === "partial"
                ? "incomplete"
                : "unavailable",
        });
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
    fileRequestRef.current = undefined;
    setFileSnapshot(undefined);
    if (
      !snapshot ||
      !fileFocused ||
      !activeTab ||
      !selectedFileId ||
      fileView === "diff" ||
      activeTab?.availability === "stale" ||
      activeTab?.availability === "removed" ||
      activeTab?.availability === "unavailable"
    )
      return;
    const requestPath = activeTab.path;
    const requestedView = fileView;
    const controller = new AbortController();
    const request: FileRequestToken = { nonce: Symbol() };
    fileRequestRef.current = request;
    void fetchWorkspaceReviewFile(
      agent.id,
      snapshot.snapshotId,
      selectedFileId,
      requestedView,
      controller.signal,
    )
      .then((next) => {
        if (!isCurrentFileRequest(fileRequestRef.current, request, controller.signal.aborted))
          return;
        setFileSnapshot(next);
        dispatchOpenFiles({
          type: "file-status",
          path: requestPath,
          mode: requestedView,
          status: next.status,
          message: next.message,
        });
      })
      .catch((cause: unknown) => {
        if (isCurrentFileRequest(fileRequestRef.current, request, controller.signal.aborted)) {
          const message = cause instanceof Error ? cause.message : "File content is unavailable.";
          const unavailable = {
            kind: "workspace-review-file",
            snapshotId: snapshot.snapshotId,
            fileId: selectedFileId,
            displayPath: requestPath,
            view: requestedView,
            status: "unavailable",
            truncated: false,
            generatedAt: Date.now(),
            message,
          } as const;
          setFileSnapshot(unavailable);
          dispatchOpenFiles({
            type: "file-status",
            path: requestPath,
            mode: requestedView,
            status: "unavailable",
            message,
          });
        }
      });
    return () => {
      controller.abort();
      if (fileRequestRef.current === request) fileRequestRef.current = undefined;
    };
  }, [
    activeTab?.availability,
    agent.id,
    fileFocused,
    fileView,
    selectedFileId,
    selectedPath,
    snapshot,
  ]);

  const rows = useMemo(
    () => treeRows(snapshot?.tree ?? [], expanded, query),
    [expanded, query, snapshot?.tree],
  );
  const flushFileScroll = useCallback((): void => {
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = undefined;
    const pending = pendingScrollRef.current;
    pendingScrollRef.current = undefined;
    if (pending) dispatchOpenFiles({ type: "save-scroll", ...pending });
  }, []);

  const selectFile = (entry: WorkspaceReviewTreeEntry, preferred: ReviewFileMode = "source") => {
    if (entry.kind !== "file") return;
    const path = paths.get(entry.id);
    if (!path) return;
    const file = fileResolution(entry, path);
    const restoredMode = openFiles.tabs.find((tab) => tab.path === path)?.mode ?? preferred;
    flushFileScroll();
    dispatchOpenFiles({ type: "open", file, preferredMode: preferred });
    setReviewMode(restoredMode === "diff" ? "changes" : "files");
    setFileFocused(true);
  };

  const setFileScrollElement = useCallback(
    (element: HTMLDivElement | null): void => {
      if (!element) return;
      const position = activeTab?.scroll[fileView] ?? { top: 0, left: 0 };
      element.scrollTop = Math.min(
        position.top,
        Math.max(0, element.scrollHeight - element.clientHeight),
      );
      element.scrollLeft = Math.min(
        position.left,
        Math.max(0, element.scrollWidth - element.clientWidth),
      );
    },
    [activeTab?.path, activeTab?.scroll, fileView],
  );

  const saveFileScroll = (event: UIEvent<HTMLDivElement>): void => {
    const path = activeTab?.path;
    if (!path) return;
    const top = event.currentTarget.scrollTop;
    const left = event.currentTarget.scrollLeft;
    clearTimeout(scrollTimerRef.current);
    pendingScrollRef.current = { path, mode: fileView, top, left };
    scrollTimerRef.current = setTimeout(flushFileScroll, 80);
  };

  useEffect(
    () => () => {
      clearTimeout(scrollTimerRef.current);
      pendingScrollRef.current = undefined;
    },
    [],
  );

  const activateTab = (path: string): void => {
    const tab = openFiles.tabs.find((candidate) => candidate.path === path);
    if (!tab) return;
    flushFileScroll();
    dispatchOpenFiles({ type: "activate", path });
    setReviewMode(tab.mode === "diff" ? "changes" : "files");
    setFileFocused(true);
  };

  const closeTab = (path: string): void => {
    const index = openFiles.tabs.findIndex((tab) => tab.path === path);
    const fallback =
      openFiles.activePath === path
        ? (openFiles.tabs[index + 1] ?? openFiles.tabs[index - 1])
        : openFiles.tabs.find((tab) => tab.path === openFiles.activePath);
    flushFileScroll();
    dispatchOpenFiles({ type: "close", path });
    if (!fallback) {
      setFileFocused(false);
      requestAnimationFrame(() =>
        (fileView === "diff" ? changesOverviewRef : filesOverviewRef).current?.focus(),
      );
    } else if (openFiles.activePath === path) {
      setReviewMode(fallback.mode === "diff" ? "changes" : "files");
      requestAnimationFrame(() => tabRefs.current.get(fallback.path)?.focus());
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, path: string): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const nextPath = tabPathForKey(openFiles, path, event.key);
    if (!nextPath) return;
    event.preventDefault();
    activateTab(nextPath);
    requestAnimationFrame(() => tabRefs.current.get(nextPath)?.focus());
  };

  const refreshReview = (): void => {
    flushFileScroll();
    dispatchOpenFiles({ type: "refresh-start" });
    setFileSnapshot(undefined);
    setRefreshNonce((value) => value + 1);
  };

  useEffect(() => {
    writeOpenFileTabs(reviewTabStorage(), agent.id, openFiles);
  }, [agent.id, openFiles]);

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
              aria-pressed={reviewMode === "changes" && !fileFocused}
              onClick={() => {
                flushFileScroll();
                setReviewMode("changes");
                setFileFocused(false);
              }}
              ref={changesOverviewRef}
              type="button"
            >
              Changes <span>{snapshot?.changes.files.length ?? 0}</span>
            </button>
            <button
              aria-pressed={reviewMode === "files" && !fileFocused}
              onClick={() => {
                flushFileScroll();
                setReviewMode("files");
                setFileFocused(false);
              }}
              ref={filesOverviewRef}
              type="button"
            >
              Files
            </button>
            <button
              aria-pressed={reviewMode === "evidence"}
              onClick={() => {
                flushFileScroll();
                setReviewMode("evidence");
                setFileFocused(false);
              }}
              type="button"
            >
              Evidence
            </button>
          </nav>

          {snapshot && visibleReviewMode === "changes" && !fileFocused ? (
            <div className="review-workspace__summary">
              <span className={`is-${snapshot.changes.status}`}>{snapshot.changes.status}</span>
              <span>{snapshot.changes.files.length}</span>
              <em>+{snapshot.changes.additions}</em>
              <i>−{snapshot.changes.deletions}</i>
              {snapshot.status !== "complete" ? <strong>{snapshot.status}</strong> : null}
            </div>
          ) : null}

          <div className="review-workspace__header-actions">
            {visibleReviewMode === "changes" ? (
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
            <button disabled={loading} onClick={refreshReview} type="button">
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

          <div className={`review-workspace__review${openFiles.tabs.length ? " has-tabs" : ""}`}>
            {openFiles.tabs.length ? (
              <div className="review-file-tabs">
                <div
                  aria-label="Open review files"
                  className="review-file-tabs__list"
                  role="tablist"
                >
                  {openFiles.tabs.map((tab, index) => {
                    const identity = pathParts(tab.path);
                    const selected = tab.path === openFiles.activePath;
                    const viewState = tab.mode === "diff" ? undefined : tab.viewState[tab.mode];
                    const exception =
                      tab.availability === "available" ? viewState?.status : tab.availability;
                    const stateLabel =
                      (tab.availability === "available" ? viewState?.message : tab.message) ??
                      exception ??
                      "available";
                    const changeLabel = tab.change
                      ? tab.change
                      : tab.fileId
                        ? "unchanged"
                        : "change status unknown";
                    return (
                      <div
                        className={`review-file-tabs__item is-${tab.availability}${selected && fileFocused ? " is-active" : ""}`}
                        key={tab.path}
                      >
                        <button
                          aria-controls="review-file-panel"
                          aria-label={`${tab.path}, ${changeLabel}, ${stateLabel}`}
                          aria-selected={fileFocused && selected}
                          className="review-file-tabs__tab"
                          id={`review-file-tab-${index}`}
                          onClick={() => activateTab(tab.path)}
                          onKeyDown={(event) => handleTabKeyDown(event, tab.path)}
                          ref={(element) => {
                            if (element) tabRefs.current.set(tab.path, element);
                            else tabRefs.current.delete(tab.path);
                          }}
                          role="tab"
                          tabIndex={selected ? 0 : -1}
                          title={`${tab.path} · ${stateLabel}`}
                          type="button"
                        >
                          <span className="review-file-tabs__identity">
                            <strong>{identity.name}</strong>
                            {identity.directory ? <small>{identity.directory}</small> : null}
                          </span>
                          {tab.change ? <ReviewFileStatus status={tab.change} /> : null}
                          {exception ? (
                            <span className="review-file-tabs__state">{exception}</span>
                          ) : null}
                        </button>
                        <button
                          aria-label={`Close ${tab.path}`}
                          className="review-file-tabs__close"
                          onClick={() => closeTab(tab.path)}
                          tabIndex={fileFocused && selected ? 0 : -1}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
                <span className="review-file-tabs__count">
                  {openFiles.tabs.length}/{MAX_OPEN_FILE_TABS}
                </span>
              </div>
            ) : null}
            <main
              aria-labelledby={
                fileFocused && activeTab
                  ? `review-file-tab-${openFiles.tabs.indexOf(activeTab)}`
                  : undefined
              }
              className={`review-workspace__main review-workspace__main--${visibleReviewMode}${fileFocused && activeTab ? " has-file" : ""}`}
              id="review-file-panel"
              role={fileFocused && activeTab ? "tabpanel" : undefined}
            >
              {visibleReviewMode === "evidence" && !fileFocused ? (
                <ReviewEvidence agent={agent} refreshNonce={refreshNonce} />
              ) : null}
              {visibleReviewMode === "files" && !fileFocused && !loading && !error && snapshot ? (
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
              {fileFocused && activeTab ? (
                <header className="review-file-header">
                  <button
                    className="review-file-header__back"
                    onClick={() => {
                      flushFileScroll();
                      setReviewMode(fileView === "diff" ? "changes" : "files");
                      setFileFocused(false);
                    }}
                    type="button"
                  >
                    ← {fileView === "diff" ? "All changes" : "Files"}
                  </button>
                  <strong title={activeTab.path}>{activeTab.path}</strong>
                  {activeTab.message ? (
                    <span
                      className={`review-file-header__state is-${activeTab.availability}`}
                      role="status"
                    >
                      {activeTab.message}
                    </span>
                  ) : null}
                  <div aria-label="File view" className="review-workspace__segmented" role="group">
                    {views.map((view) => (
                      <button
                        aria-pressed={fileView === view}
                        key={view}
                        onClick={() => {
                          flushFileScroll();
                          dispatchOpenFiles({ type: "set-mode", mode: view });
                          setReviewMode(view === "diff" ? "changes" : "files");
                        }}
                        type="button"
                      >
                        {view}
                      </button>
                    ))}
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
              {visibleReviewMode === "changes" && !fileFocused && !loading && !error && snapshot ? (
                snapshot.changes.status === "changed" ? (
                  <Suspense
                    fallback={<div className="review-workspace__empty">Preparing diff…</div>}
                  >
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
              {fileFocused &&
              activeTab?.availability !== "stale" &&
              activeTab?.availability !== "removed" &&
              activeTab?.availability !== "unavailable" &&
              !error &&
              snapshot &&
              fileView === "diff" ? (
                selectedChange ? (
                  <Suspense
                    fallback={<div className="review-workspace__empty">Preparing diff…</div>}
                  >
                    <DiffViews
                      file={selectedChange}
                      files={snapshot.changes.files}
                      generatedAt={snapshot.generatedAt}
                      mode={diffMode}
                      onScroll={saveFileScroll}
                      scrollRef={setFileScrollElement}
                      theme={theme}
                    />
                  </Suspense>
                ) : (
                  <div className="review-workspace__empty">This file has no working-tree diff.</div>
                )
              ) : null}
              {fileFocused &&
              activeTab?.availability !== "stale" &&
              activeTab?.availability !== "removed" &&
              activeTab?.availability !== "unavailable" &&
              !error &&
              selectedFileId &&
              fileView !== "diff" ? (
                activeFileSnapshot ? (
                  <Suspense
                    fallback={<div className="review-workspace__empty">Preparing source…</div>}
                  >
                    <SyntaxSourceView
                      onScroll={saveFileScroll}
                      scrollRef={setFileScrollElement}
                      snapshot={activeFileSnapshot}
                      theme={theme}
                    />
                  </Suspense>
                ) : (
                  <div className="review-workspace__empty" role="status">
                    Reading {fileView}…
                  </div>
                )
              ) : null}
              {fileFocused &&
              activeTab &&
              !error &&
              (activeTab.availability === "stale" ||
                activeTab.availability === "removed" ||
                activeTab.availability === "unavailable") ? (
                <div className="review-workspace__empty" role="status">
                  <strong>{activeTab.availability}</strong>
                  <span>
                    {activeTab.message ?? "This file is not available in the current snapshot."}
                  </span>
                </div>
              ) : null}
            </main>
          </div>
        </div>

        {snapshot?.diagnostics.length ? (
          <footer className="review-workspace__footer">{snapshot.diagnostics.join(" ")}</footer>
        ) : null}
      </section>
    </ModalDialog>
  );
};
