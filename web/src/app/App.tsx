import { ModalDialog } from "../shared/ModalDialog.tsx";
import { CircleAlert, Inbox, History, ListTree } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentView,
  CommandCentreProjection,
  DiscoveredExecutionView,
  SystemView,
} from "../../../src/projection/types.ts";
import {
  DEFAULT_SYSTEM_ID,
  type WebCommand,
  type WebCommandResponse,
  type WebConversationHistoryItem,
  type WebPendingLaunch,
} from "../../../src/web/protocol/index.ts";
import {
  closeAndArchiveAgents,
  executeCommand,
  fetchConversationHistory,
  resumeWebAgent,
  addConversation,
  admitDiscoveredExecution,
} from "../api/client.ts";
import { CloseAgentDialog } from "../agents/CloseAgentDialog.tsx";
import { Atlas, type AtlasCameraCommand } from "../atlas/Atlas.tsx";
import { CatchUpPanel } from "../attention/CatchUpPanel.tsx";
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
import { orderTerminalAgents } from "../terminal/terminalAgents.ts";
import { SystemDialog } from "../systems/SystemDialog.tsx";
import { SystemsOverview } from "../systems/SystemsOverview.tsx";
import { ThemeToggle } from "../shared/ThemeToggle.tsx";
import { useBrowserSettings } from "../settings/browserSettings.ts";
import { scopePortfolio } from "../systems/scopedPortfolio.ts";
import { systemScopeForSelection } from "../systems/systemScope.ts";
import { usePortfolio } from "./usePortfolio.ts";
import { WorkspaceReview } from "../workspace-review/WorkspaceReview.tsx";
import { useSearch } from "../search/useSearch.ts";
import { useInspector } from "../inspector/useInspector.ts";
import { parseBatchDestination } from "../inspector/batchDestination.ts";

import { Workspace } from "./Workspace.tsx";
import { WorkspaceNavigation } from "./WorkspaceNavigation.tsx";
import { agentsInView, allAgents, type NavigationView } from "./navigatorAgents.ts";
import {
  extendAgentSelection,
  isBatchAgentSelection,
  noSelection,
  onlySelection,
  pruneSelection,
  selectAgentSet,
  selectedAgentIds,
  toggleAgentSelection,
  type AgentSelectionHandler,
  type AgentSetSelectionHandler,
  type Selection,
  type SelectionModel,
} from "./selection.ts";

