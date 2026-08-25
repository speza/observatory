import { useCallback, useEffect, useState } from "react";
import {
  agents,
  goals,
  moments,
  needsAttention,
  stateFor,
  type AgentFixture,
  type Moment,
} from "./data";
import { clampZoom, sceneLayouts, type ViewportState } from "./layout";
import { AttentionList, EntityPanel } from "./panels";
import { World, type AtlasTheme } from "./World";
import { AgentWorkbench, CatchUpBrief, PortfolioLedger, UnassignedInbox } from "./views";

const assignedAgents = agents.filter((agent) => agent.goalId !== undefined);

const themeFromUrl = (): AtlasTheme => {
  const value = new URLSearchParams(window.location.search).get("theme");
  return value === "dark" ? "dark" : "light";
};

const writeAppearance = (theme: AtlasTheme): void => {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/observatory";
  url.searchParams.delete("variant");
  url.searchParams.set("theme", theme);
  window.history.replaceState({}, "", url);
};

const portfolioViewport = (): ViewportState => ({ zoom: 0.72, panX: 0, panY: 0 });

const focusViewport = (goalId: string, zoom = 1.5): ViewportState => {
  const layout = sceneLayouts(goals, assignedAgents).find((item) => item.goal.id === goalId);
  if (!layout) return portfolioViewport();
  return { zoom, panX: -layout.x * zoom, panY: -layout.y * zoom };
};

