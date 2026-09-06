import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBackend } from "./backend.ts";

describe("desktop backend integration", () => {
  test("authenticates real HTTP/SSE, protects terminal upgrades, retries host and releases the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-desktop-"));
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port;
    await reservation.stop(true);
    const origin = `http://127.0.0.1:${port}`;
    const options = {
      executable: process.execPath,
      root: resolve(import.meta.dir, ".."),
      origin,
      environment: {
        ...process.env,
        AO_HOST: "mock",
        AO_MOCK_SCENARIO: "portfolio",
        AO_MOCK_SEED: "portfolio",
        AO_DB_PATH: join(directory, "ao.sqlite"),
        AO_WEB_PORT: String(port),
        AO_WEB_ALLOWED_ORIGIN: origin,
      },
    };
    const backend = startBackend(options);
    try {
      expect(await backend.ready).toBe(origin);
      const headers = {
        cookie: `ao_desktop_session=${backend.token}`,
        origin,
        "x-ao-command": "1",
        "content-type": "application/json",
      };
      await Promise.all(
        ["/", "/api/projections/events", "/api/terminal/fake/socket"].map(async (path) => {
          expect((await fetch(origin + path)).status).toBe(401);
        }),
      );
      // Core tests need not build UI assets: 503 is the normal unbuilt-client response.
      expect([200, 503]).toContain((await fetch(origin + "/", { headers })).status);
      expect(
        (await fetch(origin + "/", { headers: { ...headers, origin: "https://example.com" } }))
          .status,
      ).toBe(403);
      const stream = await fetch(origin + "/api/projections/events", { headers });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      expect((await reader.read()).value?.length).toBeGreaterThan(0);
      await reader.cancel();
      expect(
        (await fetch(origin + "/api/host/refresh", { method: "POST", headers, body: "{}" })).status,
      ).toBe(200);
      expect(
        (
          await fetch(origin + "/api/host/refresh", {
            method: "POST",
            headers: { cookie: headers.cookie },
          })
        ).status,
      ).toBe(403);
      const collision = startBackend({
        ...options,
        environment: { ...options.environment, AO_DB_PATH: join(directory, "other.sqlite") },
      });
      await collision.ready.then(
        () => expect.unreachable(),
        (error) => expect(error).toBeInstanceOf(Error),
      );
      await collision.stop();
      expect((await fetch(origin + "/api/host/refresh", { method: "POST", headers })).status).toBe(
        200,
      );
      await backend.stop();
      const restarted = startBackend(options);
      try {
        expect(await restarted.ready).toBe(origin);
      } finally {
        await restarted.stop();
      }
    } finally {
      await backend.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  test("reports missing executable without hanging shutdown", async () => {
    const backend = startBackend({
      executable: "/nonexistent/observatory-bun",
      root: resolve(import.meta.dir, ".."),
      origin: "http://127.0.0.1:4310",
      environment: {},
    });
    await backend.ready.then(
      () => expect.unreachable(),
      (error) => expect(error).toBeInstanceOf(Error),
    );
    await backend.stop();
  });

  test("parent death closes its backend listener without a daemon", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ao-parent-"));
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port;
    await reservation.stop(true);
    const origin = `http://127.0.0.1:${port}`;
    const parent = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { startBackend } from ${JSON.stringify(join(import.meta.dir, "backend.ts"))};
      const backend = startBackend({executable:process.execPath,root:${JSON.stringify(resolve(import.meta.dir, ".."))},origin:${JSON.stringify(origin)},environment:{...process.env,AO_HOST:"mock",AO_DB_PATH:${JSON.stringify(join(directory, "ao.sqlite"))},AO_WEB_PORT:${JSON.stringify(String(port))},AO_WEB_ALLOWED_ORIGIN:${JSON.stringify(origin)}}});
      await backend.ready;
      console.log("ready");
      await backend.exited;
    `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    try {
      const reader = parent.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
      parent.kill("SIGKILL");
      await parent.exited;
      const deadline = Date.now() + 10_000;
      const waitForClosed = async (): Promise<void> => {
        try {
          await fetch(origin);
        } catch {
          return;
        }
        if (Date.now() > deadline) throw new Error("Backend survived parent death.");
        await Bun.sleep(50);
        return waitForClosed();
      };
      await waitForClosed();
      await reader.cancel();
    } finally {
      parent.kill();
      await parent.exited;
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
