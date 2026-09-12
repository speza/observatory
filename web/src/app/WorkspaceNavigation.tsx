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
const agentKey = (id: string): string => `agent:${id}`;

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
  }
  if (selection?.type === "agent") {
    const agents = new Map(
      [...projection.goals.flatMap((goal) => goal.agents), ...projection.unassigned].map(
        (agent) => [agent.id, agent] as const,
      ),
    );
    let current = agents.get(selection.id)?.spawnedBy?.parentAgentId;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      required.push(agentKey(current));
      current = agents.get(current)?.spawnedBy?.parentAgentId;
    }
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
  const agentRow = (
    agent: AgentView,
    depth: number,
    childCount: number,
    childAttention: boolean,
  ): React.JSX.Element => {
    // SAFETY: React accepts CSS custom properties on style objects; this one carries the tree depth.
    const rowStyle = { "--tree-depth": String(depth) } as React.CSSProperties;
    return (
      <div
        className={`workspace-tree__agent-branch ${depth > 0 ? "workspace-tree__agent--child" : ""}`}
        key={agent.id}
        style={rowStyle}
      >
        {childCount > 0 && view === "all" ? (
          toggle(agentKey(agent.id), agent.displayName)
        ) : (
          <span aria-hidden="true" className="workspace-tree__toggle-spacer" />
        )}
        <button
          type="button"
          className="workspace-tree__agent"
          aria-current={
            selection?.type === "agent" && selection.id === agent.id ? "true" : undefined
          }
          title={`${agent.displayName} · ${agent.runtimeState}${agent.attention ? ` · ${agent.attention.explanation}` : ""}`}
          onClick={() => onSelect({ type: "agent", id: agent.id })}
        >
          <AgentLogo harnessId={agent.harnessId} provider={agent.provider} />
          <span>{agent.displayName}</span>
          {childCount > 0 ? (
            <small
              className={childAttention ? "is-attention" : undefined}
              aria-label={`${childCount} spawned session${childCount === 1 ? "" : "s"}`}
            >
              {childCount}
            </small>
          ) : null}
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
      </div>
    );
  };
  const nestedAgentRows = (agents: readonly AgentView[]): React.JSX.Element[] => {
    const agentIds = new Set(agents.map((agent) => agent.id));
    const childrenByParent = new Map<string, AgentView[]>();
    const roots: AgentView[] = [];
    for (const agent of agents) {
      const parentAgentId = agent.spawnedBy?.parentAgentId;
      if (!parentAgentId || !agentIds.has(parentAgentId)) {
        roots.push(agent);
        continue;
      }
      const children = childrenByParent.get(parentAgentId);
      if (children) children.push(agent);
      else childrenByParent.set(parentAgentId, [agent]);
    }
    const rows: React.JSX.Element[] = [];
    const visited = new Set<string>();
    const attentionMemo = new Map<string, boolean>();
    const hasAttentionDescendant = (agentId: string, seen: Set<string>): boolean => {
      const memo = attentionMemo.get(agentId);
      if (memo !== undefined) return memo;
      if (seen.has(agentId)) return false;
      seen.add(agentId);
      const result = (childrenByParent.get(agentId) ?? []).some(
        (child) => child.attention !== undefined || hasAttentionDescendant(child.id, seen),
      );
      attentionMemo.set(agentId, result);
      return result;
    };
    const visit = (agent: AgentView, depth: number, visible: boolean): void => {
      if (visited.has(agent.id)) return;
      visited.add(agent.id);
      const children = childrenByParent.get(agent.id) ?? [];
      const childAttention = children.some(
        (child) => child.attention !== undefined || hasAttentionDescendant(child.id, new Set()),
      );
      if (visible) rows.push(agentRow(agent, depth, children.length, childAttention));
      const open = visible && (view === "attention" || expanded.has(agentKey(agent.id)));
      for (const child of children) visit(child, depth + 1, open);
    };
    for (const root of roots) visit(root, 0, true);
    for (const agent of agents) visit(agent, 0, true);
    return rows;
  };
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
      {nestedAgentRows(goal.agents)}
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
            <small aria-label={`${system.goals.length} goals`}>{system.goals.length}</small>
          </summary>
          {system.goals.map(goalRow)}
        </details>
      ))}
      {unassigned.length ? (
        <section className="workspace-tree__unassigned" aria-label="Unassigned agents">
          {view !== "unassigned" ? <p className="overline">Unassigned</p> : null}
          {nestedAgentRows(unassigned)}
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
