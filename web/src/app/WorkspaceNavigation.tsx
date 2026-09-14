import { useEffect, useRef, useState } from "react";
import { ChevronRight, Circle, Layers, CircleAlert } from "lucide-react";
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

const systemKey = (id: string): string => `system:${id}`;
const goalKey = (id: string): string => `goal:${id}`;

const requiredExpansion = (
  projection: CommandCentreProjection,
  systemId: string | undefined,
  selection: Selection | undefined,
): readonly string[] => {
  const required: string[] = [];
  if (systemId) required.push(systemKey(systemId));
  const goalId =
    selection?.type === "goal"
      ? selection.id
      : selection?.type === "agent"
        ? projection.goals.find((goal) => goal.agents.some((agent) => agent.id === selection.id))
            ?.id
        : undefined;
  if (goalId) {
    required.push(goalKey(goalId));
    const goal = projection.goals.find((candidate) => candidate.id === goalId);
    if (goal?.systemId) required.push(systemKey(goal.systemId));
  } else if (selection?.type === "agent") {
    const system = projection.systems.find((candidate) =>
      candidate.agents.some((agent) => agent.id === selection.id),
    );
    if (system) required.push(systemKey(system.id));
  }
  return required;
};

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
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const selectionKey = selection ? `${selection.type}:${selection.id}` : "";
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(requiredExpansion(projection, systemId, selection)),
  );

  useEffect(() => {
    const required = requiredExpansion(projectionRef.current, systemId, selection);
    if (required.length === 0) return;
    setExpanded((existing) => {
      if (required.every((key) => existing.has(key))) return existing;
      const next = new Set(existing);
      for (const key of required) next.add(key);
      return next;
    });
  }, [selection, selectionKey, systemId]);

  const toggleExpanded = (key: string): void => {
    setExpanded((existing) => {
      const next = new Set(existing);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggle = (key: string, label: string): React.JSX.Element => (
    <button
      aria-expanded={expanded.has(key)}
      aria-label={`${expanded.has(key) ? "Collapse" : "Expand"} ${label}`}
      className="workspace-tree__toggle"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleExpanded(key);
      }}
      type="button"
    >
      <ChevronRight aria-hidden="true" size={13} />
    </button>
  );

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
    .map((system) => ({
      ...system,
      goals: goals.filter((goal) => goal.systemId === system.id),
      agents:
        view === "all"
          ? system.agents
          : view === "attention"
            ? system.agents.filter((agent) => needsHumanInput(agent))
            : [],
    }))
    .filter((system) => view === "all" || system.goals.length || system.agents.length);
  const goalRow = (goal: GoalView): React.JSX.Element => (
    <details
      key={goal.id}
      className="workspace-tree__goal"
      open={view === "attention" || expanded.has(goalKey(goal.id)) || undefined}
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
        {view === "all" ? toggle(goalKey(goal.id), goal.title) : null}
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
    <nav className="workspace-tree" aria-label="Systems, goals, and agents">
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
          open={view === "attention" || expanded.has(systemKey(system.id)) || undefined}
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
            {view === "all" ? toggle(systemKey(system.id), system.title) : null}
            <span>{system.title}</span>
            <small
              aria-label={`${system.goals.length} goals, ${system.agents.length} direct agents`}
            >
              {system.goals.length + system.agents.length}
            </small>
          </summary>
          {system.goals.map(goalRow)}
          {system.agents.length > 0 ? (
            <section className="workspace-tree__system-agents" aria-label="Agents without a goal">
              {system.agents.map(agentRow)}
            </section>
          ) : null}
        </details>
      ))}
      {unassigned.length ? (
        <section className="workspace-tree__unassigned" aria-label="Unassigned agents">
          {view !== "unassigned" ? <p className="overline">Unassigned</p> : null}
          {unassigned.map(agentRow)}
        </section>
      ) : null}
      {discoveredExecutions.length ? (
        <details className="workspace-tree__discovered-section">
          <summary className="workspace-tree__discovered-heading">
            <span>Discovered in Herdr</span>
            <small>{discoveredExecutions.length}</small>
          </summary>
          {discoveredExecutions.map(discoveredRow)}
        </details>
      ) : null}
      {view !== "all" && !goals.length && !unassigned.length ? (
        <p className="workspace-tree__empty">
          {view === "attention" ? "Nothing needs your attention." : "No unassigned agents."}
        </p>
      ) : null}
    </nav>
  );
};
