import type { HostAgentObservation } from "../types.ts";

export type MockAgentObservation = Omit<HostAgentObservation, "observedAt">;

export interface MockFrame {
  readonly label: string;
  readonly agents: readonly MockAgentObservation[];
  readonly available?: boolean;
  readonly diagnostics?: readonly string[];
  readonly error?: string;
  /** Simulate a host whose observations work while its action transport is degraded. */
  readonly actionError?: string;
}

export interface MockScenario {
  readonly name: string;
  readonly description: string;
  readonly tickMs: number;
  readonly frames: readonly MockFrame[];
}

type RuntimeState = HostAgentObservation["runtimeState"];
type StateOverrides = Readonly<Record<string, RuntimeState>>;

const repositoryFor = (nativeId: string): string => {
  const index = Number(nativeId.slice(-2));
  if (index <= 8) return "synthetic/observatory";
  if (index <= 16) return "synthetic/agent-host";
  return "synthetic/recovery-lab";
};

const executionContainerFor = (nativeId: string): HostAgentObservation["executionContainer"] => {
  const index = Number(nativeId.slice(-2));
  if ([1, 2, 3, 4, 9, 10, 11, 12, 18, 19].includes(index))
    return { id: "synthetic/copilot-dev-mode-ui", label: "Copilot dev mode UI" };
  if ([5, 6, 7, 8].includes(index))
    return { id: "synthetic/observatory-control-plane", label: "Observatory control plane" };
  return undefined;
};

const agent = (
  nativeId: string,
  displayName: string,
  runtimeState: RuntimeState = "idle",
): MockAgentObservation => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "mock.scenario",
  repository: repositoryFor(nativeId),
  branch: "mock/live",
  worktree: `/synthetic/worktrees/${nativeId}`,
  provider: "mock-agent",
  executionContainer: executionContainerFor(nativeId),
  hostLocator: `mock-agent:${nativeId}`,
});

const baseCatalog: readonly MockAgentObservation[] = [
  agent("mock-p01", "API contract mapping", "working"),
  agent("mock-p02", "Attention queue ordering"),
  agent("mock-p03", "Agent host fixture", "blocked"),
  agent("mock-p04", "SQLite restart recovery", "working"),
  agent("mock-p05", "Goal editor keyboard path", "waiting"),
  agent("mock-p06", "Map focus behavior", "working"),
  agent("mock-p07", "Semantic zoom labels"),
  agent("mock-p08", "Inspector card placement", "working"),
  agent("mock-p09", "Inbox orbit layout"),
  agent("mock-p10", "Attachment return state", "working"),
  agent("mock-p11", "Projection determinism", "done"),
  agent("mock-p12", "Terminal resize fallback"),
  agent("mock-p13", "Herdr adapter recovery", "working"),
  agent("mock-p14", "Goal priority treatment"),
  agent("mock-p15", "Attention age display", "waiting"),
  agent("mock-p16", "Search context focus"),
  agent("mock-p17", "Stale host recovery", "working"),
  agent("mock-p18", "Mock scenario loop"),
  agent("mock-p19", "Acceptance evidence"),
  agent("mock-p20", "Native cell renderer", "working"),
  agent("mock-p21", "New agent arrival", "working"),
  agent("mock-p22", "Late attention signal"),
  agent("mock-p23", "Unassigned burst", "waiting"),
  agent("mock-p24", "Recovery verification", "working"),
];

const portfolioNames = [
  "Atlas",
  "Lumen",
  "Kepler",
  "Umbra",
  "Relay",
  "Scribe",
  "Meridian",
  "Forge",
  "Quill",
  "Rook",
  "Ember",
  "Delta",
  "Sentinel",
  "Mosaic",
  "Axiom",
  "Thread",
  "Pantry",
  "Saffron",
  "Tally",
  "Radar",
  "Prism",
  "Beacon",
  "Spark",
  "Kiln",
  "Verdict",
  "Harbor",
  "Drift",
  "Echo",
  "Wander",
  "Pioneer",
  "Northstar",
  "Grove",
  "Thimble",
  "Facet",
  "Bastion",
  "Accord",
  "Sentry",
  "Measure",
  "Query",
  "Testbed",
  "Bridge",
  "Archive",
  "Waymark",
  "Rivet",
  "Platen",
  "Chisel",
  "Compass",
  "Current",
  "Margin",
  "Anvil",
  "Receipt",
  "Docket",
  "Cairn",
  "Flint",
  "Ledger",
  "Survey",
  "Folio",
  "Vellum",
  "Cinder",
  "Lattice",
  "Anchor",
  "Juniper",
  "Morrow",
  "Pact",
  "Trace",
  "Loom",
  "Hearth",
  "Signal",
  "Contour",
  "Field",
  "Watch",
  "Heron",
  "Mica",
  "Reed",
  "Vale",
] as const;

