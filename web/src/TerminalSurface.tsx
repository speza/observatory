import { useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { AgentView } from "../../src/projection/types.ts";
import {
  boundWebTerminalDimensions,
  type WebPendingLaunch,
  type WebTerminalLink,
  type WebTerminalScrollRequest,
} from "../../src/web/protocol.ts";
import {
  openWebTerminal,
  parseWebTerminalEvent,
  releaseWebTerminal,
  resizeWebTerminal,
  sendWebTerminalBytes,
  sendWebTerminalInput,
  sendWebTerminalScroll,
  webTerminalEventsUrl,
} from "./api.ts";
import { isModifiedTerminalKey, modifiedTerminalInput } from "./terminalKeyboard.ts";

export type TerminalTheme = "light" | "dark";

interface TerminalSurfaceBaseProps {
  readonly active: boolean;
  readonly embedded: boolean;
  readonly onClose: () => void;
  readonly resizeMode?: "fit" | "preserve";
  readonly showHeader?: boolean;
  readonly theme: TerminalTheme;
}

type TerminalSurfaceProps = TerminalSurfaceBaseProps &
  (
    | { readonly agent: AgentView; readonly launch?: never; readonly link?: WebTerminalLink }
    | { readonly agent?: never; readonly launch: WebPendingLaunch; readonly link?: never }
  );

const decodeFrame = (value: string): Uint8Array => {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const fitTerminal = (terminal: Terminal, fit: FitAddon) => {
  fit.fit();
  const dimensions = boundWebTerminalDimensions({
    columns: terminal.cols,
    rows: terminal.rows,
  });
  if (dimensions.columns !== terminal.cols || dimensions.rows !== terminal.rows)
    terminal.resize(dimensions.columns, dimensions.rows);
  return dimensions;
};

export const TerminalSurface = ({
  active,
  agent,
  launch,
  embedded,
  link,
  onClose,
  resizeMode = "fit",
  showHeader = true,
  theme,
}: TerminalSurfaceProps): React.JSX.Element => {
  const label = launch?.displayName ?? agent?.displayName ?? "Starting agent";
  const target = launch ? { requestId: launch.requestId } : { agentId: agent.id };
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const activeRef = useRef(active);
  const [status, setStatus] = useState(
    `Opening ${link?.label ?? label}${link ? " companion" : " terminal"}…`,
  );

  const scrollTerminal = (request: WebTerminalScrollRequest): void => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    void sendWebTerminalScroll(sessionId, request).catch((error) =>
      setStatus(error instanceof Error ? error.message : "Terminal scroll failed."),
    );
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (Math.abs(event.deltaY) < 1) return;
    event.preventDefault();
    event.stopPropagation();
    scrollTerminal({
      direction: event.deltaY < 0 ? "up" : "down",
      lines: Math.min(512, Math.max(1, Math.round(Math.abs(event.deltaY) / 20))),
      source: "wheel",
    });
  };

  useEffect(() => {
    activeRef.current = active;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!active || !terminal || !fit) return;
    const dimensions = fitTerminal(terminal, fit);
    terminal.focus();
    const sessionId = sessionRef.current;
    if (!sessionId || resizeMode === "preserve") return;
    void resizeWebTerminal(sessionId, dimensions).catch((error) =>
      setStatus(error instanceof Error ? error.message : "Terminal resize failed."),
    );
  }, [active, resizeMode]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const terminalTheme =
      theme === "dark"
        ? { background: "#181a17", foreground: "#e7decb", cursor: "#d68163" }
        : { background: "#181a17", foreground: "#f2ead8", cursor: "#d68163" };
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"DM Mono", ui-monospace, monospace',
      fontSize: 14,
      lineHeight: 1.15,
      scrollback: 5_000,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(element);
    const dimensions = fitTerminal(terminal, fit);
    if (activeRef.current) terminal.focus();
    let sessionId: string | undefined;
    let events: EventSource | undefined;
    let observer: ResizeObserver | undefined;
    let disposed = false;

    const sendInput = (value: string): void => {
      if (!sessionId || !activeRef.current) return;
      void sendWebTerminalInput(sessionId, value).catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal input failed."),
      );
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (isModifiedTerminalKey(event)) {
        const modifiedInput = modifiedTerminalInput(event);
        if (modifiedInput && sessionId && activeRef.current)
          void sendWebTerminalBytes(sessionId, modifiedInput).catch((error) => {
            setStatus(error instanceof Error ? error.message : "Terminal input failed.");
          });
        return false;
      }
      if (event.type !== "keydown" || (event.key !== "PageUp" && event.key !== "PageDown"))
        return true;
      scrollTerminal({
        direction: event.key === "PageUp" ? "up" : "down",
        lines: Math.max(1, terminal.rows - 2),
        source: "page-key",
      });
      return false;
    });

    void openWebTerminal(target, dimensions, { linkId: link?.id, resizeMode })
      .then((opened) => {
        if (disposed) {
          void releaseWebTerminal(opened.sessionId);
          return;
        }
        sessionId = opened.sessionId;
        sessionRef.current = sessionId;
        setStatus(opened.message);
        events = new EventSource(webTerminalEventsUrl(sessionId));
        const receive = (event: MessageEvent<string>): void => {
          try {
            const message = parseWebTerminalEvent(event.data);
            if (message.kind === "closed") {
              setStatus(message.reason ?? "Terminal closed.");
              events?.close();
              return;
            }
            if (message.full) terminal.reset();
            terminal.write(decodeFrame(message.bytes));
          } catch {
            setStatus("Terminal stream returned an invalid frame.");
          }
        };
        const disconnect = (): void => setStatus("Terminal stream disconnected.");
        events.addEventListener("message", receive);
        events.addEventListener("error", disconnect);
        observer = new ResizeObserver(() => {
          const resized = fitTerminal(terminal, fit);
          if (!sessionId || resizeMode === "preserve" || !activeRef.current) return;
          void resizeWebTerminal(sessionId, resized).catch((error) =>
            setStatus(error instanceof Error ? error.message : "Terminal resize failed."),
          );
        });
        observer.observe(element);
      })
      .catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal could not be opened."),
      );

    const input = terminal.onData(sendInput);

    return () => {
      disposed = true;
      observer?.disconnect();
      events?.close();
      sessionRef.current = undefined;
      terminalRef.current = null;
      fitRef.current = null;
      input.dispose();
      fit.dispose();
      terminal.dispose();
      if (sessionId) void releaseWebTerminal(sessionId);
    };
  }, [agent?.id, launch?.requestId, link?.id, resizeMode]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme =
      theme === "dark"
        ? { background: "#181a17", foreground: "#e7decb", cursor: "#d68163" }
        : { background: "#181a17", foreground: "#f2ead8", cursor: "#d68163" };
  }, [theme]);

  return (
    <section
      aria-hidden={!active}
      aria-label={`${link?.label ?? label} terminal`}
      className={`terminal-surface${embedded ? " terminal-surface--embedded" : ""}${launch ? " terminal-surface--pending" : ""}${showHeader ? "" : " terminal-surface--compact"}`}
      data-active={active ? "true" : "false"}
    >
      {showHeader ? (
        <header>
          <div>
            <p className="overline">
              {link
                ? `COMPANION TERMINAL / ${link.kind}`
                : launch
                  ? `STARTING / ${launch.harnessId}`
                  : `HOST-OWNED TERMINAL / ${agent?.execution?.hostKind ?? "detached"}`}
            </p>
            <h2>{link?.label ?? label}</h2>
          </div>
          <button aria-label="Close terminal" onClick={onClose} type="button">
            ×
          </button>
        </header>
      ) : null}
      <div className="terminal-surface__viewport" onWheelCapture={handleWheel}>
        <div className="terminal-surface__frame" ref={host} />
      </div>
      <footer
        aria-live="polite"
        className={showHeader ? undefined : "terminal-surface__footer--compact"}
      >
        <span>{status}</span>
        {showHeader ? (
          <small>
            {resizeMode === "preserve" ? "Host size preserved · " : ""}
            Wheel / PageUp / PageDown scroll the host viewport
          </small>
        ) : null}
      </footer>
    </section>
  );
};
