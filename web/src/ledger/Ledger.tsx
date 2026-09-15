import type {
  AgentView,
  CommandCentreProjection,
  DiscoveredExecutionView,
  GoalView,
} from "../../../src/projection/types.ts";
import { AgentLogo } from "../shared/AgentLogo.tsx";
import { presentExecution } from "../shared/executionPresentation.ts";
import { presentAgentCard } from "../atlas/agentCardPresentation.ts";
import { flattenAgentOrder } from "../app/navigatorAgents.ts";
import {
  selectionIntent,
  type AgentSelectionHandler,
  type Selection,
  type SelectionModel,
} from "../app/selection.ts";

interface LedgerProps {
  readonly projection: CommandCentreProjection;
  readonly selection?: SelectionModel;
  readonly onSelect: (selection: Selection) => void;
  readonly onSelectAgent?: AgentSelectionHandler;
}

interface LedgerAgentRowProps {
  readonly agent: AgentView;
  readonly selected: boolean;
  readonly subject: boolean;
  readonly order: readonly string[];
  readonly onSelect: (selection: Selection) => void;
  readonly onSelectAgent?: AgentSelectionHandler;
}

const AgentRow = ({
  agent,
  selected,
  subject,
  order,
  onSelect,
  onSelectAgent,
}: LedgerAgentRowProps): React.JSX.Element => {
  const presentation = presentAgentCard(agent);
  const state = agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth;
  return (
    <li>
      <button
        aria-current={subject ? "true" : undefined}
        aria-pressed={selected}
        className={selected ? "is-selected" : undefined}
        onClick={(event) => {
          const intent = selectionIntent(event);
          if ((intent.additive || intent.range) && onSelectAgent) {
            event.preventDefault();
            onSelectAgent(agent.id, intent, order);
            return;
          }
          onSelect({ type: "agent", id: agent.id });
        }}
        type="button"
      >
        <span className={`state state--${state}`} />
        <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
        <span className="ledger__agent-copy">
          <b>{presentation.titleLines.join(" ")}</b>
          {presentation.detail ? <small>{presentation.detail}</small> : null}
          {presentation.secondaryContext &&
          presentation.secondaryContext !== presentation.detail ? (
            <small className="ledger__agent-context">{presentation.secondaryContext}</small>
          ) : null}
        </span>
        <em>{state}</em>
      </button>
    </li>
  );
};

const GoalCard = ({
  goal,
  agentRow,
  onSelect,
}: {
  readonly goal: GoalView;
  readonly agentRow: (agent: AgentView) => React.JSX.Element;
  readonly onSelect: (selection: Selection) => void;
}): React.JSX.Element => (
  <article className={goal.status !== "active" ? "is-muted" : ""}>
    <button onClick={() => onSelect({ type: "goal", id: goal.id })} type="button">
      <span className="ledger__priority">{goal.priority}</span>
      <strong>{goal.title}</strong>
      <small>
        {goal.agents.length} agents · {goal.attentionCount} need you · {goal.staleCount} monitor
      </small>
    </button>
    <ul>{goal.agents.map(agentRow)}</ul>
  </article>
);

const DiscoveredRow = ({
  execution,
  onSelect,
}: {
  readonly execution: DiscoveredExecutionView;
  readonly onSelect: (selection: Selection) => void;
}): React.JSX.Element => {
  const state = execution.presence === "live" ? execution.runtimeState : "unknown";
  const stateLabel = execution.presence === "live" ? state : "runtime unknown";
  const { primaryLabel, secondaryContext } = presentExecution(execution);
  return (
    <li>
      <button
        aria-label={`${primaryLabel}${secondaryContext ? `, ${secondaryContext}` : ""}, ${stateLabel}, discovered in ${execution.hostKind}`}
        onClick={() => onSelect({ type: "discovered-execution", id: execution.handle })}
        type="button"
      >
        <span className={`state state--${state}`} />
        <AgentLogo provider={execution.provider} />
        <span className="ledger__agent-copy">
          <b>{primaryLabel}</b>
          <small>
            {secondaryContext || execution.worktree || execution.repository || "Workspace unknown"}{" "}
            · {execution.hostKind}
          </small>
        </span>
        <em>{stateLabel}</em>
      </button>
    </li>
  );
};

