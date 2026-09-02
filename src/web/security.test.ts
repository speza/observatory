import { afterEach, describe, expect, test } from "bun:test";
import { makeUniverse } from "../universe/test-support.ts";
import { ObservatoryWebApi } from "./api.ts";
import { configuredLoopbackOrigin, isAllowedWebRequest } from "./security.ts";

const running: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop(true)));
});

describe("loopback web request security", () => {
  test("accepts only explicit IPv4 loopback browser origins", () => {
    expect(
      configuredLoopbackOrigin(
        "AO_WEB_ALLOWED_ORIGIN",
        "http://127.0.0.1:4310",
        "http://127.0.0.1:4311",
      ),
    ).toBe("http://127.0.0.1:4310");
    expect(() =>
      configuredLoopbackOrigin(
        "AO_WEB_ALLOWED_ORIGIN",
        "https://attacker.example",
        "http://127.0.0.1:4311",
      ),
    ).toThrow("must use http://127.0.0.1");
  });

  test("accepts the configured authority and rejects foreign authorities or origins", () => {
    expect(
      isAllowedWebRequest(
        new Request("http://127.0.0.1:4310/api/portfolio"),
        "http://127.0.0.1:4310",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRequest(
        new Request("http://attacker.example/api/portfolio"),
        "http://127.0.0.1:4310",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRequest(
        new Request("http://127.0.0.1:4310/api/portfolio", {
          headers: { origin: "https://attacker.example" },
        }),
        "http://127.0.0.1:4310",
      ),
    ).toBe(false);
  });

  test("rejects foreign browser origins for reads and terminal event streams", async () => {
    const fixture = makeUniverse();
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock, "http://127.0.0.1:4310");
    const request = (path: string): Promise<Response> =>
      api.fetch(
        new Request(`http://127.0.0.1:4310${path}`, {
          headers: { origin: "https://attacker.example" },
        }),
      );

    expect((await request("/api/portfolio")).status).toBe(403);
    expect(
      (await request("/api/terminal/00000000-0000-0000-0000-000000000000/events")).status,
    ).toBe(403);
  });

  test("rejects DNS-rebinding reads through a real Bun HTTP server", async () => {
    const fixture = makeUniverse();
    let server: ReturnType<typeof Bun.serve>;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request): Promise<Response> =>
        new ObservatoryWebApi(
          fixture.universe,
          fixture.clock,
          `http://127.0.0.1:${server.port}`,
        ).fetch(request),
    });
    running.push(server);
    const headers = { host: "attacker.example" };
    const portfolio = await fetch(`http://127.0.0.1:${server.port}/api/portfolio`, { headers });
    const diff = await fetch(`http://127.0.0.1:${server.port}/api/diff?agentId=agent-1`, {
      headers,
    });

    expect(portfolio.status).toBe(403);
    expect(diff.status).toBe(403);
    expect(await portfolio.text()).not.toContain("universe-map");
  });
});
