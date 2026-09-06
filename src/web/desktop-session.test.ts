import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  desktopSessionCookieName,
  hasDesktopSession,
  isAuthorizedDesktopRequest,
  readDesktopSession,
} from "./desktop-session.ts";

const token = "a".repeat(64);

describe("desktop session", () => {
  test("reads one bounded handshake and continues observing parent closure", async () => {
    const input = new PassThrough();
    const sessionPromise = readDesktopSession(input);
    input.write(`${JSON.stringify({ version: 1, token })}\n`);
    const session = await sessionPromise;
    expect(session.token).toBe(token);
    let closed = false;
    void session.parentClosed.then(() => (closed = true));
    input.end();
    await session.parentClosed;
    expect(closed).toBe(true);
  });

  test("rejects malformed and oversized handshakes", async () => {
    const malformed = new PassThrough();
    const malformedResult = readDesktopSession(malformed);
    malformed.end('{"version":1,"token":"NO"}\n');
    await malformedResult.then(
      () => expect.unreachable(),
      (error) => expect(error).toBeInstanceOf(Error),
    );

    const oversized = new PassThrough();
    const oversizedResult = readDesktopSession(oversized);
    oversized.end(`${"x".repeat(257)}\n`);
    await oversizedResult.then(
      () => expect.unreachable(),
      (error) => expect(error).toBeInstanceOf(Error),
    );
  });

  test("requires the exact cookie credential", () => {
    expect(
      hasDesktopSession(
        new Request("http://127.0.0.1", {
          headers: { cookie: `${desktopSessionCookieName}=${token}` },
        }),
        token,
      ),
    ).toBe(true);
    expect(hasDesktopSession(new Request("http://127.0.0.1"), token)).toBe(false);
    expect(
      hasDesktopSession(
        new Request("http://127.0.0.1", {
          headers: { cookie: `${desktopSessionCookieName}=${"b".repeat(64)}` },
        }),
        token,
      ),
    ).toBe(false);
  });

  test("protects assets, API, SSE, and WebSocket paths but not provider ingress", () => {
    for (const path of [
      "/",
      "/assets/app.js",
      "/api/portfolio",
      "/api/projections/events",
      "/api/terminal/session/socket",
    ]) {
      const request = new Request(`http://127.0.0.1${path}`);
      expect(isAuthorizedDesktopRequest(request, token)).toBe(false);
      expect(
        isAuthorizedDesktopRequest(
          new Request(request.url, {
            headers: { cookie: `${desktopSessionCookieName}=${token}` },
          }),
          token,
        ),
      ).toBe(true);
    }
    expect(
      isAuthorizedDesktopRequest(new Request("http://127.0.0.1/api/provider-observations"), token),
    ).toBe(true);
  });
});
