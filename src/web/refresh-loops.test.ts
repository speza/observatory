import { describe, expect, test } from "bun:test";
import { startObservatoryRefreshLoops } from "./refresh-loops.ts";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("observatory refresh loops", () => {
  test("refreshes host, observations and provider catalogue on their intervals", async () => {
    const calls = { host: 0, observations: 0, provider: 0 };
    const loops = startObservatoryRefreshLoops({
      refreshMs: 5,
      observationRefreshMs: 5,
      providerRefreshMs: 5,
      useMockHost: false,
      targets: {
        refreshHost: async () => {
          calls.host += 1;
        },
        refreshObservations: async () => {
          calls.observations += 1;
        },
        refreshProvider: async () => {
          calls.provider += 1;
        },
      },
      onError: () => undefined,
    });

    await wait(30);
    loops.stop();

    expect(calls.host).toBeGreaterThanOrEqual(2);
    expect(calls.observations).toBeGreaterThanOrEqual(2);
    expect(calls.provider).toBeGreaterThanOrEqual(2);
  });

  test("skips provider and observation refreshes for the mock host", async () => {
    const calls = { host: 0, observations: 0, provider: 0 };
    const loops = startObservatoryRefreshLoops({
      refreshMs: 5,
      providerRefreshMs: 5,
      useMockHost: true,
      targets: {
        refreshHost: async () => {
          calls.host += 1;
        },
        refreshObservations: async () => {
          calls.observations += 1;
        },
        refreshProvider: async () => {
          calls.provider += 1;
        },
      },
      onError: () => undefined,
    });

    await wait(20);
    loops.stop();

    expect(calls.host).toBeGreaterThanOrEqual(1);
    expect(calls.observations).toBe(0);
    expect(calls.provider).toBe(0);
  });

  test("reports a failing loop without stopping the others", async () => {
    const errors: string[] = [];
    let provider = 0;
    const loops = startObservatoryRefreshLoops({
      refreshMs: 5,
      providerRefreshMs: 5,
      useMockHost: false,
      targets: {
        refreshHost: async () => {
          throw new Error("synthetic host failure");
        },
        refreshObservations: async () => undefined,
        refreshProvider: async () => {
          provider += 1;
        },
      },
      onError: (message, scope) => errors.push(`${scope}:${message}`),
    });

    await wait(20);
    loops.stop();

    expect(errors.some((entry) => entry === "host:synthetic host failure")).toBe(true);
    expect(provider).toBeGreaterThanOrEqual(2);
  });

  test("stops scheduling refreshes once stopped", async () => {
    let host = 0;
    const loops = startObservatoryRefreshLoops({
      refreshMs: 5,
      providerRefreshMs: 5,
      useMockHost: true,
      targets: {
        refreshHost: async () => {
          host += 1;
        },
        refreshObservations: async () => undefined,
        refreshProvider: async () => undefined,
      },
      onError: () => undefined,
    });

    await wait(15);
    loops.stop();
    const atStop = host;
    await wait(20);

    expect(host).toBeLessThanOrEqual(atStop + 1);
  });
});
