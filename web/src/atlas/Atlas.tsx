import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArchiveX, GitCompareArrows, GitPullRequest, Terminal } from "lucide-react";
import type {
  AgentView,
  DiscoveredExecutionView,
  MapAgentView,
  UniverseMapProjection,
} from "../../../src/projection/types.ts";
import {
  selectionIntent,
  type SelectionModel,
  type AgentSelectionHandler,
  type AgentSetSelectionHandler,
  type Selection,
} from "../app/selection.ts";
import { AgentLogo } from "../shared/AgentLogo.tsx";
import { presentExecution } from "../shared/executionPresentation.ts";
import {
  AGENT_CARD_HEIGHT,
  AGENT_CARD_WIDTH,
  ATLAS_GRID_STEP,
  agentsInMarquee,
  DISCOVERED_CARD_HEIGHT,
  DISCOVERED_CARD_WIDTH,
  discoveredExecutionPoint,
  discoveredDockPlacement,
  hash,
  isMarqueeDrag,
  marqueeBounds,
  stateLabel,
  truncateAtlasLine,
  workspaceAgentPoints,
  workspaceDimensions,
  WORKSPACE_HEADER,
  workspaceLessAgentPoints,
  workspaceLessPosition,
  workspacePosition,
  type AtlasCameraCommand,
  type AtlasPoint,
} from "./atlasGeometry.ts";
import { presentAgentCard } from "./agentCardPresentation.ts";
import { useAtlasCamera } from "./useAtlasCamera.ts";

export type { AtlasCameraCommand } from "./atlasGeometry.ts";
export { snapToAtlasGrid } from "./atlasGeometry.ts";

interface AgentStyle extends CSSProperties {
  readonly "--goal-color": string;
  readonly "--agent-phase": string;
}

const palettes = {
  light: ["#1e5b50", "#756521", "#24656a", "#8c4d36", "#405f78", "#66516f"],
  dark: ["#81b7a9", "#c6b974", "#78b6bd", "#d19070", "#8aaac1", "#af98b5"],
} as const;

interface AtlasProps {
  readonly additionalControls?: React.ReactNode;
  readonly projection: UniverseMapProjection;
  readonly selection?: SelectionModel;
  readonly reservedLeft: number;
  readonly reservedRight: number;
  readonly theme?: "light" | "dark";
  readonly motion?: boolean;
  readonly cameraCommand?: AtlasCameraCommand;
  readonly onClearSelection?: () => void;
  readonly onFocusSelection?: (selection: Selection) => void;
  readonly onSelectAgent?: AgentSelectionHandler;
  readonly onSelectAgents?: AgentSetSelectionHandler;
  readonly onMoveGoal?: (
    goalId: string,
    position: { readonly x: number; readonly y: number },
  ) => void | Promise<void>;
  readonly onCloseAndArchive?: (agent: AgentView) => void;
  readonly onOpenTerminal?: (agent: AgentView) => void;
  readonly onOpenDiscoveredTerminal?: (execution: DiscoveredExecutionView) => void;
  readonly onReviewChanges?: (agent: AgentView) => void;
  readonly pullRequestUrls?: ReadonlyMap<string, string>;
  readonly onSelect: (selection: Selection) => void;
}

const activate = (event: ReactKeyboardEvent<SVGGElement>, action: () => void): void => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
};

