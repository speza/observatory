import type {
  MapAgentView,
  MapGoalView,
  UniverseMapProjection,
} from "../../src/projection/types.ts";

export interface Selection {
  readonly type: "goal" | "agent";
  readonly id: string;
}

export type AtlasCameraCommand =
  | { readonly type: "focus"; readonly selection?: Selection; readonly nonce: number }
  | { readonly type: "zoom-in"; readonly nonce: number }
  | { readonly type: "zoom-out"; readonly nonce: number }
  | { readonly type: "reset"; readonly nonce: number }
  | { readonly type: "pan"; readonly dx: number; readonly dy: number; readonly nonce: number };

export interface OrbitPlacement {
  readonly band: number;
  readonly phase: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly x: number;
  readonly y: number;
}

export const AGENT_CARD_WIDTH = 220;
export const AGENT_CARD_HEIGHT = 104;
const AGENT_CARD_GAP = 14;
const AGENT_CARD_COLUMN_GAP = 18;
const AGENT_CARD_ROW_GAP = 10;
const CAPTION_CLEARANCE = 0.72;

export const hash = (value: string): number => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const wrappedLines = (
  title: string,
  maximumCharacters: number,
  maximumLines: number,
): readonly string[] => {
  const lines: string[] = [];
  for (const word of title.split(/\s+/u)) {
    const line = lines.at(-1);
    if (!line || line.length + word.length + 1 > maximumCharacters) lines.push(word);
    else lines[lines.length - 1] = `${line} ${word}`;
  }
  return lines.slice(0, maximumLines);
};

export const linesFor = (title: string): readonly string[] => wrappedLines(title, 16, 3);
export const stateLabel = (agent: MapAgentView): string =>
  agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth;

const sameSelection = (left: Selection | undefined, right: Selection | undefined): boolean =>
  left?.type === right?.type && left?.id === right?.id;

export const selectionBelongsToFocus = (
  focus: Selection | undefined,
  next: Selection | undefined,
  projection: UniverseMapProjection,
): boolean => {
  if (!focus || !next) return false;
  if (sameSelection(focus, next)) return true;
  if (focus.type !== "goal" || next.type !== "agent") return false;
  return projection.goals.some(
    (goal) => goal.id === focus.id && goal.agents.some((agent) => agent.id === next.id),
  );
};

export const goalRadius = (goal: MapGoalView): number =>
  Math.min(82, 52 + Math.sqrt(goal.agents.length) * 8);

const orbitPlacement = ({
  id,
  point,
  anchor,
  centre,
  radiusX,
  radiusY,
  ringUnitX,
  ringUnitY,
  bandStepX,
  bandStepY,
}: {
  readonly id: string;
  readonly point: { readonly x: number; readonly y: number };
  readonly anchor: { readonly x: number; readonly y: number };
  readonly centre: { readonly x: number; readonly y: number };
  readonly radiusX: number;
  readonly radiusY: number;
  readonly ringUnitX: number;
  readonly ringUnitY: number;
  readonly bandStepX: number;
  readonly bandStepY: number;
}): OrbitPlacement => {
  const deltaX = point.x - anchor.x;
  const deltaY = point.y - anchor.y;
  const logicalRing = Math.max(Math.abs(deltaX) / ringUnitX, Math.abs(deltaY) / ringUnitY);
  const band = Math.max(0, Math.round(logicalRing) - 1);
  const phase =
    Math.abs(deltaX) + Math.abs(deltaY) < 0.01
      ? ((hash(id) % 360) * Math.PI) / 180
      : Math.atan2(deltaY / ringUnitY, deltaX / ringUnitX);
  const finalRadiusX = radiusX + band * bandStepX;
  const finalRadiusY = radiusY + band * bandStepY;
  return {
    band,
    phase,
    radiusX: finalRadiusX,
    radiusY: finalRadiusY,
    x: centre.x + Math.cos(phase) * finalRadiusX,
    y: centre.y + Math.sin(phase) * finalRadiusY,
  };
};

