import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { FixedClock, makeUniverse } from "../../src/universe/test-support.ts";
import { PortfolioResponseSchema } from "./apiSchemas.ts";

const portfolioAt = (generatedAt: number) => {
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

const decodePortfolioJson = Schema.decodeUnknownSync(Schema.parseJson(PortfolioResponseSchema));

describe("browser API response schemas", () => {
  test("decodes a serialized production portfolio with no observed host", () => {
    const decoded = decodePortfolioJson(JSON.stringify(portfolioAt(1_000)));

    expect(decoded.map.host).toBeUndefined();
    expect(decoded.commandCentre.host).toBeUndefined();
  });

  test("rejects malformed nested projection data", () => {
    const portfolio = portfolioAt(1_000);
    const malformed = {
      ...portfolio,
      map: { ...portfolio.map, inboxPosition: { x: "not-a-number", y: 0 } },
    };

    expect(() => decodePortfolioJson(JSON.stringify(malformed))).toThrow();
  });
});
