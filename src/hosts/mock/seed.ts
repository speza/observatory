import type { HostSnapshot } from "../types.ts";
import type { Universe } from "../../universe/universe.ts";

export interface MockSeedResult {
  readonly createdGoals: number;
  readonly assignedAgents: number;
}

interface MockGoalSeed {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: "P0" | "P1" | "P2";
  readonly nativeIds: readonly string[];
  readonly position?: { readonly x: number; readonly y: number };
  readonly systemId?: string;
}

const goals = [
  {
    id: "mock-goal-map",
    title: "Portable universe map",
    description: "A seeded goal for exercising body size, satellites and focus.",
    priority: "P0" as const,
    nativeIds: ["mock-p01", "mock-p02", "mock-p03", "mock-p04", "mock-p05", "mock-p06"],
  },
  {
    id: "mock-goal-host",
    title: "Agent host integration",
    description: "Synthetic host activity for attention and attach flows.",
    priority: "P1" as const,
    nativeIds: ["mock-p07", "mock-p08", "mock-p09", "mock-p10", "mock-p11", "mock-p12"],
  },
  {
    id: "mock-goal-recovery",
    title: "Reliability and recovery",
    description: "Synthetic stale, recovery and acceptance activity.",
    priority: "P2" as const,
    nativeIds: ["mock-p13", "mock-p14", "mock-p15", "mock-p16", "mock-p17"],
  },
] as const;

const scaleGoals = [
  {
    id: "mock-goal-observatory",
    title: "Understand Concurrent Agent Work",
    description:
      "Make concurrent agent work understandable without holding its shape in your head.",
    priority: "P0" as const,
    position: { x: -345, y: -180 },
    range: [1, 10],
  },
  {
    id: "mock-goal-career",
    title: "Find the Right AI-First Product Role",
    description: "Find strong AI product opportunities without creating noise.",
    priority: "P2" as const,
    position: { x: -110, y: -215 },
    range: [11, 15],
  },
  {
    id: "mock-goal-direction",
    title: "Validate a New Product Direction",
    description: "Turn promising technical ideas into small, decisive product experiments.",
    priority: "P2" as const,
    position: { x: 135, y: -165 },
    range: [16, 21],
  },
  {
    id: "mock-goal-extensions",
    title: "Establish Safe Extension Boundaries",
    description: "Let useful extensions participate without bypassing policy or audit.",
    priority: "P1" as const,
    position: { x: 375, y: -205 },
    range: [22, 26],
  },
  {
    id: "mock-goal-release",
    title: "Prepare the September Product Release",
    description: "Bring the release through evidence, communication and production verification.",
    priority: "P0" as const,
    position: { x: -370, y: 20 },
    range: [27, 31],
  },
  {
    id: "mock-goal-frontier",
    title: "Ship a Truthful Frontier Alpha",
    description: "Build a truthful and legible AI company simulation.",
    priority: "P1" as const,
    position: { x: -120, y: -15 },
    range: [32, 39],
  },
  {
    id: "mock-goal-control",
    title: "Keep Humans in Control of Agent Execution",
    description: "Keep the human in control while agents gain useful execution power.",
    priority: "P2" as const,
    position: { x: 130, y: 30 },
    range: [40, 46],
  },
  {
    id: "mock-goal-food",
    title: "Automate Weekly Family Food Planning",
    description: "Remove the weekly planning burden from feeding a busy family well.",
    priority: "P1" as const,
    position: { x: 390, y: -5 },
    range: [47, 51],
  },
  {
    id: "mock-goal-harness",
    title: "Prove the Agent Harness Is Dependable",
    description: "Measure the simple tool loop before adding coordination machinery.",
    priority: "P1" as const,
    position: { x: -330, y: 220 },
    range: [52, 56],
  },
  {
    id: "mock-goal-tooling",
    title: "Map the Next Generation of AI Tooling",
    description: "Turn a noisy technology landscape into a small set of grounded decisions.",
    priority: "P2" as const,
    position: { x: -75, y: 180 },
    range: [57, 61],
  },
  {
    id: "mock-goal-review",
    title: "Close the Architecture Review Findings",
    description: "Carry accepted findings into the durable architecture and implementation.",
    priority: "P2" as const,
    position: { x: 175, y: 230 },
    range: [62, 66],
  },
  {
    id: "mock-goal-renderers",
    title: "Retire the Rejected Renderer Experiments",
    description: "Preserve the verdict while removing abandoned implementations from active work.",
    priority: "P2" as const,
    position: { x: 410, y: 190 },
    range: [67, 71],
  },
] as const;

