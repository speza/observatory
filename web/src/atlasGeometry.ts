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

export interface LabelRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface FocusedLabelCandidate {
  readonly id: string;
  readonly labelOnLeft: boolean;
  readonly rect: LabelRect;
}

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

export const linesFor = (title: string): readonly string[] => wrappedLines(title, 25, 3);
export const agentLinesFor = (name: string): readonly string[] => wrappedLines(name, 17, 2);

export const labelRectFor = (
  point: { readonly x: number; readonly y: number },
  lines: readonly string[],
  state: string,
  labelOnLeft: boolean,
): LabelRect => {
  const longestLine = Math.max(0, ...lines.map((line) => line.length));
  const width = Math.max(46, longestLine * 7.35, state.length * 6.4);
  const left = labelOnLeft ? point.x - 17 - width : point.x + 17;
  const top = point.y - (lines.length > 1 ? 21 : 15);
  const height = lines.length * 12 + 16;
  return { left, right: left + width, top, bottom: top + height };
};

export const labelsOverlap = (left: LabelRect, right: LabelRect, gap = 8): boolean =>
  left.left < right.right + gap &&
  left.right + gap > right.left &&
  left.top < right.bottom + gap &&
  left.bottom + gap > right.top;

export const focusedLabelOffsets = (
  candidates: readonly FocusedLabelCandidate[],
  gap = 8,
): ReadonlyMap<string, number> => {
  const offsets = new Map<string, number>();
  for (const labelOnLeft of [true, false]) {
    const column = candidates
      .filter((candidate) => candidate.labelOnLeft === labelOnLeft)
      .sort((left, right) => left.rect.top - right.rect.top || left.id.localeCompare(right.id));
    if (column.length === 0) continue;

    const placedTops: number[] = [];
    let nextTop = Number.NEGATIVE_INFINITY;
    for (const candidate of column) {
      const top = Math.max(candidate.rect.top, nextTop);
      placedTops.push(top);
      nextTop = top + candidate.rect.bottom - candidate.rect.top + gap;
    }

    const preferredCentre =
      column.reduce((sum, candidate) => sum + (candidate.rect.top + candidate.rect.bottom) / 2, 0) /
      column.length;
    const placedCentre =
      column.reduce(
        (sum, candidate, index) =>
          sum +
          (placedTops[index] ?? candidate.rect.top) +
          (candidate.rect.bottom - candidate.rect.top) / 2,
        0,
      ) / column.length;
    const centreCorrection = preferredCentre - placedCentre;

    for (const [index, candidate] of column.entries()) {
      offsets.set(
        candidate.id,
        (placedTops[index] ?? candidate.rect.top) + centreCorrection - candidate.rect.top,
      );
    }
  }
  return offsets;
};

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

export const allPoints = (projection: UniverseMapProjection): readonly { x: number; y: number }[] =>
  projection.goals.flatMap((goal) => [
    goal.mapPosition,
    ...goal.agents.map((agent) => agent.mapPosition),
  ]);

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

const distributeOutsideCaption = (
  placements: readonly OrbitPlacement[],
): readonly OrbitPlacement[] => {
  const captionCentre = Math.PI / 2;
  const captionClearance = 0.82;
  const availableArc = Math.PI * 2 - captionClearance * 2;
  const result: Array<OrbitPlacement | undefined> = Array.from({ length: placements.length });
  const bands = [...new Set(placements.map((placement) => placement.band))];
  for (const band of bands) {
    const peers = placements
      .map((placement, index) => ({ index, placement }))
      .filter((entry) => entry.placement.band === band)
      .sort(
        (left, right) => left.placement.phase - right.placement.phase || left.index - right.index,
      );
    for (const [rank, peer] of peers.entries()) {
      const fraction = ((rank + 0.5 + band * 0.31) / peers.length) % 1;
      const phase = captionCentre + captionClearance + fraction * availableArc;
      result[peer.index] = {
        ...peer.placement,
        phase,
        x:
          peer.placement.x +
          (Math.cos(phase) - Math.cos(peer.placement.phase)) * peer.placement.radiusX,
        y:
          peer.placement.y +
          (Math.sin(phase) - Math.sin(peer.placement.phase)) * peer.placement.radiusY,
      };
    }
  }
  return placements.map((placement, index) => result[index] ?? placement);
};

export const goalAgentPoints = (
  goal: MapGoalView,
  centre: { readonly x: number; readonly y: number },
): readonly OrbitPlacement[] =>
  distributeOutsideCaption(
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
  );
