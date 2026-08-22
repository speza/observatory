/**
 * THROWAWAY PROTOTYPE — Herdr-backed terminal surface.
 *
 * This is deliberately separate from the production Herdr adapter. It asks
 * whether Observatory can render and control one durable Herdr terminal from
 * the map process by consuming Herdr's newline-delimited terminal stream.
 *
 * Live target:
 *   AO_HERDR_TARGET=reviewer bun run dev:herdr-terminal-poc
 *
 * Read-only mode:
 *   AO_HERDR_TARGET=reviewer AO_HERDR_MODE=observe bun run dev:herdr-terminal-poc
 *
 * Deterministic UI smoke without a running Herdr server:
 *   AO_HERDR_MOCK=1 bun run dev:herdr-terminal-poc
 *
 * Ctrl-Q releases the controller and leaves the POC. All other keys are sent
 * to the selected Herdr terminal when running in control mode.
 */

import {
  BoxRenderable,
  createCliRenderer,
  RGBA,
  StyledText,
  TextAttributes,
  TextRenderable,
} from "@opentui/core";
import { PseudoTerminalScreen } from "./pty-terminal-poc.ts";

const MIN_COLUMNS = 24;
const MIN_ROWS = 8;

const COLORS = {
  background: RGBA.fromHex("#08131f"),
  panel: RGBA.fromHex("#0d1d2b"),
  border: RGBA.fromHex("#28536a"),
  borderStrong: RGBA.fromHex("#65c7df"),
  text: RGBA.fromHex("#dcecf2"),
  muted: RGBA.fromHex("#8aa6b4"),
  cyan: RGBA.fromHex("#67e8f9"),
  green: RGBA.fromHex("#86efac"),
  yellow: RGBA.fromHex("#fde68a"),
  orange: RGBA.fromHex("#fdba74"),
  red: RGBA.fromHex("#fb7185"),
} as const;

type RecordValue = Record<string, unknown>;
type Controller = Bun.Subprocess<"pipe", "pipe", "pipe">;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (record: RecordValue, key: string): string | undefined =>
  typeof record[key] === "string" ? record[key] : undefined;

const encodeBase64 = (bytes: Uint8Array): string => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};

const decodeBase64 = (value: string): Uint8Array | undefined => {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
};

const looksBase64 = (value: string): boolean =>
  value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);

const bytesFromValue = (value: unknown, encoded = false): Uint8Array | undefined => {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number"))
    return Uint8Array.from(value.map((item) => item));
  if (typeof value !== "string") return undefined;
  if (encoded || looksBase64(value)) return decodeBase64(value);
  return new TextEncoder().encode(value);
};

const frameBytes = (value: unknown): Uint8Array | undefined => {
  if (!isRecord(value)) return undefined;
  for (const key of ["data_base64", "bytes_base64", "ansi_base64", "frame_base64"]) {
    const bytes = bytesFromValue(value[key], true);
    if (bytes) return bytes;
  }
  for (const key of ["data", "bytes", "payload", "ansi"]) {
    const bytes = bytesFromValue(value[key]);
    if (bytes) return bytes;
  }
  for (const key of ["frame", "record", "result"]) {
    const bytes = frameBytes(value[key]);
    if (bytes) return bytes;
  }
  return undefined;
};

const terminalRecordType = (value: RecordValue): string =>
  stringValue(value, "type") ?? stringValue(value, "event") ?? stringValue(value, "kind") ?? "";

const terminalRecordReason = (value: RecordValue): string | undefined =>
  stringValue(value, "reason") ?? stringValue(value, "message") ?? stringValue(value, "error");

const mockFrame = (): string => {
  const escape = String.fromCharCode(27);
  const output = `${escape}[2J${escape}[H${escape}[1;36mHERDR MOCK TERMINAL${escape}[0m\r\n${escape}[32mserver-owned session${escape}[0m\r\n\r\nType into the surface. Ctrl-Q releases it.\r\n`;
  return JSON.stringify({
    type: "terminal.frame",
    data: encodeBase64(new TextEncoder().encode(output)),
  });
};

