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
  hasSessionCapability,
  type HostLaunchOption,
  type HostedTerminalSession,
  type HostTerminalEvent,
  type HostTerminalInput,
  type SessionAccess,
  type SessionHost,
  type TerminalDimensions,
} from "../hosts/types.ts";
import type { HostError } from "../hosts/errors.ts";
import { layoutFor, type Rect } from "./layout.ts";
import type {
  CommandCentreProjection,
  GoalView,
  InspectorProjection,
  MapGoalView,
  MapSessionView,
  SessionView,
  UniverseMapProjection,
} from "../projection/types.ts";
import type { Universe, UniverseCommand } from "../universe/universe.ts";
import { PRIORITIES, priorityRank, type Clock, type MapPosition } from "../universe/types.ts";
import {
  fitViewportToPoints,
  panViewport,
  screenPointForWorld,
  zoomViewportAt,
} from "../spatial/viewport.ts";
import { sessionSatellitePositions, unassignedSessionPositions } from "../spatial/positions.ts";
import { placeFloatingInspector } from "./inspector-placement.ts";
import { filterAssignableSessions } from "./assignment.ts";
import { editText, insertTextAtCursor, typedCharacter } from "./input.ts";
import { modalFrameFor } from "./modal.ts";
import { mapSelectionCandidates, nextNavigationSelection } from "./navigation.ts";
import { ensureTerminalDimensions, TerminalScreen, TERMINAL_COLORS } from "./terminal-screen.ts";
import {
  nextSemanticZoom,
  perspectiveNodeScale,
  isRecentlyDone,
  semanticZoomLevel,
  sessionLabelBudget,
  sessionMarker,
  goalLabelBudget,
  type SemanticZoomLevel,
} from "./semantic-zoom.ts";
import type { StartSessionCoordinator, StartSessionIntent } from "../session-launch/types.ts";
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

const MAP_FIT_PADDING_X = 26;
const MAP_FIT_PADDING_Y = 8;
const MAP_LABEL_ZOOM_THRESHOLD = 0.85;
const DENSE_FOCUS_SESSION_THRESHOLD = 8;
const DENSE_FOCUS_COMPACT_ZOOM = 1.45;

type Selection = { readonly type: "goal" | "session"; readonly id: string };
type Row = Selection | { readonly type: "inbox-label"; readonly id: "inbox-label" };

type MapLens = "portfolio" | "attention" | "goal" | "inbox";
type ViewMode = "map" | "list";
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
  | "inspect"
  | "new-goal"
  | "new-session"
  | "assign"
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
  readonly scope: "selection" | "inbox" | "empty";
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

type SessionLaunchModal = {
  readonly kind: "session-launch";
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
  readonly sessionName: string;
  readonly prompt: string;
};

type WorkspacePickerModal = {
  readonly kind: "workspace-picker";
  readonly browser: WorkspaceBrowser;
  readonly index: number;
  readonly loading: boolean;
  readonly returnTo: SessionLaunchModal;
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
      readonly action:
        | "rename-goal"
        | "rename-session"
        | "description-goal"
        | "description-session";
    }
  | {
      readonly kind: "goal-picker";
      readonly sessionId: string;
      readonly index: number;
    }
  | {
      readonly kind: "session-picker";
      readonly goalId: string;
      readonly index: number;
      readonly query: string;
    }
  | SessionLaunchModal
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
      readonly action: "archive-session";
      readonly sessionId: string;
      readonly title: string;
    };

type TerminalMode = {
  readonly sessionId: string;
  readonly displayName: string;
  readonly hostLabel: string;
  readonly terminal: HostedTerminalSession;
  readonly screen: TerminalScreen;
  dimensions: TerminalDimensions;
  status: string;
  closed: boolean;
};

