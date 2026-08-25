import {
  agents,
  goalFor,
  goals,
  needsAttention,
  stateFor,
  type AgentFixture,
  type ChangeKind,
  type Moment,
} from "./data";

const changeLabels: Readonly<Record<ChangeKind, string>> = {
  new: "New",
  changed: "Changed",
  finished: "Finished",
  stale: "Stale",
  recovered: "Recovered",
  none: "",
};

interface PortfolioLedgerProps {
  readonly moment: Moment;
  readonly selectedId: string;
  readonly catchUp: boolean;
  readonly onSelect: (id: string) => void;
}

export const PortfolioLedger = ({
  moment,
  selectedId,
  catchUp,
  onSelect,
}: PortfolioLedgerProps): React.JSX.Element => (
  <section className="portfolio-ledger" aria-label="Same-data portfolio ledger">
    <header className="portfolio-ledger__header">
      <div>
        <p className="overline">SAME DATA / STRONG LIST BASELINE</p>
        <h2>Work arranged for scanning</h2>
        <p>
          The ledger optimises for rapid finding. The Atlas must earn its place through orientation,
          context and return memory.
        </p>
      </div>
      <dl>
        <div>
          <dt>Needs judgment</dt>
          <dd>{agents.filter((agent) => needsAttention(agent, moment)).length}</dd>
        </div>
        <div>
          <dt>Changed</dt>
          <dd>
            {
              agents.filter(
                (agent) => agent.recentChange && agent.recentChange !== "none",
              ).length
            }
          </dd>
        </div>
        <div>
          <dt>Unassigned</dt>
          <dd>{agents.filter((agent) => agent.goalId === undefined).length}</dd>
        </div>
      </dl>
    </header>
    <div className="portfolio-ledger__grid">
      {goals.map((goal) => {
        const goalAgents = agents.filter((agent) => agent.goalId === goal.id);
        const visibleAgents = catchUp
          ? goalAgents.filter((agent) => agent.recentChange && agent.recentChange !== "none")
          : goalAgents;
        return (
          <article
            className={`ledger-goal ledger-goal--${goal.lifecycle ?? "active"}`}
            key={goal.id}
          >
            <button
              className={selectedId === `goal:${goal.id}` ? "is-active" : ""}
              onClick={() => onSelect(`goal:${goal.id}`)}
              type="button"
            >
              <span>{goal.priority}</span>
              <strong>{goal.title}</strong>
              <em>{goal.lifecycle ?? "active"}</em>
            </button>
            <div className="ledger-goal__metrics">
              <span>{goalAgents.length} agents</span>
              <span>{goalAgents.filter((agent) => needsAttention(agent, moment)).length} need you</span>
              <span>{goalAgents.filter((agent) => stateFor(agent, moment) === "unknown").length} uncertain</span>
            </div>
            <div className="ledger-agent-list">
              {visibleAgents.length === 0 ? (
                <p>No changes since 08:30</p>
              ) : (
                visibleAgents.map((agent) => {
                  const state = stateFor(agent, moment);
                  return (
                    <button
                      className={selectedId === agent.id ? "is-active" : ""}
                      key={agent.id}
                      onClick={() => onSelect(agent.id)}
                      type="button"
                    >
                      <i className={`state-mark state-mark--${state}`} />
                      <span>
                        <strong>{agent.name}</strong>
                        <small>{agent.activity}</small>
                      </span>
                      <em>{state}</em>
                      {agent.recentChange && agent.recentChange !== "none" ? (
                        <b className={`change-tag change-tag--${agent.recentChange}`}>
                          {changeLabels[agent.recentChange]}
                        </b>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </article>
        );
      })}
      <article className="ledger-goal ledger-goal--unassigned">
        <div className="ledger-goal__unassigned-title">
          <span>INBOX</span>
          <strong>Unassigned Agents</strong>
        </div>
        <div className="ledger-agent-list">
          {agents
            .filter((agent) => agent.goalId === undefined)
            .map((agent) => (
              <button key={agent.id} onClick={() => onSelect(agent.id)} type="button">
                <i className={`state-mark state-mark--${stateFor(agent, moment)}`} />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.activity}</small>
                </span>
                <em>{stateFor(agent, moment)}</em>
              </button>
            ))}
        </div>
      </article>
    </div>
  </section>
);

interface CatchUpBriefProps {
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (id: string) => void;
}

export const CatchUpBrief = ({
  active,
  onToggle,
  onSelect,
}: CatchUpBriefProps): React.JSX.Element => {
  const changed = agents.filter((agent) => agent.recentChange && agent.recentChange !== "none");
  const counts = (kind: ChangeKind): number =>
    changed.filter((agent) => agent.recentChange === kind).length;
  return (
    <aside className={`catchup-brief ${active ? "is-active" : ""}`}>
      <button
        aria-expanded={active}
        className="catchup-brief__toggle"
        onClick={onToggle}
        type="button"
      >
        <span>{active ? "Return to live field" : "Catch up since 08:30"}</span>
        <strong>{changed.length} changes</strong>
      </button>
      {active ? (
        <div className="catchup-brief__body">
          <div className="catchup-brief__summary">
            {(["new", "changed", "finished", "stale"] as const).map((kind) => (
              <span key={kind}>
                <b>{counts(kind)}</b> {changeLabels[kind]}
              </span>
            ))}
          </div>
          <div className="catchup-brief__signals">
            {changed.slice(0, 5).map((agent) => (
              <button key={agent.id} onClick={() => onSelect(agent.id)} type="button">
                <span>{changeLabels[agent.recentChange ?? "none"]}</span>
                <strong>{agent.name}</strong>
                <small>{goalFor(agent)?.title ?? "Unassigned"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
};

interface UnassignedInboxProps {
  readonly moment: Moment;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export const UnassignedInbox = ({
  moment,
  selectedId,
  onSelect,
}: UnassignedInboxProps): React.JSX.Element => {
  const unassigned = agents.filter((agent) => agent.goalId === undefined);
  return (
    <aside className="unassigned-inbox">
      <div>
        <p className="overline">UNASSIGNED INBOX</p>
        <strong>{unassigned.length} Agents without an accepted Goal</strong>
      </div>
      <div className="unassigned-inbox__agents">
        {unassigned.map((agent) => (
          <button
            aria-label={`${agent.name}, ${stateFor(agent, moment)}, unassigned`}
            className={selectedId === agent.id ? "is-active" : ""}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            title={`${agent.name} · ${stateFor(agent, moment)}`}
            type="button"
          >
            {agent.name.slice(0, 1)}
          </button>
        ))}
      </div>
    </aside>
  );
};

interface AgentWorkbenchProps {
  readonly agent: AgentFixture;
  readonly moment: Moment;
  readonly onClose: () => void;
}

export const AgentWorkbench = ({
  agent,
  moment,
  onClose,
}: AgentWorkbenchProps): React.JSX.Element => {
  const goal = goalFor(agent);
  return (
    <section className="agent-workbench" aria-label={`${agent.name} work surface`}>
      <header>
        <button autoFocus onClick={onClose} type="button">
          ← Return to Atlas
        </button>
        <div>
          <p className="overline">LINKED WORK SURFACE / READ-ONLY FIXTURE</p>
          <h2>{agent.name}</h2>
        </div>
        <div className="agent-workbench__identity">
          <span className={`state-mark state-mark--${stateFor(agent, moment)}`} />
          {stateFor(agent, moment)} · {goal?.title ?? "Unassigned"}
        </div>
      </header>
      <div className="agent-workbench__grid">
        <article className="workbench-terminal">
          <div className="workbench-pane-title">
            <span>TERMINAL / PTY COMPOSITION PROOF</span>
            <b>HERDR ATTACH TARGET</b>
          </div>
          <pre>
            <code>{`$ herdr agent focus ${agent.id}\n\n${agent.name}: ${agent.activity}\n\nEvidence checked:\n  ✓ projection snapshot loaded\n  ✓ branch ${agent.branch}\n  ✓ host observation current\n\nNext action:\n  review the proposed change and decide whether to continue\n\n› waiting for operator input`}</code>
          </pre>
        </article>
        <article className="workbench-diff">
          <div className="workbench-pane-title">
            <span>PROPOSED CHANGE</span>
            <b>3 FILES · +28 −9</b>
          </div>
          <pre>
            <code>{`@@ projection/${agent.repository}.ts\n- status: inferred\n+ status: observed\n+ observedAt: snapshot.capturedAt\n\n@@ evidence/decision.md\n+ Preserve uncertainty until the operator\n+ explicitly accepts the proposal.`}</code>
          </pre>
          <div className="workbench-evidence">
            <p className="overline">RESULT EVIDENCE</p>
            <h3>Checks completed with one decision outstanding</h3>
            <p>
              The simulated work surface keeps execution, evidence and the operator decision beside
              each other without turning the Atlas into a terminal multiplexer.
            </p>
            <div>
              <button type="button">Review decision</button>
              <button type="button">Keep observing</button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
};
