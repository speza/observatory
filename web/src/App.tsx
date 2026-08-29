import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentView,
  CommandCentreProjection,
  InspectorProjection,
} from "../../src/projection/types.ts";
import type { WebCommand, WebCommandResponse } from "../../src/web/protocol.ts";
import type { RecoveredSessionView } from "../../src/provider-sessions/types.ts";
import {
  closeAndArchiveAgents,
  executeCommand,
  fetchInspector,
  fetchRecoveredSessions,
  resumeWebAgent,
  trackRecoveredSession,
} from "./api.ts";
import { AttentionQueue } from "./AttentionQueue.tsx";
import { Atlas, type AtlasCameraCommand, type Selection } from "./Atlas.tsx";
import { CatchUpPanel } from "./CatchUpPanel.tsx";
import { CloseoutPanel } from "./CloseoutPanel.tsx";
import { InboxPanel } from "./InboxPanel.tsx";
import { Inspector } from "./Inspector.tsx";
import { KeyboardGuide } from "./KeyboardGuide.tsx";
import { Ledger } from "./Ledger.tsx";
import { NewAgentDialog } from "./NewAgentDialog.tsx";
import { NewGoalDialog } from "./NewGoalDialog.tsx";
import { SessionImportDialog } from "./SessionImportDialog.tsx";
import { TerminalDeck } from "./TerminalDeck.tsx";
import { usePortfolio } from "./usePortfolio.ts";
import { WorkspaceReview } from "./WorkspaceReview.tsx";

type Theme = "light" | "dark";
type View = "atlas" | "ledger";
type SidePanel = "attention" | "inbox" | "catch-up" | "closeout" | "inspector";

const agentsFor = (projection: CommandCentreProjection): readonly AgentView[] => [
  ...projection.goals.flatMap((goal) => goal.agents),
  ...projection.unassigned,
];