const portfolioState = (index: number): RuntimeState => {
  if (index % 19 === 0) return "blocked";
  if (index % 11 === 0) return "waiting";
  if (index % 7 === 0) return "done";
  if (index % 3 === 0) return "idle";
  return "working";
};

const portfolioCatalog: readonly MockAgentObservation[] = portfolioNames.map((name, index) => {
  const number = index + 1;
  return agent(`mock-p${String(number).padStart(2, "0")}`, name, portfolioState(number));
});

const catalog: readonly MockAgentObservation[] = [
  ...baseCatalog,
  ...portfolioCatalog.slice(baseCatalog.length),
];

const byId = new Map(catalog.map((item) => [item.nativeId, item]));

const frame = (
  label: string,
  nativeIds: readonly string[],
  overrides: StateOverrides = {},
  properties: Omit<MockFrame, "label" | "agents"> = {},
): MockFrame => ({
  label,
  agents: nativeIds.flatMap((nativeId) => {
    const definition = byId.get(nativeId);
    if (!definition) return [];
    const runtimeState = overrides[nativeId];
    return [runtimeState === undefined ? definition : { ...definition, runtimeState }];
  }),
  ...properties,
});

const firstTwenty = catalog.slice(0, 20).map((item) => item.nativeId);
const firstTwentyTwo = catalog.slice(0, 22).map((item) => item.nativeId);
const firstTwentyThree = catalog.slice(0, 23).map((item) => item.nativeId);
const allAgents = catalog.map((item) => item.nativeId);

const createOrbitScenario = (): MockScenario => ({
  name: "orbit",
  description:
    "A looping portfolio of working, waiting, blocked, done, new and temporarily stale agents.",
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
    frame("attention rotates", allAgents, {
      "mock-p03": "done",
      "mock-p05": "blocked",
      "mock-p15": "idle",
      "mock-p17": "blocked",
      "mock-p21": "working",
    }),
    frame("quiet recovery", allAgents, {
      "mock-p03": "done",
      "mock-p05": "idle",
      "mock-p15": "idle",
      "mock-p17": "waiting",
      "mock-p21": "blocked",
      "mock-p24": "done",
    }),
    frame("steady-state loop", allAgents, {
      "mock-p03": "done",
      "mock-p05": "waiting",
      "mock-p15": "waiting",
      "mock-p17": "idle",
      "mock-p21": "waiting",
      "mock-p24": "working",
    }),
  ],
});

const createPortfolioScenario = (): MockScenario => ({
  name: "portfolio",
  description: "A stable 12-goal scale fixture with 75 observed agents and truthful host loss.",
  tickMs: 8_000,
  frames: [
    frame("full portfolio", allAgents),
    frame("four observations become stale", allAgents.slice(0, 71), {
      "mock-p19": "blocked",
      "mock-p22": "waiting",
    }),
  ],
});

const createDegradedScenario = (): MockScenario => ({
  name: "degraded",
  description:
    "A deterministic host outage, stale-target window, degraded action transport and recovery.",
  tickMs: 8_000,
  frames: [
    frame("healthy baseline", firstTwenty),
    frame(
      "host unavailable",
      [],
      {},
      {
        available: false,
        diagnostics: ["Synthetic mock host connection interrupted."],
        error: "The synthetic mock host is temporarily unavailable.",
      },
    ),
    frame(
      "observations recovered · actions degraded",
      firstTwenty.filter((nativeId) => nativeId !== "mock-p17"),
      { "mock-p03": "working", "mock-p05": "blocked" },
      {
        diagnostics: ["Synthetic mock action transport is degraded."],
        actionError: "The synthetic mock host cannot perform actions in this frame.",
      },
    ),
    frame("full recovery", firstTwentyTwo, {
      "mock-p03": "done",
      "mock-p05": "waiting",
      "mock-p17": "working",
    }),
  ],
});

export const createMockScenario = (name = "orbit"): MockScenario => {
  if (name === "orbit") return createOrbitScenario();
  if (name === "portfolio") return createPortfolioScenario();
  if (name === "degraded") return createDegradedScenario();
  throw new Error(
    `Unknown mock scenario ${name}; available scenarios: orbit, portfolio, degraded.`,
  );
};
