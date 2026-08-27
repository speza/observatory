import { describe, expect, test } from "bun:test";
import { boundWebTerminalDimensions, WEB_TERMINAL_DIMENSION_LIMITS } from "./protocol.ts";

describe("web terminal dimensions", () => {
  test("bounds massive and tiny viewports to the shared terminal contract", () => {
    expect(boundWebTerminalDimensions({ columns: 20_000, rows: 8_000 })).toEqual({
      columns: WEB_TERMINAL_DIMENSION_LIMITS.maxColumns,
      rows: WEB_TERMINAL_DIMENSION_LIMITS.maxRows,
    });
    expect(boundWebTerminalDimensions({ columns: 0, rows: 0 })).toEqual({
      columns: WEB_TERMINAL_DIMENSION_LIMITS.minColumns,
      rows: WEB_TERMINAL_DIMENSION_LIMITS.minRows,
    });
  });
});
