#!/usr/bin/env bun

/**
 * DISPOSABLE AO VISUAL-FIDELITY SPIKE
 *
 * This is one art-directed scene for one product question. It intentionally
 * has no AO control plane, Herdr integration, persistence, discovery, or
 * production renderer abstractions. Delete the directory after the decision.
 */

import {
  createCliRenderer,
  FrameBufferRenderable,
  RGBA,
  TextAttributes,
  type CliRenderer,
  type KeyEvent,
  type OptimizedBuffer,
  type TerminalCapabilities,
} from "@opentui/core"

type SessionStatus = "active" | "waiting" | "blocked" | "done"

interface Point {
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Session {
  id: string
  label: string
  description: string
  status: SessionStatus
  goalId: string
  repository: string
  branch: string
  worktree: string
  runtime: string
  host: string
  contextSize: string
  lastEvent: string
}

interface Goal {
  id: string
  label: string
  description: string
  successSignal: string
}

interface Viewport {
  map: Rect
  inner: Rect
  scene: Rect
  inspector?: Rect
}

interface SceneGeometry {
  goal: Point
  sessionPoints: Point[]
  goalRadiusX: number
  goalRadiusY: number
  sessionRadiusX: number
  sessionRadiusY: number
}

interface LabelBox extends Rect {}

interface State {
  selectedIndex: number
  inspector: boolean
  diagnostics: boolean
  focused: boolean
  zoom: number
  panX: number
  panY: number
  phase: number
  updateTimes: number[]
  lastAction: string
  suspended: boolean
}

const color = (hex: string): RGBA => RGBA.fromHex(hex)

const COLORS = {
  background: color("#09111e"),
  map: color("#0b1625"),
  panel: color("#0e1b2c"),
  border: color("#28445a"),
  borderStrong: color("#5ca7c4"),
  text: color("#d9e7ed"),
  textMuted: color("#8aa0ad"),
  textFaint: color("#4f6878"),
  white: color("#f4fbff"),
  goal: color("#75c9dc"),
  goalCore: color("#c4f1f6"),
  session: color("#94d8ae"),
  active: color("#9bdcaf"),
  waiting: color("#c5b477"),
  blocked: color("#f08b79"),
  done: color("#8296a1"),
  selected: color("#e8f7fb"),
  selectedPath: color("#64bdd2"),
  metadata: color("#84b9c9"),
  goalDepth: color("#245a6b"),
  goalHighlight: color("#d8fbff"),
  selectedDepth: color("#2c7690"),
  blockedDepth: color("#6e3a42"),
  shadow: color("#142938"),
  black: color("#000000"),
} as const

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const shorten = (value: string, maximum: number): string => {
  if (value.length <= maximum) return value
  if (maximum <= 1) return value.slice(0, maximum)
  return `${value.slice(0, maximum - 1)}…`
}

const wrap = (value: string, maximum: number): string[] => {
  const words = value.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    if (!line) {
      line = word
      continue
    }
    if (line.length + word.length + 1 <= maximum) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

const GOAL: Goal = {
  id: "goal-router",
  label: "Ship a verified model router",
  description: "Produce a routing path whose fallback and rollback behaviour can be trusted.",
  successSignal: "verified path · rollback proof · human review",
}

const SESSIONS: Session[] = [
  {
    id: "session-router-impl",
    label: "router-impl",
    description: "Implements weighted model routing and records fallback reasons.",
    status: "active",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/router-main",
    worktree: "router-main",
    runtime: "codex-agent",
    host: "herdr/tab-2",
    contextSize: "128k",
    lastEvent: "Added deterministic fallback tracing",
  },
  {
    id: "session-routing-review",
    label: "routing-review",
    description: "Reviews cache policy and rollback semantics before merge.",
    status: "waiting",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/router-review",
    worktree: "router-review",
    runtime: "claude-code",
    host: "herdr/tab-2",
    contextSize: "200k",
    lastEvent: "Waiting for the latest evaluation result",
  },
  {
    id: "session-quality-evals",
    label: "quality-evals",
    description: "Runs the quality/cost matrix; needs a human decision on a 3% quality regression.",
    status: "blocked",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/router-evals",
    worktree: "router-evals",
    runtime: "codex-agent",
    host: "herdr/tab-2",
    contextSize: "64k",
    lastEvent: "Blocked on accepting or rejecting the quality trade-off",
  },
  {
    id: "session-fallback-audit",
    label: "fallback-audit",
    description: "Audits provider fallback paths and records failure evidence.",
    status: "active",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/fallback-audit",
    worktree: "fallback-audit",
    runtime: "codex-agent",
    host: "herdr/tab-3",
    contextSize: "64k",
    lastEvent: "Replayed the timeout and quota failure cases",
  },
  {
    id: "session-rollback-proof",
    label: "rollback-proof",
    description: "Proves the rollback story against a stale model registry.",
    status: "active",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/rollback-proof",
    worktree: "rollback-proof",
    runtime: "claude-code",
    host: "herdr/tab-3",
    contextSize: "128k",
    lastEvent: "Comparing rollback after a partially published registry",
  },
  {
    id: "session-release-rehearsal",
    label: "release-rehearsal",
    description: "Rehearses the release checklist against the verified route.",
    status: "done",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/release-rehearsal",
    worktree: "release-rehearsal",
    runtime: "codex-agent",
    host: "herdr/tab-4",
    contextSize: "64k",
    lastEvent: "Checklist complete; handed result to router-review",
  },
  {
    id: "session-human-checkpoint",
    label: "human-checkpoint",
    description: "Waits for the operator to choose whether to accept the evaluation trade-off.",
    status: "waiting",
    goalId: GOAL.id,
    repository: "frontier",
    branch: "ao/human-checkpoint",
    worktree: "router-evals",
    runtime: "human-handoff",
    host: "terminal",
    contextSize: "32k",
    lastEvent: "Decision request is ready for review",
  },
]

// Hand-authored on purpose: this spike judges one art-directed scene, not a
// general graph layout algorithm. The session positions form a clear orbit
// with room for captions and a visible selected/blocked contrast.
const ORBIT_ANCHORS: Point[] = [
  { x: -1, y: -0.05 },
  { x: -0.78, y: -0.82 },
  { x: 0.78, y: -0.82 },
  { x: 1, y: -0.05 },
  { x: 0.72, y: 0.9 },
  { x: 0, y: 1 },
  { x: -0.72, y: 0.9 },
]

const statusColor = (status: SessionStatus): RGBA => {
  switch (status) {
    case "active":
      return COLORS.active
    case "waiting":
      return COLORS.waiting
    case "blocked":
      return COLORS.blocked
    case "done":
      return COLORS.done
  }
}

const statusGlyph = (status: SessionStatus): string => {
  switch (status) {
    case "active":
      return "♙"
    case "waiting":
      return "?"
    case "blocked":
      return "!"
    case "done":
      return "✓"
  }
}

const statusLabel = (status: SessionStatus): string => status.toUpperCase()

class FidelitySceneApp {
  private readonly state: State = {
    selectedIndex: 0,
    inspector: false,
    diagnostics: true,
    focused: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    phase: 0,
    updateTimes: [],
    lastAction: "ready · selected router-impl",
    suspended: false,
  }

  private readonly canvas: FrameBufferRenderable
  private updateTimer: ReturnType<typeof setInterval> | undefined
  private closed = false
  private lastDrawDuration = 0
  private readonly labelBoxes: LabelBox[] = []
  private readonly objectBoxes: Rect[] = []
  private suspendTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly renderer: CliRenderer) {
    this.state.inspector = renderer.width >= 110
    this.canvas = new FrameBufferRenderable(renderer, {
      id: "disposable-ao-visual-fidelity-framebuffer",
      width: renderer.width,
      height: renderer.height,
      respectAlpha: true,
    })
    this.canvas.renderBefore = (_buffer, deltaTime) => this.renderFrame(deltaTime)
    renderer.root.add(this.canvas)
    renderer.on("resize", (width: number, height: number) => {
      this.canvas.width = width
      this.canvas.height = height
      this.state.lastAction = `resized to ${width}×${height}`
      renderer.requestRender()
    })
    renderer.keyInput.on("keypress", (key) => this.handleKey(key))
    renderer.setTerminalTitle("AO — disposable visual-fidelity spike")
  }

  start(): void {
    this.updateTimer = setInterval(() => {
      if (this.closed || this.state.suspended) return
      this.state.phase = (this.state.phase + 0.1) % 1000
      const now = performance.now()
      this.state.updateTimes.push(now)
      this.state.updateTimes = this.state.updateTimes.filter((timestamp) => now - timestamp < 2000)
      this.renderer.requestRender()
    }, 100)
    this.renderer.start()
  }

  disposeTimers(): void {
    if (this.updateTimer) clearInterval(this.updateTimer)
    if (this.suspendTimer) clearTimeout(this.suspendTimer)
    this.updateTimer = undefined
    this.suspendTimer = undefined
  }

  shutdown(): void {
    if (this.closed) return
    this.closed = true
    this.disposeTimers()
    this.renderer.destroy()
  }

  private renderFrame(deltaTime: number): void {
    const started = performance.now()
    this.state.phase += Math.max(deltaTime, 16.67) / 1000
    const buffer = this.canvas.frameBuffer
    const width = this.renderer.width
    const height = this.renderer.height

    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height

    buffer.clear(COLORS.background)
    this.labelBoxes.length = 0
    this.objectBoxes.length = 0

    const viewport = this.getViewport(width, height)
    this.drawHeader(buffer, width)
    this.drawScene(buffer, viewport)
    if (viewport.inspector) this.drawInspector(buffer, viewport.inspector)
    this.drawFooter(buffer, width, height)

    this.lastDrawDuration = performance.now() - started
  }

  private getViewport(width: number, height: number): Viewport {
    const headerHeight = 3
    const footerHeight = Math.min(3, Math.max(2, height - headerHeight - 1))
    const baseMapHeight = Math.max(6, height - headerHeight - footerHeight)
    const wide = this.state.inspector && width >= 110
    const inspectorWidth = wide ? 36 : 0
    let mapHeight = baseMapHeight
    let inspector: Rect | undefined

    if (wide) {
      inspector = { x: width - inspectorWidth, y: headerHeight, width: inspectorWidth, height: mapHeight }
    } else if (this.state.inspector && baseMapHeight >= 15) {
      const inspectorHeight = Math.min(8, Math.max(7, Math.floor(baseMapHeight * 0.42)))
      mapHeight = Math.max(7, baseMapHeight - inspectorHeight)
      inspector = { x: 0, y: headerHeight + mapHeight, width, height: inspectorHeight }
    }

    const map = { x: 0, y: headerHeight, width: Math.max(24, width - inspectorWidth), height: mapHeight }
    const inner = { x: map.x + 1, y: map.y + 1, width: Math.max(1, map.width - 2), height: Math.max(1, map.height - 2) }
    const scene = { x: inner.x + 1, y: inner.y + 1, width: Math.max(1, inner.width - 2), height: Math.max(1, inner.height - 2) }
    return { map, inner, scene, inspector }
  }

  private drawHeader(buffer: OptimizedBuffer, width: number): void {
    const stats = this.renderer.getStats()
    const fps = Number.isFinite(stats.fps) ? stats.fps : 0
    const frameTime = stats.averageFrameTime > 0 ? stats.averageFrameTime : this.lastDrawDuration
    const selected = SESSIONS[this.state.selectedIndex]
    const left = width < 92 ? "AO / VISUAL FIDELITY" : "AO / VISUAL FIDELITY SPIKE  ·  DISPOSABLE"
    const right = width < 92 ? "PORTABLE" : "PORTABLE CELL SCENE"
    this.text(buffer, left, 1, 0, COLORS.white, COLORS.background, TextAttributes.BOLD)
    this.textRight(buffer, right, width - 1, 0, COLORS.goal, COLORS.background, TextAttributes.BOLD)
    this.text(buffer, "one goal  →  seven sessions  ·  selected path only  ·  infrastructure is metadata", 1, 1, COLORS.textMuted, COLORS.background)

    const capability = this.capabilitySummary(this.renderer.capabilities)
    const diagnostic = this.state.diagnostics
      ? `FPS ${fps.toFixed(0)}  ${frameTime.toFixed(1)}ms  N 8  U ${this.updateRate().toFixed(1)}/s  GFX ${capability}`
      : `diagnostics off  ·  selected ${shorten(selected.label, 18)}`
    this.textRight(buffer, shorten(diagnostic, Math.max(10, width - 2)), width - 1, 2, COLORS.textFaint, COLORS.background)
  }

  private drawScene(buffer: OptimizedBuffer, viewport: Viewport): void {
    this.drawPanel(buffer, viewport.map, COLORS.map, COLORS.border)
    const sceneTitle = viewport.scene.width < 92
      ? `FOCUSED SYSTEM  ·  7 SESSIONS  ·  G→S`
      : "FOCUSED SYSTEM  ·  7 SESSION ORBIT  ·  GOAL → SESSION"
    this.text(buffer, sceneTitle, viewport.inner.x + 1, viewport.inner.y, COLORS.goal, COLORS.map, TextAttributes.BOLD)

    const geometry = this.geometry(viewport.scene)
    const selectedPoint = geometry.sessionPoints[this.state.selectedIndex]
    this.objectBoxes.push({
      x: geometry.goal.x - geometry.goalRadiusX,
      y: geometry.goal.y - geometry.goalRadiusY,
      width: geometry.goalRadiusX * 2 + 1,
      height: geometry.goalRadiusY * 2 + 1,
    })
    for (const point of geometry.sessionPoints) {
      this.objectBoxes.push({
        x: point.x - geometry.sessionRadiusX,
        y: point.y - geometry.sessionRadiusY,
        width: geometry.sessionRadiusX * 2 + 1,
        height: geometry.sessionRadiusY * 2 + 1,
      })
    }

    const pathColor = this.state.focused ? COLORS.selectedPath : this.mixWithBackground(COLORS.selectedPath, 0.66)
    const dx = selectedPoint.x - geometry.goal.x
    const dy = selectedPoint.y - geometry.goal.y
    const pathGlyph = Math.abs(dx) > Math.abs(dy) * 1.8
      ? "─"
      : Math.abs(dy) > Math.abs(dx) * 1.8
        ? "│"
        : dx * dy < 0 ? "╱" : "╲"
    this.line(buffer, geometry.goal, selectedPoint, viewport.scene, pathGlyph, pathColor, COLORS.map)

    this.drawGoal(buffer, geometry.goal, geometry, viewport.scene)
    for (const [index, session] of SESSIONS.entries()) {
      const point = geometry.sessionPoints[index]
      if (point) this.drawSession(buffer, session, index, point, geometry, viewport.scene)
    }

    // The footer carries the interaction state. Keeping the scene itself free
    // of a second status line prevents the lowest session label from colliding
    // with explanatory copy.
  }

  private geometry(scene: Rect): SceneGeometry {
    const zoom = clamp(this.state.zoom, 0.8, 1.45)
    const goal = {
      x: clamp(Math.round(scene.x + scene.width * 0.5 + this.state.panX), scene.x + 14, scene.x + scene.width - 14),
      y: clamp(Math.round(scene.y + scene.height * 0.51 + this.state.panY), scene.y + 7, scene.y + scene.height - 7),
    }
    const goalRadiusX = clamp(Math.round(9 * zoom), 8, 13)
    const goalRadiusY = clamp(Math.round(3 * zoom), 2, 4)
    const sessionRadiusX = clamp(Math.round(3 * zoom), 3, 5)
    const sessionRadiusY = clamp(Math.round(1 * zoom), 1, 2)
    const orbitRadiusX = clamp(Math.round(scene.width * 0.34 * zoom), 22, 38)
    const orbitRadiusY = clamp(Math.round(scene.height * 0.35 * zoom), 5, 10)
    const points = ORBIT_ANCHORS.map((anchor) => ({
      x: clamp(Math.round(goal.x + anchor.x * orbitRadiusX), scene.x + sessionRadiusX + 1, scene.x + scene.width - sessionRadiusX - 1),
      y: clamp(Math.round(goal.y + anchor.y * orbitRadiusY), scene.y + sessionRadiusY + 1, scene.y + scene.height - sessionRadiusY - 1),
    }))
    return { goal, sessionPoints: points, goalRadiusX, goalRadiusY, sessionRadiusX, sessionRadiusY }
  }

  private drawGoal(buffer: OptimizedBuffer, point: Point, geometry: SceneGeometry, scene: Rect): void {
    const label = scene.width < 80 || scene.height < 18
      ? "GOAL  ·  model router"
      : shorten(`FOCUSED GOAL  ·  ${GOAL.label}`, Math.max(14, scene.width - 4))
    const labelX = clamp(point.x - Math.floor(label.length / 2), scene.x, Math.max(scene.x, scene.x + scene.width - label.length))
    const labelY = clamp(point.y - geometry.goalRadiusY - 2, scene.y + 1, scene.y + scene.height - 1)
    this.text(buffer, label, labelX, labelY, COLORS.goal, COLORS.map, TextAttributes.BOLD)
    this.cell(buffer, point.x, labelY + 1, "│", COLORS.goal, COLORS.map)
    this.labelBoxes.push({ x: labelX, y: labelY, width: label.length, height: 1 })

    this.drawOrb(
      buffer,
      point,
      geometry.goalRadiusX,
      geometry.goalRadiusY,
      COLORS.goalHighlight,
      COLORS.goalDepth,
      COLORS.goal,
      COLORS.map,
      "◎",
      COLORS.goalCore,
    )
  }

  private drawSession(buffer: OptimizedBuffer, session: Session, index: number, point: Point, geometry: SceneGeometry, scene: Rect): void {
    const selected = index === this.state.selectedIndex
    const attention = session.status === "blocked"
    const baseColor = selected ? COLORS.selected : statusColor(session.status)
    const topColor = selected ? COLORS.white : this.mixColors(baseColor, COLORS.white, 0.16)
    const bottomColor = selected
      ? COLORS.selectedDepth
      : attention
        ? COLORS.blockedDepth
        : this.mixWithBackground(baseColor, 0.42)
    const pulse = Math.sin(this.state.phase * 2.2 + index) > 0 ? COLORS.blocked : this.mixWithBackground(COLORS.blocked, 0.52)
    const ring = selected ? COLORS.selected : attention ? pulse : this.mixWithBackground(baseColor, 0.7)
    this.drawOrb(
      buffer,
      point,
      geometry.sessionRadiusX,
      geometry.sessionRadiusY,
      topColor,
      bottomColor,
      selected || attention ? ring : null,
      COLORS.map,
      selected ? "♙" : statusGlyph(session.status),
      selected ? COLORS.white : baseColor,
    )

    const compactLabel = scene.width < 80 || scene.height < 18
    const sessionLabel = compactLabel ? shorten(session.label, 10) : session.label
    const label = selected ? `▸ ${sessionLabel}` : attention ? `! ${sessionLabel}` : sessionLabel
    const labelColor = selected ? COLORS.white : attention ? COLORS.blocked : statusColor(session.status)
    const labelAttributes = selected || attention ? TextAttributes.BOLD : TextAttributes.NONE
    const placement = this.findLabelPlacement(label, point, index, geometry.sessionRadiusX, geometry.sessionRadiusY, scene)
    this.drawCaptionTether(buffer, point, placement, label.length, geometry.sessionRadiusX, geometry.sessionRadiusY, labelColor)
    this.text(buffer, label, placement.x, placement.y, labelColor, COLORS.map, labelAttributes)
    this.labelBoxes.push({ x: placement.x, y: placement.y, width: label.length, height: 1 })
  }

  private findLabelPlacement(label: string, point: Point, index: number, radiusX: number, radiusY: number, scene: Rect): Point {
    const anchor = ORBIT_ANCHORS[index] ?? { x: 0, y: 1 }
    const width = label.length
    const candidates: Point[] = []
    if (Math.abs(anchor.x) > 0.5) {
      candidates.push({ x: anchor.x > 0 ? point.x + radiusX + 2 : point.x - width - radiusX - 2, y: point.y })
      candidates.push({ x: anchor.x > 0 ? point.x + radiusX + 2 : point.x - width - radiusX - 2, y: point.y + (anchor.y > 0 ? 2 : -2) })
    } else if (anchor.y < 0) {
      candidates.push({ x: point.x - Math.floor(width / 2), y: point.y - radiusY - 2 })
      candidates.push({ x: point.x - Math.floor(width / 2), y: point.y - radiusY - 3 })
    } else {
      candidates.push({ x: point.x - Math.floor(width / 2), y: point.y + radiusY + 2 })
      candidates.push({ x: point.x - Math.floor(width / 2), y: point.y + radiusY + 3 })
    }
    candidates.push({ x: point.x - Math.floor(width / 2), y: point.y - radiusY - 2 })
    candidates.push({ x: point.x - Math.floor(width / 2), y: point.y + radiusY + 2 })
    candidates.push({ x: point.x + radiusX + 2, y: point.y })
    candidates.push({ x: point.x - width - radiusX - 2, y: point.y })

    const body = { x: point.x - radiusX, y: point.y - radiusY, width: radiusX * 2 + 1, height: radiusY * 2 + 1 }
    const boundedCandidate = (candidate: Point): Point => ({
      x: clamp(candidate.x, scene.x, Math.max(scene.x, scene.x + scene.width - width)),
      y: clamp(candidate.y, scene.y, Math.max(scene.y, scene.y + scene.height - 1)),
    })
    for (const candidate of candidates) {
      const bounded = boundedCandidate(candidate)
      const box = { x: bounded.x - 1, y: bounded.y, width: width + 2, height: 1 }
      if (this.overlaps(box, body)) continue
      if (this.objectBoxes.some((existing) => this.overlaps(box, existing))) continue
      if (!this.labelBoxes.some((existing) => this.overlaps(box, existing))) return bounded
    }

    const fallback = candidates.find((candidate) => {
      const bounded = boundedCandidate(candidate)
      const box = { x: bounded.x - 1, y: bounded.y, width: width + 2, height: 1 }
      return !this.overlaps(box, body) && !this.objectBoxes.some((existing) => this.overlaps(box, existing))
    })
    return boundedCandidate(fallback ?? candidates[0] ?? point)
  }

  private drawInspector(buffer: OptimizedBuffer, rect: Rect): void {
    this.drawPanel(buffer, rect, COLORS.panel, COLORS.borderStrong)
    const session = SESSIONS[this.state.selectedIndex]
    const x = rect.x + 2
    const right = rect.x + rect.width - 2
    const compact = rect.height < 12
    this.text(buffer, "SELECTED SESSION", x, rect.y + 1, COLORS.goal, COLORS.panel, TextAttributes.BOLD)
    this.textRight(buffer, `${this.state.selectedIndex + 1}/${SESSIONS.length}`, right, rect.y + 1, COLORS.textFaint, COLORS.panel)
    this.text(buffer, `♙ ${session.label}`, x, rect.y + 3, session.status === "blocked" ? COLORS.blocked : COLORS.white, COLORS.panel, TextAttributes.BOLD)
    this.text(buffer, `${statusLabel(session.status)}  ·  GOAL`, x, rect.y + 4, statusColor(session.status), COLORS.panel, TextAttributes.BOLD)

    if (compact) {
      const detail = `${session.repository}  ·  ${session.branch}  ·  ${session.worktree}`
      this.text(buffer, shorten(detail, Math.max(10, rect.width - 4)), x, rect.y + 5, COLORS.metadata, COLORS.panel)
      this.text(buffer, shorten(`${session.runtime}  ·  ${session.host}  ·  ${session.contextSize}`, Math.max(10, rect.width - 4)), x, rect.y + 6, COLORS.textMuted, COLORS.panel)
      this.text(buffer, shorten(session.description, Math.max(10, rect.width - 4)), x, rect.y + 7, COLORS.textMuted, COLORS.panel)
      return
    }

    let line = rect.y + 6
    for (const descriptionLine of wrap(session.description, rect.width - 4).slice(0, 3)) {
      this.text(buffer, descriptionLine, x, line, COLORS.textMuted, COLORS.panel)
      line += 1
    }
    line += 1
    this.text(buffer, `goal   ${shorten(GOAL.label, rect.width - 10)}`, x, line, COLORS.goal, COLORS.panel)
    line += 1
    this.text(buffer, `repo   ${session.repository}`, x, line, COLORS.metadata, COLORS.panel)
    line += 1
    this.text(buffer, `branch ${shorten(session.branch, rect.width - 10)}`, x, line, COLORS.metadata, COLORS.panel)
    line += 1
    this.text(buffer, `tree   ${session.worktree}`, x, line, COLORS.metadata, COLORS.panel)
    line += 1
    this.text(buffer, `run    ${session.runtime}`, x, line, COLORS.textMuted, COLORS.panel)
    line += 1
    this.text(buffer, `host   ${session.host}  ·  ${session.contextSize}`, x, line, COLORS.textMuted, COLORS.panel)
    line += 2
    this.text(buffer, shorten(session.lastEvent, rect.width - 4), x, line, COLORS.textFaint, COLORS.panel)
  }

  private drawFooter(buffer: OptimizedBuffer, width: number, height: number): void {
    const y = Math.max(0, height - 3)
    this.hline(buffer, 0, y, width, "─", COLORS.border, COLORS.background)
    const controls = width < 92 ? "j/k select  enter focus  +/- zoom  i inspect  s suspend  q quit" : "j/k select  enter focus  +/- zoom  h/l/u/d pan  i inspector  t diagnostics  r reset  s suspend  q quit"
    this.text(buffer, controls, 1, y + 1, COLORS.textMuted, COLORS.background)
    this.textRight(buffer, this.state.suspended ? "portable · SUSPENDED" : "portable · disposable", width - 1, y + 1, this.state.suspended ? COLORS.blocked : COLORS.goal, COLORS.background)
    this.text(buffer, shorten(this.state.lastAction, Math.max(10, width - 2)), 1, y + 2, COLORS.textFaint, COLORS.background)
  }

  private handleKey(key: KeyEvent): void {
    if (key.eventType === "release") return
    if (key.ctrl && key.name === "c") {
      key.preventDefault()
      this.state.lastAction = "clean exit requested"
      this.shutdown()
      return
    }

    const command = key.name === "plus" || key.name === "kpplus" ? "+" : key.name === "equal" || key.name === "kpequal" ? "=" : key.name || key.sequence
    switch (command) {
      case "j":
      case "down":
        this.moveSelection(1)
        return
      case "k":
      case "up":
        this.moveSelection(-1)
        return
      case "enter":
      case "return":
        this.state.focused = true
        this.state.inspector = true
        this.state.lastAction = `focused path · ${SESSIONS[this.state.selectedIndex].label}`
        return
      case "i":
        this.state.inspector = !this.state.inspector
        this.state.lastAction = `inspector ${this.state.inspector ? "shown" : "hidden"}`
        return
      case "+":
      case "=":
        this.state.zoom = clamp(this.state.zoom + 0.1, 0.8, 1.45)
        this.state.lastAction = `zoom ${this.state.zoom.toFixed(1)}×`
        return
      case "-":
        this.state.zoom = clamp(this.state.zoom - 0.1, 0.8, 1.45)
        this.state.lastAction = `zoom ${this.state.zoom.toFixed(1)}×`
        return
      case "h":
      case "left":
        this.state.panX -= 3
        this.state.lastAction = "panned left"
        return
      case "l":
      case "right":
        this.state.panX += 3
        this.state.lastAction = "panned right"
        return
      case "u":
      case "pageup":
        this.state.panY -= 1
        this.state.lastAction = "panned up"
        return
      case "d":
      case "pagedown":
        this.state.panY += 1
        this.state.lastAction = "panned down"
        return
      case "r":
        this.state.zoom = 1
        this.state.panX = 0
        this.state.panY = 0
        this.state.focused = false
        this.state.lastAction = "viewport reset"
        return
      case "t":
        this.state.diagnostics = !this.state.diagnostics
        this.state.lastAction = `diagnostics ${this.state.diagnostics ? "shown" : "hidden"}`
        return
      case "s":
        this.smokeSuspendResume()
        return
      case "escape":
        this.state.focused = false
        this.state.lastAction = "focus cleared"
        return
      case "q":
        this.state.lastAction = "clean exit requested"
        this.shutdown()
        return
      default:
        return
    }
  }

  private moveSelection(direction: number): void {
    this.state.selectedIndex = (this.state.selectedIndex + direction + SESSIONS.length) % SESSIONS.length
    this.state.focused = false
    this.state.inspector = true
    this.state.lastAction = `selected ${SESSIONS[this.state.selectedIndex].label}`
  }

  private smokeSuspendResume(): void {
    if (this.state.suspended || this.closed || this.renderer.isDestroyed) return
    this.state.suspended = true
    this.state.lastAction = "suspend cleanup path; returning in 800ms"
    this.renderer.suspend()
    this.suspendTimer = setTimeout(() => {
      if (this.closed || this.renderer.isDestroyed) return
      this.renderer.resume()
      this.state.suspended = false
      this.state.lastAction = "suspend/resume returned cleanly"
      this.renderer.requestRender()
    }, 800)
  }

  private drawPanel(buffer: OptimizedBuffer, rect: Rect, fill: RGBA, border: RGBA): void {
    buffer.fillRect(rect.x, rect.y, rect.width, rect.height, fill)
    if (rect.width < 2 || rect.height < 2) return
    this.hline(buffer, rect.x + 1, rect.y, rect.width - 2, "─", border, fill)
    this.hline(buffer, rect.x + 1, rect.y + rect.height - 1, rect.width - 2, "─", border, fill)
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 1) {
      this.cell(buffer, rect.x, y, "│", border, fill)
      this.cell(buffer, rect.x + rect.width - 1, y, "│", border, fill)
    }
    this.cell(buffer, rect.x, rect.y, "╭", border, fill)
    this.cell(buffer, rect.x + rect.width - 1, rect.y, "╮", border, fill)
    this.cell(buffer, rect.x, rect.y + rect.height - 1, "╰", border, fill)
    this.cell(buffer, rect.x + rect.width - 1, rect.y + rect.height - 1, "╯", border, fill)
  }

