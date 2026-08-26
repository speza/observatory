import { Effect } from "effect";
import { existsSync } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  workspaceError,
  WorkspaceError,
  type WorkspaceDiffFile,
  type WorkspaceDiffFileContent,
  type WorkspaceDiffFileStatus,
  type WorkspaceDiffReader,
  type WorkspaceDiffSnapshot,
  type PreparedWorkspace,
  type WorkspaceBrowser,
  type WorkspaceChoice,
  type WorkspaceProvider,
  type WorkspaceSelection,
} from "./types.ts";

const MAX_DIFF_BYTES = 750_000;
const MAX_DIFF_FILES = 120;
const MAX_FILE_BYTES = 300_000;
const MAX_COMMAND_STDERR_BYTES = 64_000;

export interface WorkspaceCommandOptions {
  /** Maximum number of stdout bytes retained by the command runner. */
  readonly maxStdoutBytes?: number;
  /** Maximum number of stderr bytes retained by the command runner. */
  readonly maxStderrBytes?: number;
}

export interface WorkspaceCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
}

export interface WorkspaceCommandRunner {
  run(
    argv: readonly string[],
    cwd?: string,
    options?: WorkspaceCommandOptions,
  ): Promise<WorkspaceCommandResult>;
}

interface BoundedStreamResult {
  readonly text: string;
  readonly truncated: boolean;
}

