import { describe, expect, test } from "bun:test";
import { BunBoundedProcessRunner } from "./process.ts";

describe("bounded plugin process runner", () => {
  test("bounds output and reports truncation", async () => {
    const runner = new BunBoundedProcessRunner({ timeoutMs: 2_000 });
    const result = await runner.run([process.execPath, "-e", 'console.error("x".repeat(4096))'], {
      maxOutputBytes: 128,
    });

    expect(Buffer.byteLength(result.stderr)).toBe(128);
    expect(result.stderrTruncated).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("terminates a process after its deadline", async () => {
    const runner = new BunBoundedProcessRunner({ timeoutMs: 100 });
    const result = await runner.run([process.execPath, "-e", "await Bun.sleep(10_000)"]);

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });
});