export const Ledger = ({
  projection,
  selection,
  onSelect,
  onSelectAgent,
}: LedgerProps): React.JSX.Element => {
  const groups = projection.systems.map((system) => ({
    id: system.id,
    title: system.title,
    description: system.description,
    agents: system.agents,
    goals: projection.goals.filter((goal) => goal.systemId === system.id),
  }));
  const subject = selection?.subject;
  const selectedAgentIds = selection?.agentIds ?? new Set<string>();
  /** Range selection follows the order the operator can actually see here. */
  const order = flattenAgentOrder(groups, projection.unassigned).map((agent) => agent.id);
  const agentRow = (agent: AgentView): React.JSX.Element => (
    <AgentRow
      agent={agent}
      key={agent.id}
      order={order}
      selected={selectedAgentIds.has(agent.id)}
      subject={subject?.type === "agent" && subject.id === agent.id}
      onSelect={onSelect}
      onSelectAgent={onSelectAgent}
    />
  );
  return (
    <section className="ledger" aria-label="Systems, goals, and agents ledger">
      <header>
        <p className="overline">SYSTEM LEDGER</p>
        <h2>Systems, goals, and accountable agents</h2>
      </header>
      {groups.map((group) => (
        <section className="ledger__system" key={group.id}>
          <header>
            <p className="overline">SYSTEM</p>
            <h3>{group.title}</h3>
            {group.description ? <p>{group.description}</p> : null}
          </header>
          <div className="ledger__grid">
            {group.goals.map((goal) => (
              <GoalCard agentRow={agentRow} goal={goal} key={goal.id} onSelect={onSelect} />
            ))}
            {group.agents.length > 0 ? (
              <article className="ledger__unassigned">
                <div className="ledger__unassigned-heading">
                  <span className="ledger__priority">SYSTEM</span>
                  <strong>Agents without a Goal</strong>
                  <small>{group.agents.length} direct System assignments</small>
                </div>
                <ul>{group.agents.map(agentRow)}</ul>
              </article>
            ) : null}
          </div>
        </section>
      ))}
      {projection.unassigned.length > 0 ? (
        <section className="ledger__system">
          <header>
            <p className="overline">INBOX</p>
            <h3>Unassigned agents</h3>
          </header>
          <div className="ledger__grid">
            <article className="ledger__unassigned">
              <div className="ledger__unassigned-heading">
                <span className="ledger__priority">INBOX</span>
                <strong>Unassigned agents</strong>
                <small>
                  {projection.unassigned.length} observations awaiting human organisation
                </small>
              </div>
              <ul>{projection.unassigned.map(agentRow)}</ul>
            </article>
          </div>
        </section>
      ) : null}
      {(projection.discoveredExecutions?.length ?? 0) > 0 ? (
        <section className="ledger__system">
          <header>
            <p className="overline">DISCOVERED IN HERDR</p>
            <h3>Unassigned host executions</h3>
            <p>
              {projection.discoveredExecutions?.length} discovered executions · not durable Agents
            </p>
          </header>
          <div className="ledger__grid">
            <article className="ledger__unassigned">
              <div className="ledger__unassigned-heading">
                <span className="ledger__priority">HOST</span>
                <strong>Discovered in Herdr</strong>
                <small>Admission stays explicit; terminal access remains independent.</small>
              </div>
              <ul>
                {projection.discoveredExecutions?.map((execution) => (
                  <DiscoveredRow execution={execution} key={execution.handle} onSelect={onSelect} />
                ))}
              </ul>
            </article>
          </div>
        </section>
      ) : null}
    </section>
  );
};