const spawnController = (
  target: string,
  mode: "control" | "observe",
  columns: number,
  rows: number,
): Controller => {
  if (process.env.AO_HERDR_MOCK === "1") {
    const frame = mockFrame();
    return Bun.spawn(
      ["sh", "-c", `printf '%s\\n' '${frame}'; while IFS= read -r line; do :; done`],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
  }
  const command = ["herdr", "terminal", "session", mode, target];
  if (mode === "control") command.push("--takeover");
  command.push("--cols", String(columns), "--rows", String(rows));
  return Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
};

const createStatus = (value: string, colour: RGBA): StyledText =>
  new StyledText([{ __isChunk: true, text: value, fg: colour, attributes: TextAttributes.NONE }]);

const main = async (): Promise<void> => {
  const renderer = await createCliRenderer({
    targetFps: 30,
    maxFps: 60,
    gatherStats: true,
    useMouse: false,
    autoFocus: false,
    exitOnCtrlC: false,
    clearOnShutdown: true,
  });

  let closed = false;
  let controller: Controller | undefined;
  let status = "starting Herdr terminal stream…";
  const mode = process.env.AO_HERDR_MODE === "observe" ? "observe" : "control";
  const target = process.env.AO_HERDR_TARGET || "(unset)";
  const columns = Math.max(MIN_COLUMNS, renderer.width - 34);
  const rows = Math.max(MIN_ROWS, renderer.height - 7);
  const screen = new PseudoTerminalScreen(columns, rows);

  const header = new TextRenderable(renderer, {
    id: "ao-herdr-poc-header",
    position: "absolute",
    left: 1,
    top: 0,
    width: renderer.width - 2,
    height: 2,
    content: "AO OBSERVATORY  /  HERDR TERMINAL SURFACE POC",
    fg: COLORS.cyan,
    bg: COLORS.background,
  });
  const help = new TextRenderable(renderer, {
    id: "ao-herdr-poc-help",
    position: "absolute",
    left: 1,
    top: 2,
    width: renderer.width - 2,
    height: 1,
    content:
      "Herdr owns the process  ·  Ctrl-Q release  ·  all other keys go to the selected session  ·  resize follows the window",
    fg: COLORS.muted,
    bg: COLORS.background,
  });
  const context = new BoxRenderable(renderer, {
    id: "ao-herdr-poc-context",
    position: "absolute",
    left: 1,
    top: 4,
    width: 29,
    height: renderer.height - 6,
    border: true,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    title: " OBSERVATORY ",
    titleColor: COLORS.cyan,
  });
  const contextText = new TextRenderable(renderer, {
    id: "ao-herdr-poc-context-text",
    position: "absolute",
    left: 2,
    top: 2,
    width: 25,
    height: renderer.height - 10,
    content: `GOAL\n  building observatory\n\nSESSION\n  ${target}\n\nHOST\n  Herdr server\n\nMODE\n  ${mode === "control" ? "writable control" : "read-only observe"}\n\nCAPABILITIES\n  ✓ durable process\n  ✓ ANSI frame stream\n  ${mode === "control" ? "✓ input / resize" : "· input disabled"}\n\nVERDICT\n  pending dogfood`,
    fg: COLORS.text,
    bg: COLORS.panel,
  });
  context.add(contextText);

  const terminalPanel = new BoxRenderable(renderer, {
    id: "ao-herdr-poc-terminal",
    position: "absolute",
    left: 31,
    top: 4,
    width: renderer.width - 32,
    height: renderer.height - 6,
    border: true,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.background,
    title: ` HERDR ${mode.toUpperCase()} `,
    titleColor: COLORS.green,
  });
  const terminalText = new TextRenderable(renderer, {
    id: "ao-herdr-poc-terminal-text",
    position: "absolute",
    left: 33,
    top: 5,
    width: columns,
    height: rows,
    content: screen.toStyledText(),
    fg: COLORS.text,
    bg: COLORS.background,
  });
  terminalPanel.add(terminalText);
  const footer = new TextRenderable(renderer, {
    id: "ao-herdr-poc-footer",
    position: "absolute",
    left: 1,
    top: renderer.height - 1,
    width: renderer.width - 2,
    height: 1,
    content: createStatus(status, COLORS.yellow),
    bg: COLORS.background,
  });

  renderer.root.add(header);
  renderer.root.add(help);
  renderer.root.add(context);
  renderer.root.add(terminalPanel);
  renderer.root.add(footer);

  const updateStatus = (next: string, colour = COLORS.yellow): void => {
    if (closed) return;
    status = next;
    footer.content = createStatus(status, colour);
    renderer.requestRender();
  };
  const updateLayout = (width: number, height: number): void => {
    const nextColumns = Math.max(MIN_COLUMNS, width - 34);
    const nextRows = Math.max(MIN_ROWS, height - 7);
    screen.resize(nextColumns, nextRows);
    header.width = width - 2;
    help.width = width - 2;
    context.height = height - 6;
    contextText.height = height - 10;
    terminalPanel.width = width - 32;
    terminalPanel.height = height - 6;
    terminalText.width = nextColumns;
    terminalText.height = nextRows;
    terminalText.content = screen.toStyledText();
    footer.top = height - 1;
    footer.width = width - 2;
  };

  const writeControl = (payload: Record<string, unknown>): void => {
    if (mode !== "control" || !controller || closed) return;
    void controller.stdin.write(`${JSON.stringify(payload)}\n`);
  };
  const release = (): void => {
    if (closed) return;
    closed = true;
    if (mode === "control" && controller)
      void controller.stdin.write('{"type":"terminal.release"}\n');
    if (controller) controller.kill();
    renderer.destroy();
  };

  renderer.on("resize", (width: number, height: number) => {
    updateLayout(width, height);
    writeControl({ type: "terminal.resize", cols: screen.columns, rows: screen.rows });
    updateStatus(`resized Herdr viewport to ${screen.columns}×${screen.rows}`, COLORS.cyan);
  });

  try {
    if (target === "(unset)" && process.env.AO_HERDR_MOCK !== "1") {
      updateStatus("set AO_HERDR_TARGET to a live Herdr agent or pane", COLORS.red);
    } else {
      controller = spawnController(target, mode, screen.columns, screen.rows);
      updateStatus(
        `${process.env.AO_HERDR_MOCK === "1" ? "mock" : "live"} Herdr ${mode} · ${target}`,
        COLORS.green,
      );
      const stdout = controller.stdout;
      let pending = "";
      let terminalFailure = false;
      if (stdout) {
        void (async () => {
          const decoder = new TextDecoder();
          for await (const chunk of stdout) {
            if (closed) return;
            pending += decoder.decode(chunk, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              let record: unknown;
              try {
                record = JSON.parse(line) as unknown;
              } catch {
                updateStatus("Herdr emitted a non-JSON terminal record", COLORS.red);
                continue;
              }
              if (!isRecord(record)) continue;
              const type = terminalRecordType(record);
              const bytes = frameBytes(record);
              if (bytes && (type.includes("frame") || !type)) {
                screen.write(bytes);
                terminalText.content = screen.toStyledText();
                renderer.requestRender();
              } else if (type.includes("closed")) {
                const reason = terminalRecordReason(record);
                terminalFailure = Boolean(reason);
                updateStatus(
                  reason ? `Herdr closed terminal: ${reason}` : "Herdr closed the terminal stream",
                  reason ? COLORS.red : COLORS.orange,
                );
              } else if (type.includes("conflict") || type.includes("error")) {
                terminalFailure = true;
                updateStatus(`Herdr stream error: ${JSON.stringify(record)}`, COLORS.red);
              }
            }
          }
        })();
      }
      void controller.exited.then((exitCode) => {
        if (!closed && !terminalFailure)
          updateStatus(`Herdr controller exited ${exitCode} · Ctrl-Q to leave`, COLORS.orange);
      });
      if (controller.stderr) {
        void new Response(controller.stderr).text().then((error) => {
          if (error.trim() && !closed) updateStatus(`Herdr: ${error.trim()}`, COLORS.red);
        });
      }
    }
  } catch (error) {
    updateStatus(`failed to start Herdr stream: ${String(error)}`, COLORS.red);
  }

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name.toLowerCase() === "q") {
      key.preventDefault();
      release();
      return;
    }
    if (mode !== "control" || !controller || closed) return;
    const value = key.sequence || key.raw;
    writeControl({ type: "terminal.input", text: value });
  });
  renderer.keyInput.on("paste", (event) => {
    if (mode !== "control" || !controller || closed) return;
    writeControl({ type: "terminal.input", bytes: encodeBase64(event.bytes) });
  });

  renderer.start();
  process.once("SIGTERM", release);
  process.once("SIGINT", () => {
    if (mode === "control") writeControl({ type: "terminal.input", text: "\x03" });
    else release();
  });
};

if (import.meta.main) await main();
