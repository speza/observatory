import {
  BoxRenderable,
  createCliRenderer,
  FrameBufferRenderable,
  RGBA,
  SelectRenderable,
  SelectRenderableEvents,
  TextAttributes,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  type PasteEvent,
  type OptimizedBuffer,
  type SelectOption,
} from "@opentui/core";
import { Effect, Stream } from "effect";
import { formatAge } from "../attention/attention.ts";
import {
  displayHostKind,
  hasAgentCapability,
  type HostLaunchOption,
  type HostedTerminalSession,
  type HostTerminalEvent,
  type HostTerminalInput,
  type AgentAccess,
  type LinkedExecution,
  type SessionHost,
  type TerminalDimensions,
} from "../hosts/types.ts";
import type { HostError } from "../hosts/errors.ts";
import { layoutFor, type Rect } from "./layout.ts";
import { surfaceLayoutFor, type SurfaceLayout } from "./surface-layout.ts";
import type {
  CommandCentreProjection,
  CodeContextMapProjection,
  CodeContextMapView,
  CodeContextProjection,
  CodeContextView,
  GoalView,
  InspectorProjection,
  MapGoalView,
  MapAgentView,
  RelatedAgentsProjection,
  AgentView,
  UniverseMapProjection,
} from "../projection/types.ts";
import type { CommandResult, Universe, UniverseCommand } from "../universe/universe.ts";
import { PRIORITIES, priorityRank, type Clock, type MapPosition } from "../universe/types.ts";
import {
  fitViewportToPoints,
  panViewport,
  screenPointForWorld,
  zoomViewportAt,
} from "../spatial/viewport.ts";
import { agentSatellitePositions, unassignedAgentPositions } from "../spatial/positions.ts";
import { placeFloatingInspector } from "./inspector-placement.ts";
import { selectionChangeForContextAction, type ContextMenuScope } from "./context-menu.ts";
import { filterAssignableAgents } from "./assignment.ts";
import { editText, insertTextAtCursor, typedCharacter } from "./input.ts";
import { modalFrameFor } from "./modal.ts";
import { mapSelectionCandidates, nextNavigationSelection } from "./navigation.ts";
import { ensureTerminalDimensions, TerminalScreen, TERMINAL_COLORS } from "./terminal-screen.ts";
import {
  nextSemanticZoom,
  perspectiveNodeScale,
  isRecentlyDone,
  semanticZoomLevel,
  agentLabelBudget,
  agentMarker,
  goalLabelBudget,
  type SemanticZoomLevel,
} from "./semantic-zoom.ts";
import type { StartAgentCoordinator, StartAgentIntent } from "../session-launch/types.ts";
import type { WorkspaceBrowser, WorkspaceChoice, WorkspaceProvider } from "../workspaces/types.ts";

const color = (hex: string): RGBA => RGBA.fromHex(hex);

const COLORS = {
  background: color("#08131f"),
  panel: color("#0d1d2b"),
  panelRaised: color("#10283a"),
  border: color("#28536a"),
  borderStrong: color("#65c7df"),
  text: color("#dcecf2"),
  muted: color("#8aa6b4"),
  faint: color("#527183"),
  connector: color("#79a6b8"),
  white: color("#f3fbff"),
  cyan: color("#67e8f9"),
  green: color("#86efac"),
  yellow: color("#fde68a"),
  orange: color("#fdba74"),
  red: color("#fb7185"),
  dimRed: color("#8f4350"),
  completed: color("#718697"),
  selected: color("#e7fbff"),
} as const;

const TRANSPARENT = RGBA.fromInts(0, 0, 0, 0);

const MAP_FIT_PADDING_X = 26;
const MAP_FIT_PADDING_Y = 8;
const MAP_LABEL_ZOOM_THRESHOLD = 0.85;
const DENSE_FOCUS_AGENT_THRESHOLD = 8;
const DENSE_FOCUS_COMPACT_ZOOM = 1.45;

type Selection = { readonly type: "goal" | "agent"; readonly id: string };
type Row =
  | Selection
  | { readonly type: "inbox-label"; readonly id: "inbox-label" }
  | { readonly type: "context-label"; readonly id: string };

type MapLens = "portfolio" | "attention" | "goal" | "inbox" | "contexts";
type ViewMode = "map" | "list";
type ListLens = "goals" | "contexts";
type HitTarget = Selection & {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly bounds?: Rect;
};
type InboxHitTarget = {
  readonly type: "inbox";
  readonly id: "inbox";
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly bounds?: Rect;
};
type MapHitTarget = HitTarget | InboxHitTarget;
type MapAgentRenderOptions = {
  readonly kind?: "inbox" | "context";
  readonly accent?: RGBA;
};

type PendingLaunch = {
  readonly id: string;
  readonly goalId?: string;
  readonly agentKind: string;
  readonly displayName: string;
};

type PendingLaunchPlacement = {
  readonly pending: PendingLaunch;
  readonly goal?: MapGoalView;
  readonly position: MapPosition;
};

type ContextActionId =
  | "focus"
  | "open-terminal"
  | "open-linked-execution"
  | "inspect"
  | "new-goal"
  | "new-agent"
  | "assign"
  | "related"
  | "unassign"
  | "rename"
  | "description"
  | "priority"
  | "complete"
  | "archive"
  | "attention"
  | "list"
  | "clear";

type ContextMenu = {
  readonly scope: ContextMenuScope;
  readonly target?: Selection;
  readonly x: number;
  readonly y: number;
  readonly index: number;
  readonly actions: readonly { readonly id: ContextActionId; readonly label: string }[];
};

type DragState =
  | {
      readonly kind: "pan";
      readonly lastX: number;
      readonly lastY: number;
      readonly moved: boolean;
      readonly clickTarget?: "inbox";
      readonly clickSelection?: Selection;
    }
  | {
      readonly kind: "goal";
      readonly goalId: string;
      readonly startX: number;
      readonly startY: number;
      readonly origin: MapPosition;
      readonly lastX: number;
      readonly lastY: number;
      readonly moved: boolean;
    };

type GoalClick = {
  readonly id: string;
  readonly at: number;
};

type LaunchField = "goal" | "location" | "workspace" | "branch" | "agent" | "name" | "prompt";

type AgentLaunchModal = {
  readonly kind: "agent-launch";
  readonly field: LaunchField;
  readonly goalIndex: number;
  readonly location: string;
  readonly locations: readonly WorkspaceChoice[];
  readonly locationIndex: number;
  readonly workspaceMode: "existing" | "worktree";
  readonly branch: string;
  readonly agentOptions: readonly HostLaunchOption[];
  readonly agentIndex: number;
  readonly agentKind: string;
  readonly agentName: string;
  readonly prompt: string;
};

type WorkspacePickerModal = {
  readonly kind: "workspace-picker";
  readonly browser: WorkspaceBrowser;
  readonly index: number;
  readonly loading: boolean;
  readonly returnTo: AgentLaunchModal;
};

type RelatedAgentsModal = {
  readonly kind: "related-agents";
  readonly goalId: string;
  readonly index: number;
  readonly selectedIds: readonly string[];
};

type LinkedExecutionModal = {
  readonly kind: "linked-execution-picker";
  readonly agentId: string;
  readonly index: number;
  readonly executions: readonly LinkedExecution[];
};

type Modal =
  | {
      readonly kind: "create-goal";
      readonly field: 0 | 1 | 2;
      readonly title: string;
      readonly description: string;
      readonly priority: (typeof PRIORITIES)[number];
    }
  | {
      readonly kind: "text";
      readonly title: string;
      readonly value: string;
      readonly action: "rename-goal" | "rename-agent" | "description-goal" | "description-agent";
    }
  | {
      readonly kind: "goal-picker";
      readonly agentId: string;
      readonly index: number;
    }
  | {
      readonly kind: "agent-picker";
      readonly goalId: string;
      readonly index: number;
      readonly query: string;
    }
  | RelatedAgentsModal
  | LinkedExecutionModal
  | AgentLaunchModal
  | WorkspacePickerModal
  | {
      readonly kind: "confirm";
      readonly action: "complete";
      readonly goalId: string;
      readonly title: string;
    }
  | {
      readonly kind: "confirm";
      readonly action: "archive";
      readonly goalId: string;
      readonly title: string;
    }
  | {
      readonly kind: "confirm";
      readonly action: "archive-agent";
      readonly agentId: string;
      readonly title: string;
    };

type SurfaceRole = "primary" | "linkedExecution";

type TerminalMode = {
  readonly role: SurfaceRole;
  readonly agentId: string;
  readonly displayName: string;
  readonly hostLabel: string;
  readonly terminal: HostedTerminalSession;
  readonly screen: TerminalScreen;
  dimensions: TerminalDimensions;
  status: string;
  closed: boolean;
};

type SurfaceFocus = "map" | SurfaceRole;

export interface CommandCentreAppOptions {
  readonly universe: Universe;
  readonly host: SessionHost;
  readonly startAgent: StartAgentCoordinator;
  readonly workspace: WorkspaceProvider;
  readonly clock: Clock;
  readonly refresh: Effect.Effect<string, HostError>;
  readonly initialAction?: string;
  readonly onClose?: () => void;
  readonly renderer: CliRenderer;
}

export type CommandCentreDependencies = Omit<CommandCentreAppOptions, "renderer">;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const shorten = (value: string, maximum: number): string => {
  if (maximum <= 0) return "";
  if (value.length <= maximum) return value;
  if (maximum === 1) return value.slice(0, 1);
  return `${value.slice(0, maximum - 1)}…`;
};

const inputWithCursor = (value: string, cursor: number): string => {
  const position = Math.max(0, Math.min(value.length, cursor));
  return `${value.slice(0, position)}_${value.slice(position)}`;
};

const inputWithVisibleCursor = (value: string, cursor: number, maximum: number): string => {
  const limit = Math.max(4, maximum);
  const position = Math.max(0, Math.min(value.length, cursor));
  const contentLimit = Math.max(1, limit - 1);
  if (value.length <= contentLimit) return inputWithCursor(value, position);

  let start = Math.max(0, Math.min(value.length - contentLimit, position - contentLimit + 1));
  let end = Math.min(value.length, start + contentLimit);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < value.length ? "…" : "";
  const bodyLimit = Math.max(1, contentLimit - prefix.length - suffix.length);
  if (end - start > bodyLimit) {
    start = Math.max(0, Math.min(value.length - bodyLimit, position - bodyLimit + 1));
    end = Math.min(value.length, start + bodyLimit);
  }
  return `${start > 0 ? "…" : ""}${inputWithCursor(value.slice(start, end), position - start)}${end < value.length ? "…" : ""}`;
};

const countLabel = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const wrap = (value: string, maximum: number): string[] => {
  if (maximum <= 1) return [shorten(value, maximum)];
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= maximum) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.flatMap((wrappedLine) =>
    wrappedLine.length > maximum ? [shorten(wrappedLine, maximum)] : [wrappedLine],
  );
};

// Selected cards are an identification surface, so they may wrap a long
// branch-like token over several rows instead of hiding the end behind an
// ellipsis. Unselected labels keep using `wrap`, which deliberately favours a
// compact map over exhaustive copy.
const wrapFully = (value: string, maximum: number): string[] => {
  if (maximum <= 1) return [shorten(value, maximum)];
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length <= maximum) {
      if (!line) line = word;
      else if (line.length + word.length + 1 <= maximum) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    let offset = 0;
    while (word.length - offset > maximum) {
      lines.push(word.slice(offset, offset + maximum));
      offset += maximum;
    }
    line = word.slice(offset);
  }
  if (line) lines.push(line);
  return lines;
};

const statusGlyph = (agent: AgentView, phase = 0): string => {
  return agentMarker(agent.hostHealth, agent.runtimeState, phase);
};

const statusColor = (agent: AgentView, recentlyDone = false): RGBA => {
  if (agent.hostHealth !== "live") return COLORS.yellow;
  if (agent.runtimeState === "blocked") return COLORS.red;
  if (agent.runtimeState === "waiting") return COLORS.orange;
  if (agent.runtimeState === "working") return COLORS.green;
  if (agent.runtimeState === "done") return recentlyDone ? COLORS.green : COLORS.completed;
  return COLORS.muted;
};

export class CommandCentreApp {
  private readonly canvas: FrameBufferRenderable;
  private readonly overlayCanvas: FrameBufferRenderable;
  private readonly options: CommandCentreAppOptions;
  private selected: Selection | undefined;
  private modal: Modal | undefined;
  private searchActive = false;
  private searchQuery = "";
  private searchCursor = 0;
  private searchIndex = 0;
  private inputCursor = 0;
  private expandedGoals = new Set<string>();
  private scrollOffset = 0;
  private viewMode: ViewMode = "map";
  private listLens: ListLens = "goals";
  private mapLens: MapLens = "portfolio";
  private semanticZoom: SemanticZoomLevel = "overview";
  private focusGoalId: string | undefined;
  private mapCenter: MapPosition = { x: 0, y: 0 };
  private mapZoom = 1;
  private mapFitPending = true;
  private mapScaleX = 0.5;
  private mapScaleY = 0.3;
  private mapRect: Rect | undefined;
  private mapSurface: Rect | undefined;
  private drawClip: Rect | undefined;
  private hitTargets: MapHitTarget[] = [];
  private dragState: DragState | undefined;
  private lastGoalClick: GoalClick | undefined;
  private lastAgentClick: GoalClick | undefined;
  private hovered: MapHitTarget | undefined;
  private floatingInspectorRect: Rect | undefined;
  private inspectorVisible = false;
  private diagnosticsVisible = true;
  private suspended = false;
  private busy = false;
  private pendingLaunch: PendingLaunch | undefined;
  private contextMenu: ContextMenu | undefined;
  private lastAction: string;
  private closed = false;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;
  private frameCount = 0;
  private frameStarted = performance.now();
  private lastFrameMs = 0;
  private animationPhase = 0;
  private terminalMode: TerminalMode | undefined;
  private linkedExecutionTerminal: TerminalMode | undefined;
  private presentationMode: "map" | "review" = "map";
  private focusedSurface: SurfaceFocus = "map";
  private surfaceLayout: SurfaceLayout | undefined;
  private terminalPanel: BoxRenderable | undefined;
  private terminalText: TextRenderable | undefined;
  private linkedExecutionPanel: BoxRenderable | undefined;
  private linkedExecutionText: TextRenderable | undefined;
  private pickerSelect: SelectRenderable | undefined;
  private pickerMode: "agent" | "workspace" | "linked-execution" | undefined;
  private readonly agentAccessById = new Map<string, AgentAccess>();
  private readonly agentAccessRequests = new Set<string>();

  constructor(options: CommandCentreAppOptions) {
    this.options = options;
    this.lastAction = options.initialAction ?? "ready";
    this.canvas = new FrameBufferRenderable(this.renderer, {
      id: "ao-command-centre-framebuffer",
      width: this.renderer.width,
      height: this.renderer.height,
      respectAlpha: true,
      onMouse: (event) => this.handleMouse(event),
      onMouseMove: (event) => {
        if (event.isDragging) this.handleMouseDrag(event);
        else this.handleMouseMove(event);
      },
      onMouseDrag: (event) => this.handleMouseDrag(event),
      onMouseDragEnd: (event) => this.handleMouseDragEnd(event),
      onMouseScroll: (event) => this.handleSurfaceMouseScroll(event),
    });
    this.canvas.renderBefore = (_buffer, deltaTime) => this.renderFrame(deltaTime);
    this.overlayCanvas = new FrameBufferRenderable(this.renderer, {
      id: "ao-command-centre-overlay-framebuffer",
      position: "absolute",
      left: 0,
      top: 0,
      width: this.renderer.width,
      height: this.renderer.height,
      respectAlpha: true,
      visible: false,
      zIndex: 30,
      onMouse: (event) => this.handleMouse(event),
      onMouseMove: (event) => {
        if (event.isDragging) this.handleMouseDrag(event);
        else this.handleMouseMove(event);
      },
      onMouseDrag: (event) => this.handleMouseDrag(event),
      onMouseDragEnd: (event) => this.handleMouseDragEnd(event),
      onMouseScroll: (event) => this.handleSurfaceMouseScroll(event),
    });
    this.overlayCanvas.renderBefore = () => this.renderOverlayFrame();
    this.renderer.root.add(this.canvas);
    this.renderer.root.add(this.overlayCanvas);
    this.renderer.on("resize", (width: number, height: number) => {
      this.canvas.width = width;
      this.canvas.height = height;
      this.overlayCanvas.width = width;
      this.overlayCanvas.height = height;
      if (this.terminalMode || this.linkedExecutionTerminal) this.resizeOpenSurfaces(width, height);
      this.lastAction = `resized to ${width}×${height}`;
      this.requestRenderIfAlive();
    });
    this.renderer.keyInput.on("keypress", (key) => this.handleKey(key));
    this.renderer.keyInput.on("paste", (event) => this.handlePaste(event));
    this.renderer.setTerminalTitle("Observatory — agent universe");
  }

  private get renderer(): CliRenderer {
    return this.options.renderer;
  }

  private requestRenderIfAlive(): void {
    if (!this.closed && !this.renderer.isDestroyed) this.renderer.requestRender();
  }

  private workspacePickerRows(modal: WorkspacePickerModal): WorkspaceChoice[] {
    return [
      {
        path: modal.browser.path,
        label: "Use this directory",
        kind: "workspace",
        repository: undefined,
        branch: undefined,
        available: true,
      },
      ...modal.browser.entries,
    ];
  }

  private pickerOptions(
    modal: Modal,
    mode: "agent" | "workspace" | "linked-execution",
  ): SelectOption[] {
    if (mode === "workspace" && modal.kind === "workspace-picker")
      return this.workspacePickerRows(modal).map((entry) => ({
        name: entry.kind === "workspace" ? entry.label : `${entry.label}/`,
        description:
          entry.kind === "workspace"
            ? "Use this directory for the new agent"
            : entry.repository
              ? `${entry.repository}${entry.branch ? ` · ${entry.branch}` : ""}`
              : "Open directory",
        value: entry,
      }));
    if (mode === "agent" && modal.kind === "agent-launch")
      return modal.agentOptions.map((option) => ({
        name: option.label,
        description: option.description ?? option.kind,
        value: option.kind,
      }));
    if (mode === "linked-execution" && modal.kind === "linked-execution-picker")
      return modal.executions.map((execution) => ({
        name: `${execution.kind} · ${execution.label}`,
        description: execution.workingDirectory ?? execution.source,
        value: execution,
      }));
    return [];
  }

  private pickerNavigationKey(key: KeyEvent): boolean {
    return ["up", "down", "j", "k", "enter", "return", "linefeed"].includes(key.name);
  }

