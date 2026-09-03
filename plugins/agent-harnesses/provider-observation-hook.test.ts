import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { inspectProviderObservations } from "../../scripts/doctor-provider-observations.ts";
import { createPiObservationExtension } from "./pi-observation-extension.ts";
import { EphemeralProviderObservationSource } from "./ephemeral-provider-observation-source.ts";
import { recordProviderHook } from "./provider-observation-hook.ts";
import {
  observationInstallManifest,
  validObservationEndpoint,
} from "./provider-observation-installation.ts";

describe("provider observation hooks", () => {
  test("normalises live events into bounded current evidence without retaining raw fields", async () => {
    let now = 100;
    const source = new EphemeralProviderObservationSource({
      configured: true,
      harnessId: "claude",
      root: "/synthetic/claude",
      now: () => now,
    });
    expect(
      await Effect.runPromise(
        source.receive({
          hook_event_name: "PermissionRequest",
          session_id: "session-1",
          tool_name: "Bash",
          prompt: "must-not-cross",
          tool_input: { command: "must-not-cross" },
        }),
      ),
    ).toBe(1);
    now = 101;
    expect(
      await Effect.runPromise(
        source.receive({
          hook_event_name: "PostToolUse",
          session_id: "session-1",
          tool_name: "Bash",
        }),
      ),
    ).toBe(2);

    const snapshot = await Effect.runPromise(
      source.snapshot({ providerInstanceId: "", limit: 20 }),
    );
    expect(snapshot.current).toEqual([
      expect.objectContaining({ kind: "activity", payload: { phase: "responding" } }),
    ]);
    expect(snapshot.transitions).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain("must-not-cross");
  });

  test("new work supersedes a completed outcome in ephemeral current state", async () => {
    const source = new EphemeralProviderObservationSource({
      configured: true,
      harnessId: "codex",
      root: "/synthetic/codex",
      now: () => 100,
    });
    await Effect.runPromise(source.receive({ type: "Stop", session_id: "session-1" }));
    await Effect.runPromise(source.receive({ type: "UserPromptSubmit", session_id: "session-1" }));
    const snapshot = await Effect.runPromise(
      source.snapshot({ providerInstanceId: "", limit: 20 }),
    );
    expect(snapshot.current).toEqual([
      expect.objectContaining({ kind: "activity", payload: { phase: "responding" } }),
    ]);
  });

  test("uses process-local cursor epochs and bounded transition snapshots", async () => {
    const first = new EphemeralProviderObservationSource({
      configured: true,
      harnessId: "codex",
      root: "/synthetic/codex",
      now: () => 100,
    });
    await Effect.runPromise(first.receive({ type: "SessionStart", session_id: "session-1" }));
    const firstSnapshot = await Effect.runPromise(
      first.snapshot({ providerInstanceId: "", limit: 20 }),
    );
    const replacement = new EphemeralProviderObservationSource({
      configured: true,
      harnessId: "codex",
      root: "/synthetic/codex",
      now: () => 101,
    });
    await Effect.runPromise(
      replacement.receive({ type: "UserPromptSubmit", session_id: "session-1" }),
    );
    const replacementSnapshot = await Effect.runPromise(
      replacement.snapshot({
        providerInstanceId: "",
        afterCursor: firstSnapshot.cursor,
        limit: 20,
      }),
    );
    expect(replacementSnapshot.transitions).toHaveLength(1);
    expect(replacementSnapshot.cursor).not.toStartWith(firstSnapshot.cursor!.split(":")[0]);
  });

  test("delivers best-effort events to the authenticated local ingress", async () => {
    const root = await mkdtemp(join(tmpdir(), "ao-observation-delivery-"));
    const tokenFile = join(root, "token");
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    await writeFile(tokenFile, token, { mode: 0o600 });
    let received: unknown;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
        received = await request.json();
        return Response.json({ accepted: 1 });
      },
    });
    try {
      expect(
        await recordProviderHook(
          "claude",
          { hook_event_name: "SessionStart", session_id: "session-1" },
          {
            endpoint: `http://127.0.0.1:${server.port}/api/provider-observations`,
            tokenFile,
          },
        ),
      ).toBe(1);
      expect(received).toMatchObject({
        harnessId: "claude",
        input: { hook_event_name: "SessionStart", session_id: "session-1" },
      });
      expect(
        await recordProviderHook(
          "claude",
          { hook_event_name: "SessionStart", session_id: "session-1" },
          { endpoint: "http://127.0.0.1:1/api/provider-observations", tokenFile },
        ),
      ).toBe(0);
      expect(validObservationEndpoint("https://example.com/api/provider-observations")).toBe(false);
      expect(
        await recordProviderHook(
          "claude",
          { hook_event_name: "SessionStart", session_id: "session-1" },
          { endpoint: "https://example.com/api/provider-observations", tokenFile },
        ),
      ).toBe(0);
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Pi reports completion only after the agent is settled", () => {
    const registered: string[] = [];
    createPiObservationExtension()({
      on: (event) => {
        registered.push(event);
      },
    });
    expect(registered).toContain("agent_settled");
    expect(registered).not.toContain("agent_end");
  });

  test("the installer composes with provider configuration and is idempotent", async () => {
    const home = await mkdtemp(join(tmpdir(), "ao-observation-install-"));
    const endpoint = "http://127.0.0.1:4399/api/provider-observations";
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: "existing-hook" }] }] } }),
    );
    await writeFile(join(home, ".codex", "hooks.json"), JSON.stringify({ hooks: {} }));
    await writeFile(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ packages: ["npm:existing-package"] }),
    );
    try {
      const install = async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            resolve(import.meta.dir, "../../scripts/install-provider-observation-hooks.ts"),
            "--home",
            home,
            "--endpoint",
            endpoint,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(await child.exited).toBe(0);
      };
      await install();
      await install();
      const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
      const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf8"));
      const pi = JSON.parse(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8"));
      expect(JSON.stringify(claude)).toContain("existing-hook");
      expect(JSON.stringify(claude).match(/provider-observation-hook\.js/g)).toHaveLength(10);
      expect(JSON.stringify(claude)).toContain(endpoint);
      expect(JSON.stringify(claude)).toContain("--token-file");
      expect(codex.hooks.SessionEnd[0].hooks[0].timeout).toBe(3);
      expect(pi.packages).toEqual(["npm:existing-package"]);
      expect(pi.extensions).toHaveLength(1);

      const manifest = JSON.parse(await readFile(observationInstallManifest(home), "utf8"));
      expect(manifest.schemaVersion).toBe(2);
      expect(manifest.endpoint).toBe(endpoint);
      expect(manifest.commandHook).toContain(`build-${manifest.buildId}`);
      expect((await stat(manifest.tokenFile)).mode & 0o777).toBe(0o600);
      expect((await readFile(manifest.tokenFile, "utf8")).length).toBeGreaterThan(30);
      const piBundle = await readFile(manifest.piExtension, "utf8");
      expect(piBundle).not.toContain("Bun.");

      const doctor = await inspectProviderObservations(home);
      expect(doctor.providers).toHaveLength(3);
      expect(
        doctor.providers.every(
          ({ configured, bundlePresent, tokenValid }) => configured && bundlePresent && tokenValid,
        ),
      ).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
