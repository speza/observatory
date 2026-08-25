import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
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

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Camera {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

interface OrbitPlacement {
  readonly band: number;
  readonly phase: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly x: number;
  readonly y: number;
}

interface AtlasProps {
  readonly projection: UniverseMapProjection;
  readonly selection?: Selection;
  readonly reservedLeft: number;
  readonly reservedRight: number;
  readonly theme?: "light" | "dark";
  readonly motion?: boolean;
  readonly cameraCommand?: AtlasCameraCommand;
  readonly onClearSelection?: () => void;
  readonly onSelect: (selection: Selection) => void;
}

const palettes = {
  light: [
    { body: "#c77962", mark: "#8f3f2d" },
    { body: "#d7aa5e", mark: "#80601b" },
    { body: "#78a097", mark: "#356b62" },
    { body: "#bd7b89", mark: "#814150" },
    { body: "#7895ac", mark: "#365f7b" },
    { body: "#9380a2", mark: "#604b72" },
  ],
  dark: [
    { body: "#7e3f31", mark: "#dc8c72" },
    { body: "#7a5924", mark: "#e0b865" },
    { body: "#355f58", mark: "#82b7ab" },
    { body: "#754352", mark: "#d68b99" },
    { body: "#39576d", mark: "#86aac4" },
    { body: "#594663", mark: "#ad94bb" },
  ],
} as const;

const hash = (value: string): number => {
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

const linesFor = (title: string): readonly string[] => wrappedLines(title, 25, 3);
const agentLinesFor = (name: string): readonly string[] => wrappedLines(name, 17, 2);

const stateLabel = (agent: MapAgentView): string =>
  agent.hostHealth === "live" ? agent.runtimeState : agent.hostHealth;

const sameSelection = (left: Selection | undefined, right: Selection | undefined): boolean =>
  left?.type === right?.type && left?.id === right?.id;

const selectionBelongsToFocus = (
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

const allPoints = (projection: UniverseMapProjection): readonly { x: number; y: number }[] => [
  ...projection.goals.flatMap((goal) => [
    goal.mapPosition,
    ...goal.agents.map((agent) => agent.mapPosition),
  ]),
  ...projection.unassigned.map((agent) => agent.mapPosition),
  projection.inboxPosition,
];

const goalRadius = (goal: MapGoalView): number =>
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

const goalAgentPoints = (
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

const inboxAgentPoints = (
  projection: UniverseMapProjection,
  centre: { readonly x: number; readonly y: number },
): readonly OrbitPlacement[] =>
  projection.unassigned.map((agent) =>
    orbitPlacement({
      id: agent.id,
      point: agent.mapPosition,
      anchor: projection.inboxPosition,
      centre,
      radiusX: 92,
      radiusY: 58,
      ringUnitX: 72,
      ringUnitY: 32,
      bandStepX: 34,
      bandStepY: 26,
    }),
  );

export const Atlas = ({
  projection,
  selection,
  reservedLeft,
  reservedRight,
  theme = "light",
  motion = true,
  cameraCommand,
  onClearSelection,
  onSelect,
}: AtlasProps): React.JSX.Element => {
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
    const agentIndex = projection.unassigned.findIndex((candidate) => candidate.id === target.id);
    if (agentIndex < 0) return undefined;
    const centre = screenPoint(projection.inboxPosition);
    return inboxAgentPoints(projection, centre)[agentIndex];
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
        setCamera((current) => ({ ...current, zoom: Math.min(2.8, current.zoom * 1.2) }));
        return;
      case "zoom-out":
        setCamera((current) => ({ ...current, zoom: Math.max(0.58, current.zoom / 1.2) }));
        return;
      case "reset":
        setFocusedSelection(undefined);
        setCamera({ zoom: 1, panX: 0, panY: 0 });
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

  const worldTransform = `translate(${camera.panX} ${camera.panY}) translate(${layout.centreX} ${layout.centreY}) scale(${camera.zoom}) translate(${-layout.centreX} ${-layout.centreY})`;

  return (
    <div
      className={`atlas ${motion ? "atlas--motion" : "atlas--still"} ${focusedSelection ? "atlas--spotlight" : ""}`}
      ref={containerRef}
    >
      <div aria-label="Agent state key" className="atlas__status-key">
        <span>
          <i className="atlas__status-swatch atlas__status-swatch--working" />
          Working
        </span>
        <span>
          <i className="atlas__status-swatch atlas__status-swatch--idle" />
          Idle
        </span>
        <span>
          <i className="atlas__status-swatch atlas__status-swatch--review">!</i>
          Needs review
        </span>
      </div>
      <svg
        aria-label={`${projection.counts.goals} goals and ${projection.counts.agents} agents`}
        className={isPanning ? "is-panning" : ""}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClearSelection?.();
        }}
        onDoubleClick={() => {
          setFocusedSelection(undefined);
          setCamera({ zoom: 1, panX: 0, panY: 0 });
        }}
        onPointerCancel={endPan}
        onPointerDown={beginPan}
        onPointerMove={continuePan}
        onPointerUp={endPan}
        onWheel={zoom}
        role="group"
        tabIndex={0}
        viewBox={`0 0 ${size.width} ${size.height}`}
      >
        <title>Observatory goal and agent atlas</title>
        <defs>
          {projection.goals.map((goal) => (
            <clipPath id={`goal-clip-${hash(goal.id)}`} key={goal.id}>
              <circle r={goalRadius(goal)} />
            </clipPath>
          ))}
        </defs>
        <rect
          aria-hidden="true"
          className="atlas__hit-area"
          height={size.height}
          onClick={() => onClearSelection?.()}
          width={size.width}
          x="0"
          y="0"
        />
        <g className="map-grain" aria-hidden="true">
          {Array.from({ length: 54 }, (_, index) => (
            <circle
              cx={(index * 197 + 43) % Math.max(1, size.width)}
              cy={(index * 311 + 71) % Math.max(1, size.height)}
              key={index}
              r={index % 9 === 0 ? 1.2 : 0.55}
            />
          ))}
        </g>
        <g
          className="atlas__world"
          data-camera-zoom={camera.zoom}
          data-focus-target={focusedSelection?.id}
          transform={worldTransform}
        >
          {projection.goals.map((goal) => {
            const centre = screenPoint(goal.mapPosition);
            const radius = goalRadius(goal);
            const token = hash(goal.id);
            const palette = palettes[theme][token % palettes[theme].length] ?? palettes[theme][0];
            const title = linesFor(goal.title);
            const selected = selection?.type === "goal" && selection.id === goal.id;
            const focusedGoal =
              focusedSelection?.type === "goal"
                ? focusedSelection.id === goal.id
                : focusedSelection?.type === "agent" &&
                  goal.agents.some((agent) => agent.id === focusedSelection.id);
            const spotlightActive = focusedSelection !== undefined;
            const hasWorkingAgent = goal.agents.some(
              (agent) => agent.hostHealth === "live" && agent.runtimeState === "working",
            );
            const hasUncertainAgent = goal.agents.some((agent) => agent.hostHealth !== "live");
            const agentPoints = goalAgentPoints(goal, centre);
            const orbitBands = [
              ...new Map(agentPoints.map((point) => [point.band, point])).values(),
            ];
            const focusedAgent =
              selection?.type === "agent" && goal.agents.some((agent) => agent.id === selection.id);
            const focused = selected || focusedAgent;
            // Keep the portfolio quiet, but make a genuinely focused goal useful:
            // once the camera is in its detail state, every agent name is available.
            const labelBudget = focused && camera.zoom >= 1.05 ? goal.agents.length : 2;
            const visibleLabelIds = new Set(
              goal.agents
                .map((agent, index) => ({
                  agent,
                  index,
                  attention: agent.attention?.requiresHumanInput === true,
                  selected: selection?.type === "agent" && selection.id === agent.id,
                }))
                .filter((candidate) => candidate.attention || candidate.selected || focused)
                .sort(
                  (left, right) =>
                    Number(right.selected) - Number(left.selected) ||
                    Number(right.attention) - Number(left.attention) ||
                    left.index - right.index,
                )
                .slice(0, labelBudget)
                .map((candidate) => candidate.agent.id),
            );
            return (
              <g
                className={`goal ${goal.status !== "active" ? `goal--${goal.status}` : ""} ${hasWorkingAgent ? "goal--working" : ""} ${goal.attentionCount > 0 ? "goal--attention" : ""} ${hasUncertainAgent ? "goal--uncertain" : ""} ${spotlightActive && focusedGoal ? "goal--spotlight-focus" : ""} ${spotlightActive && !focusedGoal ? "goal--spotlight-dimmed" : ""}`}
                key={goal.id}
              >
                <g className="goal__orbits" aria-hidden="true">
                  {orbitBands.map((orbit) => (
                    <ellipse
                      cx={centre.x}
                      cy={centre.y}
                      key={orbit.band}
                      rx={orbit.radiusX}
                      ry={orbit.radiusY}
                    />
                  ))}
                </g>
                <g
                  aria-label={`${goal.title}, ${goal.agents.length} agents, priority ${goal.priority}`}
                  className={`goal__body ${selected ? "is-selected" : ""}`}
                  data-goal-id={goal.id}
                  data-radius={radius}
                  data-screen-x={centre.x.toFixed(2)}
                  data-screen-y={centre.y.toFixed(2)}
                  onClick={() => {
                    const next = { type: "goal" as const, id: goal.id };
                    onSelect(next);
                    focusPoint(centre, next);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onSelect({ type: "goal", id: goal.id });
                    focusPoint(centre, { type: "goal", id: goal.id });
                  }}
                  onFocus={() => onSelect({ type: "goal", id: goal.id })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect({ type: "goal", id: goal.id });
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${centre.x} ${centre.y})`}
                >
                  <circle className="goal__surface" fill={palette.body} r={radius} />
                  <g clipPath={`url(#goal-clip-${token})`}>
                    <path
                      className="goal__land goal__land--upper"
                      d={`M${-radius} 2 Q${-radius * 0.35} ${-radius * 0.45} 8 ${-radius * 0.16} T${radius} ${-radius * 0.38} V${radius * 0.06} Q${radius * 0.16} ${radius * 0.26} ${-radius} ${radius * 0.14}Z`}
                      fill={palette.mark}
                    />
                    <path
                      className="goal__land goal__land--lower"
                      d={`M${-radius} ${radius * 0.5} Q${-radius * 0.18} ${radius * 0.16} ${radius} ${radius * 0.36} V${radius} H${-radius}Z`}
                    />
                  </g>
                  <circle className="goal__outline" r={radius + 2} stroke={palette.mark} />
                  <text className="goal__priority" y="-14">
                    GOAL / {goal.priority}
                  </text>
                  <text className="goal__count" y="15">
                    {String(goal.agents.length).padStart(2, "0")}
                  </text>
                  <text className="goal__unit" y="33">
                    AGENTS
                  </text>
                  {goal.attentionCount > 0 ? (
                    <g
                      className="goal__attention"
                      transform={`translate(${radius * 0.46} ${-radius * 0.58})`}
                    >
                      <rect height="22" rx="11" width="48" x="-24" y="-11" />
                      <text y="3">{goal.attentionCount} ATTN</text>
                    </g>
                  ) : null}
                </g>
                <line
                  className="goal__leader"
                  x1={centre.x}
                  x2={centre.x}
                  y1={centre.y + radius + 3}
                  y2={centre.y + radius + 18}
                />
                <text className="goal__title" textAnchor="middle">
                  {title.map((line, index) => (
                    <tspan
                      key={`${line}-${index}`}
                      x={centre.x}
                      y={centre.y + radius + 38 + index * 18}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
                {goal.agents.map((agent, agentIndex) => {
                  const point = agentPoints[agentIndex];
                  if (!point) return null;
                  const attention = agent.attention?.requiresHumanInput === true;
                  const uncertain = agent.hostHealth !== "live";
                  const agentSelected = selection?.type === "agent" && selection.id === agent.id;
                  const showLabel = visibleLabelIds.has(agent.id);
                  const nearLeftEdge = point.x < reservedLeft + 150;
                  const nearRightEdge = point.x > size.width - reservedRight - 150;
                  const labelOnLeft = nearRightEdge || (!nearLeftEdge && point.x < centre.x);
                  const state = stateLabel(agent);
                  const labelX = labelOnLeft ? -17 : 17;
                  const nameLines = agentLinesFor(agent.displayName);
                  return (
                    <g
                      className={`agent agent--${state} ${attention ? "agent--attention" : ""} ${uncertain ? "agent--uncertain" : ""} ${agentSelected ? "is-selected" : ""}`}
                      data-agent-id={agent.id}
                      data-parent-goal-id={goal.id}
                      data-screen-x={point.x.toFixed(2)}
                      data-screen-y={point.y.toFixed(2)}
                      data-orbit-rx={point.radiusX}
                      data-orbit-ry={point.radiusY}
                      key={agent.id}
                      onClick={() => {
                        const next = { type: "agent" as const, id: agent.id };
                        onSelect(next);
                        if (!focusedGoal) focusPoint(centre, { type: "goal", id: goal.id });
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        onSelect({ type: "agent", id: agent.id });
                        focusPoint(point, { type: "agent", id: agent.id });
                      }}
                      onFocus={() => onSelect({ type: "agent", id: agent.id })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect({ type: "agent", id: agent.id });
                        }
                      }}
                      aria-label={`${agent.displayName}, ${state}`}
                      role="button"
                      style={{ color: palette.mark }}
                      tabIndex={0}
                      transform={`translate(${point.x} ${point.y})`}
                    >
                      <g
                        className="agent__presence"
                        style={{ animationDelay: `${-(hash(agent.id) % 4200)}ms` }}
                      >
                        {attention ? <circle className="agent__attention-wave" r="20" /> : null}
                        <circle
                          className="agent__field"
                          fill={palette.mark}
                          r={attention ? 20 : 15}
                        />
                        <circle className="agent__mark" fill={palette.mark} r="9" />
                        <circle className="agent__core" r="3.3" />
                        {attention ? (
                          <g className="agent__review-badge" transform="translate(13 -13)">
                            <circle r="7" />
                            <text y="3">!</text>
                          </g>
                        ) : null}
                        {showLabel ? (
                          <text
                            className="agent__label"
                            textAnchor={labelOnLeft ? "end" : "start"}
                            x={labelX}
                            y={nameLines.length > 1 ? -8 : -2}
                          >
                            {nameLines.map((line, lineIndex) => (
                              <tspan
                                className="agent__name"
                                dy={lineIndex === 0 ? 0 : 12}
                                key={`${line}-${lineIndex}`}
                                x={labelX}
                              >
                                {line}
                              </tspan>
                            ))}
                            <tspan dy="11" x={labelX}>
                              {state.toUpperCase()}
                            </tspan>
                          </text>
                        ) : null}
                      </g>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {projection.unassigned.length > 0
            ? (() => {
                const centre = screenPoint(projection.inboxPosition);
                const points = inboxAgentPoints(projection, centre);
                const orbitBands = [
                  ...new Map(points.map((point) => [point.band, point])).values(),
                ];
                const inboxFocused =
                  focusedSelection?.type === "agent" &&
                  projection.unassigned.some((agent) => agent.id === focusedSelection.id);
                return (
                  <g
                    className={`inbox-sector ${focusedSelection && !inboxFocused ? "inbox-sector--spotlight-dimmed" : ""}`}
                  >
                    {orbitBands.map((orbit) => (
                      <ellipse
                        className="inbox-sector__orbit"
                        cx={centre.x}
                        cy={centre.y}
                        key={orbit.band}
                        rx={orbit.radiusX}
                        ry={orbit.radiusY}
                      />
                    ))}
                    <g
                      className="inbox-sector__body"
                      transform={`translate(${centre.x} ${centre.y})`}
                    >
                      <rect height="70" rx="2" width="116" x="-58" y="-35" />
                      <text className="inbox-sector__kind" y="-7">
                        UNASSIGNED
                      </text>
                      <text className="inbox-sector__count" y="18">
                        {String(projection.unassigned.length).padStart(2, "0")}
                      </text>
                    </g>
                    {projection.unassigned.map((agent, agentIndex) => {
                      const point = points[agentIndex];
                      if (!point) return null;
                      const selected = selection?.type === "agent" && selection.id === agent.id;
                      const uncertain = agent.hostHealth !== "live";
                      const attention = agent.attention?.requiresHumanInput === true;
                      return (
                        <g
                          className={`agent agent--unassigned ${uncertain ? "agent--uncertain" : ""} ${selected ? "is-selected" : ""}`}
                          data-agent-id={agent.id}
                          key={agent.id}
                          onClick={() => {
                            const next = { type: "agent" as const, id: agent.id };
                            onSelect(next);
                            if (!inboxFocused) focusPoint(point, next);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            onSelect({ type: "agent", id: agent.id });
                            focusPoint(point, { type: "agent", id: agent.id });
                          }}
                          onFocus={() => onSelect({ type: "agent", id: agent.id })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect({ type: "agent", id: agent.id });
                            }
                          }}
                          aria-label={`${agent.displayName}, ${stateLabel(agent)}`}
                          role="button"
                          tabIndex={0}
                          transform={`translate(${point.x} ${point.y})`}
                        >
                          <g className="agent__presence">
                            <circle className="agent__field" r="15" />
                            <circle className="agent__mark" r="9" />
                            <circle className="agent__core" r="3.3" />
                            {selected || attention ? (
                              <text className="agent__label" textAnchor="start" x="17" y="-2">
                                <tspan className="agent__name">{agent.displayName}</tspan>
                                <tspan dy="12" x="17">
                                  {stateLabel(agent).toUpperCase()}
                                </tspan>
                              </text>
                            ) : null}
                          </g>
                        </g>
                      );
                    })}
                  </g>
                );
              })()
            : null}
        </g>
      </svg>
      <div className="zoom-control" aria-label="Map zoom controls">
        <button
          onClick={() =>
            setCamera((value) => ({ ...value, zoom: Math.max(0.58, value.zoom / 1.2) }))
          }
          type="button"
        >
          −
        </button>
        <button onClick={() => setCamera({ zoom: 1, panX: 0, panY: 0 })} type="button">
          {Math.round(camera.zoom * 100)}%
        </button>
        <button
          onClick={() =>
            setCamera((value) => ({ ...value, zoom: Math.min(2.8, value.zoom * 1.2) }))
          }
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
};
