import type {
  WorkspaceDiffFileStatus,
  WorkspaceReviewContentKind,
} from "../../../src/workspaces/types.ts";
import { Schema } from "effect";

export const MAX_OPEN_FILE_TABS = 8;
const MAX_SCROLL_OFFSET = 10_000_000;
const REVIEW_TABS_KEY_PREFIX = "observatory.review-tabs.v1.";

export type ReviewFileMode = "source" | "baseline" | "diff";
export type ReviewTabAvailability =
  | "available"
  | "stale"
  | "removed"
  | "binary"
  | "oversized"
  | "unavailable";

export interface ReviewScrollPosition {
  readonly top: number;
  readonly left: number;
}

export interface ReviewFileResolution {
  readonly path: string;
  readonly fileId: string;
  readonly change?: WorkspaceDiffFileStatus;
  readonly contentKind?: WorkspaceReviewContentKind;
}

export interface OpenFileTab {
  readonly path: string;
  readonly previousPath?: string;
  readonly fileId?: string;
  readonly change?: WorkspaceDiffFileStatus;
  readonly mode: ReviewFileMode;
  readonly scroll: Readonly<Partial<Record<ReviewFileMode, ReviewScrollPosition>>>;
  readonly availability: ReviewTabAvailability;
  readonly message?: string;
  readonly viewState: Readonly<
    Partial<
      Record<
        Exclude<ReviewFileMode, "diff">,
        {
          readonly status: "binary" | "missing" | "oversized" | "unavailable";
          readonly message?: string;
        }
      >
    >
  >;
}

export interface OpenFileTabsState {
  readonly tabs: readonly OpenFileTab[];
  /** Least recently used first. */
  readonly recency: readonly string[];
  readonly activePath?: string;
}

export type OpenFileTabsAction =
  | { readonly type: "replace"; readonly state: OpenFileTabsState }
  | {
      readonly type: "open";
      readonly file: ReviewFileResolution;
      readonly preferredMode: ReviewFileMode;
    }
  | { readonly type: "activate"; readonly path: string }
  | { readonly type: "close"; readonly path: string }
  | { readonly type: "set-mode"; readonly mode: ReviewFileMode }
  | {
      readonly type: "save-scroll";
      readonly path: string;
      readonly mode: ReviewFileMode;
      readonly top: number;
      readonly left: number;
    }
  | {
      readonly type: "file-status";
      readonly path: string;
      readonly mode: Exclude<ReviewFileMode, "diff">;
      readonly status: "available" | "stale" | "missing" | "binary" | "oversized" | "unavailable";
      readonly message?: string;
    }
  | { readonly type: "refresh-start" }
  | {
      readonly type: "reconcile";
      readonly files: readonly ReviewFileResolution[];
      readonly renames: readonly { readonly oldPath: string; readonly path: string }[];
      readonly absenceEvidence: "authoritative" | "incomplete" | "unavailable";
    };

export const EMPTY_OPEN_FILE_TABS: OpenFileTabsState = { tabs: [], recency: [] };

const safeOffset = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_SCROLL_OFFSET, Math.max(0, value)) : 0;

export const safeScrollPosition = (top: number, left: number): ReviewScrollPosition => ({
  top: safeOffset(top),
  left: safeOffset(left),
});

const touch = (recency: readonly string[], path: string): readonly string[] => [
  ...recency.filter((candidate) => candidate !== path),
  path,
];

const availabilityFor = (file: ReviewFileResolution): ReviewTabAvailability => {
  if (file.contentKind === "binary") return "binary";
  if (file.contentKind === "oversized") return "oversized";
  return "available";
};

export const availableFileModes = (
  change: WorkspaceDiffFileStatus | undefined,
): readonly ReviewFileMode[] => {
  if (!change) return ["source"];
  if (change === "deleted") return ["diff", "baseline"];
  if (change === "added" || change === "untracked") return ["source", "diff"];
  return ["source", "diff", "baseline"];
};

const validMode = (
  requested: ReviewFileMode,
  change: WorkspaceDiffFileStatus | undefined,
): ReviewFileMode => {
  const modes = availableFileModes(change);
  return modes.includes(requested) ? requested : (modes[0] ?? "source");
};

const resolvedTab = (
  tab: OpenFileTab,
  file: ReviewFileResolution,
  previousPath?: string,
): OpenFileTab => ({
  ...tab,
  path: file.path,
  previousPath: previousPath ?? tab.previousPath,
  fileId: file.fileId,
  change: file.change,
  mode: validMode(tab.mode, file.change),
  availability: availabilityFor(file),
  message: previousPath ? `Renamed from ${previousPath}.` : undefined,
  viewState: {},
});

