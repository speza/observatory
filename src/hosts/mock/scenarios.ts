import type { HostSessionObservation } from "../types.ts";

export type MockSessionObservation = Omit<HostSessionObservation, "observedAt">;

export interface MockFrame {
  readonly label: string;
  readonly sessions: readonly MockSessionObservation[];
}

export interface MockScenario {
  readonly name: string;
  readonly description: string;
  readonly tickMs: number;
  readonly frames: readonly MockFrame[];
}

type RuntimeState = HostSessionObservation["runtimeState"];
type StateOverrides = Readonly<Record<string, RuntimeState>>;

const session = (
  nativeId: string,
  displayName: string,
  runtimeState: RuntimeState = "idle",
): MockSessionObservation => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "mock.scenario",
  repository: "synthetic/ao-playground",
  branch: "mock/live",
  worktree: `/synthetic/worktrees/${nativeId}`,
  provider: "mock-agent",
  hostLocator: `mock-session:${nativeId}`,
});

const catalog: readonly MockSessionObservation[] = [
  session("mock-p01", "API contract mapping", "working"),
  session("mock-p02", "Attention queue ordering"),
  session("mock-p03", "Session host fixture", "blocked"),
  session("mock-p04", "SQLite restart recovery", "working"),
  session("mock-p05", "Goal editor keyboard path", "waiting"),
  session("mock-p06", "Map focus behavior", "working"),
  session("mock-p07", "Semantic zoom labels"),
  session("mock-p08", "Inspector card placement", "working"),
  session("mock-p09", "Inbox orbit layout"),
  session("mock-p10", "Attachment return state", "working"),
  session("mock-p11", "Projection determinism", "done"),
  session("mock-p12", "Terminal resize fallback"),
  session("mock-p13", "Herdr adapter recovery", "working"),
  session("mock-p14", "Goal priority treatment"),
  session("mock-p15", "Attention age display", "waiting"),
  session("mock-p16", "Search context focus"),
  session("mock-p17", "Stale host recovery", "working"),
  session("mock-p18", "Mock scenario loop"),
  session("mock-p19", "Acceptance evidence"),
  session("mock-p20", "Native cell renderer", "working"),
  session("mock-p21", "New session arrival", "working"),
  session("mock-p22", "Late attention signal"),
  session("mock-p23", "Unassigned burst", "waiting"),
  session("mock-p24", "Recovery verification", "working"),
];

const byId = new Map(catalog.map((item) => [item.nativeId, item]));

const frame = (
  label: string,
  nativeIds: readonly string[],
  overrides: StateOverrides = {},
): MockFrame => ({
  label,
  sessions: nativeIds.flatMap((nativeId) => {
    const definition = byId.get(nativeId);
    if (!definition) return [];
    const runtimeState = overrides[nativeId];
    return [runtimeState === undefined ? definition : { ...definition, runtimeState }];
  }),
});

const firstTwenty = catalog.slice(0, 20).map((item) => item.nativeId);
const firstTwentyTwo = catalog.slice(0, 22).map((item) => item.nativeId);
const firstTwentyThree = catalog.slice(0, 23).map((item) => item.nativeId);
const allSessions = catalog.map((item) => item.nativeId);

const createOrbitScenario = (): MockScenario => ({
  name: "orbit",
  description:
    "A looping portfolio of working, waiting, blocked, done, new and temporarily stale sessions.",
  tickMs: 3_000,
  frames: [
    frame("baseline attention", firstTwenty),
    frame(
      "new arrivals · stale host",
      firstTwentyTwo.filter((nativeId) => nativeId !== "mock-p17"),
      {
        "mock-p03": "working",
        "mock-p05": "blocked",
      },
    ),
    frame("recovery and completion", firstTwentyThree, {
      "mock-p03": "done",
      "mock-p05": "waiting",
      "mock-p15": "idle",
      "mock-p17": "working",
    }),
    frame("attention rotates", allSessions, {
      "mock-p03": "done",
      "mock-p05": "blocked",
      "mock-p15": "idle",
      "mock-p17": "blocked",
      "mock-p21": "working",
    }),
    frame("quiet recovery", allSessions, {
      "mock-p03": "done",
      "mock-p05": "idle",
      "mock-p15": "idle",
      "mock-p17": "waiting",
      "mock-p21": "blocked",
      "mock-p24": "done",
    }),
    frame("steady-state loop", allSessions, {
      "mock-p03": "done",
      "mock-p05": "waiting",
      "mock-p15": "waiting",
      "mock-p17": "idle",
      "mock-p21": "waiting",
      "mock-p24": "working",
    }),
  ],
});

export const createMockScenario = (name = "orbit"): MockScenario => {
  if (name === "orbit") return createOrbitScenario();
  throw new Error(`Unknown mock scenario ${name}; available scenarios: orbit.`);
};
