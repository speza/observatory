import { needsAttention, stateFor, type AgentFixture, type GoalFixture, type Moment } from "./data";
import { agentOrbit, sceneLayouts, type ViewportState, type WorldSize } from "./layout";

export type LabelPolicy = "all" | "adaptive" | "attention";
export type AtlasTheme = "light" | "dark";

interface PaletteSet {
  readonly bodies: readonly string[];
  readonly marks: readonly string[];
}

const mineral: Readonly<Record<AtlasTheme, PaletteSet>> = {
  light: {
    bodies: ["#c77962", "#d7aa5e", "#78a097", "#bd7b89", "#7895ac", "#9380a2"],
    marks: ["#8f3f2d", "#946516", "#356b62", "#8b4253", "#365f7b", "#604b72"],
  },
  dark: {
    bodies: ["#7e3f31", "#7a5924", "#355f58", "#754352", "#39576d", "#594663"],
    marks: ["#dc8c72", "#e0b865", "#82b7ab", "#d68b99", "#86aac4", "#ad94bb"],
  },
};

const titleLines = (title: string): readonly string[] => {
  const lines: string[] = [];
  for (const word of title.split(" ")) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > 22) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
};

interface SvgSceneProps {
  readonly agents: readonly AgentFixture[];
  readonly goals: readonly GoalFixture[];
  readonly moment: Moment;
  readonly reducedMotion: boolean;
  readonly selectedId: string;
  readonly viewport: ViewportState;
  readonly focusGoalId?: string;
  readonly labelPolicy?: LabelPolicy;
  readonly theme: AtlasTheme;
  readonly catchUp: boolean;
  readonly onSelect: (id: string) => void;
  readonly worldSize: WorldSize;
}

