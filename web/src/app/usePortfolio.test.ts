import { describe, expect, test } from "bun:test";
import { FixedClock, makeUniverse } from "../../../src/universe/test-support.ts";
import type { PortfolioResponse } from "../../../src/web/api.ts";
import { advanceStreamCursor, createStreamRecovery, latestPortfolio } from "./usePortfolio.ts";

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
  test("does not let a stale refresh replace a newer accepted projection", () => {
    const staleRefresh = portfolioAt(1_000);
    const acceptedCommand = portfolioAt(2_000);

    expect(latestPortfolio(acceptedCommand, staleRefresh)).toBe(acceptedCommand);
  });

  test("accepts an equally recent or newer refresh", () => {
    const current = portfolioAt(1_000);
    const equallyRecent = portfolioAt(1_000);
    const newer = portfolioAt(2_000);

    expect(latestPortfolio(current, equallyRecent)).toBe(equallyRecent);
    expect(latestPortfolio(current, newer)).toBe(newer);
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

  test("rejects stale revisions but accepts a new server epoch", () => {
    const current = { epoch: "server-a", revision: 4 };

    expect(advanceStreamCursor(current, { epoch: "server-a", revision: 4 }).accept).toBe(false);
    expect(advanceStreamCursor(current, { epoch: "server-a", revision: 3 }).accept).toBe(false);
    expect(advanceStreamCursor(current, { epoch: "server-a", revision: 5 })).toEqual({
      accept: true,
      epochChanged: false,
    });
    expect(advanceStreamCursor(current, { epoch: "server-b", revision: 1 })).toEqual({
      accept: true,
      epochChanged: true,
    });
  });
});
