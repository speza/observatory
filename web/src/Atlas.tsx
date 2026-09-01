import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GitCompareArrows, Terminal } from "lucide-react";
import type { AgentView, UniverseMapProjection } from "../../src/projection/types.ts";
import { AgentLogo } from "./AgentLogo.tsx";
import {
  AGENT_CARD_HEIGHT,
  AGENT_CARD_WIDTH,
  goalAgentPoints,
  goalRadius,
  hash,
  linesFor,
  stateLabel,
  type AtlasCameraCommand,
  type Selection,
} from "./atlasGeometry.ts";
import { presentAgentCard } from "./agentCardPresentation.ts";
import { useAtlasCamera } from "./useAtlasCamera.ts";

export type { AtlasCameraCommand, Selection } from "./atlasGeometry.ts";

const GRID_LOGICAL_STEP = 24;
const GRID_EXTENT = 100_000;

const snapCoordinateToGrid = (value: number): number => {
  const magnitude = Math.round(Math.abs(value) / GRID_LOGICAL_STEP) * GRID_LOGICAL_STEP;
  return value < 0 ? -magnitude : magnitude;
};

export const snapToAtlasGrid = (position: { readonly x: number; readonly y: number }) => ({
  x: snapCoordinateToGrid(position.x),
  y: snapCoordinateToGrid(position.y),
});

interface AgentStyle extends CSSProperties {
  readonly "--goal-color": string;
  readonly "--agent-phase": string;
}

interface GoalStyle extends CSSProperties {
  readonly "--goal-color": string;
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
  readonly onFocusSelection?: (selection: Selection) => void;
  readonly onMoveGoal?: (
    goalId: string,
    position: { readonly x: number; readonly y: number },
  ) => void | Promise<void>;
  readonly onOpenTerminal?: (agent: AgentView) => void;
  readonly onReviewChanges?: (agent: AgentView) => void;
  readonly onSelect: (selection: Selection) => void;
}

const runQuickAction = (event: ReactKeyboardEvent<SVGGElement>, action: () => void): void => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  action();
};

