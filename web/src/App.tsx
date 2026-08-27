import { useEffect, useMemo, useRef, useState } from "react";
import type { AttentionItem } from "../../src/attention/attention.ts";
import type {
  AgentView,
  CommandCentreProjection,
  GoalView,
  InspectorProjection,
  CatchUpProjection,
} from "../../src/projection/types.ts";
import type { WebCommand, WebCommandResponse } from "../../src/web/protocol.ts";
import { executeCommand, fetchInspector } from "./api.ts";
import { Atlas, type AtlasCameraCommand, type Selection } from "./Atlas.tsx";
import { Inspector } from "./Inspector.tsx";
import { NewAgentDialog } from "./NewAgentDialog.tsx";
import { NewGoalDialog } from "./NewGoalDialog.tsx";
import { TerminalDeck } from "./TerminalDeck.tsx";
import { usePortfolio } from "./usePortfolio.ts";
import { WorkspaceReview } from "./WorkspaceReview.tsx";

type Theme = "light" | "dark";
type View = "atlas" | "ledger";
type SidePanel = "attention" | "inbox" | "catch-up" | "inspector";

const agentsFor = (projection: CommandCentreProjection): readonly AgentView[] => [
  ...projection.goals.flatMap((goal) => goal.agents),
  ...projection.unassigned,
];

const labelForAttention = (item: AttentionItem, agents: readonly AgentView[]) => {
  const agent = item.agentId
    ? agents.find((candidate) => candidate.id === item.agentId)
    : undefined;
  return {
    title: agent?.displayName ?? item.targetId,
    context: agent?.goalTitle ?? "Host observation",
  };
};

const hostLabel = (projection: CommandCentreProjection): string => {
  const host = projection.host;
  if (!host) return "NO HOST OBSERVED";
  return `${host.hostKind.toUpperCase()} / ${host.status.toUpperCase()}`;
};

interface AttentionQueueProps {
  readonly projection: CommandCentreProjection;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
}

const AttentionQueue = ({
  projection,
  onClose,
  onSelect,
}: AttentionQueueProps): React.JSX.Element => {
  const agents = agentsFor(projection);
  const current = projection.attention.items.filter((item) => item.requiresHumanInput);
  const uncertain = projection.attention.items.filter((item) => !item.requiresHumanInput);
  const section = (title: string, items: readonly AttentionItem[]): React.JSX.Element => (
    <section className="queue-section">
      <div className="queue-section__title">
        <span>{title}</span>
        <b>{items.length}</b>
      </div>
      {items.length === 0 ? <p className="queue-empty">No signals in this group.</p> : null}
      {items.map((item) => {
        const label = labelForAttention(item, agents);
        const target: Selection | undefined = item.agentId
          ? { type: "agent", id: item.agentId }
          : item.goalId
            ? { type: "goal", id: item.goalId }
            : undefined;
        return (
          <button
            className="queue-item"
            disabled={!target}
            key={item.id}
            onClick={() => {
              if (target) onSelect(target);
            }}
            type="button"
          >
            <i aria-hidden="true" />
            <span>
              <strong>{label.title}</strong>
              <small>{item.explanation}</small>
              <em>{label.context}</em>
            </span>
          </button>
        );
      })}
    </section>
  );
  return (
    <aside className="attention-queue" aria-label="Attention queue">
      <header>
        <div>
          <p className="overline">ATTENTION QUEUE</p>
          <h2>Signals requiring judgment</h2>
        </div>
        <button aria-label="Close attention queue" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="attention-queue__body">
        {section("Needs you", current)}
        {section("Uncertain", uncertain)}
      </div>
      <footer>Observed facts only · no inferred acceptance</footer>
    </aside>
  );
};

interface InboxPanelProps {
  readonly projection: CommandCentreProjection;
  readonly pending: boolean;
  readonly error?: string;
  readonly onAssign: (agentIds: readonly string[], goalId: string) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
}

