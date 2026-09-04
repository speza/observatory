import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { AgentView } from "../../../src/projection/types.ts";
import {
  boundWebTerminalDimensions,
  type WebPendingLaunch,
  type WebTerminalClientMessage,
  type WebTerminalLink,
  type WebTerminalScrollRequest,
} from "../../../src/web/protocol.ts";
import {
  openWebTerminal,
  parseWebTerminalMessage,
  releaseWebTerminal,
  webTerminalSocketUrl,
} from "../api/client.ts";
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

const MAX_QUEUED_TERMINAL_MESSAGES = 512;
const MAX_TERMINAL_RECONNECT_DELAY_MS = 2_000;

const terminalThemeFor = (theme: TerminalTheme) =>
  theme === "dark"
    ? {
        background: "#181a17",
        foreground: "#e7decb",
        cursor: "#d68163",
        selectionBackground: "#4b3a31",
      }
    : {
        background: "#e8e8e1",
        foreground: "#303735",
        cursor: "#e14b2d",
        selectionBackground: "#c8cbc4",
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
  const openingStatus = `Opening ${link?.label ?? label}${link ? " companion" : " terminal"}…`;
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const socketRef = useRef<WebSocket | null>(null);
  const sendMessageRef = useRef<(message: WebTerminalClientMessage) => void>(() => undefined);
  const activeRef = useRef(active);
  const [status, setStatus] = useState(openingStatus);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(false);
    setStatus(openingStatus);
  }, [agent?.id, launch?.requestId, link?.id, openingStatus]);

  const scrollTerminal = (request: WebTerminalScrollRequest): void => {
    sendMessageRef.current({ kind: "scroll", ...request });
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
    if (resizeMode === "preserve") return;
    sendMessageRef.current({ kind: "resize", ...dimensions });
  }, [active, resizeMode]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"DM Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.18,
      scrollback: 5_000,
      theme: terminalThemeFor(theme),
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(element);
    const dimensions = fitTerminal(terminal, fit);
    if (activeRef.current) terminal.focus();
    let sessionId: string | undefined;
    let socket: WebSocket | undefined;
    let terminalClosed = false;
    let lastDeliveryId: number | undefined;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackRevealTimer: ReturnType<typeof setTimeout> | undefined;
    let settledRevealTimer: ReturnType<typeof setTimeout> | undefined;
    let revealFrame: number | undefined;
    let revealScheduled = false;
    const queuedMessages: string[] = [];
    let observer: ResizeObserver | undefined;
    let disposed = false;

    const revealTerminal = (): void => {
      if (disposed || revealScheduled) return;
      revealScheduled = true;
      if (fallbackRevealTimer) clearTimeout(fallbackRevealTimer);
      settledRevealTimer = setTimeout(() => {
        revealFrame = window.requestAnimationFrame(() => {
          if (!disposed) setReady(true);
        });
      }, 120);
    };

    const sendMessage = (message: WebTerminalClientMessage): void => {
      if (!sessionId || !activeRef.current) return;
      const encoded = JSON.stringify(message);
      if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
      else if (!terminalClosed && queuedMessages.length < MAX_QUEUED_TERMINAL_MESSAGES)
        queuedMessages.push(encoded);
      else if (queuedMessages.length >= MAX_QUEUED_TERMINAL_MESSAGES)
        setStatus("Terminal input paused while reconnecting.");
    };
    sendMessageRef.current = sendMessage;

    const sendInput = (value: string): void => {
      sendMessage({ kind: "input", value });
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (isModifiedTerminalKey(event)) {
        const modifiedInput = modifiedTerminalInput(event);
        if (modifiedInput && sessionId && activeRef.current)
          sendMessage({ kind: "bytes", bytes: Array.from(modifiedInput) });
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
        const receive = (event: MessageEvent<string>): void => {
          try {
            const parsed = parseWebTerminalMessage(event.data);
            if (parsed.kind === "error") {
              setStatus(parsed.message);
              return;
            }
            if (parsed.kind === "closed") {
              if (parsed.deliveryId !== undefined) lastDeliveryId = parsed.deliveryId;
              terminalClosed = true;
              setStatus(parsed.reason ?? "Terminal closed.");
              return;
            }
            lastDeliveryId = parsed.deliveryId;
            if (parsed.full) terminal.reset();
            terminal.write(decodeFrame(parsed.bytes), revealTerminal);
          } catch {
            setStatus("Terminal stream returned an invalid frame.");
          }
        };
        const connectSocket = (): void => {
          if (disposed || terminalClosed || !sessionId) return;
          const candidate = new WebSocket(webTerminalSocketUrl(sessionId, lastDeliveryId));
          socket = candidate;
          socketRef.current = candidate;
          candidate.addEventListener("open", () => {
            if (socket !== candidate) return;
            reconnectAttempts = 0;
            setStatus(opened.message);
            const settledDimensions = fitTerminal(terminal, fit);
            sendMessage({ kind: "resize", ...settledDimensions });
            fallbackRevealTimer = setTimeout(revealTerminal, 450);
            for (const message of queuedMessages.splice(0)) candidate.send(message);
          });
          candidate.addEventListener("message", receive);
          candidate.addEventListener("close", () => {
            if (disposed || terminalClosed || socket !== candidate) return;
            socketRef.current = null;
            setStatus("Terminal stream reconnecting…");
            const delay = Math.min(MAX_TERMINAL_RECONNECT_DELAY_MS, 250 * 2 ** reconnectAttempts++);
            reconnectTimer = setTimeout(connectSocket, delay);
          });
        };
        connectSocket();
        observer = new ResizeObserver(() => {
          const resized = fitTerminal(terminal, fit);
          if (resizeMode === "preserve" || !activeRef.current) return;
          sendMessage({ kind: "resize", ...resized });
        });
        observer.observe(element);
      })
      .catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal could not be opened."),
      );

    const input = terminal.onData(sendInput);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (fallbackRevealTimer) clearTimeout(fallbackRevealTimer);
      if (settledRevealTimer) clearTimeout(settledRevealTimer);
      if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
      observer?.disconnect();
      socket?.close();
      socketRef.current = null;
      sendMessageRef.current = () => undefined;
      sessionRef.current = undefined;
      terminalRef.current = null;
      fitRef.current = null;
      input.dispose();
      fit.dispose();
      terminal.dispose();
      if (sessionId) void releaseWebTerminal(sessionId).catch(() => undefined);
    };
  }, [agent?.id, launch?.requestId, link?.id, resizeMode]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = terminalThemeFor(theme);
  }, [theme]);

  return (
    <section
      aria-hidden={!active}
      aria-label={`${link?.label ?? label} terminal`}
      className={`terminal-surface terminal-surface--${theme}${embedded ? " terminal-surface--embedded" : ""}${launch ? " terminal-surface--pending" : ""}${showHeader ? "" : " terminal-surface--compact"}`}
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
      <div
        aria-busy={!ready}
        className={`terminal-surface__viewport${ready ? " is-ready" : " is-preparing"}`}
        onWheelCapture={handleWheel}
      >
        <div className="terminal-surface__frame" ref={host} />
        {!ready ? (
          <div aria-live="polite" className="terminal-surface__mask">
            <span className="overline">TERMINAL CONNECTION</span>
            <strong>{status}</strong>
          </div>
        ) : null}
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
