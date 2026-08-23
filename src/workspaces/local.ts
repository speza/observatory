import { Effect } from "effect";
import { existsSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  workspaceError,
  WorkspaceError,
  type PreparedWorkspace,
  type WorkspaceBrowser,
  type WorkspaceChoice,
  type WorkspaceProvider,
  type WorkspaceSelection,
} from "./types.ts";

export interface WorkspaceCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WorkspaceCommandRunner {
  run(argv: readonly string[], cwd?: string): Promise<WorkspaceCommandResult>;
}

export class BunWorkspaceCommandRunner implements WorkspaceCommandRunner {
  async run(argv: readonly string[], cwd?: string): Promise<WorkspaceCommandResult> {
    const process = Bun.spawn([...argv], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = new Response(process.stdout).text();
    const stderrPromise = new Response(process.stderr).text();
    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      process.exited,
    ]);
    return { exitCode, stdout, stderr };
  }
}

const cleanPath = (value: string): string => value.trim();

const commandOutput = async (
  runner: WorkspaceCommandRunner,
  argv: readonly string[],
  cwd: string,
): Promise<string | undefined> => {
  const result = await runner.run(argv, cwd);
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
};

const gitRoot = async (runner: WorkspaceCommandRunner, path: string): Promise<string | undefined> =>
  commandOutput(runner, ["git", "rev-parse", "--show-toplevel"], path);

const gitBranch = async (
  runner: WorkspaceCommandRunner,
  path: string,
): Promise<string | undefined> => commandOutput(runner, ["git", "branch", "--show-current"], path);

const gitDirty = async (runner: WorkspaceCommandRunner, path: string): Promise<boolean> =>
  (await commandOutput(runner, ["git", "status", "--porcelain", "--untracked-files=no"], path)) !==
  undefined;

const safeWorktreeSlug = (branch: string): string =>
  branch
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "worktree";

const matchesQuery = (choice: WorkspaceChoice, query: string): boolean => {
  if (!query) return true;
  const haystack =
    `${choice.label} ${choice.path} ${choice.repository ?? ""} ${choice.branch ?? ""}`.toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
};

export class LocalWorkspaceProvider implements WorkspaceProvider {
  private readonly locations: string[];

  constructor(options?: {
    readonly cwd?: string;
    readonly locations?: readonly string[];
    readonly runner?: WorkspaceCommandRunner;
  }) {
    this.runner = options?.runner ?? new BunWorkspaceCommandRunner();
    const cwd = options?.cwd ?? process.cwd();
    this.locations = [
      ...new Set([cwd, ...(options?.locations ?? [])].map(cleanPath).filter(Boolean)),
    ];
  }

  private readonly runner: WorkspaceCommandRunner;

  listChoices(query = ""): Effect.Effect<readonly WorkspaceChoice[], WorkspaceError> {
    return Effect.tryPromise({
      try: async () => {
        const choices = await Promise.all(
          this.locations.map(async (location): Promise<WorkspaceChoice | undefined> => {
            const path = resolve(location);
            try {
              const info = await stat(path);
              if (!info.isDirectory()) return undefined;
              const repositoryRoot = await gitRoot(this.runner, path);
              const branch = repositoryRoot ? await gitBranch(this.runner, path) : undefined;
              return {
                path,
                label: basename(path) || path,
                kind: "workspace",
                repository: repositoryRoot ? basename(repositoryRoot) : undefined,
                branch,
                available: true,
              };
            } catch {
              return {
                path,
                label: basename(path) || path,
                kind: "workspace",
                available: false,
              };
            }
          }),
        );
        return choices.filter(
          (choice): choice is WorkspaceChoice =>
            choice !== undefined && matchesQuery(choice, query),
        );
      },
      catch: (error) =>
        workspaceError(
          "workspace.listChoices",
          error instanceof Error ? error.message : String(error),
        ),
    });
  }

