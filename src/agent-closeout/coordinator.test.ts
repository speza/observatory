import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { createMockScenario } from "../hosts/mock/scenarios.ts";
import type { SessionHost } from "../hosts/types.ts";
import { makeUniverse } from "../universe/test-support.ts";
import { createAgentCloseoutCoordinator } from "./coordinator.ts";

describe("Agent closeout coordinator", () => {
  test("closes a live host execution, reconciles absence, then archives it", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock, scenario: createMockScenario() });
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected a mock Agent.");
    const coordinator = createAgentCloseoutCoordinator({ universe: fixture.universe, host });

    const result = await Effect.runPromise(coordinator.closeAndArchive(agent.id));

    expect(result).toMatchObject({ ok: true, status: "closed-and-archived" });
    expect(fixture.universe.snapshot().agents[0]).toMatchObject({
      hostHealth: "stale",
      archivedAt: fixture.clock.now(),
    });
    expect(
      (await Effect.runPromise(host.snapshot())).agents.some(
        (candidate) => candidate.nativeId === agent.execution?.nativeId,
      ),
    ).toBe(false);
  });

  test("still closes a live host execution whose Observatory record was already archived", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock, scenario: createMockScenario() });
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent?.execution) throw new Error("Expected a live mock Agent.");
    expect(fixture.universe.execute({ type: "ArchiveAgent", agentId: agent.id }).ok).toBe(true);
    const coordinator = createAgentCloseoutCoordinator({ universe: fixture.universe, host });

    const result = await Effect.runPromise(coordinator.closeAndArchive(agent.id));

    expect(result).toMatchObject({ ok: true, status: "closed-and-archived" });
    expect(result.message).toContain("already archived");
    expect(
      (await Effect.runPromise(host.snapshot())).agents.some(
        (candidate) => candidate.nativeId === agent.execution?.nativeId,
      ),
    ).toBe(false);
  });

  test("archives a confirmed stale Agent without requesting another host close", async () => {
    const fixture = makeUniverse();
    const scenario = createMockScenario();
    const host = new MockHostAdapter({ clock: fixture.clock, scenario });
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected a mock Agent.");
    if (!agent.execution) throw new Error("Expected a mock execution.");
    await Effect.runPromise(host.closeAgent(await Effect.runPromise(host.access(agent.execution))));
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const coordinator = createAgentCloseoutCoordinator({ universe: fixture.universe, host });

    const result = await Effect.runPromise(coordinator.closeAndArchive(agent.id));

    expect(result).toMatchObject({ ok: true, status: "already-ended-and-archived" });
  });

  test("does not downgrade a live close request to archive-only when the target disappears", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock, scenario: createMockScenario() });
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent?.execution) throw new Error("Expected a live mock Agent.");
    await Effect.runPromise(host.closeAgent(await Effect.runPromise(host.access(agent.execution))));
    const coordinator = createAgentCloseoutCoordinator({ universe: fixture.universe, host });

    const result = await Effect.runPromise(coordinator.closeAndArchive(agent.id));

    expect(result).toMatchObject({ ok: false, status: "rejected" });
    expect(result.message).toContain("Nothing was closed or archived");
    expect(fixture.universe.snapshot().agents[0]?.archivedAt).toBeUndefined();
  });

  test("fails closed while the host is unavailable", async () => {
    const fixture = makeUniverse();
    const unavailableHost = new MockHostAdapter({ clock: fixture.clock });
    fixture.universe.reconcile(await Effect.runPromise(unavailableHost.snapshot()));
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected a mock Agent.");
    const host: SessionHost = {
      snapshot: () =>
        Effect.succeed({
          hostKind: "mock",
          hostInstanceId: "mock:default",
          available: false,
          observedAt: fixture.clock.now(),
          agents: [],
          diagnostics: [],
          error: "Host offline.",
        }),
      launchExecution: (request) => unavailableHost.launchExecution(request),
      access: (agentRef) => unavailableHost.access(agentRef),
      activate: (access) => unavailableHost.activate(access),
      closeAgent: (access) => unavailableHost.closeAgent(access),
      openTerminal: (access, dimensions, options) =>
        unavailableHost.openTerminal(access, dimensions, options),
      openLinkedExecutionTerminal: (execution, dimensions, options) =>
        unavailableHost.openLinkedExecutionTerminal(execution, dimensions, options),
    };
    const coordinator = createAgentCloseoutCoordinator({ universe: fixture.universe, host });

    expect(await Effect.runPromise(coordinator.closeAndArchive(agent.id))).toMatchObject({
      ok: false,
      message: "Host offline.",
    });
    expect(fixture.universe.snapshot().agents[0]?.archivedAt).toBeUndefined();
  });
});
