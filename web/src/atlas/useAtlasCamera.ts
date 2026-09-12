import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { UniverseMapProjection } from "../../../src/projection/types.ts";
import type { Selection } from "../app/selection.ts";
import {
  AGENT_CARD_HEIGHT,
  AGENT_CARD_WIDTH,
  DISCOVERED_CARD_HEIGHT,
  DISCOVERED_CARD_WIDTH,
  atlasContentBounds,
  atlasGoalSpacingScale,
  discoveredDockPlacement,
  selectionBelongsToFocus,
  workspaceAgentPoints,
  workspaceLessAgentPoints,
  type AtlasCameraCommand,
  type AtlasContentBounds,
} from "./atlasGeometry.ts";

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Camera {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

interface AtlasLayout {
  readonly centreX: number;
  readonly centreY: number;
  readonly fitCamera: Camera;
  readonly goalSpacingScale: number;
}

const MINIMUM_ZOOM = 0.12;
const MAXIMUM_ZOOM = 2.8;
const MAXIMUM_FIT_ZOOM = 1.15;

export const fitAtlasBounds = (
  bounds: AtlasContentBounds,
  size: Size,
  reservedLeft: number,
  reservedRight: number,
  maximumZoom = MAXIMUM_FIT_ZOOM,
): Camera => {
  const zoom = Math.min(
    maximumZoom,
    Math.max(1, size.width - reservedLeft - reservedRight - 96) /
      Math.max(1, bounds.maximumX - bounds.minimumX),
    Math.max(1, size.height - 144) / Math.max(1, bounds.maximumY - bounds.minimumY),
  );
  return {
    zoom,
    panX:
      reservedLeft +
      (size.width - reservedLeft - reservedRight) / 2 -
      ((bounds.minimumX + bounds.maximumX) / 2) * zoom,
    panY: size.height / 2 - ((bounds.minimumY + bounds.maximumY) / 2) * zoom,
  };
};

const atlasLayout = (
  projection: UniverseMapProjection,
  size: Size,
  reservedLeft: number,
  reservedRight: number,
): AtlasLayout => {
  const goalSpacingScale = atlasGoalSpacingScale(projection);
  const bounds = atlasContentBounds(projection, goalSpacingScale);
  return {
    centreX: reservedLeft + (size.width - reservedLeft - reservedRight) / 2,
    centreY: size.height / 2,
    fitCamera: fitAtlasBounds(bounds, size, reservedLeft, reservedRight),
    goalSpacingScale,
  };
};

interface AtlasCameraState {
  readonly camera: Camera;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly focusedSelection?: Selection;
  readonly isPanning: boolean;
  readonly layout: AtlasLayout;
  readonly size: Size;
  readonly worldTransform: string;
  readonly beginPan: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly continuePan: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly endPan: () => void;
  readonly focusPoint: (
    point: { readonly x: number; readonly y: number },
    target?: Selection,
  ) => void;
  readonly reset: () => void;
  readonly resetCamera: () => void;
  readonly screenPoint: (point: { readonly x: number; readonly y: number }) => {
    readonly x: number;
    readonly y: number;
  };
  readonly zoom: (event: ReactWheelEvent<SVGSVGElement>) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
}

export const useAtlasCamera = ({
  cameraCommand,
  projection,
  reservedLeft,
  reservedRight,
  selection,
}: {
  readonly cameraCommand?: AtlasCameraCommand;
  readonly projection: UniverseMapProjection;
  readonly reservedLeft: number;
  readonly reservedRight: number;
  readonly selection?: Selection;
}): AtlasCameraState => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | undefined>(
    undefined,
  );
  const handledCameraCommand = useRef<number | undefined>(undefined);
  const cameraAdjusted = useRef(false);
  const autoFocus = useRef(false);
  const [size, setSize] = useState<Size>({ width: 1200, height: 760 });
  const layout = useMemo(
    () => atlasLayout(projection, size, reservedLeft, reservedRight),
    [projection, reservedLeft, reservedRight, size],
  );
  const [camera, setCamera] = useState<Camera>(layout.fitCamera);
  const [isPanning, setIsPanning] = useState(false);
  const [focusedSelection, setFocusedSelection] = useState<Selection>();

  // A data refresh is not a navigation request. In particular it must not
  // recenter an unchanged camera when another Goal extends the global bounds.
  useEffect(() => {
    if (!cameraAdjusted.current) setCamera(layout.fitCamera);
  }, [size, reservedLeft, reservedRight]);

  useEffect(() => {
    if (!selectionBelongsToFocus(focusedSelection, selection, projection)) {
      setFocusedSelection(undefined);
    }
  }, [focusedSelection, projection, selection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = (): void =>
      setSize({ width: container.clientWidth, height: container.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const screenPoint = (point: { readonly x: number; readonly y: number }) => ({
    x: point.x * layout.goalSpacingScale,
    y: point.y * layout.goalSpacingScale,
  });

  const pointForSelection = (target: Selection | undefined) => {
    if (!target) return undefined;
    if (target.type === "goal") {
      const agents: { x: number; y: number }[] = projection.workspaces.flatMap((workspace) =>
        workspace.agents.flatMap((agent, index) =>
          agent.primaryGoalId === target.id
            ? [workspaceAgentPoints(workspace, screenPoint(workspace.mapPosition))[index]!]
            : [],
        ),
      );
      agents.push(
        ...workspaceLessAgentPoints(projection, layout.goalSpacingScale).filter(
          (_, index) => projection.workspaceLess[index]?.primaryGoalId === target.id,
        ),
      );
      return agents.length
        ? {
            x: agents.reduce((sum, point) => sum + point.x, 0) / agents.length,
            y: agents.reduce((sum, point) => sum + point.y, 0) / agents.length,
          }
        : undefined;
    }
    if (target.type === "discovered-execution") {
      const execution = projection.discoveredExecutions?.find(
        (candidate) => candidate.handle === target.id,
      );
      if (!execution) return undefined;
      const point = screenPoint(execution.mapPosition);
      const translation = discoveredDockPlacement(projection, layout.goalSpacingScale)?.translation;
      return translation ? { x: point.x + translation.x, y: point.y + translation.y } : point;
    }
    for (const workspace of projection.workspaces) {
      const agentIndex = workspace.agents.findIndex((candidate) => candidate.id === target.id);
      if (agentIndex >= 0) {
        return workspaceAgentPoints(workspace, screenPoint(workspace.mapPosition))[agentIndex];
      }
    }
    const workspaceLessIndex = projection.workspaceLess.findIndex(
      (candidate) => candidate.id === target.id,
    );
    if (workspaceLessIndex >= 0)
      return workspaceLessAgentPoints(projection, layout.goalSpacingScale)[workspaceLessIndex];
    return undefined;
  };

  const focusPoint = (
    point: { readonly x: number; readonly y: number },
    target?: Selection,
  ): void => {
    cameraAdjusted.current = true;
    autoFocus.current = true;
    const next = target ?? selection;
    setFocusedSelection(next);
    const goalAgentPoints =
      next?.type === "goal"
        ? [
            ...projection.workspaces.flatMap((workspace) =>
              workspaceAgentPoints(workspace, screenPoint(workspace.mapPosition)).filter(
                (_, index) => workspace.agents[index]?.primaryGoalId === next.id,
              ),
            ),
            ...projection.workspaceLess.flatMap((agent, index) =>
              agent.primaryGoalId === next.id
                ? [workspaceLessAgentPoints(projection, layout.goalSpacingScale)[index]!]
                : [],
            ),
          ]
        : [];
    const discovered =
      next?.type === "discovered-execution"
        ? projection.discoveredExecutions?.find((candidate) => candidate.handle === next.id)
        : undefined;
    const bounds = goalAgentPoints.length
      ? {
          left:
            point.x -
            Math.min(...goalAgentPoints.map((candidate) => candidate.x)) +
            AGENT_CARD_WIDTH / 2,
          right:
            Math.max(...goalAgentPoints.map((candidate) => candidate.x)) -
            point.x +
            AGENT_CARD_WIDTH / 2,
          top:
            point.y -
            Math.min(...goalAgentPoints.map((candidate) => candidate.y)) +
            AGENT_CARD_HEIGHT / 2,
          bottom:
            Math.max(...goalAgentPoints.map((candidate) => candidate.y)) -
            point.y +
            AGENT_CARD_HEIGHT / 2,
        }
      : discovered
        ? {
            left: DISCOVERED_CARD_WIDTH / 2 + 8,
            right: DISCOVERED_CARD_WIDTH / 2 + 8,
            top: DISCOVERED_CARD_HEIGHT / 2 + 28,
            bottom: DISCOVERED_CARD_HEIGHT / 2 + 28,
          }
        : {
            left: AGENT_CARD_WIDTH / 2 + 4,
            right: AGENT_CARD_WIDTH / 2 + 4,
            top: AGENT_CARD_HEIGHT / 2 + 4,
            bottom: AGENT_CARD_HEIGHT / 2 + 4,
          };
    setCamera(
      fitAtlasBounds(
        {
          minimumX: point.x - bounds.left,
          maximumX: point.x + bounds.right,
          minimumY: point.y - bounds.top,
          maximumY: point.y + bounds.bottom,
        },
        size,
        reservedLeft,
        reservedRight,
        1.45,
      ),
    );
  };

  useEffect(() => {
    if (!autoFocus.current || !focusedSelection) return;
    const point = pointForSelection(focusedSelection);
    if (point) focusPoint(point, focusedSelection);
  }, [size, reservedLeft, reservedRight, projection, focusedSelection]);

  const resetCamera = (): void => {
    cameraAdjusted.current = false;
    autoFocus.current = false;
    setCamera(layout.fitCamera);
  };
  const reset = (): void => {
    setFocusedSelection(undefined);
    resetCamera();
  };

  const zoomBy = (factor: number): void =>
    setCamera((current) => {
      cameraAdjusted.current = true;
      autoFocus.current = false;
      const zoom = Math.max(
        Math.min(MINIMUM_ZOOM, layout.fitCamera.zoom, current.zoom),
        Math.min(MAXIMUM_ZOOM, current.zoom * factor),
      );
      const ratio = zoom / current.zoom;
      return {
        zoom,
        panX: layout.centreX - (layout.centreX - current.panX) * ratio,
        panY: layout.centreY - (layout.centreY - current.panY) * ratio,
      };
    });
  const zoomIn = (): void => zoomBy(1.2);
  const zoomOut = (): void => zoomBy(1 / 1.2);

  useEffect(() => {
    if (!cameraCommand || handledCameraCommand.current === cameraCommand.nonce) return;
    handledCameraCommand.current = cameraCommand.nonce;
    switch (cameraCommand.type) {
      case "focus": {
        const point = pointForSelection(cameraCommand.selection);
        if (point) focusPoint(point, cameraCommand.selection);
        return;
      }
      case "zoom-in":
        zoomIn();
        return;
      case "zoom-out":
        zoomOut();
        return;
      case "reset":
        reset();
        return;
      case "pan": {
        cameraAdjusted.current = true;
        autoFocus.current = false;
        setCamera((current) => ({
          ...current,
          panX: current.panX + cameraCommand.dx,
          panY: current.panY + cameraCommand.dy,
        }));
        return;
      }
    }
  }, [cameraCommand, layout, projection]);

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[role="button"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cameraAdjusted.current = true;
    autoFocus.current = false;
    setIsPanning(true);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: camera.panX,
      panY: camera.panY,
    };
  };

  const continuePan = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setCamera((current) => ({
      ...current,
      panX: drag.panX + event.clientX - drag.x,
      panY: drag.panY + event.clientY - drag.y,
    }));
  };

  const endPan = (): void => {
    dragRef.current = undefined;
    setIsPanning(false);
  };

  const zoom = (event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    setCamera((current) => {
      cameraAdjusted.current = true;
      autoFocus.current = false;
      const nextZoom = Math.max(
        Math.min(MINIMUM_ZOOM, layout.fitCamera.zoom, current.zoom),
        Math.min(MAXIMUM_ZOOM, current.zoom * factor),
      );
      const ratio = nextZoom / current.zoom;
      return {
        zoom: nextZoom,
        panX: pointerX - (pointerX - current.panX) * ratio,
        panY: pointerY - (pointerY - current.panY) * ratio,
      };
    });
  };

  return {
    beginPan,
    camera,
    containerRef,
    continuePan,
    endPan,
    focusedSelection,
    focusPoint,
    isPanning,
    layout,
    reset,
    resetCamera,
    screenPoint,
    size,
    worldTransform: `translate(${camera.panX} ${camera.panY}) scale(${camera.zoom})`,
    zoom,
    zoomIn,
    zoomOut,
  };
};
