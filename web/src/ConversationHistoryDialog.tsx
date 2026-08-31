import { useMemo, useState } from "react";
import { AgentLogo } from "./AgentLogo.tsx";
import type { ConversationHistoryView } from "../../src/conversations/types.ts";
import type { GoalView } from "../../src/projection/types.ts";
import { ModalDialog } from "./ModalDialog.tsx";

interface ConversationHistoryDialogProps {
  readonly conversations: readonly ConversationHistoryView[];
  readonly goals: readonly GoalView[];
  readonly pending: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onAdd: (
    handle: string,
    goalId?: string,
    resume?: boolean,
  ) => Promise<{ readonly agentId: string } | undefined>;
  readonly onAdded: (agentId: string) => void;
}

type ConversationFilter = "all" | "resumable" | "dormant" | "runtime-unknown";

const isConversationFilter = (value: string): value is ConversationFilter =>
  ["all", "resumable", "dormant", "runtime-unknown"].includes(value);

const stateFor = (conversation: ConversationHistoryView): Exclude<ConversationFilter, "all"> => {
  if (
    conversation.runtimeState === "dormant" &&
    conversation.workspaceRef &&
    ["same-site", "provider-account"].includes(conversation.resumeEligibility)
  )
    return "resumable";
  return conversation.runtimeState;
};

const stateLabel = (state: Exclude<ConversationFilter, "all">): string =>
  ({
    resumable: "Dormant · resumable",
    dormant: "Dormant",
    "runtime-unknown": "Runtime unknown",
  })[state];

const lastActiveLabel = (value: number | undefined): string =>
  value === undefined ? "Activity unknown" : new Date(value).toLocaleString();

