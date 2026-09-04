import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalWorkspaceProvider,
  type WorkspaceCommandOptions,
  type WorkspaceCommandResult,
  type WorkspaceCommandRunner,
} from "./local.ts";

class FakeGitRunner implements WorkspaceCommandRunner {
  readonly calls: {
    readonly argv: readonly string[];
    readonly cwd?: string;
    readonly options?: WorkspaceCommandOptions;
  }[] = [];

  constructor(
    private readonly overrides: {
      readonly diff?: WorkspaceCommandResult;
      readonly show?: WorkspaceCommandResult;
      readonly status?: WorkspaceCommandResult;
      readonly untracked?: WorkspaceCommandResult;
    } = {},
  ) {}

  async run(
    argv: readonly string[],
    cwd?: string,
    options?: WorkspaceCommandOptions,
  ): Promise<WorkspaceCommandResult> {
    this.calls.push(options ? { argv, cwd, options } : { argv, cwd });
    if (argv[0] === "git" && argv[1] === "rev-parse") {
      if (argv[2] === "HEAD") return { exitCode: 0, stdout: "0123456789abcdef\n", stderr: "" };
      return { exitCode: 0, stdout: `${cwd}\n`, stderr: "" };
    }
    if (argv[0] === "git" && argv[1] === "branch")
      return { exitCode: 0, stdout: "main\n", stderr: "" };
    if (argv[0] === "git" && argv[1] === "status")
      return this.overrides.status ?? { exitCode: 0, stdout: " M dirty.ts\n", stderr: "" };
    if (argv[0] === "git" && argv[1] === "diff")
      return (
        this.overrides.diff ?? {
          exitCode: 0,
          stdout:
            "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new",
          stderr: "",
        }
      );
    if (argv[0] === "git" && argv[1] === "show")
      return this.overrides.show ?? { exitCode: 0, stdout: "old\n", stderr: "" };
    if (argv[0] === "git" && argv[1] === "ls-files")
      return this.overrides.untracked ?? { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("local workspace provider", () => {
  test("prepares an existing checkout and reports a dirty warning", async () => {
    const runner = new FakeGitRunner();
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });
    const prepared = await Effect.runPromise(
      provider.prepare({ kind: "existing", path: process.cwd() }),
    );
    expect(prepared.path).toBe(process.cwd());
    expect(prepared.branch).toBe("main");
    expect(prepared.worktree).toBe(false);
    expect(prepared.warnings).toEqual(["The checkout has uncommitted changes."]);
  });

  test("prepares a new worktree through Git without shell interpolation", async () => {
    const runner = new FakeGitRunner();
    const path = "/private/tmp/ao-launch-test-worktree-not-created";
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });
    const prepared = await Effect.runPromise(
      provider.prepare({
        kind: "worktree",
        repositoryPath: process.cwd(),
        branch: "feat/launch-test",
        path,
      }),
    );
    expect(prepared.path).toBe(path);
    expect(prepared.worktree).toBe(true);
    expect(runner.calls.at(-1)).toEqual({
      argv: ["git", "worktree", "add", "-b", "feat/launch-test", path, "HEAD"],
      cwd: process.cwd(),
    });
  });