export const SvgScene = ({
  agents,
  goals,
  moment,
  reducedMotion,
  selectedId,
  viewport,
  focusGoalId,
  labelPolicy = "all",
  theme,
  catchUp,
  onSelect,
  worldSize,
}: SvgSceneProps): React.JSX.Element => {
  const layouts = sceneLayouts(goals, agents);
  const colours = mineral[theme];
  const paper = theme === "light" ? "#ddd4bf" : "#171918";
  const ink = theme === "light" ? "#2b2721" : "#e5ddcd";
  const contour = theme === "light" ? "#f1e7d2" : "#c7bdab";

  return (
    <svg
      className={`universe universe--svg universe--atlas ${catchUp ? "universe--catchup" : ""}`}
      viewBox={`0 0 ${worldSize.width} ${worldSize.height}`}
      role="group"
      aria-label={`${goals.length} Observatory Goals with ${agents.length} assigned Agents`}
    >
      <defs>
        {layouts.map((layout) => (
          <clipPath id={`planet-clip-${layout.goal.id}`} key={layout.goal.id}>
            <circle r={layout.radius} />
          </clipPath>
        ))}
      </defs>

      <rect width={worldSize.width} height={worldSize.height} fill={paper} />
      {Array.from({ length: 62 }, (_, index) => (
        <circle
          className="map-dot"
          cx={(index * 197 + 41) % Math.max(1, worldSize.width - 20)}
          cy={(index * 313 + 83) % Math.max(1, worldSize.height - 30)}
          fill={ink}
          key={index}
          opacity={0.1 + (index % 4) * 0.035}
          r={index % 11 === 0 ? 1.05 : 0.45}
        />
      ))}

      <g
        transform={`translate(${worldSize.width / 2 + viewport.panX} ${worldSize.height / 2 + viewport.panY}) scale(${viewport.zoom})`}
      >
        {layouts.map((layout, layoutIndex) => {
          const { goal, radius } = layout;
          const goalColour = colours.bodies[layoutIndex % colours.bodies.length];
          const goalMark = colours.marks[layoutIndex % colours.marks.length];
          const selected = selectedId === `goal:${goal.id}`;
          const focused = focusGoalId === goal.id;
          const muted = focusGoalId !== undefined && focusGoalId !== goal.id;
          const caption = titleLines(goal.title);
          const captionAbove = false;
          const captionLineHeight = 14;
          const captionY = captionAbove
            ? -radius - 25 - (caption.length - 1) * captionLineHeight
            : radius + 29;
          const changedAgents = layout.agents.filter(
            (agent) => agent.recentChange && agent.recentChange !== "none",
          );
          return (
            <g
              className={`goal-system goal-system--${goal.lifecycle ?? "active"} ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""} ${muted ? "is-muted" : ""} ${catchUp && changedAgents.length > 0 ? "has-changes" : ""}`}
              key={goal.id}
              transform={`translate(${layout.x} ${layout.y})`}
            >
              <g className="orbit-lines" aria-hidden="true">
                {[radius + 45, radius + 72].map((orbit) => (
                  <ellipse fill="none" key={orbit} rx={orbit} ry={orbit * 0.58} />
                ))}
              </g>

              <g
                aria-label={`${goal.title}, ${layout.agents.length} agents, ${goal.priority}`}
                className="goal-world"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(`goal:${goal.id}`);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(`goal:${goal.id}`);
                }}
                role="button"
                tabIndex={0}
              >
                <circle className="goal-world__body" fill={goalColour} r={radius} />
                <g clipPath={`url(#planet-clip-${goal.id})`} opacity="0.5">
                  <path
                    d={`M${-radius} -8 Q${-radius * 0.42} ${-radius * 0.5} 4 ${-radius * 0.2} T${radius} ${-radius * 0.46} L${radius} 5 Q${radius * 0.25} ${radius * 0.2} ${-radius} ${radius * 0.1}Z`}
                    fill={goalMark}
                    opacity="0.13"
                  />
                  <path
                    d={`M${-radius} ${radius * 0.42} Q0 ${radius * 0.1} ${radius} ${radius * 0.35} V${radius} H${-radius}Z`}
                    fill={paper}
                    opacity="0.16"
                  />
                  {[0.22, 0.48, 0.72].map((scale) => (
                    <circle
                      fill="none"
                      key={scale}
                      r={radius * scale}
                      stroke={contour}
                      strokeDasharray="2 4"
                      strokeWidth="0.7"
                    />
                  ))}
                </g>
                <ellipse
                  className="goal-core__quiet-field"
                  clipPath={`url(#planet-clip-${goal.id})`}
                  cx="0"
                  cy="10"
                  fill={goalColour}
                  rx={radius * 0.94}
                  ry="29"
                />
                <circle
                  className="goal-world__outline"
                  fill="none"
                  r={radius + 2}
                  stroke={goalMark}
                  strokeWidth={selected ? 3 : 1.5}
                  opacity={selected ? 1 : 0.78}
                />
                <g className="goal-core">
                  <text className="goal-core__kind" y="-14">
                    GOAL / {goal.priority}
                  </text>
                  <text className="goal-core__count" y="12">
                    {String(layout.agents.length).padStart(2, "0")}
                  </text>
                  <text className="goal-core__label" y="27">
                    AGENTS
                  </text>
                </g>
                <line
                  className="goal-caption__leader"
                  stroke={goalMark}
                  x1="0"
                  x2="0"
                  y1={captionAbove ? -radius - 3 : radius + 3}
                  y2={captionAbove ? -radius - 14 : radius + 15}
                />
                <text className="goal-caption">
                  {caption.map((line, index) => (
                    <tspan key={line} x="0" y={captionY + index * captionLineHeight}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {catchUp && changedAgents.length > 0 ? (
                  <g className="goal-change-mark" transform={`translate(${radius - 3} ${-radius + 3})`}>
                    <circle r="12" />
                    <text y="3">{changedAgents.length}</text>
                  </g>
                ) : null}
              </g>

              {layout.agents.map((agent, index) => {
                const orbit = agentOrbit(layout, agent, index);
                const state = stateFor(agent, moment);
                const attention = needsAttention(agent, moment);
                const captionCentre = captionAbove ? Math.PI * 1.5 : Math.PI * 0.5;
                const captionClearance = 0.7;
                const availableArc = Math.PI * 2 - captionClearance * 2;
                const phase =
                  captionCentre +
                  captionClearance +
                  ((index + 0.5) / layout.agents.length) * availableArc;
                const staticX = Math.cos(phase) * orbit.radiusX;
                const staticY = Math.sin(phase) * orbit.radiusY;
                const labelOnLeft = staticX < 0;
                const agentColour =
                  state === "unknown"
                    ? "var(--uncertain)"
                    : attention
                      ? "var(--attention)"
                      : goalMark;
                const showLabel =
                  labelPolicy === "all" ||
                  selectedId === agent.id ||
                  (attention && viewport.zoom >= 1.05) ||
                  (labelPolicy === "adaptive" &&
                    (focusGoalId === goal.id || viewport.zoom >= 1.75));
                const changed = catchUp && agent.recentChange && agent.recentChange !== "none";
                return (
                  <g
                  className={`svg-agent svg-agent--${state} ${attention ? "needs-attention" : ""} ${changed ? `has-change has-change--${agent.recentChange}` : ""} ${selectedId === agent.id ? "is-selected" : ""} ${showLabel ? "" : "label-hidden"}`}
                    key={agent.id}
                    transform={`translate(${staticX} ${staticY})`}
                  >
                    <g className={reducedMotion ? undefined : "svg-agent__presence"}>
                      <g
                        aria-label={`${agent.name}, ${state}`}
                        className="svg-agent__target"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(agent.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          onSelect(agent.id);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {attention ? (
                          <circle
                            className="attention-wave"
                            fill="none"
                            r="18"
                            stroke="var(--attention)"
                            strokeWidth="1"
                          />
                        ) : null}
                        <circle
                          className="svg-agent__halo"
                          fill={agentColour}
                          opacity="0.1"
                          r="11"
                        />
                        <circle
                          className="svg-agent__body"
                          fill={paper}
                          r="6.5"
                          stroke={agentColour}
                          strokeWidth="1.8"
                        />
                        <circle cx="1" cy="-1" fill={agentColour} r="2.2" />
                        {changed ? <path className="agent-change-tick" d="M-10 -11 L-4 -17 L2 -11" /> : null}
                      </g>
                      <g
                        className="svg-agent__label"
                        textAnchor={labelOnLeft ? "end" : "start"}
                        transform={`translate(${labelOnLeft ? -15 : 15} -3)`}
                      >
                        <text>{agent.name}</text>
                        <text className="svg-agent__state" y="12">
                          {state.toUpperCase()}
                        </text>
                      </g>
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>

    </svg>
  );
};
