import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { UniverseMapProjection } from "../../src/projection/types.ts";
import {
  allPoints,
  goalAgentPoints,
  selectionBelongsToFocus,
  type AtlasCameraCommand,
  type Selection,
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
  readonly worldX: number;
  readonly worldY: number;
  readonly fitScale: number;
}

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
  const [size, setSize] = useState<Size>({ width: 1200, height: 760 });
  const [camera, setCamera] = useState<Camera>({ zoom: 1, panX: 0, panY: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [focusedSelection, setFocusedSelection] = useState<Selection>();

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

  const layout = useMemo(() => {
    const points = allPoints(projection);
    const minimumX = Math.min(...points.map((point) => point.x), -1);
    const maximumX = Math.max(...points.map((point) => point.x), 1);
    const minimumY = Math.min(...points.map((point) => point.y), -1);
    const maximumY = Math.max(...points.map((point) => point.y), 1);
    const availableWidth = Math.max(320, size.width - reservedLeft - reservedRight - 360);
    const availableHeight = Math.max(280, size.height - 260);
    const minimumReadableScale = size.width < 1_000 ? 1.3 : size.width < 1_800 ? 1.1 : 0.95;
    const fitScale = Math.max(
      minimumReadableScale,
      Math.min(
        2.15,
        availableWidth / Math.max(1, maximumX - minimumX),
        availableHeight / Math.max(1, maximumY - minimumY),
      ),
    );
    return {
      centreX: reservedLeft + (size.width - reservedLeft - reservedRight) / 2,
      centreY: size.height / 2,
      worldX: (minimumX + maximumX) / 2,
      worldY: (minimumY + maximumY) / 2,
      fitScale,
    };
  }, [projection, reservedLeft, reservedRight, size]);

  const screenPoint = (point: { readonly x: number; readonly y: number }) => ({
    x: layout.centreX + (point.x - layout.worldX) * layout.fitScale,
    y: layout.centreY + (point.y - layout.worldY) * layout.fitScale,
  });

  const pointForSelection = (target: Selection | undefined) => {
    if (!target) return undefined;
    if (target.type === "goal") {
      const goal = projection.goals.find((candidate) => candidate.id === target.id);
      return goal ? screenPoint(goal.mapPosition) : undefined;
    }
    for (const goal of projection.goals) {
      const agentIndex = goal.agents.findIndex((candidate) => candidate.id === target.id);
      if (agentIndex >= 0) {
        const centre = screenPoint(goal.mapPosition);
        return goalAgentPoints(goal, centre)[agentIndex];
      }
    }
    return undefined;
  };

  const focusPoint = (
    point: { readonly x: number; readonly y: number },
    target?: Selection,
  ): void => {
    setFocusedSelection(target ?? selection);
    const nextZoom = 1.45;
    setCamera({
      zoom: nextZoom,
      panX: -(point.x - layout.centreX) * nextZoom,
      panY: -(point.y - layout.centreY) * nextZoom,
    });
  };

  const resetCamera = (): void => setCamera({ zoom: 1, panX: 0, panY: 0 });
  const reset = (): void => {
    setFocusedSelection(undefined);
    resetCamera();
  };

  const zoomIn = (): void =>
    setCamera((current) => ({ ...current, zoom: Math.min(2.8, current.zoom * 1.2) }));
  const zoomOut = (): void =>
    setCamera((current) => ({ ...current, zoom: Math.max(0.58, current.zoom / 1.2) }));

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
      case "pan":
        setCamera((current) => ({
          ...current,
          panX: current.panX + cameraCommand.dx,
          panY: current.panY + cameraCommand.dy,
        }));
        return;
    }
  }, [cameraCommand, layout, projection]);

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[role="button"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
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
      const nextZoom = Math.max(0.58, Math.min(2.8, current.zoom * factor));
      const ratio = nextZoom / current.zoom;
      return {
        zoom: nextZoom,
        panX: pointerX - layout.centreX - (pointerX - layout.centreX - current.panX) * ratio,
        panY: pointerY - layout.centreY - (pointerY - layout.centreY - current.panY) * ratio,
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
    worldTransform: `translate(${camera.panX} ${camera.panY}) translate(${layout.centreX} ${layout.centreY}) scale(${camera.zoom}) translate(${-layout.centreX} ${-layout.centreY})`,
    zoom,
    zoomIn,
    zoomOut,
  };
};
