import { describe, expect, test } from "bun:test";
import { Effect, Option, Stream } from "effect";
import { makeUniverse, FixedClock } from "../../universe/test-support.ts";
import { MockHostAdapter } from "./adapter.ts";
import { createMockScenario } from "./scenarios.ts";
import { seedMockPortfolio } from "./seed.ts";

describe("Mock host adapter", () => {
  test("loops deterministic session frames and exposes state transitions", async () => {
    const clock = new FixedClock(10_000);
    const scenario = createMockScenario();
    const adapter = new MockHostAdapter({ clock, scenario });

    const first = await Effect.runPromise(adapter.snapshot());
    expect(first.hostKind).toBe("mock");
    expect(first.sessions).toHaveLength(20);
    expect(first.diagnostics).toHaveLength(0);
    expect(first.sessions.find((session) => session.nativeId === "mock-p03")?.runtimeState).toBe(
      "blocked",
    );

    clock.value += scenario.tickMs;
    const second = await Effect.runPromise(adapter.snapshot());
    expect(second.sessions).toHaveLength(21);
    expect(second.sessions.some((session) => session.nativeId === "mock-p17")).toBe(false);
    expect(second.sessions.find((session) => session.nativeId === "mock-p03")?.runtimeState).toBe(
      "working",
    );
    expect(second.sessions.find((session) => session.nativeId === "mock-p21")?.runtimeState).toBe(
      "working",
    );

    clock.value += scenario.tickMs * (scenario.frames.length - 1);
    const looped = await Effect.runPromise(adapter.snapshot());
    expect(looped.sessions.find((session) => session.nativeId === "mock-p03")?.runtimeState).toBe(
      "blocked",
    );
    expect(looped.sessions.find((session) => session.nativeId === "mock-p01")?.hostLocator).toBe(
      "mock-session:mock-p01",
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
    expect(access.target).toEqual({
      kind: "mock-session",
      token: "mock-p03",
    });
    expect(await Effect.runPromise(adapter.activate(access))).toEqual({
      ok: true,
      message: "Simulated focus for mock session mock-p03.",
    });

    clock.value += scenario.tickMs;
    await Effect.runPromise(adapter.snapshot());
    expect(
      (await Effect.runPromise(adapter.access({ hostKind: "mock", nativeId: "mock-p17" })))
        .supported,
    ).toBe(false);
    expect(
      (await Effect.runPromise(adapter.access({ hostKind: "herdr", nativeId: "mock-p03" })))
        .supported,
    ).toBe(false);
  });

  test("seeds a real goal-and-session portfolio only through Universe commands", async () => {
    const clock = new FixedClock(30_000);
    const { universe } = makeUniverse({ clock });
    const adapter = new MockHostAdapter({ clock });
    const snapshot = await Effect.runPromise(adapter.snapshot());
    expect(universe.reconcile(snapshot).accepted).toBe(true);

    expect(seedMockPortfolio(universe)).toEqual({
      createdGoals: 3,
      assignedSessions: 17,
    });
    const state = universe.snapshot();
    expect(state.goals.map((goal) => goal.priority)).toEqual(["P0", "P1", "P2"]);
    expect(state.sessions.filter((session) => session.primaryGoalId)).toHaveLength(17);
    expect(seedMockPortfolio(universe)).toEqual({
      createdGoals: 0,
      assignedSessions: 0,
    });
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
});
