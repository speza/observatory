import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { LocalWorkspaceProvider, type WorkspaceCommandRunner } from "./local.ts";

class FakeGitRunner implements WorkspaceCommandRunner {
  readonly calls: { readonly argv: readonly string[]; readonly cwd?: string }[] = [];

  async run(argv: readonly string[], cwd?: string) {
    this.calls.push({ argv, cwd });
    if (argv[0] === "git" && argv[1] === "rev-parse")
      return { exitCode: 0, stdout: `${cwd}\n`, stderr: "" };
    if (argv[0] === "git" && argv[1] === "branch")
      return { exitCode: 0, stdout: "main\n", stderr: "" };
    if (argv[0] === "git" && argv[1] === "status")
      return { exitCode: 0, stdout: " M dirty.ts\n", stderr: "" };
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
});
