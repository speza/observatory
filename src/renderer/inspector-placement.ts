import type { Rect } from "./layout.ts";

export interface PlacementPoint {
  readonly x: number;
  readonly y: number;
}

export interface InspectorSize {
  readonly width: number;
  readonly height: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const contains = (rect: Rect, point: PlacementPoint): boolean =>
  point.x >= rect.x &&
  point.x < rect.x + rect.width &&
  point.y >= rect.y &&
  point.y < rect.y + rect.height;

const intersectionArea = (first: Rect, second: Rect): number => {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );
  return width * height;
};

const expanded = (rect: Rect, amount: number): Rect => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

/**
 * Choose a stable, in-bounds inspector position near its selected map item.
 *
 * The map is a spatial surface, so an inspector is an overlay rather than a
 * second layout column. Candidate positions are generated around visible map
 * bodies, then scored by node overlap and distance from the selected item.
 * This keeps the card close without letting it cover the goal or satellites
 * that give the selected item its context.
 */
export const placeFloatingInspector = (
  viewport: Rect,
  size: InspectorSize,
  anchor: PlacementPoint | undefined,
  obstacles: readonly Rect[],
): Rect => {
  const padding = 1;
  const gap = 2;
  const width = Math.min(size.width, Math.max(0, viewport.width - padding * 2));
  const height = Math.min(
    size.height,
    Math.max(0, viewport.height - padding * 2),
  );
  const minimumX = viewport.x + padding;
  const minimumY = viewport.y + padding;
  const maximumX = Math.max(
    minimumX,
    viewport.x + viewport.width - padding - width,
  );
  const maximumY = Math.max(
    minimumY,
    viewport.y + viewport.height - padding - height,
  );

  if (width <= 0 || height <= 0)
    return { x: viewport.x, y: viewport.y, width, height };

  const visibleObstacles = obstacles.filter(
    (obstacle) =>
      obstacle.width > 0 &&
      obstacle.height > 0 &&
      intersectionArea(obstacle, viewport) > 0,
  );
  const anchorObstacle = anchor
    ? visibleObstacles
        .filter((obstacle) => contains(obstacle, anchor))
        .sort(
          (first, second) =>
            first.width * first.height - second.width * second.height,
        )[0]
    : undefined;
  const reference =
    anchorObstacle ??
    (anchor
      ? { x: anchor.x, y: anchor.y, width: 1, height: 1 }
      : {
          x: viewport.x + Math.floor(viewport.width / 2),
          y: viewport.y + Math.floor(viewport.height / 2),
          width: 1,
          height: 1,
        });

  const candidates: Rect[] = [];
  const seen = new Set<string>();
  const addCandidate = (x: number, y: number): void => {
    const candidate: Rect = {
      x: clamp(Math.round(x), minimumX, maximumX),
      y: clamp(Math.round(y), minimumY, maximumY),
      width,
      height,
    };
    const key = `${candidate.x}:${candidate.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  };
  const addAround = (obstacle: Rect): void => {
    const centerX = obstacle.x + Math.floor(obstacle.width / 2);
    const centerY = obstacle.y + Math.floor(obstacle.height / 2);
    addCandidate(
      obstacle.x + obstacle.width + gap,
      centerY - Math.floor(height / 2),
    );
    addCandidate(obstacle.x - width - gap, centerY - Math.floor(height / 2));
    addCandidate(
      centerX - Math.floor(width / 2),
      obstacle.y + obstacle.height + gap,
    );
    addCandidate(centerX - Math.floor(width / 2), obstacle.y - height - gap);
  };

  addAround(reference);
  for (const obstacle of visibleObstacles) addAround(obstacle);
  addCandidate(minimumX, minimumY);
  addCandidate(maximumX, minimumY);
  addCandidate(minimumX, maximumY);
  addCandidate(maximumX, maximumY);
  addCandidate(viewport.x + Math.floor((viewport.width - width) / 2), minimumY);
  addCandidate(viewport.x + Math.floor((viewport.width - width) / 2), maximumY);

  const target = anchor ?? reference;
  const score = (candidate: Rect): number => {
    const overlap = visibleObstacles.reduce(
      (total, obstacle) =>
        total + intersectionArea(candidate, expanded(obstacle, gap)),
      0,
    );
    const candidateCenterX = candidate.x + candidate.width / 2;
    const candidateCenterY = candidate.y + candidate.height / 2;
    const distance = Math.hypot(
      candidateCenterX - target.x,
      candidateCenterY - target.y,
    );
    return overlap * 1_000_000 + distance;
  };

  return candidates.reduce((best, candidate) =>
    score(candidate) < score(best) ? candidate : best,
  );
};