const hostLabel = (projection: CommandCentreProjection): string => {
  const host = projection.host;
  if (!host) return "NO HOST OBSERVED";
  return `${host.hostKind.toUpperCase()} / ${host.status.toUpperCase()}`;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

export const App = (): React.JSX.Element => {
  const portfolio = usePortfolio();
  const [view, setView] = useState<View>("atlas");
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [motion, setMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [sidePanel, setSidePanel] = useState<SidePanel>();
  const [selection, setSelection] = useState<Selection>();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<AtlasCameraCommand>();
  const cameraNonce = useRef(0);
  const [terminalAgent, setTerminalAgent] = useState<AgentView>();
  const [diffAgent, setDiffAgent] = useState<AgentView>();
  const [inspector, setInspector] = useState<InspectorProjection>();
  const [inspectorError, setInspectorError] = useState<string>();
  const [inspectorRevision, setInspectorRevision] = useState(0);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [sessionImportOpen, setSessionImportOpen] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [launchNotice, setLaunchNotice] = useState<string>();
  const [recoveredSessions, setRecoveredSessions] = useState<readonly RecoveredSessionView[]>([]);

  useEffect(() => {
    if (!sessionImportOpen) return;
    const controller = new AbortController();
    void fetchRecoveredSessions({ refresh: true, signal: controller.signal })
      .then((response) => setRecoveredSessions(response.sessions))
      .catch((error) => {
        if (!controller.signal.aborted)
          setCommandError(error instanceof Error ? error.message : "Session import unavailable.");
      });
    return () => controller.abort();
  }, [sessionImportOpen]);

  const refreshSessionImport = async (): Promise<void> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const response = await fetchRecoveredSessions({ refresh: true });
      setRecoveredSessions(response.sessions);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Session import unavailable.");
    } finally {
      setCommandPending(false);
    }
  };

  useEffect(() => {
    if (!selection) {
      setInspector(undefined);
      setInspectorError(undefined);
      return;
    }
    const controller = new AbortController();
    setInspector(undefined);
    setInspectorError(undefined);
    void fetchInspector(selection.type, selection.id, controller.signal)
      .then(setInspector)
      .catch((error) => {
        if (!controller.signal.aborted)
          setInspectorError(error instanceof Error ? error.message : "Inspector unavailable.");
      });
    return () => controller.abort();
  }, [selection, inspectorRevision]);

  const runCommand = async (command: WebCommand): Promise<WebCommandResponse | undefined> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const response = await executeCommand(command);
      portfolio.accept(response.portfolio);
      setInspectorRevision((value) => value + 1);
      return response;
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Command failed.");
      return undefined;
    } finally {
      setCommandPending(false);
    }
  };

  const data = portfolio.data;
  const working = useMemo(
    () =>
      data
        ? agentsFor(data.commandCentre).filter(
            (agent) => agent.runtimeState === "working" && agent.hostHealth === "live",
          ).length
        : 0,
    [data],
  );

  const issueCamera = (type: AtlasCameraCommand["type"], target?: Selection): void => {
    cameraNonce.current += 1;
    if (type === "focus") {
      setCameraCommand({ type, selection: target, nonce: cameraNonce.current });
    } else if (type === "pan") {
      setCameraCommand({ type, dx: 0, dy: 0, nonce: cameraNonce.current });
    } else {
      setCameraCommand({ type, nonce: cameraNonce.current });
    }
  };

  const panCamera = (dx: number, dy: number): void => {
    cameraNonce.current += 1;
    setCameraCommand({ type: "pan", dx, dy, nonce: cameraNonce.current });
  };

  const select = (next: Selection): void => {
    setSelection(next);
    setSidePanel("inspector");
  };

  const selectAndFocus = (next: Selection): void => {
    setView("atlas");
    select(next);
    issueCamera("focus", next);
  };

  const assignInboxAgents = async (agentIds: readonly string[], goalId: string): Promise<boolean> =>
    (await runCommand({ type: "AssignAgents", agentIds, goalId })) !== undefined;

  const archiveAgents = async (agentIds: readonly string[]): Promise<boolean> =>
    (await runCommand({ type: "ArchiveAgents", agentIds })) !== undefined;

  const trackRecovered = async (
    handle: string,
    goalId?: string,
    resume = false,
  ): Promise<{ readonly agentId: string } | undefined> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const tracked = await trackRecoveredSession(handle, goalId);
      portfolio.accept(tracked.portfolio);
      setRecoveredSessions((sessions) => sessions.filter((session) => session.handle !== handle));
      if (resume) {
        const resumed = await resumeWebAgent({
          requestId: `web-recovered-resume-${crypto.randomUUID()}`,
          agentId: tracked.agentId,
        });
        portfolio.accept(resumed.portfolio);
        setLaunchNotice(resumed.result.message);
      } else {
        const goal = data?.commandCentre.goals.find((candidate) => candidate.id === goalId);
        setLaunchNotice(
          goalId
            ? `Session imported and added to ${goal?.title ?? "its Goal"}.`
            : "Session imported without a Goal. Find it in Inbox.",
        );
      }
      setInspectorRevision((value) => value + 1);
      return { agentId: tracked.agentId };
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Session import failed.");
      return undefined;
    } finally {
      setCommandPending(false);
    }
  };

  const runCloseout = async (agentIds: readonly string[]): Promise<boolean> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const response = await closeAndArchiveAgents(agentIds);
      portfolio.accept(response.portfolio);
      setInspectorRevision((value) => value + 1);
      setLaunchNotice(response.result.message);
      const failures = response.result.results.filter((result) => !result.ok);
      if (failures.length > 0) {
        setCommandError(failures.map((result) => result.message).join(" "));
        return false;
      }
      return true;
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Agent closeout failed.");
      return false;
    } finally {
      setCommandPending(false);
    }
  };

  const allSelections = useMemo<readonly Selection[]>(() => {
    if (!data) return [];
    return [
      ...data.commandCentre.goals.map((goal) => ({ type: "goal" as const, id: goal.id })),
      ...agentsFor(data.commandCentre).map((agent) => ({ type: "agent" as const, id: agent.id })),
    ];
  }, [data]);

  const moveSelection = (delta: number): void => {
    if (allSelections.length === 0) return;
    const currentIndex = selection
      ? allSelections.findIndex(
          (candidate) => candidate.type === selection.type && candidate.id === selection.id,
        )
      : -1;
    const nextIndex = (currentIndex + delta + allSelections.length) % allSelections.length;
    const next = allSelections[nextIndex];
    if (next) select(next);
  };

  const focusSelection = (): void => {
    if (selection) issueCamera("focus", selection);
  };

  const selectedAgent =
    selection?.type === "agent" && data
      ? agentsFor(data.commandCentre).find((agent) => agent.id === selection.id)
      : undefined;

  const openSelectedTerminal = (): void => {
    if (!selectedAgent) return;
    setTerminalAgent(selectedAgent);
    setSidePanel(undefined);
  };

  const openWorkspaceReview = (agent: AgentView): void => {
    setDiffAgent(agent);
    setTerminalAgent(undefined);
  };

  const resumeAgent = async (agent: AgentView): Promise<void> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const response = await resumeWebAgent({
        requestId: `web-resume-${crypto.randomUUID()}`,
        agentId: agent.id,
      });
      portfolio.accept(response.portfolio);
      setLaunchNotice(response.result.message);
      setInspectorRevision((value) => value + 1);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Agent resume failed.");
    } finally {
      setCommandPending(false);
    }
  };

  const jumpToAttention = (): void => {
    if (!data) return;
    const items = data.commandCentre.attention.items;
    if (items.length === 0) return;
    const targets = items.map((item) => ({
      type: item.agentId ? ("agent" as const) : ("goal" as const),
      id: item.targetId,
    }));
    const currentIndex = selection
      ? targets.findIndex(
          (candidate) => candidate.type === selection.type && candidate.id === selection.id,
        )
      : -1;
    select(targets[(currentIndex + 1) % targets.length] ?? targets[0]!);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (newGoalOpen) {
          setNewGoalOpen(false);
          setCommandError(undefined);
          return;
        }
        if (newAgentOpen) {
          setNewAgentOpen(false);
          return;
        }
        if (terminalAgent) {
          setTerminalAgent(undefined);
          return;
        }
        if (diffAgent) {
          setDiffAgent(undefined);
          return;
        }
        if (sidePanel) {
          setSidePanel(undefined);
          return;
        }
        setSelection(undefined);
        return;
      }
      // Modal and terminal surfaces own keyboard input. Keep map shortcuts from
      // mutating the background while a button, dialog, or terminal is focused.
      if (
        diffAgent ||
        newAgentOpen ||
        newGoalOpen ||
        terminalAgent ||
        shortcutsOpen ||
        (sidePanel && sidePanel !== "inspector")
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;

      const key = event.key;
      if (key === "ArrowDown" || key === "j") {
        event.preventDefault();
        moveSelection(1);
      } else if (key === "ArrowUp" || key === "k") {
        event.preventDefault();
        moveSelection(-1);
      } else if (key === "ArrowLeft" || key === "h") {
        event.preventDefault();
        panCamera(-48, 0);
      } else if (key === "ArrowRight" || key === "l") {
        event.preventDefault();
        panCamera(48, 0);
      } else if (key === "PageUp" || key === "U") {
        event.preventDefault();
        panCamera(0, -48);
      } else if (key === "PageDown" || key === "D") {
        event.preventDefault();
        panCamera(0, 48);
      } else if (key === "Enter") {
        event.preventDefault();
        if (!selection) moveSelection(1);
        else if (selection.type === "agent") openSelectedTerminal();
        else focusSelection();
      } else if (key === " ") {
        event.preventDefault();
        focusSelection();
      } else if (key === "+" || key === "=") {
        event.preventDefault();
        issueCamera("zoom-in");
      } else if (key === "-") {
        event.preventDefault();
        issueCamera("zoom-out");
      } else if (key === "0") {
        event.preventDefault();
        issueCamera("reset");
      } else if (key === "f") {
        event.preventDefault();
        focusSelection();
      } else if (key === "a") {
        event.preventDefault();
        setSidePanel((value) => (value === "attention" ? undefined : "attention"));
      } else if (key === "b") {
        event.preventDefault();
        setSidePanel((value) => (value === "inbox" ? undefined : "inbox"));
      } else if (key === "c") {
        event.preventDefault();
        setSidePanel((value) => (value === "closeout" ? undefined : "closeout"));
      } else if (key === "v") {
        event.preventDefault();
        setView((value) => (value === "atlas" ? "ledger" : "atlas"));
        setCameraCommand(undefined);
      } else if (key === "n") {
        event.preventDefault();
        setCommandError(undefined);
        setNewGoalOpen(true);
      } else if (key === "N") {
        event.preventDefault();
        setNewAgentOpen(true);
      } else if (key === "i") {
        event.preventDefault();
        if (selection) setSidePanel((value) => (value === "inspector" ? undefined : "inspector"));
      } else if (key === "g") {
        event.preventDefault();
        jumpToAttention();
      } else if (key === "t") {
        event.preventDefault();
        openSelectedTerminal();
      } else if (key === "m") {
        event.preventDefault();
        setMotion((value) => !value);
      } else if (key === "?") {
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    allSelections,
    data,
    diffAgent,
    newGoalOpen,
    newAgentOpen,
    selection,
    selectedAgent,
    sidePanel,
    shortcutsOpen,
    terminalAgent,
    view,
  ]);

  if (!data) {
    return (
      <main className={`app app--${theme}`}>
        <div className="boot-state">
          <span className="brandmark">
            <i />
          </span>
          <p>{portfolio.error ?? "Reading the Observatory…"}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`app app--${theme} ${motion ? "app--motion" : "app--still"}`}>
      <header className="masthead">
        <span className="brandmark" aria-hidden="true">
          <i />
        </span>
        <div className="identity">
          <p className="overline">OBSERVATORY / ACTIVE WORK ATLAS 01</p>
          <h1>A field guide to work in motion</h1>
        </div>
        <nav aria-label="Portfolio view">
          <button
            aria-pressed={view === "atlas"}
            onClick={() => {
              setView("atlas");
              setCameraCommand(undefined);
            }}
            type="button"
          >
            Atlas
          </button>
          <button
            aria-pressed={view === "ledger"}
            onClick={() => {
              setView("ledger");
              setCameraCommand(undefined);
            }}
            type="button"
          >
            Ledger
          </button>
          <button onClick={() => setNewGoalOpen(true)} type="button">
            New goal
          </button>
          <button onClick={() => setNewAgentOpen(true)} type="button">
            New agent
          </button>
          <button
            onClick={() => {
              setCommandError(undefined);
              setSessionImportOpen(true);
            }}
            type="button"
          >
            Session import
            {recoveredSessions.length > 0 ? ` (${recoveredSessions.length})` : ""}
          </button>
          <button
            onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
            type="button"
          >
            {theme === "light" ? "Night map" : "Day map"}
          </button>
          <button
            aria-expanded={shortcutsOpen}
            aria-label="Show keyboard shortcuts"
            onClick={() => setShortcutsOpen((value) => !value)}
            title="Keyboard shortcuts (?)"
            type="button"
          >
            ?
          </button>
        </nav>
        <div className="host-status">
          <i
            className={`host-status__dot host-status__dot--${data.commandCentre.host?.status ?? "unavailable"}`}
          />
          <span>{hostLabel(data.commandCentre)}</span>
          <b>{data.commandCentre.counts.agents} OBSERVED</b>
        </div>
      </header>
      <section className="work-surface">
        <div className="metrics" aria-label="Portfolio metrics">
          <div>
            <strong>{String(data.commandCentre.counts.goals).padStart(2, "0")}</strong>
            <span>Goals</span>
          </div>
          <div>
            <strong>{String(data.commandCentre.counts.agents).padStart(2, "0")}</strong>
            <span>Agents</span>
          </div>
          <div>
            <strong>{String(working).padStart(2, "0")}</strong>
            <span>Working</span>
          </div>
          <button
            aria-expanded={sidePanel === "attention"}
            onClick={() => {
              setSidePanel((value) => (value === "attention" ? undefined : "attention"));
            }}
            type="button"
          >
            <strong>{String(data.commandCentre.counts.attention).padStart(2, "0")}</strong>
            <span>Attention</span>
          </button>
          <button
            aria-expanded={sidePanel === "inbox"}
            onClick={() => {
              setSidePanel((value) => (value === "inbox" ? undefined : "inbox"));
              setView("atlas");
            }}
            type="button"
          >
            <strong>{String(data.commandCentre.counts.unassigned).padStart(2, "0")}</strong>
            <span>Inbox</span>
          </button>
          <button
            aria-expanded={sidePanel === "closeout"}
            onClick={() => {
              setSidePanel((value) => (value === "closeout" ? undefined : "closeout"));
            }}
            type="button"
          >
            <strong>{String(data.closeout.counts.total).padStart(2, "0")}</strong>
            <span>Closeout</span>
          </button>
        </div>
        {portfolio.error ? (
          <div className="refresh-error">{portfolio.error} · showing last trusted projection</div>
        ) : null}
        {launchNotice ? (
          <button
            className="launch-notice"
            onClick={() => setLaunchNotice(undefined)}
            type="button"
          >
            {launchNotice} <span aria-hidden="true">×</span>
          </button>
        ) : null}
        <button
          aria-expanded={sidePanel === "catch-up"}
          className={`catch-up-trigger ${data.catchUp.pending ? "is-pending" : ""}`}
          onClick={() => {
            setSidePanel((value) => (value === "catch-up" ? undefined : "catch-up"));
          }}
          type="button"
        >
          <span>{data.catchUp.pending ? "Catch up" : "Caught up"}</span>
          <b>
            {data.catchUp.groups.reduce((total, group) => total + group.items.length, 0)} changes
          </b>
        </button>
        {view === "atlas" ? (
          <Atlas
            cameraCommand={cameraCommand}
            onMoveGoal={async (goalId, position) => {
              await runCommand({ type: "SetGoalMapPosition", goalId, position });
            }}
            onSelect={select}
            onClearSelection={() => {
              setSelection(undefined);
              setSidePanel(undefined);
            }}
            projection={data.map}
            reservedLeft={
              sidePanel === "attention" || sidePanel === "inbox" || sidePanel === "closeout"
                ? 430
                : 0
            }
            reservedRight={0}
            selection={selection}
            theme={theme}
            motion={motion}
          />
        ) : (
          <Ledger onSelect={select} projection={data.commandCentre} />
        )}
        {sidePanel === "attention" ? (
          <AttentionQueue
            onClose={() => setSidePanel(undefined)}
            onSelect={selectAndFocus}
            projection={data.commandCentre}
          />
        ) : null}
        {sidePanel === "inbox" ? (
          <InboxPanel
            error={commandError}
            onAssign={assignInboxAgents}
            onClose={() => setSidePanel(undefined)}
            onSelect={(next) => {
              setSelection(next);
              setSidePanel("inspector");
            }}
            pending={commandPending}
            projection={data.commandCentre}
          />
        ) : null}
        {sidePanel === "catch-up" ? (
          <CatchUpPanel
            onAcknowledge={async () => {
              const response = await runCommand({ type: "AcknowledgeCatchUp" });
              if (response) setSidePanel(undefined);
            }}
            onClose={() => setSidePanel(undefined)}
            onSelect={selectAndFocus}
            pending={commandPending}
            projection={data.catchUp}
          />
        ) : null}
        {sidePanel === "closeout" ? (
          <CloseoutPanel
            error={commandError}
            onArchive={archiveAgents}
            onClose={() => setSidePanel(undefined)}
            onCloseAndArchive={runCloseout}
            onReview={(agent) => {
              setSidePanel(undefined);
              openWorkspaceReview(agent);
            }}
            onSelect={(next) => {
              setSelection(next);
              setSidePanel("inspector");
            }}
            pending={commandPending}
            projection={data.closeout}
          />
        ) : null}
        {shortcutsOpen ? <KeyboardGuide onClose={() => setShortcutsOpen(false)} /> : null}
        {selection && sidePanel === "inspector" && !terminalAgent ? (
          <Inspector
            commandCentre={data.commandCentre}
            commandError={commandError}
            commandPending={commandPending}
            error={inspectorError}
            onClose={() => setSidePanel(undefined)}
            onCommand={runCommand}
            onCloseAndArchive={runCloseout}
            projection={inspector}
            onOpenTerminal={setTerminalAgent}
            onRetry={() => setInspectorRevision((value) => value + 1)}
            onReviewChanges={openWorkspaceReview}
            onResume={resumeAgent}
          />
        ) : null}
        <button
          aria-pressed={motion}
          className="motion-control"
          onClick={() => setMotion((value) => !value)}
          type="button"
        >
          Motion {motion ? "on" : "off"}
        </button>
      </section>
      {diffAgent ? (
        <WorkspaceReview agent={diffAgent} onClose={() => setDiffAgent(undefined)} theme={theme} />
      ) : null}
      {terminalAgent ? (
        <TerminalDeck
          agent={terminalAgent}
          key={terminalAgent.id}
          onClose={() => setTerminalAgent(undefined)}
          theme={theme}
        />
      ) : null}
      {newGoalOpen ? (
        <NewGoalDialog
          error={commandError}
          onCancel={() => {
            setCommandError(undefined);
            setNewGoalOpen(false);
          }}
          onCreate={async (command) => {
            const response = await runCommand(command);
            const goalId = response?.result.goalId;
            if (!goalId) return;
            setNewGoalOpen(false);
            setSelection({ type: "goal", id: goalId });
          }}
          pending={commandPending}
        />
      ) : null}
      {newAgentOpen ? (
        <NewAgentDialog
          defaultGoalId={selection?.type === "goal" ? selection.id : selectedAgent?.primaryGoalId}
          onCancel={() => setNewAgentOpen(false)}
          onStarted={(response) => {
            portfolio.accept(response.portfolio);
            const notice = response.result.warnings?.length
              ? `${response.result.message} ${response.result.warnings.join(" ")}`
              : response.result.message;
            setLaunchNotice(notice);
            setNewAgentOpen(false);
            if (response.result.agentId) {
              setSelection({ type: "agent", id: response.result.agentId });
              setSidePanel("inspector");
              setInspectorRevision((value) => value + 1);
            } else if (response.result.goalId) {
              setSelection({ type: "goal", id: response.result.goalId });
            }
          }}
        />
      ) : null}
      {sessionImportOpen ? (
        <SessionImportDialog
          error={commandError}
          goals={data.commandCentre.goals}
          onClose={() => setSessionImportOpen(false)}
          onImport={trackRecovered}
          onImported={(agentId) => {
            setSessionImportOpen(false);
            selectAndFocus({ type: "agent", id: agentId });
            setInspectorRevision((value) => value + 1);
          }}
          onRefresh={refreshSessionImport}
          pending={commandPending}
          sessions={recoveredSessions}
        />
      ) : null}
    </main>
  );
};
