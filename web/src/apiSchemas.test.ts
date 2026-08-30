import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { FixedClock, makeUniverse } from "../../src/universe/test-support.ts";
import { PortfolioResponseSchema, SearchProjectionSchema } from "./apiSchemas.ts";

const portfolioAt = (generatedAt: number) => {
  const { universe } = makeUniverse({ clock: new FixedClock(generatedAt) });
  const map = universe.project({ kind: "universe-map", now: generatedAt });
  const commandCentre = universe.project({ kind: "command-centre", now: generatedAt });
  const catchUp = universe.project({ kind: "catch-up", now: generatedAt });
  const closeout = universe.project({ kind: "closeout", now: generatedAt });
  if (
    map.kind !== "universe-map" ||
    commandCentre.kind !== "command-centre" ||
    catchUp.kind !== "catch-up" ||
    closeout.kind !== "closeout"
  )
    throw new Error("Expected portfolio projections.");
  return { map, commandCentre, catchUp, closeout };
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

  test("decodes search results and rejects invalid target types", () => {
    const decode = Schema.decodeUnknownSync(SearchProjectionSchema);
    expect(
      decode({
        kind: "search",
        query: "atlas",
        results: [
          {
            type: "agent",
            id: "agent-a",
            label: "Atlas",
            context: "agent · goal-a",
            status: "working",
            goalId: "goal-a",
          },
        ],
      }).results[0]?.goalId,
    ).toBe("goal-a");
    expect(() =>
      decode({
        kind: "search",
        query: "atlas",
        results: [{ type: "workspace", id: "bad", label: "Bad", context: "bad", status: "bad" }],
      }),
    ).toThrow();
  });
});
