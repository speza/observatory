import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { AgentView } from "../../../src/projection/types.ts";
import type { WebTerminalLayout, WebTerminalLink } from "../../../src/web/protocol.ts";
import { TerminalSurface, type TerminalTheme } from "./TerminalSurface.tsx";
import "./host-terminal-view.css";

export const HostTerminalView = ({
  agent,
  layout,
  links,
  theme,
  onClose,
}: {
  readonly agent: AgentView;
  readonly layout: WebTerminalLayout;
  readonly links: readonly WebTerminalLink[];
  readonly theme: TerminalTheme;
  readonly onClose: () => void;
}): React.JSX.Element => {
  const initialTab =
    layout.tabs.find((tab) => tab.panes.some((pane) => pane.primary)) ?? layout.tabs[0]!;
  const [tabId, setTabId] = useState(initialTab.id);
  const [focusId, setFocusId] = useState(initialTab.panes.find((pane) => pane.primary)?.id);
  const [focusRequest, setFocusRequest] = useState(0);
  const [maximizedId, setMaximizedId] = useState<string>();
  const tab = layout.tabs.find((item) => item.id === tabId) ?? initialTab;
  const focused =
    tab.panes.find((pane) => pane.id === focusId) ??
    tab.panes.find((pane) => pane.primary) ??
    tab.panes[0]!;
  const maximized = tab.panes.some((pane) => pane.id === maximizedId) ? maximizedId : undefined;

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      let next;
      if (event.key === "Tab") {
        const index = layout.tabs.findIndex((item) => item.id === tab.id);
        next =
          layout.tabs[
            (index + (event.shiftKey ? -1 : 1) + layout.tabs.length) % layout.tabs.length
          ];
      } else if (/^[1-9]$/u.test(event.key)) next = layout.tabs[Number(event.key) - 1];
      if (!next) return;
      event.preventDefault();
      setTabId(next.id);
      setMaximizedId(undefined);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [layout, tab.id]);

  return (
    <>
      <div className="terminal-deck__tabbar">
        <div aria-label="Host terminal tabs" className="terminal-deck__tablist" role="tablist">
          {layout.tabs.map((item, index) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              className="terminal-deck__tab"
              aria-selected={item.id === tab.id}
              aria-controls={`host-panel-${item.id}`}
              id={`host-tab-${item.id}`}
              onClick={() => {
                setTabId(item.id);
                setMaximizedId(undefined);
              }}
            >
              <span>{item.label}</span>
              <small>{index + 1}</small>
            </button>
          ))}
        </div>
        <span className="terminal-deck__hint">Host layout · ⌘/Ctrl+Tab to switch</span>
      </div>
      <div
        className="host-terminal-layout"
        role="tabpanel"
        id={`host-panel-${tab.id}`}
        aria-labelledby={`host-tab-${tab.id}`}
      >
        {tab.panes.map((pane) => {
          const link = links.find((item) => item.id === pane.linkId);
          const label = pane.primary ? agent.displayName : (link?.label ?? "Terminal unavailable");
          const hidden = Boolean(maximized && maximized !== pane.id);
          return (
            <section
              key={pane.id}
              aria-label={label}
              hidden={hidden}
              className={`host-terminal-pane${focused.id === pane.id ? " is-focused" : ""}${pane.primary ? " is-primary" : ""}`}
              style={
                maximized === pane.id
                  ? { inset: 0 }
                  : {
                      left: `${pane.x * 100}%`,
                      top: `${pane.y * 100}%`,
                      width: `${pane.width * 100}%`,
                      height: `${pane.height * 100}%`,
                    }
              }
              onPointerDownCapture={() => setFocusId(pane.id)}
              onFocusCapture={() => setFocusId(pane.id)}
            >
              <header>
                <button
                  className="host-terminal-pane__focus"
                  type="button"
                  onClick={() => {
                    setFocusId(pane.id);
                    setFocusRequest((value) => value + 1);
                  }}
                >
                  {label}
                  {pane.primary ? " · Selected Agent" : ""}
                </button>
                <button
                  type="button"
                  aria-label={`${maximized === pane.id ? "Restore layout for" : "Maximise"} ${label}`}
                  onClick={() => {
                    setFocusId(pane.id);
                    setFocusRequest((value) => value + 1);
                    setMaximizedId(maximized === pane.id ? undefined : pane.id);
                  }}
                >
                  {maximized === pane.id ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </header>
              {pane.primary || link?.available ? (
                <TerminalSurface
                  active={!hidden && focused.id === pane.id}
                  visible={!hidden}
                  focusRequest={focused.id === pane.id ? focusRequest : 0}
                  agent={agent}
                  embedded
                  link={pane.primary ? undefined : link}
                  onClose={onClose}
                  showHeader={false}
                  theme={theme}
                />
              ) : (
                <p>Host terminal unavailable. Waiting for a fresh layout.</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
};
