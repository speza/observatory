import { describe, expect, test } from "bun:test";
import { displayHostKind, hasSessionCapability } from "./types.ts";

describe("host labels", () => {
  test("formats opaque host kinds without a provider-specific map", () => {
    expect(displayHostKind("herdr")).toBe("Herdr");
    expect(displayHostKind("super_logical")).toBe("Super Logical");
    expect(displayHostKind("  ")).toBe("Host");
  });

  test("checks only capabilities proven by the session host", () => {
    const access = {
      supported: true,
      capabilities: ["embedded-terminal"] as const,
      explanation: "fixture",
    };
    expect(hasSessionCapability(access, "embedded-terminal")).toBe(true);
    expect(hasSessionCapability(access, "native-handoff")).toBe(false);
    expect(hasSessionCapability({ ...access, supported: false }, "embedded-terminal")).toBe(false);
  });
});
