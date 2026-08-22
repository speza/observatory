export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  /** Connect the child directly to the caller's terminal for interactive attach. */
  readonly interactive?: boolean;
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
  async run(argv: readonly string[], options?: CommandOptions): Promise<CommandResult> {
    if (options?.interactive) {
      const process = Bun.spawn([...argv], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      return { exitCode: await process.exited, stdout: "", stderr: "" };
    }
    const process = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = new Response(process.stdout).text();
    const stderrPromise = new Response(process.stderr).text();
    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      process.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  spawnTerminal(argv: readonly string[]): TerminalProcess {
    const process = Bun.spawn([...argv], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: process.stdout,
      stderr: process.stderr,
      exited: process.exited,
      write: async (value: string | Uint8Array) => {
        await process.stdin.write(value);
      },
      kill: () => process.kill(),
    };
  }
}
