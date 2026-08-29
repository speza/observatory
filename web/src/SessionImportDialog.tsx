import { useMemo, useState } from "react";
import type { RecoveredSessionView } from "../../src/provider-sessions/types.ts";
import type { GoalView } from "../../src/projection/types.ts";
import { ModalDialog } from "./ModalDialog.tsx";

interface SessionImportDialogProps {
  readonly sessions: readonly RecoveredSessionView[];
  readonly goals: readonly GoalView[];
  readonly pending: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onImport: (
    handle: string,
    goalId?: string,
    resume?: boolean,
  ) => Promise<{ readonly agentId: string } | undefined>;
  readonly onImported: (agentId: string) => void;
}

type SessionFilter =
  | "all"
  | "running"
  | "possibly-running"
  | "resumable"
  | "unavailable"
  | "import-only";

const isSessionFilter = (value: string): value is SessionFilter =>
  ["all", "running", "possibly-running", "resumable", "unavailable", "import-only"].includes(value);

const stateFor = (session: RecoveredSessionView): Exclude<SessionFilter, "all"> => {
  if (session.executionState === "exact-live") return "running";
  if (session.executionState === "possibly-live") return "possibly-running";
  if (session.executionState === "unknown") return "unavailable";
  return session.workspaceRef &&
    ["same-site", "provider-account"].includes(session.resumeEligibility)
    ? "resumable"
    : "import-only";
};

const stateLabel = (state: Exclude<SessionFilter, "all">): string =>
  ({
    running: "Running · exact match",
    "possibly-running": "Possibly running",
    resumable: "Dormant · resumable",
    unavailable: "Host state unknown",
    "import-only": "Import only",
  })[state];

const lastActiveLabel = (value: number | undefined): string =>
  value === undefined ? "Activity unknown" : new Date(value).toLocaleString();

