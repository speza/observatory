import { readBoundedStream } from "../../processes/bounded-stream.ts";
import { positiveIntegerSetting } from "../../runtime/config.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly timedOut?: boolean;
}

export interface CommandOptions {
  /** Connect the child directly to the caller's terminal for interactive attach. */
  readonly interactive?: boolean;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

export interface CommandRunner {
  run(argv: readonly string[], options?: CommandOptions): Promise<CommandResult>;
}

export interface TerminalProcess {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<number>;
  write(value: string | Uint8Array): Promise<void>;
  kill(): void;
}

export interface TerminalCommandRunner {
  spawnTerminal(argv: readonly string[]): TerminalProcess;
}

export class BunCommandRunner implements CommandRunner, TerminalCommandRunner {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options?: { readonly timeoutMs?: number; readonly maxOutputBytes?: number }) {
    this.timeoutMs =
      options?.timeoutMs ??
      positiveIntegerSetting(
        "AO_HERDR_COMMAND_TIMEOUT_MS",
        process.env.AO_HERDR_COMMAND_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
        { minimum: 100 },
      );
    this.maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  async run(argv: readonly string[], options?: CommandOptions): Promise<CommandResult> {
    if (options?.interactive) {
      const child = Bun.spawn([...argv], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      return { exitCode: await child.exited, stdout: "", stderr: "" };
    }
    const child = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const limit = options?.maxOutputBytes ?? this.maxOutputBytes;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
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
        stdoutTruncated: stdout.truncated || undefined,
        stderrTruncated: stderr.truncated || undefined,
        timedOut: timedOut || undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  spawnTerminal(argv: readonly string[]): TerminalProcess {
    const child = Bun.spawn([...argv], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      write: async (value: string | Uint8Array) => {
        await child.stdin.write(value);
      },
      kill: () => child.kill(),
    };
  }
}
