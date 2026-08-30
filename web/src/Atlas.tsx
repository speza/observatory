import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { UniverseMapProjection } from "../../src/projection/types.ts";
import { AgentLogo } from "./AgentLogo.tsx";
import {
  AGENT_CARD_HEIGHT,
  AGENT_CARD_WIDTH,
  agentLinesFor,
  goalAgentPoints,
  goalRadius,
  hash,
  linesFor,
  stateLabel,
  type AtlasCameraCommand,
  type Selection,
} from "./atlasGeometry.ts";
import { useAtlasCamera } from "./useAtlasCamera.ts";

export type { AtlasCameraCommand, Selection } from "./atlasGeometry.ts";

interface AgentStyle extends CSSProperties {
  readonly "--goal-color": string;
}

const concise = (value: string | undefined, maximumCharacters: number): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters - 1).trimEnd()}…`;
};

const basename = (value: string | undefined): string | undefined => value?.match(/[^\\/]+$/u)?.[0];

interface AtlasProps {
  readonly projection: UniverseMapProjection;
  readonly selection?: Selection;
  readonly reservedLeft: number;
  readonly reservedRight: number;
  readonly theme?: "light" | "dark";
  readonly motion?: boolean;
  readonly cameraCommand?: AtlasCameraCommand;
  readonly onClearSelection?: () => void;
  readonly onMoveGoal?: (
    goalId: string,
    position: { readonly x: number; readonly y: number },
  ) => void | Promise<void>;
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

export const Atlas = ({
  projection,
  selection,
  reservedLeft,
  reservedRight,
  theme = "light",
  motion = true,
  cameraCommand,
  onClearSelection,
  onMoveGoal,
  onSelect,
}: AtlasProps): React.JSX.Element => {
  const {
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
    worldTransform,
    zoom,
    zoomIn,
    zoomOut,
  } = useAtlasCamera({ cameraCommand, projection, reservedLeft, reservedRight, selection });
  const goalDrag = useRef<
    | {
        readonly goalId: string;
        readonly pointerId: number;
        readonly startClientX: number;
        readonly startClientY: number;
        readonly startPosition: { readonly x: number; readonly y: number };
        position: { readonly x: number; readonly y: number };
        moved: boolean;
      }
    | undefined
  >(undefined);
  const suppressGoalClick = useRef<string | undefined>(undefined);
  const [draggedGoal, setDraggedGoal] = useState<{
    readonly goalId: string;
    readonly position: { readonly x: number; readonly y: number };
  }>();

  const continueGoalDrag = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = goalDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const deltaX =
      ((event.clientX - drag.startClientX) * size.width) /
      Math.max(1, bounds.width) /
      camera.zoom /
      layout.goalSpacingScale;
    const deltaY =
      ((event.clientY - drag.startClientY) * size.height) /
      Math.max(1, bounds.height) /
      camera.zoom /
      layout.goalSpacingScale;
    if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) >= 4) {
      drag.moved = true;
    }
    const position = {
      x: drag.startPosition.x + deltaX,
      y: drag.startPosition.y + deltaY,
    };
    drag.position = position;
    setDraggedGoal({
      goalId: drag.goalId,
      position,
    });
  };

  const endGoalDrag = (event: ReactPointerEvent<SVGGElement>, commit: boolean): void => {
    const drag = goalDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit && drag.moved) {
      suppressGoalClick.current = drag.goalId;
      const committedPosition = {
        x: Math.round(drag.position.x),
        y: Math.round(drag.position.y),
      };
      setDraggedGoal({ goalId: drag.goalId, position: committedPosition });
      void Promise.resolve(onMoveGoal?.(drag.goalId, committedPosition)).finally(() => {
        setDraggedGoal((current) =>
          current?.goalId === drag.goalId &&
          current.position.x === committedPosition.x &&
          current.position.y === committedPosition.y
            ? undefined
            : current,
        );
      });
    } else {
      setDraggedGoal(undefined);
    }
    goalDrag.current = undefined;
  };

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
        onDoubleClick={reset}
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
            const displayedPosition =
              draggedGoal?.goalId === goal.id ? draggedGoal.position : goal.mapPosition;
            const centre = screenPoint(displayedPosition);
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
            const hasUncertainAgent = goal.agents.some((agent) =>
              [
                "possibly-running",
                "unavailable",
                "stale-observation",
                "conflict",
                "continuity-lost",
              ].includes(agent.lifecycleState),
            );
            const resultCount = goal.agents.filter(
              (agent) => agent.hostHealth === "live" && agent.runtimeState === "done",
            ).length;
            const endedCount = goal.agents.filter((agent) => agent.hostHealth === "stale").length;
            const agentPoints = goalAgentPoints(goal, centre);
            const orbitBands = [
              ...new Map(agentPoints.map((point) => [point.band, point])).values(),
            ];
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
                  aria-label={`${goal.title}, ${goal.agents.length} agents, priority ${goal.priority}, ${resultCount} results to review, ${endedCount} ended`}
                  className={`goal__body ${selected ? "is-selected" : ""}`}
                  data-goal-id={goal.id}
                  data-radius={radius}
                  data-screen-x={centre.x.toFixed(2)}
                  data-screen-y={centre.y.toFixed(2)}
                  onClick={() => {
                    if (suppressGoalClick.current === goal.id) {
                      suppressGoalClick.current = undefined;
                      return;
                    }
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
                  onPointerCancel={(event) => endGoalDrag(event, false)}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !onMoveGoal) return;
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    goalDrag.current = {
                      goalId: goal.id,
                      pointerId: event.pointerId,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      startPosition: goal.mapPosition,
                      position: goal.mapPosition,
                      moved: false,
                    };
                    setDraggedGoal({ goalId: goal.id, position: goal.mapPosition });
                  }}
                  onPointerMove={continueGoalDrag}
                  onPointerUp={(event) => endGoalDrag(event, true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect({ type: "goal", id: goal.id });
                    }
                  }}
                  role="button"
                  style={{ cursor: onMoveGoal ? "grab" : "pointer" }}
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
                  <circle className="goal__selection" r={radius + 7} />
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
                  {resultCount + endedCount > 0 ? (
                    <g
                      className="goal__closeout"
                      transform={`translate(${radius * -0.46} ${-radius * 0.58})`}
                    >
                      <rect height="22" rx="11" width="56" x="-28" y="-11" />
                      <text y="3">
                        {resultCount}R · {endedCount}E
                      </text>
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
                  const uncertain = [
                    "possibly-running",
                    "unavailable",
                    "stale-observation",
                    "conflict",
                    "continuity-lost",
                  ].includes(agent.lifecycleState);
                  const agentSelected = selection?.type === "agent" && selection.id === agent.id;
                  const state = stateLabel(agent);
                  const nameLines = agentLinesFor(agent.displayName);
                  const identity = concise(agent.harnessId ?? agent.provider ?? "session", 16);
                  const description = concise(agent.description, 30);
                  const repository = basename(agent.repository) ?? basename(agent.worktree);
                  const workspace = concise(
                    [repository, agent.branch].filter(Boolean).join(" / ") || undefined,
                    30,
                  );
                  const style: AgentStyle = { "--goal-color": palette.mark };
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
                      aria-label={`${agent.displayName}, ${state}${description ? `, ${description}` : ""}${workspace ? `, ${workspace}` : ""}`}
                      role="button"
                      style={style}
                      tabIndex={0}
                      transform={`translate(${point.x} ${point.y})`}
                    >
                      <g
                        className="agent__presence"
                        style={{ animationDelay: `${-(hash(agent.id) % 4200)}ms` }}
                      >
                        {attention ? (
                          <rect
                            className="agent__attention-wave"
                            height={AGENT_CARD_HEIGHT + 8}
                            rx="7"
                            width={AGENT_CARD_WIDTH + 8}
                            x={-AGENT_CARD_WIDTH / 2 - 4}
                            y={-AGENT_CARD_HEIGHT / 2 - 4}
                          />
                        ) : null}
                        <rect
                          className="agent__card"
                          height={AGENT_CARD_HEIGHT}
                          rx="4"
                          width={AGENT_CARD_WIDTH}
                          x={-AGENT_CARD_WIDTH / 2}
                          y={-AGENT_CARD_HEIGHT / 2}
                        />
                        <line className="agent__rule" x1="-76" x2="76" y1="-22" y2="-22" />
                        <g className="agent__provider-mark" transform="translate(-71 -35)">
                          <AgentLogo harnessId={agent.harnessId} map provider={agent.provider} />
                        </g>
                        <text className="agent__identity" x="-57" y="-32">
                          {identity?.toUpperCase()}
                        </text>
                        <g className="agent__state" transform="translate(78 -35)">
                          <circle r="3" />
                          <text x="-8" y="3">
                            {state.toUpperCase()}
                          </text>
                        </g>
                        {attention ? (
                          <g className="agent__review-badge" transform="translate(88 -50)">
                            <circle r="8" />
                            <text y="3">!</text>
                          </g>
                        ) : null}
                        <text className="agent__name" x="-76" y="-5">
                          {nameLines.map((line, lineIndex) => (
                            <tspan
                              dy={lineIndex === 0 ? 0 : 15}
                              key={`${line}-${lineIndex}`}
                              x="-76"
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                        <text
                          className="agent__summary"
                          x="-76"
                          y={nameLines.length > 1 ? "25" : "11"}
                        >
                          {description ?? workspace ?? "No session summary"}
                        </text>
                        {description && workspace ? (
                          <text className="agent__workspace" x="-76" y="42">
                            {workspace}
                          </text>
                        ) : null}
                      </g>
                      <rect
                        className="agent__selection"
                        height={AGENT_CARD_HEIGHT + 8}
                        rx="7"
                        width={AGENT_CARD_WIDTH + 8}
                        x={-AGENT_CARD_WIDTH / 2 - 4}
                        y={-AGENT_CARD_HEIGHT / 2 - 4}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="zoom-control" aria-label="Map zoom controls">
        <button aria-label="Zoom out" onClick={zoomOut} type="button">
          −
        </button>
        <button
          aria-label="Reset map zoom"
          className="zoom-control__level"
          onClick={resetCamera}
          type="button"
        >
          {Math.round(camera.zoom * 100)}%
        </button>
        <button aria-label="Zoom in" onClick={zoomIn} type="button">
          +
        </button>
        <button aria-label="Fit map to screen" onClick={reset} type="button">
          Fit
        </button>
      </div>
    </div>
  );
};
