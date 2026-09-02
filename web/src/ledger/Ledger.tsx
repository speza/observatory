import type {
  AgentView,
  CommandCentreProjection,
  GoalView,
} from "../../../src/projection/types.ts";
import { AgentLogo } from "../shared/AgentLogo.tsx";
import { presentAgentCard } from "../atlas/agentCardPresentation.ts";
import type { Selection } from "../app/selection.ts";

interface LedgerProps {
  readonly projection: CommandCentreProjection;
  readonly onSelect: (selection: Selection) => void;
}

const AgentRow = ({
  agent,
  onSelect,
}: {
  readonly agent: AgentView;
  readonly onSelect: (selection: Selection) => void;
}): React.JSX.Element => {
  const presentation = presentAgentCard(agent);
  const state = agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth;
  return (
    <li>
      <button onClick={() => onSelect({ type: "agent", id: agent.id })} type="button">
        <span className={`state state--${state}`} />
        <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
        <span className="ledger__agent-copy">
          <b>{agent.displayName}</b>
          {presentation.detail ? <small>{presentation.detail}</small> : null}
        </span>
        <em>{state}</em>
      </button>
    </li>
  );
};

const GoalCard = ({
  goal,
  onSelect,
}: {
  readonly goal: GoalView;
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
    <ul>
      {goal.agents.map((agent) => (
        <AgentRow agent={agent} key={agent.id} onSelect={onSelect} />
      ))}
    </ul>
  </article>
);

export const Ledger = ({ projection, onSelect }: LedgerProps): React.JSX.Element => {
  const groups = projection.systems.map((system) => ({
    id: system.id,
    title: system.title,
    description: system.description,
    goals: projection.goals.filter((goal) => goal.systemId === system.id),
  }));
  const ungroupedGoals = projection.goals.filter((goal) => !goal.systemId);
  if (ungroupedGoals.length > 0)
    groups.push({
      id: "unassigned",
      title: "No system",
      description: "Goals awaiting broader organisation.",
      goals: ungroupedGoals,
    });

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
              <GoalCard goal={goal} key={goal.id} onSelect={onSelect} />
            ))}
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
              <ul>
                {projection.unassigned.map((agent) => (
                  <AgentRow agent={agent} key={agent.id} onSelect={onSelect} />
                ))}
              </ul>
            </article>
          </div>
        </section>
      ) : null}
    </section>
  );
};
