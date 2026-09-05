import { describe, expect, test } from "bun:test";
import { FixedClock, makeUniverse } from "../../../src/universe/test-support.ts";
import type { PortfolioResponse } from "../../../src/web/api.ts";
import { createStreamRecovery, portfolioDelivery, reconcilePortfolio } from "./usePortfolio.ts";

const portfolioAt = (generatedAt: number): PortfolioResponse => {
  const { universe } = makeUniverse({ clock: new FixedClock(generatedAt) });
  const map = universe.project({ kind: "universe-map", now: generatedAt });
  const commandCentre = universe.project({ kind: "command-centre", now: generatedAt });
  const catchUp = universe.project({ kind: "catch-up", now: generatedAt });
  if (
    map.kind !== "universe-map" ||
    commandCentre.kind !== "command-centre" ||
    catchUp.kind !== "catch-up"
  )
    throw new Error("Expected portfolio projections.");
  return { map, commandCentre, catchUp };
};

describe("portfolio refresh ordering", () => {
  const launch = {
    requestId: "launch",
    harnessId: "mock",
    displayName: "Pending",
    message: "Waiting",
  };
  const delivery = (
    revision: number,
    epoch = "a",
    pendingLaunches = [launch],
    generatedAt = 1_000,
  ) => portfolioDelivery({ ...portfolioAt(generatedAt), epoch, revision, pendingLaunches });

  test("rejects late HTTP and SSE responses even with equal or higher timestamps", () => {
    const current = reconcilePortfolio({}, delivery(3));
    expect(reconcilePortfolio(current, delivery(2))).toBe(current);
    expect(reconcilePortfolio(current, delivery(3, "a", [], 9_000))).toBe(current);
    expect(reconcilePortfolio(current, delivery(4, "a", [], 500)).portfolioRevision).toBe(4);
  });

  test("reconciles launch replies without resurrecting resolved pending launches", () => {
    const started = reconcilePortfolio({}, delivery(2));
    expect(started.pendingLaunches).toEqual([launch]);
    const resolved = reconcilePortfolio(started, delivery(4, "a", []));
    expect(reconcilePortfolio(resolved, delivery(2), false)).toBe(resolved);
    expect(resolved.pendingLaunches).toEqual([]);
  });

  test("fills a missing portfolio without overwriting a newer pending replacement", () => {
    const pending = reconcilePortfolio(
      {},
      {
        kind: "pending-launches-replaced",
        epoch: "a",
        revision: 5,
        generatedAt: 1_000,
        pendingLaunches: [],
        affected: [],
        affectedAll: false,
      },
    );
    const recovered = reconcilePortfolio(pending, delivery(4));
    expect(recovered.data).toBeDefined();
    expect(recovered.pendingLaunches).toEqual([]);
    expect(recovered.pendingRevision).toBe(5);
  });

  test("restart resets both slices and permanently rejects the retired epoch", () => {
    const old = reconcilePortfolio({}, delivery(20));
    const restarted = reconcilePortfolio(old, {
      kind: "pending-launches-replaced",
      epoch: "b",
      revision: 2,
      generatedAt: 1,
      pendingLaunches: [],
      affected: [],
      affectedAll: false,
    });
    expect(restarted.data).toBeUndefined();
    expect(reconcilePortfolio(restarted, delivery(99))).toBe(restarted);
    const recovered = reconcilePortfolio(restarted, delivery(1, "b", [], 1));
    expect(recovered.data?.map.generatedAt).toBe(1);
    expect(recovered.pendingRevision).toBe(2);
  });

  test("command replies cannot switch an established epoch; recovery can", () => {
    const current = reconcilePortfolio({}, delivery(3, "b"));
    expect(reconcilePortfolio(current, delivery(20, "a"), false)).toBe(current);
    expect(reconcilePortfolio(current, delivery(1, "c")).epoch).toBe("c");
  });
});

describe("browser projection stream recovery", () => {
  test("uses REST only when the initial stream stalls", () => {
    let timer: (() => void) | undefined;
    const fireTimer = (): void => timer?.();
    let recoveries = 0;
    const recovery = createStreamRecovery({
      recover: () => (recoveries += 1),
      setTimer: (callback) => {
        timer = callback;
        return 1;
      },
      clearTimer: () => (timer = undefined),
    });

    recovery.start();
    expect(recoveries).toBe(0);
    fireTimer();
    expect(recoveries).toBe(1);

    timer = undefined;
    recovery.start();
    recovery.received();
    fireTimer();
    expect(recoveries).toBe(1);
  });

  test("bounds REST recovery while the stream reconnects", () => {
    let now = 1_000;
    let recoveries = 0;
    const recovery = createStreamRecovery({
      now: () => now,
      recover: () => (recoveries += 1),
      setTimer: () => 1,
      clearTimer: () => {},
    });

    recovery.unavailable();
    recovery.unavailable();
    expect(recoveries).toBe(1);
    now += 30_000;
    recovery.unavailable();
    expect(recoveries).toBe(2);
  });
});
