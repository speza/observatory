import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Schema } from "effect";

const Readiness = Schema.Struct({ version: Schema.Literal(1), origin: Schema.String });

export interface DesktopBackend {
  readonly token: string;
  readonly ready: Promise<string>;
  readonly exited: Promise<void>;
  stop(): Promise<void>;
}

/** Own only this child, never the independently running execution host. */
export const startBackend = (options: {
  readonly executable: string;
  readonly root: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly origin: string;
}): DesktopBackend => {
  const token = randomBytes(32).toString("hex");
  const child = spawn(options.executable, ["run", `${options.root}/src/web/main.ts`], {
    cwd: options.root,
    env: { ...options.environment, AO_DESKTOP: "1", AO_RESOURCE_ROOT: options.root },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  // Backend logs may contain private host diagnostics. Drain, but do not persist or forward them.
  child.stdout?.resume();
  child.stderr?.resume();
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 8_000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    })();
    return stopPromise;
  };
  const ready = new Promise<string>((resolve, reject) => {
    let record = "";
    let settled = false;
    const finish = (origin?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (origin) resolve(origin);
      else {
        reject(
          new Error(
            "Backend startup failed. Check the configured port, database ownership, resource paths and tool configuration.",
          ),
        );
        void stop();
      }
    };
    const timeout = setTimeout(() => finish(), 60_000);
    child.once("error", () => finish());
    child.once("exit", () => finish());
    const channel = child.stdio[3];
    if (!channel || !("readable" in channel)) {
      finish();
      return;
    }
    channel.setEncoding("utf8");
    channel.on("data", (chunk: string) => {
      if (settled) return;
      record += chunk;
      if (record.length > 1024) {
        finish();
        return;
      }
      if (!record.endsWith("\n")) return;
      try {
        const message = Schema.decodeUnknownSync(Readiness)(JSON.parse(record));
        finish(message.origin === options.origin ? message.origin : undefined);
      } catch {
        finish();
      }
    });
    child.stdin?.on("error", () => finish());
    child.stdin?.write(`${JSON.stringify({ version: 1, token })}\n`);
  });
  return { token, ready, exited, stop };
};