export interface CommandCentreAppOptions {
  readonly universe: Universe;
  readonly host: SessionHost;
  readonly startSession: StartSessionCoordinator;
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

const statusGlyph = (session: SessionView, phase = 0): string => {
  return sessionMarker(session.hostHealth, session.runtimeState, phase);
};

const statusColor = (session: SessionView, recentlyDone = false): RGBA => {
  if (session.hostHealth !== "live") return COLORS.yellow;
  if (session.runtimeState === "blocked") return COLORS.red;
  if (session.runtimeState === "waiting") return COLORS.orange;
  if (session.runtimeState === "working") return COLORS.green;
  if (session.runtimeState === "done") return recentlyDone ? COLORS.green : COLORS.completed;
  return COLORS.muted;
};

export class CommandCentreApp {
  private readonly canvas: FrameBufferRenderable;
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
  private lastSessionClick: GoalClick | undefined;
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
  private terminalPanel: BoxRenderable | undefined;
  private terminalText: TextRenderable | undefined;
  private pickerSelect: SelectRenderable | undefined;
  private pickerMode: "agent" | "workspace" | undefined;
  private readonly sessionAccessById = new Map<string, SessionAccess>();
  private readonly sessionAccessRequests = new Set<string>();

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
      onMouseScroll: (event) =>
        this.terminalMode ? this.handleTerminalMouseScroll(event) : this.handleMouseScroll(event),
    });
    this.canvas.renderBefore = (_buffer, deltaTime) => this.renderFrame(deltaTime);
    this.renderer.root.add(this.canvas);
    this.renderer.on("resize", (width: number, height: number) => {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.terminalMode) void this.resizeTerminal(width, height);
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

  private pickerOptions(modal: Modal, mode: "agent" | "workspace"): SelectOption[] {
    if (mode === "workspace" && modal.kind === "workspace-picker")
      return this.workspacePickerRows(modal).map((entry) => ({
        name: entry.kind === "workspace" ? entry.label : `${entry.label}/`,
        description:
          entry.kind === "workspace"
            ? "Use this directory for the new session"
            : entry.repository
              ? `${entry.repository}${entry.branch ? ` · ${entry.branch}` : ""}`
              : "Open directory",
        value: entry,
      }));
    if (mode === "agent" && modal.kind === "session-launch")
      return modal.agentOptions.map((option) => ({
        name: option.label,
        description: option.description ?? option.kind,
        value: option.kind,
      }));
    return [];
  }

  private pickerNavigationKey(key: KeyEvent): boolean {
    return ["up", "down", "j", "k", "enter", "return", "linefeed"].includes(key.name);
  }

  private syncPickerSurface(width: number, height: number): void {
    const modal = this.modal;
    const mode: "agent" | "workspace" | undefined =
      modal?.kind === "workspace-picker" && !modal.loading
        ? "workspace"
        : modal?.kind === "session-launch" &&
            modal.field === "agent" &&
            modal.agentOptions.length > 0
          ? "agent"
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
        : frame.y + (modal.kind === "session-launch" && modal.workspaceMode === "worktree" ? 7 : 6);
    const pickerHeight =
      mode === "workspace"
        ? Math.max(1, frame.footerY - top)
        : Math.max(1, Math.min(6, options.length, frame.footerY - top));
    const selectedIndex =
      mode === "workspace" && modal.kind === "workspace-picker"
        ? modal.index
        : modal.kind === "session-launch"
          ? modal.agentIndex
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

  private handlePickerSelection(mode: "agent" | "workspace", index: number): void {
    const modal = this.modal;
    if (mode === "workspace" && modal?.kind === "workspace-picker") {
      this.modal = { ...modal, index };
    } else if (mode === "agent" && modal?.kind === "session-launch") {
      const option = modal.agentOptions[index];
      if (option)
        this.modal = {
          ...modal,
          agentIndex: index,
          agentKind: option.kind,
        };
    }
    this.requestRenderIfAlive();
  }

  private handlePickerItemSelected(mode: "agent" | "workspace", index: number): void {
    const modal = this.modal;
    if (mode === "workspace" && modal?.kind === "workspace-picker") {
      this.chooseWorkspaceFromPicker({ ...modal, index });
      this.requestRenderIfAlive();
      return;
    }
    if (mode === "agent" && modal?.kind === "session-launch") {
      const option = modal.agentOptions[index];
      if (!option) return;
      const next = { ...modal, agentIndex: index, agentKind: option.kind };
      this.advanceLaunchField(next, 1);
      this.requestRenderIfAlive();
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
      if (!this.closed && !this.busy && !this.terminalMode) void this.refreshFromHost(false);
    }, 2_500);
    this.renderer.start();
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.destroyPickerSurface();
    const terminal = this.terminalMode?.terminal;
    this.terminalMode = undefined;
    if (terminal) void Effect.runPromise(terminal.release()).catch(() => undefined);
    this.refreshTimer = undefined;
    this.suspendTimer = undefined;
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.terminalMode) void this.releaseTerminal();
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

  private requestSessionAccess(session: SessionView | undefined): void {
    if (
      !session ||
      this.sessionAccessById.has(session.id) ||
      this.sessionAccessRequests.has(session.id)
    )
      return;
    this.sessionAccessRequests.add(session.id);
    void Effect.runPromise(
      this.options.host.access({
        hostKind: session.hostKind,
        nativeId: session.nativeId,
      }),
    )
      .then((access) => {
        if (this.closed) return;
        this.sessionAccessById.set(session.id, access);
        this.requestRenderIfAlive();
      })
      .catch((error) => {
        if (this.closed) return;
        this.sessionAccessById.set(session.id, {
          supported: false,
          capabilities: [],
          explanation: `Session capabilities unavailable: ${error instanceof Error ? error.message : String(error)}`,
        });
        this.requestRenderIfAlive();
      })
      .finally(() => this.sessionAccessRequests.delete(session.id));
  }

  private sessionCapabilityLine(access: SessionAccess): string {
    if (!access.supported) return "surfaces unavailable";
    const labels = access.capabilities.map((capability) =>
      capability === "embedded-terminal" ? "embedded terminal" : "native handoff",
    );
    return labels.length > 0 ? `surfaces ${labels.join(" · ")}` : "surfaces unavailable";
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
    if (this.viewMode === "map" && this.mapLens === "inbox")
      return projection.unassigned.map((session) => ({
        type: "session",
        id: session.id,
      }));
    if (this.viewMode === "map" && this.mapLens === "attention") {
      const rows: Row[] = [];
      for (const goal of projection.goals) {
        if (goal.attentionCount === 0 && goal.staleCount === 0) continue;
        rows.push({ type: "goal", id: goal.id });
        for (const session of goal.sessions) {
          if (session.attention) rows.push({ type: "session", id: session.id });
        }
      }
      const attentionInbox = projection.unassigned.filter((session) => session.attention);
      if (attentionInbox.length > 0) {
        rows.push({ type: "inbox-label", id: "inbox-label" });
        for (const session of attentionInbox) rows.push({ type: "session", id: session.id });
      }
      return rows;
    }
    const rows: Row[] = [];
    for (const goal of projection.goals) {
      rows.push({ type: "goal", id: goal.id });
      if (this.viewMode === "map" || this.expandedGoals.has(goal.id) || this.mapLens === "goal") {
        for (const session of goal.sessions) rows.push({ type: "session", id: session.id });
      }
    }
    const includeInboxRows =
      this.viewMode !== "map" || this.mapLens === "attention" || this.mapLens === "inbox";
    if (projection.unassigned.length > 0 && includeInboxRows) {
      rows.push({ type: "inbox-label", id: "inbox-label" });
      for (const session of projection.unassigned) rows.push({ type: "session", id: session.id });
    }
    return rows;
  }

  private ensureSelection(projection: CommandCentreProjection): Row[] {
    const rows = this.rows(projection);
    const selectable = rows.filter(
      (row): row is Selection => row.type === "goal" || row.type === "session",
    );
    if (!this.selected && this.viewMode === "map" && this.mapLens === "inbox") {
      this.scrollOffset = 0;
      return rows;
    }
    if (
      !this.selected ||
      !selectable.some((row) => row.type === this.selected?.type && row.id === this.selected.id)
    ) {
      const first = selectable[0];
      this.selected = first ? { type: first.type, id: first.id } : undefined;
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

  private selectedSession(projection: CommandCentreProjection): SessionView | undefined {
    if (!this.selected || this.selected.type !== "session") return undefined;
    for (const goal of projection.goals) {
      const session = goal.sessions.find((candidate) => candidate.id === this.selected?.id);
      if (session) return session;
    }
    return projection.unassigned.find((session) => session.id === this.selected?.id);
  }

  private inspector(): InspectorProjection {
    if (!this.selected)
      return {
        kind: "empty-inspector",
        lines: ["No accepted goals or sessions yet."],
      };
    const projection = this.options.universe.project({
      kind: "inspector",
      now: this.options.clock.now(),
      target: this.selected,
    });
    if (
      projection.kind !== "goal-inspector" &&
      projection.kind !== "session-inspector" &&
      projection.kind !== "empty-inspector"
    )
      throw new Error("Universe returned an unexpected inspector projection.");
    if (projection.kind === "session-inspector") {
      const access = this.sessionAccessById.get(projection.session.id);
      if (access)
        return {
          ...projection,
          lines: [...projection.lines, this.sessionCapabilityLine(access)],
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
          `${count} unassigned sessions`,
          "select a session for host facts",
          "t/Enter opens the selected session in the terminal",
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
    buffer.clear(COLORS.background);
    if (this.terminalMode) {
      this.drawTerminalBackdrop(buffer, width, height);
      return;
    }
    const projection = this.projection();
    const rows = this.ensureSelection(projection);
    this.requestSessionAccess(this.selectedSession(projection));
    const layout = layoutFor(width, height);
    this.mapRect = layout.map;
    this.mapSurface = undefined;
    this.floatingInspectorRect = undefined;
    this.hitTargets = [];
    this.drawHeader(buffer, layout.header, projection);
    this.drawAttention(buffer, layout.attention, projection, deltaTime);
    if (this.viewMode === "map") {
      this.drawMap(buffer, layout.map, this.mapProjection());
      if (this.inspectorVisible)
        this.drawFloatingInspector(
          buffer,
          this.mapSurface ?? layout.map,
          this.floatingInspector(),
          this.selectedMapAnchor(),
          this.hitTargets.flatMap((target) => {
            const bounds = target.bounds ?? {
              x: target.x - target.radiusX,
              y: target.y - target.radiusY,
              width: target.radiusX * 2 + 1,
              height: target.radiusY * 2 + 1,
            };
            return [bounds];
          }),
        );
    } else {
      this.drawList(buffer, layout.list, projection, rows);
      if (this.inspectorVisible)
        this.drawFloatingInspector(buffer, layout.list, this.floatingInspector(), undefined);
    }
    this.drawFooter(buffer, layout.footer, projection);
    if (this.searchActive || this.modal || this.contextMenu)
      this.drawOverlay(buffer, width, height, projection);
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

  private drawTerminalBackdrop(buffer: OptimizedBuffer, width: number, height: number): void {
    this.text(
      buffer,
      "OBSERVATORY  /  EMBEDDED TERMINAL",
      2,
      0,
      COLORS.white,
      COLORS.background,
      TextAttributes.BOLD,
    );
    const mode = this.terminalMode;
    if (!mode) return;
    this.text(
      buffer,
      `${mode.displayName} · ${mode.closed ? "stream closed" : `live ${mode.hostLabel} stream`}`,
      2,
      1,
      mode.closed ? COLORS.orange : COLORS.muted,
      COLORS.background,
    );
    if (width > 0 && height > 0) {
      this.textRight(
        buffer,
        `${mode.dimensions.columns}×${mode.dimensions.rows}`,
        width - 2,
        1,
        COLORS.faint,
        COLORS.background,
      );
    }
    if (height >= 2) {
      const footer = { x: 0, y: height - 2, width, height: 2 };
      this.panel(buffer, footer, COLORS.background, COLORS.border);
      this.text(
        buffer,
        "Ctrl-Shift-C copy  ·  Ctrl-Q/Esc release  ·  all other keys route to session",
        2,
        footer.y,
        COLORS.muted,
        COLORS.background,
      );
      this.text(
        buffer,
        shorten(mode.status, Math.max(1, width - 4)),
        2,
        footer.y + 1,
        mode.closed ? COLORS.orange : COLORS.faint,
        COLORS.background,
      );
    }
  }

  private createTerminalSurface(mode: TerminalMode): void {
    this.destroyTerminalSurface();
    const panel = new BoxRenderable(this.renderer, {
      id: "ao-embedded-terminal-panel",
      position: "absolute",
      left: 1,
      top: 2,
      width: Math.max(1, this.renderer.width - 2),
      height: Math.max(1, this.renderer.height - 5),
      border: true,
      borderColor: COLORS.borderStrong,
      backgroundColor: TERMINAL_COLORS.background,
      title: ` ${mode.displayName} `,
      titleColor: COLORS.cyan,
      zIndex: 20,
      onMouseScroll: (event) => this.handleTerminalMouseScroll(event),
    });
    const text = new TextRenderable(this.renderer, {
      id: "ao-embedded-terminal-text",
      position: "absolute",
      left: 2,
      top: 3,
      width: Math.max(1, this.renderer.width - 4),
      height: Math.max(1, this.renderer.height - 7),
      content: mode.screen.toStyledText(),
      fg: TERMINAL_COLORS.text,
      bg: TERMINAL_COLORS.background,
      selectionBg: COLORS.borderStrong,
      selectionFg: COLORS.background,
      selectable: true,
      zIndex: 21,
      onMouseScroll: (event) => this.handleTerminalMouseScroll(event),
    });
    this.renderer.root.add(panel);
    this.renderer.root.add(text);
    this.terminalPanel = panel;
    this.terminalText = text;
  }

  private destroyTerminalSurface(): void {
    const panel = this.terminalPanel;
    const text = this.terminalText;
    this.terminalPanel = undefined;
    this.terminalText = undefined;
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
    if (this.terminalText && !this.terminalText.isDestroyed)
      this.terminalText.content = mode.screen.toStyledText();
    if (this.terminalPanel && !this.terminalPanel.isDestroyed)
      this.terminalPanel.title = ` ${mode.displayName} `;
  }

  private resizeTerminalSurface(): void {
    if (this.terminalPanel && !this.terminalPanel.isDestroyed) {
      this.terminalPanel.width = Math.max(1, this.renderer.width - 2);
      this.terminalPanel.height = Math.max(1, this.renderer.height - 5);
    }
    if (this.terminalText && !this.terminalText.isDestroyed) {
      this.terminalText.width = Math.max(1, this.renderer.width - 4);
      this.terminalText.height = Math.max(1, this.renderer.height - 7);
    }
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
    const counts = `${countLabel(projection.counts.goals, "goal")} · ${countLabel(projection.counts.sessions, "session")} · ${projection.counts.unassigned} inbox`;
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
        : `${this.viewMode === "map" ? "map" : "list lens"} · ${this.lastAction}`;
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
      const session = this.findSession(projection, current.sessionId);
      const text = `ATTENTION ! ${session?.displayName ?? current.targetId} · ${current.reason} · waiting ${formatAge(current.ageMs)} · ${current.explanation}`;
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
        : "ATTENTION clear · no current human-input sessions";
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
      const positions = sessionSatellitePositions(goal.mapPosition, goal.id, [
        ...goal.sessions.map((session) => session.id),
        pending.id,
      ]);
      const position = positions.get(pending.id);
      return position ? { pending, goal, position } : undefined;
    }
    const positions = unassignedSessionPositions(projection.inboxPosition, [
      ...projection.unassigned.map((session) => session.id),
      pending.id,
    ]);
    const position = positions.get(pending.id);
    return position ? { pending, position } : undefined;
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
    const visibleSessions = (goal: MapGoalView): readonly MapSessionView[] =>
      attentionLens ? goal.sessions.filter((session) => session.attention) : goal.sessions;
    const visibleUnassigned = attentionLens
      ? projection.unassigned.filter((session) => session.attention)
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
        ...visibleSessions(goal).map((session) => session.mapPosition),
      ]),
      ...(showInbox && visibleUnassigned.length > 0 && !compactInbox
        ? [projection.inboxPosition, ...visibleUnassigned.map((session) => session.mapPosition)]
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
        ? `FOCUS · ${focusGoal.title} · ${countLabel(focusGoal.sessions.length, "satellite")}`
        : focusInbox
          ? `FOCUS · INBOX · ${countLabel(projection.unassigned.length, "session")}`
          : attentionLens
            ? `ATTENTION LENS · ${projection.counts.attention} current · ${projection.counts.uncertainty} uncertain`
            : `UNIVERSE MAP · ${countLabel(projection.goals.length, "goal body", "goal bodies")} · ${countLabel(projection.counts.sessions, "session")} · ${projection.counts.unassigned} inbox`;
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
        "No goals or live sessions yet — n creates a goal · N launches a session.",
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
        "Create a goal with n, then press a to assign sessions from the inbox.",
        mapSurface.x + 2,
        mapSurface.y + Math.floor(mapSurface.height / 2),
        COLORS.muted,
        COLORS.background,
      );
    }

    for (const goal of goals) {
      const goalPoint = worldToScreen(goal.mapPosition);
      for (const session of visibleSessions(goal)) {
        const sessionPoint = worldToScreen(session.mapPosition);
        this.drawMapLink(buffer, goalPoint, sessionPoint, mapSurface, goal, session);
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
      for (const session of visibleUnassigned)
        this.drawMapLink(
          buffer,
          inboxPoint,
          worldToScreen(session.mapPosition),
          mapSurface,
          undefined,
          session,
        );
      this.withDrawClip(mapSurface, () =>
        this.drawMapInboxBody(buffer, map, inboxPoint, visibleUnassigned),
      );
    }
    this.withDrawClip(mapSurface, () => {
      for (const goal of goals) {
        for (const session of visibleSessions(goal))
          if (!(this.selected?.type === "session" && this.selected.id === session.id))
            this.drawMapSession(
              buffer,
              mapSurface,
              worldToScreen(session.mapPosition),
              goal,
              session,
            );
      }
      if (showInbox && !compactInbox)
        for (const session of visibleUnassigned)
          if (!(this.selected?.type === "session" && this.selected.id === session.id))
            this.drawMapSession(
              buffer,
              mapSurface,
              worldToScreen(session.mapPosition),
              undefined,
              session,
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
      if (this.selected?.type === "session") {
        for (const goal of goals) {
          const session = visibleSessions(goal).find(
            (candidate) => candidate.id === this.selected?.id,
          );
          if (session)
            this.drawMapSession(
              buffer,
              mapSurface,
              worldToScreen(session.mapPosition),
              goal,
              session,
            );
        }
        if (showInbox && !compactInbox) {
          const session = visibleUnassigned.find((candidate) => candidate.id === this.selected?.id);
          if (session)
            this.drawMapSession(
              buffer,
              mapSurface,
              worldToScreen(session.mapPosition),
              undefined,
              session,
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
        "f portfolio · 0 reset view · t/Enter terminal · selected session opens directly",
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
    session: MapSessionView,
  ): void {
    const x1 = Math.round(to.x);
    const y1 = Math.round(to.y);
    let x0 = Math.round(from.x);
    let y0 = Math.round(from.y);
    if (x0 === x1 && y0 === y1) return;
    const selected = this.selected?.type === "session" && this.selected.id === session.id;
    const recentlyDone = this.sessionRecentlyDone(session);
    const linkColor = session.attention
      ? session.attention.requiresHumanInput
        ? session.runtimeState === "blocked"
          ? COLORS.red
          : COLORS.orange
        : COLORS.yellow
      : selected
        ? COLORS.selected
        : recentlyDone
          ? COLORS.green
          : goal
            ? this.goalFamilyColor(goal.id)
            : COLORS.connector;
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
      if (session.attention || selected || pathStep % 2 === 0) paint(x0, y0);
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
    sessions: readonly MapSessionView[],
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
    this.textCentered(
      buffer,
      `${sessions.length}`,
      point.x,
      point.y + 1,
      COLORS.muted,
      COLORS.panel,
    );
  }

  private drawCompactInbox(
    buffer: OptimizedBuffer,
    map: Rect,
    sessions: readonly MapSessionView[],
    attentionLens = false,
  ): void {
    const columns = map.width >= 72 ? 3 : map.width >= 50 ? 2 : 1;
    const columnWidth = Math.max(12, Math.floor((map.width - 6) / columns));
    const panel = {
      x: map.x + 1,
      y: map.y + 1,
      width: Math.min(map.width - 2, columns * columnWidth + 2),
      height: this.compactInboxHeight(map, sessions.length),
    };
    if (panel.width < 8 || panel.height < 3) return;
    this.panel(buffer, panel, COLORS.panel, COLORS.border);
    // Reserve the header row for the neutral inbox lens. Session rows below
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
      attentionLens
        ? `INBOX · ${sessions.length} attention`
        : `INBOX · ${sessions.length} unassigned`,
      panel.x + 2,
      panel.y,
      COLORS.yellow,
      COLORS.panel,
      TextAttributes.BOLD,
    );
    const visibleRows = Math.max(0, panel.height - 2);
    for (const [index, session] of sessions.entries()) {
      const column = Math.floor(index / Math.max(1, visibleRows));
      const row = index % Math.max(1, visibleRows);
      if (column >= columns) break;
      const x = panel.x + 2 + column * columnWidth;
      const y = panel.y + 1 + row;
      const selected = this.selected?.type === "session" && this.selected.id === session.id;
      const recentlyDone = this.sessionRecentlyDone(session);
      const glyph = statusGlyph(session, this.animationPhase);
      const label = `${glyph === " " ? "·" : glyph} ${shorten(session.displayName, columnWidth - (recentlyDone ? 12 : 4))}${recentlyDone ? " · review" : ""}`;
      this.text(
        buffer,
        label,
        x,
        y,
        selected ? COLORS.white : statusColor(session, recentlyDone),
        COLORS.panel,
        selected ? TextAttributes.BOLD : TextAttributes.NONE,
      );
      this.hitTargets.push({
        type: "session",
        id: session.id,
        x: x + Math.floor(Math.min(columnWidth - 1, label.length) / 2),
        y,
        radiusX: Math.max(2, Math.floor(columnWidth / 2)),
        radiusY: 1,
      });
    }
  }

  private compactInboxHeight(map: Rect, sessionCount: number): number {
    const columns = map.width >= 72 ? 3 : map.width >= 50 ? 2 : 1;
    const rows = Math.ceil(sessionCount / columns);
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
    const selectedSession =
      this.selected?.type === "session" &&
      goal.sessions.some((session) => session.id === this.selected?.id);
    const goalAttention = goal.attentionCount > 0 || goal.staleCount > 0;
    const compact =
      this.semanticZoom === "overview" &&
      this.mapZoom < MAP_LABEL_ZOOM_THRESHOLD &&
      !selected &&
      !selectedSession &&
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
    const emphasis = selected || selectedSession || goalAttention;
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
      : selectedSession
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
        `${goal.sessions.length}s`,
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

  private drawMapSession(
    buffer: OptimizedBuffer,
    map: Rect,
    point: { readonly x: number; readonly y: number },
    goal: MapGoalView | undefined,
    session: MapSessionView,
  ): void {
    const selected = this.selected?.type === "session" && this.selected.id === session.id;
    const inboxSession = goal === undefined;
    const attention = session.attention !== undefined;
    const recentlyDone = this.sessionRecentlyDone(session);
    const denseGoalFocus =
      !inboxSession &&
      this.mapLens === "goal" &&
      (goal?.sessions.length ?? 0) >= DENSE_FOCUS_SESSION_THRESHOLD;
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
      const marker = statusGlyph(session, this.animationPhase);
      const markerColor = statusColor(session, recentlyDone);
      const bounds = { x: point.x - 1, y: point.y - 1, width: 3, height: 3 };
      this.roundedPanel(buffer, bounds, COLORS.background, markerColor);
      this.cell(buffer, point.x, point.y, marker, markerColor, COLORS.background);
      this.hitTargets.push({
        type: "session",
        id: session.id,
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
      Math.floor(sessionLabelBudget(level, this.renderer.width, inboxSession) * nodeScale),
    );
    const marker = statusGlyph(session, this.animationPhase);
    const titleLines =
      level === "detail"
        ? selected
          ? wrapFully(session.displayName, Math.max(8, labelWidth - 2))
          : wrap(session.displayName, Math.max(8, labelWidth - 2)).slice(0, 2)
        : [shorten(session.displayName, Math.max(3, labelWidth - 2))];
    const labelLines = titleLines.map((title, index) =>
      index === 0 ? `${marker} ${title}` : title,
    );
    if (level === "detail" || recentlyDone)
      labelLines.push(
        recentlyDone
          ? `done ${formatAge(Math.max(0, this.options.clock.now() - session.lastChangedAt))} · review`
          : session.attention
            ? `${session.attention.reason} ${formatAge(session.attention.ageMs)}`
            : `${session.runtimeState} · ${session.provider ?? session.hostKind}`,
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
            ? inboxSession
              ? 16
              : 15
            : inboxSession
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
    const working = session.hostHealth === "live" && session.runtimeState === "working";
    const workingPulse = Math.sin(this.animationPhase * Math.PI * 2) > 0;
    const border = selected
      ? COLORS.white
      : session.attention
        ? statusColor(session, recentlyDone)
        : recentlyDone
          ? COLORS.green
          : working
            ? workingPulse
              ? COLORS.green
              : COLORS.faint
            : goal
              ? this.goalFamilyColor(goal.id)
              : COLORS.yellow;
    this.roundedPanel(buffer, bounds, background, border);
    const firstLineY = point.y - Math.floor(labelLines.length / 2);
    for (const [index, line] of labelLines.entries())
      this.textCentered(
        buffer,
        line,
        point.x,
        firstLineY + index,
        index === labelLines.length - 1 && (session.attention || recentlyDone)
          ? statusColor(session, recentlyDone)
          : selected
            ? COLORS.white
            : statusColor(session, recentlyDone),
        background,
        selected ? TextAttributes.BOLD : TextAttributes.NONE,
      );
    this.hitTargets.push({
      type: "session",
      id: session.id,
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
        : projection.kind === "session-inspector"
          ? `SESSION · ${projection.session.displayName}`
          : "INSPECTOR";
    const denseFocus = this.focusedGoalSessionCount() >= DENSE_FOCUS_SESSION_THRESHOLD;
    const minimumWidth = inboxCard
      ? 34
      : projection.kind === "session-inspector"
        ? denseFocus
          ? 38
          : 46
        : 38;
    const maximumWidth = inboxCard
      ? 34
      : projection.kind === "session-inspector"
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
    const panel = placeFloatingInspector(
      rect,
      { width, height },
      anchor,
      denseFocus
        ? mapObstacles
        : anchor
          ? [
              anchor.bounds ?? {
                x: anchor.x - anchor.radiusX,
                y: anchor.y - anchor.radiusY,
                width: anchor.radiusX * 2 + 1,
                height: anchor.radiusY * 2 + 1,
              },
            ]
          : [],
    );
    this.floatingInspectorRect = panel;
    const border = inboxCard
      ? COLORS.yellow
      : projection.kind === "session-inspector"
        ? statusColor(projection.session, this.sessionRecentlyDone(projection.session))
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
        : projection.kind === "session-inspector"
          ? "i close · t/Enter terminal · o native"
          : "i close · f focus",
      panel.x + 2,
      panel.y + panel.height - 1,
      COLORS.faint,
      COLORS.panelRaised,
    );
  }

  private focusedGoalSessionCount(): number {
    if (this.viewMode !== "map" || this.mapLens !== "goal" || !this.focusGoalId) return 0;
    return (
      this.mapProjection().goals.find((goal) => goal.id === this.focusGoalId)?.sessions.length ?? 0
    );
  }

  private sessionRecentlyDone(
    session: Pick<SessionView, "runtimeState" | "hostHealth" | "lastChangedAt">,
  ): boolean {
    return isRecentlyDone(session, this.options.clock.now());
  }

  private drawList(
    buffer: OptimizedBuffer,
    rect: Rect,
    projection: CommandCentreProjection,
    rows: readonly Row[],
  ): void {
    this.panel(buffer, rect, COLORS.background, COLORS.border);
    if (rect.width < 4 || rect.height < 2) return;
    this.text(
      buffer,
      "GOALS · DIRECT SESSIONS",
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
        const session = this.findSession(projection, row.id);
        if (session) this.drawSessionRow(buffer, rect, y, session);
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

  private drawSessionRow(
    buffer: OptimizedBuffer,
    rect: Rect,
    y: number,
    session: SessionView,
  ): void {
    const selected = this.selected?.type === "session" && this.selected.id === session.id;
    const prefix = selected ? "  >" : "   ";
    const goal = session.goalTitle ? "↳" : "·";
    const recentlyDone = this.sessionRecentlyDone(session);
    const review = recentlyDone ? " · review" : "";
    const label = `${prefix}${goal} [${statusGlyph(session, this.animationPhase)}] ${session.displayName} · ${session.runtimeState}${session.hostHealth === "live" ? "" : `/${session.hostHealth}`}${review}`;
    const foreground = selected ? COLORS.selected : statusColor(session, recentlyDone);
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
    if (this.terminalMode) {
      this.text(
        buffer,
        "PageUp/Down host scroll  ·  Ctrl-Home/End jump  ·  Ctrl-Shift-C copy  ·  Esc release",
        rect.x + 2,
        rect.y,
        COLORS.muted,
        COLORS.background,
      );
      this.text(
        buffer,
        shorten(this.terminalMode.status, Math.max(1, rect.width - 4)),
        rect.x + 2,
        rect.y + 1,
        this.terminalMode.closed ? COLORS.orange : COLORS.faint,
        COLORS.background,
      );
      return;
    }
    const controls =
      this.viewMode === "map"
        ? `j/k select · drag/wheel pan/zoom · Enter focus/open · m/right-click menu · / find · v list · q quit`
        : `j/k select · Enter focus/open · m/right-click menu · v map · / find · q quit`;
    this.text(
      buffer,
      shorten(controls, Math.max(1, rect.width - 4)),
      rect.x + 2,
      rect.y,
      COLORS.muted,
      COLORS.background,
    );
    if (rect.height > 1) {
      const detail = `${this.busy ? "working" : "live"} · ${projection.counts.attention} attention · ${projection.counts.stale} stale · labels ${this.semanticZoom} · ${this.viewMode} · ${this.mapLens} · ${this.inspectorVisible ? "inspector" : "clean"}`;
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
        { id: "new-session", label: "New session" },
        { id: "attention", label: "Attention lens" },
        { id: "list", label: "List view" },
      ];
    if (scope === "inbox")
      return [
        { id: "focus", label: "Focus inbox" },
        { id: "new-session", label: "New session" },
        { id: "list", label: "List view" },
      ];
    if (!target) return [];
    const projection = this.projection();
    if (target.type === "goal") {
      const goal = projection.goals.find((candidate) => candidate.id === target.id);
      return [
        { id: "focus", label: "Focus goal" },
        { id: "new-session", label: "New session in goal" },
        { id: "assign", label: "Assign inbox session" },
        { id: "inspect", label: "Show inspector" },
        { id: "rename", label: "Rename goal" },
        { id: "description", label: "Edit description" },
        { id: "priority", label: "Cycle priority" },
        goal?.status === "completed"
          ? { id: "archive", label: "Archive goal" }
          : { id: "complete", label: "Complete goal" },
      ];
    }
    const session = this.findSession(projection, target.id);
    return [
      { id: "open-terminal", label: "Open terminal" },
      { id: "focus", label: session?.primaryGoalId ? "Focus containing goal" : "Focus inbox" },
      { id: "inspect", label: "Show inspector" },
      session?.primaryGoalId
        ? { id: "unassign", label: "Unassign from goal" }
        : { id: "assign", label: "Assign to goal" },
      { id: "rename", label: "Rename session" },
      { id: "description", label: "Edit description" },
      ...(session && session.hostHealth !== "live"
        ? [{ id: "archive" as const, label: "Archive stale session" }]
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
    return this.findSession(projection, menu.target.id)?.displayName ?? "session";
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
    if (selection) {
      this.selected = { ...selection };
      this.inspectorVisible = true;
    } else if (scope === "inbox") this.selected = undefined;
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

  private executeContextAction(action: ContextActionId): void {
    const menu = this.contextMenu;
    if (!menu) return;
    const target = menu.target;
    this.contextMenu = undefined;
    switch (action) {
      case "focus":
        if (menu.scope === "inbox") this.focusInbox();
        else if (target?.type === "goal") this.focusGoal(target.id);
        else if (target?.type === "session") {
          const goal = this.selectedGoalForSession();
          if (goal) this.focusGoal(goal.id);
          else this.focusInbox();
        }
        return;
      case "open-terminal":
        void this.openTerminalSelected();
        return;
      case "inspect":
        this.inspectorVisible = true;
        this.lastAction = "inspector shown";
        this.requestRenderIfAlive();
        return;
      case "new-goal":
        this.openCreateGoal();
        return;
      case "new-session":
        this.openSessionLaunch();
        return;
      case "assign":
        this.openAssign();
        return;
      case "unassign":
        this.unassign();
        return;
      case "rename":
        this.openRename();
        return;
      case "description":
        this.openDescription();
        return;
      case "priority":
        this.cyclePriority();
        return;
      case "complete":
        this.confirmGoal("complete");
        return;
      case "archive":
        if (target?.type === "session") this.confirmArchiveSession();
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
        this.selected = undefined;
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
        "ASSIGN SESSION TO GOAL",
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
    if (modal.kind === "session-picker") {
      const goal = projection.goals.find((candidate) => candidate.id === modal.goalId);
      const sessions = filterAssignableSessions(projection.unassigned, modal.query);
      this.text(
        buffer,
        `ASSIGN INBOX SESSION${goal ? ` TO ${shorten(goal.title, overlayWidth - 24)}` : ""}`,
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
        `${sessions.length}/${projection.unassigned.length} inbox sessions · type to filter`,
        x + 2,
        y + 4,
        COLORS.muted,
        COLORS.panelRaised,
      );
      const visibleRows = Math.max(0, frame.footerY - (y + 6));
      const visibleStart = Math.min(
        Math.max(0, modal.index - visibleRows + 1),
        Math.max(0, sessions.length - visibleRows),
      );
      const visible = sessions.slice(visibleStart, visibleStart + visibleRows);
      if (visible.length === 0)
        this.text(
          buffer,
          modal.query ? "No matching inbox sessions." : "Inbox is empty.",
          x + 2,
          y + 6,
          COLORS.orange,
          COLORS.panelRaised,
        );
      for (const [index, session] of visible.entries()) {
        const absoluteIndex = visibleStart + index;
        const prefix = absoluteIndex === modal.index ? ">" : " ";
        const recentlyDone = this.sessionRecentlyDone(session);
        this.text(
          buffer,
          `${prefix} ${statusGlyph(session, this.animationPhase)} ${shorten(session.displayName, overlayWidth - 10)}`,
          x + 2,
          y + 6 + index,
          absoluteIndex === modal.index ? COLORS.white : statusColor(session, recentlyDone),
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
    if (modal.kind === "session-launch") {
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
        "NEW SESSION",
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
        `Name:       ${value("name", modal.sessionName || "(auto)")}`,
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
          : modal.action === "archive-session"
            ? "ARCHIVE STALE SESSION?"
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
          : modal.action === "archive-session"
            ? "This hides the session from active views; host history is retained."
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
    if (this.terminalMode) {
      this.handleTerminalKey(key);
      return;
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
        this.openSessionLaunch();
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
        if (this.selected?.type === "session") this.confirmArchiveSession();
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
        if (this.mapLens === "goal" || this.mapLens === "attention" || this.mapLens === "inbox") {
          this.mapLens = "portfolio";
          this.focusGoalId = undefined;
          this.resetMapView();
          this.lastAction = "returned to portfolio map";
          return;
        }
        this.selected = undefined;
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
    if (this.terminalMode) {
      this.sendTerminalInput(this.terminalMode, { kind: "bytes", value: event.bytes });
      return;
    }
    if (this.pickerSelect) {
      event.preventDefault();
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
    if (!modal) return;
    if (modal.kind === "session-picker") {
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
      modal.kind === "session-launch" &&
      modal.field !== "goal" &&
      modal.field !== "workspace" &&
      modal.field !== "location" &&
      modal.field !== "agent"
    ) {
      const currentValue =
        modal.field === "branch"
          ? modal.branch
          : modal.field === "name"
            ? modal.sessionName
            : modal.prompt;
      const edited = insertTextAtCursor(currentValue, this.inputCursor, pasted);
      this.modal =
        modal.field === "branch"
          ? { ...modal, branch: edited.value }
          : modal.field === "name"
            ? { ...modal, sessionName: edited.value }
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
    this.selected = { type: result.type, id: result.id };
    this.inspectorVisible = true;
    this.viewMode = "map";
    const goalId =
      result.type === "goal" ? result.id : (result.goalId ?? this.selectedGoalForSession()?.id);
    if (goalId) {
      this.focusGoal(goalId);
    } else if (result.type === "session") {
      this.focusInbox();
    } else {
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.mapFitPending = true;
    }
  }

  private openWorkspacePicker(path: string, returnTo: SessionLaunchModal): void {
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

  private launchFields(modal: Extract<Modal, { readonly kind: "session-launch" }>): LaunchField[] {
    return modal.workspaceMode === "worktree"
      ? ["goal", "location", "workspace", "branch", "agent", "name", "prompt"]
      : ["goal", "location", "workspace", "agent", "name", "prompt"];
  }

  private launchFieldCursor(modal: Extract<Modal, { readonly kind: "session-launch" }>): number {
    switch (modal.field) {
      case "location":
        return modal.location.length;
      case "branch":
        return modal.branch.length;
      case "agent":
        return modal.agentKind.length;
      case "name":
        return modal.sessionName.length;
      case "prompt":
        return modal.prompt.length;
      default:
        return 0;
    }
  }

  private advanceLaunchField(
    modal: Extract<Modal, { readonly kind: "session-launch" }>,
    direction: 1 | -1,
  ): void {
    const fields = this.launchFields(modal);
    const current = fields.indexOf(modal.field);
    const next = fields[(current + direction + fields.length) % fields.length] ?? "goal";
    this.modal = { ...modal, field: next };
    if (next !== "agent") this.destroyPickerSurface();
    this.inputCursor = this.launchFieldCursor({ ...modal, field: next });
  }

  private handleSessionLaunchKey(
    modal: Extract<Modal, { readonly kind: "session-launch" }>,
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
      if (modal.field === "prompt" && key.name !== "tab") void this.submitSessionLaunch(modal);
      else this.advanceLaunchField(modal, 1);
      return;
    }
    const currentValue =
      modal.field === "branch"
        ? modal.branch
        : modal.field === "name"
          ? modal.sessionName
          : modal.prompt;
    const edited = editText(currentValue, this.inputCursor, key);
    if (!edited.handled) return;
    this.inputCursor = edited.cursor;
    this.modal =
      modal.field === "branch"
        ? { ...modal, branch: edited.value }
        : modal.field === "name"
          ? { ...modal, sessionName: edited.value }
          : { ...modal, prompt: edited.value };
  }

  private async submitSessionLaunch(
    modal: Extract<Modal, { readonly kind: "session-launch" }>,
  ): Promise<void> {
    const projection = this.projection();
    const goals = projection.goals.filter((goal) => goal.status !== "archived");
    const selectedGoal = goals[modal.goalIndex - 1];
    const intent: StartSessionIntent = {
      requestId: `launch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      goal: selectedGoal ? { kind: "goal", goalId: selectedGoal.id } : { kind: "inbox" },
      workspace:
        modal.workspaceMode === "worktree"
          ? { kind: "worktree", repositoryPath: modal.location, branch: modal.branch }
          : { kind: "existing", path: modal.location },
      agent: { kind: modal.agentKind.trim() },
      sessionName: modal.sessionName.trim() || undefined,
      prompt: modal.prompt.trim() || undefined,
      mode: "manual",
    };
    this.pendingLaunch = {
      id: `pending:${intent.requestId}`,
      goalId: selectedGoal?.id,
      agentKind: intent.agent.kind,
      displayName: intent.sessionName ?? `${intent.agent.kind} session`,
    };
    this.modal = undefined;
    this.destroyPickerSurface();
    this.busy = true;
    this.lastAction = `starting ${intent.agent.kind} session…`;
    this.requestRenderIfAlive();
    try {
      const result = await Effect.runPromise(this.options.startSession.start(intent));
      this.lastAction = result.warnings?.length
        ? `${result.message} ${result.warnings.join(" ")}`
        : result.message;
      this.sessionAccessById.clear();
      if (result.sessionId) this.selected = { type: "session", id: result.sessionId };
      if (result.goalId) this.focusGoal(result.goalId);
      else if (result.sessionId) this.focusInbox();
    } catch (error) {
      this.lastAction = `session launch failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.pendingLaunch = undefined;
      this.busy = false;
      this.requestRenderIfAlive();
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
              : { type: "ArchiveSession", sessionId: modal.sessionId };
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
    if (modal.kind === "session-launch") {
      this.handleSessionLaunchKey(modal, key);
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
            type: "AssignSession",
            sessionId: modal.sessionId,
            goalId: goal.id,
          });
        this.modal = undefined;
      }
      return;
    }
    if (modal.kind === "session-picker") {
      const projection = this.projection();
      const goal = projection.goals.find(
        (candidate) => candidate.id === modal.goalId && candidate.status !== "archived",
      );
      if (!goal) {
        this.modal = undefined;
        this.lastAction = "Goal is no longer active.";
        return;
      }
      const sessions = filterAssignableSessions(projection.unassigned, modal.query);
      const edited = editText(modal.query, this.inputCursor, key);
      if (edited.handled) {
        this.modal = { ...modal, query: edited.value, index: 0 };
        this.inputCursor = edited.cursor;
      } else if (key.name === "down") {
        this.modal = {
          ...modal,
          index: Math.min(Math.max(0, sessions.length - 1), modal.index + 1),
        };
      } else if (key.name === "up") {
        this.modal = { ...modal, index: Math.max(0, modal.index - 1) };
      } else if (key.name === "enter" || key.name === "return") {
        const session = sessions[modal.index];
        if (!session)
          this.lastAction = modal.query
            ? `No inbox sessions match “${modal.query}”.`
            : "Inbox is empty.";
        else {
          this.runCommand({
            type: "AssignSession",
            sessionId: session.id,
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
            : modal.action === "rename-session"
              ? {
                  type: "RenameSession",
                  sessionId: selected.id,
                  displayName: value,
                }
              : modal.action === "description-goal"
                ? {
                    type: "SetGoalDescription",
                    goalId: selected.id,
                    description: value,
                  }
                : {
                    type: "SetSessionDescription",
                    sessionId: selected.id,
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
      const mapProjection = this.mapProjection();
      const candidates = mapSelectionCandidates(mapProjection, this.mapLens, this.focusGoalId);
      const next = nextNavigationSelection(candidates, this.selected, direction);
      if (!next) {
        this.lastAction =
          this.mapLens === "goal"
            ? "Focused goal has no sessions."
            : "No selectable map nodes. Press n to create a goal.";
        return;
      }
      this.selected = next;
      this.inspectorVisible = true;
      this.lastAction = `selected ${next.id}`;
      return;
    }
    const projection = this.projection();
    const rows = this.ensureSelection(projection).filter(
      (row): row is Selection => row.type === "goal" || row.type === "session",
    );
    if (rows.length === 0) {
      this.lastAction = "No accepted goals or sessions. Press n to create a goal.";
      return;
    }
    const currentIndex = this.selected
      ? rows.findIndex((row) => row.type === this.selected?.type && row.id === this.selected.id)
      : 0;
    const nextIndex = (Math.max(0, currentIndex) + direction + rows.length) % rows.length;
    const next = rows[nextIndex];
    if (next) {
      this.selected = { type: next.type, id: next.id };
      this.inspectorVisible = true;
    }
    this.lastAction = `selected ${next?.id ?? "item"}`;
  }

  private jumpToAttention(): void {
    const items = this.projection().attention.items.filter((item) => item.sessionId);
    if (items.length === 0) {
      this.lastAction = "No attention items.";
      return;
    }
    const currentIndex =
      this.selected?.type === "session"
        ? items.findIndex((item) => item.sessionId === this.selected?.id)
        : -1;
    const item = items[(currentIndex + 1) % items.length];
    if (!item?.sessionId) return;
    this.selected = { type: "session", id: item.sessionId };
    this.inspectorVisible = true;
    this.viewMode = "map";
    const owner = this.selectedGoalForSession();
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

  private toggleMapFocus(): void {
    if (this.viewMode !== "map") {
      this.viewMode = "map";
      this.lastAction = "primary universe map";
    }
    const projection = this.projection();
    const goal = this.selectedGoal(projection) ?? this.selectedGoalForSession();
    if (!goal) {
      const selectedUnassigned =
        this.selected?.type === "session" &&
        projection.unassigned.some((session) => session.id === this.selected?.id);
      if (selectedUnassigned) {
        if (this.mapLens === "inbox") {
          this.mapLens = "portfolio";
          this.resetMapView();
          this.lastAction = "portfolio map";
        } else this.focusInbox();
      } else this.lastAction = "Select a goal, session, or inbox to focus.";
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
    if (this.selected?.type === "goal") this.selected = undefined;
    this.mapCenter = { ...projection.inboxPosition };
    this.mapZoom = Math.max(this.mapZoom, 1.15);
    this.mapFitPending = true;
    this.lastAction = `focused inbox · ${projection.unassigned.length} sessions`;
    this.renderer.requestRender();
  }

  private selectedGoalForSession(): GoalView | undefined {
    if (!this.selected || this.selected.type !== "session") return undefined;
    const projection = this.projection();
    return projection.goals.find((goal) =>
      goal.sessions.some((session) => session.id === this.selected?.id),
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

  private openSessionLaunch(): void {
    const projection = this.projection();
    const selectedGoal = this.selectedGoal(projection) ?? this.selectedGoalForSession();
    const goals = projection.goals.filter((goal) => goal.status !== "archived");
    const selectedGoalIndex = selectedGoal
      ? Math.max(0, goals.findIndex((goal) => goal.id === selectedGoal.id) + 1)
      : 0;
    this.inputCursor = 0;
    this.modal = {
      kind: "session-launch",
      field: "goal",
      goalIndex: selectedGoalIndex,
      location: process.cwd(),
      locations: [],
      locationIndex: -1,
      workspaceMode: "existing",
      branch: "feat/observatory-session",
      agentOptions: [],
      agentIndex: -1,
      agentKind: "",
      sessionName: "",
      prompt: "",
    };
    this.requestRenderIfAlive();
    void Promise.all([
      Effect.runPromise(this.options.workspace.listChoices()),
      Effect.runPromise(this.options.host.listLaunchOptions()),
    ])
      .then(([locations, agentOptions]) => {
        const modal = this.modal;
        if (!modal || modal.kind !== "session-launch") return;
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
        if (this.modal?.kind === "session-launch") {
          this.lastAction = `launch choices unavailable: ${error instanceof Error ? error.message : String(error)}`;
          this.requestRenderIfAlive();
        }
      });
  }

  private openRename(): void {
    const projection = this.projection();
    const goal = this.selectedGoal(projection);
    const session = this.selectedSession(projection);
    if (goal) {
      this.inputCursor = goal.title.length;
      this.modal = {
        kind: "text",
        title: "RENAME GOAL",
        value: goal.title,
        action: "rename-goal",
      };
    } else if (session) {
      this.inputCursor = session.displayName.length;
      this.modal = {
        kind: "text",
        title: "RENAME SESSION",
        value: session.displayName,
        action: "rename-session",
      };
    } else this.lastAction = "Select a goal or session first.";
  }

  private openDescription(): void {
    const projection = this.projection();
    const goal = this.selectedGoal(projection);
    const session = this.selectedSession(projection);
    if (goal) {
      this.inputCursor = (goal.description ?? "").length;
      this.modal = {
        kind: "text",
        title: "SET GOAL DESCRIPTION",
        value: goal.description ?? "",
        action: "description-goal",
      };
    } else if (session) {
      this.inputCursor = (session.description ?? "").length;
      this.modal = {
        kind: "text",
        title: "SET SESSION DESCRIPTION",
        value: session.description ?? "",
        action: "description-session",
      };
    } else this.lastAction = "Select a goal or session first.";
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
        kind: "session-picker",
        goalId: goal.id,
        index: 0,
        query: "",
      };
      return;
    }
    const session = this.selectedSession(projection);
    if (!session) {
      this.lastAction = "Select a goal to assign inbox sessions, or a session to choose its goal.";
      return;
    }
    const goals = projection.goals.filter((candidate) => candidate.status !== "archived");
    const current = goals.findIndex((candidate) => candidate.id === session.primaryGoalId);
    this.modal = {
      kind: "goal-picker",
      sessionId: session.id,
      index: current >= 0 ? current : 0,
    };
  }

  private unassign(): void {
    const session = this.selectedSession(this.projection());
    if (!session) {
      this.lastAction = "Select a session to unassign.";
      return;
    }
    this.runCommand({ type: "UnassignSession", sessionId: session.id });
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

  private confirmArchiveSession(): void {
    const session = this.selectedSession(this.projection());
    if (!session) {
      this.lastAction = "Select a session first.";
      return;
    }
    if (session.hostHealth === "live") {
      this.lastAction = "Only stale or unavailable sessions can be archived.";
      return;
    }
    this.modal = {
      kind: "confirm",
      action: "archive-session",
      sessionId: session.id,
      title: session.displayName,
    };
  }

  private runCommand(command: UniverseCommand): void {
    const result = this.options.universe.execute(command);
    this.lastAction = result.ok
      ? `applied ${command.type}`
      : (result.error ?? `rejected ${command.type}`);
    if (result.ok && result.goalId && command.type === "CreateGoal") {
      this.expandedGoals.add(result.goalId);
      this.selected = { type: "goal", id: result.goalId };
      this.inspectorVisible = true;
      this.viewMode = "map";
      this.mapLens = "portfolio";
      this.focusGoalId = undefined;
      this.mapFitPending = true;
      this.lastAction = `created goal ${command.title} · press a to assign inbox sessions`;
    }
    this.renderer.requestRender();
  }

  private async refreshFromHost(manual: boolean): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.lastAction = manual ? "refreshing host snapshot…" : this.lastAction;
    try {
      this.lastAction = await Effect.runPromise(this.options.refresh);
      this.sessionAccessById.clear();
    } catch (error) {
      this.lastAction = `refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.requestRenderIfAlive();
    }
  }

  private async openTerminalSelected(): Promise<void> {
    const session = this.selectedSession(this.projection());
    if (!session) {
      this.lastAction = "Select a session to open a terminal.";
      return;
    }
    if (this.busy || this.terminalMode) return;
    this.busy = true;
    try {
      const access = await Effect.runPromise(
        this.options.host.access({
          hostKind: session.hostKind,
          nativeId: session.nativeId,
        }),
      );
      this.sessionAccessById.set(session.id, access);
      if (!access.supported) {
        this.lastAction = access.explanation;
        return;
      }
      if (!hasSessionCapability(access, "embedded-terminal") || !access.terminalTarget) {
        this.lastAction = `${session.displayName} has no embedded terminal capability.`;
        return;
      }
      const dimensions = ensureTerminalDimensions(
        this.renderer.width - 4,
        this.renderer.height - 7,
      );
      this.lastAction = `opening terminal for ${session.displayName}…`;
      const opened = await Effect.runPromise(this.options.host.openTerminal(access, dimensions));
      if (!opened.ok || !opened.terminal) {
        this.lastAction = opened.message;
        return;
      }
      const mode: TerminalMode = {
        sessionId: session.id,
        displayName: session.displayName,
        hostLabel: displayHostKind(session.hostKind),
        terminal: opened.terminal,
        screen: new TerminalScreen(dimensions.columns, dimensions.rows),
        dimensions,
        status: opened.message,
        closed: false,
      };
      this.terminalMode = mode;
      this.createTerminalSurface(mode);
      this.lastAction = opened.message;
      void this.consumeTerminalEvents(mode);
    } catch (error) {
      this.lastAction = `terminal open failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.requestRenderIfAlive();
    }
  }

  private async consumeTerminalEvents(mode: TerminalMode): Promise<void> {
    try {
      await Effect.runPromise(
        Stream.runForEach(mode.terminal.events, (event) =>
          Effect.sync(() => {
            if (this.terminalMode !== mode || this.closed) return;
            this.applyTerminalEvent(mode, event);
            this.requestRenderIfAlive();
          }),
        ),
      );
      if (this.terminalMode === mode && !mode.closed) {
        mode.closed = true;
        mode.status = "The terminal stream ended.";
        this.updateTerminalSurface(mode);
        this.requestRenderIfAlive();
      }
    } catch (error) {
      if (this.terminalMode !== mode || this.closed) return;
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

  private async resizeTerminal(width: number, height: number): Promise<void> {
    const mode = this.terminalMode;
    if (!mode) return;
    const dimensions = ensureTerminalDimensions(width - 4, height - 7);
    if (dimensions.columns === mode.dimensions.columns && dimensions.rows === mode.dimensions.rows)
      return;
    mode.dimensions = dimensions;
    mode.screen.resize(dimensions.columns, dimensions.rows);
    this.resizeTerminalSurface();
    this.updateTerminalSurface(mode);
    try {
      const result = await Effect.runPromise(mode.terminal.resize(dimensions));
      if (!result.ok && this.terminalMode === mode) mode.status = result.message;
    } catch (error) {
      if (this.terminalMode === mode)
        mode.status = `terminal resize failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.requestRenderIfAlive();
    }
  }

  private async releaseTerminal(): Promise<void> {
    const mode = this.terminalMode;
    if (!mode) return;
    this.terminalMode = undefined;
    this.destroyTerminalSurface();
    try {
      const result = await Effect.runPromise(mode.terminal.release());
      this.lastAction = result.message;
    } catch (error) {
      this.lastAction = `terminal release failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.requestRenderIfAlive();
    }
  }

  private handleTerminalKey(key: KeyEvent): void {
    const mode = this.terminalMode;
    if (!mode) return;
    key.preventDefault();
    if (key.name === "c" && ((key.ctrl && key.shift) || key.meta || key.super)) {
      this.copyTerminalSelection(mode);
      return;
    }
    if (key.name === "escape" || (key.ctrl && key.name === "q")) {
      void this.releaseTerminal();
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
      if (mode.screen.alternateScreen) {
        this.sendTerminalKey(mode, key);
        return;
      }
      if (mode.screen.scrollToTop()) {
        mode.status = this.terminalStatus(mode);
        this.updateTerminalSurface(mode);
        this.requestRenderIfAlive();
      } else this.sendTerminalKey(mode, key);
      return;
    }
    if (key.ctrl && key.name === "end") {
      if (mode.screen.alternateScreen) {
        this.sendTerminalKey(mode, key);
        return;
      }
      if (mode.screen.scrollToBottom()) {
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
    if (!value) return;
    this.sendTerminalInput(mode, { kind: "text", value });
  }

  private scrollTerminal(mode: TerminalMode, delta: number): boolean {
    if (!mode.screen.scrollBy(delta)) return false;
    mode.status = this.terminalStatus(mode);
    this.updateTerminalSurface(mode);
    this.requestRenderIfAlive();
    return true;
  }

  private terminalStatus(mode: TerminalMode): string {
    return mode.screen.isScrolled
      ? `scrollback · ${mode.screen.scrollOffset} lines back`
      : `live · ${mode.screen.bytes} bytes · ${mode.screen.ansiSequences} control sequences`;
  }

  private handleTerminalMouseScroll(event: MouseEvent): void {
    const mode = this.terminalMode;
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
    // Herdr's wheel source is deliberately forwarded to an agent when it has
    // enabled mouse reporting. Observatory owns the viewport, so use the
    // host's page-key scroll source for every wheel gesture instead. This is
    // reliable for both normal transcripts and full-screen agent TUIs.
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
    mode.status = `scrolling session ${direction === "up" ? "up" : "down"}…`;
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
        if (!result.ok && this.terminalMode === mode) {
          mode.status = result.message;
          this.requestRenderIfAlive();
        }
      })
      .catch(() => {
        if (this.terminalMode === mode) {
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

  private async handoffSelected(): Promise<void> {
    const session = this.selectedSession(this.projection());
    if (!session) {
      this.lastAction = "Select a session for native handoff.";
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
          hostKind: session.hostKind,
          nativeId: session.nativeId,
        }),
      );
      this.sessionAccessById.set(session.id, access);
      if (!hasSessionCapability(access, "native-handoff") || !access.target) {
        this.lastAction = access.supported
          ? `${session.displayName} has no native handoff; use the embedded terminal.`
          : access.explanation;
        return;
      }
      this.lastAction = `opening native UI for ${session.displayName} via ${displayHostKind(session.hostKind)}…`;
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
    if (this.terminalMode) return;
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
    const rect = layoutFor(this.renderer.width, this.renderer.height).list;
    if (!this.inRect(x, y, rect)) return undefined;
    const row = this.rows(this.projection())[this.scrollOffset + y - rect.y - 1];
    return row?.type === "goal" || row?.type === "session"
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
            clickSelection:
              target?.type === "session" ? { type: "session", id: target.id } : undefined,
          };
    if (!target) {
      this.lastGoalClick = undefined;
      this.lastSessionClick = undefined;
      this.selected = undefined;
      this.inspectorVisible = false;
      this.searchActive = false;
      this.searchQuery = "";
      this.searchCursor = 0;
      this.lastAction = "selection cleared";
      this.renderer.requestRender();
      return;
    }
    if (target.type !== "goal") this.lastGoalClick = undefined;
    if (target.type !== "session") this.lastSessionClick = undefined;
    this.selected = target.type === "inbox" ? undefined : { type: target.type, id: target.id };
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
      this.lastSessionClick = undefined;
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
    } else if (!state.moved && state.clickSelection?.type === "session") {
      this.lastGoalClick = undefined;
      const now = performance.now();
      const doubleClick =
        this.lastSessionClick?.id === state.clickSelection.id &&
        now - this.lastSessionClick.at <= 350;
      this.lastSessionClick = doubleClick ? undefined : { id: state.clickSelection.id, at: now };
      if (doubleClick) void this.openTerminalSelected();
      else {
        this.lastAction = `selected session · Enter or double-click to open terminal`;
        this.renderer.requestRender();
      }
    } else if (!state.moved && state.clickTarget === "inbox") {
      this.lastGoalClick = undefined;
      this.lastSessionClick = undefined;
      this.focusInbox();
    } else if (state.moved) {
      this.lastGoalClick = undefined;
      this.lastSessionClick = undefined;
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

  private findSession(
    projection: CommandCentreProjection,
    id: string | undefined,
  ): SessionView | undefined {
    if (!id) return undefined;
    for (const goal of projection.goals) {
      const found = goal.sessions.find((session) => session.id === id);
      if (found) return found;
    }
    return projection.unassigned.find((session) => session.id === id);
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
