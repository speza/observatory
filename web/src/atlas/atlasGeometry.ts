import type {
  MapAgentView,
  MapWorkspaceView,
  UniverseMapProjection,
} from "../../../src/projection/types.ts";
import type { Selection } from "../app/selection.ts";

export type AtlasCameraCommand =
  | { readonly type: "focus"; readonly selection?: Selection; readonly nonce: number }
  | { readonly type: "zoom-in"; readonly nonce: number }
  | { readonly type: "zoom-out"; readonly nonce: number }
  | { readonly type: "reset"; readonly nonce: number }
  | { readonly type: "pan"; readonly dx: number; readonly dy: number; readonly nonce: number };

export const AGENT_CARD_WIDTH = 220;
export const AGENT_CARD_HEIGHT = 104;
export const DISCOVERED_CARD_WIDTH = 278;
export const DISCOVERED_CARD_HEIGHT = 132;
export const WORKSPACE_GAP = 18;
export const WORKSPACE_HEADER = 40;

export const hash = (value: string): number => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

export const truncateAtlasLine = (value: string, maximum: number): string =>
  value.trim().length <= maximum
    ? value.trim()
    : `${value
        .trim()
        .slice(0, maximum - 1)
        .trimEnd()}…`;
export const stateLabel = (agent: MapAgentView): string =>
  agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth;

export interface AtlasContentBounds {
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumY: number;
  readonly maximumY: number;
}

export const workspaceDimensions = (workspace: Pick<MapWorkspaceView, "agents">) => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(workspace.agents.length)));
  const rows = Math.max(1, Math.ceil(workspace.agents.length / columns));
  return {
    columns,
    width: columns * AGENT_CARD_WIDTH + (columns + 1) * WORKSPACE_GAP,
    height: rows * AGENT_CARD_HEIGHT + (rows + 1) * WORKSPACE_GAP + WORKSPACE_HEADER,
  };
};

const cardGridPoints = (agents: readonly MapAgentView[], centre: { x: number; y: number }) => {
  const dimensions = workspaceDimensions({ agents });
  return agents.map((agent, index) => ({
    id: agent.id,
    x:
      centre.x -
      dimensions.width / 2 +
      WORKSPACE_GAP +
      AGENT_CARD_WIDTH / 2 +
      (index % dimensions.columns) * (AGENT_CARD_WIDTH + WORKSPACE_GAP),
    y:
      centre.y -
      dimensions.height / 2 +
      WORKSPACE_HEADER +
      WORKSPACE_GAP +
      AGENT_CARD_HEIGHT / 2 +
      Math.floor(index / dimensions.columns) * (AGENT_CARD_HEIGHT + WORKSPACE_GAP),
  }));
};

export const workspaceAgentPoints = (
  workspace: MapWorkspaceView,
  centre: { x: number; y: number },
) => cardGridPoints(workspace.agents, centre);

const WORKSPACE_LESS_CONTENT_GAP = 48;

export const workspaceLessPosition = (projection: UniverseMapProjection, scale: number) => {
  const natural = {
    x: projection.inboxPosition.x * scale,
    y: projection.inboxPosition.y * scale,
  };
  if (projection.workspaces.length === 0) return natural;
  const size = workspaceDimensions({ agents: projection.workspaceLess });
  const occupiedBottom = Math.max(
    ...projection.workspaces.map(
      (workspace) => workspace.mapPosition.y * scale + workspaceDimensions(workspace).height / 2,
    ),
  );
  return {
    x: natural.x,
    y: Math.max(natural.y, occupiedBottom + WORKSPACE_LESS_CONTENT_GAP + size.height / 2),
  };
};

export const workspaceLessAgentPoints = (projection: UniverseMapProjection, scale: number) =>
  cardGridPoints(projection.workspaceLess, workspaceLessPosition(projection, scale));

export const selectionBelongsToFocus = (
  focus: Selection | undefined,
  next: Selection | undefined,
  projection: UniverseMapProjection,
): boolean => {
  if (!focus || !next) return false;
  if (focus.type === next.type && focus.id === next.id) return true;
  return (
    focus.type === "goal" &&
    next.type === "agent" &&
    [
      ...projection.workspaces.flatMap((workspace) => workspace.agents),
      ...projection.workspaceLess,
    ].some((agent) => agent.id === next.id && agent.primaryGoalId === focus.id)
  );
};