export const reduceOpenFileTabs = (
  state: OpenFileTabsState,
  action: OpenFileTabsAction,
): OpenFileTabsState => {
  switch (action.type) {
    case "replace":
      return action.state;
    case "open": {
      const existing = state.tabs.find((tab) => tab.path === action.file.path);
      if (existing)
        return {
          tabs: state.tabs.map((tab) =>
            tab.path === existing.path ? resolvedTab(tab, action.file) : tab,
          ),
          recency: touch(state.recency, existing.path),
          activePath: existing.path,
        };

      const tab: OpenFileTab = {
        path: action.file.path,
        fileId: action.file.fileId,
        change: action.file.change,
        mode: validMode(action.preferredMode, action.file.change),
        scroll: {},
        availability: availabilityFor(action.file),
        viewState: {},
      };
      let tabs = [...state.tabs, tab];
      let recency = touch(state.recency, tab.path);
      if (tabs.length > MAX_OPEN_FILE_TABS) {
        const evicted = recency.find((path) => path !== state.activePath && path !== tab.path);
        if (evicted) {
          tabs = tabs.filter((candidate) => candidate.path !== evicted);
          recency = recency.filter((path) => path !== evicted);
        }
      }
      return { tabs, recency, activePath: tab.path };
    }
    case "activate":
      if (!state.tabs.some((tab) => tab.path === action.path)) return state;
      return { ...state, recency: touch(state.recency, action.path), activePath: action.path };
    case "close": {
      const index = state.tabs.findIndex((tab) => tab.path === action.path);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.path !== action.path);
      const activePath =
        state.activePath === action.path
          ? (tabs[index]?.path ?? tabs[index - 1]?.path)
          : state.activePath;
      return {
        tabs,
        recency: activePath
          ? touch(
              state.recency.filter((path) => path !== action.path),
              activePath,
            )
          : state.recency.filter((path) => path !== action.path),
        activePath,
      };
    }
    case "set-mode": {
      const active = state.tabs.find((tab) => tab.path === state.activePath);
      if (!active || !availableFileModes(active.change).includes(action.mode)) return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.path === active.path
            ? {
                ...tab,
                mode: action.mode,
              }
            : tab,
        ),
      };
    }
    case "save-scroll": {
      if (!state.tabs.some((tab) => tab.path === action.path)) return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.path === action.path
            ? {
                ...tab,
                scroll: {
                  ...tab.scroll,
                  [action.mode]: safeScrollPosition(action.top, action.left),
                },
              }
            : tab,
        ),
      };
    }
    case "file-status":
      if (!state.tabs.some((tab) => tab.path === action.path)) return state;
      if (action.status === "stale")
        return {
          ...state,
          tabs: state.tabs.map((tab) => ({
            ...tab,
            fileId: undefined,
            availability: "stale",
            message: action.message ?? "The workspace changed. Refresh review.",
            viewState: {},
          })),
        };
      const status = action.status;
      return {
        ...state,
        tabs: state.tabs.map((tab) => {
          if (tab.path !== action.path) return tab;
          const viewState = { ...tab.viewState };
          if (status === "available") delete viewState[action.mode];
          else
            viewState[action.mode] = action.message
              ? { status, message: action.message }
              : { status };
          return { ...tab, viewState };
        }),
      };
    case "refresh-start":
      return {
        ...state,
        tabs: state.tabs.map((tab) => ({
          ...tab,
          fileId: undefined,
          availability: "stale" as const,
          message: "Refreshing this file against the new workspace snapshot.",
          viewState: {},
        })),
      };
    case "reconcile": {
      const files = new Map(action.files.map((file) => [file.path, file] as const));
      const renameTargets = new Map<string, string[]>();
      for (const rename of action.renames) {
        const targets = renameTargets.get(rename.oldPath) ?? [];
        targets.push(rename.path);
        renameTargets.set(rename.oldPath, targets);
      }
      const claimed = new Set(state.tabs.flatMap((tab) => (files.has(tab.path) ? [tab.path] : [])));
      const pathChanges = new Map<string, string>();
      const tabs = state.tabs.map((tab): OpenFileTab => {
        const exact = files.get(tab.path);
        if (exact) {
          return resolvedTab(tab, exact);
        }
        const targets =
          renameTargets.get(tab.path) ??
          (tab.previousPath ? (renameTargets.get(tab.previousPath) ?? []) : []);
        const renamed = targets.length === 1 ? files.get(targets[0]!) : undefined;
        const renameTargetClaimed = renamed ? claimed.has(renamed.path) : false;
        if (renamed && !renameTargetClaimed) {
          claimed.add(renamed.path);
          pathChanges.set(tab.path, renamed.path);
          return resolvedTab(tab, renamed, tab.previousPath ?? tab.path);
        }
        return {
          ...tab,
          fileId: undefined,
          availability:
            targets.length > 0 || action.absenceEvidence !== "authoritative"
              ? "unavailable"
              : "removed",
          viewState: {},
          message:
            targets.length > 1
              ? "This path was renamed ambiguously; refresh navigation before choosing a replacement."
              : targets.length === 1
                ? renameTargetClaimed
                  ? `This path was renamed to ${targets[0]}, which is already open in another tab.`
                  : `This path was renamed to ${targets[0]}, but that target is not present in the refreshed index.`
                : action.absenceEvidence === "authoritative"
                  ? "This file was removed from the refreshed workspace."
                  : action.absenceEvidence === "incomplete"
                    ? "This file is not present in the incomplete refreshed index."
                    : "The refreshed workspace index is unavailable, so this file could not be resolved.",
        };
      });
      const rewritePath = (path: string): string => pathChanges.get(path) ?? path;
      return {
        tabs,
        recency: state.recency.map(rewritePath),
        activePath: state.activePath ? rewritePath(state.activePath) : undefined,
      };
    }
  }
};