const distributeAgentCards = (
  placements: readonly OrbitPlacement[],
  goalBodyRadius: number,
): readonly OrbitPlacement[] => {
  const result: Array<OrbitPlacement | undefined> = Array.from({ length: placements.length });
  const bands = [...new Set(placements.map((placement) => placement.band))].sort(
    (left, right) => left - right,
  );
  const minimumRadius =
    goalBodyRadius + Math.hypot(AGENT_CARD_WIDTH / 2, AGENT_CARD_HEIGHT / 2) + AGENT_CARD_GAP;
  const availableArc = Math.PI * 2 - CAPTION_CLEARANCE * 2;
  let previousRadiusX = minimumRadius - AGENT_CARD_WIDTH - AGENT_CARD_COLUMN_GAP;
  let previousRadiusY = minimumRadius - AGENT_CARD_HEIGHT - AGENT_CARD_ROW_GAP;
  for (const band of bands) {
    const peers = placements
      .map((placement, index) => ({ index, placement }))
      .filter((entry) => entry.placement.band === band)
      .sort(
        (left, right) => left.placement.phase - right.placement.phase || left.index - right.index,
      );
    const phaseStep = availableArc / peers.length;
    const separation = Math.sin(Math.min(phaseStep, Math.PI / 2));
    let radiusX = Math.max(
      minimumRadius,
      (AGENT_CARD_WIDTH + AGENT_CARD_GAP) / separation,
      previousRadiusX + AGENT_CARD_WIDTH + AGENT_CARD_COLUMN_GAP,
    );
    let radiusY = Math.max(
      minimumRadius,
      (AGENT_CARD_HEIGHT + AGENT_CARD_ROW_GAP) / separation,
      previousRadiusY + AGENT_CARD_HEIGHT + AGENT_CARD_ROW_GAP,
    );
    const firstPeer = peers[0];
    if (!firstPeer) continue;
    const centreX =
      firstPeer.placement.x - Math.cos(firstPeer.placement.phase) * firstPeer.placement.radiusX;
    const centreY =
      firstPeer.placement.y - Math.sin(firstPeer.placement.phase) * firstPeer.placement.radiusY;
    const phases = peers.map(
      (_, rank) => Math.PI / 2 + CAPTION_CLEARANCE + (rank + 0.5) * phaseStep,
    );
    const overlapsAnotherCard = (): boolean => {
      const points = phases.map((phase) => ({
        x: centreX + Math.cos(phase) * radiusX,
        y: centreY + Math.sin(phase) * radiusY,
      }));
      const earlierPoints = result.flatMap((placement) => (placement ? [placement] : []));
      const allPoints = [...earlierPoints, ...points];
      for (let leftIndex = 0; leftIndex < allPoints.length; leftIndex += 1) {
        const left = allPoints[leftIndex];
        if (!left) continue;
        for (
          let rightIndex = Math.max(leftIndex + 1, earlierPoints.length);
          rightIndex < allPoints.length;
          rightIndex += 1
        ) {
          const right = allPoints[rightIndex];
          if (
            right &&
            Math.abs(left.x - right.x) < AGENT_CARD_WIDTH + AGENT_CARD_GAP &&
            Math.abs(left.y - right.y) < AGENT_CARD_HEIGHT + AGENT_CARD_ROW_GAP
          )
            return true;
        }
      }
      return false;
    };
    while (overlapsAnotherCard()) {
      radiusX *= 1.08;
      radiusY *= 1.08;
    }
    for (const [rank, peer] of peers.entries()) {
      const phase = phases[rank] ?? peer.placement.phase;
      result[peer.index] = {
        ...peer.placement,
        phase,
        radiusX,
        radiusY,
        x: centreX + Math.cos(phase) * radiusX,
        y: centreY + Math.sin(phase) * radiusY,
      };
    }
    previousRadiusX = radiusX;
    previousRadiusY = radiusY;
  }
  return placements.map((placement, index) => result[index] ?? placement);
};

