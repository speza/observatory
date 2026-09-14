import { describe, expect, test } from "bun:test";
import { batchDestinationValue, parseBatchDestination } from "./batchDestination.ts";

describe("batch destination encoding", () => {
  test("round-trips each destination kind", () => {
    for (const destination of [
      { kind: "inbox" as const },
      { kind: "goal" as const, id: "goal-1" },
      { kind: "system" as const, id: "system-1" },
    ])
      expect(parseBatchDestination(batchDestinationValue(destination))).toEqual(destination);
  });

  test("keeps an id that contains the separator intact", () => {
    // The reserved Default System is `system:default`; only the first separator
    // separates the kind from the id.
    const value = batchDestinationValue({ kind: "system", id: "system:default" });
    expect(value).toBe("system:system:default");
    expect(parseBatchDestination(value)).toEqual({ kind: "system", id: "system:default" });
    expect(parseBatchDestination(batchDestinationValue({ kind: "goal", id: "a:b:c" }))).toEqual({
      kind: "goal",
      id: "a:b:c",
    });
  });

  test("rejects an empty choice, an unknown kind and a missing id", () => {
    expect(parseBatchDestination("")).toBeUndefined();
    expect(parseBatchDestination(":goal-1")).toBeUndefined();
    expect(parseBatchDestination("workspace:1")).toBeUndefined();
    expect(parseBatchDestination("goal:")).toBeUndefined();
    expect(parseBatchDestination("inbox:")).toBeUndefined();
  });
});
