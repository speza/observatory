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