export const ConversationHistoryDialog = ({
  conversations,
  goals,
  pending,
  error,
  onClose,
  onRefresh,
  onAdd,
  onAdded,
}: ConversationHistoryDialogProps): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [workspace, setWorkspace] = useState("all");
  const [state, setState] = useState<ConversationFilter>("all");
  const [goalId, setGoalId] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();

  const providers = useMemo(
    () => [...new Set(conversations.map((conversation) => conversation.providerLabel))].sort(),
    [conversations],
  );
  const workspaces = useMemo(
    () =>
      [
        ...new Set(
          conversations.flatMap((conversation) =>
            conversation.workspaceRef ? [conversation.workspaceRef] : [],
          ),
        ),
      ].sort(),
    [conversations],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return conversations.filter((conversation) => {
      const conversationState = stateFor(conversation);
      return (
        (provider === "all" || conversation.providerLabel === provider) &&
        (workspace === "all" || conversation.workspaceRef === workspace) &&
        (state === "all" || conversationState === state) &&
        (!needle ||
          [conversation.title, conversation.providerLabel, conversation.workspaceRef]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(needle)))
      );
    });
  }, [conversations, provider, query, state, workspace]);
  const filteredHandles = filtered.map((conversation) => conversation.handle);
  const allFilteredSelected =
    filteredHandles.length > 0 && filteredHandles.every((handle) => selected.includes(handle));

  const performAdd = async (
    conversation: ConversationHistoryView,
    selectedGoalId?: string,
    resume = false,
    revealInAtlas = true,
  ): Promise<boolean> => {
    const result = await onAdd(conversation.handle, selectedGoalId, resume);
    if (!result) return false;
    setSelected((current) => current.filter((handle) => handle !== conversation.handle));
    setNotice(
      resume
        ? `${conversation.title} added to its Goal and resumed.`
        : selectedGoalId
          ? `${conversation.title} added to its Goal.`
          : `${conversation.title} added without a Goal. Find it in Inbox.`,
    );
    if (selectedGoalId && revealInAtlas) onAdded(result.agentId);
    return true;
  };

  const performBulkAdd = async (selectedGoalId?: string): Promise<void> => {
    const chosen = conversations.filter((conversation) => selected.includes(conversation.handle));
    const added = await chosen.reduce(
      (result, conversation) =>
        result.then(async (count) =>
          (await performAdd(conversation, selectedGoalId, false, false)) ? count + 1 : count,
        ),
      Promise.resolve(0),
    );
    if (added > 0)
      setNotice(
        selectedGoalId
          ? `${added} conversation${added === 1 ? "" : "s"} added to the selected Goal.`
          : `${added} conversation${added === 1 ? "" : "s"} added without a Goal. Find ${added === 1 ? "it" : "them"} in Inbox.`,
      );
  };

  return (
    <ModalDialog
      ariaLabelledBy="conversation-history-title"
      className="modal-backdrop conversation-history-backdrop"
      onClose={onClose}
    >
      <section className="conversation-history">
        <header>
          <div>
            <p className="overline">PROVIDER CONVERSATIONS</p>
            <h2 id="conversation-history-title">Conversation history</h2>
            <p>Find older dormant conversations and bring selected work into Observatory.</p>
          </div>
          <button aria-label="Close Conversation history" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <div className="conversation-history__filters">
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
                if (isConversationFilter(event.target.value)) setState(event.target.value);
              }}
              value={state}
            >
              <option value="all">All states</option>
              <option value="resumable">Resumable</option>
              <option value="dormant">Dormant</option>
              <option value="runtime-unknown">Runtime unknown</option>
            </select>
          </label>
          <button disabled={pending} onClick={() => void onRefresh()} type="button">
            Refresh
          </button>
        </div>

        <div className="conversation-history__summary">
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
          className="conversation-history__table"
          role="table"
          aria-label="Older provider conversations"
        >
          <div className="conversation-history__row conversation-history__row--heading" role="row">
            <span />
            <span>Conversation</span>
            <span>Provider</span>
            <span>Workspace</span>
            <span>State</span>
            <span>Actions</span>
          </div>
          {filtered.length === 0 ? (
            <p className="conversation-history__empty">No conversations match these filters.</p>
          ) : (
            filtered.map((conversation) => {
              const conversationState = stateFor(conversation);
              const canResume = conversationState === "resumable";
              return (
                <article className="conversation-history__row" key={conversation.handle} role="row">
                  <input
                    aria-label={`Select ${conversation.title}`}
                    checked={selected.includes(conversation.handle)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(conversation.handle)
                          ? current.filter((handle) => handle !== conversation.handle)
                          : [...current, conversation.handle],
                      )
                    }
                    type="checkbox"
                  />
                  <div className="conversation-history__identity">
                    <AgentLogo harnessId={conversation.harnessId} />
                    <strong>{conversation.title}</strong>
                    <small>{lastActiveLabel(conversation.lastActiveAt)}</small>
                  </div>
                  <span>{conversation.providerLabel}</span>
                  <span className="conversation-history__workspace">
                    {conversation.workspaceRef ?? "Unknown workspace"}
                  </span>
                  <span
                    className={`conversation-history__state conversation-history__state--${conversationState}`}
                  >
                    {stateLabel(conversationState)}
                  </span>
                  <nav aria-label={`Actions for ${conversation.title}`}>
                    <button
                      disabled={pending || !goalId}
                      onClick={() => void performAdd(conversation, goalId)}
                      type="button"
                    >
                      Add to goal
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => void performAdd(conversation)}
                      title="Add without a Goal. The Agent will appear in Inbox."
                      type="button"
                    >
                      Add unassigned
                    </button>
                    <button
                      disabled={pending || !canResume || !goalId}
                      onClick={() => void performAdd(conversation, goalId, true)}
                      title={!goalId ? "Choose a destination Goal before resuming." : undefined}
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
            onClick={() => void performBulkAdd()}
            title="Add without a Goal. The Agents will appear in Inbox."
            type="button"
          >
            Add unassigned
          </button>
          <button
            disabled={pending || selected.length === 0 || !goalId}
            onClick={() => void performBulkAdd(goalId)}
            type="button"
          >
            Add selected to goal
          </button>
        </footer>
      </section>
    </ModalDialog>
  );
};
