import { describe, expect, test } from "bun:test";
import { Effect, Option, Stream } from "effect";
import { makeUniverse, FixedClock } from "../../universe/test-support.ts";
import { MockHostAdapter } from "./adapter.ts";
import { createMockScenario } from "./scenarios.ts";
import { seedMockPortfolio } from "./seed.ts";
import { defineSessionHostContractTests } from "../session-host-contract.test-support.ts";

describe("Mock host adapter", () => {
  test("offers the same curated launch set as the live host", async () => {
    const adapter = new MockHostAdapter({ clock: new FixedClock(10_000) });
    expect(await Effect.runPromise(adapter.listLaunchOptions())).toEqual([
      { kind: "claude", label: "Claude Code", description: "Claude Code CLI" },
      { kind: "codex", label: "Codex", description: "Codex CLI" },
      { kind: "pi", label: "Pi", description: "Pi coding agent" },
    ]);
  });

  test("loops deterministic agent frames and exposes state transitions", async () => {
    const clock = new FixedClock(10_000);
    const scenario = createMockScenario();
    const adapter = new MockHostAdapter({ clock, scenario });

    const first = await Effect.runPromise(adapter.snapshot());
    expect(first.hostKind).toBe("mock");
    expect(first.agents).toHaveLength(20);
    expect(first.diagnostics).toHaveLength(0);
    expect(first.agents.find((agent) => agent.nativeId === "mock-p03")?.runtimeState).toBe(
      "blocked",
    );

    clock.value += scenario.tickMs;
    const second = await Effect.runPromise(adapter.snapshot());
    expect(second.agents).toHaveLength(21);
    expect(second.agents.some((agent) => agent.nativeId === "mock-p17")).toBe(false);
    expect(second.agents.find((agent) => agent.nativeId === "mock-p03")?.runtimeState).toBe(
      "working",
    );
    expect(second.agents.find((agent) => agent.nativeId === "mock-p21")?.runtimeState).toBe(
      "working",
    );

    clock.value += scenario.tickMs * (scenario.frames.length - 1);
    const looped = await Effect.runPromise(adapter.snapshot());
    expect(looped.agents.find((agent) => agent.nativeId === "mock-p03")?.runtimeState).toBe(
      "blocked",
    );
    expect(looped.agents.find((agent) => agent.nativeId === "mock-p01")?.hostLocator).toBe(
      "mock-agent:mock-p01",
    );
  });

  test("keeps attachment targets opaque and current-frame scoped", async () => {
    const clock = new FixedClock(20_000);
    const scenario = createMockScenario();
    const adapter = new MockHostAdapter({ clock, scenario });
    await Effect.runPromise(adapter.snapshot());

    const access = await Effect.runPromise(
      adapter.access({
        hostKind: "mock",
        nativeId: "mock-p03",
      }),
    );
    expect(access.supported).toBe(true);
    expect(access.capabilities).toEqual(["embedded-terminal", "native-handoff", "linked-terminal"]);
    expect(access.linkedExecutions).toHaveLength(4);
    expect(access.linkedExecutions.map((execution) => execution.kind)).toEqual([
      "shell",
      "shell",
      "agent",
      "shell",
    ]);
    expect(access.linkedExecutions.map((execution) => execution.label)).toEqual([
      "Mock linked shell",
      "Mock test watcher",
      "Mock sibling agent",
      "New terminal",
    ]);
    expect(access.target).toEqual({
      kind: "mock-agent",
      token: "mock-p03",
    });
    expect(await Effect.runPromise(adapter.activate(access))).toEqual({
      ok: true,
      message: "Simulated focus for mock agent mock-p03.",
    });

    clock.value += scenario.tickMs;
    await Effect.runPromise(adapter.snapshot());
    expect(
      (await Effect.runPromise(adapter.access({ hostKind: "mock", nativeId: "mock-p17" })))
        .supported,
    ).toBe(false);
    const unsupported = await Effect.runPromise(
      adapter.access({ hostKind: "herdr", nativeId: "mock-p03" }),
    );
    expect(unsupported.supported).toBe(false);
    expect(unsupported.capabilities).toEqual([]);
  });

  test("seeds a real goal-and-agent portfolio only through Universe commands", async () => {
    const clock = new FixedClock(30_000);
    const { universe } = makeUniverse({ clock });
    const adapter = new MockHostAdapter({ clock });
    const snapshot = await Effect.runPromise(adapter.snapshot());
    expect(universe.reconcile(snapshot).accepted).toBe(true);

    expect(seedMockPortfolio(universe)).toEqual({
      createdGoals: 3,
      assignedAgents: 17,
    });
    const state = universe.snapshot();
    expect(state.goals.map((goal) => goal.priority)).toEqual(["P0", "P1", "P2"]);
    expect(state.agents.filter((agent) => agent.primaryGoalId)).toHaveLength(17);
    expect(seedMockPortfolio(universe)).toEqual({
      createdGoals: 0,
      assignedAgents: 0,
    });
  });

  test("provides the production web scale fixture through the real projection path", async () => {
    const clock = new FixedClock(35_000);
    const { universe } = makeUniverse({ clock });
    const scenario = createMockScenario("portfolio");
    const adapter = new MockHostAdapter({ clock, scenario });
    const snapshot = await Effect.runPromise(adapter.snapshot());
    expect(snapshot.agents).toHaveLength(75);
    expect(universe.reconcile(snapshot).accepted).toBe(true);

    expect(seedMockPortfolio(universe)).toEqual({
      createdGoals: 12,
      assignedAgents: 71,
    });
    const projection = universe.project({ kind: "universe-map", now: clock.now() });
    expect(projection.kind).toBe("universe-map");
    if (projection.kind !== "universe-map") throw new Error("Expected the universe map.");
    expect(projection.counts).toMatchObject({ goals: 12, agents: 75, unassigned: 4 });
    expect(
      new Set(projection.goals.map((goal) => `${goal.mapPosition.x}:${goal.mapPosition.y}`)).size,
    ).toBe(12);

    clock.value += scenario.tickMs;
    expect(universe.reconcile(await Effect.runPromise(adapter.snapshot())).accepted).toBe(true);
    const staleProjection = universe.project({ kind: "universe-map", now: clock.now() });
    expect(staleProjection.kind).toBe("universe-map");
    if (staleProjection.kind !== "universe-map") throw new Error("Expected the universe map.");
    expect(staleProjection.counts.stale).toBe(4);
    expect(staleProjection.counts.unassigned).toBe(4);
  });

  test("provides a deterministic embedded terminal stream", async () => {
    const clock = new FixedClock(40_000);
    const adapter = new MockHostAdapter({ clock });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "mock", nativeId: "mock-p01" }),
    );
    const opened = await Effect.runPromise(adapter.openTerminal(access, { columns: 80, rows: 24 }));
    expect(opened.ok).toBe(true);
    const first = await Effect.runPromise(Stream.runHead(opened.terminal!.events));
    expect(Option.getOrUndefined(first)?.kind).toBe("frame");
    expect(await Effect.runPromise(opened.terminal!.send({ kind: "text", value: "x" }))).toEqual({
      ok: true,
      message: "Input sent to the mock terminal.",
    });
    expect(await Effect.runPromise(opened.terminal!.resize({ columns: 90, rows: 30 }))).toEqual({
      ok: true,
      message: "Resized mock terminal to 90×30.",
    });
    expect(await Effect.runPromise(opened.terminal!.release())).toEqual({
      ok: true,
      message: "Released mock terminal mock-p01.",
    });
  });

  test("provides a deterministic linked shell execution stream", async () => {
    const clock = new FixedClock(45_000);
    const adapter = new MockHostAdapter({ clock });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "mock", nativeId: "mock-p01" }),
    );
    const linkedExecution = access.linkedExecutions[0];
    const opened = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(linkedExecution!, { columns: 60, rows: 18 }),
    );
    expect(opened.ok).toBe(true);
    expect(await Effect.runPromise(Stream.runHead(opened.terminal!.events))).toMatchObject({
      _tag: "Some",
    });
    await Effect.runPromise(opened.terminal!.release());
  });

  test("creates a fresh prepared companion terminal on every open", async () => {
    const clock = new FixedClock(46_000);
    const adapter = new MockHostAdapter({ clock });
    await Effect.runPromise(adapter.snapshot());
    const access = await Effect.runPromise(
      adapter.access({ hostKind: "mock", nativeId: "mock-p01" }),
    );
    const createTerminal = access.linkedExecutions.find(
      (execution) => execution.source === "prepared",
    );
    expect(createTerminal).toBeDefined();
    const first = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(createTerminal!, { columns: 60, rows: 18 }),
    );
    const second = await Effect.runPromise(
      adapter.openLinkedExecutionTerminal(createTerminal!, { columns: 60, rows: 18 }),
    );
    expect(first.message).toContain("terminal 1");
    expect(second.message).toContain("terminal 2");
    await Effect.runPromise(first.terminal!.release());
    await Effect.runPromise(second.terminal!.release());
  });

  test("launches a synthetic agent that appears on the next snapshot", async () => {
    const clock = new FixedClock(50_000);
    const adapter = new MockHostAdapter({ clock });
    const launched = await Effect.runPromise(
      adapter.launch({
        requestId: "launch-test",
        workingDirectory: "/synthetic/project",
        agentKind: "codex",
        agentName: "launch-test",
      }),
    );
    expect(launched.ok).toBe(true);
    expect(launched.nativeId).toBe("mock-launch-1");
    const snapshot = await Effect.runPromise(adapter.snapshot());
    expect(snapshot.agents.find((agent) => agent.nativeId === launched.nativeId)).toMatchObject({
      displayName: "launch-test",
      provider: "codex",
      worktree: "/synthetic/project",
    });
  });
});

defineSessionHostContractTests("Mock", () => {
  const clock = new FixedClock(60_000);
  return {
    host: new MockHostAdapter({ clock, scenario: createMockScenario() }),
    agent: { hostKind: "mock", nativeId: "mock-p01" },
  };
});
