import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      return { exitCode: 0, stdout: " M dirty.ts\n", stderr: "" };
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
