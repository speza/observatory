import type { MapPosition } from "../universe/types.ts";

export interface ViewportBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportScale {
  readonly x: number;
  readonly y: number;
}

export interface ViewportState {
  readonly center: MapPosition;
  readonly zoom: number;
}

export const MIN_MAP_ZOOM = 0.65;
export const MAX_MAP_ZOOM = 2.2;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

/** Fit a deterministic set of world points into the current cell viewport. */
export const fitViewportToPoints = (
  points: readonly MapPosition[],
  bounds: ViewportBounds,
  scale: ViewportScale,
  paddingXCells = 10,
  paddingYCells = paddingXCells,
): ViewportState => {
  if (points.length === 0) return { center: { x: 0, y: 0 }, zoom: 1 };
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumY = Math.max(...points.map((point) => point.y));
  const center = {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
  };
  const width = Math.max(1, (maximumX - minimumX) * scale.x);
  const height = Math.max(1, (maximumY - minimumY) * scale.y);
  const availableWidth = Math.max(1, bounds.width - paddingXCells * 2);
  const availableHeight = Math.max(1, bounds.height - paddingYCells * 2);
  const zoom = clamp(
    Math.min(availableWidth / width, availableHeight / height),
    MIN_MAP_ZOOM,
    MAX_MAP_ZOOM,
  );
  return { center, zoom };
};

/** Project a world-space position into the cell-space viewport. */
export const screenPointForWorld = (
  point: MapPosition,
  state: ViewportState,
  bounds: ViewportBounds,
  scale: ViewportScale,
): MapPosition => ({
  x: Math.round(bounds.x + bounds.width / 2 + (point.x - state.center.x) * scale.x),
  y: Math.round(bounds.y + bounds.height / 2 + (point.y - state.center.y) * scale.y),
});

/** Move the world beneath the viewport by a cell-space drag or key delta. */
export const panViewport = (
  state: ViewportState,
  deltaCells: MapPosition,
  scale: ViewportScale,
): ViewportState => ({
  ...state,
  center: {
    x: clamp(state.center.x + deltaCells.x / Math.max(0.1, scale.x), -500, 500),
    y: clamp(state.center.y + deltaCells.y / Math.max(0.1, scale.y), -500, 500),
  },
});

/** Zoom around a pointer while keeping the world point beneath it stable. */
export const zoomViewportAt = (
  state: ViewportState,
  factor: number,
  anchor: MapPosition,
  bounds: ViewportBounds,
  scale: ViewportScale,
): ViewportState => {
  const nextZoom = clamp(state.zoom * factor, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
  const scaleX = Math.max(0.1, scale.x);
  const scaleY = Math.max(0.1, scale.y);
  const viewportCenterX = bounds.x + bounds.width / 2;
  const viewportCenterY = bounds.y + bounds.height / 2;
  const worldX = state.center.x + (anchor.x - viewportCenterX) / scaleX;
  const worldY = state.center.y + (anchor.y - viewportCenterY) / scaleY;
  const nextScaleX = scaleX * (nextZoom / state.zoom);
  const nextScaleY = scaleY * (nextZoom / state.zoom);
  return {
    zoom: nextZoom,
    center: {
      x: worldX - (anchor.x - viewportCenterX) / nextScaleX,
      y: worldY - (anchor.y - viewportCenterY) / nextScaleY,
    },
  };
};
