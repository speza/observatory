import type { BoundedProcessRunner, ProcessResult } from "../plugin-sdk/index.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 256_000;

const readBounded = async (
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ readonly value: string; readonly truncated: boolean }> => {
  if (!stream) return { value: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let truncated = false;
  try {
    while (true) {
      // Bounded stream consumption is necessarily sequential.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = limit - retained;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      const accepted = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(accepted);
      retained += accepted.byteLength;
      truncated ||= accepted.byteLength !== value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return {
    value: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    truncated,
  };
};

export class BunBoundedProcessRunner implements BoundedProcessRunner {
  async run(
    argv: readonly string[],
    options?: { readonly cwd?: string; readonly maxOutputBytes?: number },
  ): Promise<ProcessResult> {
    const limit = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const child = Bun.spawn([...argv], {
      cwd: options?.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      readBounded(child.stdout, limit),
      readBounded(child.stderr, limit),
      child.exited,
    ]);
    return {
      exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  }
}