  private drawOrb(
    buffer: OptimizedBuffer,
    point: Point,
    radiusX: number,
    radiusY: number,
    topColor: RGBA,
    bottomColor: RGBA,
    halo: RGBA | null,
    background: RGBA,
    coreGlyph: string,
    coreForeground: RGBA,
  ): void {
    if (halo) this.drawOrbHalo(buffer, point, radiusX, radiusY, halo, background)

    // Each terminal cell carries two vertical colour planes. Drawing the
    // upper and lower halves independently gives the body a rounded silhouette
    // and a restrained depth gradient without requiring Kitty/Sixel graphics.
    const halfRows = (radiusY * 2 + 1) * 2
    const halfCenter = (halfRows - 1) / 2
    const halfRadius = halfRows / 2
    const widthAt = (halfY: number): number => {
      const normalized = (halfY - halfCenter) / halfRadius
      return Math.max(0, Math.round(radiusX * Math.sqrt(Math.max(0, 1 - normalized * normalized))))
    }

    for (let row = -radiusY; row <= radiusY; row += 1) {
      const topHalf = (row + radiusY) * 2
      const bottomHalf = topHalf + 1
      const topWidth = widthAt(topHalf)
      const bottomWidth = widthAt(bottomHalf)
      for (let dx = -radiusX - 1; dx <= radiusX + 1; dx += 1) {
        const topInside = Math.abs(dx) <= topWidth
        const bottomInside = Math.abs(dx) <= bottomWidth
        if (topInside && bottomInside) this.cell(buffer, point.x + dx, point.y + row, "▀", topColor, bottomColor)
        else if (topInside) this.cell(buffer, point.x + dx, point.y + row, "▀", topColor, background)
        else if (bottomInside) this.cell(buffer, point.x + dx, point.y + row, "▄", bottomColor, background)
      }
    }

    this.cell(buffer, point.x, point.y, coreGlyph, coreForeground, bottomColor, TextAttributes.BOLD)
  }

