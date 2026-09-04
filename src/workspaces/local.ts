import { Effect } from "effect";
import { constants, existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { positiveIntegerSetting } from "../runtime/config.ts";
import {
  workspaceError,
  WorkspaceError,
  type WorkspaceDiffFile,
  type WorkspaceDiffFileContent,
  type WorkspaceDiffFileStatus,
  type WorkspaceDiffReader,
  type WorkspaceDiffSnapshot,
  type WorkspaceReviewFileRequest,
  type WorkspaceReviewFileSnapshot,
  type WorkspaceReviewReader,
  type WorkspaceReviewSnapshot,
  type WorkspaceReviewTreeEntry,
  type PreparedWorkspace,
  type WorkspaceBrowser,
  type WorkspaceChoice,
  type WorkspaceProvider,
  type WorkspaceSelection,
} from "./types.ts";

const MAX_DIFF_BYTES = 750_000;
const MAX_DIFF_FILES = 120;
const MAX_FILE_BYTES = 300_000;
const MAX_REVIEW_INDEX_BYTES = 1_500_000;
const MAX_REVIEW_FILES = 5_000;
const MAX_REVISION_PATHS = MAX_DIFF_FILES;
const REVISION_FINGERPRINT_BATCH_SIZE = 8;
const MAX_REVIEW_SNAPSHOTS = 24;
const REVIEW_SNAPSHOT_TTL_MS = 10 * 60_000;
const MAX_COMMAND_STDERR_BYTES = 64_000;
const MAX_COMMAND_STDOUT_BYTES = 256_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface WorkspaceCommandOptions {
  /** Maximum number of stdout bytes retained by the command runner. */
  readonly maxStdoutBytes?: number;
  /** Maximum number of stderr bytes retained by the command runner. */
  readonly maxStderrBytes?: number;
  readonly timeoutMs?: number;
}

export interface WorkspaceCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly timedOut?: boolean;
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
  onLimitExceeded?: () => void,
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
        if (!truncated) onLimitExceeded?.();
        truncated = true;
        continue;
      }
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        retainedBytes += remaining;
        truncated = true;
        onLimitExceeded?.();
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
  private readonly timeoutMs = positiveIntegerSetting(
    "AO_PROCESS_TIMEOUT_MS",
    process.env.AO_PROCESS_TIMEOUT_MS,
    DEFAULT_COMMAND_TIMEOUT_MS,
    { minimum: 100 },
  );

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
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      process.kill(9);
    }, options?.timeoutMs ?? this.timeoutMs);
    const stdoutPromise = readCommandStream(
      process.stdout,
      options?.maxStdoutBytes ?? MAX_COMMAND_STDOUT_BYTES,
      () => process.kill(9),
    );
    const stderrPromise = readCommandStream(
      process.stderr,
      options?.maxStderrBytes ?? MAX_COMMAND_STDERR_BYTES,
    );
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        stdoutPromise,
        stderrPromise,
        process.exited,
      ]);
      return {
        exitCode: timedOut ? 124 : exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated || undefined,
        stderrTruncated: stderr.truncated || undefined,
        timedOut: timedOut || undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
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
  const fileName = basename(path).toLowerCase();
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) return "dockerfile";
  if (fileName === "makefile" || fileName === "gnumakefile") return "makefile";

  const extension = extname(fileName).slice(1);
  if (!extension) return undefined;
  switch (extension) {
    case "cjs":
    case "mjs":
      return "javascript";
    case "cts":
    case "mts":
      return "typescript";
    case "h":
      return "c";
    case "hpp":
      return "cpp";
    case "htm":
    case "html":
    case "svg":
      return "xml";
    case "jsonc":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "pyw":
      return "python";
    case "sh":
    case "zsh":
      return "shell";
    case "yml":
      return "yaml";
    default:
      return extension;
  }
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
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<BoundedFileResult> => {
  const info = await handle.stat();
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
};

interface WorkspaceFileContent {
  readonly content: string;
  readonly binary: boolean;
  readonly tooLarge: boolean;
  readonly byteLength: number;
  readonly digest?: string;
}

