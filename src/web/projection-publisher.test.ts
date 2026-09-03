import { describe, expect, test } from "bun:test";
import { ControlPlaneEventHub } from "../control-plane-events/index.ts";
import { FixedClock, makeUniverse } from "../universe/test-support.ts";
import { projectPortfolio, type PortfolioResponse } from "./portfolio.ts";
import { ProjectionPublisher } from "./projection-publisher.ts";

const portfolio = (generatedAt: number): PortfolioResponse => {
  const { universe } = makeUniverse({ clock: new FixedClock(generatedAt) });
  const projected = projectPortfolio(universe, generatedAt);
  if (!projected) throw new Error("Expected a portfolio projection.");
  return projected;
};

const request = () =>
  new Request("http://127.0.0.1:4310/api/projections/events", {
    headers: { host: "127.0.0.1:4310" },
  });

const eventData = (
  chunk: Uint8Array,
): { readonly kind: string; readonly revision: number; readonly affectedAll?: boolean } => {
  const text = new TextDecoder().decode(chunk);
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (!data) throw new Error("SSE event had no data.");
  return JSON.parse(data);
};

describe("projection publisher", () => {
  test("batches parallel control-plane changes into one shared projection replacement", async () => {
    const hub = new ControlPlaneEventHub();
    let calculations = 0;
    const publisher = new ProjectionPublisher({
      events: hub,
      projectPortfolio: () => portfolio(++calculations),
      pendingLaunches: () => [],
      now: () => calculations,
      allowedOrigin: "http://127.0.0.1:4310",
      batchMs: 5,
      timeRefreshMs: 60_000,
    });
    const reader = publisher.stream(request()).body!.getReader();
    expect(eventData((await reader.read()).value!)).toMatchObject({
      kind: "snapshot",
      revision: 1,
    });

    for (let index = 0; index < 100; index += 1)
      hub.publish([
        {
          type: "agent-changed",
          cause: "human-command",
          occurredAt: index,
          agentIds: [`agent-${index}`],
        },
      ]);

    expect(eventData((await reader.read()).value!)).toMatchObject({
      kind: "snapshot",
      revision: 2,
    });
    expect(calculations).toBe(2);
    await reader.cancel();
    publisher.close();
  });

  test("publishes pending launches without rebuilding the portfolio", async () => {
    const hub = new ControlPlaneEventHub();
    let calculations = 0;
    let pending = [
      { requestId: "request-1", harnessId: "claude", displayName: "Agent", message: "Starting" },
    ];
    const publisher = new ProjectionPublisher({
      events: hub,
      projectPortfolio: () => portfolio(++calculations),
      pendingLaunches: () => pending,
      now: () => 10,
      allowedOrigin: "http://127.0.0.1:4310",
      batchMs: 5,
      timeRefreshMs: 60_000,
    });
    const reader = publisher.stream(request()).body!.getReader();
    await reader.read();
    pending = [];
    hub.publish([
      {
        type: "pending-launch-changed",
        cause: "launch-operation",
        occurredAt: 10,
        requestIds: ["request-1"],
      },
    ]);
    expect(eventData((await reader.read()).value!)).toMatchObject({
      kind: "pending-launches-replaced",
      revision: 2,
    });
    expect(calculations).toBe(1);
    await reader.cancel();
    publisher.close();
  });

  test("keeps only the latest complete replacement for a slow subscriber", async () => {
    const hub = new ControlPlaneEventHub();
    let calculations = 0;
    const publisher = new ProjectionPublisher({
      events: hub,
      projectPortfolio: () => portfolio(++calculations),
      pendingLaunches: () => [],
      now: () => calculations,
      allowedOrigin: "http://127.0.0.1:4310",
      batchMs: 5,
      timeRefreshMs: 60_000,
    });
    const reader = publisher.stream(request()).body!.getReader();
    hub.publish([
      {
        type: "agent-changed",
        cause: "human-command",
        occurredAt: 1,
        agentIds: ["agent-1"],
      },
    ]);
    await Bun.sleep(10);
    hub.publish([
      {
        type: "agent-changed",
        cause: "human-command",
        occurredAt: 2,
        agentIds: ["agent-2"],
      },
    ]);
    await Bun.sleep(10);

    expect(eventData((await reader.read()).value!)).toMatchObject({ revision: 1 });
    expect(eventData((await reader.read()).value!)).toMatchObject({
      kind: "snapshot",
      revision: 3,
    });
    await reader.cancel();
    publisher.close();
  });

  test("retains the prior revision when projection calculation fails", async () => {
    const hub = new ControlPlaneEventHub();
    const errors: string[] = [];
    let fail = false;
    const publisher = new ProjectionPublisher({
      events: hub,
      projectPortfolio: () => portfolio(1),
      pendingLaunches: () => {
        if (fail) throw new Error("synthetic failure");
        return [];
      },
      now: () => 1,
      allowedOrigin: "http://127.0.0.1:4310",
      batchMs: 5,
      timeRefreshMs: 60_000,
      onError: (message) => errors.push(message),
    });
    const reader = publisher.stream(request()).body!.getReader();
    await reader.read();
    fail = true;
    hub.publish([
      {
        type: "pending-launch-changed",
        cause: "launch-operation",
        occurredAt: 1,
        requestIds: ["request-1"],
      },
    ]);
    await Bun.sleep(10);

    expect(publisher.current().revision).toBe(1);
    expect(errors).toEqual(["Projection publication failed: synthetic failure"]);
    expect((await reader.read()).done).toBe(true);
    publisher.close();
  });

  test("uses conservative affected metadata when one batch exceeds its subject bound", async () => {
    const hub = new ControlPlaneEventHub();
    const publisher = new ProjectionPublisher({
      events: hub,
      projectPortfolio: () => portfolio(1),
      pendingLaunches: () => [],
      now: () => 1,
      allowedOrigin: "http://127.0.0.1:4310",
      batchMs: 5,
      timeRefreshMs: 60_000,
    });
    const reader = publisher.stream(request()).body!.getReader();
    await reader.read();
    hub.publish([
      {
        type: "agent-changed",
        cause: "human-command",
        occurredAt: 1,
        agentIds: Array.from({ length: 501 }, (_, index) => `agent-${index}`),
      },
    ]);

    expect(eventData((await reader.read()).value!)).toMatchObject({
      revision: 2,
      affectedAll: true,
    });
    await reader.cancel();
    publisher.close();
  });

  test("protects the stream with the browser origin rules", () => {
    const hub = new ControlPlaneEventHub();
    const publisher = new ProjectionPublisher({
      events: hub,
      projectPortfolio: () => portfolio(1),
      pendingLaunches: () => [],
      now: () => 1,
      allowedOrigin: "http://127.0.0.1:4310",
    });
    expect(
      publisher.stream(
        new Request("http://evil.example/api/projections/events", {
          headers: { origin: "http://evil.example" },
        }),
      ).status,
    ).toBe(403);
    publisher.close();
  });
});
