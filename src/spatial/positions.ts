import type { MapPosition } from "../universe/types.ts";

/**
 * World-space positions are deliberately small, integer coordinates. They are
 * durable layout hints, not screen coordinates: the renderer maps them into
 * whatever cell viewport the terminal currently provides.
 */
const DEFAULT_GOAL_SLOTS: readonly MapPosition[] = [
  // These are only a legacy fallback for goals loaded without a durable
  // position. New goals use the free-space allocator below.
  { x: 0, y: 0 },
  { x: -45, y: 0 },
  { x: 45, y: 0 },
  { x: 0, y: -30 },
  { x: -45, y: -30 },
  { x: 45, y: -30 },
  { x: 0, y: 30 },
  { x: -45, y: 30 },
  { x: 45, y: 30 },
  { x: -45, y: -60 },
  { x: 45, y: -60 },
  { x: 0, y: 60 },
] as const;

const GOAL_GRID_STEP_X = 72;
const GOAL_GRID_STEP_Y = 48;
const GOAL_GAP_X = 16;
const GOAL_GAP_Y = 12;

export interface GoalLayoutOccupancy {
  readonly position: MapPosition;
  readonly sessionCount: number;
}

const hash = (value: string): number => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const positionKey = (position: MapPosition): string => `${position.x}:${position.y}`;

