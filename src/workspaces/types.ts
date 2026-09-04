import type { Effect } from "effect";

export class WorkspaceError extends Error {
  readonly _tag = "WorkspaceError" as const;

  constructor(
    readonly operation: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export const workspaceError = (operation: string, message: string): WorkspaceError =>
  new WorkspaceError(operation, message);

export type WorkspaceSelection =
  | {
      readonly kind: "existing";
      readonly path: string;
    }
  | {
      readonly kind: "worktree";
      readonly repositoryPath: string;
      readonly branch: string;
      readonly base?: string;
      readonly path?: string;
    };

export interface WorkspaceChoice {
  readonly path: string;
  readonly label: string;
  readonly kind: "workspace" | "directory";
  readonly repository?: string;
  readonly branch?: string;
  readonly available: boolean;
}

export interface WorkspaceBrowser {
  readonly path: string;
  readonly parentPath?: string;
  readonly entries: readonly WorkspaceChoice[];
}

export interface PreparedWorkspace {
  readonly path: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly worktree: boolean;
  readonly warnings: readonly string[];
}

export interface WorkspaceProvider {
  listChoices(query?: string): Effect.Effect<readonly WorkspaceChoice[], WorkspaceError>;
  /** Optional filesystem-style browsing capability for picker-based clients. */
  readonly browse?: (path: string) => Effect.Effect<WorkspaceBrowser, WorkspaceError>;
  prepare(selection: WorkspaceSelection): Effect.Effect<PreparedWorkspace, WorkspaceError>;
}

/** A bounded, read-only view of one agent workspace's current Git changes. */
export type WorkspaceDiffFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked";

export interface WorkspaceDiffFileContent {
  readonly fileName: string;
  readonly fileLang?: string;
  readonly content: string;
}

export interface WorkspaceDiffFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: WorkspaceDiffFileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly oldFile?: WorkspaceDiffFileContent;
  readonly newFile?: WorkspaceDiffFileContent;
  /** Raw unified hunks, in the format accepted by the web diff renderer. */
  readonly hunks: readonly string[];
}

export type WorkspaceDiffStatus = "clean" | "changed" | "not-git" | "unavailable";

export interface WorkspaceDiffSnapshot {
  readonly kind: "working-tree-diff";
  readonly status: WorkspaceDiffStatus;
  readonly worktree: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly head?: string;
  readonly files: readonly WorkspaceDiffFile[];
  readonly additions: number;
  readonly deletions: number;
  readonly truncated: boolean;
  readonly generatedAt: number;
  readonly message?: string;
}

/** Capability port for read-only workspace evidence; implementations live at the edge. */
export interface WorkspaceDiffReader {
  inspectWorkingTree(
    path: string,
    now: number,
  ): Effect.Effect<WorkspaceDiffSnapshot, WorkspaceError>;
}

export type WorkspaceReviewContentKind = "text" | "binary" | "oversized" | "unknown";

/** One browser-safe entry in a bounded repository index. */
export interface WorkspaceReviewTreeEntry {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly change?: WorkspaceDiffFileStatus;
  readonly changedDescendants: number;
  readonly contentKind?: WorkspaceReviewContentKind;
}

/** A coherent, process-local review capability over one trusted workspace. */
export interface WorkspaceReviewSnapshot {
  readonly kind: "workspace-review";
  readonly snapshotId: string;
  readonly generatedAt: number;
  readonly status: "complete" | "partial" | "unavailable" | "not-git";
  readonly repository?: string;
  readonly branch?: string;
  readonly head?: string;
  readonly tree: readonly WorkspaceReviewTreeEntry[];
  readonly treeComplete: boolean;
  readonly changes: WorkspaceDiffSnapshot;
  readonly diagnostics: readonly string[];
}

export type WorkspaceReviewFileView = "source" | "baseline";

export interface WorkspaceReviewFileRequest {
  readonly workspacePath: string;
  readonly snapshotId: string;
  readonly fileId: string;
  readonly view: WorkspaceReviewFileView;
}

export interface WorkspaceReviewFileSnapshot {
  readonly kind: "workspace-review-file";
  readonly snapshotId: string;
  readonly fileId: string;
  readonly displayPath: string;
  readonly view: WorkspaceReviewFileView;
  readonly status: "available" | "stale" | "missing" | "binary" | "oversized" | "unavailable";
  readonly language?: string;
  readonly content?: string;
  readonly truncated: boolean;
  readonly generatedAt: number;
  readonly message?: string;
}

/** Read-only workspace review; callers resolve accepted Agent paths before use. */
export interface WorkspaceReviewReader {
  inspectWorkspace(
    path: string,
    now: number,
  ): Effect.Effect<WorkspaceReviewSnapshot, WorkspaceError>;
  readWorkspaceReviewFile(
    request: WorkspaceReviewFileRequest,
    now: number,
  ): Effect.Effect<WorkspaceReviewFileSnapshot, WorkspaceError>;
}
