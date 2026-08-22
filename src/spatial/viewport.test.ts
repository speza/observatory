import { describe, expect, test } from "bun:test";
import {
  fitViewportToPoints,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  panViewport,
  screenPointForWorld,
  zoomViewportAt,
} from "./viewport.ts";

const bounds = { x: 1, y: 1, width: 78, height: 15 };
const scale = { x: 0.5, y: 0.25 };

describe("spatial viewport", () => {
  test("projects the world centre into the map centre", () => {
    expect(
      screenPointForWorld(
        { x: 0, y: 0 },
        { center: { x: 0, y: 0 }, zoom: 1 },
        bounds,
        scale,
      ),
    ).toEqual({ x: 40, y: 9 });
  });

  test("pans by the requested cell delta in world space", () => {
    expect(
      panViewport({ center: { x: 0, y: 0 }, zoom: 1 }, { x: -5, y: 2 }, scale)
        .center,
    ).toEqual({ x: -10, y: 8 });
  });

  test("keeps the pointer world point stable while zooming", () => {
    const before = { center: { x: 4, y: -3 }, zoom: 1 } as const;
    const anchor = { x: 57, y: 6 };
    const worldBefore = {
      x: before.center.x + (anchor.x - 40) / scale.x,
      y: before.center.y + (anchor.y - 8.5) / scale.y,
    };
    const after = zoomViewportAt(before, 1.1, anchor, bounds, scale);
    const nextScale = { x: scale.x * 1.1, y: scale.y * 1.1 };
    const worldAfter = {
      x: after.center.x + (anchor.x - 40) / nextScale.x,
      y: after.center.y + (anchor.y - 8.5) / nextScale.y,
    };
    expect(after.zoom).toBe(1.1);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  test("clamps zoom to the portable map range", () => {
    const state = { center: { x: 0, y: 0 }, zoom: 1 } as const;
    expect(
      zoomViewportAt(state, 0.01, { x: 40, y: 8 }, bounds, scale).zoom,
    ).toBe(MIN_MAP_ZOOM);
    expect(zoomViewportAt(state, 99, { x: 40, y: 8 }, bounds, scale).zoom).toBe(
      MAX_MAP_ZOOM,
    );
  });

  test("fits the current world content without changing its centre", () => {
    const fit = fitViewportToPoints(
      [
        { x: -24, y: 16 },
        { x: -10, y: 8 },
        { x: 0, y: 0 },
      ],
      { x: 0, y: 0, width: 80, height: 40 },
      { x: 0.5, y: 0.3 },
      10,
    );
    expect(fit.center).toEqual({ x: -12, y: 8 });
    expect(fit.zoom).toBeGreaterThanOrEqual(MIN_MAP_ZOOM);
    expect(fit.zoom).toBeLessThanOrEqual(MAX_MAP_ZOOM);
    const projected = screenPointForWorld(
      { x: -24, y: 16 },
      fit,
      { x: 0, y: 0, width: 80, height: 40 },
      { x: 0.5 * fit.zoom, y: 0.3 * fit.zoom },
    );
    expect(projected.x).toBeGreaterThanOrEqual(10);
    expect(projected.y).toBeGreaterThanOrEqual(10);
  });
});
