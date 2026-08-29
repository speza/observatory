import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolve } from "node:path";
import type { BoundedProcessRunner } from "../plugin-sdk/index.ts";
import { loadPluginRegistry } from "./registry.ts";

const syntheticPath = resolve(import.meta.dir, "fixtures/synthetic");
const githubPath = resolve(import.meta.dir, "../../plugins/github");
const examplePath = resolve(import.meta.dir, "../../examples/plugins/code-host");
const harnessExamplePath = resolve(import.meta.dir, "../../examples/plugins/agent-harness");
const duplicateHarnessPath = resolve(import.meta.dir, "fixtures/duplicate-harness");

const runner = (response: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
}): BoundedProcessRunner => ({
  run: async () => ({
    ...response,
    stderr: response.stderr ?? "",
    stdoutTruncated: false,
    stderrTruncated: false,
  }),
});

describe("plugin registry", () => {
  test("loads an external-style package and exposes only its declared capability", async () => {
    const registry = await Effect.runPromise(
      loadPluginRegistry({ packages: [{ path: syntheticPath }] }),
    );

    expect(registry.status()).toEqual([
      expect.objectContaining({ id: "synthetic-code-host", state: "ready" }),
    ]);
    expect(registry.codeHosts()).toHaveLength(1);
    expect(
      registry.codeHosts()[0]?.supports({ host: "code.example", owner: "acme", name: "ao" }),
    ).toBe(true);
  });

  test("loads the contributor example without a core registry edit", async () => {
    const registry = await Effect.runPromise(
      loadPluginRegistry({ packages: [{ path: examplePath }] }),
    );

    expect(registry.status()[0]).toMatchObject({ id: "example-code-host", state: "ready" });
    expect(
      registry
        .codeHosts()[0]
        ?.supports({ host: "forge.example", owner: "acme", name: "observatory" }),
    ).toBe(true);
  });

  test("loads a third-party harness without a core or host adapter edit", async () => {
    const registry = await Effect.runPromise(
      loadPluginRegistry({
        packages: [{ path: harnessExamplePath }],
        runner: runner({ exitCode: 0, stdout: "example-agent 1.0.0" }),
      }),
    );
    expect(registry.status()[0]).toMatchObject({ id: "example-agent-harness", state: "ready" });
    expect(registry.agentHarness("example-agent")?.describe().label).toBe("Example Agent");
  });

  test("degrades a plugin that collides with an existing harness id", async () => {
    const registry = await Effect.runPromise(
      loadPluginRegistry({
        packages: [{ path: harnessExamplePath }, { path: duplicateHarnessPath }],
      }),
    );
    expect(registry.agentHarnesses()).toHaveLength(1);
    expect(registry.status()[1]).toMatchObject({ state: "degraded" });
    expect(registry.status()[1]?.diagnostics[0]).toContain("already contributed");
  });

  test("isolates duplicate ids and disabled packages as diagnostics", async () => {
    const registry = await Effect.runPromise(
      loadPluginRegistry({
        packages: [
          { path: syntheticPath },
          { path: syntheticPath },
          { path: githubPath, enabled: false },
        ],
      }),
    );

    expect(registry.codeHosts()).toHaveLength(1);
    expect(registry.status().map(({ state }) => state)).toEqual(["ready", "degraded", "disabled"]);
    expect(registry.status()[1]?.diagnostics[0]).toContain("already loaded");
  });

  test("the built-in GitHub plugin returns bounded provider-neutral facts", async () => {
    const payload = JSON.stringify([
      {
        author: { login: "octo" },
        baseRefName: "main",
        headRefName: "feature/status",
        headRefOid: "abc123",
        isDraft: false,
        mergeable: "MERGEABLE",
        number: 42,
        reviewDecision: "APPROVED",
        state: "OPEN",
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
        title: "Show repository status",
        url: "https://github.com/acme/ao/pull/42",
      },
    ]);
    const registry = await Effect.runPromise(
      loadPluginRegistry({
        packages: [{ path: githubPath }],
        runner: runner({ exitCode: 0, stdout: payload }),
      }),
    );
    const provider = registry.codeHosts()[0];
    if (!provider) throw new Error("Expected GitHub provider.");
    const facts = await Effect.runPromise(
      provider.pullRequests({
        repository: { host: "github.com", owner: "acme", name: "ao" },
        branch: "feature/status",
        head: "abc123",
      }),
    );

    expect(provider.supports({ host: "gitlab.com", owner: "acme", name: "ao" })).toBe(false);
    expect(facts[0]).toMatchObject({ number: 42, checks: "passing", review: "approved" });
  });

  test("maps GitHub authentication failures without exposing raw stderr", async () => {
    let calls = 0;
    const process: BoundedProcessRunner = {
      run: async () => {
        calls += 1;
        return calls === 1
          ? {
              exitCode: 0,
              stdout: "gh version",
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            }
          : {
              exitCode: 1,
              stdout: "",
              stderr: "please login with secret-token",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
      },
    };
    const registry = await Effect.runPromise(
      loadPluginRegistry({ packages: [{ path: githubPath }], runner: process }),
    );
    const provider = registry.codeHosts()[0];
    if (!provider) throw new Error("Expected GitHub provider.");

    let message = "";
    try {
      await Effect.runPromise(
        provider.pullRequests({
          repository: { host: "github.com", owner: "acme", name: "ao" },
          branch: "main",
          head: "abc",
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("GitHub authentication is required.");
  });
});
