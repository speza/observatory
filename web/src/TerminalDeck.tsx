import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { AgentView } from "../../src/projection/types.ts";
import type { WebTerminalLink, WebTerminalScrollRequest } from "../../src/web/protocol.ts";
import {
  fetchTerminalLinks,
  openWebTerminal,
  parseWebTerminalEvent,
  releaseWebTerminal,
  resizeWebTerminal,
  sendWebTerminalInput,
  sendWebTerminalScroll,
  webTerminalEventsUrl,
} from "./api.ts";

export type TerminalTheme = "light" | "dark";

interface TerminalSurfaceProps {
  readonly agent: AgentView;
  readonly active: boolean;
  readonly embedded: boolean;
  readonly link?: WebTerminalLink;
  readonly onClose: () => void;
  readonly resizeMode?: "fit" | "preserve";
  readonly showHeader?: boolean;
  readonly theme: TerminalTheme;
}

const decodeFrame = (value: string): Uint8Array => {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const TerminalSurface = ({
  active,
  agent,
  embedded,
  link,
  onClose,
  resizeMode = "fit",
  showHeader = true,
  theme,
}: TerminalSurfaceProps): React.JSX.Element => {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const activeRef = useRef(active);
  const [status, setStatus] = useState(
    `Opening ${link?.label ?? agent.displayName}${link ? " companion" : " terminal"}…`,
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
    fit.fit();
    terminal.focus();
    const sessionId = sessionRef.current;
    if (!sessionId || resizeMode === "preserve") return;
    void resizeWebTerminal(sessionId, { columns: terminal.cols, rows: terminal.rows }).catch(
      (error) => setStatus(error instanceof Error ? error.message : "Terminal resize failed."),
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
    fit.fit();
    if (activeRef.current) terminal.focus();
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

    void openWebTerminal(
      agent.id,
      { columns: terminal.cols, rows: terminal.rows },
      { linkId: link?.id, resizeMode },
    )
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
          if (!sessionId || resizeMode === "preserve" || !activeRef.current) return;
          void resizeWebTerminal(sessionId, {
            columns: terminal.cols,
            rows: terminal.rows,
          }).catch((error) =>
            setStatus(error instanceof Error ? error.message : "Terminal resize failed."),
          );
        });
        observer.observe(element);
      })
      .catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal could not be opened."),
      );

    const input = terminal.onData((value) => {
      if (!sessionId || !activeRef.current) return;
      void sendWebTerminalInput(sessionId, value).catch((error) =>
        setStatus(error instanceof Error ? error.message : "Terminal input failed."),
      );
    });

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
  }, [agent.id, link?.id, resizeMode]);

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
      aria-label={`${link?.label ?? agent.displayName} terminal`}
      className={`terminal-surface${embedded ? " terminal-surface--embedded" : ""}${showHeader ? "" : " terminal-surface--compact"}`}
      data-active={active ? "true" : "false"}
    >
      {showHeader ? (
        <header>
          <div>
            <p className="overline">
              {link
                ? `COMPANION TERMINAL / ${link.kind}`
                : `HOST-OWNED TERMINAL / ${agent.hostKind}`}
            </p>
            <h2>{link?.label ?? agent.displayName}</h2>
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

interface TerminalTab {
  readonly id: string;
  readonly link?: WebTerminalLink;
}

export interface TerminalDeckProps {
  readonly agent: AgentView;
  readonly embedded?: boolean;
  readonly onClose: () => void;
  readonly theme: TerminalTheme;
}

const primaryTab: TerminalTab = { id: "primary" };

export const TerminalDeck = ({
  agent,
  embedded = false,
  onClose,
  theme,
}: TerminalDeckProps): React.JSX.Element => {
  const [tabs, setTabs] = useState<readonly TerminalTab[]>([primaryTab]);
  const [activeTabId, setActiveTabId] = useState(primaryTab.id);
  const [links, setLinks] = useState<readonly WebTerminalLink[]>([]);
  const [linksError, setLinksError] = useState<string>();
  const [linksLoading, setLinksLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const linksRequestRef = useRef<AbortController | undefined>(undefined);

  const loadLinks = useCallback((): void => {
    linksRequestRef.current?.abort();
    setLinksLoading(true);
    setLinksError(undefined);
    const controller = new AbortController();
    linksRequestRef.current = controller;
    void fetchTerminalLinks(agent.id, controller.signal)
      .then((response) => {
        setLinks(response.links);
        if (response.message) setLinksError(response.message);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLinksError(
            error instanceof Error ? error.message : "Companion terminals unavailable.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && linksRequestRef.current === controller)
          setLinksLoading(false);
      });
  }, [agent.id]);

  useEffect(() => {
    loadLinks();
    return () => linksRequestRef.current?.abort();
  }, [loadLinks]);

  const cycle = (delta: number): void => {
    setActiveTabId((current) => {
      const index = tabs.findIndex((tab) => tab.id === current);
      const next = (index + delta + tabs.length) % tabs.length;
      return tabs[next]?.id ?? current;
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "tab") {
        event.preventDefault();
        cycle(event.shiftKey ? -1 : 1);
        return;
      }
      if (/^[1-9]$/u.test(event.key)) {
        const tab = tabs[Number(event.key) - 1];
        if (!tab) return;
        event.preventDefault();
        setActiveTabId(tab.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tabs]);

  const closeTab = (tabId: string): void => {
    if (tabId === primaryTab.id) {
      onClose();
      return;
    }
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId);
      const next = current.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        setActiveTabId(next[index]?.id ?? next[index - 1]?.id ?? primaryTab.id);
      }
      return next;
    });
  };

  const addLink = (link: WebTerminalLink): void => {
    if (!link.available) return;
    const tabId = link.source === "prepared" ? crypto.randomUUID() : link.id;
    setTabs((current) =>
      link.source === "observed" && current.some((tab) => tab.id === link.id)
        ? current
        : [...current, { id: tabId, link }],
    );
    setActiveTabId(tabId);
    setPickerOpen(false);
  };

  const activeLabel = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId)?.link?.label ?? agent.displayName,
    [activeTabId, agent.displayName, tabs],
  );

  const handleDeckKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!pickerOpen) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
    }
  };

  return (
    <section
      aria-label={`${agent.displayName} terminal deck`}
      className={`terminal-deck${embedded ? " terminal-deck--embedded" : " terminal-deck--standalone"}`}
      onKeyDownCapture={handleDeckKeyDown}
    >
      <header className="terminal-deck__header">
        <div className="terminal-deck__identity">
          <p className="overline">TERMINAL DECK / {agent.hostKind}</p>
          <h2>{activeLabel}</h2>
        </div>
        <div className="terminal-deck__actions">
          <button
            aria-expanded={pickerOpen}
            className="terminal-deck__companion"
            disabled={linksLoading}
            onClick={() => setPickerOpen((open) => !open)}
            type="button"
          >
            {linksLoading ? "Loading…" : "+ Companion"}
          </button>
          <button aria-label="Close terminal deck" onClick={onClose} type="button">
            ×
          </button>
        </div>
      </header>
      <div className="terminal-deck__tabbar">
        <div aria-label="Open terminals" className="terminal-deck__tablist" role="tablist">
          {tabs.map((tab, index) => (
            <div className="terminal-deck__tab-item" key={tab.id}>
              <button
                aria-controls={`terminal-panel-${tab.id}`}
                aria-selected={tab.id === activeTabId}
                className="terminal-deck__tab"
                id={`terminal-tab-${tab.id}`}
                onClick={() => setActiveTabId(tab.id)}
                role="tab"
                tabIndex={tab.id === activeTabId ? 0 : -1}
                type="button"
              >
                <span
                  className={`terminal-deck__tab-dot terminal-deck__tab-dot--${tab.link?.kind ?? "primary"}`}
                />
                <span>{tab.link?.label ?? `Main · ${agent.displayName}`}</span>
                <small>{index + 1}</small>
              </button>
              {tab.link ? (
                <button
                  aria-label={`Close ${tab.link.label}`}
                  className="terminal-deck__tab-close"
                  onClick={() => closeTab(tab.id)}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <span className="terminal-deck__hint">⌘/Ctrl+Tab to switch</span>
      </div>
      <div className="terminal-deck__body">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              aria-hidden={!isActive}
              aria-labelledby={`terminal-tab-${tab.id}`}
              className={`terminal-deck__panel${isActive ? " is-active" : ""}`}
              id={`terminal-panel-${tab.id}`}
              key={tab.id}
              role="tabpanel"
            >
              <TerminalSurface
                active={isActive}
                agent={agent}
                embedded
                link={tab.link}
                onClose={() => closeTab(tab.id)}
                resizeMode="fit"
                showHeader={false}
                theme={theme}
              />
            </div>
          );
        })}
      </div>
      {pickerOpen ? (
        <div
          aria-label="Companion terminals"
          className="terminal-deck__picker"
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
        >
          <header>
            <div>
              <p className="overline">HOST-PROVIDED SURFACES</p>
              <h3>Open a companion</h3>
            </div>
            <button aria-label="Refresh companion terminals" onClick={loadLinks} type="button">
              ↻
            </button>
          </header>
          {linksError ? <p className="terminal-deck__picker-error">{linksError}</p> : null}
          <div className="terminal-deck__picker-list">
            {links.length === 0 && !linksError ? (
              <p className="terminal-deck__picker-empty">
                No linked terminals are currently reported.
              </p>
            ) : null}
            {links.map((link) => {
              const open =
                link.source === "observed" && tabs.some((tab) => tab.link?.id === link.id);
              return (
                <button
                  className="terminal-deck__picker-item"
                  disabled={!link.available}
                  key={link.id}
                  onClick={() => addLink(link)}
                  type="button"
                >
                  <span className={`terminal-deck__tab-dot terminal-deck__tab-dot--${link.kind}`} />
                  <span>
                    <strong>{link.label}</strong>
                    <small>
                      {link.kind === "agent" ? "Sibling agent" : "Shell"} · {link.source}
                    </small>
                  </span>
                  <em>
                    {open
                      ? "OPEN"
                      : link.available
                        ? link.source === "prepared"
                          ? "CREATE"
                          : "OPEN"
                        : "UNAVAILABLE"}
                  </em>
                </button>
              );
            })}
          </div>
          <footer>
            Companions remain host-owned; closing a tab releases only Observatory’s controller.
          </footer>
        </div>
      ) : null}
    </section>
  );
};