export const SessionImportDialog = ({
  sessions,
  goals,
  pending,
  error,
  onClose,
  onRefresh,
  onImport,
  onImported,
}: SessionImportDialogProps): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [workspace, setWorkspace] = useState("all");
  const [state, setState] = useState<SessionFilter>("all");
  const [goalId, setGoalId] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();

  const providers = useMemo(
    () => [...new Set(sessions.map((session) => session.providerLabel))].sort(),
    [sessions],
  );
  const workspaces = useMemo(
    () =>
      [
        ...new Set(
          sessions.flatMap((session) => (session.workspaceRef ? [session.workspaceRef] : [])),
        ),
      ].sort(),
    [sessions],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sessions.filter((session) => {
      const sessionState = stateFor(session);
      return (
        (provider === "all" || session.providerLabel === provider) &&
        (workspace === "all" || session.workspaceRef === workspace) &&
        (state === "all" || sessionState === state) &&
        (!needle ||
          [session.title, session.providerLabel, session.workspaceRef]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(needle)))
      );
    });
  }, [provider, query, sessions, state, workspace]);
  const filteredHandles = filtered.map((session) => session.handle);
  const allFilteredSelected =
    filteredHandles.length > 0 && filteredHandles.every((handle) => selected.includes(handle));

  const performImport = async (
    session: RecoveredSessionView,
    selectedGoalId?: string,
    resume = false,
    revealInAtlas = true,
  ): Promise<boolean> => {
    const result = await onImport(session.handle, selectedGoalId, resume);
    if (!result) return false;
    setSelected((current) => current.filter((handle) => handle !== session.handle));
    setNotice(
      resume
        ? `${session.title} added to its Goal and resumed.`
        : selectedGoalId
          ? `${session.title} added to its Goal.`
          : `${session.title} imported without a Goal. Find it in Inbox.`,
    );
    if (selectedGoalId && revealInAtlas) onImported(result.agentId);
    return true;
  };

  const performBulkImport = async (selectedGoalId?: string): Promise<void> => {
    const chosen = sessions.filter((session) => selected.includes(session.handle));
    const imported = await chosen.reduce(
      (result, session) =>
        result.then(async (count) =>
          (await performImport(session, selectedGoalId, false, false)) ? count + 1 : count,
        ),
      Promise.resolve(0),
    );
    if (imported > 0)
      setNotice(
        selectedGoalId
          ? `${imported} session${imported === 1 ? "" : "s"} added to the selected Goal.`
          : `${imported} session${imported === 1 ? "" : "s"} imported without a Goal. Find ${imported === 1 ? "it" : "them"} in Inbox.`,
      );
  };

  return (
    <ModalDialog
      ariaLabelledBy="session-import-title"
      className="modal-backdrop session-import-backdrop"
      onClose={onClose}
    >
      <section className="session-import">
        <header>
          <div>
            <p className="overline">PROVIDER CONVERSATIONS</p>
            <h2 id="session-import-title">Session import</h2>
            <p>Choose a destination Goal, then add provider-owned conversations to Observatory.</p>
          </div>
          <button aria-label="Close Session import" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <div className="session-import__filters">
          <label>
            <span>Search</span>
            <input
              data-autofocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, provider or workspace"
              type="search"
              value={query}
            />
          </label>
          <label>
            <span>Provider</span>
            <select onChange={(event) => setProvider(event.target.value)} value={provider}>
              <option value="all">All providers</option>
              {providers.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Workspace</span>
            <select onChange={(event) => setWorkspace(event.target.value)} value={workspace}>
              <option value="all">All workspaces</option>
              {workspaces.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>State</span>
            <select
              onChange={(event) => {
                if (isSessionFilter(event.target.value)) setState(event.target.value);
              }}
              value={state}
            >
              <option value="all">All states</option>
              <option value="running">Running</option>
              <option value="possibly-running">Possibly running</option>
              <option value="resumable">Resumable</option>
              <option value="unavailable">Host state unknown</option>
              <option value="import-only">Import only</option>
            </select>
          </label>
          <button disabled={pending} onClick={() => void onRefresh()} type="button">
            Refresh
          </button>
        </div>

        <div className="session-import__summary">
          <button
            disabled={filteredHandles.length === 0}
            onClick={() =>
              setSelected((current) =>
                allFilteredSelected
                  ? current.filter((handle) => !filteredHandles.includes(handle))
                  : [...new Set([...current, ...filteredHandles])],
              )
            }
            type="button"
          >
            {allFilteredSelected ? "Clear filtered" : "Select filtered"}
          </button>
          <span>
            {filtered.length} shown · {selected.length} selected
          </span>
          {notice ? <strong role="status">{notice}</strong> : null}
        </div>

        <div
          className="session-import__table"
          role="table"
          aria-label="Sessions available to import"
        >
          <div className="session-import__row session-import__row--heading" role="row">
            <span />
            <span>Conversation</span>
            <span>Provider</span>
            <span>Workspace</span>
            <span>State</span>
            <span>Actions</span>
          </div>
          {filtered.length === 0 ? (
            <p className="session-import__empty">No provider sessions match these filters.</p>
          ) : (
            filtered.map((session) => {
              const sessionState = stateFor(session);
              const canResume = sessionState === "resumable";
              return (
                <article className="session-import__row" key={session.handle} role="row">
                  <input
                    aria-label={`Select ${session.title}`}
                    checked={selected.includes(session.handle)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(session.handle)
                          ? current.filter((handle) => handle !== session.handle)
                          : [...current, session.handle],
                      )
                    }
                    type="checkbox"
                  />
                  <div className="session-import__identity">
                    <strong>{session.title}</strong>
                    <small>{lastActiveLabel(session.lastActiveAt)}</small>
                  </div>
                  <span>{session.providerLabel}</span>
                  <span className="session-import__workspace">
                    {session.workspaceRef ?? "Unknown workspace"}
                  </span>
                  <span className={`session-import__state session-import__state--${sessionState}`}>
                    {stateLabel(sessionState)}
                  </span>
                  <nav aria-label={`Import actions for ${session.title}`}>
                    <button
                      disabled={pending || !goalId}
                      onClick={() => void performImport(session, goalId)}
                      type="button"
                    >
                      Add to goal
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => void performImport(session)}
                      title="Import without a Goal. The Agent will appear in Inbox."
                      type="button"
                    >
                      Import unassigned
                    </button>
                    <button
                      disabled={pending || !canResume || !goalId}
                      onClick={() => void performImport(session, goalId, true)}
                      title={
                        sessionState === "possibly-running"
                          ? "A plausible live execution must be resolved before resuming."
                          : !goalId
                            ? "Choose a destination Goal before resuming."
                            : undefined
                      }
                      type="button"
                    >
                      Add & resume
                    </button>
                  </nav>
                </article>
              );
            })
          )}
        </div>

        {error ? <p className="command-error">{error}</p> : null}
        <footer>
          <label>
            <span>Destination Goal</span>
            <select onChange={(event) => setGoalId(event.target.value)} value={goalId}>
              <option value="">Choose a Goal</option>
              {goals
                .filter((goal) => goal.status === "active")
                .map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.priority} · {goal.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={pending || selected.length === 0}
            onClick={() => void performBulkImport()}
            title="Import without a Goal. The Agents will appear in Inbox."
            type="button"
          >
            Import unassigned
          </button>
          <button
            disabled={pending || selected.length === 0 || !goalId}
            onClick={() => void performBulkImport(goalId)}
            type="button"
          >
            Add selected to goal
          </button>
        </footer>
      </section>
    </ModalDialog>
  );
};
