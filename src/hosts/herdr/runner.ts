export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(argv: readonly string[]): Promise<CommandResult>;
}

export class BunCommandRunner implements CommandRunner {
  async run(argv: readonly string[]): Promise<CommandResult> {
    const process = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
    const stdoutPromise = new Response(process.stdout).text();
    const stderrPromise = new Response(process.stderr).text();
    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      process.exited,
    ]);
    return { exitCode, stdout, stderr };
  }
}
