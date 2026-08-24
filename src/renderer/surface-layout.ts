import type { Rect, TuiLayout } from "./layout.ts";

export type SurfacePresentation = "map" | "review";

export interface SurfaceLayout {
  readonly map: Rect | undefined;
  readonly primary: Rect | undefined;
  readonly linkedExecution: Rect | undefined;
  readonly direction: "horizontal" | "vertical" | "none";
}

interface SurfaceSplit {
  readonly first: Rect;
  readonly second: Rect;
  readonly direction: "horizontal" | "vertical";
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width: Math.max(0, width),
  height: Math.max(0, height),
});

const split = (surface: Rect): SurfaceSplit => {
  const gap = 1;
  const horizontal = surface.width >= 100 || surface.width >= surface.height * 2;
  if (horizontal) {
    const firstWidth = Math.floor(Math.max(0, surface.width - gap) / 2);
    return {
      first: rect(surface.x, surface.y, firstWidth, surface.height),
      second: rect(
        surface.x + firstWidth + gap,
        surface.y,
        surface.width - firstWidth - gap,
        surface.height,
      ),
      direction: "horizontal",
    };
  }
  const firstHeight = Math.floor(Math.max(0, surface.height - gap) / 2);
  return {
    first: rect(surface.x, surface.y, surface.width, firstHeight),
    second: rect(
      surface.x,
      surface.y + firstHeight + gap,
      surface.width,
      surface.height - firstHeight - gap,
    ),
    direction: "vertical",
  };
};

/** Compose the map/review surfaces without changing the durable topology. */
export const surfaceLayoutFor = (
  layout: TuiLayout,
  presentation: SurfacePresentation,
  hasPrimary: boolean,
  hasLinkedExecution: boolean,
): SurfaceLayout => {
  const surface = layout.map;
  if (!hasLinkedExecution)
    return presentation === "review" && hasPrimary
      ? { map: undefined, primary: surface, linkedExecution: undefined, direction: "none" }
      : { map: surface, primary: undefined, linkedExecution: undefined, direction: "none" };

  const parts = split(surface);
  if (presentation === "review" && hasPrimary)
    return {
      map: undefined,
      primary: parts.first,
      linkedExecution: parts.second,
      direction: parts.direction,
    };
  return {
    map: parts.first,
    primary: undefined,
    linkedExecution: parts.second,
    direction: parts.direction,
  };
};
