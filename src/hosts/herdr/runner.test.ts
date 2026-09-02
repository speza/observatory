import { describe, expect, test } from "bun:test";
import { BunCommandRunner } from "./runner.ts";

describe("Herdr command runner", () => {
  test("bounds retained command output", async () => {
    const runner = new BunCommandRunner({ timeoutMs: 2_000, maxOutputBytes: 128 });
    const result = await runner.run([process.execPath, "-e", 'console.log("x".repeat(4096))']);

    expect(Buffer.byteLength(result.stdout)).toBe(128);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("terminates a command after its deadline", async () => {
    const runner = new BunCommandRunner({ timeoutMs: 100 });
    const startedAt = Date.now();
    const result = await runner.run([process.execPath, "-e", "await Bun.sleep(10_000)"]);

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