/** Expand logical workspace anchors until their rendered islands cannot overlap. */
export const atlasGoalSpacingScale = (projection: UniverseMapProjection): number => {
  const territories = projection.workspaces.map((workspace) => ({
    position: workspace.mapPosition,
    size: workspaceDimensions(workspace),
  }));
  let scale = 1;
  for (let leftIndex = 0; leftIndex < territories.length; leftIndex += 1) {
    const left = territories[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < territories.length; rightIndex += 1) {
      const right = territories[rightIndex];
      if (!right) continue;
      const deltaX = Math.abs(left.position.x - right.position.x);
      const deltaY = Math.abs(left.position.y - right.position.y);
      const horizontalScale =
        deltaX < 0.01
          ? Number.POSITIVE_INFINITY
          : (left.size.width / 2 + right.size.width / 2 + WORKSPACE_GAP * 2) / deltaX;
      const verticalScale =
        deltaY < 0.01
          ? Number.POSITIVE_INFINITY
          : (left.size.height / 2 + right.size.height / 2 + WORKSPACE_GAP * 2) / deltaY;
      const separationScale = Math.min(horizontalScale, verticalScale);
      if (Number.isFinite(separationScale)) scale = Math.max(scale, separationScale);
    }
  }
  return scale;
};

export const atlasContentBounds = (
  projection: UniverseMapProjection,
  scale = 1,
): AtlasContentBounds => {
  const bounds: AtlasContentBounds[] = projection.workspaces.map((workspace) => {
    const size = workspaceDimensions(workspace);
    return {
      minimumX: workspace.mapPosition.x * scale - size.width / 2,
      maximumX: workspace.mapPosition.x * scale + size.width / 2,
      minimumY: workspace.mapPosition.y * scale - size.height / 2,
      maximumY: workspace.mapPosition.y * scale + size.height / 2,
    };
  });
  if (projection.workspaceLess.length > 0) {
    const size = workspaceDimensions({ agents: projection.workspaceLess });
    const centre = workspaceLessPosition(projection, scale);
    bounds.push({
      minimumX: centre.x - size.width / 2,
      maximumX: centre.x + size.width / 2,
      minimumY: centre.y - size.height / 2,
      maximumY: centre.y + size.height / 2,
    });
  }
  const dock = discoveredDockPlacement(projection, scale);
  if (dock)
    bounds.push({
      minimumX: dock.bounds.left,
      maximumX: dock.bounds.left + dock.bounds.width,
      minimumY: dock.bounds.top,
      maximumY: dock.bounds.top + dock.bounds.height,
    });
  if (!bounds.length) return { minimumX: -1, maximumX: 1, minimumY: -1, maximumY: 1 };
  return {
    minimumX: Math.min(...bounds.map((item) => item.minimumX)),
    maximumX: Math.max(...bounds.map((item) => item.maximumX)),
    minimumY: Math.min(...bounds.map((item) => item.minimumY)),
    maximumY: Math.max(...bounds.map((item) => item.maximumY)),
  };
};

interface DockPlacement {
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly translation: { readonly x: number; readonly y: number };
}
const DISCOVERED_DOCK_PADDING = 18;
const DISCOVERED_DOCK_HEADING_HEIGHT = 40;
const DISCOVERED_DOCK_CONTENT_GAP = 48;

export const discoveredDockPlacement = (
  projection: UniverseMapProjection,
  scale: number,
): DockPlacement | undefined => {
  const executions = projection.discoveredExecutions ?? [];
  if (executions.length === 0) return undefined;
  const points = executions.map((execution) => ({
    x: execution.mapPosition.x * scale,
    y: execution.mapPosition.y * scale,
  }));
  const sourceLeft = Math.min(...points.map((point) => point.x)) - DISCOVERED_CARD_WIDTH / 2;
  const sourceRight = Math.max(...points.map((point) => point.x)) + DISCOVERED_CARD_WIDTH / 2;
  const sourceTop = Math.min(...points.map((point) => point.y)) - DISCOVERED_CARD_HEIGHT / 2;
  const sourceBottom = Math.max(...points.map((point) => point.y)) + DISCOVERED_CARD_HEIGHT / 2;
  const occupiedBottom = Math.max(
    0,
    ...projection.workspaces.map(
      (workspace) => workspace.mapPosition.y * scale + workspaceDimensions(workspace).height / 2,
    ),
    ...(projection.workspaceLess.length > 0
      ? [
          workspaceLessPosition(projection, scale).y +
            workspaceDimensions({ agents: projection.workspaceLess }).height / 2,
        ]
      : []),
  );
  const translationY = occupiedBottom + DISCOVERED_DOCK_CONTENT_GAP - sourceTop;
  return {
    bounds: {
      left: sourceLeft - DISCOVERED_DOCK_PADDING,
      top: sourceTop + translationY - DISCOVERED_DOCK_PADDING - DISCOVERED_DOCK_HEADING_HEIGHT,
      width: sourceRight - sourceLeft + DISCOVERED_DOCK_PADDING * 2,
      height:
        sourceBottom - sourceTop + DISCOVERED_DOCK_PADDING * 2 + DISCOVERED_DOCK_HEADING_HEIGHT,
    },
    translation: { x: 0, y: translationY },
  };
};
