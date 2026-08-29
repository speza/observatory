import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentView } from "../../src/projection/types.ts";
import type { WebTerminalLink } from "../../src/web/protocol.ts";
import { fetchTerminalLinks } from "./api.ts";
import { TerminalSurface, type TerminalTheme } from "./TerminalSurface.tsx";

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
          <p className="overline">TERMINAL DECK / {agent.execution?.hostKind ?? "detached"}</p>
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