export const Atlas = ({
  projection,
  selection,
  reservedLeft,
  reservedRight,
  theme = "light",
  motion = true,
  cameraCommand,
  additionalControls,
  onClearSelection,
  onFocusSelection,
  onCloseAndArchive,
  onOpenTerminal,
  onOpenDiscoveredTerminal,
  onReviewChanges,
  pullRequestUrls,
  onSelect,
  onSelectAgent,
  onSelectAgents,
}: AtlasProps): React.JSX.Element => {
  const subject = selection?.subject;
  const selectedAgentIds = selection?.agentIds ?? new Set<string>();
  const [marquee, setMarquee] = useState<
    { readonly start: AtlasPoint; readonly current: AtlasPoint } | undefined
  >();
  const marqueeRef = useRef<{ start: AtlasPoint; current: AtlasPoint } | undefined>(undefined);
  const marqueeDrag = useRef(false);
  const suppressClearClick = useRef(false);
  const updateMarquee = (value: { start: AtlasPoint; current: AtlasPoint } | undefined): void => {
    marqueeRef.current = value;
    setMarquee(value);
  };
  const [discoveryDockOpen, setDiscoveryDockOpen] = useState(
    () => subject?.type === "discovered-execution",
  );
  useEffect(() => {
    if (subject?.type === "discovered-execution") setDiscoveryDockOpen(true);
  }, [subject?.id, subject?.type]);
  const camera = useAtlasCamera({
    cameraCommand,
    projection,
    reservedLeft,
    reservedRight,
    selection: subject,
    discoveryDockOpen,
  });
  const goalFocused =
    camera.focusedSelection?.type === "goal"
      ? camera.focusedSelection.id
      : subject?.type === "goal"
        ? subject.id
        : undefined;
  const discoveryDock = discoveredDockPlacement(
    projection,
    camera.layout.goalSpacingScale,
    discoveryDockOpen,
  );
  const workspaceLessPoints = workspaceLessAgentPoints(projection, camera.layout.goalSpacingScale);
  const workspaceLessCentre = workspaceLessPosition(projection, camera.layout.goalSpacingScale);
  const gridStep = ATLAS_GRID_STEP;
  const gridOrigin = camera.screenPoint({ x: 0, y: 0 });
  /** Every rendered Agent card, in projection order, for marquee hit testing. */
  const agentCards = [
    ...projection.workspaces.flatMap((workspace) =>
      workspaceAgentPoints(
        workspace,
        workspacePosition(workspace, camera.layout.goalSpacingScale),
      ).flatMap((point, index) => {
        const agent = workspace.agents[index];
        return agent ? [{ id: agent.id, x: point.x, y: point.y }] : [];
      }),
    ),
    ...projection.workspaceLess.flatMap((agent, index) => {
      const point = workspaceLessPoints[index] ?? workspaceLessCentre;
      return [{ id: agent.id, x: point.x, y: point.y }];
    }),
  ];
  const orderedAgentIds = agentCards.map((card) => card.id);
  const toWorld = (event: React.PointerEvent<SVGSVGElement>): AtlasPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - camera.camera.panX) / camera.camera.zoom,
      y: (event.clientY - bounds.top - camera.camera.panY) / camera.camera.zoom,
    };
  };
  const beginMarquee = (event: React.PointerEvent<SVGSVGElement>): boolean => {
    if (!event.shiftKey || event.button !== 0) return false;
    const target = event.target;
    if (target instanceof Element && target.closest('[role="button"]')) return false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toWorld(event);
    marqueeDrag.current = true;
    updateMarquee({ start: point, current: point });
    return true;
  };
  const continueMarquee = (event: React.PointerEvent<SVGSVGElement>): boolean => {
    const drag = marqueeRef.current;
    if (!marqueeDrag.current || !drag) return false;
    updateMarquee({ start: drag.start, current: toWorld(event) });
    return true;
  };
  const endMarquee = (): void => {
    if (!marqueeDrag.current) return;
    marqueeDrag.current = false;
    const finished = marqueeRef.current;
    updateMarquee(undefined);
    if (!finished) return;
    const bounds = marqueeBounds(finished.start, finished.current);
    // A stray Shift click is not a marquee, so the background keeps its own
    // click-to-clear meaning; only a real drag suppresses the release click.
    if (!isMarqueeDrag(bounds)) return;
    suppressClearClick.current = true;
    if (onSelectAgents) onSelectAgents(agentsInMarquee(bounds, agentCards));
  };
  const renderAgent = (agent: MapAgentView, point: { x: number; y: number }) => {
    const selected = selectedAgentIds.has(agent.id);
    const agentSubject = subject?.type === "agent" && subject.id === agent.id;
    const dimmed = goalFocused !== undefined && agent.primaryGoalId !== goalFocused;
    const attention = agent.attention?.requiresHumanInput === true;
    const canOpenTerminal = agent.executionPresence === "live" && onOpenTerminal !== undefined;
    const canCloseAndArchive =
      agent.executionPresence === "live" && onCloseAndArchive !== undefined;
    const canReview = agent.attention?.action === "review" && onReviewChanges !== undefined;
    const pullRequestUrl = pullRequestUrls?.get(agent.id);
    const reviewActionX = canOpenTerminal ? 48 : 74;
    const pullRequestActionX = 74 - (canOpenTerminal ? 26 : 0) - (canReview ? 26 : 0);
    const closeActionX = pullRequestActionX - (pullRequestUrl === undefined ? 0 : 26);
    const uncertain = ["runtime-unknown", "conversation-unavailable", "conflict"].includes(
      agent.lifecycleState,
    );
    const state = stateLabel(agent);
    const card = presentAgentCard(agent);
    const goalColor =
      palettes[theme][
        hash(agent.primaryGoalId ?? agent.systemId ?? "unassigned") % palettes[theme].length
      ] ?? palettes[theme][0];
    const style: AgentStyle = {
      "--goal-color": goalColor,
      "--agent-phase": `${-(hash(agent.id) % 4200)}ms`,
    };
    const focus = (): void => (onFocusSelection ?? onSelect)({ type: "agent", id: agent.id });
    return (
      <g
        className={`agent agent--${state} ${attention ? "agent--attention" : ""} ${uncertain ? "agent--uncertain" : ""} ${selected ? "is-selected" : ""} ${agentSubject ? "agent--subject" : ""} ${dimmed ? "goal--spotlight-dimmed" : "goal--spotlight-focus"}`}
        data-agent-id={agent.id}
        data-parent-goal-id={agent.primaryGoalId}
        data-screen-x={point.x.toFixed(2)}
        data-screen-y={point.y.toFixed(2)}
        key={agent.id}
        style={style}
        transform={`translate(${point.x} ${point.y})`}
      >
        <g
          aria-label={`${card.titleLines.join(" ")}${card.secondaryContext ? `, ${card.secondaryContext}` : ""}, ${state}, ${agent.goalTitle ? `goal ${agent.goalTitle}` : agent.systemTitle ? `system ${agent.systemTitle}` : "unassigned"}`}
          className="agent__card-target"
          role="button"
          tabIndex={0}
          onClick={(event) => {
            const intent = selectionIntent(event);
            if ((intent.additive || intent.range) && onSelectAgent) {
              event.preventDefault();
              onSelectAgent(agent.id, intent, orderedAgentIds);
              return;
            }
            onSelect({ type: "agent", id: agent.id });
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onSelect({ type: "agent", id: agent.id });
            camera.focusPoint(point, { type: "agent", id: agent.id });
          }}
          onFocus={focus}
          onKeyDown={(event) => activate(event, () => onSelect({ type: "agent", id: agent.id }))}
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
            rx="5"
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
            {card.titleLines.map((line, index) => (
              <tspan dy={index === 0 ? 0 : 15} key={`${line}-${index}`} x="-96">
                {line}
              </tspan>
            ))}
          </text>
          {card.detail ? (
            <text className="agent__activity" x="-96" y={card.titleLines.length > 1 ? 25 : 11}>
              {card.detail}
            </text>
          ) : null}
          <rect className="agent__goal-chip" height="16" rx="3" width="192" x="-96" y="28" />
          <text className="agent__context" x="-90" y="40">
            {agent.goalTitle
              ? `GOAL · ${truncateAtlasLine(agent.goalTitle, 25)}`
              : agent.systemTitle
                ? `SYSTEM · ${truncateAtlasLine(agent.systemTitle, 25)}`
                : "GOAL · UNASSIGNED"}
          </text>
          <rect
            className="agent__selection"
            height={AGENT_CARD_HEIGHT + 8}
            rx="7"
            width={AGENT_CARD_WIDTH + 8}
            x={-AGENT_CARD_WIDTH / 2 - 4}
            y={-AGENT_CARD_HEIGHT / 2 - 4}
          />
        </g>
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
              onFocus={focus}
              onKeyDown={(event) => {
                event.stopPropagation();
                activate(event, () => onReviewChanges?.(agent));
              }}
              onPointerDown={(event) => event.stopPropagation()}
              role="button"
              tabIndex={0}
            >
              <title>Review changes</title>
              <rect height="20" rx="3" width="22" x={reviewActionX} y="27" />
              <GitCompareArrows
                aria-hidden="true"
                height="14"
                strokeWidth="1.8"
                width="14"
                x={reviewActionX + 4}
                y="30"
              />
            </g>
          ) : null}
          {pullRequestUrl ? (
            <a
              aria-label={`Open ${agent.displayName} pull request on GitHub`}
              className="agent__quick-action"
              href={pullRequestUrl}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={focus}
              onPointerDown={(event) => event.stopPropagation()}
              target="_blank"
              rel="noreferrer"
            >
              <title>Open pull request on GitHub</title>
              <rect height="20" rx="3" width="22" x={pullRequestActionX} y="27" />
              <GitPullRequest
                aria-hidden="true"
                height="14"
                strokeWidth="1.8"
                width="14"
                x={pullRequestActionX + 4}
                y="30"
              />
            </a>
          ) : null}
          {canCloseAndArchive ? (
            <g
              aria-label={`Close and archive ${agent.displayName}`}
              className="agent__quick-action agent__quick-action--destructive"
              onClick={(event) => {
                event.stopPropagation();
                onCloseAndArchive?.(agent);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={focus}
              onKeyDown={(event) => {
                event.stopPropagation();
                activate(event, () => onCloseAndArchive?.(agent));
              }}
              onPointerDown={(event) => event.stopPropagation()}
              role="button"
              tabIndex={0}
            >
              <title>Close &amp; archive</title>
              <rect height="20" rx="3" width="22" x={closeActionX} y="27" />
              <ArchiveX
                aria-hidden="true"
                height="14"
                strokeWidth="1.8"
                width="14"
                x={closeActionX + 4}
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
              onFocus={focus}
              onKeyDown={(event) => {
                event.stopPropagation();
                activate(event, () => onOpenTerminal?.(agent));
              }}
              onPointerDown={(event) => event.stopPropagation()}
              role="button"
              tabIndex={0}
              transform="translate(74 27)"
            >
              <title>Open terminal</title>
              <rect height="20" rx="3" width="22" />
              <Terminal aria-hidden="true" height="14" strokeWidth="1.8" width="14" x="4" y="3" />
            </g>
          ) : null}
        </g>
      </g>
    );
  };
  return (
    <div
      className={`atlas ${motion ? "atlas--motion" : "atlas--still"} ${camera.focusedSelection ? "atlas--spotlight" : ""} ${selectedAgentIds.size > 1 ? "atlas--batch" : ""}`}
      ref={camera.containerRef}
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
          <i className="atlas__status-swatch atlas__status-swatch--review">!</i>Needs review
        </span>
      </div>
      <svg
        aria-label={`${projection.workspaces.length} workspaces and ${projection.counts.agents} agents`}
        className={`${camera.isPanning ? "is-panning" : ""} ${marquee ? "is-marquee" : ""}`.trim()}
        onPointerDown={(event) => {
          if (!beginMarquee(event)) camera.beginPan(event);
        }}
        onPointerMove={(event) => {
          if (!continueMarquee(event)) camera.continuePan(event);
        }}
        onPointerUp={() => {
          endMarquee();
          camera.endPan();
        }}
        onPointerCancel={() => {
          endMarquee();
          camera.endPan();
        }}
        onWheel={camera.zoom}
        onDoubleClick={camera.reset}
        role="group"
        tabIndex={0}
        viewBox={`0 0 ${camera.size.width} ${camera.size.height}`}
      >
        <title>Observatory workspace and agent atlas</title>
        <defs>
          <pattern
            data-logical-step="24"
            height={gridStep}
            id="atlas-coordinate-grid"
            patternUnits="userSpaceOnUse"
            width={gridStep}
            x={gridOrigin.x}
            y={gridOrigin.y}
          >
            <path className="atlas__grid-major" d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} />
          </pattern>
        </defs>
        <rect
          className="atlas__hit-area"
          width={camera.size.width}
          height={camera.size.height}
          onClick={() => {
            if (suppressClearClick.current) {
              suppressClearClick.current = false;
              return;
            }
            onClearSelection?.();
          }}
        />
        <g className="atlas__world" transform={camera.worldTransform}>
          <rect
            aria-hidden="true"
            className="atlas__coordinate-grid"
            data-grid-origin-x={gridOrigin.x}
            data-grid-origin-y={gridOrigin.y}
            fill="url(#atlas-coordinate-grid)"
            height="200000"
            width="200000"
            x="-100000"
            y="-100000"
          />
          {projection.workspaces.map((workspace, workspaceIndex) => {
            const centre = workspacePosition(workspace, camera.layout.goalSpacingScale);
            const size = workspaceDimensions(workspace);
            const points = workspaceAgentPoints(workspace, centre);
            return (
              <g
                className="workspace-island"
                data-screen-x={centre.x.toFixed(2)}
                data-screen-y={centre.y.toFixed(2)}
                data-workspace-height={size.height}
                data-workspace-index={workspaceIndex}
                data-workspace-width={size.width}
                key={`${workspace.label}-${workspaceIndex}`}
              >
                <rect
                  className="workspace-island__surface"
                  x={centre.x - size.width / 2}
                  y={centre.y - size.height / 2}
                  width={size.width}
                  height={size.height}
                  rx="14"
                />
                <text
                  className="workspace-island__label"
                  x={centre.x - size.width / 2 + 18}
                  y={centre.y - size.height / 2 + 26}
                >
                  WORKSPACE · {workspace.label} · {workspace.agents.length}
                </text>
                {workspace.agents.map((agent, index) =>
                  renderAgent(agent, points[index] ?? centre),
                )}
              </g>
            );
          })}
          {projection.workspaceLess.length ? (
            <g aria-label="Workspace-less and dormant agents" className="workspace-less">
              <rect
                className="workspace-less__frame"
                height={workspaceDimensions({ agents: projection.workspaceLess }).height}
                rx="14"
                width={workspaceDimensions({ agents: projection.workspaceLess }).width}
                x={
                  workspaceLessCentre.x -
                  workspaceDimensions({ agents: projection.workspaceLess }).width / 2
                }
                y={
                  workspaceLessCentre.y -
                  workspaceDimensions({ agents: projection.workspaceLess }).height / 2
                }
              />
              <text
                className="workspace-island__label"
                x={
                  workspaceLessCentre.x -
                  workspaceDimensions({ agents: projection.workspaceLess }).width / 2 +
                  18
                }
                y={
                  workspaceLessCentre.y -
                  workspaceDimensions({ agents: projection.workspaceLess }).height / 2 +
                  26
                }
              >
                WORKSPACE-LESS / DORMANT
              </text>
              {projection.workspaceLess.map((agent, index) =>
                renderAgent(agent, workspaceLessPoints[index] ?? workspaceLessCentre),
              )}
            </g>
          ) : null}
          {(projection.discoveredExecutions ?? []).length > 0 ? (
            <g aria-label="Discovered in Herdr executions" className="discovered-executions">
              {discoveryDock ? (
                <g className="discovered-dock">
                  <rect
                    aria-hidden="true"
                    className="discovered-dock__frame"
                    height={discoveryDock.bounds.height}
                    rx="10"
                    width={discoveryDock.bounds.width}
                    x={discoveryDock.bounds.left}
                    y={discoveryDock.bounds.top}
                  />
                  <g
                    aria-expanded={discoveryDockOpen}
                    aria-label={`${discoveryDockOpen ? "Collapse" : "Expand"} discovered in Herdr`}
                    className="discovered-dock__toggle"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDiscoveryDockOpen((open) => !open);
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      activate(event, () => setDiscoveryDockOpen((open) => !open));
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    role="button"
                    tabIndex={0}
                  >
                    <rect
                      aria-hidden="true"
                      className="discovered-dock__toggle-hit"
                      height={WORKSPACE_HEADER}
                      width={discoveryDock.bounds.width}
                      x={discoveryDock.bounds.left}
                      y={discoveryDock.bounds.top}
                    />
                    <text
                      className="discovered-dock__heading"
                      x={discoveryDock.bounds.left + 18}
                      y={discoveryDock.bounds.top + 25}
                    >
                      {discoveryDockOpen ? "−" : "+"} DISCOVERED IN HERDR ·{" "}
                      {projection.discoveredExecutions?.length}
                    </text>
                  </g>
                </g>
              ) : null}
              {discoveryDockOpen
                ? projection.discoveredExecutions?.map((execution) => {
                    const point = discoveredExecutionPoint(execution);
                    const centre = {
                      x: point.x + (discoveryDock?.translation.x ?? 0),
                      y: point.y + (discoveryDock?.translation.y ?? 0),
                    };
                    const state =
                      execution.presence === "live" ? execution.runtimeState : "unknown";
                    const { primaryLabel: executionLabel, secondaryContext: executionContext } =
                      presentExecution(execution);
                    const selected =
                      subject?.type === "discovered-execution" && subject.id === execution.handle;
                    const focus = (): void =>
                      (onFocusSelection ?? onSelect)({
                        type: "discovered-execution",
                        id: execution.handle,
                      });
                    return (
                      <g
                        className={`discovered-execution discovered-execution--${state} ${selected ? "is-selected" : ""}`}
                        data-discovery-handle={execution.handle}
                        key={execution.handle}
                        transform={`translate(${centre.x} ${centre.y})`}
                      >
                        <g
                          aria-label={`${executionLabel}${executionContext ? `, ${executionContext}` : ""}, ${state}, discovered in ${execution.hostKind}`}
                          className="discovered-execution__card-target"
                          onClick={() =>
                            onSelect({ type: "discovered-execution", id: execution.handle })
                          }
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            camera.focusPoint(centre, {
                              type: "discovered-execution",
                              id: execution.handle,
                            });
                          }}
                          onFocus={focus}
                          onKeyDown={(event) =>
                            activate(event, () =>
                              onSelect({ type: "discovered-execution", id: execution.handle }),
                            )
                          }
                          role="button"
                          tabIndex={0}
                        >
                          <rect
                            className="discovered-execution__card"
                            height={DISCOVERED_CARD_HEIGHT}
                            rx="5"
                            width={DISCOVERED_CARD_WIDTH}
                            x={-DISCOVERED_CARD_WIDTH / 2}
                            y={-DISCOVERED_CARD_HEIGHT / 2}
                          />
                          <rect
                            className="discovered-execution__selection"
                            height={DISCOVERED_CARD_HEIGHT + 8}
                            rx="7"
                            width={DISCOVERED_CARD_WIDTH + 8}
                            x={-DISCOVERED_CARD_WIDTH / 2 - 4}
                            y={-DISCOVERED_CARD_HEIGHT / 2 - 4}
                          />
                          <line
                            className="discovered-execution__rule"
                            x1={-DISCOVERED_CARD_WIDTH / 2 + 14}
                            x2={DISCOVERED_CARD_WIDTH / 2 - 14}
                            y1="-38"
                            y2="-38"
                          />
                          <g
                            className="discovered-execution__provider"
                            transform="translate(-124 -54)"
                          >
                            <AgentLogo map provider={execution.provider} />
                          </g>
                          <text className="discovered-execution__identity" x="-108" y="-51">
                            DISCOVERED / {execution.hostKind.toUpperCase()}
                          </text>
                          <g className="discovered-execution__state" transform="translate(122 -54)">
                            <circle r="3" />
                            <text x="-8" y="3">
                              {state.toUpperCase()}
                            </text>
                          </g>
                          <text className="discovered-execution__name" x="-124" y="-15">
                            {truncateAtlasLine(executionLabel, 29)}
                          </text>
                          <text className="discovered-execution__context" x="-124" y="17">
                            {truncateAtlasLine(
                              executionContext ||
                                execution.worktree ||
                                execution.repository ||
                                "Workspace unknown",
                              43,
                            )}
                          </text>
                          <text className="discovered-execution__conversation" x="-124" y="38">
                            {execution.conversation
                              ? truncateAtlasLine(`Conversation · ${execution.conversation.id}`, 46)
                              : execution.conversationIdentified
                                ? "Conversation · identified"
                                : "Conversation not identified"}
                          </text>
                        </g>
                        {execution.presence === "live" && onOpenDiscoveredTerminal ? (
                          <g
                            aria-label={`Open ${executionLabel} terminal`}
                            className="discovered-execution__quick-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenDiscoveredTerminal(execution);
                            }}
                            onFocus={focus}
                            onKeyDown={(event) =>
                              activate(event, () => onOpenDiscoveredTerminal(execution))
                            }
                            role="button"
                            tabIndex={0}
                            transform={`translate(${DISCOVERED_CARD_WIDTH / 2 - 36} ${DISCOVERED_CARD_HEIGHT / 2 - 30})`}
                          >
                            <title>Open terminal</title>
                            <rect height="20" rx="3" width="22" />
                            <Terminal height="14" strokeWidth="1.8" width="14" x="4" y="3" />
                          </g>
                        ) : null}
                      </g>
                    );
                  })
                : null}
            </g>
          ) : null}
          {marquee ? (
            <rect
              aria-hidden="true"
              className="atlas__marquee"
              height={Math.abs(marquee.current.y - marquee.start.y)}
              rx="6"
              width={Math.abs(marquee.current.x - marquee.start.x)}
              x={Math.min(marquee.start.x, marquee.current.x)}
              y={Math.min(marquee.start.y, marquee.current.y)}
            />
          ) : null}
        </g>
      </svg>
      <div className="zoom-control" aria-label="Map zoom controls">
        <button onClick={camera.zoomOut}>−</button>
        <button onClick={camera.resetCamera}>{Math.round(camera.camera.zoom * 100)}%</button>
        <button onClick={camera.zoomIn}>+</button>
        <button onClick={camera.reset}>Fit</button>
        {additionalControls}
      </div>
    </div>
  );
};
