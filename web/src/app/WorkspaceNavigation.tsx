import { Circle, Layers, CircleAlert } from "lucide-react";
import { AgentLogo } from "../shared/AgentLogo.tsx";
import type {
  AgentView,
  CommandCentreProjection,
  DiscoveredExecutionView,
  GoalView,
} from "../../../src/projection/types.ts";
import type { Selection } from "./selection.ts";

export type NavigationView = "all" | "attention" | "unassigned";

const needsHumanInput = (agent: AgentView): boolean => agent.attention?.requiresHumanInput === true;

export const WorkspaceNavigation = ({
  projection,
  view = "all",
  systemId,
  selection,
  onSystem,
  onSelect,
}: {
  readonly view?: NavigationView;
  readonly projection: CommandCentreProjection;
  readonly systemId?: string;
  readonly selection?: Selection;
  readonly onSystem: (id?: string) => void;
  readonly onSelect: (selection: Selection) => void;
}): React.JSX.Element => {
  const attentionGoalIds = new Set(
    projection.attention.items
      .filter((item) => item.requiresHumanInput && item.goalId)
      .map((item) => item.goalId!),
  );
  const agentRow = (agent: AgentView): React.JSX.Element => (
    <button
      type="button"
      className="workspace-tree__agent"
      key={agent.id}
      aria-current={selection?.type === "agent" && selection.id === agent.id ? "true" : undefined}
      title={`${agent.displayName} · ${agent.runtimeState}${agent.attention ? ` · ${agent.attention.explanation}` : ""}`}
      onClick={() => onSelect({ type: "agent", id: agent.id })}
    >
      <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
      <span>{agent.displayName}</span>
      <span
        className="workspace-tree__status"
        role="img"
        aria-label={
          agent.attention
            ? `${agent.runtimeState} · ${agent.attention.explanation}`
            : agent.runtimeState
        }
      >
        {agent.attention ? (
          <CircleAlert size={13} className="is-attention" />
        ) : (
          <i className={`workspace-tree__dot is-${agent.runtimeState}`} />
        )}
      </span>
    </button>
  );
  const goals =
    view === "unassigned"
      ? []
      : projection.goals.flatMap((goal) => {
          if (view === "all") return [goal];
          const agents = goal.agents.filter(needsHumanInput);
          const needsGoal = attentionGoalIds.has(goal.id);
          return agents.length || needsGoal ? [{ ...goal, agents }] : [];
        });
  const unassigned = projection.unassigned.filter(
    (agent) => view !== "attention" || needsHumanInput(agent),
  );
  const discoveredExecutions = view === "all" ? (projection.discoveredExecutions ?? []) : [];
  const systems = projection.systems
    .map((system) => ({ ...system, goals: goals.filter((goal) => goal.systemId === system.id) }))
    .filter((system) => view === "all" || system.goals.length);
  const goalRow = (goal: GoalView): React.JSX.Element => (
    <details
      key={goal.id}
      className="workspace-tree__goal"
      open={
        view === "attention" ||
        (selection?.type === "goal" && selection.id === goal.id) ||
        (selection?.type === "agent" && goal.agents.some((agent) => agent.id === selection.id)) ||
        undefined
      }
    >
      <summary
        aria-current={selection?.type === "goal" && selection.id === goal.id ? "true" : undefined}
        title={goal.title}
        className={
          selection?.type === "agent" && goal.agents.some((agent) => agent.id === selection.id)
            ? "is-ancestor"
            : undefined
        }
        onClick={(event) => {
          event.preventDefault();
          onSelect({ type: "goal", id: goal.id });
        }}
      >
        <Circle size={13} className="workspace-tree__goal-icon" />
        <span>{goal.title}</span>
        <small aria-label={`${goal.agents.length} agents`}>{goal.agents.length}</small>
      </summary>
      {goal.agents.map(agentRow)}
      {goal.agents.length === 0 ? (
        <p className="workspace-tree__empty">
          {view === "attention" ? "Goal needs attention." : "No agents yet"}
        </p>
      ) : null}
    </details>
  );
  const discoveredRow = (execution: DiscoveredExecutionView): React.JSX.Element => {
    const state = execution.presence === "live" ? execution.runtimeState : "unknown";
    return (
      <button
        type="button"
        className="workspace-tree__agent workspace-tree__discovered"
        key={execution.handle}
        aria-current={
          selection?.type === "discovered-execution" && selection.id === execution.handle
            ? "true"
            : undefined
        }
        title={`${execution.displayName} · ${state} · discovered in ${execution.hostKind}`}
        onClick={() => onSelect({ type: "discovered-execution", id: execution.handle })}
      >
        <AgentLogo provider={execution.provider} />
        <span>{execution.displayName}</span>
        <span
          className="workspace-tree__status"
          role="img"
          aria-label={`${state} · discovered in ${execution.hostKind}`}
        >
          <i className={`workspace-tree__dot is-${state}`} />
        </span>
      </button>
    );
  };
  return (
    <nav className="workspace-tree" aria-label="Systems and goals">
      <p className="overline">
        {view === "unassigned"
          ? "Unassigned agents"
          : view === "attention"
            ? "Needs you · all systems"
            : "Systems & goals"}
      </p>
      {view === "all" ? (
        <button
          type="button"
          className="workspace-tree__all"
          aria-current={!systemId && !selection ? "true" : undefined}
          onClick={() => onSystem()}
        >
          <Layers size={15} />
          <span>All systems</span>
          <small>{projection.systems.length}</small>
        </button>
      ) : null}
      {systems.map((system) => (
        <details
          className="workspace-tree__system"
          key={system.id}
          open={view === "attention" || systemId === system.id || undefined}
        >
          <summary
            aria-current={systemId === system.id && !selection ? "true" : undefined}
            className={systemId === system.id && selection ? "is-ancestor" : undefined}
            title={system.title}
            onClick={(event) => {
              event.preventDefault();
              onSystem(system.id);
            }}
          >
            <span>{system.title}</span>
            <small aria-label={`${system.goals.length} goals`}>{system.goals.length}</small>
          </summary>
          {system.goals.map(goalRow)}
        </details>
      ))}
      {unassigned.length ? (
        <section className="workspace-tree__unassigned" aria-label="Unassigned agents">
          {view !== "unassigned" ? <p className="overline">Unassigned</p> : null}
          {unassigned.map(agentRow)}
        </section>
      ) : null}
      {discoveredExecutions.length ? (
        <section className="workspace-tree__discovered-section" aria-label="Discovered in Herdr">
          <p className="overline">Discovered in Herdr · {discoveredExecutions.length}</p>
          {discoveredExecutions.map(discoveredRow)}
        </section>
      ) : null}
      {view !== "all" && !goals.length && !unassigned.length ? (
        <p className="workspace-tree__empty">
          {view === "attention" ? "Nothing needs your attention." : "No unassigned agents."}
        </p>
      ) : null}
    </nav>
  );
};
