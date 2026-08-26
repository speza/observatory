import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import type { AgentView } from "../../src/projection/types.ts";
import type { WebTerminalScrollRequest } from "../../src/web/protocol.ts";
import {
  openWebTerminal,
  parseWebTerminalEvent,
  releaseWebTerminal,
  resizeWebTerminal,
  sendWebTerminalInput,
  sendWebTerminalScroll,
  webTerminalEventsUrl,
} from "./api.ts";

interface WebTerminalSurfaceProps {
  readonly agent: AgentView;
  readonly theme: "light" | "dark";
  readonly onClose: () => void;
}

const decodeFrame = (value: string): Uint8Array => {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const WebTerminalSurface = ({
  agent,
  theme,
  onClose,
}: WebTerminalSurfaceProps): React.JSX.Element => {
  const host = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState(`Opening ${agent.displayName}…`);

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
    const element = host.current;
    if (!element) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"DM Mono", ui-monospace, monospace',
      fontSize: 14,
      lineHeight: 1.15,
      scrollback: 5_000,
      theme:
        theme === "dark"
          ? { background: "#111412", foreground: "#e7decb", cursor: "#d68163" }
          : { background: "#29251f", foreground: "#f2ead8", cursor: "#d68163" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    terminal.focus();
    let sessionId: string | undefined;
    let events: EventSource | undefined;
    let observer: ResizeObserver | undefined;
    let disposed = false;

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || (event.key !== "PageUp" && event.key !== "PageDown"))
        return true;
      scrollTerminal({
        direction: event.key === "PageUp" ? "up" : "down",
        lines: Math.max(1, terminal.rows - 2),
        source: "page-key",
      });
      return false;
    });

    void openWebTerminal(agent.id, { columns: terminal.cols, rows: terminal.rows })
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
          fit.fit();
          if (!sessionId) return;
          const dimensions = { columns: terminal.cols, rows: terminal.rows };
          void resizeWebTerminal(sessionId, dimensions).catch((error) =>
            setStatus(error instanceof Error ? error.message : "Terminal resize failed."),
          );
        });
        observer.observe(element);
      })
      .catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal could not be opened."),
      );

    const input = terminal.onData((value) => {
      if (!sessionId) return;
      void sendWebTerminalInput(sessionId, value).catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal input failed."),
      );
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      events?.close();
      sessionRef.current = undefined;
      input.dispose();
      fit.dispose();
      terminal.dispose();
      if (sessionId) void releaseWebTerminal(sessionId);
    };
  }, [agent.id, agent.displayName, theme]);

  return (
    <section aria-label={`${agent.displayName} terminal`} className="terminal-surface">
      <header>
        <div>
          <p className="overline">HOST-OWNED TERMINAL / {agent.hostKind}</p>
          <h2>{agent.displayName}</h2>
        </div>
        <button aria-label="Close terminal" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="terminal-surface__viewport" onWheelCapture={handleWheel} ref={host} />
      <footer aria-live="polite">
        <span>{status}</span>
        <small>Wheel / PageUp / PageDown scroll the host viewport</small>
      </footer>
    </section>
  );
};
