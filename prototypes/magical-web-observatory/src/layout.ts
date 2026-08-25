import type { AgentFixture, GoalFixture } from "./data";

export interface ViewportState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface WorldSize {
  readonly width: number;
  readonly height: number;
}

export interface GoalLayout {
  readonly goal: GoalFixture;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly agents: readonly AgentFixture[];
}

export const sceneLayouts = (
  goals: readonly GoalFixture[],
  agents: readonly AgentFixture[],
): readonly GoalLayout[] =>
  goals.map((goal) => ({
    goal,
    x: goal.position[0] * 70,
    y: goal.position[1] * 58,
    radius: goal.radius * 34,
    agents: agents.filter((agent) => agent.goalId === goal.id),
  }));

export const agentOrbit = (
  layout: GoalLayout,
  agent: AgentFixture,
  index: number,
): { readonly radiusX: number; readonly radiusY: number; readonly phase: number } => {
  const band = index % 2;
  const radiusX = layout.radius + 45 + band * 27;
  return {
    radiusX,
    radiusY: radiusX * 0.58,
    phase: agent.phase,
  };
};

export const clampZoom = (value: number): number => Math.min(2.6, Math.max(0.62, value));
