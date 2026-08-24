import { describe, expect, test } from "bun:test";
import { displayHostKind, hasAgentCapability } from "./types.ts";

describe("host labels", () => {
  test("formats opaque host kinds without a provider-specific map", () => {
    expect(displayHostKind("herdr")).toBe("Herdr");
    expect(displayHostKind("super_logical")).toBe("Super Logical");
    expect(displayHostKind("  ")).toBe("Host");
  });

  test("checks only capabilities proven by the agent host", () => {
    const access = {
      supported: true,
      capabilities: ["embedded-terminal"] as const,
      linkedExecutions: [],
      explanation: "fixture",
    };
    expect(hasAgentCapability(access, "embedded-terminal")).toBe(true);
    expect(hasAgentCapability(access, "native-handoff")).toBe(false);
    expect(hasAgentCapability({ ...access, supported: false }, "embedded-terminal")).toBe(false);
  });
});
