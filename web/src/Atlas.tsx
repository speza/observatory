import type { UniverseMapProjection } from "../../src/projection/types.ts";
import {
  agentLinesFor,
  focusedLabelOffsets,
  goalAgentPoints,
  goalRadius,
  hash,
  labelRectFor,
  labelsOverlap,
  linesFor,
  stateLabel,
  type AtlasCameraCommand,
  type LabelRect,
  type Selection,
} from "./atlasGeometry.ts";
import { useAtlasCamera } from "./useAtlasCamera.ts";

export type { AtlasCameraCommand, Selection } from "./atlasGeometry.ts";
export { focusedLabelOffsets } from "./atlasGeometry.ts";

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
  const {
    beginPan,
    camera,
    containerRef,
    continuePan,
    endPan,
    focusedSelection,
    focusPoint,
    isPanning,
    reset,
    resetCamera,
    screenPoint,
    size,
    worldTransform,
    zoom,
    zoomIn,
    zoomOut,
  } = useAtlasCamera({ cameraCommand, projection, reservedLeft, reservedRight, selection });

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
            const resultCount = goal.agents.filter(
              (agent) => agent.hostHealth === "live" && agent.runtimeState === "done",
            ).length;
            const endedCount = goal.agents.filter((agent) => agent.hostHealth === "stale").length;
            const agentPoints = goalAgentPoints(goal, centre);
            const orbitBands = [
              ...new Map(agentPoints.map((point) => [point.band, point])).values(),
            ];
            const focusedAgent =
              selection?.type === "agent" && goal.agents.some((agent) => agent.id === selection.id);
            const focused = selected || focusedAgent;
            const labelCandidates = goal.agents
              .map((agent, index) => {
                const point = agentPoints[index];
                if (!point) return undefined;
                const nearLeftEdge = point.x < reservedLeft + 150;
                const nearRightEdge = point.x > size.width - reservedRight - 150;
                const labelOnLeft = nearRightEdge || (!nearLeftEdge && point.x < centre.x);
                const state = stateLabel(agent);
                const lines = agentLinesFor(agent.displayName);
                return {
                  agent,
                  attention: agent.attention?.requiresHumanInput === true,
                  index,
                  labelOnLeft,
                  rect: labelRectFor(point, lines, state, labelOnLeft),
                  selected: selection?.type === "agent" && selection.id === agent.id,
                };
              })
              .filter(
                (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
              )
              .filter(
                (candidate) => candidate.attention || candidate.selected || focused || focusedGoal,
              )
              .sort(
                (left, right) =>
                  Number(right.selected) - Number(left.selected) ||
                  Number(right.attention) - Number(left.attention) ||
                  left.index - right.index,
              );
            const focusedOffsets = focusedGoal
              ? focusedLabelOffsets(
                  labelCandidates.map((candidate) => ({
                    id: candidate.agent.id,
                    labelOnLeft: candidate.labelOnLeft,
                    rect: candidate.rect,
                  })),
                )
              : new Map<string, number>();
            const visibleLabelIds = new Set<string>();
            const visibleLabelRects: LabelRect[] = [];
            for (const candidate of labelCandidates) {
              if (focusedGoal) {
                visibleLabelIds.add(candidate.agent.id);
                continue;
              }
              const required = candidate.selected || candidate.attention;
              if (
                !required &&
                visibleLabelRects.some((rect) => labelsOverlap(rect, candidate.rect))
              ) {
                continue;
              }
              visibleLabelIds.add(candidate.agent.id);
              visibleLabelRects.push(candidate.rect);
            }
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
                  const uncertain = agent.hostHealth !== "live";
                  const agentSelected = selection?.type === "agent" && selection.id === agent.id;
                  const showLabel = visibleLabelIds.has(agent.id);
                  const nearLeftEdge = point.x < reservedLeft + 150;
                  const nearRightEdge = point.x > size.width - reservedRight - 150;
                  const labelOnLeft = nearRightEdge || (!nearLeftEdge && point.x < centre.x);
                  const state = stateLabel(agent);
                  const labelX = labelOnLeft ? -17 : 17;
                  const nameLines = agentLinesFor(agent.displayName);
                  const labelOffsetY = focusedOffsets.get(agent.id) ?? 0;
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
                        {state === "working" && !attention ? (
                          <circle className="agent__working-wave" r="17" />
                        ) : null}
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
                        {showLabel && focusedGoal && Math.abs(labelOffsetY) > 0.5 ? (
                          <path
                            className="agent__label-leader"
                            d={`M ${labelOnLeft ? -10 : 10} 0 L ${labelX * 0.72} ${labelOffsetY} L ${labelX} ${labelOffsetY}`}
                          />
                        ) : null}
                        {showLabel ? (
                          <text
                            className="agent__label"
                            textAnchor={labelOnLeft ? "end" : "start"}
                            x={labelX}
                            y={(nameLines.length > 1 ? -8 : -2) + labelOffsetY}
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