  private drawOrbHalo(buffer: OptimizedBuffer, point: Point, radiusX: number, radiusY: number, foreground: RGBA, background: RGBA): void {
    const outerX = radiusX + 1
    const outerY = radiusY + 1
    for (let dy = -outerY; dy <= outerY; dy += 1) {
      for (let dx = -outerX; dx <= outerX; dx += 1) {
        const outer = (dx * dx) / Math.max(1, outerX * outerX) + (dy * dy) / Math.max(1, outerY * outerY) <= 1
        const inner = (dx * dx) / Math.max(1, radiusX * radiusX) + (dy * dy) / Math.max(1, radiusY * radiusY) <= 1
        if (outer && !inner) this.cell(buffer, point.x + dx, point.y + dy, "░", foreground, background)
      }
    }
  }

  private drawCaptionTether(buffer: OptimizedBuffer, point: Point, placement: Point, labelWidth: number, radiusX: number, radiusY: number, foreground: RGBA): void {
    if (placement.x >= point.x + radiusX + 1) {
      this.cell(buffer, point.x + radiusX + 1, point.y, "─", foreground, COLORS.map)
    } else if (placement.x + labelWidth <= point.x - radiusX - 1) {
      this.cell(buffer, point.x - radiusX - 1, point.y, "─", foreground, COLORS.map)
    } else if (placement.y < point.y) {
      this.cell(buffer, point.x, point.y - radiusY - 1, "│", foreground, COLORS.map)
    } else {
      this.cell(buffer, point.x, point.y + radiusY + 1, "│", foreground, COLORS.map)
    }
  }

