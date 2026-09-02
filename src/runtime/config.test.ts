import { describe, expect, test } from "bun:test";
import { positiveIntegerSetting } from "./config.ts";

describe("runtime configuration", () => {
  test("uses a fallback and accepts bounded integers", () => {
    expect(positiveIntegerSetting("TEST_SETTING", undefined, 20)).toBe(20);
    expect(positiveIntegerSetting("TEST_SETTING", "250", 20, { minimum: 100, maximum: 500 })).toBe(
      250,
    );
  });

  test("rejects zero, fractions, non-numbers and out-of-range values", () => {
    for (const value of ["0", "1.5", "nope", "501"])
      expect(() =>
        positiveIntegerSetting("TEST_SETTING", value, 20, { minimum: 1, maximum: 500 }),
      ).toThrow("TEST_SETTING must be an integer");
  });
});
