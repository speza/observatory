import { describe, expect, test } from "bun:test";
import { ControlPlaneEventHub } from "./index.ts";

describe("control-plane event hub", () => {
  test("orders, normalizes and isolates committed event batches", () => {
    const hub = new ControlPlaneEventHub();
    const received: string[] = [];
    hub.subscribe(() => {
      throw new Error("listener failure");
    });
    hub.subscribe((events) => {
      received.push(...events.map((event) => `${event.sequence}:${event.type}`));
    });

    hub.publish([
      {
        type: "agent-changed",
        cause: "human-command",
        occurredAt: 10,
        agentIds: ["agent-2", "agent-1", "agent-2", ""],
      },
      {
        type: "goal-changed",
        cause: "human-command",
        occurredAt: 10,
        goalIds: [],
      },
    ]);

    expect(received).toEqual(["1:agent-changed"]);
    expect(hub.cursor().sequence).toBe(1);
  });

  test("chunks large affected sets without silently losing identities", () => {
    const hub = new ControlPlaneEventHub();
    const received: string[] = [];
    hub.subscribe((events) => {
      for (const event of events)
        if (event.type === "agent-changed") received.push(...event.agentIds);
    });
    const agentIds = Array.from({ length: 501 }, (_, index) => `agent-${index}`);

    hub.publish([{ type: "agent-changed", cause: "human-command", occurredAt: 10, agentIds }]);

    expect(received).toHaveLength(501);
    expect(new Set(received)).toEqual(new Set(agentIds));
    expect(hub.cursor().sequence).toBe(2);
  });

  test("queues reentrant publication after the current listener pass", () => {
    const hub = new ControlPlaneEventHub();
    const order: string[] = [];
    let reentered = false;
    hub.subscribe((events) => {
      order.push(`first:${events[0]!.sequence}`);
      if (!reentered) {
        reentered = true;
        hub.publish([
          {
            type: "pending-launch-changed",
            cause: "launch-operation",
            occurredAt: 20,
            requestIds: ["request-1"],
          },
        ]);
      }
    });
    hub.subscribe((events) => order.push(`second:${events[0]!.sequence}`));

    hub.publish([
      {
        type: "system-changed",
        cause: "human-command",
        occurredAt: 10,
        systemIds: ["system-1"],
      },
    ]);

    expect(order).toEqual(["first:1", "second:1", "first:2", "second:2"]);
  });

  test("unsubscribes without retaining a listener", () => {
    const hub = new ControlPlaneEventHub();
    let calls = 0;
    const unsubscribe = hub.subscribe(() => {
      calls += 1;
    });
    unsubscribe();
    hub.publish([
      {
        type: "catch-up-changed",
        cause: "human-command",
        occurredAt: 10,
        semanticSequence: 1,
      },
    ]);
    expect(calls).toBe(0);
  });
});