const stableSlotPositions = (
  anchor: MapPosition,
  ids: readonly string[],
  offsets: readonly MapPosition[],
  namespace: string,
  preferredSlotCount: number,
): Map<string, MapPosition> => {
  const result = new Map<string, MapPosition>();
  const occupied = new Set<string>();
  const uniqueIds = [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  for (const id of uniqueIds) {
    const preferredCount = Math.max(1, Math.min(offsets.length, preferredSlotCount));
    const start = hash(`${namespace}:${id}`) % preferredCount;
    const candidateIndexes = [
      ...Array.from({ length: preferredCount }, (_, offset) => (start + offset) % preferredCount),
      ...Array.from(
        { length: offsets.length - preferredCount },
        (_, offset) => preferredCount + offset,
      ),
    ];
    for (const index of candidateIndexes) {
      const candidate = offsets[index];
      if (!candidate) continue;
      const position = {
        x: anchor.x + candidate.x,
        y: anchor.y + candidate.y,
      };
      const key = positionKey(position);
      if (occupied.has(key)) continue;
      occupied.add(key);
      result.set(id, position);
      break;
    }
  }
  return result;
};

/**
 * A rectangular perimeter keeps satellite cards away from the goal body and
 * from one another. The slots are deliberately screen-friendly at the
 * renderer's normal zoom range rather than following random angles.
 */
const SATELLITE_OFFSETS: readonly MapPosition[] = (() => {
  const offsets: MapPosition[] = [];
  for (let ring = 1; ring <= 5; ring += 1) {
    const width = ring * 32;
    const height = ring * 24;
    for (let x = -ring; x <= ring; x += 1) offsets.push({ x: x * 32, y: -height });
    for (let y = -ring + 1; y <= ring; y += 1) offsets.push({ x: width, y: y * 24 });
    for (let x = ring - 1; x >= -ring; x -= 1) offsets.push({ x: x * 32, y: height });
    for (let y = ring - 1; y >= -ring + 1; y -= 1) offsets.push({ x: -width, y: y * 24 });
  }
  return offsets;
})();

/**
 * Inbox cards use a compact rectangular orbit around the neutral inbox body.
 * The first ring has twelve slots, enough for the normal live slice, and
 * later rings expand only when the inbox outgrows it.
 */
const INBOX_OFFSETS: readonly MapPosition[] = (() => {
  const offsets: MapPosition[] = [];
  for (let ring = 1; ring <= 4; ring += 1) {
    const width = ring * 72;
    const height = ring * 32;
    for (let x = -width; x <= width; x += 36) offsets.push({ x, y: -height });
    for (let y = -height + 32; y <= height; y += 32) offsets.push({ x: width, y });
    for (let x = width - 36; x >= -width; x -= 36) offsets.push({ x, y: height });
    for (let y = height - 32; y >= -height + 32; y -= 32) offsets.push({ x: -width, y });
  }
  return offsets;
})();

/** Return the same default position for an id on every process and refresh. */
export const defaultGoalMapPosition = (goalId: string): MapPosition => {
  const slot = DEFAULT_GOAL_SLOTS[hash(goalId) % DEFAULT_GOAL_SLOTS.length];
  return slot ? { ...slot } : { x: 0, y: 0 };
};

/**
 * Estimate the durable footprint of a goal and its direct satellites. This is
 * intentionally a logical-space estimate: the renderer remains responsible
 * for terminal-cell sizing, while new goal placement can avoid the current
 * session load without moving accepted goals.
 */
export interface GoalLayoutFootprint {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export const goalLayoutFootprint = (sessionCount: number): GoalLayoutFootprint => {
  const count = Number.isFinite(sessionCount) ? Math.max(0, Math.floor(sessionCount)) : 0;
  let ring = 0;
  while (count > 4 * ring * (ring + 1)) ring += 1;
  return {
    halfWidth: 44 + ring * 32,
    halfHeight: 28 + ring * 24,
  };
};

const goalCandidates = (goalId: string): readonly MapPosition[] => {
  const candidates: MapPosition[] = [];
  for (let ring = 0; ring <= 16; ring += 1) {
    for (let gridY = -ring; gridY <= ring; gridY += 1) {
      for (let gridX = -ring; gridX <= ring; gridX += 1) {
        if (Math.max(Math.abs(gridX), Math.abs(gridY)) !== ring) continue;
        candidates.push({
          x: gridX === 0 ? 0 : gridX * GOAL_GRID_STEP_X,
          y: gridY === 0 ? 0 : gridY * GOAL_GRID_STEP_Y,
        });
      }
    }
  }
  return candidates.sort((left, right) => {
    const gridRadius = (point: MapPosition): number =>
      Math.max(Math.abs(point.x) / GOAL_GRID_STEP_X, Math.abs(point.y) / GOAL_GRID_STEP_Y);
    const radiusDelta = gridRadius(left) - gridRadius(right);
    if (radiusDelta !== 0) return radiusDelta;
    // Prefer another portfolio row before consuming scarce terminal height.
    const verticalDelta = Math.abs(left.y) - Math.abs(right.y);
    if (verticalDelta !== 0) return verticalDelta;
    const horizontalDelta = Math.abs(left.x) - Math.abs(right.x);
    if (horizontalDelta !== 0) return horizontalDelta;
    return hash(`${goalId}:${positionKey(left)}`) - hash(`${goalId}:${positionKey(right)}`);
  });
};

const goalsOverlap = (left: GoalLayoutOccupancy, right: GoalLayoutOccupancy): boolean => {
  const leftFootprint = goalLayoutFootprint(left.sessionCount);
  const rightFootprint = goalLayoutFootprint(right.sessionCount);
  return (
    Math.abs(left.position.x - right.position.x) <
      leftFootprint.halfWidth + rightFootprint.halfWidth + GOAL_GAP_X &&
    Math.abs(left.position.y - right.position.y) <
      leftFootprint.halfHeight + rightFootprint.halfHeight + GOAL_GAP_Y
  );
};

/**
 * Place a new goal in the nearest deterministic free grid position. Existing
 * accepted positions are inputs, never outputs to be reflowed. The footprint
 * includes the goal's current direct-session load, so a heavily populated goal
 * claims more space and later goals route around it.
 */
export const initialGoalMapPosition = (
  goalId: string,
  occupied: readonly GoalLayoutOccupancy[],
  sessionCount = 0,
): MapPosition => {
  const candidateOccupancy: GoalLayoutOccupancy = {
    position: { x: 0, y: 0 },
    sessionCount,
  };
  for (const candidate of goalCandidates(goalId)) {
    const next = { ...candidateOccupancy, position: candidate };
    if (occupied.every((existing) => !goalsOverlap(next, existing))) return { ...candidate };
  }
  const fallback = goalCandidates(goalId).at(-1) ?? { x: 0, y: 0 };
  return { ...fallback };
};

/**
 * Derive stable local satellite positions without adding another topology.
 * Slot assignment is identity-derived and collision-aware, so adding a new
 * session does not make the existing satellites collapse onto one another.
 */
export const sessionSatellitePositions = (
  goal: MapPosition,
  goalId: string,
  sessionIds: readonly string[],
): Map<string, MapPosition> =>
  stableSlotPositions(goal, sessionIds, SATELLITE_OFFSETS, `satellite:${goalId}`, 8);

/** Keep the original single-session helper for callers and unit fixtures. */
export const sessionSatellitePosition = (
  goal: MapPosition,
  goalId: string,
  sessionId: string,
  _sessionIndex: number,
  _sessionCount: number,
): MapPosition => sessionSatellitePositions(goal, goalId, [sessionId]).get(sessionId) ?? goal;

/**
 * Place the unassigned inbox to the left of the occupied universe. The caller
 * may pass goal and satellite positions so the inbox remains a separate sector
 * even when a goal has a large satellite load.
 */
export const mapInboxAnchor = (goals: readonly MapPosition[]): MapPosition => {
  if (goals.length === 0) return { x: 0, y: 0 };
  const minimumX = Math.min(...goals.map((goal) => goal.x));
  const averageY = Math.round(goals.reduce((total, goal) => total + goal.y, 0) / goals.length);
  // Leave room for the inbox orbit's outer edge and both card bounds. This
  // keeps the neutral sector separate even at the minimum wide-map zoom.
  return { x: minimumX - 144, y: averageY };
};

/** Place unassigned sessions in a stable, collision-free neutral orbit. */
export const unassignedSessionPositions = (
  anchor: MapPosition,
  sessionIds: readonly string[],
): Map<string, MapPosition> =>
  stableSlotPositions(anchor, sessionIds, INBOX_OFFSETS, "unassigned", 12);

/** Keep the original single-session helper for callers and unit fixtures. */
export const unassignedSessionPosition = (anchor: MapPosition, sessionId: string): MapPosition =>
  unassignedSessionPositions(anchor, [sessionId]).get(sessionId) ?? anchor;

export const isMapPosition = (value: MapPosition): boolean =>
  Number.isFinite(value.x) &&
  Number.isFinite(value.y) &&
  Math.abs(value.x) <= 10_000 &&
  Math.abs(value.y) <= 10_000;