const InboxPanel = ({
  projection,
  pending,
  error,
  onAssign,
  onClose,
  onSelect,
}: InboxPanelProps): React.JSX.Element => {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [goalId, setGoalId] = useState(
    projection.goals.find((goal) => goal.status === "active")?.id ?? "",
  );
  const activeGoals = useMemo(
    () => projection.goals.filter((goal) => goal.status === "active"),
    [projection.goals],
  );
  const allSelected =
    projection.unassigned.length > 0 &&
    projection.unassigned.every((agent) => selectedIds.includes(agent.id));

  useEffect(() => {
    const available = new Set(projection.unassigned.map((agent) => agent.id));
    setSelectedIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
    if (goalId && !activeGoals.some((goal) => goal.id === goalId)) {
      setGoalId(activeGoals[0]?.id ?? "");
    }
  }, [activeGoals, goalId, projection.unassigned]);

  const toggleAgent = (agentId: string): void => {
    setSelectedIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    );
  };

  const toggleAll = (): void => {
    setSelectedIds(allSelected ? [] : projection.unassigned.map((agent) => agent.id));
  };

  return (
    <aside aria-label="Unassigned inbox" className="inbox-panel">
      <header>
        <div>
          <p className="overline">INBOX / UNASSIGNED</p>
          <h2>Work awaiting a home</h2>
        </div>
        <button aria-label="Close inbox" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="inbox-panel__toolbar">
        <button onClick={toggleAll} type="button">
          {allSelected ? "Clear selection" : "Select all"}
        </button>
        <span>{selectedIds.length} selected</span>
      </div>
      <div className="inbox-panel__body">
        {projection.unassigned.length === 0 ? (
          <p className="inbox-panel__empty">No observed agents are waiting for organisation.</p>
        ) : (
          projection.unassigned.map((agent) => (
            <div className="inbox-panel__item" key={agent.id}>
              <input
                aria-label={`Select ${agent.displayName}`}
                checked={selectedIds.includes(agent.id)}
                onChange={() => toggleAgent(agent.id)}
                type="checkbox"
              />
              <button
                className="inbox-panel__agent"
                onClick={() => onSelect({ type: "agent", id: agent.id })}
                type="button"
              >
                <strong>{agent.displayName}</strong>
                <small>{agent.goalTitle ?? "Unassigned observation"}</small>
                <em>{agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth}</em>
              </button>
            </div>
          ))
        )}
      </div>
      {error ? <p className="command-error">{error}</p> : null}
      <footer className="inbox-panel__assign">
        <label>
          <span>Assign selected to</span>
          <select
            disabled={activeGoals.length === 0 || pending}
            onChange={(event) => setGoalId(event.target.value)}
            value={goalId}
          >
            <option value="">Choose a goal</option>
            {activeGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.priority} · {goal.title}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={pending || selectedIds.length === 0 || !goalId}
          onClick={() => {
            void onAssign(selectedIds, goalId).then((succeeded) => {
              if (succeeded) setSelectedIds([]);
            });
          }}
          type="button"
        >
          {pending ? "Assigning…" : `Assign ${selectedIds.length || "selected"}`}
        </button>
      </footer>
    </aside>
  );
};

interface CatchUpPanelProps {
  readonly projection: CatchUpProjection;
  readonly pending: boolean;
  readonly onAcknowledge: () => Promise<void>;
  readonly onClose: () => void;
  readonly onSelect: (selection: Selection) => void;
}