export const goalAgentPoints = (
  goal: MapGoalView,
  centre: { readonly x: number; readonly y: number },
): readonly OrbitPlacement[] =>
  distributeAgentCards(
    goal.agents.map((agent) =>
      orbitPlacement({
        id: agent.id,
        point: agent.mapPosition,
        anchor: goal.mapPosition,
        centre,
        radiusX: goalRadius(goal) + 45,
        radiusY: goalRadius(goal) + 32,
        ringUnitX: 32,
        ringUnitY: 24,
        bandStepX: 28,
        bandStepY: 24,
      }),
    ),
    goalRadius(goal),
  );

export interface AtlasContentBounds {
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumY: number;
  readonly maximumY: number;
}

interface GoalLocalBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const goalLocalBounds = (goal: MapGoalView): GoalLocalBounds => {
  const radius = goalRadius(goal);
  const orbits = goalAgentPoints(goal, { x: 0, y: 0 });
  const orbitWidth =
    Math.max(0, ...orbits.map((orbit) => Math.abs(orbit.x))) + AGENT_CARD_WIDTH / 2 + 4;
  const orbitHeight =
    Math.max(0, ...orbits.map((orbit) => Math.abs(orbit.y))) + AGENT_CARD_HEIGHT / 2 + 4;
  const titleLines = linesFor(goal.title);
  const titleWidth = Math.max(0, ...titleLines.map((line) => line.length * 9.5)) / 2 + 4;
  return {
    left: Math.max(radius + 3, orbitWidth, titleWidth),
    right: Math.max(radius + 3, orbitWidth, titleWidth),
    top: Math.max(radius + 3, orbitHeight),
    bottom: Math.max(radius + 54 + Math.max(0, titleLines.length - 1) * 18, orbitHeight),
  };
};

/** Expand durable goal anchors just enough that their rendered groups cannot overlap. */
export const atlasGoalSpacingScale = (projection: UniverseMapProjection): number => {
  let scale = 1;
  const goalBounds = projection.goals.map(goalLocalBounds);
  for (let leftIndex = 0; leftIndex < projection.goals.length; leftIndex += 1) {
    const left = projection.goals[leftIndex];
    const leftBounds = goalBounds[leftIndex];
    if (!left || !leftBounds) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < projection.goals.length; rightIndex += 1) {
      const right = projection.goals[rightIndex];
      const rightBounds = goalBounds[rightIndex];
      if (!right || !rightBounds) continue;
      const deltaX = Math.abs(left.mapPosition.x - right.mapPosition.x);
      const deltaY = Math.abs(left.mapPosition.y - right.mapPosition.y);
      const horizontalScale =
        deltaX < 0.01
          ? Number.POSITIVE_INFINITY
          : (leftBounds.right + rightBounds.left + 16) / deltaX;
      const verticalExtent =
        left.mapPosition.y <= right.mapPosition.y
          ? leftBounds.bottom + rightBounds.top
          : leftBounds.top + rightBounds.bottom;
      const verticalScale =
        deltaY < 0.01 ? Number.POSITIVE_INFINITY : (verticalExtent + 16) / deltaY;
      const separationScale = Math.min(horizontalScale, verticalScale);
      if (Number.isFinite(separationScale)) scale = Math.max(scale, separationScale);
    }
  }
  return scale;
};

/** Bounds of the visible goal bodies, captions, agent nodes, and their outer orbits. */
export const atlasContentBounds = (
  projection: UniverseMapProjection,
  goalSpacingScale = 1,
): AtlasContentBounds => {
  if (projection.goals.length === 0) {
    return { minimumX: -1, maximumX: 1, minimumY: -1, maximumY: 1 };
  }

  const bounds = projection.goals.map((goal) => {
    const local = goalLocalBounds(goal);
    const goalX = goal.mapPosition.x * goalSpacingScale;
    const goalY = goal.mapPosition.y * goalSpacingScale;
    return {
      minimumX: goalX - local.left,
      maximumX: goalX + local.right,
      minimumY: goalY - local.top,
      maximumY: goalY + local.bottom,
    };
  });

  return {
    minimumX: Math.min(...bounds.map((bound) => bound.minimumX)),
    maximumX: Math.max(...bounds.map((bound) => bound.maximumX)),
    minimumY: Math.min(...bounds.map((bound) => bound.minimumY)),
    maximumY: Math.max(...bounds.map((bound) => bound.maximumY)),
  };
};