export const tabPathForKey = (
  state: OpenFileTabsState,
  currentPath: string,
  key: string,
): string | undefined => {
  const index = state.tabs.findIndex((tab) => tab.path === currentPath);
  if (index < 0 || state.tabs.length === 0) return undefined;
  if (key === "Home") return state.tabs[0]?.path;
  if (key === "End") return state.tabs.at(-1)?.path;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  const delta = key === "ArrowRight" ? 1 : -1;
  return state.tabs[(index + delta + state.tabs.length) % state.tabs.length]?.path;
};

/** Guards state updates when an aborted transport still resolves its promise. */
export interface FileRequestToken {
  readonly nonce: symbol;
}

export const isCurrentFileRequest = (
  current: FileRequestToken | undefined,
  request: FileRequestToken,
  aborted: boolean,
): boolean => !aborted && current === request;

interface StoredReviewTabs {
  readonly version: 1;
  readonly activePath?: string;
  readonly tabs: readonly {
    readonly path: string;
    readonly mode: ReviewFileMode;
    readonly scroll: Readonly<Partial<Record<ReviewFileMode, ReviewScrollPosition>>>;
  }[];
}

export interface ReviewTabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const reviewTabStorage = (
  browserWindow: { readonly localStorage: ReviewTabStorage } | undefined = globalThis.window,
): ReviewTabStorage | undefined => {
  if (!browserWindow) return undefined;
  try {
    return browserWindow.localStorage;
  } catch {
    return undefined;
  }
};

const safeRepositoryPath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 1_024 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

const StoredScrollSchema = Schema.Struct({ top: Schema.Number, left: Schema.Number });
const StoredTabSchema = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literal("source", "baseline", "diff"),
  scroll: Schema.Struct({
    source: Schema.optional(StoredScrollSchema),
    baseline: Schema.optional(StoredScrollSchema),
    diff: Schema.optional(StoredScrollSchema),
  }),
});
const StoredReviewTabsSchema = Schema.Struct({
  version: Schema.Literal(1),
  activePath: Schema.optional(Schema.String),
  tabs: Schema.Array(StoredTabSchema),
});
const decodeStoredReviewTabs = Schema.decodeUnknownSync(Schema.parseJson(StoredReviewTabsSchema));

export const readOpenFileTabs = (
  storage: ReviewTabStorage | undefined,
  ownerId: string,
): OpenFileTabsState => {
  if (!storage) return EMPTY_OPEN_FILE_TABS;
  try {
    const encoded = storage.getItem(`${REVIEW_TABS_KEY_PREFIX}${ownerId}`);
    if (!encoded) return EMPTY_OPEN_FILE_TABS;
    const parsed = decodeStoredReviewTabs(encoded);
    const tabs = parsed.tabs.slice(0, MAX_OPEN_FILE_TABS).flatMap((candidate): OpenFileTab[] => {
      if (!safeRepositoryPath(candidate.path)) return [];
      const scroll = Object.fromEntries(
        (["source", "baseline", "diff"] as const).flatMap((mode) => {
          const position = candidate.scroll[mode];
          return position ? [[mode, safeScrollPosition(position.top, position.left)]] : [];
        }),
      );
      return [
        {
          path: candidate.path,
          mode: candidate.mode,
          scroll,
          availability: "stale",
          message: "Refresh review to resolve this saved tab.",
          viewState: {},
        },
      ];
    });
    const unique = tabs.filter(
      (tab, index) => tabs.findIndex((candidate) => candidate.path === tab.path) === index,
    );
    const activePath =
      parsed.activePath !== undefined &&
      safeRepositoryPath(parsed.activePath) &&
      unique.some((tab) => tab.path === parsed.activePath)
        ? parsed.activePath
        : unique[0]?.path;
    return { tabs: unique, recency: unique.map((tab) => tab.path), activePath };
  } catch {
    return EMPTY_OPEN_FILE_TABS;
  }
};

export const writeOpenFileTabs = (
  storage: ReviewTabStorage | undefined,
  ownerId: string,
  state: OpenFileTabsState,
): void => {
  if (!storage) return;
  const value: StoredReviewTabs = {
    version: 1,
    activePath: state.activePath,
    tabs: state.tabs.map(({ path, mode, scroll }) => ({ path, mode, scroll })),
  };
  try {
    storage.setItem(`${REVIEW_TABS_KEY_PREFIX}${ownerId}`, JSON.stringify(value));
  } catch {
    // Browser privacy and quota policies may disable storage; tabs remain in memory.
  }
};