const agentsFor = allAgents;

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
  const { motion, terminalAppearance, theme, view } = settings;
  const terminalTheme = terminalAppearance === "application" ? theme : terminalAppearance;
  const [navigationView, setNavigationView] = useState<NavigationView>("all");
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selection, setSelection] = useState<SelectionModel>(noSelection);
  const subject = selection.subject;
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    loading: searchLoading,
    error: searchError,
  } = useSearch(searchOpen);
  const [cameraCommand, setCameraCommand] = useState<AtlasCameraCommand>();
  const cameraNonce = useRef(0);
  const [terminalAgent, setTerminalAgent] = useState<AgentView>();
  const [terminalDiscovery, setTerminalDiscovery] = useState<DiscoveredExecutionView>();
  const [recentTerminalAgentIds, setRecentTerminalAgentIds] = useState<readonly string[]>([]);
  const [terminalLaunch, setTerminalLaunch] = useState<WebPendingLaunch>();
  const [closeoutAgent, setCloseoutAgent] = useState<AgentView>();
  const [diffAgent, setDiffAgent] = useState<AgentView>();
  const [pullRequestUrls, setPullRequestUrls] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const {
    projection: inspector,
    error: inspectorError,
    refresh: refreshInspector,
  } = useInspector(subject, portfolio.affected, portfolio.affectedAll);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<SystemView>();
  const [selectedSystemId, setSelectedSystemId] = useState<string>();
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [conversationHistoryOpen, setConversationHistoryOpen] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [launchNotice, setLaunchNotice] = useState<string>();
  const pendingLaunches = portfolio.pendingLaunches;
  const [dismissedPendingLaunches, setDismissedPendingLaunches] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [conversationHistory, setConversationHistory] = useState<
    readonly WebConversationHistoryItem[]
  >([]);

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

  const runCommand = async (command: WebCommand): Promise<WebCommandResponse | undefined> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const response = await executeCommand(command);
      portfolio.accept(response.portfolio);
      // Assignment commands update the data without changing the operator's
      // current lens. This keeps repeated filing in the same context.
      refreshInspector();
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
    () =>
      (pendingLaunches ?? []).filter((launch) => !dismissedPendingLaunches.has(launch.requestId)),
    [dismissedPendingLaunches, pendingLaunches],
  );
  const scopedPortfolio = useMemo(
    () => (data ? scopePortfolio(data, selectedSystemId) : undefined),
    [data, selectedSystemId],
  );
  const scopedCommandCentre = scopedPortfolio?.commandCentre;
  const scopedMap = scopedPortfolio?.map;
  const terminalAgents = useMemo(
    () =>
      orderTerminalAgents(
        data ? agentsFor(data.commandCentre) : [],
        recentTerminalAgentIds,
        terminalAgent,
      ),
    [data, recentTerminalAgentIds, terminalAgent],
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
    setSelection(onlySelection(next));
    setInspectorOpen(true);
  };

  const selectAndFocus = (next: Selection): void => {
    if (data) {
      const systemScope = systemScopeForSelection(next, data.commandCentre);
      setSelectedSystemId(systemScope);
    }
    setSetting("view", "atlas");
    select(next);
    issueCamera("focus", next);
  };

  /**
   * Modifier gestures never move the camera or change System scope: a batch is
   * built in place, and only an explicit plain click navigates.
   */
  const selectAgent: AgentSelectionHandler = (agentId, intent, order) => {
    setSelection((current) =>
      intent.range
        ? extendAgentSelection(current, agentId, order)
        : intent.additive
          ? toggleAgentSelection(current, agentId)
          : onlySelection({ type: "agent", id: agentId }),
    );
    setInspectorOpen(true);
  };

  const selectAgents: AgentSetSelectionHandler = (agentIds) => {
    setSelection((current) =>
      selectAgentSet(agentIds, current.subject?.type === "agent" ? current.subject.id : undefined),
    );
    setInspectorOpen(true);
  };

  /**
   * Keyboard focus keeps the inspector in step with where the operator is, but it
   * must never mutate an armed batch: a set that was built deliberately is not
   * reshaped by focus wandering onto a card or one of its quick actions.
   */
  const followFocus = (next: Selection): void => {
    setSelection((current) => (isBatchAgentSelection(current) ? current : onlySelection(next)));
  };

  const addHistoricalConversation = async (
    handle: string,
    goalId?: string,
    systemId?: string,
    resume = false,
  ): Promise<{ readonly agentId: string } | undefined> => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const added = await addConversation(handle, goalId, systemId);
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
        const system = data?.commandCentre.systems.find((candidate) => candidate.id === systemId);
        setLaunchNotice(
          goalId
            ? `Conversation added to ${goal?.title ?? "its Goal"}.`
            : systemId
              ? `Conversation added to ${system?.title ?? "its System"}.`
              : "Conversation added without a Goal or System. Find it in Inbox.",
        );
      }
      refreshInspector();
      return { agentId: added.agentId };
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Add conversation failed.");
      return undefined;
    } finally {
      setCommandPending(false);
    }
  };

  const admitSelectedDiscovery = async (
    handle: string,
    goalId?: string,
    systemId?: string,
  ): Promise<
    | {
        readonly agentId: string;
        readonly goalId?: string;
        readonly systemId?: string;
        readonly message: string;
        readonly partial?: boolean;
      }
    | undefined
  > => {
    setCommandPending(true);
    setCommandError(undefined);
    try {
      const added = await admitDiscoveredExecution(handle, goalId, systemId);
      portfolio.accept(added.portfolio);
      const agent = agentsFor(added.portfolio.commandCentre).find(
        (candidate) => candidate.id === added.agentId,
      );
      if (agent) {
        setSelectedSystemId(
          systemScopeForSelection({ type: "agent", id: agent.id }, added.portfolio.commandCentre),
        );
        setSelection(onlySelection({ type: "agent", id: agent.id }));
        setInspectorOpen(true);
        if (terminalDiscovery?.handle === handle) {
          setTerminalDiscovery(undefined);
          setTerminalAgent(agent);
          setRecentTerminalAgentIds((current) => [
            agent.id,
            ...current.filter((id) => id !== agent.id),
          ]);
        }
      }
      setLaunchNotice(added.message);
      refreshInspector();
      if (added.partial)
        return {
          agentId: added.agentId,
          goalId: added.goalId,
          systemId: added.systemId,
          message: added.message,
          partial: true,
        };
      return {
        agentId: added.agentId,
        goalId: added.goalId,
        systemId: added.systemId,
        message: added.message,
      };
    } catch (error) {
      setCommandError(
        error instanceof Error ? error.message : "Discovered execution admission failed.",
      );
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
      refreshInspector();
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
    if (!scopedCommandCentre) return [];
    if (
      view === "atlas" &&
      !selectedSystemId &&
      (scopedCommandCentre.discoveredExecutions?.length ?? 0) === 0
    )
      return [];
    return [
      ...scopedCommandCentre.goals.map((goal) => ({ type: "goal" as const, id: goal.id })),
      ...agentsFor(scopedCommandCentre).map((agent) => ({ type: "agent" as const, id: agent.id })),
      ...(scopedCommandCentre.discoveredExecutions ?? []).map((execution) => ({
        type: "discovered-execution" as const,
        id: execution.handle,
      })),
    ];
  }, [scopedCommandCentre, selectedSystemId, view]);

  /** Agent order for range and select-all: exactly what the current view shows. */
  const orderedAgentIds = useMemo(
    () =>
      scopedCommandCentre
        ? agentsInView(scopedCommandCentre, navigationView).map((agent) => agent.id)
        : [],
    [navigationView, scopedCommandCentre],
  );

  // A selected Agent that stops existing must not linger in a pending batch.
  useEffect(() => {
    if (!data) return;
    const existing = new Set(agentsFor(data.commandCentre).map((agent) => agent.id));
    setSelection((current) => pruneSelection(current, existing));
  }, [data]);

  // A batch may only ever hold Agents the operator can currently see. Selected
  // Agents that the active view no longer shows collapse back to the subject, so
  // no bulk action can reach work that is off-screen in this lens.
  useEffect(() => {
    if (!isBatchAgentSelection(selection)) return;
    const visible = new Set(orderedAgentIds);
    if (selectedAgentIds(selection).every((agentId) => visible.has(agentId))) return;
    setSelection((current) =>
      selectAgentSet(
        current.subject?.type === "agent" ? [current.subject.id] : [],
        current.subject?.id,
      ),
    );
  }, [orderedAgentIds, selection]);

  const moveSelection = (delta: number): void => {
    if (allSelections.length === 0) return;
    const currentIndex = subject
      ? allSelections.findIndex(
          (candidate) => candidate.type === subject.type && candidate.id === subject.id,
        )
      : -1;
    const nextIndex = (currentIndex + delta + allSelections.length) % allSelections.length;
    const next = allSelections[nextIndex];
    if (next) select(next);
  };

  /** Shift+arrow/j/k extends the Agent range from the existing anchor. */
  const extendSelection = (delta: number): void => {
    const current = subject;
    if (current?.type !== "agent") return;
    const index = orderedAgentIds.indexOf(current.id);
    const target = orderedAgentIds[index + delta];
    if (index < 0 || target === undefined) return;
    setSelection((model) => extendAgentSelection(model, target, orderedAgentIds));
  };

  const focusSelection = (): void => {
    if (subject) issueCamera("focus", subject);
  };

  const selectedAgent =
    subject?.type === "agent" && data
      ? agentsFor(data.commandCentre).find((agent) => agent.id === subject.id)
      : undefined;

  const assignSelectedAgents = async (target: string): Promise<void> => {
    const destination = parseBatchDestination(target);
    const agentIds = selectedAgentIds(selection);
    if (!destination || agentIds.length < 2) return;
    const response = await runCommand(
      destination.kind === "inbox"
        ? { type: "UnassignAgents", agentIds }
        : destination.kind === "goal"
          ? { type: "AssignAgents", agentIds, goalId: destination.id }
          : { type: "AssignAgentsToSystem", agentIds, systemId: destination.id },
    );
    if (!response) return;
    const label =
      destination.kind === "inbox"
        ? "Inbox"
        : destination.kind === "goal"
          ? (data?.commandCentre.goals.find((goal) => goal.id === destination.id)?.title ??
            "the Goal")
          : (data?.commandCentre.systems.find((system) => system.id === destination.id)?.title ??
            "the System");
    setLaunchNotice(`Moved ${agentIds.length} agents to ${label}.`);
  };

  const switchTerminalAgent = (agent: AgentView): void => {
    setTerminalDiscovery(undefined);
    setTerminalLaunch(undefined);
    setTerminalAgent(agent);
    setSelection(onlySelection({ type: "agent", id: agent.id }));
  };

  const openAgentTerminal = (agent: AgentView): void => {
    setRecentTerminalAgentIds((current) => [agent.id, ...current.filter((id) => id !== agent.id)]);
    switchTerminalAgent(agent);
  };

  const openDiscoveredTerminal = (execution: DiscoveredExecutionView): void => {
    setTerminalAgent(undefined);
    setTerminalLaunch(undefined);
    setTerminalDiscovery(execution);
    setSelection(onlySelection({ type: "discovered-execution", id: execution.handle }));
    setInspectorOpen(true);
  };

  const openSelectedTerminal = (): void => {
    if (selectedAgent) openAgentTerminal(selectedAgent);
    else if (subject?.type === "discovered-execution") {
      const execution = data?.map.discoveredExecutions?.find(
        (candidate) => candidate.handle === subject.id,
      );
      if (execution) openDiscoveredTerminal(execution);
    }
  };

  const openWorkspaceReview = (agent: AgentView): void => {
    setDiffAgent(agent);
    setTerminalDiscovery(undefined);
    setTerminalAgent(undefined);
    setTerminalLaunch(undefined);
  };

  const recordPullRequest = useCallback((agentId: string, url: string | undefined): void => {
    setPullRequestUrls((current) => {
      if (current.get(agentId) === url) return current;
      const next = new Map(current);
      if (url) next.set(agentId, url);
      else next.delete(agentId);
      return next;
    });
  }, []);

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
      refreshInspector();
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
    const currentIndex = subject
      ? targets.findIndex(
          (candidate) => candidate.type === subject.type && candidate.id === subject.id,
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
        !closeoutAgent &&
        !terminalAgent &&
        !terminalDiscovery &&
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
        if (closeoutAgent) {
          if (!commandPending) setCloseoutAgent(undefined);
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
        if (terminalDiscovery) {
          setTerminalDiscovery(undefined);
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
        if (catchUpOpen) {
          setCatchUpOpen(false);
          return;
        }
        if (inspectorOpen) {
          // A batch collapses to its subject first; a second Escape closes the inspector.
          if (isBatchAgentSelection(selection)) {
            setSelection((current) =>
              selectAgentSet(
                current.subject?.type === "agent" ? [current.subject.id] : [],
                current.subject?.id,
              ),
            );
            return;
          }
          setInspectorOpen(false);
          setSelection(noSelection);
          return;
        }
        setSelection(noSelection);
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
        closeoutAgent ||
        terminalAgent ||
        terminalDiscovery ||
        terminalLaunch ||
        shortcutsOpen ||
        catchUpOpen
      )
        return;
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLocaleLowerCase() === "a" &&
        !isEditableTarget(event.target)
      ) {
        // Select every Agent in the current lens so a batch can be filed at once.
        event.preventDefault();
        if (orderedAgentIds.length > 0) selectAgents(orderedAgentIds);
        return;
      }
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        (event.target instanceof Element &&
          event.target.closest(
            ".workspace-tree, .navigation-attention, .workspace__toolbar, .workspace__resize, .zoom-control",
          ))
      )
        return;

      const key = event.key;
      const lowered = key.toLocaleLowerCase();
      if (event.shiftKey && (key === "ArrowDown" || lowered === "j")) {
        event.preventDefault();
        extendSelection(1);
      } else if (event.shiftKey && (key === "ArrowUp" || lowered === "k")) {
        event.preventDefault();
        extendSelection(-1);
      } else if (key === "ArrowDown" || key === "j") {
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
        if (!subject) moveSelection(1);
        else if (subject.type === "agent" || subject.type === "discovered-execution")
          openSelectedTerminal();
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
        setNavigationView((value) => (value === "attention" ? "all" : "attention"));
      } else if (key === "b") {
        event.preventDefault();
        setNavigationView((value) => (value === "unassigned" ? "all" : "unassigned"));
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
        setInspectorOpen((open) => !open);
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
    closeoutAgent,
    commandPending,
    selection,
    selectedAgent,
    setSetting,
    catchUpOpen,
    inspectorOpen,
    orderedAgentIds,
    shortcutsOpen,
    terminalAgent,
    terminalDiscovery,
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
            <p className="overline">OBSERVATORY</p>
            <h1>A live map of work in motion</h1>
          </div>
        </div>
        <nav aria-label="Portfolio controls">
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
          <b>{data.commandCentre.counts.discovered ?? 0} DISCOVERED</b>
        </div>
      </header>
      <Workspace
        revealNavigation={navigationView}
        revealInspector={subject ? `${subject.type}:${subject.id}` : undefined}
        inspectorOpen={inspectorOpen}
        onInspectorOpenChange={setInspectorOpen}
        navigation={
          <>
            <nav className="navigation-attention" aria-label="Work views">
              <button
                type="button"
                aria-pressed={navigationView === "all"}
                onClick={() => setNavigationView("all")}
              >
                <ListTree size={16} />
                <span>All work</span>
                <b>{data.commandCentre.counts.agents}</b>
              </button>
              <button
                type="button"
                aria-pressed={navigationView === "attention"}
                onClick={() =>
                  setNavigationView((value) => (value === "attention" ? "all" : "attention"))
                }
              >
                <CircleAlert size={16} />
                <span>Needs you</span>
                <b className={data.commandCentre.counts.attention > 0 ? "is-attention" : undefined}>
                  {data.commandCentre.counts.attention}
                </b>
              </button>
              <button
                type="button"
                aria-pressed={navigationView === "unassigned"}
                onClick={() => {
                  setNavigationView((value) => (value === "unassigned" ? "all" : "unassigned"));
                  setSetting("view", "atlas");
                }}
              >
                <Inbox size={16} />
                <span>Unassigned</span>
                <b>{data.commandCentre.counts.unassigned}</b>
              </button>
              <button
                type="button"
                className="navigation-attention__catchup"
                aria-haspopup="dialog"
                aria-expanded={catchUpOpen}
                onClick={() => setCatchUpOpen((open) => !open)}
              >
                <History size={16} />
                <span>{data.catchUp.pending ? "Catch up" : "Caught up"}</span>
                <b className={data.catchUp.pending ? "is-attention" : undefined}>
                  {data.catchUp.subjects.length}
                </b>
              </button>
            </nav>
            <WorkspaceNavigation
              view={navigationView}
              projection={data.commandCentre}
              systemId={selectedSystemId}
              selection={selection}
              onSelect={selectAndFocus}
              onSelectAgent={selectAgent}
              onSystem={(id) => {
                setSelectedSystemId(id);
                setSelection(noSelection);
                setCameraCommand(undefined);
                setSetting("view", "atlas");
              }}
            />
          </>
        }
        inspector={
          <>
            {subject ? (
              <Inspector
                batchAgentIds={isBatchAgentSelection(selection) ? selectedAgentIds(selection) : []}
                commandCentre={data.commandCentre}
                commandError={commandError}
                commandPending={commandPending}
                error={inspectorError}
                onClearSelection={() => setSelection(noSelection)}
                onAssignSelected={assignSelectedAgents}
                onClose={() => {
                  setSelection(noSelection);
                  setInspectorOpen(false);
                }}
                onCommand={runCommand}
                onCloseAndArchive={runCloseout}
                projection={inspector}
                onOpenTerminal={openAgentTerminal}
                onOpenDiscoveredTerminal={openDiscoveredTerminal}
                onAdmitDiscovered={admitSelectedDiscovery}
                onPullRequestChange={recordPullRequest}
                onRetry={refreshInspector}
                onReviewChanges={openWorkspaceReview}
                onResume={resumeAgent}
              />
            ) : null}

            {!subject ? (
              <aside className="inspector workspace-summary" aria-label="System overview">
                <header>
                  <div>
                    <p className="overline">Overview</p>
                    <h2>
                      {data.commandCentre.systems.find((system) => system.id === selectedSystemId)
                        ?.title ?? "All systems"}
                    </h2>
                  </div>
                </header>
                <div className="workspace-summary__body">
                  <p>
                    {data.commandCentre.systems.find((system) => system.id === selectedSystemId)
                      ?.description ?? "Select a goal or agent to see its details and actions."}
                  </p>

                  {selectedSystemId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSystem(
                          data.commandCentre.systems.find(
                            (system) => system.id === selectedSystemId,
                          ),
                        );
                        setSystemDialogOpen(true);
                      }}
                    >
                      Edit system
                    </button>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </>
        }
      >
        {(focusControl) => (
          <section className="work-surface">
            {portfolio.error ? (
              <div className="refresh-error">
                {portfolio.error} · showing last trusted projection
              </div>
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
                setTerminalDiscovery(undefined);
                setTerminalAgent(undefined);
                setTerminalLaunch(launch);
              }}
            />
            {view === "atlas" &&
            !selectedSystemId &&
            (data.commandCentre.discoveredExecutions?.length ?? 0) === 0 &&
            data.commandCentre.counts.agents === 0 ? (
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
                key={selectedSystemId}
                cameraCommand={cameraCommand}
                additionalControls={focusControl}
                onCloseAndArchive={(agent) => {
                  setCommandError(undefined);
                  setCloseoutAgent(agent);
                }}
                onFocusSelection={followFocus}
                onMoveGoal={async (goalId, position) => {
                  await runCommand({ type: "SetGoalMapPosition", goalId, position });
                }}
                onSelect={select}
                onSelectAgent={selectAgent}
                onSelectAgents={selectAgents}
                onOpenTerminal={openAgentTerminal}
                onOpenDiscoveredTerminal={openDiscoveredTerminal}
                onReviewChanges={openWorkspaceReview}
                onClearSelection={() => {
                  setSelection(noSelection);
                }}
                projection={scopedMap}
                pullRequestUrls={pullRequestUrls}
                reservedLeft={0}
                reservedRight={0}
                selection={selection}
                theme={theme}
                motion={motion}
              />
            ) : (
              <Ledger
                onSelect={select}
                onSelectAgent={selectAgent}
                projection={scopedCommandCentre ?? data.commandCentre}
                selection={selection}
              />
            )}
            {isBatchAgentSelection(selection) ? (
              <p className="selection-chip" aria-live="polite">
                <strong>{selectedAgentIds(selection).length} agents selected</strong>
                <button onClick={() => setSelection(noSelection)} type="button">
                  Clear
                </button>
              </p>
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
        )}
      </Workspace>
      {catchUpOpen ? (
        <ModalDialog
          className="modal-backdrop workspace-task-modal"
          ariaLabel="Catch up"
          onClose={() => setCatchUpOpen(false)}
        >
          <CatchUpPanel
            onAcknowledge={async () => {
              const response = await runCommand({
                type: "AcknowledgeCatchUp",
                throughSequence: data.catchUp.throughSequence,
                evidenceThroughSequence: data.catchUp.evidenceThroughSequence,
              });
              if (response) setCatchUpOpen(false);
            }}
            onClose={() => setCatchUpOpen(false)}
            onOpenInbox={() => {
              setSelection(noSelection);
              setCatchUpOpen(false);
              setNavigationView("unassigned");
            }}
            onSelectSystem={(systemId) => {
              setSelectedSystemId(systemId);
              setSetting("view", "atlas");
              setSelection(noSelection);
              setCatchUpOpen(false);
            }}
            onSelect={(next) => {
              setCatchUpOpen(false);
              selectAndFocus(next);
            }}
            pending={commandPending}
            projection={data.catchUp}
          />
        </ModalDialog>
      ) : null}
      {shortcutsOpen ? <KeyboardGuide onClose={() => setShortcutsOpen(false)} /> : null}
      {closeoutAgent ? (
        <CloseAgentDialog
          agent={closeoutAgent}
          error={commandError}
          onCancel={() => {
            if (!commandPending) {
              setCloseoutAgent(undefined);
              setCommandError(undefined);
            }
          }}
          onConfirm={async () => {
            const closedAgentId = closeoutAgent.id;
            if (!(await runCloseout([closedAgentId]))) return;
            setCloseoutAgent(undefined);
            if (subject?.type === "agent" && subject.id === closedAgentId) {
              setSelection(noSelection);
              setInspectorOpen(false);
            }
            if (terminalAgent?.id === closedAgentId) setTerminalAgent(undefined);
          }}
          pending={commandPending}
        />
      ) : null}
      {diffAgent ? (
        <WorkspaceReview
          agent={diffAgent}
          key={diffAgent.id}
          onClose={() => setDiffAgent(undefined)}
          onTerminalAppearanceChange={(appearance) => setSetting("terminalAppearance", appearance)}
          terminalAppearance={terminalAppearance}
          theme={theme}
        />
      ) : null}
      {terminalAgent || terminalDiscovery ? (
        <TerminalDeck
          agent={
            terminalAgent
              ? (terminalAgents.find((agent) => agent.id === terminalAgent.id) ?? terminalAgent)
              : terminalDiscovery!
          }
          agents={terminalAgents}
          onClose={() => {
            setTerminalAgent(undefined);
            setTerminalDiscovery(undefined);
          }}
          onSwitchAgent={switchTerminalAgent}
          onTerminalAppearanceChange={(appearance) => setSetting("terminalAppearance", appearance)}
          terminalAppearance={terminalAppearance}
          theme={theme}
        />
      ) : null}
      {terminalLaunch ? (
        <PendingLaunchTerminal
          key={terminalLaunch.requestId}
          launch={terminalLaunch}
          onClose={() => setTerminalLaunch(undefined)}
          theme={terminalTheme}
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
            if (command.type === "CreateGoal") setSelectedSystemId(response.result.systemId);
            setSelection(onlySelection({ type: "goal", id: goalId }));
          }}
          pending={commandPending}
          systems={data.commandCentre.systems}
          defaultSystemId={selectedSystemId ?? DEFAULT_SYSTEM_ID}
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
          defaultGoalId={subject?.type === "goal" ? subject.id : selectedAgent?.primaryGoalId}
          defaultSystemId={
            subject?.type === "goal" || selectedAgent?.primaryGoalId
              ? undefined
              : (selectedSystemId ?? selectedAgent?.systemId)
          }
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
              setTerminalDiscovery(undefined);
              setTerminalAgent(undefined);
              setTerminalLaunch(pendingLaunch);
            } else if (response.result.agentId) {
              setSelection(onlySelection({ type: "agent", id: response.result.agentId }));
              setInspectorOpen(true);
              refreshInspector();
            } else if (response.result.goalId) {
              setSelection(onlySelection({ type: "goal", id: response.result.goalId }));
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
            refreshInspector();
          }}
          onClose={() => setConversationHistoryOpen(false)}
          onRefresh={refreshConversationHistory}
          pending={commandPending}
          systems={data.commandCentre.systems}
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
            setSelectedSystemId(systemScope);
            const action = searchResultAction(result, data.map);
            if (action === "focus") selectAndFocus(next);
            else {
              setSetting("view", "atlas");
              setSelection(onlySelection(next));
              if (action === "inbox") setNavigationView("unassigned");
              setInspectorOpen(true);
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