const nativeIdsForRange = (range: readonly [number, number]): readonly string[] =>
  Array.from(
    { length: range[1] - range[0] + 1 },
    (_, index) => `mock-p${String(range[0] + index).padStart(2, "0")}`,
  );

export const seedMockPortfolio = (
  universe: Universe,
  hostSnapshot: HostSnapshot,
): MockSeedResult => {
  if (universe.snapshot().goals.length > 0) return { createdGoals: 0, assignedAgents: 0 };

  for (const observation of hostSnapshot.agents) {
    const reference = observation.harnessEvidence?.nativeConversationRef;
    if (!reference) continue;
    const admitted = universe.execute({
      type: "AddConversation",
      admissionSource: "managed-launch",
      harnessId: reference.harnessId,
      nativeConversationRef: reference,
      displayName: observation.displayName,
      workspaceRef: observation.worktree,
      observedAt: observation.observedAt,
    });
    if (!admitted.ok) throw new Error(admitted.error ?? "Could not admit mock Agent.");
  }
  const reconciled = universe.reconcile(hostSnapshot);
  if (!reconciled.accepted)
    throw new Error(reconciled.error ?? "Could not reconcile admitted mock Agents.");

  const scaleFixture = universe.snapshot().agents.length >= 70;
  const selectedGoals: readonly MockGoalSeed[] = scaleFixture
    ? scaleGoals.map((goal) => ({
        ...goal,
        nativeIds: nativeIdsForRange(goal.range),
        systemId:
          goal.id === "mock-goal-career"
            ? "mock-system-career"
            : goal.id === "mock-goal-food"
              ? "mock-system-home"
              : goal.id === "mock-goal-direction" || goal.id === "mock-goal-frontier"
                ? "mock-system-experiments"
                : "mock-system-observatory",
      }))
    : goals.map((goal) => ({ ...goal, systemId: "mock-system-observatory" }));

  const systems: readonly (readonly [string, string, string])[] = scaleFixture
    ? [
        ["mock-system-observatory", "Observatory", "Supervise concurrent agent work."],
        ["mock-system-experiments", "Product experiments", "Validate new product directions."],
        ["mock-system-career", "Career", "Find the right AI-first product role."],
        ["mock-system-home", "Home", "Automate recurring personal work."],
      ]
    : [["mock-system-observatory", "Observatory", "Build the agent observatory."]];
  for (const [id, title, description] of systems) {
    const result = universe.execute({ type: "CreateSystem", id, title, description });
    if (!result.ok) throw new Error(result.error ?? "Could not seed mock system.");
  }

  let createdGoals = 0;
  for (const goal of selectedGoals) {
    const result = universe.execute({
      type: "CreateGoal",
      id: goal.id,
      title: goal.title,
      description: goal.description,
      priority: goal.priority,
      systemId: goal.systemId,
    });
    if (!result.ok) throw new Error(result.error ?? "Could not seed mock goal.");
    if (goal.position) {
      const positioned = universe.execute({
        type: "SetGoalMapPosition",
        goalId: goal.id,
        position: goal.position,
      });
      if (!positioned.ok) throw new Error(positioned.error ?? "Could not position mock goal.");
    }
    createdGoals += 1;
  }

  const agentsByNativeId = new Map(
    universe
      .snapshot()
      .agents.flatMap((agent) =>
        agent.execution ? [[agent.execution.nativeId, agent.id] as const] : [],
      ),
  );
  let assignedAgents = 0;
  for (const goal of selectedGoals) {
    for (const nativeId of goal.nativeIds) {
      const agentId = agentsByNativeId.get(nativeId);
      if (!agentId) continue;
      const result = universe.execute({
        type: "AssignAgent",
        agentId,
        goalId: goal.id,
      });
      if (!result.ok) throw new Error(result.error ?? "Could not assign mock agent.");
      assignedAgents += 1;
    }
  }
  return { createdGoals, assignedAgents };
};