  browse(inputPath: string): Effect.Effect<WorkspaceBrowser, WorkspaceError> {
    return Effect.tryPromise({
      try: async () => {
        const path = await this.requireDirectory(inputPath);
        const names = await readdir(path, { withFileTypes: true });
        const entries = await Promise.all(
          names
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => this.inspectChoice(join(path, entry.name), "directory")),
        );
        return {
          path,
          parentPath: dirname(path) === path ? undefined : dirname(path),
          entries: entries.filter((entry): entry is WorkspaceChoice => entry !== undefined),
        } satisfies WorkspaceBrowser;
      },
      catch: (error) =>
        error instanceof WorkspaceError
          ? error
          : workspaceError(
              "workspace.browse",
              error instanceof Error ? error.message : String(error),
            ),
    });
  }

  prepare(selection: WorkspaceSelection): Effect.Effect<PreparedWorkspace, WorkspaceError> {
    return Effect.tryPromise({
      try: async () => {
        if (selection.kind === "existing") return this.prepareExisting(selection.path);
        return this.prepareWorktree(selection);
      },
      catch: (error) =>
        error instanceof WorkspaceError
          ? error
          : workspaceError(
              "workspace.prepare",
              error instanceof Error ? error.message : String(error),
            ),
    });
  }

  private async prepareExisting(inputPath: string): Promise<PreparedWorkspace> {
    const path = await this.requireDirectory(inputPath);
    const repositoryRoot = await gitRoot(this.runner, path);
    const branch = repositoryRoot ? await gitBranch(this.runner, path) : undefined;
    const warnings: string[] = [];
    if (repositoryRoot && (await gitDirty(this.runner, path)))
      warnings.push("The checkout has uncommitted changes.");
    return {
      path,
      repository: repositoryRoot,
      branch: branch || undefined,
      worktree: false,
      warnings,
    };
  }

  private async inspectChoice(
    inputPath: string,
    kind: WorkspaceChoice["kind"],
  ): Promise<WorkspaceChoice | undefined> {
    try {
      const path = await realpath(inputPath);
      const repositoryRoot = await gitRoot(this.runner, path);
      const branch = repositoryRoot ? await gitBranch(this.runner, path) : undefined;
      return {
        path,
        label: basename(path) || path,
        kind,
        repository: repositoryRoot ? basename(repositoryRoot) : undefined,
        branch,
        available: true,
      };
    } catch {
      return undefined;
    }
  }

  private async prepareWorktree(
    selection: Extract<WorkspaceSelection, { readonly kind: "worktree" }>,
  ): Promise<PreparedWorkspace> {
    const repositoryPath = await this.requireDirectory(selection.repositoryPath);
    const repositoryRoot = await gitRoot(this.runner, repositoryPath);
    if (!repositoryRoot)
      throw workspaceError(
        "workspace.prepare.worktree",
        "A new worktree requires a Git repository.",
      );
    const branch = selection.branch.trim();
    if (!branch) throw workspaceError("workspace.prepare.worktree", "A branch name is required.");
    const target = resolve(
      selection.path?.trim() ||
        join(dirname(repositoryRoot), `${basename(repositoryRoot)}-${safeWorktreeSlug(branch)}`),
    );
    if (existsSync(target))
      throw workspaceError("workspace.prepare.worktree", `Worktree path already exists: ${target}`);
    const base = selection.base?.trim() || "HEAD";
    const result = await this.runner.run(
      ["git", "worktree", "add", "-b", branch, target, base],
      repositoryRoot,
    );
    if (result.exitCode !== 0)
      throw workspaceError(
        "workspace.prepare.worktree",
        result.stderr.trim() || `Git could not create worktree at ${target}.`,
      );
    return {
      path: target,
      repository: repositoryRoot,
      branch,
      worktree: true,
      warnings: [],
    };
  }

  private async requireDirectory(inputPath: string): Promise<string> {
    const trimmed = cleanPath(inputPath);
    if (!trimmed) throw workspaceError("workspace.prepare", "A workspace path is required.");
    const candidate = resolve(isAbsolute(trimmed) ? trimmed : join(process.cwd(), trimmed));
    let info;
    try {
      info = await stat(candidate);
    } catch {
      throw workspaceError("workspace.prepare", `Workspace path does not exist: ${candidate}`);
    }
    if (!info.isDirectory())
      throw workspaceError("workspace.prepare", `Workspace path is not a directory: ${candidate}`);
    try {
      return await realpath(candidate);
    } catch {
      throw workspaceError(
        "workspace.prepare",
        `Workspace path could not be resolved: ${candidate}`,
      );
    }
  }
}
