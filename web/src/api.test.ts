import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fetchSearch } from "./api.ts";

afterEach(() => {
  mock.restore();
});

describe("browser search client", () => {
  test("encodes the query and decodes the SearchProjection", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        kind: "search",
        query: "atlas & agent",
        results: [
          {
            type: "agent",
            id: "agent-a",
            label: "Atlas agent",
            context: "agent · goal-a",
            status: "working",
            goalId: "goal-a",
          },
        ],
      }),
    );

    const projection = await fetchSearch("atlas & agent");

    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=atlas%20%26%20agent", {
      signal: undefined,
    });
    expect(projection.results[0]).toMatchObject({
      type: "agent",
      id: "agent-a",
      goalId: "goal-a",
    });
  });

  test("rejects a malformed search response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ kind: "search", query: "atlas", results: [{ type: "workspace" }] }),
    );

    expect(fetchSearch("atlas")).rejects.toThrow();
  });
});
