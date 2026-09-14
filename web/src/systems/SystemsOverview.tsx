import type { CommandCentreProjection, SystemView } from "../../../src/projection/types.ts";

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
          <dt>Needs you</dt>
          <dd>{system.attentionCount}</dd>
        </div>
        <div>
          <dt>Monitor</dt>
          <dd>{system.staleCount}</dd>
        </div>
      </dl>
    </button>
    <button className="system-card__edit" onClick={() => onEdit(system)} type="button">
      Edit
    </button>
  </article>
);

export const SystemsOverview = ({
  projection,
  onCreate,
  onEdit,
  onOpen,
}: SystemsOverviewProps): React.JSX.Element => {
  return (
    <section className="systems-overview" aria-label="Systems overview">
      <header>
        <div>
          <p className="overline">ALL SYSTEMS</p>
          <h2>Broad areas of work</h2>
          <p>
            Systems contain Goals and direct Agents, spanning repositories, workspaces, and hosts.
          </p>
        </div>
        <button onClick={onCreate} type="button">
          New system
        </button>
      </header>
      <div className="systems-overview__grid">
        {projection.systems.map((system) => (
          <SystemCard key={system.id} onEdit={onEdit} onOpen={onOpen} system={system} />
        ))}
      </div>
      {projection.systems.length === 0 ? (
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
