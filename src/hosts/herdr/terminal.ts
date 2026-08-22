import { Effect, Schema, Stream } from "effect";
import type {
  HostActionResult,
  HostTerminalEvent,
  HostedTerminalSession,
  TerminalDimensions,
  HostTerminalInput,
} from "../types.ts";
import { hostError, type HostError } from "../errors.ts";
import type { TerminalCommandRunner, TerminalProcess } from "./runner.ts";
import {
  isRecord,
  numberValue,
  parseJsonValue,
  stringValue,
  type JsonRecord,
  type JsonValue,
} from "./protocol.ts";

type RecordValue = JsonRecord;

const recordType = (record: RecordValue): string =>
  stringValue(record, "type") ?? stringValue(record, "event") ?? stringValue(record, "kind") ?? "";

const recordReason = (record: RecordValue): string | undefined =>
  stringValue(record, "reason") ?? stringValue(record, "message") ?? stringValue(record, "error");

const decodeBase64 = (value: string): Uint8Array | undefined => {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};

const looksBase64 = (value: string): boolean =>
  value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);

const bytesFromValue = (value: JsonValue | undefined, encoded = false): Uint8Array | undefined => {
  if (Array.isArray(value) && value.every((item) => Schema.is(Schema.Number)(item)))
    return Uint8Array.from(value.map((item) => item));
  if (!Schema.is(Schema.String)(value)) return undefined;
  if (encoded || looksBase64(value)) return decodeBase64(value);
  return new TextEncoder().encode(value);
};

const frameBytes = (value: JsonValue | undefined): Uint8Array | undefined => {
  if (!isRecord(value)) return undefined;
  for (const key of ["data_base64", "bytes_base64", "ansi_base64", "frame_base64"]) {
    const bytes = bytesFromValue(value[key], true);
    if (bytes) return bytes;
  }
  for (const key of ["data", "bytes", "payload", "ansi"]) {
    const bytes = bytesFromValue(value[key]);
    if (bytes) return bytes;
  }
  for (const key of ["frame", "record", "result", "payload"]) {
    const bytes = frameBytes(value[key]);
    if (bytes) return bytes;
  }
  return undefined;
};

const validDimensions = (dimensions: TerminalDimensions): boolean =>
  Number.isInteger(dimensions.columns) &&
  Number.isInteger(dimensions.rows) &&
  dimensions.columns >= 1 &&
  dimensions.rows >= 1;

const writeRecord = async (process: TerminalProcess, record: RecordValue): Promise<void> => {
  await process.write(`${JSON.stringify(record)}\n`);
};

export class HerdrTerminalSession implements HostedTerminalSession {
  readonly events: Stream.Stream<HostTerminalEvent, HostError>;
  private released = false;
  private stderrText = "";

  constructor(
    private readonly process: TerminalProcess,
    private readonly target: string,
  ) {
    this.events = Stream.fromAsyncIterable(this.readEvents(), () =>
      hostError("terminal.events", `Herdr terminal stream failed for ${target}.`),
    );
    void this.drainStderr();
  }

  send(input: HostTerminalInput): Effect.Effect<HostActionResult, HostError> {
    return Effect.tryPromise({
      try: () => this.sendInternal(input),
      catch: () => hostError("terminal.send", `Herdr terminal input failed for ${this.target}.`),
    });
  }

  private async sendInternal(input: HostTerminalInput): Promise<HostActionResult> {
    if (this.released) return { ok: false, message: "The Herdr terminal has been released." };
    try {
      await writeRecord(
        this.process,
        input.kind === "text"
          ? { type: "terminal.input", text: input.value }
          : { type: "terminal.input", bytes: encodeBase64(input.value) },
      );
      return { ok: true, message: "Input sent to the Herdr terminal." };
    } catch (error) {
      return {
        ok: false,
        message: `Herdr terminal input failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  resize(dimensions: TerminalDimensions): Effect.Effect<HostActionResult, HostError> {
    return Effect.tryPromise({
      try: () => this.resizeInternal(dimensions),
      catch: () => hostError("terminal.resize", `Herdr terminal resize failed for ${this.target}.`),
    });
  }

  private async resizeInternal(dimensions: TerminalDimensions): Promise<HostActionResult> {
    if (!validDimensions(dimensions))
      return { ok: false, message: "Terminal dimensions must be positive integers." };
    if (this.released) return { ok: false, message: "The Herdr terminal has been released." };
    try {
      await writeRecord(this.process, {
        type: "terminal.resize",
        cols: dimensions.columns,
        rows: dimensions.rows,
      });
      return {
        ok: true,
        message: `Resized Herdr terminal to ${dimensions.columns}×${dimensions.rows}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Herdr terminal resize failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  release(): Effect.Effect<HostActionResult, HostError> {
    return Effect.tryPromise({
      try: () => this.releaseInternal(),
      catch: () =>
        hostError("terminal.release", `Herdr terminal release failed for ${this.target}.`),
    });
  }

  private async releaseInternal(): Promise<HostActionResult> {
    if (this.released) return { ok: true, message: "Herdr terminal already released." };
    this.released = true;
    try {
      await writeRecord(this.process, { type: "terminal.release" });
    } catch {
      // The controller may have already exited; killing it is still the safe release path.
    } finally {
      this.process.kill();
    }
    return { ok: true, message: `Released Herdr terminal ${this.target}.` };
  }

  private async *readEvents(): AsyncIterable<HostTerminalEvent> {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of this.process.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        const event = this.parseEvent(line);
        if (event) {
          yield event;
          if (event.kind === "closed") return;
        }
      }
    }
    pending += decoder.decode();
    const trailing = pending.trim();
    if (trailing) {
      const event = this.parseEvent(trailing);
      if (event) {
        yield event;
        if (event.kind === "closed") return;
      }
    }
    const reason = this.stderrText.trim();
    yield reason ? { kind: "closed", reason } : { kind: "closed" };
  }

  private parseEvent(line: string): HostTerminalEvent | undefined {
    if (!line) return undefined;
    const value = parseJsonValue(line);
    if (!isRecord(value)) return undefined;
    const type = recordType(value).toLowerCase();
    const bytes = frameBytes(value);
    if (bytes) {
      return {
        kind: "frame",
        frame: {
          bytes,
          columns: numberValue(value, "cols", "columns"),
          rows: numberValue(value, "rows"),
          sequence: numberValue(value, "sequence", "seq"),
          full: value.full === true,
        },
      };
    }
    if (type.includes("closed")) return { kind: "closed", reason: recordReason(value) };
    if (type.includes("conflict") || type.includes("error")) {
      throw new Error(recordReason(value) ?? `Herdr terminal stream reported ${type}.`);
    }
    return undefined;
  }

  private async drainStderr(): Promise<void> {
    for await (const chunk of this.process.stderr)
      this.stderrText += new TextDecoder().decode(chunk);
  }
}

export const openHerdrTerminal = (
  runner: TerminalCommandRunner,
  target: string,
  dimensions: TerminalDimensions,
): HostedTerminalSession => {
  const process = runner.spawnTerminal([
    "herdr",
    "terminal",
    "session",
    "control",
    target,
    "--takeover",
    "--cols",
    String(dimensions.columns),
    "--rows",
    String(dimensions.rows),
  ]);
  return new HerdrTerminalSession(process, target);
};

export const parseHerdrTerminalTarget = (target: {
  readonly kind: string;
  readonly token: string;
}): string | undefined => (target.kind === "herdr-terminal-control" ? target.token : undefined);