export const App = (): React.JSX.Element => {
  const [theme, setTheme] = useState<AtlasTheme>(themeFromUrl);
  const [moment, setMoment] = useState<Moment>("attention");
  const [selectedId, setSelectedId] = useState("");
  const [focusedGoalId, setFocusedGoalId] = useState<string>();
  const [queueOpen, setQueueOpen] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewport, setViewport] = useState<ViewportState>(portfolioViewport);
  const [view, setView] = useState<"atlas" | "ledger">("atlas");
  const [catchUp, setCatchUp] = useState(false);
  const [workbenchAgent, setWorkbenchAgent] = useState<AgentFixture>();

  const selectedAgent = agents.find((agent) => agent.id === selectedId);
  const selectedGoal = goals.find((goal) => selectedId === `goal:${goal.id}`);
  const attentionCount = assignedAgents.filter((agent) => needsAttention(agent, moment)).length;
  const workingCount = assignedAgents.filter(
    (agent) => stateFor(agent, moment) === "working",
  ).length;

  const toggleTheme = useCallback((): void => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
  }, [theme]);

  useEffect(() => writeAppearance(theme), [theme]);

  const selectEntity = (id: string): void => {
    setSelectedId(id);
    setQueueOpen(false);
    const goalId = id.startsWith("goal:")
      ? id.slice(5)
      : agents.find((agent) => agent.id === id)?.goalId;
    if (!goalId) return;
    setFocusedGoalId(goalId);
    setViewport(focusViewport(goalId, id.startsWith("goal:") ? 1.38 : 1.52));
  };

  const clearFocus = useCallback((): void => {
    setSelectedId("");
    setFocusedGoalId(undefined);
    setViewport(portfolioViewport());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") clearFocus();
      if (event.key === "0") setViewport(portfolioViewport());
      if (event.key.toLowerCase() === "a") setQueueOpen((value) => !value);
      if (event.key.toLowerCase() === "t") toggleTheme();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearFocus, toggleTheme]);

  if (workbenchAgent) {
    return (
      <main className={`app app--art app--atlas app--theme-${theme}`}>
        <AgentWorkbench
          agent={workbenchAgent}
          moment={moment}
          onClose={() => setWorkbenchAgent(undefined)}
        />
      </main>
    );
  }

  return (
    <main className={`app app--art app--atlas app--theme-${theme}`}>
      <header className="masthead">
        <div className="brandmark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="overline">OBSERVATORY / ACTIVE WORK ATLAS 06</p>
          <h1>A field guide to work in motion</h1>
        </div>
        <div className="atlas-appearance">
          <div className="atlas-view-switch" aria-label="Portfolio view">
            <button
              aria-pressed={view === "atlas"}
              className={view === "atlas" ? "is-active" : ""}
              onClick={() => setView("atlas")}
              type="button"
            >
              Atlas
            </button>
            <button
              aria-pressed={view === "ledger"}
              className={view === "ledger" ? "is-active" : ""}
              onClick={() => {
                setView("ledger");
                setQueueOpen(false);
              }}
              type="button"
            >
              Ledger
            </button>
          </div>
          <button aria-pressed={theme === "dark"} onClick={toggleTheme} type="button">
            {theme === "light" ? "Night map" : "Day map"}
            <i aria-hidden="true">{theme === "light" ? "◐" : "◑"}</i>
          </button>
        </div>
        <div className="status-cluster">
          <span className="live-dot" />
          <span>
            HERDR / {moment === "recovery" ? "RECOVERING" : moment === "attention" ? "DEGRADED" : "LIVE"}
          </span>
          <span className="status-divider" />
          <span>{agents.length} OBSERVED</span>
        </div>
      </header>

      <section className="scene-shell art-stage" aria-label="Mineral Ledger Atlas">
        <div className="scene-vignette" />
        {view === "atlas" ? (
          <World
            catchUp={catchUp}
            focusGoalId={focusedGoalId}
            labelPolicy="adaptive"
            moment={moment}
            onSelect={selectEntity}
            onViewport={setViewport}
            reducedMotion={reducedMotion}
            selectedId={selectedId}
            theme={theme}
            viewport={viewport}
          />
        ) : (
          <PortfolioLedger
            catchUp={catchUp}
            moment={moment}
            onSelect={selectEntity}
            selectedId={selectedId}
          />
        )}

        <div className="art-metrics" aria-label="Portfolio metrics">
          <div>
            <strong>{String(goals.length).padStart(2, "0")}</strong>
            <span>Goals</span>
          </div>
          <div>
            <strong>{String(agents.length).padStart(2, "0")}</strong>
            <span>Agents</span>
          </div>
          <div>
            <strong>{String(workingCount).padStart(2, "0")}</strong>
            <span>Working</span>
          </div>
          <button
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen((value) => !value)}
            type="button"
          >
            <strong>{String(attentionCount).padStart(2, "0")}</strong>
            <span>Attention</span>
          </button>
        </div>

        {view === "atlas" && focusedGoalId ? (
          <button className="portfolio-return" onClick={clearFocus} type="button">
            ← Portfolio
            <span>/ {goals.find((goal) => goal.id === focusedGoalId)?.title}</span>
          </button>
        ) : view === "atlas" ? (
          <div className="portfolio-prompt">SELECT A GOAL TO ENTER ITS SYSTEM</div>
        ) : null}

        <CatchUpBrief
          active={catchUp}
          onSelect={selectEntity}
          onToggle={() => setCatchUp((value) => !value)}
        />

        {view === "atlas" ? (
          <UnassignedInbox moment={moment} onSelect={selectEntity} selectedId={selectedId} />
        ) : null}

        <aside className={`attention-queue-fixed ${queueOpen ? "is-open" : ""}`}>
          <div className="attention-queue-fixed__heading">
            <div>
              <p className="overline">ATTENTION QUEUE</p>
              <h2>Signals requiring judgment</h2>
            </div>
            <button
              aria-label="Close Attention Queue"
              onClick={() => setQueueOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <AttentionList
            moment={moment}
            onSelect={(id) => {
              selectEntity(id);
              setQueueOpen(false);
            }}
            selectedId={selectedId}
          />
          <footer>
            <span>A</span> TOGGLE QUEUE
          </footer>
        </aside>

        {selectedAgent || selectedGoal ? (
          <EntityPanel
            agent={selectedAgent}
            goal={selectedGoal}
            moment={moment}
            onClose={clearFocus}
            onOpenAgent={setWorkbenchAgent}
            onSelect={selectEntity}
          />
        ) : null}

        {view === "atlas" ? <div className="viewport-control">
          <button
            aria-label="Zoom out"
            onClick={() =>
              setViewport((value) => ({
                ...value,
                zoom: clampZoom(value.zoom / 1.18),
              }))
            }
            type="button"
          >
            −
          </button>
          <button
            aria-label="Reset zoom"
            className="viewport-control__level"
            onClick={() => setViewport(portfolioViewport())}
            type="button"
          >
            {Math.round(viewport.zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in"
            onClick={() =>
              setViewport((value) => ({
                ...value,
                zoom: clampZoom(value.zoom * 1.18),
              }))
            }
            type="button"
          >
            +
          </button>
        </div> : null}

        <nav className="moment-control" aria-label="Scenario moment">
          <span>SCENE STATE</span>
          {moments.map((value) => (
            <button
              className={moment === value ? "is-active" : ""}
              key={value}
              onClick={() => setMoment(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </nav>
      </section>

      <button
        aria-pressed={reducedMotion}
        className={`motion-control ${reducedMotion ? "is-active" : ""}`}
        onClick={() => setReducedMotion((value) => !value)}
        type="button"
      >
        MOTION {reducedMotion ? "OFF" : "ON"}
      </button>
    </main>
  );
};
