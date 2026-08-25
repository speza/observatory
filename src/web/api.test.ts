import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { hostSnapshot, makeUniverse } from "../universe/test-support.ts";
import { ObservatoryWebApi, type PortfolioResponse } from "./api.ts";
import type { WebCommand, WebCommandResponse, WebTerminalOpenResponse } from "./protocol.ts";

type TerminalTestBody =
  | {
      readonly agentId: string;
      readonly dimensions: { readonly columns: number; readonly rows: number };
    }
  | { readonly value: string }
  | {
      readonly kind: "scroll";
      readonly direction: "up" | "down";
      readonly lines: number;
      readonly source: "wheel" | "page-key";
    }
  | { readonly columns: number; readonly rows: number }
  | { readonly release?: never };

describe("ObservatoryWebApi", () => {
  test("serves the map and command-centre projections from one Universe", async () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Atlas",
          runtimeState: "blocked",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const goal = fixture.universe.execute({
      type: "CreateGoal",
      id: "goal-a",
      title: "Understand concurrent work",
      priority: "P0",
    });
    expect(goal.ok).toBe(true);
    const agentId = fixture.universe.snapshot().agents[0]?.id;
    expect(agentId).toBeDefined();
    if (!agentId) throw new Error("Expected reconciled agent.");
    expect(fixture.universe.execute({ type: "AssignAgent", agentId, goalId: "goal-a" }).ok).toBe(
      true,
    );

    const api = new ObservatoryWebApi(fixture.universe, fixture.clock);
    const response = await api.fetch(new Request("http://localhost/api/portfolio"));
    const body: PortfolioResponse = await response.json();

    expect(response.status).toBe(200);
    expect(body.map.goals[0]?.title).toBe("Understand concurrent work");
    expect(body.map.goals[0]?.agents[0]?.displayName).toBe("Atlas");
    expect(body.commandCentre.attention.currentCount).toBe(1);
  });

  test("serves inspector projections and rejects writes outside the command endpoint", async () => {
    const fixture = makeUniverse();
    expect(
      fixture.universe.execute({
        type: "CreateGoal",
        id: "goal-a",
        title: "Understand concurrent work",
        priority: "P0",
      }).ok,
    ).toBe(true);
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock);

    const inspector = await api.fetch(
      new Request("http://localhost/api/inspector?type=goal&id=goal-a"),
    );
    const write = await api.fetch(
      new Request("http://localhost/api/portfolio", { method: "POST" }),
    );

    expect(inspector.status).toBe(200);
    expect((await inspector.json()).kind).toBe("goal-inspector");
    expect(write.status).toBe(405);
  });

  test("requires same-origin JSON with an explicit command header", async () => {
    const fixture = makeUniverse();
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock, "http://localhost");
    const body = JSON.stringify({ type: "CreateGoal", title: "A goal", priority: "P1" });

    const noOrigin = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ao-command": "1" },
        body,
      }),
    );
    const foreignOrigin = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "x-ao-command": "1",
        },
        body,
      }),
    );
    const noIntent = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body,
      }),
    );

    expect(noOrigin.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
    expect(noIntent.status).toBe(403);
    expect(fixture.universe.snapshot().goals).toHaveLength(0);
  });

  test("executes the browser command allow-list and returns a refreshed portfolio", async () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Atlas",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const agentId = fixture.universe.snapshot().agents[0]?.id;
    if (!agentId) throw new Error("Expected reconciled agent.");
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock, "http://localhost");
    const command = async (body: WebCommand): Promise<Response> =>
      api.fetch(
        new Request("http://localhost/api/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-ao-command": "1",
          },
          body: JSON.stringify(body),
        }),
      );

    const created = await command({
      type: "CreateGoal",
      title: "Build the command loop",
      description: "Human-authored control through the Universe.",
      priority: "P1",
    });
    expect(created.status).toBe(200);
    const createdBody: WebCommandResponse = await created.json();
    const goalId = createdBody.result.goalId;
    if (!goalId) throw new Error("Expected created goal id.");
    expect(createdBody.portfolio.commandCentre.goals[0]?.title).toBe("Build the command loop");

    expect((await command({ type: "AssignAgent", agentId, goalId })).status).toBe(200);
    expect((await command({ type: "SetGoalPriority", goalId, priority: "P0" })).status).toBe(200);
    expect((await command({ type: "UnassignAgent", agentId })).status).toBe(200);
    fixture.clock.value += 1_000;
    fixture.universe.reconcile(hostSnapshot([], fixture.clock.now()));
    expect((await command({ type: "ArchiveAgent", agentId })).status).toBe(200);
    expect((await command({ type: "CompleteGoal", goalId })).status).toBe(200);
    const archived = await command({ type: "ArchiveGoal", goalId });
    const acknowledged = await command({ type: "AcknowledgeCatchUp" });
    const acknowledgedBody: WebCommandResponse = await acknowledged.json();

    expect(archived.status).toBe(200);
    expect(acknowledgedBody.portfolio.catchUp.pending).toBe(false);
    expect(fixture.universe.snapshot().goals[0]?.status).toBe("archived");
  });

  test("rejects malformed, unsupported, and domain-invalid commands", async () => {
    const fixture = makeUniverse();
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock, "http://localhost");
    const request = (body: string): Promise<Response> =>
      api.fetch(
        new Request("http://localhost/api/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-ao-command": "1",
          },
          body,
        }),
      );

    expect((await request("not-json")).status).toBe(400);
    expect((await request(JSON.stringify({ type: "SetGoalMapPosition" }))).status).toBe(400);
    expect((await request(JSON.stringify({ type: "ArchiveGoal", goalId: "missing" }))).status).toBe(
      409,
    );
  });

  test("streams a host-owned terminal without exposing the host adapter to the client", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const agent = fixture.universe
      .snapshot()
      .agents.find((candidate) => candidate.nativeId === "mock-p01");
    if (!agent) throw new Error("Expected the deterministic mock agent.");
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock, "http://localhost", host);
    const mutation = (path: string, body: TerminalTestBody): Promise<Response> =>
      api.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-ao-command": "1",
          },
          body: JSON.stringify(body),
        }),
      );

    const opened = await mutation("/api/terminal/open", {
      agentId: agent.id,
      dimensions: { columns: 80, rows: 24 },
    });
    expect(opened.status).toBe(200);
    const openedBody: WebTerminalOpenResponse = await opened.json();
    const sessionId = openedBody.sessionId;
    const events = await api.fetch(
      new Request(`http://localhost/api/terminal/${sessionId}/events`),
    );
    const first = await events.body?.getReader().read();
    expect(new TextDecoder().decode(first?.value)).toContain("frame");
    expect(
      (
        await mutation(`/api/terminal/${sessionId}/input`, {
          value: "hello",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutation(`/api/terminal/${sessionId}/input`, {
          kind: "scroll",
          direction: "up",
          lines: 12,
          source: "page-key",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutation(`/api/terminal/${sessionId}/resize`, {
          columns: 100,
          rows: 30,
        })
      ).status,
    ).toBe(200);
    expect((await mutation(`/api/terminal/${sessionId}/release`, {})).status).toBe(200);
    await api.close();
  });

  test("protects terminal mutations with the browser command boundary", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    fixture.universe.reconcile(await Effect.runPromise(host.snapshot()));
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected a deterministic mock agent.");
    const api = new ObservatoryWebApi(fixture.universe, fixture.clock, "http://localhost", host);
    const response = await api.fetch(
      new Request("http://localhost/api/terminal/open", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "x-ao-command": "1",
        },
        body: JSON.stringify({
          agentId: agent.id,
          dimensions: { columns: 80, rows: 24 },
        }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