const readCommandStream = async (
  stream: ReadableStream<Uint8Array> | null,
  maxBytes?: number,
): Promise<BoundedStreamResult> => {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let truncated = false;
  try {
    while (true) {
      // Stream reads must stay sequential so the retained-byte cap is exact.
      // eslint-disable-next-line no-await-in-loop -- bounded stream consumption is inherently sequential.
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (maxBytes === undefined) {
        chunks.push(value);
        retainedBytes += value.byteLength;
        continue;
      }
      const remaining = maxBytes - retainedBytes;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        retainedBytes += remaining;
        truncated = true;
      } else {
        chunks.push(value);
        retainedBytes += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    truncated,
  };
};

export class BunWorkspaceCommandRunner implements WorkspaceCommandRunner {
  async run(
    argv: readonly string[],
    cwd?: string,
    options?: WorkspaceCommandOptions,
  ): Promise<WorkspaceCommandResult> {
    const process = Bun.spawn([...argv], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = readCommandStream(process.stdout, options?.maxStdoutBytes);
    const stderrPromise = readCommandStream(
      process.stderr,
      options?.maxStderrBytes ?? MAX_COMMAND_STDERR_BYTES,
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      process.exited,
    ]);
    return {
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated || undefined,
      stderrTruncated: stderr.truncated || undefined,
    };
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

const gitHead = async (runner: WorkspaceCommandRunner, path: string): Promise<string | undefined> =>
  commandOutput(runner, ["git", "rev-parse", "HEAD"], path);

const languageForPath = (path: string): string | undefined => {
  const extension = extname(path).slice(1).toLowerCase();
  if (!extension) return undefined;
  if (extension === "md" || extension === "mdx") return "markdown";
  if (extension === "yml") return "yaml";
  if (extension === "html") return "xml";
  if (extension === "sh" || extension === "zsh") return "shellscript";
  return extension;
};

const safeRepositoryRelativePath = (value: string): string | undefined => {
  const path = value.trim();
  if (!path || path === "/dev/null" || path.startsWith("/") || path.includes("\\"))
    return undefined;
  if (path.split("/").some((segment) => segment === ".." || segment === "")) return undefined;
  return path;
};

const safeDiffPath = (value: string): string | undefined =>
  safeRepositoryRelativePath(value.replace(/^a\//u, "").replace(/^b\//u, ""));

const pathForDiffLine = (line: string, marker: "--- " | "+++ "): string | undefined => {
  if (!line.startsWith(marker)) return undefined;
  return safeDiffPath(line.slice(marker.length).split("\t", 1)[0] ?? "");
};

interface ParsedPatch {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: WorkspaceDiffFileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly hunks: readonly string[];
}

interface DiffPathHeader {
  readonly oldPath?: string;
  readonly path?: string;
}

const parseDiffPathHeader = (line: string): DiffPathHeader => {
  const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
  if (!match) return {};
  return { oldPath: safeDiffPath(match[1]!), path: safeDiffPath(match[2]!) };
};

const parseGitDiff = (raw: string): readonly ParsedPatch[] => {
  if (!raw) return [];
  const segments = raw
    .split(/^diff --git /mu)
    .slice(1)
    .map((segment) => `diff --git ${segment}`);
  return segments.flatMap((segment): readonly ParsedPatch[] => {
    const lines = segment.split("\n");
    const headerPaths = parseDiffPathHeader(lines[0] ?? "");
    const oldLine = lines.find((line) => line.startsWith("--- "));
    const newLine = lines.find((line) => line.startsWith("+++ "));
    const oldPath = oldLine ? pathForDiffLine(oldLine, "--- ") : headerPaths.oldPath;
    const path = newLine ? pathForDiffLine(newLine, "+++ ") : headerPaths.path;
    if (!path && !oldPath) return [];
    const hunkIndexes = lines.flatMap((line, index) => (line.startsWith("@@ ") ? [index] : []));
    const oldHeader = oldLine ?? `--- ${oldPath ? `a/${oldPath}` : "/dev/null"}`;
    const newHeader = newLine ?? `+++ ${path ? `b/${path}` : "/dev/null"}`;
    const hunks = hunkIndexes.map((start, index) => {
      const end = hunkIndexes[index + 1] ?? lines.length;
      return [oldHeader, newHeader, lines.slice(start, end).join("\n")]
        .join("\n")
        .replace(/\n+$/u, "");
    });
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      const hunkLines = hunk.split("\n");
      const bodyStart = hunkLines.findIndex((line) => line.startsWith("@@ ")) + 1;
      for (const line of hunkLines.slice(bodyStart)) {
        if (line.startsWith("+")) additions += 1;
        else if (line.startsWith("-")) deletions += 1;
      }
    }
    const binary = lines.some(
      (line) => line.startsWith("Binary files ") || line === "GIT binary patch",
    );
    const status: WorkspaceDiffFileStatus = !oldPath
      ? "added"
      : !path
        ? "deleted"
        : lines.some((line) => line.startsWith("rename from "))
          ? "renamed"
          : lines.some((line) => line.startsWith("copy from "))
            ? "copied"
            : "modified";
    return [
      {
        path: path ?? oldPath!,
        oldPath: oldPath && path && oldPath !== path ? oldPath : undefined,
        status,
        additions,
        deletions,
        binary,
        hunks,
      },
    ];
  });
};

const emptyDiff = (
  path: string,
  now: number,
  status: WorkspaceDiffSnapshot["status"],
  message?: string,
): WorkspaceDiffSnapshot => ({
  kind: "working-tree-diff",
  status,
  worktree: path,
  files: [],
  additions: 0,
  deletions: 0,
  truncated: false,
  generatedAt: now,
  message,
});

const emptyFileContent = (fileName: string): WorkspaceDiffFileContent => ({
  fileName,
  fileLang: languageForPath(fileName),
  content: "",
});

interface BoundedFileResult {
  readonly bytes: Buffer;
  readonly tooLarge: boolean;
}

const readFileBounded = async (
  path: string,
  maxBytes: number,
): Promise<BoundedFileResult | undefined> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const info = await handle.stat();
    if (!info.isFile()) return undefined;
    if (info.size > maxBytes) return { bytes: Buffer.alloc(0), tooLarge: true };

    const chunks: Buffer[] = [];
    const chunkSize = Math.min(64 * 1024, maxBytes + 1);
    const buffer = Buffer.allocUnsafe(chunkSize);
    let total = 0;
    while (true) {
      // File reads must stay sequential so the bounded buffer cannot be exceeded.
      // eslint-disable-next-line no-await-in-loop -- bounded file consumption is inherently sequential.
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const remaining = maxBytes + 1 - total;
      if (bytesRead >= remaining) return { bytes: Buffer.alloc(0), tooLarge: true };
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
      if (bytesRead < buffer.length) break;
    }
    return { bytes: Buffer.concat(chunks), tooLarge: false };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

const readWorkspaceFile = async (
  root: string,
  path: string,
): Promise<
  { readonly content: string; readonly binary: boolean; readonly tooLarge: boolean } | undefined
> => {
  const candidate = resolve(root, path);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || relativePath.includes("\\")) return undefined;
  try {
    // A Git path can be a symlink. Resolve it before reading so a malformed
    // repository cannot make the read-only review escape its trusted root.
    const resolvedCandidate = await realpath(candidate);
    const resolvedRelativePath = relative(root, resolvedCandidate);
    if (resolvedRelativePath.startsWith("..") || resolvedRelativePath.includes("\\"))
      return undefined;
    const result = await readFileBounded(resolvedCandidate, MAX_FILE_BYTES);
    if (!result) return undefined;
    if (result.tooLarge) return { content: "", binary: false, tooLarge: true };
    return {
      content: result.bytes.toString("utf8"),
      binary: result.bytes.includes(0),
      tooLarge: false,
    };
  } catch {
    return undefined;
  }
};

const readGitFile = async (
  runner: WorkspaceCommandRunner,
  root: string,
  path: string,
): Promise<
  { readonly content: string; readonly binary: boolean; readonly tooLarge: boolean } | undefined
> => {
  const result = await runner.run(["git", "show", `HEAD:${path}`], root, {
    maxStdoutBytes: MAX_FILE_BYTES,
  });
  if (result.exitCode !== 0) return undefined;
  if (result.stdoutTruncated || Buffer.byteLength(result.stdout) > MAX_FILE_BYTES)
    return { content: "", binary: false, tooLarge: true };
  return { content: result.stdout, binary: result.stdout.includes("\u0000"), tooLarge: false };
};

interface UntrackedPathResult {
  readonly paths: readonly string[];
  readonly incomplete: boolean;
}

const untrackedPaths = async (
  runner: WorkspaceCommandRunner,
  root: string,
): Promise<UntrackedPathResult> => {
  const result = await runner.run(
    ["git", "ls-files", "--others", "--exclude-standard", "-z"],
    root,
    { maxStdoutBytes: MAX_DIFF_BYTES },
  );
  if (result.exitCode !== 0) return { paths: [], incomplete: true };
  const records = result.stdout.split("\u0000");
  const completeRecords =
    result.stdoutTruncated && !result.stdout.endsWith("\u0000") ? records.slice(0, -1) : records;
  let incomplete = result.stdoutTruncated === true;
  const paths: string[] = [];
  for (const path of completeRecords) {
    if (!path) continue;
    const safePath = safeRepositoryRelativePath(path);
    if (!safePath) {
      incomplete = true;
      continue;
    }
    paths.push(safePath);
  }
  return { paths, incomplete };
};

const untrackedHunk = (path: string, content: string): string => {
  const lines = content.replace(/\n$/u, "").split("\n");
  const header = `--- /dev/null\n+++ b/${path}`;
  if (lines.length === 1 && lines[0] === "") return `${header}\n@@ -0,0 +0,0 @@`;
  return `${header}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
};

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

export class LocalWorkspaceProvider implements WorkspaceProvider, WorkspaceDiffReader {
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

  inspectWorkingTree(
    path: string,
    now: number,
  ): Effect.Effect<WorkspaceDiffSnapshot, WorkspaceError> {
    return Effect.tryPromise({
      try: async () => {
        let worktree: string;
        try {
          worktree = await this.requireDirectory(path);
        } catch (error) {
          const candidate = path.trim() ? resolve(path) : resolve(process.cwd());
          return emptyDiff(
            candidate,
            now,
            "unavailable",
            error instanceof WorkspaceError ? error.message : "Workspace path is unavailable.",
          );
        }

        const repositoryRoot = await gitRoot(this.runner, worktree);
        if (!repositoryRoot)
          return {
            ...emptyDiff(worktree, now, "not-git", "The observed workspace is not a Git checkout."),
            worktree,
          } satisfies WorkspaceDiffSnapshot;

        const root = resolve(repositoryRoot);
        const head = await gitHead(this.runner, root);
        const branch = await gitBranch(this.runner, root);
        const diffResult = await this.runner.run(
          [
            "git",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            "HEAD",
            "--",
          ],
          root,
          { maxStdoutBytes: MAX_DIFF_BYTES },
        );
        if (diffResult.exitCode !== 0) {
          const detail = diffResult.stderr.trim().slice(0, 240);
          return {
            ...emptyDiff(
              worktree,
              now,
              "unavailable",
              detail ? `Git diff inspection failed: ${detail}` : "Git diff inspection failed.",
            ),
            worktree,
            repository: basename(root),
            branch: branch || undefined,
            head,
          } satisfies WorkspaceDiffSnapshot;
        }
        const rawDiff = diffResult.stdout;
        const truncatedDiff =
          diffResult.stdoutTruncated === true || Buffer.byteLength(rawDiff) > MAX_DIFF_BYTES;
        const parsed = parseGitDiff(rawDiff.slice(0, MAX_DIFF_BYTES));
        const files: WorkspaceDiffFile[] = [];
        let truncated = truncatedDiff;

        for (const patch of parsed.slice(0, MAX_DIFF_FILES)) {
          const oldFilePath = patch.oldPath ?? (patch.status === "added" ? undefined : patch.path);
          const oldContent = oldFilePath
            ? await readGitFile(this.runner, root, oldFilePath)
            : { content: "", binary: false, tooLarge: false };
          const newContent =
            patch.status === "deleted"
              ? { content: "", binary: false, tooLarge: false }
              : await readWorkspaceFile(root, patch.path);
          if ((oldFilePath && !oldContent) || (patch.status !== "deleted" && !newContent))
            truncated = true;
          const binary =
            patch.binary ||
            oldContent?.binary === true ||
            newContent?.binary === true ||
            oldContent?.tooLarge === true ||
            newContent?.tooLarge === true;
          truncated ||= oldContent?.tooLarge === true || newContent?.tooLarge === true;
          files.push({
            ...patch,
            binary,
            oldFile: binary
              ? undefined
              : oldContent
                ? {
                    fileName: oldFilePath ?? patch.path,
                    fileLang: languageForPath(oldFilePath ?? patch.path),
                    content: oldContent.content,
                  }
                : undefined,
            newFile: binary
              ? undefined
              : newContent
                ? {
                    fileName: patch.path,
                    fileLang: languageForPath(patch.path),
                    content: newContent.content,
                  }
                : patch.status === "deleted"
                  ? emptyFileContent(patch.path)
                  : undefined,
            hunks: binary ? [] : patch.hunks,
          });
        }

        if (parsed.length > MAX_DIFF_FILES) truncated = true;
        const trackedPaths = new Set(files.map((file) => file.path));
        const untracked = await untrackedPaths(this.runner, root);
        truncated ||= untracked.incomplete;
        for (const untrackedPath of untracked.paths) {
          if (trackedPaths.has(untrackedPath)) continue;
          if (files.length >= MAX_DIFF_FILES) {
            truncated = true;
            break;
          }
          const content = await readWorkspaceFile(root, untrackedPath);
          if (!content) {
            truncated = true;
            continue;
          }
          const binary = content.binary || content.tooLarge;
          truncated ||= content.tooLarge;
          files.push({
            path: untrackedPath,
            status: "untracked",
            additions:
              binary || content.content.length === 0
                ? 0
                : content.content.replace(/\n$/u, "").split("\n").length,
            deletions: 0,
            binary,
            oldFile: binary ? undefined : emptyFileContent(untrackedPath),
            newFile: binary
              ? undefined
              : {
                  fileName: untrackedPath,
                  fileLang: languageForPath(untrackedPath),
                  content: content.content,
                },
            hunks: binary ? [] : [untrackedHunk(untrackedPath, content.content)],
          });
        }

        files.sort((left, right) => left.path.localeCompare(right.path));
        const additions = files.reduce((total, file) => total + file.additions, 0);
        const deletions = files.reduce((total, file) => total + file.deletions, 0);
        const status: WorkspaceDiffSnapshot["status"] =
          files.length > 0 ? "changed" : truncated ? "unavailable" : "clean";
        return {
          kind: "working-tree-diff",
          status,
          worktree,
          repository: basename(root),
          branch: branch || undefined,
          head,
          files,
          additions,
          deletions,
          truncated,
          generatedAt: now,
          message: truncated
            ? "Workspace inspection is incomplete; large or unreadable changes are abbreviated."
            : undefined,
        } satisfies WorkspaceDiffSnapshot;
      },
      catch: (error) =>
        error instanceof WorkspaceError
          ? error
          : workspaceError(
              "workspace.inspectWorkingTree",
              error instanceof Error ? error.message : String(error),
            ),
    });
  }

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
