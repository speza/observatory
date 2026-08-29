import type { CommandCentreProjection, GoalView } from "../../src/projection/types.ts";
import { AgentLogo } from "./AgentLogo.tsx";
import type { Selection } from "./Atlas.tsx";

interface LedgerProps {
  readonly projection: CommandCentreProjection;
  readonly onSelect: (selection: Selection) => void;
}

export const Ledger = ({ projection, onSelect }: LedgerProps): React.JSX.Element => (
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
              uncertain ·{" "}
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
                  <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
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
