import { describe, expect, test } from "bun:test";
import { FixedClock, makeUniverse } from "../../../src/universe/test-support.ts";
import type { PortfolioResponse } from "../../../src/web/api.ts";
import { latestPortfolio } from "./usePortfolio.ts";

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
