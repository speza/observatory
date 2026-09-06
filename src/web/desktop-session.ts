import { timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Readable } from "node:stream";
import { Schema } from "effect";

export const desktopSessionCookieName = "ao_desktop_session";
const maximumHandshakeBytes = 256;
const tokenPattern = /^[a-f0-9]{64}$/u;
const DesktopHandshake = Schema.Struct({
  version: Schema.Literal(1),
  token: Schema.String.pipe(Schema.pattern(tokenPattern)),
});

export interface DesktopSession {
  readonly token: string;
  readonly parentClosed: Promise<void>;
}

export const readDesktopSession = (input: Readable = process.stdin): Promise<DesktopSession> =>
  new Promise((resolve, reject) => {
    let bytes = 0;
    let line = "";
    let settled = false;
    let closeParent!: () => void;
    const parentClosed = new Promise<void>((closed) => (closeParent = closed));
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maximumHandshakeBytes) return fail("Desktop handshake is too large.");
      line += chunk;
      const newline = line.indexOf("\n");
      if (newline < 0) return;
      if (line.slice(newline + 1).length > 0) return fail("Desktop handshake must be one line.");
      try {
        const record = Schema.decodeUnknownSync(DesktopHandshake)(
          JSON.parse(line.slice(0, newline)),
        );
        settled = true;
        resolve({ token: record.token, parentClosed });
      } catch {
        fail("Invalid desktop handshake.");
      }
    });
    input.once("end", () => {
      closeParent();
      fail("Desktop parent closed before the handshake.");
    });
    input.once("close", closeParent);
    input.once("error", (error) => fail(`Desktop handshake failed: ${error.message}`));
    input.resume();
  });

export const hasDesktopSession = (request: Request, token: string): boolean => {
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([name]) => name === desktopSessionCookieName)?.[1];
  if (!value || !tokenPattern.test(value)) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(token));
};

/** Provider ingress retains its independent bearer credential. Every other transport is private. */
export const isAuthorizedDesktopRequest = (request: Request, token: string): boolean =>
  new URL(request.url).pathname === "/api/provider-observations" ||
  hasDesktopSession(request, token);

export const writeDesktopReadiness = (origin: string, fd = 3): void => {
  writeFileSync(fd, `${JSON.stringify({ version: 1, origin })}\n`);
};
