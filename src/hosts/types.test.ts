import { describe, expect, test } from "bun:test";
import { displayHostKind } from "./types.ts";

describe("host labels", () => {
  test("formats opaque host kinds without a provider-specific map", () => {
    expect(displayHostKind("herdr")).toBe("Herdr");
    expect(displayHostKind("super_logical")).toBe("Super Logical");
    expect(displayHostKind("  ")).toBe("Host");
  });
});
