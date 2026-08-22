import { describe, expect, test } from "bun:test";
import { layoutFor } from "./layout.ts";

describe("TUI layout", () => {
  test("keeps the spatial map primary at 80x24", () => {
    const layout = layoutFor(80, 24);
    expect(layout.compact).toBe(true);
    expect(layout.inspector).toBeUndefined();
    expect(layout.map.x).toBe(0);
    expect(layout.map.width).toBe(80);
    expect(layout.list.width).toBe(80);
    expect(layout.map.height).toBeGreaterThan(0);
    expect(layout.footer.y + layout.footer.height).toBe(24);
  });

  test("keeps the spatial surface full width in a wide terminal", () => {
    const layout = layoutFor(140, 35);
    expect(layout.compact).toBe(false);
    expect(layout.inspector).toBeUndefined();
    expect(layout.map.x).toBe(0);
    expect(layout.map.width).toBe(140);
    expect(layout.list.width).toBe(140);
  });

  test("does not produce negative rectangles for a tiny terminal", () => {
    const layout = layoutFor(10, 4);
    for (const panel of [
      layout.header,
      layout.attention,
      layout.list,
      layout.inspector,
      layout.footer,
    ]) {
      if (panel) expect(panel.width).toBeGreaterThanOrEqual(0);
      if (panel) expect(panel.height).toBeGreaterThanOrEqual(0);
    }
  });
});
