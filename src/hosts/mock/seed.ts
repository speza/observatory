import type { Universe } from "../../universe/universe.ts";

export interface MockSeedResult {
  readonly createdGoals: number;
  readonly assignedSessions: number;
}

const goals = [
  {
    id: "mock-goal-map",
    title: "Portable universe map",
    description:
      "A seeded goal for exercising body size, satellites and focus.",
    priority: "P0" as const,
    nativeIds: [
      "mock-p01",
      "mock-p02",
      "mock-p03",
      "mock-p04",
      "mock-p05",
      "mock-p06",
    ],
  },
  {
    id: "mock-goal-host",
    title: "Session host integration",
    description: "Synthetic host activity for attention and attach flows.",
    priority: "P1" as const,
    nativeIds: [
      "mock-p07",
      "mock-p08",
      "mock-p09",
      "mock-p10",
      "mock-p11",
      "mock-p12",
    ],
  },
  {
    id: "mock-goal-recovery",
    title: "Reliability and recovery",
    description: "Synthetic stale, recovery and acceptance activity.",
    priority: "P2" as const,
    nativeIds: ["mock-p13", "mock-p14", "mock-p15", "mock-p16", "mock-p17"],
  },
] as const;

export const seedMockPortfolio = (universe: Universe): MockSeedResult => {
  if (universe.snapshot().goals.length > 0)
    return { createdGoals: 0, assignedSessions: 0 };

  let createdGoals = 0;
  for (const goal of goals) {
    const result = universe.execute({
      type: "CreateGoal",
      id: goal.id,
      title: goal.title,
      description: goal.description,
      priority: goal.priority,
    });
    if (!result.ok)
      throw new Error(result.error ?? "Could not seed mock goal.");
    createdGoals += 1;
  }

  const sessionsByNativeId = new Map(
    universe
      .snapshot()
      .sessions.map((session) => [session.nativeId, session.id]),
  );
  let assignedSessions = 0;
  for (const goal of goals) {
    for (const nativeId of goal.nativeIds) {
      const sessionId = sessionsByNativeId.get(nativeId);
      if (!sessionId) continue;
      const result = universe.execute({
        type: "AssignSession",
        sessionId,
        goalId: goal.id,
      });
      if (!result.ok)
        throw new Error(result.error ?? "Could not assign mock session.");
      assignedSessions += 1;
    }
  }
  return { createdGoals, assignedSessions };
};