  private line(buffer: OptimizedBuffer, from: Point, to: Point, rect: Rect, glyph: string, foreground: RGBA, background: RGBA): void {
    let x0 = Math.round(from.x)
    let y0 = Math.round(from.y)
    const x1 = Math.round(to.x)
    const y1 = Math.round(to.y)
    const dx = Math.abs(x1 - x0)
    const sx = x0 < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y0)
    const sy = y0 < y1 ? 1 : -1
    let error = dx + dy

    while (true) {
      if (x0 >= rect.x && x0 < rect.x + rect.width && y0 >= rect.y && y0 < rect.y + rect.height) {
        this.cell(buffer, x0, y0, glyph, foreground, background)
      }
      if (x0 === x1 && y0 === y1) break
      const twice = 2 * error
      if (twice >= dy) {
        error += dy
        x0 += sx
      }
      if (twice <= dx) {
        error += dx
        y0 += sy
      }
    }
  }

  private hline(buffer: OptimizedBuffer, x: number, y: number, width: number, glyph: string, foreground: RGBA, background: RGBA): void {
    for (let offset = 0; offset < width; offset += 1) this.cell(buffer, x + offset, y, glyph, foreground, background)
  }

  private cell(buffer: OptimizedBuffer, x: number, y: number, glyph: string, foreground: RGBA, background: RGBA, attributes = TextAttributes.NONE): void {
    if (x < 0 || y < 0 || x >= this.renderer.width || y >= this.renderer.height) return
    buffer.setCell(x, y, glyph, foreground, background, attributes)
  }

  private text(buffer: OptimizedBuffer, value: string, x: number, y: number, foreground: RGBA, background: RGBA, attributes = TextAttributes.NONE): void {
    if (y < 0 || y >= this.renderer.height || x >= this.renderer.width) return
    const available = this.renderer.width - Math.max(0, x)
    if (available <= 0) return
    buffer.drawText(value.slice(0, available), Math.max(0, x), y, foreground, background, attributes)
  }

  private textRight(buffer: OptimizedBuffer, value: string, right: number, y: number, foreground: RGBA, background: RGBA, attributes = TextAttributes.NONE): void {
    this.text(buffer, value, Math.max(0, right - value.length), y, foreground, background, attributes)
  }

  private updateRate(): number {
    return this.state.updateTimes.length >= 2 ? (this.state.updateTimes.length - 1) / 2 : 0
  }

  private capabilitySummary(capabilities: TerminalCapabilities | null | undefined): string {
    if (!capabilities) return "cells"
    const graphics = [capabilities.kitty_graphics ? "kitty" : "", capabilities.sixel ? "sixel" : ""].filter(Boolean)
    return graphics.length > 0 ? `cells + ${graphics.join("/")} (unused)` : "cells"
  }

  private mixWithBackground(foreground: RGBA, amount: number): RGBA {
    const mix = (a: number, b: number): number => b + (a - b) * amount
    return RGBA.fromValues(
      mix(foreground.r, COLORS.map.r),
      mix(foreground.g, COLORS.map.g),
      mix(foreground.b, COLORS.map.b),
      foreground.a,
    )
  }

  private mixColors(first: RGBA, second: RGBA, amount: number): RGBA {
    const mix = (a: number, b: number): number => a + (b - a) * amount
    return RGBA.fromValues(
      mix(first.r, second.r),
      mix(first.g, second.g),
      mix(first.b, second.b),
      first.a,
    )
  }

  private overlaps(first: Rect, second: Rect): boolean {
    return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y
  }
}

let app: FidelitySceneApp | undefined

const renderer = await createCliRenderer({
  targetFps: 30,
  maxFps: 60,
  gatherStats: true,
  maxStatSamples: 180,
  autoFocus: false,
  exitOnCtrlC: true,
  clearOnShutdown: true,
  onDestroy: () => app?.disposeTimers(),
})

app = new FidelitySceneApp(renderer)
app.start()