const readWorkspaceFile = async (
  root: string,
  path: string,
): Promise<WorkspaceFileContent | undefined> => {
  const candidate = resolve(root, path);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || relativePath.includes("\\")) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Validate and read the same inode. A process may otherwise replace the
    // checked path with a symlink before the subsequent open.
    const resolvedCandidate = await realpath(candidate);
    const resolvedRelativePath = relative(root, resolvedCandidate);
    if (resolvedRelativePath.startsWith("..") || resolvedRelativePath.includes("\\"))
      return undefined;
    const candidateInfo = await lstat(candidate, { bigint: true });
    if (candidateInfo.isSymbolicLink() || !candidateInfo.isFile()) return undefined;
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedInfo = await handle.stat({ bigint: true });
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== candidateInfo.dev ||
      openedInfo.ino !== candidateInfo.ino
    )
      return undefined;
    const result = await readFileBounded(handle, MAX_FILE_BYTES);
    if (result.tooLarge)
      return {
        content: "",
        binary: false,
        tooLarge: true,
        byteLength: Number(openedInfo.size),
      };
    return {
      content: result.bytes.toString("utf8"),
      binary: result.bytes.includes(0),
      tooLarge: false,
      byteLength: result.bytes.byteLength,
      digest: createHash("sha256").update(result.bytes).digest("hex"),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
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

const readUntrackedFiles = async (
  root: string,
  paths: readonly string[],
): Promise<
  readonly {
    readonly path: string;
    readonly content: Awaited<ReturnType<typeof readWorkspaceFile>>;
  }[]
> => {
  const results: {
    path: string;
    content: Awaited<ReturnType<typeof readWorkspaceFile>>;
  }[] = [];
  const batchSize = 8;
  for (let index = 0; index < paths.length; index += batchSize) {
    // Keep filesystem pressure bounded while avoiding one serial read per file.
    // eslint-disable-next-line no-await-in-loop -- batches intentionally cap concurrent file reads.
    const batch = await Promise.all(
      paths
        .slice(index, index + batchSize)
        .map(async (path) => ({ path, content: await readWorkspaceFile(root, path) })),
    );
    results.push(...batch);
  }
  return results;
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

interface WorkspaceRevisionFingerprint {
  readonly records: readonly string[];
  readonly complete: boolean;
}

const fingerprintWorkspacePaths = async (
  root: string,
  paths: readonly string[],
): Promise<WorkspaceRevisionFingerprint> => {
  const records: string[] = [];
  let complete = true;
  for (let index = 0; index < paths.length; index += REVISION_FINGERPRINT_BATCH_SIZE) {
    // Limit filesystem pressure: revision checks run both around inspection and
    // around source reads.
    // eslint-disable-next-line no-await-in-loop -- batches intentionally cap concurrent file reads.
    const batch = await Promise.all(
      paths.slice(index, index + REVISION_FINGERPRINT_BATCH_SIZE).map(async (path) => {
        try {
          const info = await lstat(resolve(root, path), { bigint: true });
          const metadata = `${path}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}`;
          if (!info.isFile()) return `${metadata}:non-file`;
          const content = await readWorkspaceFile(root, path);
          if (!content) {
            complete = false;
            return `${metadata}:unreadable`;
          }
          if (content.tooLarge) return `${metadata}:oversized:${content.byteLength}`;
          return `${metadata}:${content.digest}`;
        } catch {
          return `${path}:missing`;
        }
      }),
    );
    records.push(...batch);
  }
  return { records, complete };
};

const workspaceRevision = async (
  runner: WorkspaceCommandRunner,
  root: string,
): Promise<
  { readonly value: string; readonly head?: string; readonly complete: boolean } | undefined
> => {
  const [head, statusResult] = await Promise.all([
    gitHead(runner, root),
    runner.run(
      ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no"],
      root,
      { maxStdoutBytes: MAX_REVIEW_INDEX_BYTES },
    ),
  ]);
  if (statusResult.exitCode !== 0) return undefined;
  const statusRecords = statusResult.stdout.split("\u0000");
  const statusPaths: string[] = [];
  let pathsComplete = true;
  for (let index = 0; index < statusRecords.length; index += 1) {
    const record = statusRecords[index] ?? "";
    if (!record) continue;
    const path = safeRepositoryRelativePath(record.slice(3));
    if (path) statusPaths.push(path);
    else pathsComplete = false;
    if (record.slice(0, 2).includes("R") || record.slice(0, 2).includes("C")) index += 1;
  }
  const uniquePaths = [...new Set(statusPaths)].sort((left, right) => left.localeCompare(right));
  if (uniquePaths.length > MAX_REVISION_PATHS) pathsComplete = false;
  const fingerprint = await fingerprintWorkspacePaths(
    root,
    uniquePaths.slice(0, MAX_REVISION_PATHS),
  );
  return {
    value: createHash("sha256")
      .update(head ?? "no-head")
      .update("\u0000")
      .update(statusResult.stdout)
      .update("\u0000")
      .update(fingerprint.records.join("\u0000"))
      .digest("hex"),
    head,
    complete: !statusResult.stdoutTruncated && pathsComplete && fingerprint.complete,
  };
};

interface StoredReviewFile {
  readonly path: string;
  readonly change?: WorkspaceDiffFile;
}

interface StoredReviewSnapshot {
  readonly root: string;
  readonly revision: string;
  readonly head?: string;
  readonly expiresAt: number;
  readonly files: ReadonlyMap<string, StoredReviewFile>;
}

export class LocalWorkspaceProvider
  implements WorkspaceProvider, WorkspaceDiffReader, WorkspaceReviewReader
{
  private readonly locations: string[];
  private readonly reviewSnapshots = new Map<string, StoredReviewSnapshot>();

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
        const [head, branch] = await Promise.all([
          gitHead(this.runner, root),
          gitBranch(this.runner, root),
        ]);
        const diffResult = await this.runner.run(
          [
            "git",
            "diff",
            ...(head ? [] : ["--cached"]),
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            ...(head ? ["HEAD"] : []),
            "--",
          ],
          root,
          { maxStdoutBytes: MAX_DIFF_BYTES },
        );
        if (diffResult.exitCode !== 0 && !diffResult.stdoutTruncated) {
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
          // The unified hunks contain everything needed for review. Sending entire
          // before/after files multiplied response size and required one `git show`
          // process per changed file; the renderer can compose its bounded view from
          // the hunks while retaining names for language detection.
          files.push({
            ...patch,
            oldFile: patch.binary
              ? undefined
              : oldFilePath
                ? emptyFileContent(oldFilePath)
                : undefined,
            newFile:
              patch.binary || patch.status === "deleted" ? undefined : emptyFileContent(patch.path),
            hunks: patch.binary ? [] : patch.hunks,
          });
        }

        if (parsed.length > MAX_DIFF_FILES) truncated = true;
        const trackedPaths = new Set(files.map((file) => file.path));
        const untracked = await untrackedPaths(this.runner, root);
        truncated ||= untracked.incomplete;
        const remainingFileCapacity = MAX_DIFF_FILES - files.length;
        const untrackedCandidates = untracked.paths.filter(
          (candidatePath) => !trackedPaths.has(candidatePath),
        );
        if (untrackedCandidates.length > remainingFileCapacity) truncated = true;
        const untrackedFiles = await readUntrackedFiles(
          root,
          untrackedCandidates.slice(0, remainingFileCapacity),
        );
        for (const { path: untrackedPath, content } of untrackedFiles) {
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
            newFile: binary ? undefined : emptyFileContent(untrackedPath),
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

  inspectWorkspace(
    path: string,
    now: number,
  ): Effect.Effect<WorkspaceReviewSnapshot, WorkspaceError> {
    return Effect.tryPromise({
      try: async () => {
        this.expireReviewSnapshots(now);
        const worktree = await this.requireDirectory(path);
        const repositoryRoot = await gitRoot(this.runner, worktree);
        if (!repositoryRoot) {
          const changes = await Effect.runPromise(this.inspectWorkingTree(worktree, now));
          return {
            kind: "workspace-review",
            snapshotId: randomUUID(),
            generatedAt: now,
            status: "not-git",
            repository: changes.repository,
            branch: changes.branch,
            head: changes.head,
            tree: [],
            treeComplete: true,
            changes,
            diagnostics: ["The observed workspace is not a Git checkout."],
          } satisfies WorkspaceReviewSnapshot;
        }

        const root = await realpath(resolve(repositoryRoot));
        const before = await workspaceRevision(this.runner, root);
        const changes = await Effect.runPromise(this.inspectWorkingTree(worktree, now));
        const indexResult = await this.runner.run(
          ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          root,
          { maxStdoutBytes: MAX_REVIEW_INDEX_BYTES },
        );
        const after = await workspaceRevision(this.runner, root);
        const coherent =
          before !== undefined &&
          before.complete &&
          after !== undefined &&
          after.complete &&
          before.value === after.value;
        let treeComplete =
          indexResult.exitCode === 0 &&
          !indexResult.stdoutTruncated &&
          coherent &&
          !changes.truncated;
        const rawPaths = indexResult.stdout.split("\u0000").filter(Boolean);
        if (rawPaths.length > MAX_REVIEW_FILES) treeComplete = false;
        const paths = [
          ...new Set(
            rawPaths
              .slice(0, MAX_REVIEW_FILES)
              .map(safeRepositoryRelativePath)
              .filter((candidate): candidate is string => candidate !== undefined),
          ),
        ].sort((left, right) => left.localeCompare(right));
        if (paths.length !== Math.min(rawPaths.length, MAX_REVIEW_FILES)) treeComplete = false;

        const changedByPath = new Map(changes.files.map((file) => [file.path, file] as const));
        const changedDescendants = new Map<string, number>();
        for (const file of changes.files) {
          const segments = file.path.split("/");
          for (let index = 1; index < segments.length; index += 1) {
            const directory = segments.slice(0, index).join("/");
            changedDescendants.set(directory, (changedDescendants.get(directory) ?? 0) + 1);
          }
        }

        const idByPath = new Map<string, string>();
        const entries: WorkspaceReviewTreeEntry[] = [];
        const storedFiles = new Map<string, StoredReviewFile>();
        for (const filePath of paths) {
          const segments = filePath.split("/");
          for (let index = 1; index < segments.length; index += 1) {
            const directoryPath = segments.slice(0, index).join("/");
            if (idByPath.has(directoryPath)) continue;
            const id = randomUUID();
            const parentPath = segments.slice(0, index - 1).join("/");
            idByPath.set(directoryPath, id);
            entries.push({
              id,
              parentId: parentPath ? idByPath.get(parentPath) : undefined,
              name: segments[index - 1]!,
              kind: "directory",
              changedDescendants: changedDescendants.get(directoryPath) ?? 0,
            });
          }
          const id = randomUUID();
          const parentPath = segments.slice(0, -1).join("/");
          const change = changedByPath.get(filePath);
          idByPath.set(filePath, id);
          entries.push({
            id,
            parentId: parentPath ? idByPath.get(parentPath) : undefined,
            name: segments.at(-1)!,
            kind: "file",
            change: change?.status,
            changedDescendants: 0,
            contentKind: change?.binary ? "binary" : "unknown",
          });
          storedFiles.set(id, { path: filePath, change });
        }

        const snapshotId = randomUUID();
        if (after && coherent) {
          this.reviewSnapshots.set(snapshotId, {
            root,
            revision: after.value,
            head: after.head,
            expiresAt: now + REVIEW_SNAPSHOT_TTL_MS,
            files: storedFiles,
          });
          this.trimReviewSnapshots();
        }
        const diagnostics = [
          before && after && (!before.complete || !after.complete)
            ? "The workspace revision is truncated; file reads require a refreshed complete snapshot."
            : undefined,
          before?.complete && after?.complete && before.value !== after.value
            ? "The workspace changed while its review snapshot was prepared."
            : undefined,
          !before || !after ? "The workspace revision is unavailable." : undefined,
          indexResult.exitCode !== 0 ? "The repository file index is unavailable." : undefined,
          indexResult.stdoutTruncated || rawPaths.length > MAX_REVIEW_FILES
            ? "The repository file index is truncated."
            : undefined,
          changes.truncated ? "The working-tree diff is truncated." : undefined,
        ].filter((message): message is string => message !== undefined);
        return {
          kind: "workspace-review",
          snapshotId,
          generatedAt: now,
          status: after ? (treeComplete ? "complete" : "partial") : "unavailable",
          repository: changes.repository,
          branch: changes.branch,
          head: after?.head ?? changes.head,
          tree: entries,
          treeComplete,
          changes,
          diagnostics,
        } satisfies WorkspaceReviewSnapshot;
      },
      catch: (error) =>
        error instanceof WorkspaceError
          ? error
          : workspaceError(
              "workspace.inspectReview",
              error instanceof Error ? error.message : String(error),
            ),
    });
  }

  readWorkspaceReviewFile(
    request: WorkspaceReviewFileRequest,
    now: number,
  ): Effect.Effect<WorkspaceReviewFileSnapshot, WorkspaceError> {
    return Effect.tryPromise({
      try: async () => {
        this.expireReviewSnapshots(now);
        const snapshot = this.reviewSnapshots.get(request.snapshotId);
        const file = snapshot?.files.get(request.fileId);
        const result = (
          status: WorkspaceReviewFileSnapshot["status"],
          message: string,
        ): WorkspaceReviewFileSnapshot => ({
          kind: "workspace-review-file",
          snapshotId: request.snapshotId,
          fileId: request.fileId,
          displayPath: file?.path ?? "Unavailable file",
          view: request.view,
          status,
          truncated: false,
          generatedAt: now,
          message,
        });
        if (!snapshot || !file) return result("missing", "The review snapshot has expired.");

        const worktree = await this.requireDirectory(request.workspacePath);
        const currentRoot = await gitRoot(this.runner, worktree);
        if (!currentRoot || (await realpath(resolve(currentRoot))) !== snapshot.root)
          return result("stale", "The Agent workspace binding changed. Refresh review.");
        const revision = await workspaceRevision(this.runner, snapshot.root);
        if (!revision?.complete || revision.value !== snapshot.revision)
          return result("stale", "The workspace changed. Refresh review before reading this file.");

        if (request.view === "diff") {
          if (!file.change)
            return result("unavailable", "This file has no working-tree change against HEAD.");
          if (file.change.binary) return result("binary", "Binary diff content is not displayed.");
          return {
            kind: "workspace-review-file",
            snapshotId: request.snapshotId,
            fileId: request.fileId,
            displayPath: file.path,
            view: "diff",
            status: "available",
            language: languageForPath(file.path),
            hunks: file.change.hunks,
            truncated: false,
            generatedAt: now,
          } satisfies WorkspaceReviewFileSnapshot;
        }

        if (request.view === "baseline") {
          const baselinePath = file.change?.oldPath ?? file.path;
          if (file.change?.status === "added" || file.change?.status === "untracked")
            return result("missing", "This file did not exist at HEAD.");
          if (!snapshot.head) return result("unavailable", "The HEAD baseline is unavailable.");
          const baseline = await this.runner.run(
            ["git", "show", `${snapshot.head}:${baselinePath}`],
            snapshot.root,
            { maxStdoutBytes: MAX_FILE_BYTES },
          );
          if (baseline.stdoutTruncated)
            return result("oversized", "The baseline file exceeds the review size limit.");
          if (baseline.exitCode !== 0) return result("missing", "The file is unavailable at HEAD.");
          if (Buffer.from(baseline.stdout).includes(0))
            return result("binary", "Binary file content is not displayed.");
          return {
            kind: "workspace-review-file",
            snapshotId: request.snapshotId,
            fileId: request.fileId,
            displayPath: baselinePath,
            view: "baseline",
            status: "available",
            language: languageForPath(baselinePath),
            content: baseline.stdout,
            truncated: false,
            generatedAt: now,
          } satisfies WorkspaceReviewFileSnapshot;
        }

        if (file.change?.status === "deleted")
          return result("missing", "This file was deleted from the worktree.");
        const source = await readWorkspaceFile(snapshot.root, file.path);
        if (!source) return result("unavailable", "The source file could not be read safely.");
        if (source.tooLarge)
          return result("oversized", "The source file exceeds the review size limit.");
        if (source.binary) return result("binary", "Binary file content is not displayed.");
        const afterRead = await workspaceRevision(this.runner, snapshot.root);
        if (!afterRead?.complete || afterRead.value !== snapshot.revision)
          return result("stale", "The workspace changed while this file was read. Refresh review.");
        return {
          kind: "workspace-review-file",
          snapshotId: request.snapshotId,
          fileId: request.fileId,
          displayPath: file.path,
          view: "source",
          status: "available",
          language: languageForPath(file.path),
          content: source.content,
          truncated: false,
          generatedAt: now,
        } satisfies WorkspaceReviewFileSnapshot;
      },
      catch: (error) =>
        error instanceof WorkspaceError
          ? error
          : workspaceError(
              "workspace.readReviewFile",
              error instanceof Error ? error.message : String(error),
            ),
    });
  }

  private expireReviewSnapshots(now: number): void {
    for (const [id, snapshot] of this.reviewSnapshots)
      if (snapshot.expiresAt <= now) this.reviewSnapshots.delete(id);
  }

  private trimReviewSnapshots(): void {
    while (this.reviewSnapshots.size > MAX_REVIEW_SNAPSHOTS) {
      const oldest = this.reviewSnapshots.keys().next().value;
      if (oldest === undefined) return;
      this.reviewSnapshots.delete(oldest);
    }
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