  private syncPickerSurface(width: number, height: number): void {
    const modal = this.modal;
    const mode: "agent" | "workspace" | "linked-execution" | undefined =
      modal?.kind === "workspace-picker" && !modal.loading
        ? "workspace"
        : modal?.kind === "agent-launch" && modal.field === "agent" && modal.agentOptions.length > 0
          ? "agent"
          : modal?.kind === "linked-execution-picker"
            ? "linked-execution"
            : undefined;
    if (!mode || !modal) {
      this.destroyPickerSurface();
      return;
    }
    const options = this.pickerOptions(modal, mode);
    if (options.length === 0) {
      this.destroyPickerSurface();
      return;
    }
    const frame = modalFrameFor(width, height, modal.kind);
    const top =
      mode === "workspace"
        ? frame.y + 5
        : frame.y + (modal.kind === "agent-launch" && modal.workspaceMode === "worktree" ? 7 : 6);
    const pickerHeight =
      mode === "workspace"
        ? Math.max(1, frame.footerY - top)
        : Math.max(1, Math.min(6, options.length, frame.footerY - top));
    const selectedIndex =
      mode === "workspace" && modal.kind === "workspace-picker"
        ? modal.index
        : modal.kind === "agent-launch"
          ? modal.agentIndex
          : modal.kind === "linked-execution-picker"
            ? modal.index
            : 0;
    const boundedIndex = Math.max(0, Math.min(options.length - 1, selectedIndex));
    const left = frame.x + 2;
    const pickerWidth = Math.max(1, frame.width - 4);
    if (!this.pickerSelect || this.pickerMode !== mode || this.pickerSelect.isDestroyed) {
      this.destroyPickerSurface();
      const select = new SelectRenderable(this.renderer, {
        id: "ao-modal-picker",
        position: "absolute",
        left,
        top,
        width: pickerWidth,
        height: pickerHeight,
        zIndex: 40,
        options,
        selectedIndex: boundedIndex,
        backgroundColor: COLORS.panelRaised,
        textColor: COLORS.muted,
        focusedBackgroundColor: COLORS.panelRaised,
        focusedTextColor: COLORS.white,
        selectedBackgroundColor: COLORS.panel,
        selectedTextColor: COLORS.white,
        descriptionColor: COLORS.faint,
        selectedDescriptionColor: COLORS.muted,
        showDescription: false,
        showSelectionIndicator: true,
        showScrollIndicator: options.length > pickerHeight,
        wrapSelection: false,
      });
      select.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
        this.handlePickerSelection(mode, index);
      });
      select.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
        this.handlePickerItemSelected(mode, index);
      });
      this.renderer.root.add(select);
      this.pickerSelect = select;
      this.pickerMode = mode;
      select.focus();
      return;
    }
    const select = this.pickerSelect;
    select.options = options;
    select.left = left;
    select.top = top;
    select.width = pickerWidth;
    select.height = pickerHeight;
    if (select.getSelectedIndex() !== boundedIndex) select.setSelectedIndex(boundedIndex);
  }

  private handlePickerSelection(
    mode: "agent" | "workspace" | "linked-execution",
    index: number,
  ): void {
    const modal = this.modal;
    if (mode === "workspace" && modal?.kind === "workspace-picker") {
      this.modal = { ...modal, index };
    } else if (mode === "agent" && modal?.kind === "agent-launch") {
      const option = modal.agentOptions[index];
      if (option)
        this.modal = {
          ...modal,
          agentIndex: index,
          agentKind: option.kind,
        };
    } else if (mode === "linked-execution" && modal?.kind === "linked-execution-picker") {
      this.modal = { ...modal, index };
    }
    this.requestRenderIfAlive();
  }

  private handlePickerItemSelected(
    mode: "agent" | "workspace" | "linked-execution",
    index: number,
  ): void {
    const modal = this.modal;
    if (mode === "workspace" && modal?.kind === "workspace-picker") {
      this.chooseWorkspaceFromPicker({ ...modal, index });
      this.requestRenderIfAlive();
      return;
    }
    if (mode === "agent" && modal?.kind === "agent-launch") {
      const option = modal.agentOptions[index];
      if (!option) return;
      const next = { ...modal, agentIndex: index, agentKind: option.kind };
      this.advanceLaunchField(next, 1);
      this.requestRenderIfAlive();
      return;
    }
    if (mode === "linked-execution" && modal?.kind === "linked-execution-picker") {
      this.chooseLinkedExecution(modal, index);
    }
  }

  private destroyPickerSurface(): void {
    const picker = this.pickerSelect;
    this.pickerSelect = undefined;
    this.pickerMode = undefined;
    if (!picker || picker.isDestroyed) return;
    if (picker.focused) picker.blur();
    this.renderer.root.remove(picker);
    picker.destroy();
  }

  start(): void {
    this.refreshTimer = setInterval(() => {
      if (!this.closed && !this.busy) void this.refreshFromHost(false);
    }, 2_500);
    this.renderer.start();
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.destroyPickerSurface();
    const terminals = [this.terminalMode?.terminal, this.linkedExecutionTerminal?.terminal].filter(
      (terminal): terminal is HostedTerminalSession => terminal !== undefined,
    );
    this.terminalMode = undefined;
    this.linkedExecutionTerminal = undefined;
    this.destroyTerminalSurface("primary");
    this.destroyTerminalSurface("linkedExecution");
    for (const terminal of terminals)
      void Effect.runPromise(terminal.release()).catch(() => undefined);
    this.refreshTimer = undefined;
    this.suspendTimer = undefined;
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.terminalMode) void this.releaseTerminal("primary");
    if (this.linkedExecutionTerminal) void this.releaseTerminal("linkedExecution");
    this.dispose();
    this.renderer.destroy();
  }

  private projection(): CommandCentreProjection {
    const projection = this.options.universe.project({
      kind: "command-centre",
      now: this.options.clock.now(),
    });
    if (projection.kind !== "command-centre")
      throw new Error("Universe returned an unexpected projection.");
    return projection;
  }

  private codeContextProjection(): CodeContextProjection {
    const projection = this.options.universe.project({
      kind: "code-contexts",
      now: this.options.clock.now(),
    });
    if (projection.kind !== "code-contexts")
      throw new Error("Universe returned an unexpected code-context projection.");
    return projection;
  }

  private codeContextMapProjection(): CodeContextMapProjection {
    const projection = this.options.universe.project({
      kind: "code-context-map",
      now: this.options.clock.now(),
    });
    if (projection.kind !== "code-context-map")
      throw new Error("Universe returned an unexpected code-context map projection.");
    return projection;
  }

  private relatedAgentsProjection(goalId: string): RelatedAgentsProjection {
    const projection = this.options.universe.project({
      kind: "related-agents",
      now: this.options.clock.now(),
      goalId,
      includeDismissed: true,
    });
    if (projection.kind !== "related-agents")
      throw new Error("Universe returned an unexpected related-agents projection.");
    return projection;
  }

  private requestAgentAccess(agent: AgentView | undefined): void {
    if (!agent || this.agentAccessById.has(agent.id) || this.agentAccessRequests.has(agent.id))
      return;
    this.agentAccessRequests.add(agent.id);
    void Effect.runPromise(
      this.options.host.access({
        hostKind: agent.hostKind,
        nativeId: agent.nativeId,
      }),
    )
      .then((access) => {
        if (this.closed) return;
        this.agentAccessById.set(agent.id, access);
        this.requestRenderIfAlive();
      })
      .catch((error) => {
        if (this.closed) return;
        this.agentAccessById.set(agent.id, {
          supported: false,
          capabilities: [],
          linkedExecutions: [],
          explanation: `Agent capabilities unavailable: ${error instanceof Error ? error.message : String(error)}`,
        });
        this.requestRenderIfAlive();
      })
      .finally(() => this.agentAccessRequests.delete(agent.id));
  }

  private agentCapabilityLine(access: AgentAccess): string {
    if (!access.supported) return "surfaces unavailable";
    const labels = access.capabilities.map((capability) =>
      capability === "embedded-terminal"
        ? "embedded terminal"
        : capability === "linked-terminal"
          ? "linked terminal"
          : "native handoff",
    );
    const linkedExecutionCount = access.linkedExecutions.filter(
      (linkedExecution) => linkedExecution.available,
    ).length;
    return labels.length > 0
      ? `surfaces ${labels.join(" · ")}${linkedExecutionCount > 0 ? ` · ${linkedExecutionCount} linked execution${linkedExecutionCount === 1 ? "" : "s"}` : ""}`
      : "surfaces unavailable";
  }

  private mapProjection(): UniverseMapProjection {
    const projection = this.options.universe.project({
      kind: "universe-map",
      now: this.options.clock.now(),
    });
    if (projection.kind !== "universe-map")
      throw new Error("Universe returned an unexpected map projection.");
    return projection;
  }

  private rows(projection: CommandCentreProjection): Row[] {
    if (this.viewMode === "list" && this.listLens === "contexts") {
      const rows: Row[] = [];
      for (const context of this.codeContextProjection().contexts) {
        rows.push({ type: "context-label", id: context.key });
        for (const agent of context.agents) rows.push({ type: "agent", id: agent.id });
      }
      return rows;
    }
    if (this.viewMode === "map" && this.mapLens === "contexts")
      return this.codeContextMapProjection().contexts.flatMap((context) =>
        context.agents.map((agent) => ({ type: "agent", id: agent.id }) as const),
      );
    if (this.viewMode === "map" && this.mapLens === "inbox")
      return projection.unassigned.map((agent) => ({
        type: "agent",
        id: agent.id,
      }));
    if (this.viewMode === "map" && this.mapLens === "attention") {
      const rows: Row[] = [];
      for (const goal of projection.goals) {
        if (goal.attentionCount === 0 && goal.staleCount === 0) continue;
        rows.push({ type: "goal", id: goal.id });
        for (const agent of goal.agents) {
          if (agent.attention) rows.push({ type: "agent", id: agent.id });
        }
      }
      const attentionInbox = projection.unassigned.filter((agent) => agent.attention);
      if (attentionInbox.length > 0) {
        rows.push({ type: "inbox-label", id: "inbox-label" });
        for (const agent of attentionInbox) rows.push({ type: "agent", id: agent.id });
      }
      return rows;
    }
    const rows: Row[] = [];
    for (const goal of projection.goals) {
      rows.push({ type: "goal", id: goal.id });
      if (this.viewMode === "map" || this.expandedGoals.has(goal.id) || this.mapLens === "goal") {
        for (const agent of goal.agents) rows.push({ type: "agent", id: agent.id });
      }
    }
    const includeInboxRows =
      this.viewMode !== "map" || this.mapLens === "attention" || this.mapLens === "inbox";
    if (projection.unassigned.length > 0 && includeInboxRows) {
      rows.push({ type: "inbox-label", id: "inbox-label" });
      for (const agent of projection.unassigned) rows.push({ type: "agent", id: agent.id });
    }
    return rows;
  }

  private ensureSelection(projection: CommandCentreProjection): Row[] {
    const rows = this.rows(projection);
    const selectable = rows.filter(
      (row): row is Selection => row.type === "goal" || row.type === "agent",
    );
    if (
      !this.selected &&
      this.viewMode === "map" &&
      (this.mapLens === "inbox" || this.mapLens === "contexts")
    ) {
      this.scrollOffset = 0;
      return rows;
    }
    if (
      !this.selected ||
      !selectable.some((row) => row.type === this.selected?.type && row.id === this.selected.id)
    ) {
      const first = selectable[0];
      this.setSelection(first ? { type: first.type, id: first.id } : undefined);
    }
    const index = this.selected
      ? rows.findIndex((row) => row.type === this.selected?.type && row.id === this.selected?.id)
      : 0;
    const visibleHeight = Math.max(
      1,
      layoutFor(this.renderer.width, this.renderer.height).map.height - 2,
    );
    this.scrollOffset = clamp(
      index < 0 ? 0 : index - Math.floor(visibleHeight / 2),
      0,
      Math.max(0, rows.length - visibleHeight),
    );
    return rows;
  }

  private selectedGoal(projection: CommandCentreProjection): GoalView | undefined {
    if (!this.selected || this.selected.type !== "goal") return undefined;
    return projection.goals.find((goal) => goal.id === this.selected?.id);
  }

  private selectedAgent(projection: CommandCentreProjection): AgentView | undefined {
    if (!this.selected || this.selected.type !== "agent") return undefined;
    for (const goal of projection.goals) {
      const agent = goal.agents.find((candidate) => candidate.id === this.selected?.id);
      if (agent) return agent;
    }
    return projection.unassigned.find((agent) => agent.id === this.selected?.id);
  }

  private setSelection(next: Selection | undefined): void {
    const previousAgentId = this.selected?.type === "agent" ? this.selected.id : undefined;
    const nextAgentId = next?.type === "agent" ? next.id : undefined;
    if (previousAgentId !== nextAgentId) {
      if (this.terminalMode && this.terminalMode.agentId !== nextAgentId)
        void this.releaseTerminal("primary");
      if (this.linkedExecutionTerminal && this.linkedExecutionTerminal.agentId !== nextAgentId)
        void this.releaseTerminal("linkedExecution");
    }
    this.selected = next;
  }

  private inspector(): InspectorProjection {
    if (!this.selected)
      return {
        kind: "empty-inspector",
        lines: ["No accepted goals or agents yet."],
      };
    const projection = this.options.universe.project({
      kind: "inspector",
      now: this.options.clock.now(),
      target: this.selected,
    });
    if (
      projection.kind !== "goal-inspector" &&
      projection.kind !== "agent-inspector" &&
      projection.kind !== "empty-inspector"
    )
      throw new Error("Universe returned an unexpected inspector projection.");
    if (projection.kind === "agent-inspector") {
      const access = this.agentAccessById.get(projection.agent.id);
      if (access)
        return {
          ...projection,
          lines: [...projection.lines, this.agentCapabilityLine(access)],
        };
    }
    return projection;
  }

  private floatingInspector(): InspectorProjection {
    if (!this.selected && this.mapLens === "inbox") {
      const count = this.mapProjection().unassigned.length;
      return {
        kind: "empty-inspector",
        lines: [
          `${count} unassigned agents`,
          "select an agent for host facts",
          "t/Enter opens the selected agent in the terminal",
        ],
      };
    }
    return this.inspector();
  }

  private renderFrame(deltaTime: number): void {
    const started = performance.now();
    this.animationPhase = (this.animationPhase + Math.max(deltaTime, 16.67) / 1000) % 120;
    this.frameCount += 1;
    this.lastFrameMs = performance.now() - this.frameStarted;
    this.frameStarted = performance.now();
    const buffer = this.canvas.frameBuffer;
    const width = this.renderer.width;
    const height = this.renderer.height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.syncPickerSurface(width, height);
    this.overlayCanvas.visible = Boolean(this.searchActive || this.modal || this.contextMenu);
    buffer.clear(COLORS.background);
    const projection = this.projection();
    const rows = this.ensureSelection(projection);
    this.requestAgentAccess(this.selectedAgent(projection));
    const layout = layoutFor(width, height);
    const surfaces = surfaceLayoutFor(
      layout,
      this.presentationMode,
      this.terminalMode !== undefined,
      this.linkedExecutionTerminal !== undefined,
    );
    this.surfaceLayout = surfaces;
    this.mapRect = surfaces.map;
    this.mapSurface = undefined;
    this.floatingInspectorRect = undefined;
    this.hitTargets = [];
    this.drawHeader(buffer, layout.header, projection);
    this.drawAttention(buffer, layout.attention, projection, deltaTime);
    if (surfaces.map) {
      if (this.viewMode === "map") {
        if (this.mapLens === "contexts")
          this.drawCodeContextMap(buffer, surfaces.map, this.codeContextMapProjection());
        else this.drawMap(buffer, surfaces.map, this.mapProjection());
      } else {
        this.drawList(buffer, surfaces.map, projection, rows);
      }
      if (this.inspectorVisible)
        this.drawFloatingInspector(
          buffer,
          this.mapSurface ?? surfaces.map,
          this.floatingInspector(),
          this.viewMode === "map" ? this.selectedMapAnchor() : undefined,
          this.viewMode === "map"
            ? this.hitTargets.flatMap((target) => {
                const bounds = target.bounds ?? {
                  x: target.x - target.radiusX,
                  y: target.y - target.radiusY,
                  width: target.radiusX * 2 + 1,
                  height: target.radiusY * 2 + 1,
                };
                return [bounds];
              })
            : [],
        );
    }

    if (surfaces.primary && this.terminalMode) {
      this.drawTerminalSurfaceBackdrop(buffer, surfaces.primary, "primary", this.terminalMode);
      this.syncTerminalSurfaceGeometry(this.terminalMode, "primary", surfaces.primary);
    }
    if (surfaces.linkedExecution && this.linkedExecutionTerminal) {
      this.drawTerminalSurfaceBackdrop(
        buffer,
        surfaces.linkedExecution,
        "linkedExecution",
        this.linkedExecutionTerminal,
      );
      this.syncTerminalSurfaceGeometry(
        this.linkedExecutionTerminal,
        "linkedExecution",
        surfaces.linkedExecution,
      );
    }
    this.drawFooter(buffer, layout.footer, projection);
    if (this.diagnosticsVisible && width >= 110 && height >= 18) {
      const stats = this.renderer.getStats();
      this.text(
        buffer,
        `frame ${this.lastFrameMs.toFixed(1)}ms · draw ${(performance.now() - started).toFixed(1)}ms · fps ${stats?.fps?.toFixed?.(0) ?? "?"}`,
        2,
        Math.max(0, height - 1),
        COLORS.faint,
        COLORS.background,
      );
    }
  }

  private renderOverlayFrame(): void {
    const buffer = this.overlayCanvas.frameBuffer;
    buffer.clear(TRANSPARENT);
    if (this.searchActive || this.modal || this.contextMenu)
      this.drawOverlay(buffer, this.renderer.width, this.renderer.height, this.projection());
  }

  private drawTerminalSurfaceBackdrop(
    buffer: OptimizedBuffer,
    rect: Rect,
    role: SurfaceRole,
    mode: TerminalMode,
  ): void {
    this.fillRect(buffer, rect, TERMINAL_COLORS.background);
    this.text(
      buffer,
      role === "primary" ? "AGENT TERMINAL" : "LINKED TERMINAL",
      rect.x + 2,
      rect.y,
      COLORS.cyan,
      TERMINAL_COLORS.background,
      TextAttributes.BOLD,
    );
    this.textRight(
      buffer,
      `${mode.closed ? "closed" : "live"} · ${mode.hostLabel}`,
      rect.x + rect.width - 2,
      rect.y,
      mode.closed ? COLORS.orange : COLORS.faint,
      TERMINAL_COLORS.background,
    );
  }

  private createTerminalSurface(mode: TerminalMode, role: SurfaceRole, rect: Rect): void {
    this.destroyTerminalSurface(role);
    const panel = new BoxRenderable(this.renderer, {
      id: `ao-${role}-terminal-panel`,
      position: "absolute",
      left: rect.x,
      top: rect.y + 1,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height - 1),
      border: true,
      borderColor: this.focusedSurface === role ? COLORS.borderStrong : COLORS.border,
      backgroundColor: TERMINAL_COLORS.background,
      title: ` ${mode.displayName} `,
      titleColor: COLORS.cyan,
      zIndex: 20,
      onMouseScroll: (event) => this.handleTerminalMouseScroll(role, event),
    });
    const text = new TextRenderable(this.renderer, {
      id: `ao-${role}-terminal-text`,
      position: "absolute",
      left: rect.x + 1,
      top: rect.y + 2,
      width: Math.max(1, rect.width - 2),
      height: Math.max(1, rect.height - 3),
      content: mode.screen.toStyledText(),
      fg: TERMINAL_COLORS.text,
      bg: TERMINAL_COLORS.background,
      selectionBg: COLORS.borderStrong,
      selectionFg: COLORS.background,
      selectable: true,
      zIndex: 21,
      onMouseScroll: (event) => this.handleTerminalMouseScroll(role, event),
    });
    this.renderer.root.add(panel);
    this.renderer.root.add(text);
    if (role === "primary") {
      this.terminalPanel = panel;
      this.terminalText = text;
    } else {
      this.linkedExecutionPanel = panel;
      this.linkedExecutionText = text;
    }
  }

  private destroyTerminalSurface(role: SurfaceRole): void {
    const panel = role === "primary" ? this.terminalPanel : this.linkedExecutionPanel;
    const text = role === "primary" ? this.terminalText : this.linkedExecutionText;
    if (role === "primary") {
      this.terminalPanel = undefined;
      this.terminalText = undefined;
    } else {
      this.linkedExecutionPanel = undefined;
      this.linkedExecutionText = undefined;
    }
    if (panel && !panel.isDestroyed) {
      this.renderer.root.remove(panel);
      panel.destroy();
    }
    if (text && !text.isDestroyed) {
      this.renderer.root.remove(text);
      text.destroy();
    }
  }

  private updateTerminalSurface(mode: TerminalMode): void {
    const text = mode.role === "primary" ? this.terminalText : this.linkedExecutionText;
    const panel = mode.role === "primary" ? this.terminalPanel : this.linkedExecutionPanel;
    if (text && !text.isDestroyed) text.content = mode.screen.toStyledText();
    if (panel && !panel.isDestroyed) {
      panel.title = ` ${mode.displayName} `;
      panel.borderColor = this.focusedSurface === mode.role ? COLORS.borderStrong : COLORS.border;
    }
  }

  private syncTerminalSurfaceGeometry(mode: TerminalMode, role: SurfaceRole, rect: Rect): void {
    const panel = role === "primary" ? this.terminalPanel : this.linkedExecutionPanel;
    const text = role === "primary" ? this.terminalText : this.linkedExecutionText;
    if (!panel || !text || panel.isDestroyed || text.isDestroyed) {
      this.createTerminalSurface(mode, role, rect);
    } else {
      panel.left = rect.x;
      panel.top = rect.y + 1;
      panel.width = Math.max(1, rect.width);
      panel.height = Math.max(1, rect.height - 1);
      text.left = rect.x + 1;
      text.top = rect.y + 2;
      text.width = Math.max(1, rect.width - 2);
      text.height = Math.max(1, rect.height - 3);
      this.updateTerminalSurface(mode);
    }
    const dimensions = ensureTerminalDimensions(rect.width - 2, rect.height - 3);
    if (dimensions.columns === mode.dimensions.columns && dimensions.rows === mode.dimensions.rows)
      return;
    mode.dimensions = dimensions;
    mode.screen.resize(dimensions.columns, dimensions.rows);
    this.updateTerminalSurface(mode);
    void Effect.runPromise(mode.terminal.resize(dimensions))
      .then((result) => {
        if (!result.ok && this.isActiveTerminal(mode)) {
          mode.status = result.message;
          this.requestRenderIfAlive();
        }
      })
      .catch((error) => {
        if (this.isActiveTerminal(mode)) {
          mode.status = `terminal resize failed: ${error instanceof Error ? error.message : String(error)}`;
          this.requestRenderIfAlive();
        }
      });
  }

  private resizeOpenSurfaces(_width: number, _height: number): void {
    // Geometry and host resize are reconciled from the same layout during the
    // next frame, so a resize event cannot race two independent surface trees.
    this.requestRenderIfAlive();
  }

  private drawHeader(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: CommandCentreProjection,
  ): void {
    this.panel(buffer, rect, COLORS.panel, COLORS.border);
    const host = projection.host;
    const hostLabel = host
      ? `${displayHostKind(host.hostKind)} ${host.status}${host.diagnosticCount > 0 ? ` · diag ${host.diagnosticCount}` : ""}`
      : "host not observed";
    const contextCount =
      (this.viewMode === "list" && this.listLens === "contexts") ||
      (this.viewMode === "map" && this.mapLens === "contexts")
        ? this.codeContextMapProjection().counts.contexts
        : undefined;
    const counts = `${countLabel(projection.counts.goals, "goal")} · ${countLabel(projection.counts.agents, "agent")} · ${projection.counts.unassigned} inbox${contextCount === undefined ? "" : ` · ${countLabel(contextCount, "context")}`}`;
    const title = `OBSERVATORY  ${displayHostKind(host?.hostKind ?? "host").toUpperCase()}`;
    this.text(buffer, title, rect.x + 2, rect.y, COLORS.white, COLORS.panel, TextAttributes.BOLD);
    this.textRight(
      buffer,
      `${hostLabel} · ${counts}`,
      rect.x + rect.width - 2,
      rect.y,
      host?.status === "live" ? COLORS.green : COLORS.yellow,
      COLORS.panel,
    );
    if (rect.height > 1) {
      const query = this.searchActive
        ? `search: ${this.searchQuery || "type to find"}`
        : `${this.viewMode === "map" ? "map" : `list · ${this.listLens}`} · ${this.lastAction}`;
      const warningParts = [
        ...(projection.counts.unassigned > 0
          ? [`INBOX !${projection.counts.unassigned} · v list`]
          : []),
        ...(projection.counts.stale > 0 ? [`STALE ?${projection.counts.stale}`] : []),
      ];
      const warning = warningParts.length > 0 ? warningParts.join(" · ") : undefined;
      const leftWidth = warning
        ? Math.max(1, rect.width - warning.length - 8)
        : Math.max(1, rect.width - 4);
      this.text(
        buffer,
        shorten(query, leftWidth),
        rect.x + 2,
        rect.y + 1,
        COLORS.muted,
        COLORS.panel,
      );
      if (warning)
        this.textRight(
          buffer,
          warning,
          rect.x + rect.width - 2,
          rect.y + 1,
          COLORS.yellow,
          COLORS.panel,
          TextAttributes.BOLD,
        );
    }
  }

  private drawAttention(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: CommandCentreProjection,
    deltaTime: number,
  ): void {
    this.panel(buffer, rect, COLORS.panelRaised, COLORS.border);
    const current = projection.attention.items.find((item) => item.requiresHumanInput);
    const uncertainty = projection.attention.items.find((item) => !item.requiresHumanInput);
    if (current) {
      const agent = this.findAgent(projection, current.agentId);
      const text = `ATTENTION ! ${agent?.displayName ?? current.targetId} · ${current.reason} · waiting ${formatAge(current.ageMs)} · ${current.explanation}`;
      this.text(
        buffer,
        shorten(text, Math.max(1, rect.width - 4)),
        rect.x + 2,
        rect.y,
        COLORS.orange,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
    } else {
      const text = uncertainty
        ? `ATTENTION clear · uncertainty: ${uncertainty.explanation}`
        : "ATTENTION clear · no current human-input agents";
      this.text(
        buffer,
        shorten(text, Math.max(1, rect.width - 4)),
        rect.x + 2,
        rect.y,
        uncertainty ? COLORS.yellow : COLORS.green,
        COLORS.panelRaised,
      );
    }
    if (rect.height > 1) {
      const suffix = `${projection.counts.attention} current · ${projection.counts.uncertainty} uncertain · ${Math.max(0, Math.round(deltaTime))}ms frame tick`;
      this.textRight(
        buffer,
        suffix,
        rect.x + rect.width - 2,
        rect.y + 1,
        COLORS.faint,
        COLORS.panelRaised,
      );
    }
  }

  private pendingLaunchPlacement(
    projection: UniverseMapProjection,
    visibleGoals: readonly MapGoalView[],
  ): PendingLaunchPlacement | undefined {
    const pending = this.pendingLaunch;
    if (!pending) return undefined;
    if (pending.goalId) {
      const goal = visibleGoals.find((candidate) => candidate.id === pending.goalId);
      if (!goal) return undefined;
      const positions = agentSatellitePositions(goal.mapPosition, goal.id, [
        ...goal.agents.map((agent) => agent.id),
        pending.id,
      ]);
      const position = positions.get(pending.id);
      return position ? { pending, goal, position } : undefined;
    }
    const positions = unassignedAgentPositions(projection.inboxPosition, [
      ...projection.unassigned.map((agent) => agent.id),
      pending.id,
    ]);
    const position = positions.get(pending.id);
    return position ? { pending, position } : undefined;
  }

  private drawCodeContextMap(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: CodeContextMapProjection,
  ): void {
    this.panel(buffer, rect, COLORS.background, COLORS.border);
    if (rect.width < 8 || rect.height < 5) return;

    const map = {
      x: rect.x + 1,
      y: rect.y + 1,
      width: Math.max(1, rect.width - 2),
      height: Math.max(1, rect.height - 2),
    };
    this.mapSurface = map;
    const baseScale = {
      x: clamp(map.width / 150, 0.38, 0.85),
      y: clamp(map.height / 70, 0.22, 0.52),
    };
    const agents = projection.contexts.flatMap((context) => context.agents);
    const mapPoints = projection.contexts.flatMap((context) => [
      context.mapPosition,
      ...context.agents.map((agent) => agent.mapPosition),
    ]);
    if (this.mapFitPending && mapPoints.length > 0) {
      const fit = fitViewportToPoints(
        mapPoints,
        map,
        baseScale,
        MAP_FIT_PADDING_X,
        MAP_FIT_PADDING_Y,
      );
      this.mapCenter = fit.center;
      this.mapZoom = fit.zoom;
      this.mapFitPending = false;
    }
    this.mapScaleX = baseScale.x * this.mapZoom;
    this.mapScaleY = baseScale.y * this.mapZoom;
    const title = `CODE CONTEXT MAP · ${countLabel(projection.contexts.length, "context")} · ${countLabel(agents.length, "agent")}`;
    this.text(
      buffer,
      shorten(title, Math.max(1, rect.width - 14)),
      rect.x + 2,
      rect.y,
      COLORS.cyan,
      COLORS.background,
      TextAttributes.BOLD,
    );
    this.textRight(
      buffer,
      `contexts · labels ${this.semanticZoom} · ${Math.round(this.mapZoom * 100)}%`,
      rect.x + rect.width - 2,
      rect.y,
      COLORS.faint,
      COLORS.background,
    );
    const worldToScreen = (point: MapPosition): MapPosition =>
      screenPointForWorld(point, { center: this.mapCenter, zoom: this.mapZoom }, map, {
        x: this.mapScaleX,
        y: this.mapScaleY,
      });

    for (let x = map.x + 4; x < map.x + map.width - 1; x += 12) {
      for (let y = map.y + 2; y < map.y + map.height - 1; y += 4)
        this.cell(buffer, x, y, "·", COLORS.faint, COLORS.background);
    }

    if (projection.contexts.length === 0) {
      this.text(
        buffer,
        "No observed code contexts yet — N launches an agent.",
        map.x + 2,
        map.y + Math.floor(map.height / 2),
        COLORS.muted,
        COLORS.background,
      );
      return;
    }

    for (const context of projection.contexts) {
      const contextPoint = worldToScreen(context.mapPosition);
      const accent = this.goalFamilyColor(context.key);
      for (const agent of context.agents)
        this.drawMapLink(
          buffer,
          contextPoint,
          worldToScreen(agent.mapPosition),
          map,
          undefined,
          agent,
          accent,
        );
    }

    this.withDrawClip(map, () => {
      for (const context of projection.contexts) {
        const accent = this.goalFamilyColor(context.key);
        const contextPoint = worldToScreen(context.mapPosition);
        for (const agent of context.agents)
          if (!(this.selected?.type === "agent" && this.selected.id === agent.id))
            this.drawMapAgent(buffer, map, worldToScreen(agent.mapPosition), undefined, agent, {
              kind: "context",
              accent,
            });
        this.drawMapContext(buffer, map, contextPoint, context);
      }

      if (this.selected?.type === "agent") {
        for (const context of projection.contexts) {
          const agent = context.agents.find((candidate) => candidate.id === this.selected?.id);
          if (!agent) continue;
          this.drawMapAgent(buffer, map, worldToScreen(agent.mapPosition), undefined, agent, {
            kind: "context",
            accent: this.goalFamilyColor(context.key),
          });
        }
      }
    });

    this.text(
      buffer,
      "w goals · v list · agents remain selectable · repository/worktree facts are observed",
      map.x + 2,
      map.y + map.height - 2,
      COLORS.faint,
      COLORS.background,
    );
  }

  private drawMapContext(
    buffer: OptimizedBuffer,
    map: Rect,
    point: { readonly x: number; readonly y: number },
    context: CodeContextMapView,
  ): void {
    const contextAttention = context.attentionCount > 0 || context.staleCount > 0;
    const selectedAgent =
      this.selected?.type === "agent" &&
      context.agents.some((agent) => agent.id === this.selected?.id);
    const level = semanticZoomLevel({
      lens: this.mapLens,
      preference: this.semanticZoom,
      selected: false,
      attention: contextAttention,
    });
    const nodeScale = perspectiveNodeScale(clamp(this.mapZoom, 0.65, 2.2));
    const titleBudget = Math.min(
      level === "detail" ? 42 : level === "context" ? 32 : 26,
      Math.max(10, Math.floor(this.mapScaleX * 40 * nodeScale)),
    );
    const titleLines =
      level === "detail"
        ? wrap(context.label, Math.max(8, titleBudget - 2)).slice(0, 2)
        : [shorten(context.label, titleBudget)];
    const details = `${context.agents.length}s  ${context.worktreeCount}w${level === "detail" ? `  ${context.source}` : ""}${context.attentionCount > 0 ? `  !${context.attentionCount}` : ""}${context.staleCount > 0 ? `  ?${context.staleCount}` : ""}`;
    const contentWidth = Math.max(...titleLines.map((line) => line.length), details.length, 7);
    const radiusX = clamp(
      Math.round((Math.ceil(contentWidth / 2) + 1) * nodeScale),
      7,
      this.renderer.width < 100 ? 16 : 22,
    );
    const radiusY = clamp(
      Math.round((titleLines.length + (level === "detail" ? 1 : 0) + 1) * nodeScale),
      2,
      5,
    );
    const bounds = {
      x: point.x - radiusX,
      y: point.y - radiusY,
      width: radiusX * 2 + 1,
      height: radiusY * 2 + 1,
    };
    if (
      point.x < map.x - radiusX ||
      point.x >= map.x + map.width + radiusX ||
      point.y < map.y - radiusY ||
      point.y >= map.y + map.height + radiusY
    )
      return;
    const accent = this.goalFamilyColor(context.key);
    const border = contextAttention
      ? context.attentionCount > 0
        ? COLORS.orange
        : COLORS.yellow
      : selectedAgent
        ? COLORS.cyan
        : accent;
    this.roundedPanel(buffer, bounds, COLORS.panelRaised, border);
    this.cell(buffer, point.x, point.y - radiusY + 1, "◎", accent, COLORS.panelRaised);
    const titleY = titleLines.length > 1 ? point.y - Math.ceil(titleLines.length / 2) : point.y;
    for (const [index, title] of titleLines.entries())
      this.textCentered(
        buffer,
        title,
        point.x,
        titleY + index,
        contextAttention ? COLORS.white : COLORS.text,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
    this.textCentered(
      buffer,
      shorten(details, Math.max(3, radiusX * 2 - 2)),
      point.x,
      Math.min(point.y + radiusY - 1, titleY + titleLines.length),
      context.attentionCount > 0
        ? COLORS.orange
        : context.staleCount > 0
          ? COLORS.yellow
          : COLORS.muted,
      COLORS.panelRaised,
    );
  }

  private drawMap(buffer: OptimizedBuffer, rect: Rect, projection: UniverseMapProjection): void {
    this.panel(buffer, rect, COLORS.background, COLORS.border);
    if (rect.width < 8 || rect.height < 5) return;

    const focusGoal = this.focusGoalId
      ? projection.goals.find((goal) => goal.id === this.focusGoalId)
      : undefined;
    if (this.mapLens === "goal" && !focusGoal) {
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.mapFitPending = true;
    }
    if (this.mapLens === "inbox" && projection.unassigned.length === 0) {
      this.mapLens = "portfolio";
      this.mapFitPending = true;
    }
    const attentionLens = this.mapLens === "attention";
    const focusInbox = this.mapLens === "inbox";
    const visibleAgents = (goal: MapGoalView): readonly MapAgentView[] =>
      attentionLens ? goal.agents.filter((agent) => agent.attention) : goal.agents;
    const visibleUnassigned = attentionLens
      ? projection.unassigned.filter((agent) => agent.attention)
      : projection.unassigned;

    const map = {
      x: rect.x + 1,
      y: rect.y + 1,
      width: Math.max(1, rect.width - 2),
      height: Math.max(1, rect.height - 2),
    };
    // The inbox is a transient queue, not a durable topology node. Only show
    // its compact list in attention/focused inbox lenses; the portfolio keeps
    // the map clear and exposes the count in the header instead.
    const showInbox = this.mapLens === "attention" || this.mapLens === "inbox";
    const compactInbox = showInbox && visibleUnassigned.length > 0 && map.height >= 9;
    const compactInboxHeight = compactInbox
      ? this.compactInboxHeight(map, projection.unassigned.length)
      : 0;
    const inboxOffset = compactInbox ? compactInboxHeight + 1 : 0;
    const mapSurface = compactInbox
      ? {
          ...map,
          y: map.y + compactInboxHeight + 1,
          height: Math.max(1, map.height - inboxOffset),
        }
      : {
          ...map,
          height: Math.max(1, map.height),
        };
    this.mapSurface = mapSurface;
    const baseScale = {
      x: clamp(mapSurface.width / 150, 0.38, 0.85),
      y: clamp(mapSurface.height / 70, 0.22, 0.52),
    };
    const goals =
      this.mapLens === "goal" && focusGoal
        ? [focusGoal]
        : this.mapLens === "inbox"
          ? []
          : projection.goals;
    const pendingLaunch = this.pendingLaunchPlacement(projection, goals);
    const mapPoints = [
      ...goals.flatMap((goal) => [
        goal.mapPosition,
        ...visibleAgents(goal).map((agent) => agent.mapPosition),
      ]),
      ...(showInbox && visibleUnassigned.length > 0 && !compactInbox
        ? [projection.inboxPosition, ...visibleUnassigned.map((agent) => agent.mapPosition)]
        : []),
      ...(pendingLaunch ? [pendingLaunch.position] : []),
    ];
    if (this.mapFitPending && mapPoints.length > 0) {
      const fit = fitViewportToPoints(
        mapPoints,
        mapSurface,
        baseScale,
        MAP_FIT_PADDING_X,
        MAP_FIT_PADDING_Y,
      );
      this.mapCenter = fit.center;
      this.mapZoom = fit.zoom;
      this.mapFitPending = false;
    }
    this.mapScaleX = baseScale.x * this.mapZoom;
    this.mapScaleY = baseScale.y * this.mapZoom;
    const title =
      this.mapLens === "goal" && focusGoal
        ? `FOCUS · ${focusGoal.title} · ${countLabel(focusGoal.agents.length, "satellite")}`
        : focusInbox
          ? `FOCUS · INBOX · ${countLabel(projection.unassigned.length, "agent")}`
          : attentionLens
            ? `ATTENTION LENS · ${projection.counts.attention} current · ${projection.counts.uncertainty} uncertain`
            : `UNIVERSE MAP · ${countLabel(projection.goals.length, "goal body", "goal bodies")} · ${countLabel(projection.counts.agents, "agent")} · ${projection.counts.unassigned} inbox`;
    this.text(
      buffer,
      shorten(title, Math.max(1, rect.width - 14)),
      rect.x + 2,
      rect.y,
      COLORS.cyan,
      COLORS.background,
      TextAttributes.BOLD,
    );
    this.textRight(
      buffer,
      `${this.mapLens} · labels ${this.semanticZoom} · ${Math.round(this.mapZoom * 100)}%`,
      rect.x + rect.width - 2,
      rect.y,
      COLORS.faint,
      COLORS.background,
    );
    const worldToScreen = (point: MapPosition): MapPosition =>
      screenPointForWorld(point, { center: this.mapCenter, zoom: this.mapZoom }, mapSurface, {
        x: this.mapScaleX,
        y: this.mapScaleY,
      });

    for (let x = mapSurface.x + 4; x < mapSurface.x + mapSurface.width - 1; x += 12) {
      for (let y = mapSurface.y + 2; y < mapSurface.y + mapSurface.height - 1; y += 4)
        this.cell(buffer, x, y, "·", COLORS.faint, COLORS.background);
    }

    if (goals.length === 0 && visibleUnassigned.length === 0 && !pendingLaunch) {
      this.text(
        buffer,
        "No goals or live agents yet — n creates a goal · N launches an agent.",
        map.x + 2,
        map.y + Math.floor(map.height / 2),
        COLORS.muted,
        COLORS.background,
      );
      return;
    }

    if (goals.length === 0 && visibleUnassigned.length > 0 && this.mapLens !== "inbox") {
      this.text(
        buffer,
        "Create a goal with n, then press a to assign agents from the inbox.",
        mapSurface.x + 2,
        mapSurface.y + Math.floor(mapSurface.height / 2),
        COLORS.muted,
        COLORS.background,
      );
    }

    for (const goal of goals) {
      const goalPoint = worldToScreen(goal.mapPosition);
      for (const agent of visibleAgents(goal)) {
        const agentPoint = worldToScreen(agent.mapPosition);
        this.drawMapLink(buffer, goalPoint, agentPoint, mapSurface, goal, agent);
      }
    }
    if (pendingLaunch?.goal) {
      this.drawMapPendingLink(
        buffer,
        worldToScreen(pendingLaunch.goal.mapPosition),
        worldToScreen(pendingLaunch.position),
        mapSurface,
      );
    }
    if (compactInbox) {
      this.withDrawClip(map, () =>
        this.drawCompactInbox(buffer, map, visibleUnassigned, attentionLens),
      );
    } else if (showInbox && visibleUnassigned.length > 0) {
      const inboxPoint = worldToScreen(projection.inboxPosition);
      for (const agent of visibleUnassigned)
        this.drawMapLink(
          buffer,
          inboxPoint,
          worldToScreen(agent.mapPosition),
          mapSurface,
          undefined,
          agent,
        );
      this.withDrawClip(mapSurface, () =>
        this.drawMapInboxBody(buffer, map, inboxPoint, visibleUnassigned),
      );
    }
    this.withDrawClip(mapSurface, () => {
      for (const goal of goals) {
        for (const agent of visibleAgents(goal))
          if (!(this.selected?.type === "agent" && this.selected.id === agent.id))
            this.drawMapAgent(buffer, mapSurface, worldToScreen(agent.mapPosition), goal, agent);
      }
      if (showInbox && !compactInbox)
        for (const agent of visibleUnassigned)
          if (!(this.selected?.type === "agent" && this.selected.id === agent.id))
            this.drawMapAgent(
              buffer,
              mapSurface,
              worldToScreen(agent.mapPosition),
              undefined,
              agent,
            );
      for (const goal of goals)
        if (!(this.selected?.type === "goal" && this.selected.id === goal.id))
          this.drawMapGoal(
            buffer,
            mapSurface,
            worldToScreen(goal.mapPosition),
            goal,
            attentionLens,
          );

      if (pendingLaunch)
        this.drawMapPendingLaunch(
          buffer,
          mapSurface,
          worldToScreen(pendingLaunch.position),
          pendingLaunch.pending,
        );

      // Selection is the active decision point. Draw it after the rest of the
      // topology so an overlapping body cannot visually or interactively hide
      // the item the user is currently inspecting.
      if (this.selected?.type === "agent") {
        for (const goal of goals) {
          const agent = visibleAgents(goal).find((candidate) => candidate.id === this.selected?.id);
          if (agent)
            this.drawMapAgent(buffer, mapSurface, worldToScreen(agent.mapPosition), goal, agent);
        }
        if (showInbox && !compactInbox) {
          const agent = visibleUnassigned.find((candidate) => candidate.id === this.selected?.id);
          if (agent)
            this.drawMapAgent(
              buffer,
              mapSurface,
              worldToScreen(agent.mapPosition),
              undefined,
              agent,
            );
        }
      } else if (this.selected?.type === "goal") {
        const goal = goals.find((candidate) => candidate.id === this.selected?.id);
        if (goal)
          this.drawMapGoal(
            buffer,
            mapSurface,
            worldToScreen(goal.mapPosition),
            goal,
            attentionLens,
          );
      }
    });

    if (attentionLens && projection.counts.attention === 0 && projection.counts.uncertainty === 0)
      this.text(
        buffer,
        "No current attention — press A to return to the portfolio map.",
        map.x + 2,
        map.y + 1,
        COLORS.muted,
        COLORS.background,
      );

    if (this.mapLens === "goal" && focusGoal && projection.goals.length > 1) {
      this.text(
        buffer,
        "f portfolio · 0 reset view · attention badges remain global",
        map.x + 2,
        map.y + map.height - 2,
        COLORS.faint,
        COLORS.background,
      );
    } else if (this.mapLens === "inbox") {
      this.text(
        buffer,
        "f portfolio · 0 reset view · t/Enter terminal · selected agent opens directly",
        map.x + 2,
        map.y + map.height - 2,
        COLORS.faint,
        COLORS.background,
      );
    } else if (attentionLens) {
      this.text(
        buffer,
        "A portfolio · g jump to next attention · z label detail",
        map.x + 2,
        map.y + map.height - 2,
        COLORS.faint,
        COLORS.background,
      );
    }
  }

  private drawMapLink(
    buffer: OptimizedBuffer,
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
    map: Rect,
    goal: MapGoalView | undefined,
    agent: MapAgentView,
    accent?: RGBA,
  ): void {
    const x1 = Math.round(to.x);
    const y1 = Math.round(to.y);
    let x0 = Math.round(from.x);
    let y0 = Math.round(from.y);
    if (x0 === x1 && y0 === y1) return;
    const selected = this.selected?.type === "agent" && this.selected.id === agent.id;
    const recentlyDone = this.agentRecentlyDone(agent);
    const linkColor = agent.attention
      ? agent.attention.requiresHumanInput
        ? agent.runtimeState === "blocked"
          ? COLORS.red
          : COLORS.orange
        : COLORS.yellow
      : selected
        ? COLORS.selected
        : recentlyDone
          ? COLORS.green
          : (accent ?? (goal ? this.goalFamilyColor(goal.id) : COLORS.connector));
    // A circular mark carries no directional bias. Bresenham keeps the
    // diagonal continuous on the terminal grid without the duplicate-cell
    // gaps produced by interpolating and rounding every step.
    const glyph = "•";
    const paint = (x: number, y: number): void => {
      if (x >= map.x && x < map.x + map.width && y >= map.y && y < map.y + map.height)
        this.cell(buffer, x, y, glyph, linkColor, COLORS.background);
    };
    const deltaX = Math.abs(x1 - x0);
    const stepX = x0 < x1 ? 1 : -1;
    const deltaY = -Math.abs(y1 - y0);
    const stepY = y0 < y1 ? 1 : -1;
    let error = deltaX + deltaY;
    let pathStep = 0;
    while (true) {
      if (agent.attention || selected || pathStep % 2 === 0) paint(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= deltaY) {
        error += deltaY;
        x0 += stepX;
      }
      if (twice <= deltaX) {
        error += deltaX;
        y0 += stepY;
      }
      pathStep += 1;
    }
  }

  private drawMapPendingLink(
    buffer: OptimizedBuffer,
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
    map: Rect,
  ): void {
    const x1 = Math.round(to.x);
    const y1 = Math.round(to.y);
    let x0 = Math.round(from.x);
    let y0 = Math.round(from.y);
    if (x0 === x1 && y0 === y1) return;
    const linkColor = Math.sin(this.animationPhase * Math.PI * 2) > 0 ? COLORS.green : COLORS.cyan;
    const paint = (x: number, y: number): void => {
      if (x >= map.x && x < map.x + map.width && y >= map.y && y < map.y + map.height)
        this.cell(buffer, x, y, "·", linkColor, COLORS.background);
    };
    const deltaX = Math.abs(x1 - x0);
    const stepX = x0 < x1 ? 1 : -1;
    const deltaY = -Math.abs(y1 - y0);
    const stepY = y0 < y1 ? 1 : -1;
    let error = deltaX + deltaY;
    let pathStep = 0;
    while (true) {
      if (pathStep % 2 === 0) paint(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= deltaY) {
        error += deltaY;
        x0 += stepX;
      }
      if (twice <= deltaX) {
        error += deltaX;
        y0 += stepY;
      }
      pathStep += 1;
    }
  }

  private drawMapPendingLaunch(
    buffer: OptimizedBuffer,
    map: Rect,
    point: { readonly x: number; readonly y: number },
    pending: PendingLaunch,
  ): void {
    const nodeScale = perspectiveNodeScale(this.mapZoom);
    const glyphs = ["◐", "◓", "◑", "◒"] as const;
    const glyph = glyphs[Math.floor(this.animationPhase * 2) % glyphs.length] ?? "◐";
    const title = `${glyph} ${shorten(pending.displayName, this.renderer.width < 100 ? 14 : 22)}`;
    const status = `launching · ${shorten(pending.agentKind, this.renderer.width < 100 ? 12 : 18)}`;
    const contentWidth = Math.max(title.length, status.length);
    const maxRadiusX = this.renderer.width < 100 ? 12 : 18;
    const radiusX = clamp(
      Math.round((Math.ceil(contentWidth / 2) + 1) * nodeScale),
      5,
      Math.max(5, Math.round(maxRadiusX * nodeScale)),
    );
    const radiusY = clamp(Math.round(2 * nodeScale), 2, 3);
    const bounds = {
      x: point.x - radiusX,
      y: point.y - radiusY,
      width: radiusX * 2 + 1,
      height: radiusY * 2 + 1,
    };
    if (
      point.x < map.x - radiusX ||
      point.x >= map.x + map.width + radiusX ||
      point.y < map.y - radiusY ||
      point.y >= map.y + map.height + radiusY
    )
      return;
    const pulse = Math.sin(this.animationPhase * Math.PI * 2) > 0;
    const border = pulse ? COLORS.green : COLORS.cyan;
    this.roundedPanel(buffer, bounds, COLORS.panelRaised, border);
    this.textCentered(
      buffer,
      title,
      point.x,
      point.y - 1,
      COLORS.white,
      COLORS.panelRaised,
      TextAttributes.BOLD,
    );
    this.textCentered(buffer, status, point.x, point.y + 1, COLORS.green, COLORS.panelRaised);
  }

  private drawMapInboxBody(
    buffer: OptimizedBuffer,
    map: Rect,
    point: { readonly x: number; readonly y: number },
    agents: readonly MapAgentView[],
  ): void {
    const scale = perspectiveNodeScale(this.mapZoom);
    const width = Math.max(9, Math.round(13 * scale));
    const height = Math.max(3, Math.round(5 * scale));
    const bounds = {
      x: point.x - Math.floor(width / 2),
      y: point.y - Math.floor(height / 2),
      width,
      height,
    };
    if (
      bounds.x < map.x ||
      bounds.x + bounds.width > map.x + map.width ||
      bounds.y < map.y ||
      bounds.y + bounds.height > map.y + map.height
    )
      return;
    this.roundedPanel(buffer, bounds, COLORS.panel, COLORS.yellow);
    this.hitTargets.push({
      type: "inbox",
      id: "inbox",
      x: point.x,
      y: point.y,
      radiusX: Math.ceil(width / 2),
      radiusY: Math.ceil(height / 2),
      bounds,
    });
    this.cell(
      buffer,
      point.x,
      point.y - Math.max(1, Math.floor(height / 2) - 1),
      "◇",
      COLORS.yellow,
      COLORS.panel,
    );
    this.textCentered(
      buffer,
      "INBOX",
      point.x,
      point.y,
      COLORS.yellow,
      COLORS.panel,
      TextAttributes.BOLD,
    );
    this.textCentered(buffer, `${agents.length}`, point.x, point.y + 1, COLORS.muted, COLORS.panel);
  }

  private drawCompactInbox(
    buffer: OptimizedBuffer,
    map: Rect,
    agents: readonly MapAgentView[],
    attentionLens = false,
  ): void {
    const columns = map.width >= 72 ? 3 : map.width >= 50 ? 2 : 1;
    const columnWidth = Math.max(12, Math.floor((map.width - 6) / columns));
    const panel = {
      x: map.x + 1,
      y: map.y + 1,
      width: Math.min(map.width - 2, columns * columnWidth + 2),
      height: this.compactInboxHeight(map, agents.length),
    };
    if (panel.width < 8 || panel.height < 3) return;
    this.panel(buffer, panel, COLORS.panel, COLORS.border);
    // Reserve the header row for the neutral inbox lens. Agent rows below
    // it retain their own hit targets and remain directly selectable.
    this.hitTargets.push({
      type: "inbox",
      id: "inbox",
      x: panel.x + Math.floor(panel.width / 2),
      y: panel.y,
      radiusX: Math.max(3, Math.floor(panel.width / 2)),
      radiusY: 1,
      bounds: { x: panel.x, y: panel.y, width: panel.width, height: 1 },
    });
    this.text(
      buffer,
      attentionLens ? `INBOX · ${agents.length} attention` : `INBOX · ${agents.length} unassigned`,
      panel.x + 2,
      panel.y,
      COLORS.yellow,
      COLORS.panel,
      TextAttributes.BOLD,
    );
    const visibleRows = Math.max(0, panel.height - 2);
    for (const [index, agent] of agents.entries()) {
      const column = Math.floor(index / Math.max(1, visibleRows));
      const row = index % Math.max(1, visibleRows);
      if (column >= columns) break;
      const x = panel.x + 2 + column * columnWidth;
      const y = panel.y + 1 + row;
      const selected = this.selected?.type === "agent" && this.selected.id === agent.id;
      const recentlyDone = this.agentRecentlyDone(agent);
      const glyph = statusGlyph(agent, this.animationPhase);
      const label = `${glyph === " " ? "·" : glyph} ${shorten(agent.displayName, columnWidth - (recentlyDone ? 12 : 4))}${recentlyDone ? " · review" : ""}`;
      this.text(
        buffer,
        label,
        x,
        y,
        selected ? COLORS.white : statusColor(agent, recentlyDone),
        COLORS.panel,
        selected ? TextAttributes.BOLD : TextAttributes.NONE,
      );
      this.hitTargets.push({
        type: "agent",
        id: agent.id,
        x: x + Math.floor(Math.min(columnWidth - 1, label.length) / 2),
        y,
        radiusX: Math.max(2, Math.floor(columnWidth / 2)),
        radiusY: 1,
      });
    }
  }

  private compactInboxHeight(map: Rect, agentCount: number): number {
    const columns = map.width >= 72 ? 3 : map.width >= 50 ? 2 : 1;
    const rows = Math.ceil(agentCount / columns);
    return Math.min(rows + 2, Math.max(3, map.height - 6));
  }

  private drawMapGoal(
    buffer: OptimizedBuffer,
    map: Rect,
    point: { readonly x: number; readonly y: number },
    goal: MapGoalView,
    attentionLens = false,
  ): void {
    const selected = this.selected?.type === "goal" && this.selected.id === goal.id;
    const selectedAgent =
      this.selected?.type === "agent" &&
      goal.agents.some((agent) => agent.id === this.selected?.id);
    const goalAttention = goal.attentionCount > 0 || goal.staleCount > 0;
    const compact =
      this.semanticZoom === "overview" &&
      this.mapZoom < MAP_LABEL_ZOOM_THRESHOLD &&
      !selected &&
      !selectedAgent &&
      !goalAttention;
    if (compact) {
      const bounds = {
        x: point.x - 2,
        y: point.y - 1,
        width: 5,
        height: 3,
      };
      if (
        point.x < map.x - 2 ||
        point.x >= map.x + map.width + 2 ||
        point.y < map.y - 1 ||
        point.y >= map.y + map.height + 1
      )
        return;
      const border = this.priorityColor(goal.priority);
      this.roundedPanel(buffer, bounds, COLORS.background, border);
      this.cell(buffer, point.x, point.y, "◎", border, COLORS.background);
      this.textCentered(buffer, goal.priority, point.x, point.y + 1, border, COLORS.background);
      this.hitTargets.push({
        type: "goal",
        id: goal.id,
        x: point.x,
        y: point.y,
        radiusX: 3,
        radiusY: 2,
        bounds,
      });
      return;
    }
    const emphasis = selected || selectedAgent || goalAttention;
    const level = semanticZoomLevel({
      lens: this.mapLens,
      preference: this.semanticZoom,
      selected,
      attention: goalAttention,
    });
    const zoom = clamp(this.mapZoom, 0.65, 2.2);
    const nodeScale = perspectiveNodeScale(zoom);
    const titleBudget = Math.min(
      goalLabelBudget(level, this.renderer.width),
      Math.max(10, Math.floor(this.mapScaleX * (level === "detail" ? 48 : 40) * nodeScale)),
    );
    const fullTitle = `${goal.priority} ${goal.title}`;
    const titleLines =
      level === "detail"
        ? selected
          ? wrapFully(fullTitle, Math.max(8, titleBudget - 2))
          : wrap(fullTitle, Math.max(8, titleBudget - 2)).slice(0, 2)
        : [shorten(fullTitle, titleBudget)];
    const titleRadius = Math.ceil(Math.max(...titleLines.map((line) => line.length), 1) / 2) + 1;
    const loadRadius = Math.round(goal.radiusX * 0.86);
    const radiusX = clamp(
      Math.round(Math.max(loadRadius, titleRadius) * nodeScale),
      5,
      this.renderer.width < 100
        ? level === "detail"
          ? 18
          : emphasis
            ? 12
            : 10
        : level === "detail"
          ? 24
          : emphasis
            ? 18
            : 16,
    );
    const radiusY = clamp(
      Math.max(
        Math.round(
          Math.max(goal.radiusY * 0.92, titleLines.length + (level === "detail" ? 1 : 0)) *
            nodeScale,
        ),
      ),
      2,
      5,
    );
    const bounds = {
      x: point.x - radiusX,
      y: point.y - radiusY,
      width: radiusX * 2 + 1,
      height: radiusY * 2 + 1,
    };
    const family = this.goalFamilyColor(goal.id);
    const muted = attentionLens && !emphasis && !goalAttention;
    const border = selected
      ? COLORS.white
      : selectedAgent
        ? COLORS.cyan
        : goal.attentionCount > 0
          ? COLORS.orange
          : goal.staleCount > 0
            ? COLORS.yellow
            : muted
              ? COLORS.faint
              : this.priorityColor(goal.priority);
    const background =
      muted || goal.status === "completed" ? COLORS.background : COLORS.panelRaised;
    this.roundedPanel(buffer, bounds, background, border);
    this.hitTargets.push({
      type: "goal",
      id: goal.id,
      x: point.x,
      y: point.y,
      radiusX: radiusX + 1,
      radiusY: radiusY + 1,
      bounds,
    });

    const coreColor = muted
      ? COLORS.faint
      : goal.status === "completed"
        ? COLORS.completed
        : family;
    this.cell(buffer, point.x, point.y - radiusY + 1, "◎", coreColor, background);
    const titleY = titleLines.length > 1 ? point.y - Math.ceil(titleLines.length / 2) : point.y;
    for (const [index, title] of titleLines.entries())
      this.textCentered(
        buffer,
        selected ? title : shorten(title, Math.max(3, radiusX * 2 - 2)),
        point.x,
        titleY + index,
        muted ? COLORS.faint : selected ? COLORS.white : COLORS.text,
        background,
        TextAttributes.BOLD,
      );
    if (radiusY >= 3) {
      const details = [
        ...(level === "detail" ? [goal.status] : []),
        `${goal.agents.length}s`,
        ...(goal.attentionCount > 0 ? [`!${goal.attentionCount}`] : []),
        ...(goal.staleCount > 0 ? [`?${goal.staleCount}`] : []),
      ].join("  ");
      this.textCentered(
        buffer,
        shorten(details, Math.max(3, radiusX * 2 - 2)),
        point.x,
        Math.min(point.y + radiusY - 1, titleY + titleLines.length),
        goal.attentionCount > 0
          ? COLORS.orange
          : goal.staleCount > 0
            ? COLORS.yellow
            : muted
              ? COLORS.faint
              : COLORS.muted,
        background,
      );
    }
    if (goal.attentionCount > 0) {
      this.cell(
        buffer,
        bounds.x + bounds.width - 1,
        bounds.y,
        "!",
        COLORS.red,
        background,
        TextAttributes.BOLD,
      );
    }
    if (goal.staleCount > 0)
      this.cell(buffer, bounds.x, bounds.y, "?", COLORS.yellow, background, TextAttributes.BOLD);
    if (goal.status === "completed")
      this.cell(
        buffer,
        bounds.x + bounds.width - 1,
        bounds.y + bounds.height - 1,
        "✓",
        COLORS.completed,
        background,
      );
  }

  private drawMapAgent(
    buffer: OptimizedBuffer,
    map: Rect,
    point: { readonly x: number; readonly y: number },
    goal: MapGoalView | undefined,
    agent: MapAgentView,
    options: MapAgentRenderOptions = {},
  ): void {
    const selected = this.selected?.type === "agent" && this.selected.id === agent.id;
    const inboxAgent = options.kind === "inbox" || (goal === undefined && !options.kind);
    const attention = agent.attention !== undefined;
    const recentlyDone = this.agentRecentlyDone(agent);
    const denseGoalFocus =
      !inboxAgent &&
      this.mapLens === "goal" &&
      (goal?.agents.length ?? 0) >= DENSE_FOCUS_AGENT_THRESHOLD;
    const compact =
      this.semanticZoom === "overview" &&
      !selected &&
      !attention &&
      !recentlyDone &&
      (this.mapZoom < MAP_LABEL_ZOOM_THRESHOLD ||
        (denseGoalFocus && this.mapZoom < DENSE_FOCUS_COMPACT_ZOOM));
    if (compact) {
      if (
        point.x < map.x - 1 ||
        point.x >= map.x + map.width + 1 ||
        point.y < map.y - 1 ||
        point.y >= map.y + map.height + 1
      )
        return;
      const marker = statusGlyph(agent, this.animationPhase);
      const markerColor = statusColor(agent, recentlyDone);
      const bounds = { x: point.x - 1, y: point.y - 1, width: 3, height: 3 };
      this.roundedPanel(buffer, bounds, COLORS.background, markerColor);
      this.cell(buffer, point.x, point.y, marker, markerColor, COLORS.background);
      this.hitTargets.push({
        type: "agent",
        id: agent.id,
        x: point.x,
        y: point.y,
        radiusX: 2,
        radiusY: 2,
        bounds,
      });
      return;
    }
    const level = semanticZoomLevel({
      lens: this.mapLens,
      preference: this.semanticZoom,
      selected,
      attention: attention || recentlyDone,
    });
    const nodeScale = perspectiveNodeScale(this.mapZoom);
    const labelWidth = Math.max(
      8,
      Math.floor(agentLabelBudget(level, this.renderer.width, inboxAgent) * nodeScale),
    );
    const marker = statusGlyph(agent, this.animationPhase);
    const titleLines =
      level === "detail"
        ? selected
          ? wrapFully(agent.displayName, Math.max(8, labelWidth - 2))
          : wrap(agent.displayName, Math.max(8, labelWidth - 2)).slice(0, 2)
        : [shorten(agent.displayName, Math.max(3, labelWidth - 2))];
    const labelLines = titleLines.map((title, index) =>
      index === 0 ? `${marker} ${title}` : title,
    );
    if (level === "detail" || recentlyDone)
      labelLines.push(
        recentlyDone
          ? `done ${formatAge(Math.max(0, this.options.clock.now() - agent.lastChangedAt))} · review`
          : agent.attention
            ? `${agent.attention.reason} ${formatAge(agent.attention.ageMs)}`
            : `${agent.runtimeState} · ${agent.provider ?? agent.hostKind}`,
      );
    const contentWidth = Math.max(3, ...labelLines.map((line) => line.length));
    const maxRadiusX =
      this.renderer.width < 100
        ? level === "detail"
          ? 15
          : attention || recentlyDone || selected
            ? 10
            : 6
        : level === "detail"
          ? 22
          : attention || recentlyDone || selected
            ? inboxAgent
              ? 16
              : 15
            : inboxAgent
              ? 12
              : 11;
    const radiusX = clamp(
      Math.round((Math.ceil(contentWidth / 2) + 1) * nodeScale),
      3,
      Math.max(3, Math.round(maxRadiusX * nodeScale)),
    );
    const radiusY =
      level === "detail" || recentlyDone
        ? clamp(Math.round((Math.ceil(labelLines.length / 2) + 1) * nodeScale), 2, 7)
        : 1;
    const bounds = {
      x: point.x - radiusX,
      y: point.y - radiusY,
      width: radiusX * 2 + 1,
      height: radiusY * 2 + 1,
    };
    if (
      point.x < map.x - radiusX ||
      point.x >= map.x + map.width + radiusX ||
      point.y < map.y - radiusY ||
      point.y >= map.y + map.height + radiusY
    )
      return;
    const background = selected || recentlyDone ? COLORS.panelRaised : COLORS.background;
    const working = agent.hostHealth === "live" && agent.runtimeState === "working";
    const workingPulse = Math.sin(this.animationPhase * Math.PI * 2) > 0;
    const border = selected
      ? COLORS.white
      : agent.attention
        ? statusColor(agent, recentlyDone)
        : recentlyDone
          ? COLORS.green
          : working
            ? workingPulse
              ? COLORS.green
              : COLORS.faint
            : (options.accent ?? (goal ? this.goalFamilyColor(goal.id) : COLORS.yellow));
    this.roundedPanel(buffer, bounds, background, border);
    const firstLineY = point.y - Math.floor(labelLines.length / 2);
    for (const [index, line] of labelLines.entries())
      this.textCentered(
        buffer,
        line,
        point.x,
        firstLineY + index,
        index === labelLines.length - 1 && (agent.attention || recentlyDone)
          ? statusColor(agent, recentlyDone)
          : selected
            ? COLORS.white
            : statusColor(agent, recentlyDone),
        background,
        selected ? TextAttributes.BOLD : TextAttributes.NONE,
      );
    this.hitTargets.push({
      type: "agent",
      id: agent.id,
      x: point.x,
      y: point.y,
      radiusX: radiusX + 1,
      radiusY: radiusY + 1,
      bounds,
    });
  }

  private drawFloatingInspector(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: InspectorProjection,
    anchor: MapHitTarget | undefined,
    mapObstacles: readonly Rect[] = [],
  ): void {
    const inboxCard =
      projection.kind === "empty-inspector" && !this.selected && this.mapLens === "inbox";
    if (projection.kind === "empty-inspector" && !this.selected && !inboxCard) return;
    if (rect.width < 20 || rect.height < 6) return;

    const title = inboxCard
      ? `INBOX · ${this.mapProjection().unassigned.length} unassigned`
      : projection.kind === "goal-inspector"
        ? `GOAL · ${projection.goal.title}`
        : projection.kind === "agent-inspector"
          ? `AGENT · ${projection.agent.displayName}`
          : "INSPECTOR";
    const denseFocus = this.focusedGoalAgentCount() >= DENSE_FOCUS_AGENT_THRESHOLD;
    const minimumWidth = inboxCard
      ? 34
      : projection.kind === "agent-inspector"
        ? denseFocus
          ? 38
          : 46
        : 38;
    const maximumWidth = inboxCard
      ? 34
      : projection.kind === "agent-inspector"
        ? denseFocus
          ? 48
          : 64
        : 52;
    const width = Math.min(
      rect.width - 2,
      Math.min(maximumWidth, Math.max(minimumWidth, title.length + 4)),
    );
    const contentWidth = Math.max(1, width - 4);
    const titleLines = wrapFully(title, contentWidth);
    const wrappedLines = projection.lines.flatMap((line) => wrap(line, contentWidth));
    const maxHeight = Math.min(denseFocus ? 12 : 15, rect.height - 2);
    const visibleLines = wrappedLines.slice(0, Math.max(0, maxHeight - titleLines.length - 2));
    const height = Math.min(maxHeight, Math.max(4, titleLines.length + visibleLines.length + 2));
    const panel = placeFloatingInspector(rect, { width, height }, anchor, mapObstacles);
    this.floatingInspectorRect = panel;
    const border = inboxCard
      ? COLORS.yellow
      : projection.kind === "agent-inspector"
        ? statusColor(projection.agent, this.agentRecentlyDone(projection.agent))
        : COLORS.borderStrong;
    this.roundedPanel(buffer, panel, COLORS.panelRaised, border);
    let y = panel.y + 1;
    for (const line of titleLines) {
      if (y >= panel.y + panel.height - 2) break;
      this.text(
        buffer,
        line,
        panel.x + 2,
        y - 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      y += 1;
    }
    for (const line of visibleLines) {
      if (y >= panel.y + panel.height - 2) break;
      this.text(
        buffer,
        line,
        panel.x + 2,
        y,
        line.startsWith("why") || line.startsWith("waiting") ? COLORS.orange : COLORS.muted,
        COLORS.panelRaised,
      );
      y += 1;
    }
    this.text(
      buffer,
      inboxCard
        ? "i close · j/k select"
        : projection.kind === "agent-inspector"
          ? "i close · t terminal · y linked · o native"
          : "i close · f focus",
      panel.x + 2,
      panel.y + panel.height - 1,
      COLORS.faint,
      COLORS.panelRaised,
    );
  }

  private focusedGoalAgentCount(): number {
    if (this.viewMode !== "map" || this.mapLens !== "goal" || !this.focusGoalId) return 0;
    return (
      this.mapProjection().goals.find((goal) => goal.id === this.focusGoalId)?.agents.length ?? 0
    );
  }

  private agentRecentlyDone(
    agent: Pick<AgentView, "runtimeState" | "hostHealth" | "lastChangedAt">,
  ): boolean {
    return isRecentlyDone(agent, this.options.clock.now());
  }

  private drawList(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: CommandCentreProjection,
    rows: readonly Row[],
  ): void {
    this.panel(buffer, rect, COLORS.background, COLORS.border);
    if (rect.width < 4 || rect.height < 2) return;
    const codeContexts = this.listLens === "contexts" ? this.codeContextProjection() : undefined;
    this.text(
      buffer,
      this.listLens === "contexts" ? "CODE CONTEXTS · AGENTS" : "GOALS · DIRECT AGENTS",
      rect.x + 2,
      rect.y,
      COLORS.cyan,
      COLORS.background,
      TextAttributes.BOLD,
    );
    const usable = Math.max(0, rect.height - 2);
    const end = Math.min(rows.length, this.scrollOffset + usable);
    for (let rowIndex = this.scrollOffset; rowIndex < end; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) continue;
      const y = rect.y + 1 + rowIndex - this.scrollOffset;
      if (row.type === "context-label") {
        const context = codeContexts?.contexts.find((candidate) => candidate.key === row.id);
        if (context) this.drawCodeContextRow(buffer, rect, y, context);
        continue;
      }
      if (row.type === "inbox-label") {
        this.text(
          buffer,
          `UNASSIGNED INBOX  (${projection.unassigned.length})`,
          rect.x + 2,
          y,
          COLORS.yellow,
          COLORS.background,
          TextAttributes.BOLD,
        );
        continue;
      }
      if (row.type === "goal") {
        const goal = projection.goals.find((candidate) => candidate.id === row.id);
        if (goal) this.drawGoalRow(buffer, rect, y, goal);
      } else {
        const agent = this.findAgent(projection, row.id);
        if (agent) this.drawAgentRow(buffer, rect, y, agent);
      }
    }
    if (rows.length > usable) {
      this.textRight(
        buffer,
        `${this.scrollOffset + 1}-${Math.min(rows.length, this.scrollOffset + usable)}/${rows.length}`,
        rect.x + rect.width - 2,
        rect.y,
        COLORS.faint,
        COLORS.background,
      );
    }
  }

  private drawCodeContextRow(
    buffer: OptimizedBuffer,
    rect: Rect,
    y: number,
    context: CodeContextView,
  ): void {
    const marker = context.attentionCount > 0 ? "!" : context.staleCount > 0 ? "?" : "·";
    const source = context.source === "unknown" ? "unknown source" : context.source;
    const value = `${marker} ${context.label} · ${countLabel(context.agents.length, "agent")}${context.worktreeCount > 0 ? ` · ${countLabel(context.worktreeCount, "worktree")}` : ""}${context.attentionCount > 0 ? ` · !${context.attentionCount}` : ""}${context.staleCount > 0 ? ` · ?${context.staleCount}` : ""} · ${source}`;
    const foreground =
      context.attentionCount > 0
        ? COLORS.orange
        : context.staleCount > 0
          ? COLORS.yellow
          : COLORS.cyan;
    this.text(
      buffer,
      shorten(value, Math.max(1, rect.width - 4)),
      rect.x + 2,
      y,
      foreground,
      COLORS.background,
      TextAttributes.BOLD,
    );
  }

  private drawGoalRow(buffer: OptimizedBuffer, rect: Rect, y: number, goal: GoalView): void {
    const selected = this.selected?.type === "goal" && this.selected.id === goal.id;
    const marker = selected ? ">" : " ";
    const expand = this.expandedGoals.has(goal.id) ? "▾" : "▸";
    const attention =
      goal.attentionCount > 0
        ? ` !${goal.attentionCount}`
        : goal.staleCount > 0
          ? ` ?${goal.staleCount}`
          : "";
    const lifecycle =
      goal.status === "completed" ? " done" : goal.status === "archived" ? " archived" : "";
    const value = `${marker}${expand} [${goal.priority}] ${goal.title}${attention}${lifecycle}`;
    const foreground = selected
      ? COLORS.selected
      : goal.status === "completed"
        ? COLORS.completed
        : COLORS.text;
    this.text(
      buffer,
      shorten(value, Math.max(1, rect.width - 4)),
      rect.x + 2,
      y,
      foreground,
      COLORS.background,
      selected ? TextAttributes.BOLD : TextAttributes.NONE,
    );
  }

  private drawAgentRow(buffer: OptimizedBuffer, rect: Rect, y: number, agent: AgentView): void {
    const selected = this.selected?.type === "agent" && this.selected.id === agent.id;
    const prefix = selected ? "  >" : "   ";
    const goal = agent.goalTitle ? "↳" : "·";
    const recentlyDone = this.agentRecentlyDone(agent);
    const review = recentlyDone ? " · review" : "";
    const contextDetail =
      this.listLens === "contexts"
        ? ` · ${agent.branch ?? "branch unknown"}${agent.worktree ? ` · ${agent.worktree.replace(/\\/gu, "/").split("/").at(-1) ?? "worktree"}` : " · worktree unknown"}`
        : "";
    const label = `${prefix}${goal} [${statusGlyph(agent, this.animationPhase)}] ${agent.displayName} · ${agent.runtimeState}${agent.hostHealth === "live" ? "" : `/${agent.hostHealth}`}${contextDetail}${review}`;
    const foreground = selected ? COLORS.selected : statusColor(agent, recentlyDone);
    this.text(
      buffer,
      shorten(label, Math.max(1, rect.width - 4)),
      rect.x + 2,
      y,
      foreground,
      COLORS.background,
      selected ? TextAttributes.BOLD : TextAttributes.NONE,
    );
  }

  private drawFooter(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: CommandCentreProjection,
  ): void {
    this.panel(buffer, rect, COLORS.background, COLORS.border);
    if (rect.height < 2) return;
    if (this.terminalMode || this.linkedExecutionTerminal) {
      const focusedTerminal =
        this.focusedSurface === "linkedExecution"
          ? this.linkedExecutionTerminal
          : this.terminalMode;
      const status = focusedTerminal?.status ?? "surface ready";
      this.text(
        buffer,
        shorten(
          "Tab focus · Ctrl-Shift-Y linked terminal · Ctrl-Shift-R refresh · PageUp/Down scroll · Esc close",
          Math.max(1, rect.width - 4),
        ),
        rect.x + 2,
        rect.y,
        COLORS.muted,
        COLORS.background,
      );
      this.text(
        buffer,
        shorten(status, Math.max(1, rect.width - 4)),
        rect.x + 2,
        rect.y + 1,
        focusedTerminal?.closed ? COLORS.orange : COLORS.faint,
        COLORS.background,
      );
      return;
    }
    const controls =
      this.viewMode === "map"
        ? `j/k select · drag/wheel pan/zoom · Enter focus/open · y linked · m menu · / find · v list · w ${this.mapLens === "contexts" ? "goals" : "contexts"} · q quit`
        : `j/k select · Enter focus/open · y linked · m menu · v map · w ${this.listLens === "contexts" ? "goals" : "contexts"} · / find · q quit`;
    this.text(
      buffer,
      shorten(controls, Math.max(1, rect.width - 4)),
      rect.x + 2,
      rect.y,
      COLORS.muted,
      COLORS.background,
    );
    if (rect.height > 1) {
      const detail = `${this.busy ? "working" : "live"} · ${projection.counts.attention} attention · ${projection.counts.stale} stale · labels ${this.semanticZoom} · ${this.viewMode} · ${this.viewMode === "map" ? this.mapLens : this.listLens} · ${this.inspectorVisible ? "inspector" : "clean"}`;
      this.text(
        buffer,
        shorten(detail, Math.max(1, rect.width - 4)),
        rect.x + 2,
        rect.y + 1,
        this.suspended ? COLORS.orange : COLORS.faint,
        COLORS.background,
      );
    }
  }

  private contextMenuActions(
    scope: ContextMenu["scope"],
    target: Selection | undefined,
  ): readonly { readonly id: ContextActionId; readonly label: string }[] {
    if (scope === "empty")
      return [
        { id: "new-goal", label: "Create goal" },
        { id: "new-agent", label: "New agent" },
        { id: "attention", label: "Attention lens" },
        { id: "list", label: "List view" },
      ];
    if (scope === "inbox")
      return [
        { id: "focus", label: "Focus inbox" },
        { id: "new-agent", label: "New agent" },
        { id: "list", label: "List view" },
      ];
    if (!target) return [];
    const projection = this.projection();
    if (target.type === "goal") {
      const goal = projection.goals.find((candidate) => candidate.id === target.id);
      return [
        { id: "focus", label: "Focus goal" },
        { id: "new-agent", label: "New agent in goal" },
        { id: "assign", label: "Assign inbox agent" },
        { id: "related", label: "Find related agents" },
        { id: "inspect", label: "Show inspector" },
        { id: "rename", label: "Rename goal" },
        { id: "description", label: "Edit description" },
        { id: "priority", label: "Cycle priority" },
        goal?.status === "completed"
          ? { id: "archive", label: "Archive goal" }
          : { id: "complete", label: "Complete goal" },
      ];
    }
    const agent = this.findAgent(projection, target.id);
    return [
      { id: "open-terminal", label: "Open terminal" },
      { id: "open-linked-execution", label: "Open linked terminal…" },
      { id: "focus", label: agent?.primaryGoalId ? "Focus containing goal" : "Focus inbox" },
      { id: "inspect", label: "Show inspector" },
      agent?.primaryGoalId
        ? { id: "unassign", label: "Unassign from goal" }
        : { id: "assign", label: "Assign to goal" },
      { id: "rename", label: "Rename agent" },
      { id: "description", label: "Edit description" },
      ...(agent && agent.hostHealth !== "live"
        ? [{ id: "archive" as const, label: "Archive stale agent" }]
        : []),
    ];
  }

  private contextMenuFrame(width: number, height: number, menu: ContextMenu): Rect {
    const menuWidth = Math.max(1, Math.min(width - 2, 48));
    const menuHeight = Math.max(1, Math.min(height - 2, menu.actions.length + 4));
    return {
      x: clamp(menu.x, 1, Math.max(1, width - menuWidth - 1)),
      y: clamp(menu.y, 1, Math.max(1, height - menuHeight - 1)),
      width: menuWidth,
      height: menuHeight,
    };
  }

  private contextTargetLabel(menu: ContextMenu, projection: CommandCentreProjection): string {
    if (menu.scope === "empty") return "universe";
    if (menu.scope === "inbox") return "inbox";
    if (!menu.target) return "selection";
    if (menu.target.type === "goal")
      return projection.goals.find((goal) => goal.id === menu.target?.id)?.title ?? "goal";
    return this.findAgent(projection, menu.target.id)?.displayName ?? "agent";
  }

  private drawContextMenu(
    buffer: OptimizedBuffer,
    width: number,
    height: number,
    projection: CommandCentreProjection,
  ): void {
    const menu = this.contextMenu;
    if (!menu) return;
    const rect = this.contextMenuFrame(width, height, menu);
    this.panel(buffer, rect, COLORS.panelRaised, COLORS.borderStrong);
    this.text(
      buffer,
      `ACTIONS · ${shorten(this.contextTargetLabel(menu, projection), rect.width - 12)}`,
      rect.x + 2,
      rect.y + 1,
      COLORS.cyan,
      COLORS.panelRaised,
      TextAttributes.BOLD,
    );
    const firstActionY = rect.y + 2;
    const footerY = rect.y + rect.height - 2;
    const visibleCount = Math.max(0, Math.min(menu.actions.length, footerY - firstActionY));
    for (const [index, action] of menu.actions.slice(0, visibleCount).entries()) {
      this.text(
        buffer,
        `${index === menu.index ? "›" : " "} ${action.label}`,
        rect.x + 2,
        firstActionY + index,
        index === menu.index ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
        index === menu.index ? TextAttributes.BOLD : TextAttributes.NONE,
      );
    }
    if (rect.height > 2)
      this.text(
        buffer,
        "j/k choose · Enter run · Esc close",
        rect.x + 2,
        footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
  }

  private openContextMenu(
    x: number,
    y: number,
    target: Selection | { readonly type: "inbox"; readonly id: "inbox" } | undefined,
  ): void {
    const selection = target?.type === "inbox" ? undefined : target;
    const scope: ContextMenu["scope"] =
      target?.type === "inbox"
        ? "inbox"
        : selection
          ? "selection"
          : this.mapLens === "inbox"
            ? "inbox"
            : "empty";
    this.contextMenu = {
      scope,
      target: selection ? { ...selection } : undefined,
      x,
      y,
      index: 0,
      actions: this.contextMenuActions(scope, selection),
    };
    this.modal = undefined;
    this.searchActive = false;
    this.destroyPickerSurface();
    this.lastAction = "action menu · choose an operation";
    this.requestRenderIfAlive();
  }

  private promoteContextTarget(menu: ContextMenu): void {
    const change = selectionChangeForContextAction(menu.scope, menu.target);
    if (change.kind === "clear") {
      this.setSelection(undefined);
      return;
    }
    if (change.kind === "select") this.setSelection(change.target);
  }

  private executeContextAction(action: ContextActionId): void {
    const menu = this.contextMenu;
    if (!menu) return;
    const target = menu.target;
    this.contextMenu = undefined;
    switch (action) {
      case "focus":
        this.promoteContextTarget(menu);
        if (menu.scope === "inbox") this.focusInbox();
        else if (target?.type === "goal") this.focusGoal(target.id);
        else if (target?.type === "agent") {
          const goal = this.selectedGoalForAgent();
          if (goal) this.focusGoal(goal.id);
          else this.focusInbox();
        }
        return;
      case "open-terminal":
        this.promoteContextTarget(menu);
        void this.openTerminalSelected();
        return;
      case "open-linked-execution":
        this.promoteContextTarget(menu);
        void this.openLinkedExecutionTerminalSelected();
        return;
      case "inspect":
        this.promoteContextTarget(menu);
        this.inspectorVisible = true;
        this.lastAction = "inspector shown";
        this.requestRenderIfAlive();
        return;
      case "new-goal":
        this.openCreateGoal();
        return;
      case "new-agent":
        this.promoteContextTarget(menu);
        this.openAgentLaunch();
        return;
      case "assign":
        this.promoteContextTarget(menu);
        this.openAssign();
        return;
      case "related":
        this.promoteContextTarget(menu);
        this.openRelatedAgents();
        return;
      case "unassign":
        this.promoteContextTarget(menu);
        this.unassign();
        return;
      case "rename":
        this.promoteContextTarget(menu);
        this.openRename();
        return;
      case "description":
        this.promoteContextTarget(menu);
        this.openDescription();
        return;
      case "priority":
        this.promoteContextTarget(menu);
        this.cyclePriority();
        return;
      case "complete":
        this.promoteContextTarget(menu);
        this.confirmGoal("complete");
        return;
      case "archive":
        this.promoteContextTarget(menu);
        if (target?.type === "agent") this.confirmArchiveAgent();
        else this.confirmGoal("archive");
        return;
      case "attention":
        this.toggleAttentionLens();
        return;
      case "list":
        this.viewMode = "list";
        this.lastAction = "list lens";
        this.requestRenderIfAlive();
        return;
      case "clear":
        this.setSelection(undefined);
        this.inspectorVisible = false;
        this.lastAction = "selection cleared";
        this.requestRenderIfAlive();
        return;
    }
  }

  private handleContextMenuKey(key: KeyEvent): void {
    const menu = this.contextMenu;
    if (!menu) return;
    key.preventDefault();
    if (key.name === "escape" || key.name === "m") {
      this.contextMenu = undefined;
      this.lastAction = "action menu closed";
      this.requestRenderIfAlive();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      this.contextMenu = { ...menu, index: Math.max(0, menu.index - 1) };
      this.requestRenderIfAlive();
      return;
    }
    if (key.name === "down" || key.name === "j") {
      this.contextMenu = {
        ...menu,
        index: Math.min(Math.max(0, menu.actions.length - 1), menu.index + 1),
      };
      this.requestRenderIfAlive();
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      const action = menu.actions[menu.index];
      if (action) this.executeContextAction(action.id);
    }
  }

  private drawOverlay(
    buffer: OptimizedBuffer,
    width: number,
    height: number,
    projection: CommandCentreProjection,
  ): void {
    if (!this.searchActive && !this.modal && this.contextMenu) {
      this.drawContextMenu(buffer, width, height, projection);
      return;
    }
    const frame = modalFrameFor(width, height, this.modal?.kind ?? "text");
    const { x, y, width: overlayWidth, height: overlayHeight } = frame;
    const rect = { x, y, width: overlayWidth, height: overlayHeight };
    this.panel(buffer, rect, COLORS.panelRaised, COLORS.borderStrong);
    if (this.searchActive) {
      this.text(
        buffer,
        "SEARCH OBSERVATORY METADATA",
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `/${inputWithCursor(this.searchQuery, this.searchCursor)}`,
        x + 2,
        y + 3,
        COLORS.white,
        COLORS.panelRaised,
      );
      const search = this.options.universe.project({
        kind: "search",
        query: this.searchQuery,
        now: this.options.clock.now(),
      });
      if (search.kind === "search") {
        this.text(
          buffer,
          `${search.results.length} matches · j/k choose · Enter accept · Esc clear`,
          x + 2,
          y + 5,
          COLORS.muted,
          COLORS.panelRaised,
        );
        const result = search.results[this.searchIndex];
        if (result)
          this.text(
            buffer,
            `> ${result.label} · ${result.context} · ${result.status}`,
            x + 2,
            y + 4,
            COLORS.yellow,
            COLORS.panelRaised,
          );
      }
      return;
    }
    const modal = this.modal;
    if (!modal) return;
    if (modal.kind === "create-goal") {
      this.text(
        buffer,
        "CREATE GOAL",
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `Title:       ${inputWithCursor(modal.title, modal.field === 0 ? this.inputCursor : modal.title.length)}`,
        x + 2,
        y + 3,
        modal.field === 0 ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `Description: ${inputWithCursor(modal.description, modal.field === 1 ? this.inputCursor : modal.description.length)}`,
        x + 2,
        y + 4,
        modal.field === 1 ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `Priority:    ${modal.priority}  (j/k or 0-3)`,
        x + 2,
        y + 5,
        modal.field === 2 ? COLORS.yellow : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        "Tab/Enter next · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "text") {
      this.text(
        buffer,
        modal.title,
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        inputWithCursor(modal.value, this.inputCursor),
        x + 2,
        y + 3,
        COLORS.white,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        "Enter save · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "goal-picker") {
      this.text(
        buffer,
        "ASSIGN AGENT TO GOAL",
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      const goals = projection.goals.filter((goal) => goal.status !== "archived");
      if (goals.length === 0)
        this.text(
          buffer,
          "Create an active goal first.",
          x + 2,
          y + 3,
          COLORS.orange,
          COLORS.panelRaised,
        );
      const visibleRows = Math.max(0, frame.footerY - (y + 3));
      const visibleStart = Math.min(
        Math.max(0, modal.index - visibleRows + 1),
        Math.max(0, goals.length - visibleRows),
      );
      const visible = goals.slice(visibleStart, visibleStart + visibleRows);
      for (const [index, goal] of visible.entries()) {
        const absoluteIndex = visibleStart + index;
        const prefix = absoluteIndex === modal.index ? ">" : " ";
        this.text(
          buffer,
          `${prefix} ${goal.priority} ${shorten(goal.title, overlayWidth - 10)}`,
          x + 2,
          y + 3 + index,
          absoluteIndex === modal.index ? COLORS.white : COLORS.muted,
          COLORS.panelRaised,
          absoluteIndex === modal.index ? TextAttributes.BOLD : TextAttributes.NONE,
        );
      }
      this.text(
        buffer,
        `j/k choose · ${goals.length} goals · Enter assign · Esc cancel`,
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "linked-execution-picker") {
      const owner = this.findAgent(projection, modal.agentId);
      this.text(
        buffer,
        `LINKED EXECUTIONS${owner ? ` · ${shorten(owner.displayName, overlayWidth - 24)}` : ""}`,
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `${modal.executions.length} available · choose a shell or sibling agent surface`,
        x + 2,
        y + 3,
        COLORS.muted,
        COLORS.panelRaised,
      );
      const visibleRows = Math.max(0, frame.footerY - (y + 5));
      const visibleStart = Math.min(
        Math.max(0, modal.index - visibleRows + 1),
        Math.max(0, modal.executions.length - visibleRows),
      );
      const visible = modal.executions.slice(visibleStart, visibleStart + visibleRows);
      for (const [offset, execution] of visible.entries()) {
        const absoluteIndex = visibleStart + offset;
        const prefix = absoluteIndex === modal.index ? ">" : " ";
        const kind = execution.kind === "agent" ? "agent" : "shell";
        const directory = execution.workingDirectory
          ? ` · ${execution.workingDirectory.replace(/\\/gu, "/").split("/").at(-1) ?? "worktree"}`
          : "";
        this.text(
          buffer,
          `${prefix} ${kind} · ${shorten(`${execution.label}${directory}`, overlayWidth - 10)}`,
          x + 2,
          y + 5 + offset,
          absoluteIndex === modal.index ? COLORS.white : COLORS.text,
          COLORS.panelRaised,
          absoluteIndex === modal.index ? TextAttributes.BOLD : TextAttributes.NONE,
        );
      }
      this.text(
        buffer,
        "j/k choose · Enter open · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "agent-picker") {
      const goal = projection.goals.find((candidate) => candidate.id === modal.goalId);
      const agents = filterAssignableAgents(projection.unassigned, modal.query);
      this.text(
        buffer,
        `ASSIGN INBOX AGENT${goal ? ` TO ${shorten(goal.title, overlayWidth - 24)}` : ""}`,
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `Find: ${inputWithCursor(modal.query, this.inputCursor)}`,
        x + 2,
        y + 3,
        COLORS.white,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `${agents.length}/${projection.unassigned.length} inbox agents · type to filter`,
        x + 2,
        y + 4,
        COLORS.muted,
        COLORS.panelRaised,
      );
      const visibleRows = Math.max(0, frame.footerY - (y + 6));
      const visibleStart = Math.min(
        Math.max(0, modal.index - visibleRows + 1),
        Math.max(0, agents.length - visibleRows),
      );
      const visible = agents.slice(visibleStart, visibleStart + visibleRows);
      if (visible.length === 0)
        this.text(
          buffer,
          modal.query ? "No matching inbox agents." : "Inbox is empty.",
          x + 2,
          y + 6,
          COLORS.orange,
          COLORS.panelRaised,
        );
      for (const [index, agent] of visible.entries()) {
        const absoluteIndex = visibleStart + index;
        const prefix = absoluteIndex === modal.index ? ">" : " ";
        const recentlyDone = this.agentRecentlyDone(agent);
        this.text(
          buffer,
          `${prefix} ${statusGlyph(agent, this.animationPhase)} ${shorten(agent.displayName, overlayWidth - 10)}`,
          x + 2,
          y + 6 + index,
          absoluteIndex === modal.index ? COLORS.white : statusColor(agent, recentlyDone),
          COLORS.panelRaised,
          absoluteIndex === modal.index ? TextAttributes.BOLD : TextAttributes.NONE,
        );
      }
      this.text(
        buffer,
        "↑/↓ choose · type filter · Enter assign · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "related-agents") {
      const related = this.relatedAgentsProjection(modal.goalId);
      const goal = related.goal;
      this.text(
        buffer,
        `RELATED AGENTS${goal ? ` · ${shorten(goal.title, overlayWidth - 22)}` : ""}`,
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `${related.counts.candidates} observed · ${related.counts.strong} strong · ${related.counts.supporting} supporting · ${related.counts.dismissed} dismissed`,
        x + 2,
        y + 3,
        COLORS.muted,
        COLORS.panelRaised,
      );
      const visibleRows = Math.max(0, frame.footerY - (y + 5));
      const visibleStart = Math.min(
        Math.max(0, modal.index - visibleRows + 1),
        Math.max(0, related.candidates.length - visibleRows),
      );
      const visible = related.candidates.slice(visibleStart, visibleStart + visibleRows);
      for (const [offset, candidate] of visible.entries()) {
        const absoluteIndex = visibleStart + offset;
        const selected = modal.selectedIds.includes(candidate.agent.id);
        const status = candidate.dismissed
          ? "dismissed"
          : candidate.adoptable
            ? "ready"
            : `attached · ${candidate.agent.goalTitle ?? "another goal"}`;
        const value = `${selected ? "[x]" : "[ ]"} ${candidate.agent.displayName} · ${status} · ${candidate.evidence.map((item) => item.label).join(" + ")}`;
        const foreground =
          absoluteIndex === modal.index
            ? COLORS.white
            : candidate.dismissed
              ? COLORS.faint
              : candidate.adoptable
                ? COLORS.text
                : COLORS.muted;
        this.text(
          buffer,
          `${absoluteIndex === modal.index ? ">" : " "} ${shorten(value, overlayWidth - 6)}`,
          x + 2,
          y + 5 + offset,
          foreground,
          COLORS.panelRaised,
          absoluteIndex === modal.index ? TextAttributes.BOLD : TextAttributes.NONE,
        );
      }
      if (visible.length === 0)
        this.text(
          buffer,
          "No observed related agents.",
          x + 2,
          y + 5,
          COLORS.orange,
          COLORS.panelRaised,
        );
      this.text(
        buffer,
        "j/k choose · Space toggle · a select ready · Enter adopt · d dismiss · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "workspace-picker") {
      this.text(
        buffer,
        "CHOOSE WORKSPACE",
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `Path: ${shorten(modal.browser.path, overlayWidth - 10)}`,
        x + 2,
        y + 3,
        COLORS.muted,
        COLORS.panelRaised,
      );
      if (modal.loading) {
        this.text(buffer, "Reading directories…", x + 2, y + 5, COLORS.yellow, COLORS.panelRaised);
      } else if (!this.pickerSelect) {
        this.text(buffer, "No directories here.", x + 2, y + 5, COLORS.orange, COLORS.panelRaised);
      }
      this.text(
        buffer,
        "↑/↓ choose · Enter use · → open · ← parent · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "agent-launch") {
      const goals = projection.goals.filter((goal) => goal.status !== "archived");
      const goalLabel =
        modal.goalIndex === 0 ? "Inbox" : (goals[modal.goalIndex - 1]?.title ?? "No active goal");
      const active = (field: LaunchField): boolean => modal.field === field;
      const selectedLocation = modal.locations[modal.locationIndex];
      const selectedAgent = modal.agentOptions[modal.agentIndex];
      const value = (field: LaunchField, text: string): string =>
        active(field)
          ? inputWithVisibleCursor(text, this.inputCursor, overlayWidth - 14)
          : shorten(text, overlayWidth - 14);
      this.text(
        buffer,
        "NEW AGENT",
        x + 2,
        y + 1,
        COLORS.cyan,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        `Goal:       ${active("goal") ? `←/→ ${goalLabel}` : goalLabel}`,
        x + 2,
        y + 3,
        active("goal") ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `Location:   ${active("location") ? `←/→ ${selectedLocation?.label ?? "Browse…"}` : shorten(modal.location, overlayWidth - 14)}`,
        x + 2,
        y + 4,
        active("location") ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `Workspace:  ${active("workspace") ? `←/→ ${modal.workspaceMode}` : modal.workspaceMode}`,
        x + 2,
        y + 5,
        active("workspace") ? COLORS.yellow : COLORS.muted,
        COLORS.panelRaised,
      );
      if (modal.workspaceMode === "worktree")
        this.text(
          buffer,
          `Branch:     ${value("branch", modal.branch)}`,
          x + 2,
          y + 6,
          active("branch") ? COLORS.white : COLORS.muted,
          COLORS.panelRaised,
        );
      const agentY = y + (modal.workspaceMode === "worktree" ? 7 : 6);
      this.text(
        buffer,
        `Agent:      ${active("agent") ? `←/→ ${selectedAgent?.label ?? "No host options"}` : (selectedAgent?.label ?? modal.agentKind)}`,
        x + 2,
        agentY,
        active("agent") ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `Name:       ${value("name", modal.agentName || "(auto)")}`,
        x + 2,
        agentY + 1,
        active("name") ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        `Prompt:     ${value("prompt", modal.prompt || "(none)")}`,
        x + 2,
        agentY + 2,
        active("prompt") ? COLORS.white : COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        "Tab/Enter next · ↑/↓/←/→ choose · b browse · Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
      return;
    }
    if (modal.kind === "confirm") {
      this.text(
        buffer,
        modal.action === "complete"
          ? "COMPLETE GOAL?"
          : modal.action === "archive-agent"
            ? "ARCHIVE STALE AGENT?"
            : "ARCHIVE GOAL?",
        x + 2,
        y + 1,
        COLORS.orange,
        COLORS.panelRaised,
        TextAttributes.BOLD,
      );
      this.text(
        buffer,
        shorten(modal.title, overlayWidth - 4),
        x + 2,
        y + 3,
        COLORS.white,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        modal.action === "complete"
          ? "This is explicit and reversible only by editing state."
          : modal.action === "archive-agent"
            ? "This hides the agent from active views; host history is retained."
            : "This hides the goal from the default view; history is retained.",
        x + 2,
        y + 4,
        COLORS.muted,
        COLORS.panelRaised,
      );
      this.text(
        buffer,
        "y confirm · n/Esc cancel",
        x + 2,
        frame.footerY,
        COLORS.faint,
        COLORS.panelRaised,
      );
    }
  }

  private handleKey(key: KeyEvent): void {
    if (key.eventType === "release") return;
    if (!this.modal && !this.searchActive && (this.terminalMode || this.linkedExecutionTerminal)) {
      if (key.ctrl && key.shift && key.name === "r") {
        key.preventDefault();
        void this.refreshFromHost(true);
        return;
      }
      if (key.ctrl && key.shift && key.name === "y") {
        key.preventDefault();
        void this.openLinkedExecutionTerminalSelected();
        return;
      }
      if (key.name === "tab" && !key.ctrl && !key.meta && !key.super) {
        key.preventDefault();
        this.cycleSurfaceFocus();
        return;
      }
      if (this.focusedSurface === "linkedExecution" && this.linkedExecutionTerminal) {
        this.handleTerminalKey("linkedExecution", key);
        return;
      }
      if (this.focusedSurface === "primary" && this.terminalMode) {
        this.handleTerminalKey("primary", key);
        return;
      }
      // In map mode the map remains a real keyboard surface. This matters for
      // a linkedExecution opened directly from the map: Tab can return focus here
      // without accidentally sending map commands to the linked shell.
      if (!(this.focusedSurface === "map" && this.presentationMode === "map")) return;
    }
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      this.shutdown();
      return;
    }
    if (this.searchActive) {
      this.handleSearchKey(key);
      return;
    }
    if (this.pickerSelect && this.pickerNavigationKey(key)) return;
    if (this.contextMenu) {
      this.handleContextMenuKey(key);
      return;
    }
    if (this.modal) {
      this.handleModalKey(key);
      return;
    }
    const command =
      key.shift && (key.name === "u" || key.name === "d" || key.name === "n")
        ? key.name.toUpperCase()
        : key.name === "up" || key.name === "down" || key.name === "enter" || key.name === "return"
          ? key.name
          : key.sequence || key.name;
    switch (command) {
      case "plus":
      case "kpplus":
      case "=":
      case "kpequal":
        this.zoomMap(1.1);
        return;
      case "-":
      case "minus":
        this.zoomMap(0.9);
        return;
      case "q":
        this.shutdown();
        return;
      case "m": {
        const anchor = this.selectedMapAnchor();
        this.openContextMenu(
          anchor?.x ?? Math.floor(this.renderer.width / 2),
          anchor?.y ?? Math.floor(this.renderer.height / 2),
          this.selected,
        );
        return;
      }
      case "j":
      case "down":
        this.moveSelection(1);
        return;
      case "k":
      case "up":
        this.moveSelection(-1);
        return;
      case "space":
        if (this.viewMode === "map") this.toggleMapFocus();
        else this.toggleExpansion();
        return;
      case "n":
        this.openCreateGoal();
        return;
      case "N":
        this.openAgentLaunch();
        return;
      case "r":
        this.openRename();
        return;
      case "d":
        this.openDescription();
        return;
      case "p":
        this.cyclePriority();
        return;
      case "a":
        this.openAssign();
        return;
      case "g":
        this.jumpToAttention();
        return;
      case "A":
        this.toggleAttentionLens();
        return;
      case "z":
        this.semanticZoom = nextSemanticZoom(this.semanticZoom);
        this.lastAction = `${this.semanticZoom} labels`;
        this.renderer.requestRender();
        return;
      case "u":
        this.unassign();
        return;
      case "c":
        this.confirmGoal("complete");
        return;
      case "x":
        if (this.selected?.type === "agent") this.confirmArchiveAgent();
        else this.confirmGoal("archive");
        return;
      case "/":
        this.searchActive = true;
        this.searchQuery = "";
        this.searchCursor = 0;
        this.searchIndex = 0;
        this.lastAction = "type-to-find active";
        return;
      case "i":
        this.inspectorVisible = !this.inspectorVisible;
        this.lastAction = `inspector ${this.inspectorVisible ? "shown" : "hidden"}`;
        return;
      case "t":
        void this.openTerminalSelected();
        return;
      case "y":
        void this.openLinkedExecutionTerminalSelected();
        return;
      case "o":
        void this.handoffSelected();
        return;
      case "f":
        this.toggleMapFocus();
        return;
      case "v":
        this.viewMode = this.viewMode === "map" ? "list" : "map";
        this.lastAction = `${this.viewMode} lens ${this.viewMode === "map" ? "primary" : "supporting"}`;
        return;
      case "w":
        this.toggleCodeContextLens();
        return;
      case "h":
        if (this.viewMode === "map") this.panMap(-7, 0);
        else this.moveSelection(-1);
        return;
      case "l":
        if (this.viewMode === "map") this.panMap(7, 0);
        else this.moveSelection(1);
        return;
      case "U":
        if (this.viewMode === "map") this.panMap(0, -5);
        return;
      case "D":
        if (this.viewMode === "map") this.panMap(0, 5);
        return;
      case "0":
        this.resetMapView();
        return;
      case "R":
        void this.refreshFromHost(true);
        return;
      case "s":
        this.smokeSuspendResume();
        return;
      case "?":
        this.lastAction = "? help is shown in the command footer; Esc closes dialogs";
        return;
      case "enter":
      case "return":
        if (this.selected?.type === "goal") this.focusGoal(this.selected.id);
        else void this.openTerminalSelected();
        return;
      case "escape":
        if (
          this.mapLens === "goal" ||
          this.mapLens === "attention" ||
          this.mapLens === "inbox" ||
          this.mapLens === "contexts"
        ) {
          this.mapLens = "portfolio";
          this.focusGoalId = undefined;
          this.resetMapView();
          this.lastAction = "returned to portfolio map";
          return;
        }
        this.setSelection(undefined);
        this.lastAction = "selection cleared";
        return;
      default:
        if (typedCharacter(key)) {
          this.searchActive = true;
          this.searchQuery = typedCharacter(key);
          this.searchCursor = this.searchQuery.length;
          this.searchIndex = 0;
          this.lastAction = "type-to-find active";
        }
    }
  }

  private handlePaste(event: PasteEvent): void {
    event.preventDefault();
    if (this.pickerSelect) {
      return;
    }
    const pasted = new TextDecoder().decode(event.bytes);
    if (!pasted) return;
    if (this.searchActive) {
      const edited = insertTextAtCursor(this.searchQuery, this.searchCursor, pasted);
      this.searchQuery = edited.value;
      this.searchCursor = edited.cursor;
      this.searchIndex = 0;
      this.selectSearchResult(
        this.options.universe.project({
          kind: "search",
          query: this.searchQuery,
          now: this.options.clock.now(),
        }),
      );
      this.renderer.requestRender();
      return;
    }
    const modal = this.modal;
    if (modal) {
      if (modal.kind === "agent-picker") {
        const edited = insertTextAtCursor(modal.query, this.inputCursor, pasted);
        this.modal = { ...modal, query: edited.value, index: 0 };
        this.inputCursor = edited.cursor;
      } else if (modal.kind === "create-goal" && modal.field === 0) {
        const edited = insertTextAtCursor(modal.title, this.inputCursor, pasted);
        this.modal = { ...modal, title: edited.value };
        this.inputCursor = edited.cursor;
      } else if (modal.kind === "create-goal" && modal.field === 1) {
        const edited = insertTextAtCursor(modal.description, this.inputCursor, pasted);
        this.modal = { ...modal, description: edited.value };
        this.inputCursor = edited.cursor;
      } else if (
        modal.kind === "agent-launch" &&
        modal.field !== "goal" &&
        modal.field !== "workspace" &&
        modal.field !== "location" &&
        modal.field !== "agent"
      ) {
        const currentValue =
          modal.field === "branch"
            ? modal.branch
            : modal.field === "name"
              ? modal.agentName
              : modal.prompt;
        const edited = insertTextAtCursor(currentValue, this.inputCursor, pasted);
        this.modal =
          modal.field === "branch"
            ? { ...modal, branch: edited.value }
            : modal.field === "name"
              ? { ...modal, agentName: edited.value }
              : { ...modal, prompt: edited.value };
        this.inputCursor = edited.cursor;
      } else if (modal.kind === "text") {
        const edited = insertTextAtCursor(modal.value, this.inputCursor, pasted);
        this.modal = { ...modal, value: edited.value };
        this.inputCursor = edited.cursor;
      } else {
        return;
      }
      this.renderer.requestRender();
      return;
    }
    if (this.focusedSurface === "primary" && this.terminalMode) {
      this.sendTerminalInput(this.terminalMode, { kind: "bytes", value: event.bytes });
      return;
    }
    if (this.focusedSurface === "linkedExecution" && this.linkedExecutionTerminal)
      this.sendTerminalInput(this.linkedExecutionTerminal, { kind: "bytes", value: event.bytes });
  }

  private handleSearchKey(key: KeyEvent): void {
    if (key.name === "escape") {
      this.searchActive = false;
      this.searchQuery = "";
      this.searchCursor = 0;
      this.lastAction = "search cleared";
      return;
    }
    const edited = editText(this.searchQuery, this.searchCursor, key);
    if (edited.handled) {
      this.searchQuery = edited.value;
      this.searchCursor = edited.cursor;
      this.searchIndex = 0;
      const next = this.options.universe.project({
        kind: "search",
        query: this.searchQuery,
        now: this.options.clock.now(),
      });
      this.selectSearchResult(next);
      return;
    }
    const projection = this.options.universe.project({
      kind: "search",
      query: this.searchQuery,
      now: this.options.clock.now(),
    });
    if (key.name === "j" || key.name === "down") {
      if (projection.kind === "search")
        this.searchIndex = Math.min(
          Math.max(0, projection.results.length - 1),
          this.searchIndex + 1,
        );
      this.selectSearchResult(projection);
      return;
    }
    if (key.name === "k" || key.name === "up") {
      this.searchIndex = Math.max(0, this.searchIndex - 1);
      this.selectSearchResult(projection);
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      this.selectSearchResult(projection);
      this.searchActive = false;
      this.lastAction = this.selected
        ? `search selected ${this.selected.id}`
        : "search had no match";
      return;
    }
  }

  private selectSearchResult(projection: ReturnType<Universe["project"]>): void {
    if (projection.kind !== "search") return;
    const result = projection.results[this.searchIndex];
    if (!result) return;
    this.setSelection({ type: result.type, id: result.id });
    this.inspectorVisible = true;
    this.viewMode = "map";
    const goalId =
      result.type === "goal" ? result.id : (result.goalId ?? this.selectedGoalForAgent()?.id);
    if (goalId) {
      this.focusGoal(goalId);
    } else if (result.type === "agent") {
      this.focusInbox();
    } else {
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.mapFitPending = true;
    }
  }

  private openWorkspacePicker(path: string, returnTo: AgentLaunchModal): void {
    const workspace = this.options.workspace;
    if (!workspace.browse) {
      this.lastAction = "This workspace provider does not support directory browsing.";
      return;
    }
    this.modal = {
      kind: "workspace-picker",
      browser: { path, entries: [] },
      index: 0,
      loading: true,
      returnTo,
    };
    this.requestRenderIfAlive();
    void Effect.runPromise(workspace.browse(path))
      .then((browser) => {
        const modal = this.modal;
        if (!modal || modal.kind !== "workspace-picker") return;
        this.modal = { ...modal, browser, loading: false, index: 0 };
        this.requestRenderIfAlive();
      })
      .catch((error) => {
        if (this.modal?.kind !== "workspace-picker") return;
        this.modal = this.modal.returnTo;
        this.lastAction = `workspace browse failed: ${error instanceof Error ? error.message : String(error)}`;
        this.inputCursor = returnTo.location.length;
        this.requestRenderIfAlive();
      });
  }

  private chooseWorkspaceFromPicker(modal: WorkspacePickerModal): void {
    const rows = this.workspacePickerRows(modal);
    const selected = rows[modal.index];
    if (!selected) return;
    const locations = [...modal.returnTo.locations];
    const existingIndex = locations.findIndex((choice) => choice.path === selected.path);
    const locationIndex = existingIndex >= 0 ? existingIndex : locations.length;
    if (existingIndex < 0)
      locations.push({
        path: selected.path,
        label: selected.label,
        kind: "workspace",
        repository: selected.repository,
        branch: selected.branch,
        available: selected.available,
      });
    this.modal = {
      ...modal.returnTo,
      location: selected.path,
      locations,
      locationIndex,
    };
    this.destroyPickerSurface();
    this.inputCursor = selected.path.length;
  }

  private handleWorkspacePickerKey(modal: WorkspacePickerModal, key: KeyEvent): void {
    if (modal.loading) return;
    const rows = this.workspacePickerRows(modal);
    if (rows.length === 0) return;
    if (key.name === "up" || key.name === "k") {
      this.modal = { ...modal, index: (modal.index - 1 + rows.length) % rows.length };
      return;
    }
    if (key.name === "down" || key.name === "j") {
      this.modal = { ...modal, index: (modal.index + 1) % rows.length };
      return;
    }
    if (key.name === "left" || key.name === "backspace") {
      if (modal.browser.parentPath)
        this.openWorkspacePicker(modal.browser.parentPath, modal.returnTo);
      return;
    }
    if (key.name === "right") {
      const selected = rows[modal.index];
      if (selected && selected.kind === "directory")
        this.openWorkspacePicker(selected.path, modal.returnTo);
      return;
    }
    if (key.name === "enter" || key.name === "return") this.chooseWorkspaceFromPicker(modal);
  }

  private launchFields(modal: Extract<Modal, { readonly kind: "agent-launch" }>): LaunchField[] {
    return modal.workspaceMode === "worktree"
      ? ["goal", "location", "workspace", "branch", "agent", "name", "prompt"]
      : ["goal", "location", "workspace", "agent", "name", "prompt"];
  }

  private launchFieldCursor(modal: Extract<Modal, { readonly kind: "agent-launch" }>): number {
    switch (modal.field) {
      case "location":
        return modal.location.length;
      case "branch":
        return modal.branch.length;
      case "agent":
        return modal.agentKind.length;
      case "name":
        return modal.agentName.length;
      case "prompt":
        return modal.prompt.length;
      default:
        return 0;
    }
  }

  private advanceLaunchField(
    modal: Extract<Modal, { readonly kind: "agent-launch" }>,
    direction: 1 | -1,
  ): void {
    const fields = this.launchFields(modal);
    const current = fields.indexOf(modal.field);
    const next = fields[(current + direction + fields.length) % fields.length] ?? "goal";
    this.modal = { ...modal, field: next };
    if (next !== "agent") this.destroyPickerSurface();
    this.inputCursor = this.launchFieldCursor({ ...modal, field: next });
  }

  private handleAgentLaunchKey(
    modal: Extract<Modal, { readonly kind: "agent-launch" }>,
    key: KeyEvent,
  ): void {
    const projection = this.projection();
    const goals = projection.goals.filter((goal) => goal.status !== "archived");
    if (modal.field === "goal") {
      if (key.name === "left" || key.name === "k" || key.name === "up")
        this.modal = { ...modal, goalIndex: Math.max(0, modal.goalIndex - 1) };
      else if (key.name === "right" || key.name === "j" || key.name === "down")
        this.modal = {
          ...modal,
          goalIndex: Math.min(goals.length, modal.goalIndex + 1),
        };
      else if (key.name === "enter" || key.name === "return" || key.name === "tab")
        this.advanceLaunchField(modal, 1);
      return;
    }
    if (modal.field === "location") {
      if (key.name === "b") {
        this.openWorkspacePicker(modal.location, modal);
        return;
      }
      if (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") {
        if (modal.locations.length === 0) return;
        const direction = key.name === "up" || key.name === "left" ? -1 : 1;
        const current = modal.locationIndex >= 0 ? modal.locationIndex : direction > 0 ? -1 : 0;
        const locationIndex =
          (current + direction + modal.locations.length) % modal.locations.length;
        const location = modal.locations[locationIndex]?.path;
        if (location) {
          this.modal = { ...modal, location, locationIndex };
          this.inputCursor = location.length;
        }
        return;
      }
      if (key.name === "enter" || key.name === "return" || key.name === "tab") {
        this.advanceLaunchField(modal, 1);
      }
      return;
    }
    if (modal.field === "agent") {
      if (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") {
        if (modal.agentOptions.length === 0) return;
        const direction = key.name === "up" || key.name === "left" ? -1 : 1;
        const current = modal.agentIndex >= 0 ? modal.agentIndex : direction > 0 ? -1 : 0;
        const agentIndex =
          (current + direction + modal.agentOptions.length) % modal.agentOptions.length;
        const agent = modal.agentOptions[agentIndex];
        if (agent) this.modal = { ...modal, agentIndex, agentKind: agent.kind };
        return;
      }
      if (key.name === "enter" || key.name === "return" || key.name === "tab") {
        if (modal.agentOptions.length === 0) {
          this.lastAction = "No launch-capable agents are available from the host.";
          return;
        }
        this.advanceLaunchField(modal, 1);
      }
      return;
    }
    if (modal.field === "workspace") {
      if (key.name === "left" || key.name === "right" || key.name === "j" || key.name === "k") {
        const workspaceMode = modal.workspaceMode === "existing" ? "worktree" : "existing";
        this.modal = { ...modal, workspaceMode };
        this.inputCursor = workspaceMode === "worktree" ? modal.branch.length : 0;
      } else if (key.name === "enter" || key.name === "return" || key.name === "tab") {
        this.advanceLaunchField(modal, 1);
      }
      return;
    }
    if (key.name === "enter" || key.name === "return" || key.name === "tab") {
      if (modal.field === "branch" && !modal.branch.trim()) {
        this.lastAction = "A branch name is required for a worktree.";
        return;
      }
      if (modal.field === "prompt" && key.name !== "tab") void this.submitAgentLaunch(modal);
      else this.advanceLaunchField(modal, 1);
      return;
    }
    const currentValue =
      modal.field === "branch"
        ? modal.branch
        : modal.field === "name"
          ? modal.agentName
          : modal.prompt;
    const edited = editText(currentValue, this.inputCursor, key);
    if (!edited.handled) return;
    this.inputCursor = edited.cursor;
    this.modal =
      modal.field === "branch"
        ? { ...modal, branch: edited.value }
        : modal.field === "name"
          ? { ...modal, agentName: edited.value }
          : { ...modal, prompt: edited.value };
  }

  private async submitAgentLaunch(
    modal: Extract<Modal, { readonly kind: "agent-launch" }>,
  ): Promise<void> {
    const projection = this.projection();
    const goals = projection.goals.filter((goal) => goal.status !== "archived");
    const selectedGoal = goals[modal.goalIndex - 1];
    const intent: StartAgentIntent = {
      requestId: `launch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      goal: selectedGoal ? { kind: "goal", goalId: selectedGoal.id } : { kind: "inbox" },
      workspace:
        modal.workspaceMode === "worktree"
          ? { kind: "worktree", repositoryPath: modal.location, branch: modal.branch }
          : { kind: "existing", path: modal.location },
      agent: { kind: modal.agentKind.trim() },
      agentName: modal.agentName.trim() || undefined,
      prompt: modal.prompt.trim() || undefined,
      mode: "manual",
    };
    this.pendingLaunch = {
      id: `pending:${intent.requestId}`,
      goalId: selectedGoal?.id,
      agentKind: intent.agent.kind,
      displayName: intent.agentName ?? `${intent.agent.kind} agent`,
    };
    this.modal = undefined;
    this.destroyPickerSurface();
    this.busy = true;
    this.lastAction = `starting ${intent.agent.kind} agent…`;
    this.requestRenderIfAlive();
    try {
      const result = await Effect.runPromise(this.options.startAgent.start(intent));
      this.lastAction = result.warnings?.length
        ? `${result.message} ${result.warnings.join(" ")}`
        : result.message;
      this.agentAccessById.clear();
      if (result.agentId) this.setSelection({ type: "agent", id: result.agentId });
      if (result.goalId) this.focusGoal(result.goalId);
      else if (result.agentId) this.focusInbox();
    } catch (error) {
      this.lastAction = `agent launch failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.pendingLaunch = undefined;
      this.busy = false;
      this.requestRenderIfAlive();
    }
  }

  private handleRelatedAgentsKey(modal: RelatedAgentsModal, key: KeyEvent): void {
    const projection = this.relatedAgentsProjection(modal.goalId);
    const candidates = projection.candidates;
    if (candidates.length === 0) {
      this.modal = undefined;
      this.lastAction = "No observed related agents remain.";
      return;
    }
    const index = Math.max(0, Math.min(candidates.length - 1, modal.index));
    if (key.name === "up" || key.name === "k") {
      this.modal = { ...modal, index: Math.max(0, index - 1) };
      return;
    }
    if (key.name === "down" || key.name === "j") {
      this.modal = { ...modal, index: Math.min(candidates.length - 1, index + 1) };
      return;
    }
    if (key.name === "space") {
      const candidate = candidates[index];
      if (!candidate?.adoptable) {
        this.lastAction = "This agent is already attached to another goal.";
        return;
      }
      const selected = new Set(modal.selectedIds);
      if (selected.has(candidate.agent.id)) selected.delete(candidate.agent.id);
      else selected.add(candidate.agent.id);
      this.modal = { ...modal, index, selectedIds: [...selected] };
      return;
    }
    if (key.name === "a") {
      this.modal = {
        ...modal,
        index,
        selectedIds: candidates
          .filter((candidate) => candidate.adoptable && !candidate.dismissed)
          .map((candidate) => candidate.agent.id),
      };
      this.lastAction = "selected all undismissed related agents";
      return;
    }
    if (key.name === "d") {
      const selectedIds = modal.selectedIds.filter((agentId) =>
        candidates.some((candidate) => candidate.agent.id === agentId),
      );
      if (selectedIds.length === 0) {
        this.lastAction = "Select one or more agents to dismiss.";
        return;
      }
      const result = this.runCommand({
        type: "DismissRelatedAgents",
        goalId: modal.goalId,
        agentIds: selectedIds,
      });
      if (result.ok) {
        this.modal = { ...modal, index, selectedIds: [] };
        this.lastAction = `dismissed ${selectedIds.length} related ${selectedIds.length === 1 ? "agent" : "agents"}`;
      }
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      const selectedIds = modal.selectedIds.filter((agentId) =>
        candidates.some((candidate) => candidate.agent.id === agentId && candidate.adoptable),
      );
      if (selectedIds.length === 0) {
        this.lastAction = "Select one or more adoptable agents.";
        return;
      }
      const result = this.runCommand({
        type: "AdoptRelatedAgents",
        goalId: modal.goalId,
        agentIds: selectedIds,
      });
      if (result.ok) this.modal = undefined;
    }
  }

  private handleModalKey(key: KeyEvent): void {
    const modal = this.modal;
    if (!modal) return;
    if (key.name === "escape") {
      this.modal = modal.kind === "workspace-picker" ? modal.returnTo : undefined;
      this.destroyPickerSurface();
      this.lastAction = "action cancelled";
      return;
    }
    if (modal.kind === "confirm") {
      const character = typedCharacter(key).toLocaleLowerCase();
      if (character === "y") {
        const command: UniverseCommand =
          modal.action === "complete"
            ? { type: "CompleteGoal", goalId: modal.goalId }
            : modal.action === "archive"
              ? { type: "ArchiveGoal", goalId: modal.goalId }
              : { type: "ArchiveAgent", agentId: modal.agentId };
        this.runCommand(command);
        this.modal = undefined;
      } else if (character === "n" || key.name === "escape") {
        this.modal = undefined;
      }
      return;
    }
    if (modal.kind === "workspace-picker") {
      this.handleWorkspacePickerKey(modal, key);
      return;
    }
    if (modal.kind === "agent-launch") {
      this.handleAgentLaunchKey(modal, key);
      return;
    }
    if (modal.kind === "related-agents") {
      this.handleRelatedAgentsKey(modal, key);
      return;
    }
    if (modal.kind === "linked-execution-picker") {
      if (key.name === "j" || key.name === "down") {
        this.modal = {
          ...modal,
          index: Math.min(modal.executions.length - 1, modal.index + 1),
        };
      } else if (key.name === "k" || key.name === "up") {
        this.modal = { ...modal, index: Math.max(0, modal.index - 1) };
      } else if (key.name === "enter" || key.name === "return") {
        this.chooseLinkedExecution(modal, modal.index);
      }
      return;
    }
    if (modal.kind === "goal-picker") {
      const projection = this.projection();
      const goals = projection.goals.filter((goal) => goal.status !== "archived");
      if (key.name === "j" || key.name === "down")
        this.modal = {
          ...modal,
          index: Math.min(Math.max(0, goals.length - 1), modal.index + 1),
        };
      else if (key.name === "k" || key.name === "up")
        this.modal = { ...modal, index: Math.max(0, modal.index - 1) };
      else if (key.name === "enter" || key.name === "return") {
        const goal = goals[modal.index];
        if (!goal) this.lastAction = "Create an active goal first.";
        else
          this.runCommand({
            type: "AssignAgent",
            agentId: modal.agentId,
            goalId: goal.id,
          });
        this.modal = undefined;
      }
      return;
    }
    if (modal.kind === "agent-picker") {
      const projection = this.projection();
      const goal = projection.goals.find(
        (candidate) => candidate.id === modal.goalId && candidate.status !== "archived",
      );
      if (!goal) {
        this.modal = undefined;
        this.lastAction = "Goal is no longer active.";
        return;
      }
      const agents = filterAssignableAgents(projection.unassigned, modal.query);
      const edited = editText(modal.query, this.inputCursor, key);
      if (edited.handled) {
        this.modal = { ...modal, query: edited.value, index: 0 };
        this.inputCursor = edited.cursor;
      } else if (key.name === "down") {
        this.modal = {
          ...modal,
          index: Math.min(Math.max(0, agents.length - 1), modal.index + 1),
        };
      } else if (key.name === "up") {
        this.modal = { ...modal, index: Math.max(0, modal.index - 1) };
      } else if (key.name === "enter" || key.name === "return") {
        const agent = agents[modal.index];
        if (!agent)
          this.lastAction = modal.query
            ? `No inbox agents match “${modal.query}”.`
            : "Inbox is empty.";
        else {
          this.runCommand({
            type: "AssignAgent",
            agentId: agent.id,
            goalId: goal.id,
          });
          this.modal = undefined;
        }
      }
      return;
    }
    if (modal.kind === "create-goal") {
      if (key.name === "tab" && key.shift) {
        if (modal.field === 2) {
          this.modal = { ...modal, field: 1 };
          this.inputCursor = modal.description.length;
        } else if (modal.field === 1) {
          this.modal = { ...modal, field: 0 };
          this.inputCursor = modal.title.length;
        }
        return;
      }
      if (key.name === "tab" || key.name === "enter" || key.name === "return") {
        if (modal.field === 0) {
          if (!modal.title.trim()) {
            this.lastAction = "Goal title is required.";
            return;
          }
          this.modal = { ...modal, field: 1 };
          this.inputCursor = modal.description.length;
        } else if (modal.field === 1) {
          this.modal = { ...modal, field: 2 };
        } else {
          this.runCommand({
            type: "CreateGoal",
            title: modal.title,
            description: modal.description,
            priority: modal.priority,
          });
          this.modal = undefined;
        }
        return;
      }
      if (modal.field === 2 && (key.name === "j" || key.name === "k" || /^[0-3]$/.test(key.name))) {
        const current = priorityRank(modal.priority);
        const next = /^[0-3]$/.test(key.name)
          ? Number(key.name)
          : key.name === "j"
            ? (current + 1) % 4
            : (current + 3) % 4;
        this.modal = { ...modal, priority: PRIORITIES[next] ?? "P2" };
        return;
      }
      if (modal.field === 0) {
        const edited = editText(modal.title, this.inputCursor, key);
        if (edited.handled) {
          this.modal = { ...modal, title: edited.value };
          this.inputCursor = edited.cursor;
        }
      } else if (modal.field === 1) {
        const edited = editText(modal.description, this.inputCursor, key);
        if (edited.handled) {
          this.modal = { ...modal, description: edited.value };
          this.inputCursor = edited.cursor;
        }
      }
      return;
    }
    if (modal.kind === "text") {
      if (key.name === "enter" || key.name === "return") {
        const selected = this.selected;
        if (!selected) return;
        const value = modal.value;
        const command: UniverseCommand =
          modal.action === "rename-goal"
            ? { type: "RenameGoal", goalId: selected.id, title: value }
            : modal.action === "rename-agent"
              ? {
                  type: "RenameAgent",
                  agentId: selected.id,
                  displayName: value,
                }
              : modal.action === "description-goal"
                ? {
                    type: "SetGoalDescription",
                    goalId: selected.id,
                    description: value,
                  }
                : {
                    type: "SetAgentDescription",
                    agentId: selected.id,
                    description: value,
                  };
        this.runCommand(command);
        this.modal = undefined;
        return;
      }
      const edited = editText(modal.value, this.inputCursor, key);
      if (edited.handled) {
        this.modal = { ...modal, value: edited.value };
        this.inputCursor = edited.cursor;
      }
    }
  }

  private moveSelection(direction: number): void {
    if (this.viewMode === "map") {
      if (this.mapLens === "contexts") {
        const candidates = this.codeContextMapProjection().contexts.flatMap((context) =>
          context.agents.map((agent) => ({ type: "agent", id: agent.id }) as const),
        );
        const next = nextNavigationSelection(candidates, this.selected, direction);
        if (!next) {
          this.lastAction = "No observed code-context agents yet.";
          return;
        }
        this.setSelection(next);
        this.inspectorVisible = true;
        this.lastAction = `selected ${next.id}`;
        return;
      }
      const mapProjection = this.mapProjection();
      const mapLens = this.mapLens;
      const candidates = mapSelectionCandidates(mapProjection, mapLens, this.focusGoalId);
      const next = nextNavigationSelection(candidates, this.selected, direction);
      if (!next) {
        this.lastAction =
          this.mapLens === "goal"
            ? "Focused goal has no agents."
            : "No selectable map nodes. Press n to create a goal.";
        return;
      }
      this.setSelection(next);
      this.inspectorVisible = true;
      this.lastAction = `selected ${next.id}`;
      return;
    }
    const projection = this.projection();
    const rows = this.ensureSelection(projection).filter(
      (row): row is Selection => row.type === "goal" || row.type === "agent",
    );
    if (rows.length === 0) {
      this.lastAction = "No accepted goals or agents. Press n to create a goal.";
      return;
    }
    const currentIndex = this.selected
      ? rows.findIndex((row) => row.type === this.selected?.type && row.id === this.selected.id)
      : 0;
    const nextIndex = (Math.max(0, currentIndex) + direction + rows.length) % rows.length;
    const next = rows[nextIndex];
    if (next) {
      this.setSelection({ type: next.type, id: next.id });
      this.inspectorVisible = true;
    }
    this.lastAction = `selected ${next?.id ?? "item"}`;
  }

  private jumpToAttention(): void {
    const items = this.projection().attention.items.filter((item) => item.agentId);
    if (items.length === 0) {
      this.lastAction = "No attention items.";
      return;
    }
    const currentIndex =
      this.selected?.type === "agent"
        ? items.findIndex((item) => item.agentId === this.selected?.id)
        : -1;
    const item = items[(currentIndex + 1) % items.length];
    if (!item?.agentId) return;
    this.setSelection({ type: "agent", id: item.agentId });
    this.inspectorVisible = true;
    this.viewMode = "map";
    const owner = this.selectedGoalForAgent();
    if (owner) {
      this.focusGoal(owner.id);
    } else this.focusInbox();
    this.lastAction = `attention ${item.reason} · waiting ${formatAge(item.ageMs)}`;
  }

  private toggleAttentionLens(): void {
    if (this.viewMode !== "map") this.viewMode = "map";
    if (this.mapLens === "attention") {
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.resetMapView();
      this.lastAction = "portfolio map";
      return;
    }
    this.mapLens = "attention";
    this.focusGoalId = undefined;
    this.mapFitPending = true;
    this.lastAction = "attention lens · healthy work dimmed";
    this.renderer.requestRender();
  }

  private toggleExpansion(): void {
    if (!this.selected || this.selected.type !== "goal") return;
    if (this.expandedGoals.has(this.selected.id)) this.expandedGoals.delete(this.selected.id);
    else this.expandedGoals.add(this.selected.id);
    this.lastAction = `${this.expandedGoals.has(this.selected.id) ? "expanded" : "collapsed"} goal`;
  }

  private toggleCodeContextLens(): void {
    if (this.viewMode === "map") {
      if (this.mapLens === "contexts") {
        this.mapLens = "portfolio";
        this.focusGoalId = undefined;
        this.resetMapView();
        this.lastAction = "goal universe map";
      } else {
        this.mapLens = "contexts";
        this.focusGoalId = undefined;
        this.mapFitPending = true;
        this.lastAction = "code context map · agents grouped by repository";
        this.renderer.requestRender();
      }
      return;
    }
    this.viewMode = "list";
    this.listLens = this.listLens === "contexts" ? "goals" : "contexts";
    this.scrollOffset = 0;
    this.lastAction =
      this.listLens === "contexts"
        ? "code contexts · agents grouped by repository"
        : "goals · direct agents";
    this.renderer.requestRender();
  }

  private toggleMapFocus(): void {
    if (this.viewMode !== "map") {
      this.viewMode = "map";
      this.lastAction = "primary universe map";
    }
    const projection = this.projection();
    const goal = this.selectedGoal(projection) ?? this.selectedGoalForAgent();
    if (!goal) {
      const selectedUnassigned =
        this.selected?.type === "agent" &&
        projection.unassigned.some((agent) => agent.id === this.selected?.id);
      if (selectedUnassigned) {
        if (this.mapLens === "inbox") {
          this.mapLens = "portfolio";
          this.resetMapView();
          this.lastAction = "portfolio map";
        } else this.focusInbox();
      } else this.lastAction = "Select a goal, agent, or inbox to focus.";
      return;
    }
    if (this.mapLens === "goal" && this.focusGoalId === goal.id) {
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.resetMapView();
      this.lastAction = "portfolio map";
      return;
    }
    this.focusGoal(goal.id);
  }

  private focusGoal(goalId: string): void {
    const goal = this.mapProjection().goals.find((candidate) => candidate.id === goalId);
    if (!goal) {
      this.lastAction = "Goal is no longer visible.";
      return;
    }
    this.lastGoalClick = undefined;
    this.viewMode = "map";
    this.mapLens = "goal";
    this.focusGoalId = goal.id;
    this.mapCenter = { ...goal.mapPosition };
    this.mapZoom = Math.max(this.mapZoom, 1.15);
    this.mapFitPending = true;
    this.lastAction = `focused goal ${goal.title}`;
    this.renderer.requestRender();
  }

  private focusInbox(): void {
    const projection = this.mapProjection();
    if (projection.unassigned.length === 0) {
      this.lastAction = "Inbox is empty.";
      return;
    }
    this.viewMode = "map";
    this.mapLens = "inbox";
    this.focusGoalId = undefined;
    if (this.selected?.type === "goal") this.setSelection(undefined);
    this.mapCenter = { ...projection.inboxPosition };
    this.mapZoom = Math.max(this.mapZoom, 1.15);
    this.mapFitPending = true;
    this.lastAction = `focused inbox · ${projection.unassigned.length} agents`;
    this.renderer.requestRender();
  }

  private selectedGoalForAgent(): GoalView | undefined {
    if (!this.selected || this.selected.type !== "agent") return undefined;
    const projection = this.projection();
    return projection.goals.find((goal) =>
      goal.agents.some((agent) => agent.id === this.selected?.id),
    );
  }

  private goalPosition(goalId: string): MapPosition {
    return (
      this.mapProjection().goals.find((goal) => goal.id === goalId)?.mapPosition ?? {
        x: 0,
        y: 0,
      }
    );
  }

  private panMap(deltaX: number, deltaY: number): void {
    if (this.viewMode !== "map") return;
    this.mapCenter = panViewport(
      { center: this.mapCenter, zoom: this.mapZoom },
      { x: deltaX, y: deltaY },
      { x: this.mapScaleX, y: this.mapScaleY },
    ).center;
    this.mapFitPending = false;
    this.lastAction = `panned map ${this.mapCenter.x.toFixed(0)},${this.mapCenter.y.toFixed(0)}`;
    this.renderer.requestRender();
  }

  private resetMapView(): void {
    this.mapCenter = { x: 0, y: 0 };
    this.mapZoom = 1;
    this.mapFitPending = true;
    this.lastAction = "map viewport reset";
    this.renderer.requestRender();
  }

  private zoomMap(factor: number, anchorX?: number, anchorY?: number, source = "zoom"): void {
    if (this.viewMode !== "map") return;
    this.mapFitPending = false;
    const map = this.mapRect;
    if (map) {
      const x = anchorX ?? map.x + map.width / 2;
      const y = anchorY ?? map.y + map.height / 2;
      const next = zoomViewportAt(
        { center: this.mapCenter, zoom: this.mapZoom },
        factor,
        { x, y },
        {
          x: map.x + 1,
          y: map.y + 1,
          width: Math.max(1, map.width - 2),
          height: Math.max(1, map.height - 2),
        },
        { x: this.mapScaleX, y: this.mapScaleY },
      );
      this.mapCenter = next.center;
      this.mapZoom = next.zoom;
    } else {
      this.mapZoom = clamp(this.mapZoom * factor, 0.65, 2.2);
    }
    this.lastAction = `${source} ${Math.round(this.mapZoom * 100)}%`;
    this.renderer.requestRender();
  }

  private openCreateGoal(): void {
    this.inputCursor = 0;
    this.modal = {
      kind: "create-goal",
      field: 0,
      title: "",
      description: "",
      priority: "P2",
    };
  }

  private openAgentLaunch(): void {
    const projection = this.projection();
    const selectedGoal = this.selectedGoal(projection) ?? this.selectedGoalForAgent();
    const goals = projection.goals.filter((goal) => goal.status !== "archived");
    const selectedGoalIndex = selectedGoal
      ? Math.max(0, goals.findIndex((goal) => goal.id === selectedGoal.id) + 1)
      : 0;
    this.inputCursor = 0;
    this.modal = {
      kind: "agent-launch",
      field: "goal",
      goalIndex: selectedGoalIndex,
      location: process.cwd(),
      locations: [],
      locationIndex: -1,
      workspaceMode: "existing",
      branch: "feat/observatory-agent",
      agentOptions: [],
      agentIndex: -1,
      agentKind: "",
      agentName: "",
      prompt: "",
    };
    this.requestRenderIfAlive();
    void Promise.all([
      Effect.runPromise(this.options.workspace.listChoices()),
      Effect.runPromise(this.options.host.listLaunchOptions()),
    ])
      .then(([locations, agentOptions]) => {
        const modal = this.modal;
        if (!modal || modal.kind !== "agent-launch") return;
        const locationIndex = locations.findIndex((choice) => choice.path === modal.location);
        const preferredAgentIndex = Math.max(
          0,
          agentOptions.findIndex((option) => option.kind === "codex"),
        );
        const agent = agentOptions[preferredAgentIndex];
        this.modal = {
          ...modal,
          locations,
          locationIndex,
          agentOptions,
          agentIndex: agent ? preferredAgentIndex : -1,
          agentKind: agent?.kind ?? "",
        };
        this.requestRenderIfAlive();
      })
      .catch((error) => {
        if (this.modal?.kind === "agent-launch") {
          this.lastAction = `launch choices unavailable: ${error instanceof Error ? error.message : String(error)}`;
          this.requestRenderIfAlive();
        }
      });
  }

  private openRename(): void {
    const projection = this.projection();
    const goal = this.selectedGoal(projection);
    const agent = this.selectedAgent(projection);
    if (goal) {
      this.inputCursor = goal.title.length;
      this.modal = {
        kind: "text",
        title: "RENAME GOAL",
        value: goal.title,
        action: "rename-goal",
      };
    } else if (agent) {
      this.inputCursor = agent.displayName.length;
      this.modal = {
        kind: "text",
        title: "RENAME AGENT",
        value: agent.displayName,
        action: "rename-agent",
      };
    } else this.lastAction = "Select a goal or agent first.";
  }

  private openDescription(): void {
    const projection = this.projection();
    const goal = this.selectedGoal(projection);
    const agent = this.selectedAgent(projection);
    if (goal) {
      this.inputCursor = (goal.description ?? "").length;
      this.modal = {
        kind: "text",
        title: "SET GOAL DESCRIPTION",
        value: goal.description ?? "",
        action: "description-goal",
      };
    } else if (agent) {
      this.inputCursor = (agent.description ?? "").length;
      this.modal = {
        kind: "text",
        title: "SET AGENT DESCRIPTION",
        value: agent.description ?? "",
        action: "description-agent",
      };
    } else this.lastAction = "Select a goal or agent first.";
  }

  private cyclePriority(): void {
    const goal = this.selectedGoal(this.projection());
    if (!goal) {
      this.lastAction = "Select a goal to set priority.";
      return;
    }
    const next = PRIORITIES[(priorityRank(goal.priority) + 1) % PRIORITIES.length] ?? "P2";
    this.runCommand({
      type: "SetGoalPriority",
      goalId: goal.id,
      priority: next,
    });
  }

  private openAssign(): void {
    const projection = this.projection();
    const goal = this.selectedGoal(projection);
    if (goal) {
      this.inputCursor = 0;
      this.modal = {
        kind: "agent-picker",
        goalId: goal.id,
        index: 0,
        query: "",
      };
      return;
    }
    const agent = this.selectedAgent(projection);
    if (!agent) {
      this.lastAction = "Select a goal to assign inbox agents, or an agent to choose its goal.";
      return;
    }
    const goals = projection.goals.filter((candidate) => candidate.status !== "archived");
    const current = goals.findIndex((candidate) => candidate.id === agent.primaryGoalId);
    this.modal = {
      kind: "goal-picker",
      agentId: agent.id,
      index: current >= 0 ? current : 0,
    };
  }

  private openRelatedAgents(): void {
    const goal = this.selectedGoal(this.projection());
    if (!goal) {
      this.lastAction = "Select a goal to find related agents.";
      return;
    }
    const projection = this.relatedAgentsProjection(goal.id);
    if (projection.candidates.length === 0) {
      this.lastAction =
        goal.agents.length === 0
          ? "Attach an agent first to discover related agents."
          : "No observed related agents for this goal.";
      return;
    }
    this.modal = {
      kind: "related-agents",
      goalId: goal.id,
      index: 0,
      selectedIds: projection.candidates
        .filter((candidate) => candidate.adoptable && !candidate.dismissed)
        .map((candidate) => candidate.agent.id),
    };
    this.lastAction = "review observed related agents · choose what to adopt";
  }

  private unassign(): void {
    const agent = this.selectedAgent(this.projection());
    if (!agent) {
      this.lastAction = "Select an agent to unassign.";
      return;
    }
    this.runCommand({ type: "UnassignAgent", agentId: agent.id });
  }

  private confirmGoal(action: "complete" | "archive"): void {
    const goal = this.selectedGoal(this.projection());
    if (!goal) {
      this.lastAction = "Select a goal first.";
      return;
    }
    if (action === "archive" && goal.status !== "completed") {
      this.lastAction = "Complete the goal before archiving it.";
      return;
    }
    this.modal = {
      kind: "confirm",
      action,
      goalId: goal.id,
      title: goal.title,
    };
  }

  private confirmArchiveAgent(): void {
    const agent = this.selectedAgent(this.projection());
    if (!agent) {
      this.lastAction = "Select an agent first.";
      return;
    }
    if (agent.hostHealth === "live") {
      this.lastAction = "Only stale or unavailable agents can be archived.";
      return;
    }
    this.modal = {
      kind: "confirm",
      action: "archive-agent",
      agentId: agent.id,
      title: agent.displayName,
    };
  }

  private runCommand(command: UniverseCommand): CommandResult {
    const result = this.options.universe.execute(command);
    this.lastAction = result.ok
      ? `applied ${command.type}`
      : (result.error ?? `rejected ${command.type}`);
    if (result.ok && command.type === "AdoptRelatedAgents")
      this.lastAction = `adopted ${result.affectedAgentIds?.length ?? command.agentIds.length} related ${command.agentIds.length === 1 ? "agent" : "agents"}`;
    if (result.ok && command.type === "DismissRelatedAgents")
      this.lastAction = `dismissed ${result.affectedAgentIds?.length ?? command.agentIds.length} related ${command.agentIds.length === 1 ? "agent" : "agents"}`;
    if (result.ok && result.goalId && command.type === "CreateGoal") {
      this.expandedGoals.add(result.goalId);
      this.setSelection({ type: "goal", id: result.goalId });
      this.inspectorVisible = true;
      this.viewMode = "map";
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.mapFitPending = true;
      this.lastAction = `created goal ${command.title} · press a to assign inbox agents`;
    }
    this.renderer.requestRender();
    return result;
  }

  private async refreshFromHost(manual: boolean): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.lastAction = manual ? "refreshing host snapshot…" : this.lastAction;
    try {
      this.lastAction = await Effect.runPromise(this.options.refresh);
      this.agentAccessById.clear();
      await this.refreshLinkedExecutionPicker();
    } catch (error) {
      this.lastAction = `refresh failed: ${error instanceof Error ? error.message : String(error)}`;
      if (this.modal?.kind === "linked-execution-picker") {
        this.modal = undefined;
        this.destroyPickerSurface();
        this.lastAction += " · linked choices closed";
      }
    } finally {
      this.busy = false;
      this.requestRenderIfAlive();
    }
  }

  private async refreshLinkedExecutionPicker(): Promise<void> {
    const modal = this.modal;
    if (!modal || modal.kind !== "linked-execution-picker") return;
    const agent = this.findAgent(this.projection(), modal.agentId);
    if (!agent) {
      this.modal = undefined;
      this.destroyPickerSurface();
      this.lastAction = "The linked execution owner is no longer available.";
      return;
    }
    try {
      const access = await Effect.runPromise(
        this.options.host.access({
          hostKind: agent.hostKind,
          nativeId: agent.nativeId,
        }),
      );
      this.agentAccessById.set(agent.id, access);
      const executions = access.linkedExecutions.filter((candidate) => candidate.available);
      if (!access.supported || executions.length === 0) {
        this.modal = undefined;
        this.destroyPickerSurface();
        this.lastAction =
          access.linkedExecutions[0]?.explanation ?? "No linked execution remains available.";
        return;
      }
      this.modal = {
        ...modal,
        executions,
        index: Math.min(modal.index, executions.length - 1),
      };
      this.lastAction = `${executions.length} linked executions · choose one`;
    } catch (error) {
      this.modal = undefined;
      this.destroyPickerSurface();
      this.lastAction = `Linked execution refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async agentAccess(agent: AgentView): Promise<AgentAccess> {
    const cached = this.agentAccessById.get(agent.id);
    if (cached) return cached;
    const access = await Effect.runPromise(
      this.options.host.access({
        hostKind: agent.hostKind,
        nativeId: agent.nativeId,
      }),
    );
    this.agentAccessById.set(agent.id, access);
    return access;
  }

  private terminalDimensionsFor(role: SurfaceRole): TerminalDimensions {
    const layout = layoutFor(this.renderer.width, this.renderer.height);
    const surfaces = surfaceLayoutFor(
      layout,
      role === "primary" ? "review" : this.presentationMode,
      role === "primary" || this.terminalMode !== undefined,
      role === "linkedExecution" || this.linkedExecutionTerminal !== undefined,
    );
    const rect = role === "primary" ? surfaces.primary : surfaces.linkedExecution;
    return ensureTerminalDimensions(
      (rect ?? layout.map).width - 2,
      (rect ?? layout.map).height - 3,
    );
  }

  private async openTerminalSelected(): Promise<void> {
    const agent = this.selectedAgent(this.projection());
    if (!agent) {
      this.lastAction = "Select an agent to open a terminal.";
      return;
    }
    if (this.busy || this.terminalMode) return;
    this.busy = true;
    try {
      const access = await this.agentAccess(agent);
      if (!access.supported) {
        this.lastAction = access.explanation;
        return;
      }
      if (!hasAgentCapability(access, "embedded-terminal") || !access.terminalTarget) {
        this.lastAction = `${agent.displayName} has no embedded terminal capability.`;
        return;
      }
      const dimensions = this.terminalDimensionsFor("primary");
      this.lastAction = `opening terminal for ${agent.displayName}…`;
      const opened = await Effect.runPromise(this.options.host.openTerminal(access, dimensions));
      if (!opened.ok || !opened.terminal) {
        this.lastAction = opened.message;
        return;
      }
      const mode: TerminalMode = {
        role: "primary",
        agentId: agent.id,
        displayName: agent.displayName,
        hostLabel: displayHostKind(agent.hostKind),
        terminal: opened.terminal,
        screen: new TerminalScreen(dimensions.columns, dimensions.rows),
        dimensions,
        status: opened.message,
        closed: false,
      };
      this.terminalMode = mode;
      this.presentationMode = "review";
      this.focusedSurface = "primary";
      this.lastAction = opened.message;
      void this.consumeTerminalEvents(mode);
    } catch (error) {
      this.lastAction = `terminal open failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.requestRenderIfAlive();
    }
  }

  private async openLinkedExecutionSurface(
    agent: AgentView,
    linkedExecution: LinkedExecution,
  ): Promise<void> {
    const dimensions = this.terminalDimensionsFor("linkedExecution");
    this.lastAction = `opening ${linkedExecution.label}…`;
    const opened = await Effect.runPromise(
      this.options.host.openLinkedExecutionTerminal(linkedExecution, dimensions),
    );
    if (!opened.ok || !opened.terminal) {
      this.lastAction = opened.message;
      return;
    }
    const mode: TerminalMode = {
      role: "linkedExecution",
      agentId: agent.id,
      displayName: linkedExecution.label,
      hostLabel: displayHostKind(agent.hostKind),
      terminal: opened.terminal,
      screen: new TerminalScreen(dimensions.columns, dimensions.rows),
      dimensions,
      status: opened.message,
      closed: false,
    };
    this.linkedExecutionTerminal = mode;
    this.presentationMode = this.terminalMode ? "review" : "map";
    this.focusedSurface = "linkedExecution";
    this.lastAction = opened.message;
    void this.consumeTerminalEvents(mode);
  }

  private chooseLinkedExecution(modal: LinkedExecutionModal, index: number): void {
    const execution = modal.executions[index];
    const agent = this.findAgent(this.projection(), modal.agentId);
    this.modal = undefined;
    this.destroyPickerSurface();
    if (!agent || !execution) {
      this.lastAction = "The linked execution is no longer available.";
      return;
    }
    if (this.busy || this.linkedExecutionTerminal) return;
    this.busy = true;
    void this.openLinkedExecutionSurface(agent, execution)
      .catch((error) => {
        this.lastAction = `linked terminal open failed: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        this.busy = false;
        this.requestRenderIfAlive();
      });
  }

  private async openLinkedExecutionTerminalSelected(): Promise<void> {
    const agent = this.selectedAgent(this.projection());
    if (!agent) {
      this.lastAction = "Select an agent before opening a linked terminal.";
      return;
    }
    if (this.busy || this.linkedExecutionTerminal) return;
    this.busy = true;
    try {
      const access = await this.agentAccess(agent);
      const linkedExecutions = access.linkedExecutions.filter((candidate) => candidate.available);
      if (!access.supported || linkedExecutions.length === 0) {
        this.lastAction =
          access.linkedExecutions[0]?.explanation ??
          "No linked execution is available for this agent.";
        return;
      }
      if (linkedExecutions.length > 1) {
        this.modal = {
          kind: "linked-execution-picker",
          agentId: agent.id,
          index: 0,
          executions: linkedExecutions,
        };
        this.lastAction = `${linkedExecutions.length} linked executions · choose one`;
        return;
      }
      await this.openLinkedExecutionSurface(agent, linkedExecutions[0]!);
    } catch (error) {
      this.lastAction = `linked terminal open failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.requestRenderIfAlive();
    }
  }

  private isActiveTerminal(mode: TerminalMode): boolean {
    return (mode.role === "primary" ? this.terminalMode : this.linkedExecutionTerminal) === mode;
  }

  private async consumeTerminalEvents(mode: TerminalMode): Promise<void> {
    try {
      await Effect.runPromise(
        Stream.runForEach(mode.terminal.events, (event) =>
          Effect.sync(() => {
            if (!this.isActiveTerminal(mode) || this.closed) return;
            this.applyTerminalEvent(mode, event);
            this.requestRenderIfAlive();
          }),
        ),
      );
      if (this.isActiveTerminal(mode) && !mode.closed) {
        mode.closed = true;
        mode.status = "The terminal stream ended.";
        this.updateTerminalSurface(mode);
        this.requestRenderIfAlive();
      }
    } catch (error) {
      if (!this.isActiveTerminal(mode) || this.closed) return;
      mode.closed = true;
      mode.status = `terminal stream failed: ${error instanceof Error ? error.message : String(error)}`;
      this.updateTerminalSurface(mode);
      this.requestRenderIfAlive();
    }
  }

  private applyTerminalEvent(mode: TerminalMode, event: HostTerminalEvent): void {
    if (event.kind === "closed") {
      mode.closed = true;
      mode.status = event.reason ? `terminal closed: ${event.reason}` : "terminal stream closed";
      return;
    }
    const frame = event.frame;
    if (frame.columns && frame.rows) {
      mode.dimensions = ensureTerminalDimensions(frame.columns, frame.rows);
      mode.screen.resize(mode.dimensions.columns, mode.dimensions.rows);
    }
    if (frame.full) mode.screen.reset({ preserveHistory: true });
    mode.screen.write(frame.bytes);
    mode.status = this.terminalStatus(mode);
    this.updateTerminalSurface(mode);
  }

  private async releaseTerminal(role: SurfaceRole): Promise<void> {
    const mode = role === "primary" ? this.terminalMode : this.linkedExecutionTerminal;
    if (!mode) return;
    if (role === "primary") this.terminalMode = undefined;
    else this.linkedExecutionTerminal = undefined;
    this.destroyTerminalSurface(role);
    try {
      const result = await Effect.runPromise(mode.terminal.release());
      this.lastAction = result.message;
    } catch (error) {
      this.lastAction = `terminal release failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.normalizeSurfacePresentation();
      this.requestRenderIfAlive();
    }
  }

  private normalizeSurfacePresentation(): void {
    const hasPrimary = this.terminalMode !== undefined;
    const hasLinkedExecution = this.linkedExecutionTerminal !== undefined;
    if (hasPrimary) this.presentationMode = "review";
    else this.presentationMode = "map";
    if (this.focusedSurface === "primary" && !hasPrimary)
      this.focusedSurface = hasLinkedExecution ? "linkedExecution" : "map";
    if (this.focusedSurface === "linkedExecution" && !this.linkedExecutionTerminal)
      this.focusedSurface = hasPrimary ? "primary" : "map";
  }

  private handleTerminalKey(role: SurfaceRole, key: KeyEvent): void {
    const mode = role === "primary" ? this.terminalMode : this.linkedExecutionTerminal;
    if (!mode) return;
    key.preventDefault();
    if (key.name === "c" && ((key.ctrl && key.shift) || key.meta || key.super)) {
      this.copyTerminalSelection(mode);
      return;
    }
    if (key.name === "escape" || (key.ctrl && key.name === "q")) {
      void this.releaseTerminal(role);
      return;
    }
    if (key.name === "pageup" || key.name === "kppageup") {
      this.sendTerminalScroll(mode, "up", "page-key", Math.max(1, mode.screen.rows - 1));
      return;
    }
    if (key.name === "pagedown" || key.name === "kppagedown") {
      this.sendTerminalScroll(mode, "down", "page-key", Math.max(1, mode.screen.rows - 1));
      return;
    }
    if (key.ctrl && key.name === "home") {
      if (mode.screen.alternateScreen) this.sendTerminalKey(mode, key);
      else if (mode.screen.scrollToTop()) {
        mode.status = this.terminalStatus(mode);
        this.updateTerminalSurface(mode);
        this.requestRenderIfAlive();
      } else this.sendTerminalKey(mode, key);
      return;
    }
    if (key.ctrl && key.name === "end") {
      if (mode.screen.alternateScreen) this.sendTerminalKey(mode, key);
      else if (mode.screen.scrollToBottom()) {
        mode.status = this.terminalStatus(mode);
        this.updateTerminalSurface(mode);
        this.requestRenderIfAlive();
      } else this.sendTerminalKey(mode, key);
      return;
    }
    if (mode.screen.isScrolled) {
      mode.screen.scrollToBottom();
      mode.status = this.terminalStatus(mode);
      this.updateTerminalSurface(mode);
      this.requestRenderIfAlive();
    }
    const value = key.sequence || key.raw;
    if (value) this.sendTerminalInput(mode, { kind: "text", value });
  }

  private terminalStatus(mode: TerminalMode): string {
    return mode.screen.isScrolled
      ? `scrollback · ${mode.screen.scrollOffset} lines back`
      : `live · ${mode.screen.bytes} bytes · ${mode.screen.ansiSequences} control sequences`;
  }

  private handleTerminalMouseScroll(role: SurfaceRole, event: MouseEvent): void {
    const mode = role === "primary" ? this.terminalMode : this.linkedExecutionTerminal;
    if (!mode) return;
    const direction =
      event.scroll?.direction ??
      (event.button === 4 || event.button === 64
        ? "up"
        : event.button === 5 || event.button === 65
          ? "down"
          : undefined);
    if (direction !== "up" && direction !== "down") return;
    event.preventDefault();
    event.stopPropagation();
    const amount = Math.max(1, Math.min(20, Math.round(event.scroll?.delta ?? 1))) * 3;
    this.sendTerminalScroll(mode, direction, "page-key", amount, event);
  }

  private sendTerminalKey(mode: TerminalMode, key: KeyEvent): void {
    const value = key.sequence || key.raw;
    if (value) this.sendTerminalInput(mode, { kind: "text", value });
  }

  private sendTerminalScroll(
    mode: TerminalMode,
    direction: "up" | "down",
    source: "wheel" | "page-key",
    lines: number,
    event?: MouseEvent,
  ): void {
    const column = event ? clamp(event.x - 1, 1, mode.dimensions.columns) : undefined;
    const row = event ? clamp(event.y - 2, 1, mode.dimensions.rows) : undefined;
    mode.status = `scrolling agent ${direction === "up" ? "up" : "down"}…`;
    this.sendTerminalInput(mode, {
      kind: "scroll",
      direction,
      lines: Math.max(1, Math.min(65_535, Math.trunc(lines))),
      source,
      column,
      row,
      modifiers: 0,
    });
    this.requestRenderIfAlive();
  }

  private sendTerminalInput(mode: TerminalMode, input: HostTerminalInput): void {
    void Effect.runPromise(mode.terminal.send(input))
      .then((result) => {
        if (!result.ok && this.isActiveTerminal(mode)) {
          mode.status = result.message;
          this.requestRenderIfAlive();
        }
      })
      .catch(() => {
        if (this.isActiveTerminal(mode)) {
          mode.status = "terminal input failed";
          this.requestRenderIfAlive();
        }
      });
  }

  private copyTerminalSelection(mode: TerminalMode): void {
    const selection = this.renderer.getSelection();
    const text = selection?.getSelectedText().replace(/\s+$/u, "") ?? "";
    if (!text) {
      mode.status = "Select terminal text first, then press Ctrl-Shift-C.";
      this.renderer.requestRender();
      return;
    }
    const copied = this.renderer.copyToClipboardOSC52(text);
    mode.status = copied
      ? `copied ${text.length} characters to the clipboard`
      : "copy unavailable: this terminal does not support OSC52 clipboard access";
    this.renderer.requestRender();
  }

  private cycleSurfaceFocus(): void {
    const surfaces: SurfaceFocus[] = [];
    if (this.presentationMode === "map" && this.surfaceLayout?.map) surfaces.push("map");
    if (this.terminalMode) surfaces.push("primary");
    if (this.linkedExecutionTerminal) surfaces.push("linkedExecution");
    if (surfaces.length === 0) return;
    const current = surfaces.indexOf(this.focusedSurface);
    this.focusedSurface =
      surfaces[(current + 1 + surfaces.length) % surfaces.length] ?? surfaces[0]!;
    if (this.terminalMode) this.updateTerminalSurface(this.terminalMode);
    if (this.terminalMode && this.linkedExecutionTerminal)
      this.updateTerminalSurface(this.linkedExecutionTerminal);
    this.lastAction = `focused ${this.focusedSurface} surface`;
    this.requestRenderIfAlive();
  }

  private surfaceAt(x: number, y: number): SurfaceFocus | undefined {
    const layout = this.surfaceLayout;
    if (!layout) return undefined;
    if (layout.map && this.inRect(x, y, layout.map)) return "map";
    if (layout.primary && this.inRect(x, y, layout.primary)) return "primary";
    if (layout.linkedExecution && this.inRect(x, y, layout.linkedExecution))
      return "linkedExecution";
    return undefined;
  }

  private handleSurfaceMouseScroll(event: MouseEvent): void {
    if (this.modal || this.searchActive) return;
    const surface = this.surfaceAt(event.x, event.y);
    if (surface === "primary" || (surface === "linkedExecution" && this.linkedExecutionTerminal)) {
      this.focusedSurface = surface;
      this.handleTerminalMouseScroll(surface, event);
      return;
    }
    if (surface === "map") this.handleMouseScroll(event);
  }

  private async handoffSelected(): Promise<void> {
    const agent = this.selectedAgent(this.projection());
    if (!agent) {
      this.lastAction = "Select an agent for native handoff.";
      return;
    }
    if (this.busy) return;
    this.busy = true;
    const savedNavigation = {
      selected: this.selected,
      searchActive: this.searchActive,
      searchQuery: this.searchQuery,
      searchCursor: this.searchCursor,
      searchIndex: this.searchIndex,
      expandedGoals: new Set(this.expandedGoals),
      viewMode: this.viewMode,
      mapLens: this.mapLens,
      semanticZoom: this.semanticZoom,
      focusGoalId: this.focusGoalId,
      mapCenter: { ...this.mapCenter },
      mapZoom: this.mapZoom,
      mapFitPending: this.mapFitPending,
      inspectorVisible: this.inspectorVisible,
      scrollOffset: this.scrollOffset,
    };
    let refreshAfterReturn = false;
    let rendererSuspended = false;
    try {
      const access = await Effect.runPromise(
        this.options.host.access({
          hostKind: agent.hostKind,
          nativeId: agent.nativeId,
        }),
      );
      this.agentAccessById.set(agent.id, access);
      if (!hasAgentCapability(access, "native-handoff") || !access.target) {
        this.lastAction = access.supported
          ? `${agent.displayName} has no native handoff; use the embedded terminal.`
          : access.explanation;
        return;
      }
      this.lastAction = `opening native UI for ${agent.displayName} via ${displayHostKind(agent.hostKind)}…`;
      this.renderer.suspend();
      rendererSuspended = true;
      this.suspended = true;
      const result = await Effect.runPromise(this.options.host.activate(access));
      this.lastAction = result.message;
      refreshAfterReturn = result.ok;
    } catch (error) {
      this.lastAction = `native handoff failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (rendererSuspended && !this.renderer.isDestroyed) this.renderer.resume();
      this.suspended = false;
      this.selected = savedNavigation.selected;
      this.searchActive = savedNavigation.searchActive;
      this.searchQuery = savedNavigation.searchQuery;
      this.searchCursor = savedNavigation.searchCursor;
      this.searchIndex = savedNavigation.searchIndex;
      this.expandedGoals = new Set(savedNavigation.expandedGoals);
      this.viewMode = savedNavigation.viewMode;
      this.mapLens = savedNavigation.mapLens;
      this.semanticZoom = savedNavigation.semanticZoom;
      this.focusGoalId = savedNavigation.focusGoalId;
      this.mapCenter = { ...savedNavigation.mapCenter };
      this.mapZoom = savedNavigation.mapZoom;
      this.mapFitPending = savedNavigation.mapFitPending;
      this.inspectorVisible = savedNavigation.inspectorVisible;
      this.scrollOffset = savedNavigation.scrollOffset;
      this.busy = false;
      if (refreshAfterReturn) void this.refreshFromHost(false);
      this.requestRenderIfAlive();
    }
  }

  private handleMouse(event: MouseEvent): void {
    if (this.modal || this.searchActive) return;
    if (this.terminalMode || this.linkedExecutionTerminal) {
      if (event.type === "down") {
        const surface = this.surfaceAt(event.x, event.y);
        if (surface && surface !== "map") {
          event.preventDefault();
          this.focusedSurface = surface;
          if (this.terminalMode) this.updateTerminalSurface(this.terminalMode);
          if (this.linkedExecutionTerminal)
            this.updateTerminalSurface(this.linkedExecutionTerminal);
          this.requestRenderIfAlive();
          return;
        }
        if (this.presentationMode === "review") return;
      }
      if (event.type === "scroll") {
        this.handleSurfaceMouseScroll(event);
        return;
      }
    }
    if (event.type === "down" && this.contextMenu) {
      if (event.button === 0) {
        event.preventDefault();
        const menu = this.contextMenu;
        const rect = this.contextMenuFrame(this.renderer.width, this.renderer.height, menu);
        const firstActionY = rect.y + 2;
        const footerY = rect.y + rect.height - 2;
        const index = event.y - firstActionY;
        if (
          event.x >= rect.x &&
          event.x < rect.x + rect.width &&
          event.y >= firstActionY &&
          event.y < footerY &&
          index >= 0 &&
          index < menu.actions.length
        ) {
          this.contextMenu = { ...menu, index };
          const action = menu.actions[index];
          if (action) this.executeContextAction(action.id);
        } else {
          this.contextMenu = undefined;
          this.lastAction = "action menu closed";
          this.requestRenderIfAlive();
        }
        return;
      }
      if (event.button === 2) {
        event.preventDefault();
        this.openContextMenu(event.x, event.y, this.contextTargetAt(event.x, event.y));
        return;
      }
      return;
    }
    if (this.modal || this.searchActive) return;
    if (event.type === "down" && event.button === 2) {
      event.preventDefault();
      this.openContextMenu(event.x, event.y, this.contextTargetAt(event.x, event.y));
      return;
    }
    if (event.type === "down") {
      this.handleMouseDown(event);
      return;
    }
    if (event.type === "up" || event.type === "drag-end") {
      this.handleMouseDragEnd(event);
      return;
    }
    if (event.type === "move") this.handleMouseMove(event);
  }

  private contextTargetForHit(
    target: MapHitTarget | undefined,
  ): Selection | { readonly type: "inbox"; readonly id: "inbox" } | undefined {
    if (!target) return undefined;
    if (target.type === "inbox") return { type: "inbox", id: "inbox" };
    return { type: target.type, id: target.id };
  }

  private contextTargetAt(
    x: number,
    y: number,
  ): Selection | { readonly type: "inbox"; readonly id: "inbox" } | undefined {
    if (this.viewMode === "map") {
      return this.contextTargetForHit(
        this.mapRect && this.inRect(x, y, this.mapRect) ? this.nearestHit(x, y) : undefined,
      );
    }
    const rect = this.mapRect ?? layoutFor(this.renderer.width, this.renderer.height).list;
    if (!this.inRect(x, y, rect)) return undefined;
    const row = this.rows(this.projection())[this.scrollOffset + y - rect.y - 1];
    return row?.type === "goal" || row?.type === "agent"
      ? { type: row.type, id: row.id }
      : undefined;
  }

  private selectedMapAnchor(): MapHitTarget | undefined {
    if (!this.selected) {
      return this.mapLens === "inbox"
        ? this.hitTargets.find((target) => target.type === "inbox")
        : undefined;
    }
    return this.hitTargets.find(
      (target) => target.type === this.selected?.type && target.id === this.selected.id,
    );
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || !this.mapRect || !this.inRect(event.x, event.y, this.mapRect)) return;
    event.preventDefault();
    if (this.floatingInspectorRect && this.inRect(event.x, event.y, this.floatingInspectorRect))
      return;
    const target = this.nearestHit(event.x, event.y);
    this.dragState =
      target?.type === "goal"
        ? {
            kind: "goal",
            goalId: target.id,
            startX: event.x,
            startY: event.y,
            origin: this.goalPosition(target.id),
            lastX: event.x,
            lastY: event.y,
            moved: false,
          }
        : {
            kind: "pan",
            lastX: event.x,
            lastY: event.y,
            moved: false,
            clickTarget: target?.type === "inbox" ? "inbox" : undefined,
            clickSelection: target?.type === "agent" ? { type: "agent", id: target.id } : undefined,
          };
    if (!target) {
      this.lastGoalClick = undefined;
      this.lastAgentClick = undefined;
      this.setSelection(undefined);
      this.inspectorVisible = false;
      this.searchActive = false;
      this.searchQuery = "";
      this.searchCursor = 0;
      this.lastAction = "selection cleared";
      this.renderer.requestRender();
      return;
    }
    if (target.type !== "goal") this.lastGoalClick = undefined;
    if (target.type !== "agent") this.lastAgentClick = undefined;
    this.setSelection(target.type === "inbox" ? undefined : { type: target.type, id: target.id });
    this.inspectorVisible = true;
    this.searchActive = false;
    this.searchQuery = "";
    this.searchCursor = 0;
    this.lastAction = `mouse selected ${target.type} ${target.id}`;
    this.renderer.requestRender();
  }

  private handleMouseDrag(event: MouseEvent): void {
    const state = this.dragState;
    if (!state || !this.mapRect || this.viewMode !== "map") return;
    const deltaX = event.x - (state.kind === "goal" ? state.startX : state.lastX);
    const deltaY = event.y - (state.kind === "goal" ? state.startY : state.lastY);
    if (deltaX === 0 && deltaY === 0) return;
    if (state.kind === "goal") {
      this.lastGoalClick = undefined;
      const result = this.options.universe.execute({
        type: "SetGoalMapPosition",
        goalId: state.goalId,
        position: {
          x: state.origin.x + deltaX / Math.max(0.1, this.mapScaleX),
          y: state.origin.y + deltaY / Math.max(0.1, this.mapScaleY),
        },
        pinned: true,
      });
      this.dragState = {
        ...state,
        lastX: event.x,
        lastY: event.y,
        moved: true,
      };
      this.mapFitPending = false;
      this.lastAction = result.ok
        ? `moving goal ${state.goalId}`
        : (result.error ?? "goal move rejected");
    } else {
      this.lastAgentClick = undefined;
      this.mapCenter = panViewport(
        { center: this.mapCenter, zoom: this.mapZoom },
        { x: -deltaX, y: -deltaY },
        { x: this.mapScaleX, y: this.mapScaleY },
      ).center;
      this.mapFitPending = false;
      this.dragState = {
        ...state,
        lastX: event.x,
        lastY: event.y,
        moved: true,
      };
      this.lastAction = `mouse pan ${this.mapCenter.x.toFixed(0)},${this.mapCenter.y.toFixed(0)}`;
    }
    this.renderer.requestRender();
  }

  private handleMouseDragEnd(_event: MouseEvent): void {
    const state = this.dragState;
    if (!state) return;
    this.dragState = undefined;
    if (state.kind === "goal") {
      if (state.moved) {
        this.lastGoalClick = undefined;
        this.lastAction = `moved goal ${state.goalId}; satellites followed`;
      } else {
        const now = performance.now();
        const doubleClick =
          this.lastGoalClick?.id === state.goalId && now - this.lastGoalClick.at <= 350;
        this.lastGoalClick = doubleClick ? undefined : { id: state.goalId, at: now };
        if (doubleClick) this.focusGoal(state.goalId);
        else {
          this.lastAction = `selected goal ${state.goalId} · Enter or double-click to focus`;
          this.renderer.requestRender();
        }
      }
    } else if (!state.moved && state.clickSelection?.type === "agent") {
      this.lastGoalClick = undefined;
      const now = performance.now();
      const doubleClick =
        this.lastAgentClick?.id === state.clickSelection.id && now - this.lastAgentClick.at <= 350;
      this.lastAgentClick = doubleClick ? undefined : { id: state.clickSelection.id, at: now };
      if (doubleClick) void this.openTerminalSelected();
      else {
        this.lastAction = `selected agent · Enter or double-click to open terminal`;
        this.renderer.requestRender();
      }
    } else if (!state.moved && state.clickTarget === "inbox") {
      this.lastGoalClick = undefined;
      this.lastAgentClick = undefined;
      this.focusInbox();
    } else if (state.moved) {
      this.lastGoalClick = undefined;
      this.lastAgentClick = undefined;
      this.lastAction = "mouse pan complete";
    }
  }

  private handleMouseScroll(event: MouseEvent): void {
    if (!this.mapRect || !this.inRect(event.x, event.y, this.mapRect)) return;
    const direction = event.scroll?.direction;
    if (direction === "up" || event.button === 4)
      this.zoomMap(1.1, event.x, event.y, "mouse wheel");
    else if (direction === "down" || event.button === 5)
      this.zoomMap(0.9, event.x, event.y, "mouse wheel");
  }

  private handleMouseMove(event: MouseEvent): void {
    const target = this.nearestHit(event.x, event.y);
    this.hovered = target;
  }

  private nearestHit(x: number, y: number): MapHitTarget | undefined {
    let best: MapHitTarget | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.hitTargets) {
      const inBounds = target.bounds ? this.inRect(x, y, target.bounds) : false;
      const dx = (x - target.x) / Math.max(1, target.radiusX);
      const dy = (y - target.y) / Math.max(1, target.radiusY);
      const distance = inBounds ? -1 : dx * dx + dy * dy;
      const selected = target.type === this.selected?.type && target.id === this.selected?.id;
      const bestSelected = best
        ? best.type === this.selected?.type && best.id === this.selected?.id
        : false;
      if (
        (inBounds || distance <= 1.4) &&
        (distance < bestDistance || (distance === bestDistance && selected && !bestSelected))
      ) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  private inRect(x: number, y: number, rect: Rect): boolean {
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
  }

  private smokeSuspendResume(): void {
    if (this.suspended || this.closed) return;
    this.suspended = true;
    this.lastAction = "suspend cleanup path; returning in 800ms";
    this.renderer.suspend();
    this.suspendTimer = setTimeout(() => {
      if (this.closed || this.renderer.isDestroyed) return;
      this.renderer.resume();
      this.suspended = false;
      this.lastAction = "suspend/resume returned cleanly";
      this.renderer.requestRender();
    }, 800);
  }

  private findAgent(
    projection: CommandCentreProjection,
    id: string | undefined,
  ): AgentView | undefined {
    if (!id) return undefined;
    for (const goal of projection.goals) {
      const found = goal.agents.find((agent) => agent.id === id);
      if (found) return found;
    }
    return projection.unassigned.find((agent) => agent.id === id);
  }

  private priorityColor(priority: (typeof PRIORITIES)[number]): RGBA {
    switch (priority) {
      case "P0":
        return COLORS.red;
      case "P1":
        return COLORS.orange;
      case "P2":
        return COLORS.cyan;
      case "P3":
        return COLORS.muted;
    }
  }

  private goalFamilyColor(goalId: string): RGBA {
    const colors = [COLORS.cyan, COLORS.green, COLORS.yellow, COLORS.orange];
    let hash = 0;
    for (const character of goalId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length] ?? COLORS.cyan;
  }

  private withDrawClip<T>(clip: Rect, draw: () => T): T {
    const previous = this.drawClip;
    this.drawClip = clip;
    try {
      return draw();
    } finally {
      this.drawClip = previous;
    }
  }

  private visibleRect(rect: Rect): Rect | undefined {
    const clip = this.drawClip;
    const left = Math.max(0, clip?.x ?? 0, rect.x);
    const top = Math.max(0, clip?.y ?? 0, rect.y);
    const right = Math.min(
      this.renderer.width,
      clip ? clip.x + clip.width : this.renderer.width,
      rect.x + rect.width,
    );
    const bottom = Math.min(
      this.renderer.height,
      clip ? clip.y + clip.height : this.renderer.height,
      rect.y + rect.height,
    );
    if (right <= left || bottom <= top) return undefined;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  private fillRect(buffer: OptimizedBuffer, rect: Rect, background: RGBA): void {
    const visible = this.visibleRect(rect);
    if (visible) buffer.fillRect(visible.x, visible.y, visible.width, visible.height, background);
  }

  private textCentered(
    buffer: OptimizedBuffer,
    value: string,
    centerX: number,
    y: number,
    foreground: RGBA,
    background: RGBA,
    attributes = TextAttributes.NONE,
  ): void {
    this.text(
      buffer,
      value,
      centerX - Math.floor(value.length / 2),
      y,
      foreground,
      background,
      attributes,
    );
  }

  private roundedPanel(buffer: OptimizedBuffer, rect: Rect, background: RGBA, border: RGBA): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    this.fillRect(buffer, rect, background);
    if (rect.width === 1 || rect.height === 1) {
      this.cell(buffer, rect.x, rect.y, "·", border, background);
      return;
    }
    this.hline(buffer, rect.x + 1, rect.y, rect.width - 2, "─", border, background);
    this.hline(
      buffer,
      rect.x + 1,
      rect.y + rect.height - 1,
      rect.width - 2,
      "─",
      border,
      background,
    );
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 1) {
      this.cell(buffer, rect.x, y, "│", border, background);
      this.cell(buffer, rect.x + rect.width - 1, y, "│", border, background);
    }
    this.cell(buffer, rect.x, rect.y, "╭", border, background);
    this.cell(buffer, rect.x + rect.width - 1, rect.y, "╮", border, background);
    this.cell(buffer, rect.x, rect.y + rect.height - 1, "╰", border, background);
    this.cell(buffer, rect.x + rect.width - 1, rect.y + rect.height - 1, "╯", border, background);
  }

  private panel(buffer: OptimizedBuffer, rect: Rect, background: RGBA, border: RGBA): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    this.fillRect(buffer, rect, background);
    if (rect.width < 2 || rect.height < 2) return;
    this.hline(buffer, rect.x + 1, rect.y, rect.width - 2, "─", border, background);
    this.hline(
      buffer,
      rect.x + 1,
      rect.y + rect.height - 1,
      rect.width - 2,
      "─",
      border,
      background,
    );
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 1) {
      this.cell(buffer, rect.x, y, "│", border, background);
      this.cell(buffer, rect.x + rect.width - 1, y, "│", border, background);
    }
    this.cell(buffer, rect.x, rect.y, "╭", border, background);
    this.cell(buffer, rect.x + rect.width - 1, rect.y, "╮", border, background);
    this.cell(buffer, rect.x, rect.y + rect.height - 1, "╰", border, background);
    this.cell(buffer, rect.x + rect.width - 1, rect.y + rect.height - 1, "╯", border, background);
  }

  private hline(
    buffer: OptimizedBuffer,
    x: number,
    y: number,
    width: number,
    glyph: string,
    foreground: RGBA,
    background: RGBA,
  ): void {
    for (let offset = 0; offset < width; offset += 1)
      this.cell(buffer, x + offset, y, glyph, foreground, background);
  }

  private cell(
    buffer: OptimizedBuffer,
    x: number,
    y: number,
    glyph: string,
    foreground: RGBA,
    background: RGBA,
    attributes = TextAttributes.NONE,
  ): void {
    const clip = this.drawClip;
    if (
      x < 0 ||
      y < 0 ||
      x >= this.renderer.width ||
      y >= this.renderer.height ||
      (clip !== undefined &&
        (x < clip.x || x >= clip.x + clip.width || y < clip.y || y >= clip.y + clip.height))
    )
      return;
    buffer.setCell(x, y, glyph, foreground, background, attributes);
  }

  private text(
    buffer: OptimizedBuffer,
    value: string,
    x: number,
    y: number,
    foreground: RGBA,
    background: RGBA,
    attributes = TextAttributes.NONE,
  ): void {
    if (y < 0 || y >= this.renderer.height) return;
    const clip = this.drawClip;
    if (clip && (y < clip.y || y >= clip.y + clip.height)) return;
    const left = Math.max(0, clip?.x ?? 0);
    const right = Math.min(this.renderer.width, clip ? clip.x + clip.width : this.renderer.width);
    const startX = Math.max(x, left);
    const sourceOffset = Math.max(0, left - x);
    const available = Math.min(value.length - sourceOffset, right - startX);
    if (available <= 0) return;
    buffer.drawText(
      value.slice(sourceOffset, sourceOffset + available),
      startX,
      y,
      foreground,
      background,
      attributes,
    );
  }

  private textRight(
    buffer: OptimizedBuffer,
    value: string,
    right: number,
    y: number,
    foreground: RGBA,
    background: RGBA,
    attributes = TextAttributes.NONE,
  ): void {
    this.text(
      buffer,
      value,
      Math.max(0, right - value.length),
      y,
      foreground,
      background,
      attributes,
    );
  }
}

export const createCommandCentreRenderer = async (
  options: CommandCentreDependencies,
): Promise<CommandCentreApp> => {
  let app: CommandCentreApp | undefined;
  const renderer = await createCliRenderer({
    targetFps: 30,
    maxFps: 60,
    gatherStats: true,
    maxStatSamples: 180,
    useMouse: true,
    autoFocus: false,
    exitOnCtrlC: true,
    clearOnShutdown: true,
    onDestroy: () => {
      app?.dispose();
      options.onClose?.();
    },
  });
  app = new CommandCentreApp({ ...options, renderer });
  return app;
};