const CatchUpPanel = ({
  projection,
  pending,
  onAcknowledge,
  onClose,
  onSelect,
}: CatchUpPanelProps): React.JSX.Element => (
  <aside aria-label="Catch up" className="catch-up-panel">
    <header>
      <div>
        <p className="overline">SINCE YOUR LAST CHECKPOINT</p>
        <h2>{projection.pending ? "What changed while you were away" : "You are caught up"}</h2>
      </div>
      <button aria-label="Close catch up" onClick={onClose} type="button">
        ×
      </button>
    </header>
    {projection.groups.length > 0 ? (
      <div className="catch-up-panel__groups">
        {projection.groups.map((group) => (
          <section key={group.outcome}>
            <div className="catch-up-panel__group-title">
              <span>{group.label}</span>
              <b>{group.items.length}</b>
            </div>
            {group.items.slice(0, 5).map((item) => (
              <button
                key={item.sequence}
                onClick={() => onSelect({ type: item.targetType, id: item.targetId })}
                type="button"
              >
                <span>{item.summary}</span>
                <time>
                  {new Date(item.occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </button>
            ))}
            {group.items.length > 5 ? <p>+ {group.items.length - 5} more</p> : null}
          </section>
        ))}
      </div>
    ) : (
      <p className="catch-up-panel__empty">
        No accepted semantic changes since the last checkpoint.
      </p>
    )}
    <footer>
      <span>
        Checkpoint {projection.throughSequence} · {projection.transitionCount} accepted transitions
      </span>
      {projection.pending ? (
        <button disabled={pending} onClick={() => void onAcknowledge()} type="button">
          {pending ? "Saving…" : "Mark caught up"}
        </button>
      ) : null}
    </footer>
  </aside>
);

interface LedgerProps {
  readonly projection: CommandCentreProjection;
  readonly onSelect: (selection: Selection) => void;
}

const Ledger = ({ projection, onSelect }: LedgerProps): React.JSX.Element => (
  <section className="ledger" aria-label="Portfolio ledger">
    <header>
      <p className="overline">PORTFOLIO LEDGER</p>
      <h2>Goals and accountable agents</h2>
    </header>
    <div className="ledger__grid">
      {projection.goals.map((goal: GoalView) => (
        <article className={goal.status !== "active" ? "is-muted" : ""} key={goal.id}>
          <button onClick={() => onSelect({ type: "goal", id: goal.id })} type="button">
            <span className="ledger__priority">{goal.priority}</span>
            <strong>{goal.title}</strong>
            <small>
              {goal.agents.length} agents · {goal.attentionCount} attention · {goal.staleCount}{" "}
              uncertain
            </small>
          </button>
          <ul>
            {goal.agents.map((agent) => (
              <li key={agent.id}>
                <button onClick={() => onSelect({ type: "agent", id: agent.id })} type="button">
                  <span
                    className={`state state--${agent.hostHealth === "live" ? agent.runtimeState : "unknown"}`}
                  />
                  <b>{agent.displayName}</b>
                  <em>{agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth}</em>
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
      {projection.unassigned.length > 0 ? (
        <article className="ledger__unassigned">
          <div className="ledger__unassigned-heading">
            <span className="ledger__priority">INBOX</span>
            <strong>Unassigned agents</strong>
            <small>{projection.unassigned.length} observations awaiting human organisation</small>
          </div>
          <ul>
            {projection.unassigned.map((agent) => (
              <li key={agent.id}>
                <button onClick={() => onSelect({ type: "agent", id: agent.id })} type="button">
                  <span
                    className={`state state--${agent.hostHealth === "live" ? agent.runtimeState : "unknown"}`}
                  />
                  <b>{agent.displayName}</b>
                  <em>{agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth}</em>
                </button>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </div>
  </section>
);

interface KeyboardGuideProps {
  readonly onClose: () => void;
}

const KeyboardGuide = ({ onClose }: KeyboardGuideProps): React.JSX.Element => (
  <aside aria-label="Keyboard shortcuts" className="keyboard-guide">
    <header>
      <div>
        <p className="overline">FIELD CONTROLS</p>
        <h2>Move through the work</h2>
      </div>
      <button aria-label="Close keyboard shortcuts" onClick={onClose} type="button">
        ×
      </button>
    </header>
    <dl>
      <div>
        <dt>↑ ↓ / j k</dt>
        <dd>Select the next goal or agent</dd>
      </div>
      <div>
        <dt>Enter / Space</dt>
        <dd>Focus the selection or open its terminal</dd>
      </div>
      <div>
        <dt>Double-click</dt>
        <dd>Focus a map item directly</dd>
      </div>
      <div>
        <dt>Drag / wheel</dt>
        <dd>Pan and zoom the atlas</dd>
      </div>
      <div>
        <dt>+ − / 0</dt>
        <dd>Zoom in, zoom out, or reset the map</dd>
      </div>
      <div>
        <dt>f</dt>
        <dd>Focus the current selection</dd>
      </div>
      <div>
        <dt>a / b / v / n / N</dt>
        <dd>Attention, inbox, view, new goal, new agent</dd>
      </div>
      <div>
        <dt>i / ? / Esc</dt>
        <dd>Inspector, shortcuts, close or clear</dd>
      </div>
      <div>
        <dt>⌘/Ctrl+Tab / 1–9</dt>
        <dd>Switch terminal tabs when a terminal deck is open</dd>
      </div>
    </dl>
  </aside>
);

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
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [launchNotice, setLaunchNotice] = useState<string>();

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
            onSelect={select}
            onClearSelection={() => {
              setSelection(undefined);
              setSidePanel(undefined);
            }}
            projection={data.map}
            reservedLeft={sidePanel === "attention" || sidePanel === "inbox" ? 390 : 0}
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
        {shortcutsOpen ? <KeyboardGuide onClose={() => setShortcutsOpen(false)} /> : null}
        {selection && sidePanel === "inspector" && !terminalAgent ? (
          <Inspector
            commandCentre={data.commandCentre}
            commandError={commandError}
            commandPending={commandPending}
            error={inspectorError}
            onClose={() => setSidePanel(undefined)}
            onCommand={runCommand}
            projection={inspector}
            onOpenTerminal={setTerminalAgent}
            onRetry={() => setInspectorRevision((value) => value + 1)}
            onReviewChanges={openWorkspaceReview}
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
    </main>
  );
};