  test("reviews staged files before a repository has its first commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-workspace-unborn-"));
    try {
      await writeFile(join(root, "new.ts"), "export const value = 1;\n");
      const base = new FakeGitRunner({
        diff: { exitCode: 0, stdout: "", stderr: "" },
        untracked: { exitCode: 0, stdout: "new.ts\u0000", stderr: "" },
      });
      const runner: WorkspaceCommandRunner = {
        run: (argv, cwd, options) =>
          argv[0] === "git" && argv[1] === "rev-parse" && argv[2] === "HEAD"
            ? Promise.resolve({ exitCode: 128, stdout: "", stderr: "no commits" })
            : base.run(argv, cwd, options),
      };
      const provider = new LocalWorkspaceProvider({ cwd: root, runner });

      const review = await Effect.runPromise(provider.inspectWorkspace(root, 1234));

      expect(review.status).toBe("complete");
      expect(base.calls.some(({ argv }) => argv[1] === "diff" && argv.includes("--cached"))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns a partial review when the revision status is truncated", async () => {
    const base = new FakeGitRunner();
    const runner: WorkspaceCommandRunner = {
      run: async (argv, cwd, options) => {
        const result = await base.run(argv, cwd, options);
        return argv[0] === "git" && argv[1] === "status"
          ? { ...result, stdoutTruncated: true }
          : result;
      },
    };
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const review = await Effect.runPromise(provider.inspectWorkspace(process.cwd(), 1234));

    expect(review.status).toBe("partial");
    expect(review.diagnostics).toContain(
      "The workspace revision is truncated; file reads require a refreshed complete snapshot.",
    );
  });

  test("returns a bounded, read-only working-tree diff", async () => {
    const runner = new FakeGitRunner();
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });
    const diff = await Effect.runPromise(provider.inspectWorkingTree(process.cwd(), 1234));

    expect(diff.status).toBe("changed");
    expect(diff.branch).toBe("main");
    expect(diff.head).toBe("0123456789abcdef");
    expect(diff.files[0]).toMatchObject({
      path: "README.md",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      oldFile: { fileName: "README.md", content: "" },
      newFile: { fileName: "README.md", content: "" },
    });
    expect(diff.files[0]?.hunks[0]).toContain("--- a/README.md");
    expect(diff.files[0]?.hunks[0]).toContain("@@ -1 +1 @@");
    expect(runner.calls.some(({ argv }) => argv.includes("--no-ext-diff"))).toBe(true);
    expect(
      runner.calls.find(({ argv }) => argv[1] === "diff")?.options?.maxStdoutBytes,
    ).toBeGreaterThan(0);
    expect(runner.calls.some(({ argv }) => argv[1] === "show")).toBe(false);
    expect(
      runner.calls.find(({ argv }) => argv[1] === "ls-files")?.options?.maxStdoutBytes,
    ).toBeGreaterThan(0);
  });

  test("indexes browser-safe review files and reads source and baseline by issued handle", async () => {
    const runner = new FakeGitRunner({
      untracked: {
        exitCode: 0,
        stdout: "README.md\u0000src/workspaces/types.ts\u0000",
        stderr: "",
      },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const review = await Effect.runPromise(provider.inspectWorkspace(process.cwd(), 1234));
    const readme = review.tree.find((entry) => entry.name === "README.md");
    expect(review.status).toBe("complete");
    expect(review.tree.some((entry) => entry.name === "src" && entry.kind === "directory")).toBe(
      true,
    );
    expect(readme).toMatchObject({ kind: "file", change: "modified" });

    const source = await Effect.runPromise(
      provider.readWorkspaceReviewFile(
        {
          workspacePath: process.cwd(),
          snapshotId: review.snapshotId,
          fileId: readme!.id,
          view: "source",
        },
        1235,
      ),
    );
    const baseline = await Effect.runPromise(
      provider.readWorkspaceReviewFile(
        {
          workspacePath: process.cwd(),
          snapshotId: review.snapshotId,
          fileId: readme!.id,
          view: "baseline",
        },
        1235,
      ),
    );
    expect(source.status).toBe("available");
    expect(source.content).toContain("Observatory");
    expect(baseline).toMatchObject({ status: "available", content: "old\n" });
    expect(runner.calls.filter(({ argv }) => argv[1] === "diff")).toHaveLength(1);
  });

  test("rejects a source read when the workspace changes during the read", async () => {
    const base = new FakeGitRunner({
      untracked: { exitCode: 0, stdout: "README.md\u0000", stderr: "" },
    });
    let statusCalls = 0;
    const runner: WorkspaceCommandRunner = {
      run: async (argv, cwd, options) => {
        if (argv[0] === "git" && argv[1] === "status") {
          statusCalls += 1;
          if (statusCalls === 4)
            return { exitCode: 0, stdout: " M changed-during-read.ts\u0000", stderr: "" };
        }
        return base.run(argv, cwd, options);
      },
    };
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });
    const review = await Effect.runPromise(provider.inspectWorkspace(process.cwd(), 1234));
    const readme = review.tree.find((entry) => entry.name === "README.md")!;

    const source = await Effect.runPromise(
      provider.readWorkspaceReviewFile(
        {
          workspacePath: process.cwd(),
          snapshotId: review.snapshotId,
          fileId: readme.id,
          view: "source",
        },
        1235,
      ),
    );

    expect(source.status).toBe("stale");
    expect(source.message).toContain("while this file was read");
  });

  test("rejects same-size source mutations even when the modification time is restored", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-workspace-revision-"));
    try {
      const path = join(root, "sample.ts");
      await writeFile(path, "const value = 1;\n");
      const runner = new FakeGitRunner({
        diff: {
          exitCode: 0,
          stdout:
            "diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-const value = 0;\n+const value = 1;",
          stderr: "",
        },
        status: { exitCode: 0, stdout: " M sample.ts\u0000", stderr: "" },
        untracked: { exitCode: 0, stdout: "sample.ts\u0000", stderr: "" },
      });
      const provider = new LocalWorkspaceProvider({ cwd: root, runner });
      const review = await Effect.runPromise(provider.inspectWorkspace(root, 1234));
      const sample = review.tree.find((entry) => entry.name === "sample.ts")!;
      const before = await stat(path);

      await writeFile(path, "const value = 2;\n");
      await utimes(path, before.atime, before.mtime);
      const source = await Effect.runPromise(
        provider.readWorkspaceReviewFile(
          {
            workspacePath: root,
            snapshotId: review.snapshotId,
            fileId: sample.id,
            view: "source",
          },
          1235,
        ),
      );

      expect(source.status).toBe("stale");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("marks revisions with more changed paths than the diff limit as partial", async () => {
    const paths = Array.from({ length: 121 }, (_, index) => `missing-${index}.ts`);
    const runner = new FakeGitRunner({
      diff: { exitCode: 0, stdout: "", stderr: "" },
      status: {
        exitCode: 0,
        stdout: paths.map((path) => ` M ${path}\u0000`).join(""),
        stderr: "",
      },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const review = await Effect.runPromise(provider.inspectWorkspace(process.cwd(), 1234));

    expect(review.status).toBe("partial");
    expect(review.diagnostics).toContain(
      "The workspace revision is truncated; file reads require a refreshed complete snapshot.",
    );
  });

  test("expires process-local file capabilities", async () => {
    const runner = new FakeGitRunner({
      untracked: { exitCode: 0, stdout: "README.md\u0000", stderr: "" },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });
    const review = await Effect.runPromise(provider.inspectWorkspace(process.cwd(), 0));
    const readme = review.tree.find((entry) => entry.name === "README.md")!;

    const expired = await Effect.runPromise(
      provider.readWorkspaceReviewFile(
        {
          workspacePath: process.cwd(),
          snapshotId: review.snapshotId,
          fileId: readme.id,
          view: "source",
        },
        10 * 60_000,
      ),
    );

    expect(expired.status).toBe("missing");
    expect(expired.message).toContain("expired");
  });

  test("never follows a symlink issued by the repository index", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-workspace-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "ao-workspace-outside-"));
    try {
      const secret = join(outside, "secret.txt");
      await writeFile(secret, "not reviewable\n");
      await symlink(secret, join(root, "linked.txt"));
      const runner = new FakeGitRunner({
        diff: { exitCode: 0, stdout: "", stderr: "" },
        untracked: { exitCode: 0, stdout: "linked.txt\u0000", stderr: "" },
      });
      const provider = new LocalWorkspaceProvider({ cwd: root, runner });
      const review = await Effect.runPromise(provider.inspectWorkspace(root, 1234));
      const linked = review.tree.find((entry) => entry.name === "linked.txt")!;

      const source = await Effect.runPromise(
        provider.readWorkspaceReviewFile(
          {
            workspacePath: root,
            snapshotId: review.snapshotId,
            fileId: linked.id,
            view: "source",
          },
          1235,
        ),
      );

      expect(source.status).toBe("unavailable");
      expect(source.content).toBeUndefined();
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  test("preserves repository-relative untracked paths with a/ or b/ prefixes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-workspace-untracked-"));
    try {
      await mkdir(join(root, "a"), { recursive: true });
      await writeFile(join(root, "a", "foo.ts"), "hello\n");
      const runner = new FakeGitRunner({
        diff: { exitCode: 0, stdout: "", stderr: "" },
        untracked: { exitCode: 0, stdout: "a/foo.ts\u0000", stderr: "" },
      });
      const provider = new LocalWorkspaceProvider({ cwd: root, runner });

      const diff = await Effect.runPromise(provider.inspectWorkingTree(root, 1234));

      expect(diff.status).toBe("changed");
      expect(diff.files[0]).toMatchObject({ path: "a/foo.ts", status: "untracked" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps the bounded prefix when Git is stopped after exceeding the diff limit", async () => {
    const runner = new FakeGitRunner({
      diff: {
        exitCode: 9,
        stdout:
          "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new",
        stderr: "",
        stdoutTruncated: true,
      },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const diff = await Effect.runPromise(provider.inspectWorkingTree(process.cwd(), 1234));

    expect(diff.status).toBe("changed");
    expect(diff.truncated).toBe(true);
    expect(diff.files[0]?.path).toBe("README.md");
  });

  test("keeps file capabilities available when the rendered diff is truncated", async () => {
    const runner = new FakeGitRunner({
      diff: {
        exitCode: 9,
        stdout:
          "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new",
        stderr: "",
        stdoutTruncated: true,
      },
      untracked: { exitCode: 0, stdout: "README.md\u0000", stderr: "" },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const review = await Effect.runPromise(provider.inspectWorkspace(process.cwd(), 1234));
    const readme = review.tree.find((entry) => entry.name === "README.md")!;
    const source = await Effect.runPromise(
      provider.readWorkspaceReviewFile(
        {
          workspacePath: process.cwd(),
          snapshotId: review.snapshotId,
          fileId: readme.id,
          view: "source",
        },
        1235,
      ),
    );

    expect(review.status).toBe("partial");
    expect(source.status).toBe("available");
  });

  test("reports a Git diff failure as unavailable instead of clean", async () => {
    const runner = new FakeGitRunner({
      diff: { exitCode: 128, stdout: "", stderr: "fatal: bad revision 'HEAD'\n" },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const diff = await Effect.runPromise(provider.inspectWorkingTree(process.cwd(), 1234));

    expect(diff.status).toBe("unavailable");
    expect(diff.files).toHaveLength(0);
    expect(diff.message).toContain("bad revision");
  });

  test("marks unsafe or omitted untracked paths as an incomplete inspection", async () => {
    const runner = new FakeGitRunner({
      diff: { exitCode: 0, stdout: "", stderr: "" },
      untracked: {
        exitCode: 0,
        stdout: "../outside.ts\u0000partial",
        stderr: "",
        stdoutTruncated: true,
      },
    });
    const provider = new LocalWorkspaceProvider({ cwd: process.cwd(), runner });

    const diff = await Effect.runPromise(provider.inspectWorkingTree(process.cwd(), 1234));

    expect(diff.status).toBe("unavailable");
    expect(diff.truncated).toBe(true);
    expect(diff.message).toContain("incomplete");
  });
});
