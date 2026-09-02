import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentView,
  CommandCentreProjection,
  InspectorProjection,
  SearchResult,
  SystemView,
} from "../../../src/projection/types.ts";
import type {
  WebCommand,
  WebCommandResponse,
  WebPendingLaunch,
} from "../../../src/web/protocol.ts";
import type { ConversationHistoryView } from "../../../src/conversations/types.ts";
import {
  closeAndArchiveAgents,
  executeCommand,
  fetchInspector,
  fetchConversationHistory,
  fetchPendingLaunches,
  fetchSearch,
  resumeWebAgent,
  addConversation,
} from "../api/client.ts";
import { AttentionQueue } from "../attention/AttentionQueue.tsx";
import { Atlas, type AtlasCameraCommand } from "../atlas/Atlas.tsx";
import type { Selection } from "./selection.ts";
import { CatchUpPanel } from "../attention/CatchUpPanel.tsx";
import { InboxPanel } from "../inbox/InboxPanel.tsx";
import { Inspector } from "../inspector/Inspector.tsx";
import { KeyboardGuide } from "../shared/KeyboardGuide.tsx";
import { Ledger } from "../ledger/Ledger.tsx";
import { NewAgentDialog } from "../agents/NewAgentDialog.tsx";
import { NewGoalDialog } from "../goals/NewGoalDialog.tsx";
import { ObservatoryLogo } from "../shared/ObservatoryLogo.tsx";
import { PendingLaunches } from "../agents/PendingLaunches.tsx";
import { PendingLaunchTerminal } from "../agents/PendingLaunchTerminal.tsx";
import { ConversationHistoryDialog } from "../agents/ConversationHistoryDialog.tsx";
import { SearchPalette, searchResultAction } from "../search/SearchPalette.tsx";
import { TerminalDeck } from "../terminal/TerminalDeck.tsx";
import { SystemDialog } from "../systems/SystemDialog.tsx";
import { SystemsOverview } from "../systems/SystemsOverview.tsx";
import { ThemeToggle } from "../shared/ThemeToggle.tsx";
import { useBrowserSettings } from "../settings/browserSettings.ts";
import { scopePortfolio } from "../systems/scopedPortfolio.ts";
import { NO_SYSTEM_SCOPE, systemScopeForSelection } from "../systems/systemScope.ts";
import { usePortfolio } from "./usePortfolio.ts";
import { WorkspaceReview } from "../workspace-review/WorkspaceReview.tsx";

