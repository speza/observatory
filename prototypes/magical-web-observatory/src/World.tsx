import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { agents, goals, type Moment } from "./data";
import { clampZoom, type ViewportState, type WorldSize } from "./layout";
import { SvgScene, type AtlasTheme, type LabelPolicy } from "./SvgScene";

export type { AtlasTheme } from "./SvgScene";

const assignedAgents = agents.filter((agent) => agent.goalId !== undefined);
const worldUnitsPerPixel = 0.8;

interface WorldProps {
  readonly viewport: ViewportState;
  readonly selectedId: string;
  readonly moment: Moment;
  readonly reducedMotion: boolean;
  readonly focusGoalId?: string;
  readonly labelPolicy?: LabelPolicy;
  readonly theme: AtlasTheme;
  readonly catchUp: boolean;
  readonly onSelect: (id: string) => void;
  readonly onViewport: (viewport: ViewportState) => void;
}

export const World = ({
  viewport,
  selectedId,
  moment,
  reducedMotion,
  focusGoalId,
  labelPolicy = "adaptive",
  theme,
  catchUp,
  onSelect,
  onViewport,
}: WorldProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | undefined>(
    undefined,
  );
  const [worldSize, setWorldSize] = useState<WorldSize>({ width: 1500, height: 900 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = (): void => {
      setWorldSize({
        width: Math.max(1, container.clientWidth * worldUnitsPerPixel),
        height: Math.max(1, container.clientHeight * worldUnitsPerPixel),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: viewport.panX,
      panY: viewport.panY,
    };
    event.currentTarget.classList.add("is-panning");
  };

  const continuePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = worldSize.width / event.currentTarget.clientWidth;
    onViewport({
      ...viewport,
      panX: drag.panX + (event.clientX - drag.x) * scale,
      panY: drag.panY + (event.clientY - drag.y) * scale,
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = undefined;
    event.currentTarget.classList.remove("is-panning");
  };

  const zoom = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onViewport({
      ...viewport,
      zoom: clampZoom(viewport.zoom * Math.exp(-event.deltaY * 0.0012)),
    });
  };

  return (
    <div
      className="scene-interaction"
      ref={containerRef}
      onDoubleClick={() => onViewport({ zoom: 0.72, panX: 0, panY: 0 })}
      onPointerCancel={endPan}
      onPointerDown={beginPan}
      onPointerMove={continuePan}
      onPointerUp={endPan}
      onWheel={zoom}
    >
      <SvgScene
        agents={assignedAgents}
        focusGoalId={focusGoalId}
        goals={goals}
        labelPolicy={labelPolicy}
        moment={moment}
        reducedMotion={reducedMotion}
        selectedId={selectedId}
        theme={theme}
        catchUp={catchUp}
        viewport={viewport}
        worldSize={worldSize}
        onSelect={onSelect}
      />
    </div>
  );
};
