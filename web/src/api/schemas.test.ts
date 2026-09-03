import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { FixedClock, makeUniverse } from "../../../src/universe/test-support.ts";
import {
  BrowserProjectionEventSchema,
  PortfolioResponseSchema,
  SearchProjectionSchema,
} from "./schemas.ts";

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

  test("decodes renderer projection stream snapshots", () => {
    const decode = Schema.decodeUnknownSync(Schema.parseJson(BrowserProjectionEventSchema));
    expect(
      decode(
        JSON.stringify({
          kind: "snapshot",
          epoch: "epoch-1",
          revision: 1,
          generatedAt: 1_000,
          portfolio: portfolioAt(1_000),
          pendingLaunches: [],
          affected: [],
          affectedAll: false,
        }),
      ).kind,
    ).toBe("snapshot");
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