const palettes = {
  light: [
    { body: "#b9c7b7", mark: "#1e5b50" },
    { body: "#c8c2a5", mark: "#756521" },
    { body: "#a9c5c4", mark: "#24656a" },
    { body: "#c9b5a5", mark: "#8c4d36" },
    { body: "#b3bec9", mark: "#405f78" },
    { body: "#beb7c4", mark: "#66516f" },
  ],
  dark: [
    { body: "#294a42", mark: "#81b7a9" },
    { body: "#504a2e", mark: "#c6b974" },
    { body: "#27474c", mark: "#78b6bd" },
    { body: "#513b31", mark: "#d19070" },
    { body: "#304658", mark: "#8aaac1" },
    { body: "#44394c", mark: "#af98b5" },
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
  onFocusSelection,
  onMoveGoal,
  onOpenTerminal,
  onReviewChanges,
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
  const gridOrigin = screenPoint({ x: 0, y: 0 });
  const gridStep = GRID_LOGICAL_STEP * layout.goalSpacingScale;

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
    const position = drag.moved
      ? snapToAtlasGrid({
          x: drag.startPosition.x + deltaX,
          y: drag.startPosition.y + deltaY,
        })
      : drag.startPosition;
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
      const committedPosition = snapToAtlasGrid(drag.position);
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
          <pattern
            data-logical-step={GRID_LOGICAL_STEP}
            height={gridStep}
            id="atlas-coordinate-grid"
            patternUnits="userSpaceOnUse"
            width={gridStep}
            x={gridOrigin.x}
            y={gridOrigin.y}
          >
            <path className="atlas__grid-major" d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} />
          </pattern>
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
        <g
          className="atlas__world"
          data-camera-zoom={camera.zoom}
          data-focus-target={focusedSelection?.id}
          transform={worldTransform}
        >
          <rect
            aria-hidden="true"
            className="atlas__coordinate-grid"
            data-grid-origin-x={gridOrigin.x}
            data-grid-origin-y={gridOrigin.y}
            fill="url(#atlas-coordinate-grid)"
            height={GRID_EXTENT * 2}
            width={GRID_EXTENT * 2}
            x={-GRID_EXTENT}
            y={-GRID_EXTENT}
          />
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
              ["runtime-unknown", "conversation-unavailable", "conflict"].includes(
                agent.lifecycleState,
              ),
            );
            const agentPoints = goalAgentPoints(goal, centre);
            const orbitBands = [
              ...new Map(agentPoints.map((point) => [point.band, point])).values(),
            ];
            const goalStyle: GoalStyle = { "--goal-color": palette.mark };
            return (
              <g
                className={`goal ${goal.status !== "active" ? `goal--${goal.status}` : ""} ${hasWorkingAgent ? "goal--working" : ""} ${goal.attentionCount > 0 ? "goal--attention" : ""} ${hasUncertainAgent ? "goal--uncertain" : ""} ${spotlightActive && focusedGoal ? "goal--spotlight-focus" : ""} ${spotlightActive && !focusedGoal ? "goal--spotlight-dimmed" : ""}`}
                key={goal.id}
                style={goalStyle}
              >
                <g
                  aria-hidden="true"
                  className="goal__datum"
                  transform={`translate(${centre.x} ${centre.y})`}
                >
                  <circle r={radius + 12} />
                  <path
                    d={`M${-radius - 20} 0 H${radius + 20} M0 ${-radius - 20} V${radius + 20}`}
                  />
                </g>
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
                  aria-label={`${goal.title}, ${goal.agents.length} agents, priority ${goal.priority}, ${goal.attentionCount} need you, ${goal.staleCount} monitor`}
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
                  <g aria-hidden="true" className="goal__range-rings">
                    <circle cx={radius * -0.12} cy={radius * -0.08} r={radius * 0.72} />
                    <circle cx={radius * -0.12} cy={radius * -0.08} r={radius * 0.52} />
                  </g>
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
                      <text y="3">{goal.attentionCount} NEED</text>
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
                    "runtime-unknown",
                    "conversation-unavailable",
                    "conflict",
                  ].includes(agent.lifecycleState);
                  const agentSelected = selection?.type === "agent" && selection.id === agent.id;
                  const canOpenTerminal =
                    agent.executionPresence === "live" && onOpenTerminal !== undefined;
                  const canReview =
                    agent.attention?.action === "review" && onReviewChanges !== undefined;
                  const state = stateLabel(agent);
                  const card = presentAgentCard(agent);
                  const style: AgentStyle = {
                    "--goal-color": palette.mark,
                    "--agent-phase": `${-(hash(agent.id) % 4200)}ms`,
                  };
                  const focusAgent = (): void =>
                    (onFocusSelection ?? onSelect)({ type: "agent", id: agent.id });
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
                      style={style}
                      transform={`translate(${point.x} ${point.y})`}
                    >
                      <g
                        aria-label={`${agent.displayName}, ${state}${card.detail ? `, ${card.detail}` : ""}${card.context ? `, ${card.context}` : ""}${agent.attention ? `, ${agent.attention.explanation}` : ""}`}
                        className="agent__card-target"
                        onClick={() => {
                          onSelect({ type: "agent", id: agent.id });
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          onSelect({ type: "agent", id: agent.id });
                          focusPoint(point, { type: "agent", id: agent.id });
                        }}
                        onFocus={focusAgent}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect({ type: "agent", id: agent.id });
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <g className="agent__presence">
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
                            className="agent__working-aura"
                            height={AGENT_CARD_HEIGHT + 8}
                            rx="8"
                            width={AGENT_CARD_WIDTH + 8}
                            x={-AGENT_CARD_WIDTH / 2 - 4}
                            y={-AGENT_CARD_HEIGHT / 2 - 4}
                          />
                          <rect
                            className="agent__card"
                            height={AGENT_CARD_HEIGHT}
                            rx="4"
                            width={AGENT_CARD_WIDTH}
                            x={-AGENT_CARD_WIDTH / 2}
                            y={-AGENT_CARD_HEIGHT / 2}
                          />
                          <rect
                            className="agent__working-circuit"
                            height={AGENT_CARD_HEIGHT}
                            rx="4"
                            width={AGENT_CARD_WIDTH}
                            x={-AGENT_CARD_WIDTH / 2}
                            y={-AGENT_CARD_HEIGHT / 2}
                          />
                          <line className="agent__rule" x1="-96" x2="96" y1="-22" y2="-22" />
                          <g className="agent__provider-mark" transform="translate(-91 -35)">
                            <AgentLogo harnessId={agent.harnessId} map provider={agent.provider} />
                          </g>
                          <text className="agent__identity" x="-77" y="-32">
                            {card.identity}
                          </text>
                          <g className="agent__state" transform="translate(98 -35)">
                            <circle className="agent__state-pulse" r="3" />
                            <circle className="agent__state-dot" r="3" />
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
                          <text className="agent__name" x="-96" y="-5">
                            {card.titleLines.map((line, lineIndex) => (
                              <tspan
                                dy={lineIndex === 0 ? 0 : 15}
                                key={`${line}-${lineIndex}`}
                                x="-96"
                              >
                                {line}
                              </tspan>
                            ))}
                          </text>
                          {card.detail ? (
                            <text
                              className="agent__activity"
                              x="-96"
                              y={card.titleLines.length > 1 ? "25" : "11"}
                            >
                              {card.detail}
                            </text>
                          ) : null}
                          {card.context ? (
                            <text className="agent__context" x="-96" y="42">
                              {card.context}
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
                      {canOpenTerminal || canReview ? (
                        <g className="agent__quick-actions">
                          {canReview ? (
                            <g
                              aria-label={`Review ${agent.displayName} changes`}
                              className="agent__quick-action"
                              onClick={(event) => {
                                event.stopPropagation();
                                onReviewChanges?.(agent);
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onFocus={focusAgent}
                              onKeyDown={(event) =>
                                runQuickAction(event, () => onReviewChanges?.(agent))
                              }
                              onPointerDown={(event) => event.stopPropagation()}
                              role="button"
                              tabIndex={0}
                            >
                              <title>Review changes</title>
                              <rect height="20" rx="3" width="22" x="48" y="27" />
                              <GitCompareArrows
                                aria-hidden="true"
                                height="14"
                                strokeWidth="1.8"
                                width="14"
                                x="52"
                                y="30"
                              />
                            </g>
                          ) : null}
                          {canOpenTerminal ? (
                            <g
                              aria-label={`Open ${agent.displayName} terminal`}
                              className="agent__quick-action"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenTerminal?.(agent);
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onFocus={focusAgent}
                              onKeyDown={(event) =>
                                runQuickAction(event, () => onOpenTerminal?.(agent))
                              }
                              onPointerDown={(event) => event.stopPropagation()}
                              role="button"
                              tabIndex={0}
                            >
                              <title>Open terminal</title>
                              <rect height="20" rx="3" width="22" x="74" y="27" />
                              <Terminal
                                aria-hidden="true"
                                height="14"
                                strokeWidth="1.8"
                                width="14"
                                x="78"
                                y="30"
                              />
                            </g>
                          ) : null}
                        </g>
                      ) : null}
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
