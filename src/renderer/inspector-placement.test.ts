import { describe, expect, test } from "bun:test";
import { placeFloatingInspector } from "./inspector-placement.ts";

const viewport = { x: 0, y: 0, width: 100, height: 40 };

const overlaps = (
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): boolean =>
  first.x < second.x + second.width &&
  first.x + first.width > second.x &&
  first.y < second.y + second.height &&
  first.y + first.height > second.y;

describe("floating inspector placement", () => {
  test("keeps a goal inspector outside the selected goal", () => {
    const goal = { x: 40, y: 15, width: 17, height: 9 };
    const panel = placeFloatingInspector(
      viewport,
      { width: 38, height: 8 },
      { x: 48, y: 19 },
      [goal],
    );

    expect(overlaps(panel, goal)).toBe(false);
    expect(panel.x).toBeGreaterThanOrEqual(1);
    expect(panel.y).toBeGreaterThanOrEqual(1);
    expect(panel.x + panel.width).toBeLessThanOrEqual(99);
    expect(panel.y + panel.height).toBeLessThanOrEqual(39);
  });

  test("routes around a blocked side when another node occupies it", () => {
    const goal = { x: 40, y: 15, width: 17, height: 9 };
    const rightSatellite = { x: 60, y: 15, width: 12, height: 3 };
    const panel = placeFloatingInspector(
      viewport,
      { width: 38, height: 8 },
      { x: 48, y: 19 },
      [goal, rightSatellite],
    );

    expect(overlaps(panel, goal)).toBe(false);
    expect(overlaps(panel, rightSatellite)).toBe(false);
  });
});
