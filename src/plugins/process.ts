import type { BoundedProcessRunner, ProcessResult } from "../plugin-sdk/index.ts";
import { readBoundedStream } from "../processes/bounded-stream.ts";
import { positiveIntegerSetting } from "../runtime/config.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 256_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export class BunBoundedProcessRunner implements BoundedProcessRunner {
  private readonly timeoutMs: number;

  constructor(options?: { readonly timeoutMs?: number }) {
    this.timeoutMs =
      options?.timeoutMs ??
      positiveIntegerSetting(
        "AO_PROCESS_TIMEOUT_MS",
        process.env.AO_PROCESS_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
        { minimum: 100 },
      );
  }

  async run(
    argv: readonly string[],
    options?: {
      readonly cwd?: string;
      readonly maxOutputBytes?: number;
      readonly timeoutMs?: number;
    },
  ): Promise<ProcessResult> {
    const limit = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const child = Bun.spawn([...argv], {
      cwd: options?.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill(9);
    }, timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        readBoundedStream(child.stdout, limit),
        readBoundedStream(child.stderr, limit),
        child.exited,
      ]);
      return {
        exitCode: timedOut ? 124 : exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        timedOut: timedOut || undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