type SidePanel = "attention" | "inbox" | "catch-up" | "inspector";

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
  const { settings, setSetting, updateSetting } = useBrowserSettings();
  const { motion, theme, view } = settings;
  const [sidePanel, setSidePanel] = useState<SidePanel>();
  const [selection, setSelection] = useState<Selection>();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<readonly SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [cameraCommand, setCameraCommand] = useState<AtlasCameraCommand>();
  const cameraNonce = useRef(0);
  const [terminalAgent, setTerminalAgent] = useState<AgentView>();
  const [terminalLaunch, setTerminalLaunch] = useState<WebPendingLaunch>();
  const [diffAgent, setDiffAgent] = useState<AgentView>();
  const [inspector, setInspector] = useState<InspectorProjection>();
  const [inspectorError, setInspectorError] = useState<string>();
  const [inspectorRevision, setInspectorRevision] = useState(0);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<SystemView>();
  const [selectedSystemId, setSelectedSystemId] = useState<string>();
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [conversationHistoryOpen, setConversationHistoryOpen] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [launchNotice, setLaunchNotice] = useState<string>();
  const [pendingLaunches, setPendingLaunches] = useState<readonly WebPendingLaunch[]>([]);
  const [dismissedPendingLaunches, setDismissedPendingLaunches] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [conversationHistory, setConversationHistory] = useState<
    readonly ConversationHistoryView[]
  >([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = (refresh: boolean): void => {
      void fetchPendingLaunches({ refresh, signal: controller.signal })
        .then((response) => setPendingLaunches(response.launches))
        .catch(() => undefined);
    };
    load(true);
    const timer = window.setInterval(() => load(false), 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || !query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(undefined);
      return;
    }
    const controller = new AbortController();
    setSearchResults([]);
    setSearchLoading(true);
    setSearchError(undefined);
    void fetchSearch(query, controller.signal)
      .then((projection) => setSearchResults(projection.results))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSearchResults([]);
          setSearchError(error instanceof Error ? error.message : "Search unavailable.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchLoading(false);
      });
    return () => controller.abort();
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (!conversationHistoryOpen) return;
    const controller = new AbortController();
    void fetchConversationHistory({ refresh: true, signal: controller.signal })
      .then((response) => setConversationHistory(response.conversations))
      .catch((error) => {
        if (!controller.signal.aborted)
          setCommandError(
            error instanceof Error ? error.message : "Conversation history unavailable.",
          );
      });
    return () => controller.abort();
  }, [conversationHistoryOpen]);

  const refreshConversationHistory = async (): Promise<void> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const response = await fetchConversationHistory({ refresh: true });
      setConversationHistory(response.conversations);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Conversation history unavailable.");
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
      if (command.type === "AssignGoalToSystem")
        setSelectedSystemId(command.systemId ?? NO_SYSTEM_SCOPE);
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
  const visiblePendingLaunches = useMemo(
    () => pendingLaunches.filter((launch) => !dismissedPendingLaunches.has(launch.requestId)),
    [dismissedPendingLaunches, pendingLaunches],
  );
  const scopedPortfolio = useMemo(
    () => (data ? scopePortfolio(data, selectedSystemId) : undefined),
    [data, selectedSystemId],
  );
  const scopedCommandCentre = scopedPortfolio?.commandCentre;
  const scopedMap = scopedPortfolio?.map;
  const working = scopedPortfolio?.workingAgentCount ?? 0;

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
    if (data) {
      const systemScope = systemScopeForSelection(next, data.commandCentre);
      if (systemScope) setSelectedSystemId(systemScope);
    }
    setSetting("view", "atlas");
    select(next);
    issueCamera("focus", next);
  };

  const assignInboxAgents = async (agentIds: readonly string[], goalId: string): Promise<boolean> =>
    (await runCommand({ type: "AssignAgents", agentIds, goalId })) !== undefined;

  const addHistoricalConversation = async (
    handle: string,
    goalId?: string,
    resume = false,
  ): Promise<{ readonly agentId: string } | undefined> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const added = await addConversation(handle, goalId);
      portfolio.accept(added.portfolio);
      setConversationHistory((conversations) =>
        conversations.filter((conversation) => conversation.handle !== handle),
      );
      if (resume) {
        const resumed = await resumeWebAgent({
          requestId: `web-recovered-resume-${crypto.randomUUID()}`,
          agentId: added.agentId,
        });
        portfolio.accept(resumed.portfolio);
        setLaunchNotice(resumed.result.message);
      } else {
        const goal = data?.commandCentre.goals.find((candidate) => candidate.id === goalId);
        setLaunchNotice(
          goalId
            ? `Conversation added to ${goal?.title ?? "its Goal"}.`
            : "Conversation added without a Goal. Find it in Inbox.",
        );
      }
      setInspectorRevision((value) => value + 1);
      return { agentId: added.agentId };
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Add conversation failed.");
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
    if (!scopedCommandCentre || (view === "atlas" && !selectedSystemId)) return [];
    return [
      ...scopedCommandCentre.goals.map((goal) => ({ type: "goal" as const, id: goal.id })),
      ...agentsFor(scopedCommandCentre).map((agent) => ({ type: "agent" as const, id: agent.id })),
    ];
  }, [scopedCommandCentre, selectedSystemId, view]);

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
    setTerminalLaunch(undefined);
    setTerminalAgent(selectedAgent);
    setSidePanel(undefined);
  };

  const openWorkspaceReview = (agent: AgentView): void => {
    setDiffAgent(agent);
    setTerminalAgent(undefined);
    setTerminalLaunch(undefined);
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
    const items = scopedCommandCentre?.attention.items ?? [];
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
      const modifiedSearchShortcut =
        (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLocaleLowerCase() === "k";
      if (
        !searchOpen &&
        ((event.key === "/" && !isEditableTarget(event.target)) || modifiedSearchShortcut) &&
        !diffAgent &&
        !newAgentOpen &&
        !newGoalOpen &&
        !systemDialogOpen &&
        !conversationHistoryOpen &&
        !terminalAgent &&
        !terminalLaunch
      ) {
        event.preventDefault();
        setSearchOpen(true);
        setShortcutsOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
          return;
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (newGoalOpen) {
          setNewGoalOpen(false);
          setCommandError(undefined);
          return;
        }
        if (systemDialogOpen) {
          setSystemDialogOpen(false);
          setEditingSystem(undefined);
          setCommandError(undefined);
          return;
        }
        if (newAgentOpen) {
          setNewAgentOpen(false);
          return;
        }
        if (conversationHistoryOpen) {
          setConversationHistoryOpen(false);
          return;
        }
        if (terminalAgent) {
          setTerminalAgent(undefined);
          return;
        }
        if (terminalLaunch) {
          setTerminalLaunch(undefined);
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
        systemDialogOpen ||
        searchOpen ||
        conversationHistoryOpen ||
        terminalAgent ||
        terminalLaunch ||
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
      } else if (key === "v") {
        event.preventDefault();
        updateSetting("view", (current) => (current === "atlas" ? "ledger" : "atlas"));
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
        updateSetting("motion", (current) => !current);
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
    systemDialogOpen,
    searchOpen,
    conversationHistoryOpen,
    selection,
    selectedAgent,
    setSetting,
    sidePanel,
    shortcutsOpen,
    terminalAgent,
    terminalLaunch,
    updateSetting,
    view,
  ]);

  if (!data) {
    return (
      <main className={`app app--${theme} app--survey`}>
        <div className="boot-state">
          <ObservatoryLogo className="brandmark" />
          <p>{portfolio.error ?? "Reading the Observatory…"}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`app app--${theme} app--survey ${motion ? "app--motion" : "app--still"}`}>
      <header className="masthead">
        <div className="masthead__brand">
          <ObservatoryLogo className="brandmark" />
          <div className="identity">
            <p className="overline">OBSERVATORY / FIELD SURVEY 01</p>
            <h1>A measured view of work in motion</h1>
          </div>
        </div>
        <nav aria-label="Portfolio controls">
          <label className="system-scope">
            <span className="visually-hidden">Current system</span>
            <select
              aria-label="Current system"
              onChange={(event) => {
                setSelectedSystemId(event.target.value || undefined);
                setSelection(undefined);
                setSidePanel(undefined);
                setCameraCommand(undefined);
              }}
              value={selectedSystemId ?? ""}
            >
              <option value="">All systems</option>
              {data.commandCentre.systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.title}
                </option>
              ))}
              {data.commandCentre.goals.some((goal) => !goal.systemId) ? (
                <option value={NO_SYSTEM_SCOPE}>No system</option>
              ) : null}
            </select>
          </label>
          <div className="masthead__view" role="group" aria-label="View">
            <button
              aria-pressed={view === "atlas"}
              onClick={() => {
                setSetting("view", "atlas");
                setCameraCommand(undefined);
              }}
              type="button"
            >
              Atlas
            </button>
            <button
              aria-pressed={view === "ledger"}
              onClick={() => {
                setSetting("view", "ledger");
                setCameraCommand(undefined);
              }}
              type="button"
            >
              Ledger
            </button>
          </div>
          <div className="masthead__actions">
            <button onClick={() => setNewGoalOpen(true)} type="button">
              New goal
            </button>
            <button
              onClick={() => {
                setEditingSystem(undefined);
                setSystemDialogOpen(true);
              }}
              type="button"
            >
              New system
            </button>
            <button onClick={() => setNewAgentOpen(true)} type="button">
              New agent
            </button>
          </div>
          <div className="masthead__tools">
            <button
              aria-haspopup="dialog"
              onClick={() => {
                setSearchOpen(true);
                setShortcutsOpen(false);
              }}
              title="Find a Goal or Agent (/ or ⌘K)"
              type="button"
            >
              Find
            </button>
            <button
              onClick={() => {
                setCommandError(undefined);
                setConversationHistoryOpen(true);
              }}
              type="button"
            >
              Conversation history
              {conversationHistory.length > 0 ? ` (${conversationHistory.length})` : ""}
            </button>
          </div>
        </nav>
        <div className="masthead__utility">
          <ThemeToggle
            onToggle={() =>
              updateSetting("theme", (current) => (current === "light" ? "dark" : "light"))
            }
            theme={theme}
          />
          <button
            aria-expanded={shortcutsOpen}
            aria-label="Show keyboard shortcuts"
            className="masthead__help"
            onClick={() => setShortcutsOpen((value) => !value)}
            title="Keyboard shortcuts (?)"
            type="button"
          >
            ?
          </button>
        </div>
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
            <strong>{String(scopedCommandCentre?.counts.goals ?? 0).padStart(2, "0")}</strong>
            <span>Goals</span>
          </div>
          <div>
            <strong>{String(scopedCommandCentre?.counts.agents ?? 0).padStart(2, "0")}</strong>
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
            <strong>{String(scopedCommandCentre?.counts.attention ?? 0).padStart(2, "0")}</strong>
            <span>Needs you</span>
          </button>
          <button
            aria-expanded={sidePanel === "inbox"}
            onClick={() => {
              setSidePanel((value) => (value === "inbox" ? undefined : "inbox"));
              setSetting("view", "atlas");
            }}
            type="button"
          >
            <strong>{String(data.commandCentre.counts.unassigned).padStart(2, "0")}</strong>
            <span>Inbox</span>
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
        <PendingLaunches
          launches={visiblePendingLaunches}
          onDismiss={(requestId) => {
            setDismissedPendingLaunches((current) => new Set(current).add(requestId));
            if (terminalLaunch?.requestId === requestId) setTerminalLaunch(undefined);
          }}
          onOpen={(launch) => {
            setTerminalAgent(undefined);
            setTerminalLaunch(launch);
          }}
        />
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
            {data.catchUp.subjects.length} {data.catchUp.subjects.length === 1 ? "area" : "areas"}
          </b>
        </button>
        {view === "atlas" && !selectedSystemId ? (
          <SystemsOverview
            onCreate={() => {
              setEditingSystem(undefined);
              setSystemDialogOpen(true);
            }}
            onEdit={(system) => {
              setEditingSystem(system);
              setSystemDialogOpen(true);
            }}
            onOpen={(systemId) => {
              setSelectedSystemId(systemId);
              setCameraCommand(undefined);
            }}
            projection={data.commandCentre}
          />
        ) : view === "atlas" && scopedMap ? (
          <Atlas
            cameraCommand={cameraCommand}
            onFocusSelection={setSelection}
            onMoveGoal={async (goalId, position) => {
              await runCommand({ type: "SetGoalMapPosition", goalId, position });
            }}
            onSelect={select}
            onOpenTerminal={(agent) => {
              setTerminalLaunch(undefined);
              setTerminalAgent(agent);
              setSidePanel(undefined);
            }}
            onReviewChanges={openWorkspaceReview}
            onClearSelection={() => {
              setSelection(undefined);
              setSidePanel(undefined);
            }}
            projection={scopedMap}
            reservedLeft={sidePanel === "attention" || sidePanel === "inbox" ? 430 : 0}
            reservedRight={0}
            selection={selection}
            theme={theme}
            motion={motion}
          />
        ) : (
          <Ledger onSelect={select} projection={scopedCommandCentre ?? data.commandCentre} />
        )}
        {sidePanel === "attention" ? (
          <AttentionQueue
            onClose={() => setSidePanel(undefined)}
            onSelect={selectAndFocus}
            projection={scopedCommandCentre ?? data.commandCentre}
          />
        ) : null}
        {sidePanel === "inbox" ? (
          <InboxPanel
            error={commandError}
            focusedAgentId={selection?.type === "agent" ? selection.id : undefined}
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
            onOpenInbox={() => {
              setSelection(undefined);
              setSidePanel("inbox");
            }}
            onSelectSystem={(systemId) => {
              setSelectedSystemId(systemId);
              setSetting("view", "atlas");
              setSelection(undefined);
              setSidePanel(undefined);
            }}
            onSelect={selectAndFocus}
            pending={commandPending}
            projection={data.catchUp}
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
          onClick={() => updateSetting("motion", (current) => !current)}
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
      {terminalLaunch ? (
        <PendingLaunchTerminal
          key={terminalLaunch.requestId}
          launch={terminalLaunch}
          onClose={() => setTerminalLaunch(undefined)}
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
            if (command.type === "CreateGoal")
              setSelectedSystemId(command.systemId ?? NO_SYSTEM_SCOPE);
            setSelection({ type: "goal", id: goalId });
          }}
          pending={commandPending}
          systems={data.commandCentre.systems}
          defaultSystemId={selectedSystemId === NO_SYSTEM_SCOPE ? undefined : selectedSystemId}
        />
      ) : null}
      {systemDialogOpen ? (
        <SystemDialog
          error={commandError}
          onCancel={() => {
            setCommandError(undefined);
            setSystemDialogOpen(false);
            setEditingSystem(undefined);
          }}
          onCommand={runCommand}
          onSaved={(systemId) => {
            setSelectedSystemId(systemId);
            setSystemDialogOpen(false);
            setEditingSystem(undefined);
          }}
          pending={commandPending}
          system={editingSystem}
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
            const pendingLaunch = response.pendingLaunch;
            if (pendingLaunch) {
              setDismissedPendingLaunches((current) => {
                const next = new Set(current);
                next.delete(pendingLaunch.requestId);
                return next;
              });
              setPendingLaunches((current) => [
                pendingLaunch,
                ...current.filter((launch) => launch.requestId !== pendingLaunch.requestId),
              ]);
              setTerminalAgent(undefined);
              setTerminalLaunch(pendingLaunch);
            } else if (response.result.agentId) {
              setSelection({ type: "agent", id: response.result.agentId });
              setSidePanel("inspector");
              setInspectorRevision((value) => value + 1);
            } else if (response.result.goalId) {
              setSelection({ type: "goal", id: response.result.goalId });
            }
          }}
        />
      ) : null}
      {conversationHistoryOpen ? (
        <ConversationHistoryDialog
          conversations={conversationHistory}
          error={commandError}
          goals={data.commandCentre.goals}
          onAdd={addHistoricalConversation}
          onAdded={(agentId) => {
            setConversationHistoryOpen(false);
            selectAndFocus({ type: "agent", id: agentId });
            setInspectorRevision((value) => value + 1);
          }}
          onClose={() => setConversationHistoryOpen(false)}
          onRefresh={refreshConversationHistory}
          pending={commandPending}
        />
      ) : null}
      {searchOpen ? (
        <SearchPalette
          error={searchError}
          loading={searchLoading}
          onActivate={(result) => {
            setSearchOpen(false);
            setSearchQuery("");
            const next = { type: result.type, id: result.id };
            const systemScope = systemScopeForSelection(next, data.commandCentre);
            if (systemScope) setSelectedSystemId(systemScope);
            const action = searchResultAction(result, data.map);
            if (action === "focus") selectAndFocus(next);
            else {
              setSetting("view", "atlas");
              setSelection(next);
              setSidePanel(action === "inbox" ? "inbox" : "inspector");
            }
          }}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
          }}
          onQueryChange={setSearchQuery}
          projection={data.map}
          query={searchQuery}
          results={searchResults}
        />
      ) : null}
    </main>
  );
};
