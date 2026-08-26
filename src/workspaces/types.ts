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
