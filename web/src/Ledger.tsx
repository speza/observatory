import type { CommandCentreProjection, GoalView } from "../../src/projection/types.ts";
import { AgentLogo } from "./AgentLogo.tsx";
import type { Selection } from "./Atlas.tsx";

interface LedgerProps {
  readonly projection: CommandCentreProjection;
  readonly onSelect: (selection: Selection) => void;
}

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
        {goal.agents.length} agents · {goal.attentionCount} attention · {goal.staleCount} uncertain
        ·{" "}
        {
          goal.agents.filter(
            (agent) => agent.runtimeState === "done" && agent.hostHealth === "live",
          ).length
        }{" "}
        results
      </small>
    </button>
    <ul>
      {goal.agents.map((agent) => (
        <li key={agent.id}>
          <button onClick={() => onSelect({ type: "agent", id: agent.id })} type="button">
            <span
              className={`state state--${agent.hostHealth === "live" ? agent.runtimeState : "unknown"}`}
            />
            <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
            <b>{agent.displayName}</b>
            <em>{agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth}</em>
          </button>
        </li>
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
                  <li key={agent.id}>
                    <button onClick={() => onSelect({ type: "agent", id: agent.id })} type="button">
                      <span
                        className={`state state--${agent.hostHealth === "live" ? agent.runtimeState : "unknown"}`}
                      />
                      <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
                      <b>{agent.displayName}</b>
                      <em>{agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth}</em>
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      ) : null}
    </section>
  );
};
