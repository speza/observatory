import {
  agents,
  goalFor,
  needsAttention,
  stateFor,
  type AgentFixture,
  type GoalFixture,
  type Moment,
} from "./data";

interface EntityPanelProps {
  readonly agent?: AgentFixture;
  readonly goal?: GoalFixture;
  readonly moment: Moment;
  readonly onClose: () => void;
  readonly onSelect: (id: string) => void;
  readonly onOpenAgent: (agent: AgentFixture) => void;
}

export const EntityPanel = ({
  agent,
  goal,
  moment,
  onClose,
  onSelect,
  onOpenAgent,
}: EntityPanelProps): React.JSX.Element => {
  const agentGoal = agent ? goalFor(agent) : undefined;
  const parent = agent?.parentId ? agents.find((item) => item.id === agent.parentId) : undefined;
  const children = agent ? agents.filter((item) => item.parentId === agent.id) : [];

  if (!agent && !goal) {
    return (
      <aside className="entity-panel entity-panel--floating entity-panel--empty">
        <p className="overline">NO SELECTION</p>
        <h2>Choose a signal</h2>
        <p className="entity-panel__lede">
          Select a Goal or Agent to reveal its intent, state, relationships and next action.
        </p>
      </aside>
    );
  }

  if (goal) {
    const goalAgents = agents.filter((item) => item.goalId === goal.id);
    const attention = goalAgents.filter((item) => needsAttention(item, moment));
    return (
      <aside className="entity-panel entity-panel--floating entity-panel--goal">
        <button
          aria-label="Close field note"
          className="entity-panel__close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        <div className="entity-panel__signal" style={{ background: goal.glow }} />
        <p className="overline">FIELD NOTE / GOAL {goal.priority}</p>
        <h2>{goal.title}</h2>
        <div className="entity-panel__state">{goal.lifecycle ?? "active"} · human controlled</div>
        <p className="entity-panel__lede">{goal.description}</p>
        <div className="entity-panel__stats">
          <div>
            <strong>{goalAgents.length}</strong>
            <span>Agents</span>
          </div>
          <div>
            <strong>{attention.length}</strong>
            <span>Attention</span>
          </div>
          <div>
            <strong>
              {goalAgents.filter((item) => stateFor(item, moment) === "working").length}
            </strong>
            <span>Working</span>
          </div>
        </div>
        <div className="entity-panel__roster">
          {goalAgents.map((item) => (
            <button key={item.id} onClick={() => onSelect(item.id)} type="button">
              <i className={`state-mark state-mark--${stateFor(item, moment)}`} />
              {item.name}
              <span>{stateFor(item, moment)}</span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  const selectedAgent = agent!;
  const state = stateFor(selectedAgent, moment);
  return (
    <aside className="entity-panel entity-panel--floating">
      <button
        aria-label="Close Agent inspector"
        className="entity-panel__close"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
      <div className="entity-panel__signal" style={{ background: selectedAgent.colour }} />
      <p className="overline">AGENT / {selectedAgent.role.toUpperCase()}</p>
      <h2>{selectedAgent.name}</h2>
      <div className="entity-panel__state">
        <span className={`state-mark state-mark--${state}`} />
        {state}
        <span>·</span>
        {state === "unknown"
          ? `observed ${selectedAgent.observedMinutesAgo ?? 31}m ago`
          : "observed now"}
      </div>
      {selectedAgent.recentChange && selectedAgent.recentChange !== "none" ? (
        <div className={`inspector-change inspector-change--${selectedAgent.recentChange}`}>
          <span>CHANGED SINCE 08:30</span>
          <strong>{selectedAgent.recentChange}</strong>
        </div>
      ) : null}
      {needsAttention(selectedAgent, moment) ? (
        <div className="attention-callout">
          <span>HUMAN JUDGMENT</span>
          <p>{selectedAgent.attention}</p>
          <div className="attention-actions">
            <button type="button">Review</button>
            <button type="button">Dismiss</button>
          </div>
        </div>
      ) : null}
      <p className="entity-panel__lede">{selectedAgent.activity}</p>
      {parent || children.length > 0 ? (
        <div className="relationship-row">
          <span>DELEGATION</span>
          {parent ? (
            <b>
              {parent.name} → {selectedAgent.name}
            </b>
          ) : null}
          {children.map((child) => (
            <b key={child.id}>
              {selectedAgent.name} → {child.name}
            </b>
          ))}
        </div>
      ) : null}
      <dl>
        <div>
          <dt>Goal</dt>
          <dd>{agentGoal?.title ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt>Repository</dt>
          <dd>{selectedAgent.repository}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{selectedAgent.branch}</dd>
        </div>
      </dl>
      <button className="open-agent" onClick={() => onOpenAgent(selectedAgent)} type="button">
        Open work surface <span>→</span>
      </button>
    </aside>
  );
};

interface AttentionListProps {
  readonly moment: Moment;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export const AttentionList = ({
  moment,
  selectedId,
  onSelect,
}: AttentionListProps): React.JSX.Element => {
  const assigned = agents.filter((agent) => agent.goalId !== undefined);
  const attention = assigned.filter((agent) => needsAttention(agent, moment));
  const stale = assigned.filter((agent) => stateFor(agent, moment) === "unknown");
  return (
    <div className="attention-list">
      <p className="rail-heading">
        <span>Needs you</span>
        <b>{attention.length}</b>
      </p>
      {attention.map((agent) => (
        <button
          className={selectedId === agent.id ? "is-active" : ""}
          key={agent.id}
          onClick={() => onSelect(agent.id)}
          type="button"
        >
          <i className="attention-list__glyph" style={{ borderColor: agent.colour }} />
          <span>
            <strong>{agent.name}</strong>
            <small>{agent.attention}</small>
          </span>
          <em>{goalFor(agent)?.title}</em>
        </button>
      ))}
      <p className="rail-heading rail-heading--secondary">
        <span>Uncertain</span>
        <b>{stale.length}</b>
      </p>
      {stale.map((agent) => (
        <button
          className={selectedId === agent.id ? "is-active" : ""}
          key={agent.id}
          onClick={() => onSelect(agent.id)}
          type="button"
        >
          <i className="attention-list__glyph attention-list__glyph--stale" />
          <span>
            <strong>{agent.name}</strong>
            <small>{agent.activity}</small>
          </span>
          <em>{goalFor(agent)?.title}</em>
        </button>
      ))}
    </div>
  );
};
