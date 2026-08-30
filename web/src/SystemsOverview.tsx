import type { CommandCentreProjection, GoalView, SystemView } from "../../src/projection/types.ts";
import { NO_SYSTEM_SCOPE } from "./systemScope.ts";

interface SystemsOverviewProps {
  readonly projection: CommandCentreProjection;
  readonly onCreate: () => void;
  readonly onEdit: (system: SystemView) => void;
  readonly onOpen: (systemId: string) => void;
}

const SystemCard = ({
  system,
  onEdit,
  onOpen,
}: {
  readonly system: SystemView;
  readonly onEdit: (system: SystemView) => void;
  readonly onOpen: (systemId: string) => void;
}): React.JSX.Element => (
  <article className="system-card">
    <button className="system-card__open" onClick={() => onOpen(system.id)} type="button">
      <span className="overline">
        SYSTEM / {String(system.goals.length).padStart(2, "0")} GOALS
      </span>
      <strong>{system.title}</strong>
      <p>{system.description ?? "No description yet."}</p>
      <dl>
        <div>
          <dt>Agents</dt>
          <dd>{system.agentCount}</dd>
        </div>
        <div>
          <dt>Working</dt>
          <dd>{system.workingCount}</dd>
        </div>
        <div className={system.attentionCount > 0 ? "is-attention" : ""}>
          <dt>Attention</dt>
          <dd>{system.attentionCount}</dd>
        </div>
        <div>
          <dt>Uncertain</dt>
          <dd>{system.staleCount}</dd>
        </div>
      </dl>
    </button>
    <button className="system-card__edit" onClick={() => onEdit(system)} type="button">
      Edit
    </button>
  </article>
);

const UnassignedGoalsCard = ({
  goals,
  onOpen,
}: {
  readonly goals: readonly GoalView[];
  readonly onOpen: () => void;
}): React.JSX.Element => (
  <article className="system-card system-card--unassigned">
    <button className="system-card__open" onClick={onOpen} type="button">
      <span className="overline">NO SYSTEM / {String(goals.length).padStart(2, "0")} GOALS</span>
      <strong>Unassigned goals</strong>
      <p>Open a Goal in the Ledger or Atlas to place it in a System.</p>
      <dl>
        <div>
          <dt>Agents</dt>
          <dd>{goals.reduce((total, goal) => total + goal.agents.length, 0)}</dd>
        </div>
        <div className={goals.some((goal) => goal.attentionCount > 0) ? "is-attention" : ""}>
          <dt>Attention</dt>
          <dd>{goals.reduce((total, goal) => total + goal.attentionCount, 0)}</dd>
        </div>
      </dl>
    </button>
  </article>
);

export const SystemsOverview = ({
  projection,
  onCreate,
  onEdit,
  onOpen,
}: SystemsOverviewProps): React.JSX.Element => {
  const unassignedGoals = projection.goals.filter((goal) => !goal.systemId);
  return (
    <section className="systems-overview" aria-label="Systems overview">
      <header>
        <div>
          <p className="overline">ALL SYSTEMS</p>
          <h2>Broad areas of work</h2>
          <p>Systems contain Goals and can span repositories, workspaces, and hosts.</p>
        </div>
        <button onClick={onCreate} type="button">
          New system
        </button>
      </header>
      <div className="systems-overview__grid">
        {projection.systems.map((system) => (
          <SystemCard key={system.id} onEdit={onEdit} onOpen={onOpen} system={system} />
        ))}
        {unassignedGoals.length > 0 ? (
          <UnassignedGoalsCard goals={unassignedGoals} onOpen={() => onOpen(NO_SYSTEM_SCOPE)} />
        ) : null}
      </div>
      {projection.systems.length === 0 && unassignedGoals.length === 0 ? (
        <div className="systems-overview__empty">
          <p>No Systems yet.</p>
          <button onClick={onCreate} type="button">
            Create the first system
          </button>
        </div>
      ) : null}
    </section>
  );
};
