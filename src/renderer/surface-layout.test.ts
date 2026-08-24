import { describe, expect, test } from "bun:test";
import { layoutFor } from "./layout.ts";
import { surfaceLayoutFor } from "./surface-layout.ts";

describe("linkedExecution surface layout", () => {
  test("keeps the map visible beside a linkedExecution in map mode", () => {
    const layout = surfaceLayoutFor(layoutFor(140, 40), "map", false, true);
    expect(layout.map).toBeDefined();
    expect(layout.linkedExecution).toBeDefined();
    expect(layout.primary).toBeUndefined();
    expect(layout.map!.x + layout.map!.width).toBeLessThan(layout.linkedExecution!.x);
  });

  test("composes an agent terminal and linkedExecution in review mode", () => {
    const layout = surfaceLayoutFor(layoutFor(140, 40), "review", true, true);
    expect(layout.map).toBeUndefined();
    expect(layout.primary).toBeDefined();
    expect(layout.linkedExecution).toBeDefined();
    expect(layout.primary!.x + layout.primary!.width).toBeLessThan(layout.linkedExecution!.x);
  });

  test("uses a compact vertical split for a narrow terminal", () => {
    const layout = surfaceLayoutFor(layoutFor(50, 40), "review", true, true);
    expect(layout.direction).toBe("vertical");
    expect(layout.primary!.y + layout.primary!.height).toBeLessThan(layout.linkedExecution!.y);
  });
});
