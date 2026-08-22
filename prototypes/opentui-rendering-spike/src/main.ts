#!/usr/bin/env bun

/**
 * DISPOSABLE AO RENDERING POC
 *
 * This file exists to answer one rendering question. It is intentionally an
 * in-memory fixture and has no AO, Herdr, persistence, session discovery, or
 * production renderer seams. Delete the directory after the experiment.
 */

import {
  createCliRenderer,
  FrameBufferRenderable,
  MouseButton,
  RGBA,
  TextAttributes,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  type TerminalCapabilities,
} from "@opentui/core"

type NodeKind = "goal" | "session" | "repository" | "worktree"
type Lifecycle = "active" | "waiting" | "blocked" | "idle" | "done"
type RelationType = "contains" | "delegated-to" | "depends-on" | "reviews" | "uses" | "integrates-into" | "result-handoff" | "shared-worktree" | "conflict-risk"
type VisualMode = 1 | 2 | 3
type ChangeMode = "write" | "read" | "human"

interface FixtureNode {
  id: string
  kind: NodeKind
  label: string
  description: string
  scope: number
  priority: number
  status: Lifecycle
  attention: boolean
  recency: number
  activeAgents: number
  totalSessions: number
  goalId?: string
  repositoryId?: string
  repositoryIds?: string[]
  worktreeId?: string
  parentId?: string
  delegatedBy?: string
  provider?: string
  branch?: string
  runtime?: string
  host?: string
  contextSize?: string
  changeMode?: ChangeMode
  infrastructureWarning?: boolean
  infrastructureWarningText?: string
}

interface FixtureRelation {
  from: string
  to: string
  type: RelationType
}

interface Point {
  x: number
  y: number
}

interface HitTarget extends Point {
  id: string
  radiusX: number
  radiusY: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Viewport extends Rect {
  inner: Rect
}

interface AppState {
  mode: VisualMode
  selectedId: string
  hoveredId: string | null
  inspector: boolean
  diagnostics: boolean
  searchActive: boolean
  query: string
  panX: number
  panY: number
  zoom: number
  focusOnly: boolean
  repositoryTopology: boolean
  phase: number
  tickCount: number
  updateTimes: number[]
  lastAction: string
  enhancedFallback: string | null
  suspended: boolean
}

interface NodePalette {
  base: RGBA
  core: RGBA
  dim: RGBA
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const color = (hex: string): RGBA => RGBA.fromHex(hex)

const COLORS = {
  bg: color("#07111f"),
  bgMap: color("#091728"),
  bgPanel: color("#0d1d31"),
  bgSelected: color("#193a50"),
  line: color("#24506b"),
  lineDim: color("#16334b"),
  text: color("#d5e7f2"),
  textDim: color("#718da1"),
  textFaint: color("#3c5c70"),
  white: color("#f5fbff"),
  cyan: color("#67e8f9"),
  blue: color("#60a5fa"),
  violet: color("#c4b5fd"),
  magenta: color("#f0abfc"),
  green: color("#86efac"),
  yellow: color("#fde68a"),
  orange: color("#fdba74"),
  red: color("#fb7185"),
  attention: color("#ffcf5c"),
  attentionHot: color("#ff6b6b"),
  priority1: color("#ffb86b"),
  priority2: color("#8be9fd"),
  priority3: color("#94a3b8"),
  priority4: color("#64748b"),
  nebula: color("#2d6b91"),
  black: color("#000000"),
} as const

const KIND_COLOR: Record<NodeKind, RGBA> = {
  goal: COLORS.cyan,
  session: COLORS.green,
  repository: COLORS.blue,
  worktree: COLORS.yellow,
}

const KIND_COLOR_DIM: Record<NodeKind, RGBA> = {
  goal: color("#397080"),
  session: color("#3f7055"),
  repository: color("#3f6591"),
  worktree: color("#8a7441"),
}

const KIND_SYMBOL: Record<NodeKind, string> = {
  goal: "◉",
  session: "●",
  repository: "■",
  worktree: "◇",
}

// Primary nodes inherit a stable colour family from their goal. That keeps
// the map relational without turning status into a colour-only encoding.
const GOAL_PALETTE: Record<string, NodePalette> = {
  "goal-router": {
    base: COLORS.cyan,
    core: color("#d9fbff"),
    dim: color("#2d7180"),
  },
  "goal-food": {
    base: COLORS.orange,
    core: color("#fff0c8"),
    dim: color("#896332"),
  },
  "goal-mason": {
    base: COLORS.violet,
    core: color("#eee8ff"),
    dim: color("#6a5b96"),
  },
}

const paletteForNode = (node: FixtureNode): NodePalette => {
  const goalId = node.kind === "goal" ? node.id : node.goalId
  if (goalId && GOAL_PALETTE[goalId]) return GOAL_PALETTE[goalId]
  return {
    base: KIND_COLOR[node.kind],
    core: COLORS.white,
    dim: KIND_COLOR_DIM[node.kind],
  }
}

function fixtureNode(
  id: string,
  kind: NodeKind,
  label: string,
  scope: number,
  priority: number,
  description: string,
  extra: Partial<FixtureNode> = {},
): FixtureNode {
  return {
    id,
    kind,
    label,
    description,
    scope,
    priority,
    status: "active",
    attention: false,
    recency: 0.65,
    activeAgents: 0,
    totalSessions: 0,
    ...extra,
  }
}

const sessionRepositoryIds = (node: FixtureNode): string[] => node.repositoryIds ?? (node.repositoryId ? [node.repositoryId] : [])

const isPrimaryNode = (node: FixtureNode): boolean => node.kind === "goal" || node.kind === "session"

class DeterministicFixture {
  readonly nodes: FixtureNode[] = [
    fixtureNode(
      "goal-router",
      "goal",
      "Ship model router",
      13,
      1,
      "Produce a verified model-routing path with a clear rollback story.",
      { status: "active", totalSessions: 4 },
    ),
    fixtureNode(
      "goal-food",
      "goal",
      "Family food agent",
      11,
      2,
      "Turn an approved household list into a verified retailer basket.",
      { status: "waiting", totalSessions: 3 },
    ),
    fixtureNode(
      "goal-mason",
      "goal",
      "Harden Mason runtime",
      12,
      1,
      "Keep the narrow agent loop safe, understandable, and cheap to evaluate.",
      { status: "active", totalSessions: 2 },
    ),

    fixtureNode(
      "session-chief",
      "session",
      "chief-of-staff",
      5,
      1,
      "Coordinates routing work and delegates focused checks.",
      {
        status: "active",
        activeAgents: 2,
        totalSessions: 1,
        goalId: "goal-router",
        repositoryId: "repo-frontier",
        repositoryIds: ["repo-frontier"],
        worktreeId: "wt-router",
        provider: "codex",
        branch: "ao/router-main",
        runtime: "codex-agent",
        host: "herdr/tab-2",
        contextSize: "128k",
        changeMode: "write",
      },
    ),
    fixtureNode(
      "session-router",
      "session",
      "router-impl",
      4,
      1,
      "Implements deterministic routing and exposes fallback reasons.",
      {
        status: "active",
        activeAgents: 1,
        goalId: "goal-router",
        repositoryId: "repo-frontier",
        repositoryIds: ["repo-frontier"],
        worktreeId: "wt-router",
        delegatedBy: "session-chief",
        provider: "codex",
        branch: "ao/router-main",
        runtime: "codex-agent",
        host: "herdr/tab-2",
        contextSize: "64k",
        changeMode: "write",
      },
    ),
    fixtureNode(
      "session-review",
      "session",
      "router-review",
      4,
      1,
      "Waiting on a human choice between cache policies.",
      {
        status: "blocked",
        attention: true,
        activeAgents: 0,
        goalId: "goal-router",
        repositoryId: "repo-frontier",
        repositoryIds: ["repo-frontier"],
        worktreeId: "wt-evals",
        delegatedBy: "session-chief",
        provider: "claude",
        branch: "ao/router-review",
        runtime: "claude-code",
        host: "herdr/tab-2",
        contextSize: "200k",
        changeMode: "read",
      },
    ),
    fixtureNode(
      "session-evals",
      "session",
      "quality-evals",
      4,
      1,
      "Runs the small quality and cost matrix against recorded fixtures.",
      {
        status: "active",
        activeAgents: 1,
        goalId: "goal-router",
        repositoryId: "repo-frontier",
        repositoryIds: ["repo-frontier", "repo-ao"],
        worktreeId: "wt-evals",
        provider: "codex",
        branch: "ao/router-evals",
        runtime: "codex-agent",
        host: "herdr/tab-2",
        contextSize: "64k",
        changeMode: "read",
      },
    ),
    fixtureNode(
      "session-basket",
      "session",
      "basket-lead",
      5,
      2,
      "Owns the approved-list to basket proof and delegates browser work.",
      {
        status: "active",
        activeAgents: 2,
        goalId: "goal-food",
        repositoryId: "repo-food",
        repositoryIds: ["repo-food"],
        worktreeId: "wt-checkout",
        provider: "codex",
        branch: "food/basket-proof",
        runtime: "codex-agent",
        host: "herdr/tab-3",
        contextSize: "128k",
        changeMode: "write",
      },
    ),
    fixtureNode(
      "session-browser",
      "session",
      "retailer-browser",
      4,
      2,
      "Verifies a basket in a retailer session and reads it back.",
      {
        status: "active",
        activeAgents: 1,
        goalId: "goal-food",
        repositoryId: "repo-food",
        repositoryIds: ["repo-food"],
        worktreeId: "wt-checkout",
        delegatedBy: "session-basket",
        provider: "codex",
        branch: "food/basket-proof",
        runtime: "browser-run",
        host: "herdr/tab-3",
        contextSize: "64k",
        changeMode: "read",
      },
    ),
    fixtureNode(
      "session-checkout",
      "session",
      "human-checkout",
      4,
      2,
      "Paused at the point where the operator must approve checkout.",
      {
        status: "waiting",
        attention: true,
        activeAgents: 0,
        goalId: "goal-food",
        repositoryId: "repo-food",
        repositoryIds: ["repo-food"],
        worktreeId: "wt-checkout",
        delegatedBy: "session-basket",
        provider: "codex",
        branch: "food/checkout-handoff",
        runtime: "human-handoff",
        host: "terminal",
        contextSize: "32k",
        changeMode: "human",
      },
    ),
    fixtureNode(
      "session-mason",
      "session",
      "mason-loop",
      5,
      1,
      "Exercises the narrow tool loop with captured events and safe exit.",
      {
        status: "active",
        activeAgents: 2,
        goalId: "goal-mason",
        repositoryId: "repo-mason",
        repositoryIds: ["repo-mason"],
        worktreeId: "wt-mason",
        provider: "codex",
        branch: "mason/narrow-loop",
        runtime: "codex-agent",
        host: "herdr/tab-4",
        contextSize: "64k",
        changeMode: "write",
      },
    ),
    fixtureNode(
      "session-qa",
      "session",
      "artifact-qa",
      4,
      1,
      "Checks that artifacts complete ordinarily and terminal cleanup is safe.",
      {
        status: "idle",
        activeAgents: 0,
        goalId: "goal-mason",
        repositoryId: "repo-mason",
        repositoryIds: ["repo-mason"],
        worktreeId: "wt-mason",
        delegatedBy: "session-mason",
        provider: "claude",
        branch: "mason/artifact-qa",
        runtime: "claude-code",
        host: "herdr/tab-4",
        contextSize: "32k",
        changeMode: "read",
      },
    ),

  ]

  // Execution records intentionally live outside `nodes`. They can outlive a
  // session and appear only through the optional repository-topology lens.
  readonly infrastructure: FixtureNode[] = [
    fixtureNode("repo-frontier", "repository", "frontier", 8, 1, "Synthetic repository anchor used by routing sessions.", { branch: "dev" }),
    fixtureNode("repo-food", "repository", "family-food-agent", 7, 2, "Synthetic clean-room food-agent repository.", { branch: "main" }),
    fixtureNode("repo-mason", "repository", "mason", 7, 1, "Synthetic narrow runtime repository.", { branch: "main" }),
    fixtureNode("repo-ao", "repository", "ao-spike", 5, 3, "Repository used by the disposable rendering experiment.", { branch: "experiment" }),
    fixtureNode("wt-router", "worktree", "router-main", 4, 1, "Shared write-capable worktree for the routing implementation.", { repositoryId: "repo-frontier", branch: "ao/router-main" }),
    fixtureNode("wt-evals", "worktree", "router-evals", 4, 1, "Shared read-heavy evaluation worktree with overlapping files.", { repositoryId: "repo-frontier", branch: "ao/router-evals" }),
    fixtureNode("wt-checkout", "worktree", "basket-proof", 4, 2, "Shared browser proof worktree; checkout remains human-controlled.", { repositoryId: "repo-food", branch: "food/basket-proof" }),
    fixtureNode("wt-mason", "worktree", "mason-loop", 4, 1, "Shared runtime and artifact-check worktree.", { repositoryId: "repo-mason", branch: "mason/narrow-loop" }),
    fixtureNode("wt-spike", "worktree", "opentui-spike", 3, 3, "Disposable native-terminal rendering worktree.", { repositoryId: "repo-ao", branch: "experiment/opentui" }),
  ]

  private readonly baseRelations: FixtureRelation[] = [
    { from: "goal-router", to: "session-chief", type: "contains" },
    { from: "goal-router", to: "session-router", type: "contains" },
    { from: "goal-router", to: "session-review", type: "contains" },
    { from: "goal-router", to: "session-evals", type: "contains" },
    { from: "goal-food", to: "session-basket", type: "contains" },
    { from: "goal-food", to: "session-browser", type: "contains" },
    { from: "goal-food", to: "session-checkout", type: "contains" },
    { from: "goal-mason", to: "session-mason", type: "contains" },
    { from: "goal-mason", to: "session-qa", type: "contains" },

    { from: "session-chief", to: "session-router", type: "delegated-to" },
    { from: "session-chief", to: "session-review", type: "delegated-to" },
    { from: "session-basket", to: "session-browser", type: "delegated-to" },
    { from: "session-basket", to: "session-checkout", type: "delegated-to" },
    { from: "session-mason", to: "session-qa", type: "delegated-to" },

    { from: "session-evals", to: "session-router", type: "depends-on" },
    { from: "session-review", to: "session-router", type: "reviews" },
    { from: "session-evals", to: "session-chief", type: "result-handoff" },
    { from: "session-browser", to: "session-checkout", type: "result-handoff" },
    { from: "session-qa", to: "session-mason", type: "result-handoff" },

    { from: "repo-frontier", to: "wt-router", type: "contains" },
    { from: "repo-frontier", to: "wt-evals", type: "contains" },
    { from: "repo-food", to: "wt-checkout", type: "contains" },
    { from: "repo-mason", to: "wt-mason", type: "contains" },
    { from: "repo-ao", to: "wt-spike", type: "contains" },

    { from: "session-chief", to: "repo-frontier", type: "uses" },
    { from: "session-router", to: "repo-frontier", type: "uses" },
    { from: "session-review", to: "repo-frontier", type: "uses" },
    { from: "session-evals", to: "repo-frontier", type: "uses" },
    { from: "session-evals", to: "repo-ao", type: "uses" },
    { from: "session-basket", to: "repo-food", type: "uses" },
    { from: "session-browser", to: "repo-food", type: "uses" },
    { from: "session-checkout", to: "repo-food", type: "uses" },
    { from: "session-mason", to: "repo-mason", type: "uses" },
    { from: "session-qa", to: "repo-mason", type: "uses" },
    { from: "session-chief", to: "wt-router", type: "integrates-into" },
    { from: "session-router", to: "wt-router", type: "integrates-into" },
    { from: "session-review", to: "wt-evals", type: "integrates-into" },
    { from: "session-evals", to: "wt-evals", type: "integrates-into" },
    { from: "session-basket", to: "wt-checkout", type: "integrates-into" },
    { from: "session-browser", to: "wt-checkout", type: "integrates-into" },
    { from: "session-checkout", to: "wt-checkout", type: "integrates-into" },
    { from: "session-mason", to: "wt-mason", type: "integrates-into" },
    { from: "session-qa", to: "wt-mason", type: "integrates-into" },
  ]

  get relations(): FixtureRelation[] {
    return [...this.baseRelations, ...this.derivedInfrastructureRelations()]
  }

  readonly layout: Map<string, Point>
  private ticks = 0

  constructor() {
    this.recomputeAggregates()
    this.layout = this.buildDeterministicLayout()
  }

  get nodeCount(): number {
    return this.nodes.length
  }

  get sessionCount(): number {
    return this.nodes.filter((node) => node.kind === "session").length
  }

  get infrastructureCount(): number {
    return this.infrastructure.length
  }

  visibleNodes(repositoryTopology: boolean): FixtureNode[] {
    return repositoryTopology ? [...this.nodes, ...this.infrastructure] : this.nodes
  }

  get(id: string): FixtureNode | undefined {
    return [...this.nodes, ...this.infrastructure].find((node) => node.id === id)
  }

  private derivedInfrastructureRelations(): FixtureRelation[] {
    const relations: FixtureRelation[] = []
    const sessionsByWorktree = new Map<string, FixtureNode[]>()
    for (const session of this.nodes.filter((node) => node.kind === "session" && node.worktreeId)) {
      const sessions = sessionsByWorktree.get(session.worktreeId!) ?? []
      sessions.push(session)
      sessionsByWorktree.set(session.worktreeId!, sessions)
    }

    for (const sessions of sessionsByWorktree.values()) {
      for (let index = 0; index < sessions.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < sessions.length; otherIndex += 1) {
          const first = sessions[index]
          const second = sessions[otherIndex]
          if (!first || !second) continue
          relations.push({ from: first.id, to: second.id, type: "shared-worktree" })
          if (first.changeMode === "write" && second.changeMode === "write") {
            relations.push({ from: first.id, to: second.id, type: "conflict-risk" })
          }
        }
      }
    }
    return relations
  }

  private buildDeterministicLayout(): Map<string, Point> {
    const positions = new Map<string, Point>()
    const goals = this.nodes.filter((node) => node.kind === "goal")
    // Place goal systems around the available field instead of putting every
    // goal on one horizontal shelf. With three goals this forms a stable
    // triangle: the first goal starts at the top focus position and the other
    // systems occupy the lower left/right field.
    const goalOrbitX = goals.length <= 3 ? 24 : clamp(18 + goals.length * 2, 18, 32)
    const goalOrbitY = goals.length <= 3 ? 9 : clamp(7 + goals.length, 7, 14)
    for (const [index, goal] of goals.entries()) {
      const angle = -Math.PI / 2 + (index / Math.max(1, goals.length)) * Math.PI * 2
      positions.set(goal.id, {
        x: clamp(Math.round(50 + Math.cos(angle) * goalOrbitX), 16, 84),
        y: clamp(Math.round(20 + Math.sin(angle) * goalOrbitY), 8, 30),
      })
    }

    for (const goal of goals) {
      const goalPoint = positions.get(goal.id) ?? { x: 50, y: 16 }
      const sessions = this.nodes.filter((node) => node.kind === "session" && node.goalId === goal.id)
      const orbitRadiusX = 10
      const orbitRadiusY = 6
      for (const [index, session] of sessions.entries()) {
        const angle = -Math.PI / 2 + (index / Math.max(1, sessions.length)) * Math.PI * 2
        positions.set(session.id, {
          x: clamp(Math.round(goalPoint.x + Math.cos(angle) * orbitRadiusX), goalPoint.x - 14, goalPoint.x + 14),
          y: clamp(Math.round(goalPoint.y + Math.sin(angle) * orbitRadiusY), 5, 35),
        })
      }
    }

    const repositories = this.infrastructure.filter((node) => node.kind === "repository")
    for (const [index, repository] of repositories.entries()) {
      const relatedSessions = this.nodes.filter((session) => session.kind === "session" && sessionRepositoryIds(session).includes(repository.id))
      const relatedXs = relatedSessions.map((session) => positions.get(session.id)?.x).filter((x): x is number => x !== undefined)
      const fallbackX = centeredLayoutPositions(50, repositories.length, 24)[index] ?? 90
      const repositoryX = relatedXs.length > 0 ? relatedXs.reduce((total, x) => total + x, 0) / relatedXs.length : Math.max(78, fallbackX)
      positions.set(repository.id, { x: clamp(repositoryX, 8, 92), y: 32 })

      const worktrees = this.infrastructure.filter((node) => node.kind === "worktree" && node.repositoryId === repository.id)
      const worktreeXs = centeredLayoutPositions(repositoryX, worktrees.length, 8)
      for (const [worktreeIndex, worktree] of worktrees.entries()) {
        positions.set(worktree.id, { x: worktreeXs[worktreeIndex] ?? repositoryX, y: 37 })
      }
    }

    const allNodes = [...this.nodes, ...this.infrastructure]
    const fallbackPositions = centeredLayoutPositions(50, allNodes.length, 2)
    for (const [index, node] of allNodes.entries()) {
      if (!positions.has(node.id)) positions.set(node.id, { x: fallbackPositions[index] ?? 50, y: 20 })
    }

    return positions
  }

  tick(): void {
    this.ticks += 1
    const wave = this.ticks / 5

    for (const [index, node] of this.nodes.entries()) {
      node.recency = clamp(0.52 + 0.38 * Math.sin(wave + index * 0.63), 0.08, 1)

      if (node.kind === "session") {
        const activityWave = Math.sin(wave * 1.7 + index)
        node.activeAgents = node.id === "session-chief" || node.id === "session-mason" ? 2 : activityWave > -0.35 ? 1 : 0

        if (node.id === "session-review") {
          node.status = this.ticks % 24 < 18 ? "blocked" : "waiting"
          node.attention = true
        } else if (node.id === "session-checkout") {
          node.status = this.ticks % 40 < 32 ? "waiting" : "active"
          node.attention = true
        } else if (node.id === "session-qa") {
          node.status = this.ticks % 32 < 8 ? "active" : "idle"
          node.attention = false
        } else if (node.id === "session-router" || node.id === "session-evals") {
          node.status = this.ticks % 18 < 15 ? "active" : "waiting"
          node.attention = false
        } else {
          node.status = "active"
          node.attention = false
        }
      }
    }

    this.recomputeAggregates()
  }

  private recomputeAggregates(): void {
    for (const node of this.nodes) {
      node.infrastructureWarning = false
      node.infrastructureWarningText = undefined
    }

    for (const node of this.nodes) {
      if (node.kind === "goal") {
        const sessions = this.nodes.filter((child) => child.kind === "session" && child.goalId === node.id)
        node.totalSessions = sessions.length
        node.activeAgents = sessions.reduce((total, child) => total + child.activeAgents, 0)
        node.attention = sessions.some((child) => child.attention)
        node.status = sessions.some((child) => child.status === "blocked") ? "blocked" : node.attention ? "waiting" : "active"
      }
    }

    const goalWarningCounts = new Map<string, { shared: number; conflicts: number }>()
    const sessionsByWorktree = new Map<string, FixtureNode[]>()
    for (const session of this.nodes.filter((node) => node.kind === "session" && node.worktreeId)) {
      const sessions = sessionsByWorktree.get(session.worktreeId!) ?? []
      sessions.push(session)
      sessionsByWorktree.set(session.worktreeId!, sessions)
    }

    for (const [worktreeId, sessions] of sessionsByWorktree.entries()) {
      if (sessions.length < 2) continue
      const worktreeLabel = this.get(worktreeId)?.label ?? worktreeId
      const writeSessions = sessions.filter((session) => session.changeMode === "write")
      const conflict = writeSessions.length > 1
      for (const session of sessions) {
        session.infrastructureWarning = conflict
        session.infrastructureWarningText = conflict
          ? `shared worktree ${worktreeLabel}; possible change conflict`
          : `shared worktree ${worktreeLabel} (${sessions.length} sessions)`
        if (session.goalId) {
          const counts = goalWarningCounts.get(session.goalId) ?? { shared: 0, conflicts: 0 }
          counts.shared += 1
          if (conflict) counts.conflicts += 1
          goalWarningCounts.set(session.goalId, counts)
        }
      }
    }

    for (const goal of this.nodes.filter((node) => node.kind === "goal")) {
      const counts = goalWarningCounts.get(goal.id)
      if (!counts) continue
      goal.infrastructureWarning = counts.conflicts > 0
      goal.infrastructureWarningText = counts.conflicts > 0
        ? `execution infrastructure: shared sessions; ${counts.conflicts} conflict risk`
        : `execution infrastructure: ${counts.shared} sessions share worktrees`
    }

    for (const node of this.infrastructure) {
      const sessions = node.kind === "repository"
        ? this.nodes.filter((child) => child.kind === "session" && sessionRepositoryIds(child).includes(node.id))
        : this.nodes.filter((child) => child.kind === "session" && child.worktreeId === node.id)
      node.activeAgents = sessions.reduce((total, child) => total + child.activeAgents, 0)
      node.totalSessions = sessions.length
      node.attention = sessions.some((child) => child.attention)
      node.status = node.attention ? "waiting" : node.activeAgents > 0 ? "active" : "idle"
    }
  }
}

const modeName = (mode: VisualMode): string =>
  mode === 1 ? "Portable constellation" : mode === 2 ? "Orbital systems" : "Enhanced experiment"

const statusLabel = (node: FixtureNode): string => {
  if (node.attention) return "HUMAN ATTENTION"
  if (node.status === "blocked") return "BLOCKED"
  if (node.status === "active") return "ACTIVE"
  if (node.status === "waiting") return "WAITING"
  if (node.status === "done") return "DONE"
  return "IDLE"
}

const statusGlyph = (node: FixtureNode): string => {
  if (node.attention) return "!"
  if (node.infrastructureWarning) return "⚠"
  if (node.status === "blocked") return "×"
  if (node.status === "waiting") return "?"
  if (node.status === "done") return "✓"
  if (node.status === "idle") return "·"
  return KIND_SYMBOL[node.kind]
}

const relationLabel = (type: RelationType): string => {
  if (type === "delegated-to") return "delegates to"
  if (type === "depends-on") return "depends on"
  if (type === "integrates-into") return "integrates into"
  if (type === "result-handoff") return "result handoff to"
  if (type === "shared-worktree") return "shares worktree with"
  if (type === "conflict-risk") return "conflict risk with"
  if (type === "uses") return "uses repository"
  return type
}

const priorityColor = (priority: number): RGBA => {
  if (priority <= 1) return COLORS.priority1
  if (priority === 2) return COLORS.priority2
  if (priority === 3) return COLORS.priority3
  return COLORS.priority4
}

const shorten = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 1)}…`
}

const wrap = (value: string, maxLength: number): string[] => {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    if (!line) {
      line = word
    } else if (`${line} ${word}`.length <= maxLength) {
      line += ` ${word}`
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : [""]
}

const centeredLayoutPositions = (center: number, count: number, spacing: number, minimum = 5, maximum = 95): number[] => {
  if (count <= 0) return []
  const span = Math.max(0, (count - 1) * spacing)
  const start = clamp(center - span / 2, minimum, maximum - span)
  return Array.from({ length: count }, (_, index) => clamp(start + index * spacing, minimum, maximum))
}

const stableNumber = (value: string): number => {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return hash
}

class UniverseApp {
  private readonly fixture = new DeterministicFixture()
  private readonly state: AppState = {
    mode: 1,
    selectedId: "goal-router",
    hoveredId: null,
    inspector: true,
    diagnostics: true,
    searchActive: false,
    query: "",
    panX: 0,
    panY: 0,
    zoom: 1,
    focusOnly: true,
    repositoryTopology: false,
    phase: 0,
    tickCount: 0,
    updateTimes: [],
    lastAction: "ready",
    enhancedFallback: null,
    suspended: false,
  }

  private readonly canvas: FrameBufferRenderable
  private readonly hitTargets: HitTarget[] = []
  private readonly labelRects: Rect[] = []
  private readonly currentNodeBounds: Array<{ id: string; rect: Rect }> = []
  private currentPortableFocus = new Set<string>()
  private currentMapRect: Rect | null = null
  private updateTimer: ReturnType<typeof setInterval> | undefined
  private suspendTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private lastDrawDuration = 0
  private frameCounter = 0
  private dragState: { lastX: number; lastY: number } | null = null

  constructor(private readonly renderer: CliRenderer) {
    this.canvas = new FrameBufferRenderable(renderer, {
      id: "disposable-ao-observatory-framebuffer",
      width: renderer.width,
      height: renderer.height,
      respectAlpha: true,
      onMouse: (event) => this.handleMouse(event),
      onMouseMove: (event) => {
        if (event.isDragging) this.handleMouseDrag(event)
        else this.handleMouseMove(event)
      },
      onMouseDrag: (event) => this.handleMouseDrag(event),
      onMouseDragEnd: (event) => this.handleMouseDragEnd(event),
      onMouseScroll: (event) => this.handleMouseScroll(event),
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
    renderer.setTerminalTitle("AO Observatory — disposable OpenTUI spike")
  }

  start(): void {
    this.updateTimer = setInterval(() => {
      if (this.closed) return
      this.fixture.tick()
      this.state.tickCount += 1
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
    this.frameCounter += 1
    const buffer = this.canvas.frameBuffer
    const width = this.renderer.width
    const height = this.renderer.height

    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height

    buffer.clear(COLORS.bg)
    this.hitTargets.length = 0

    const viewport = this.getViewport(width, height)
    const visibleNodes = this.visibleNodes()
    this.currentPortableFocus = this.state.mode === 1 && this.state.focusOnly ? this.buildPortableFocus() : new Set(visibleNodes.map((node) => node.id))
    this.labelRects.length = 0
    this.currentNodeBounds.length = 0
    for (const node of visibleNodes) {
      const point = this.worldToScreen(node, viewport.inner)
      const radii = this.nodeRadii(node)
      if (this.inRect(point, viewport.inner, radii.radiusX + 1, radii.radiusY + 1)) {
        this.currentNodeBounds.push({
          id: node.id,
          rect: {
            x: point.x - radii.radiusX - 1,
            y: point.y - radii.radiusY - 1,
            width: radii.radiusX * 2 + 3,
            height: radii.radiusY * 2 + 3,
          },
        })
      }
    }
    this.drawHeader(buffer, width)
    this.drawMap(buffer, viewport)
    if (viewport.inspector) this.drawInspector(buffer, viewport.inspector)
    this.drawFooter(buffer, width, height)

    this.lastDrawDuration = performance.now() - started
  }

  private visibleNodes(): FixtureNode[] {
    return this.fixture.visibleNodes(this.state.repositoryTopology)
  }

  private toggleRepositoryTopology(): void {
    this.state.repositoryTopology = !this.state.repositoryTopology
    const selected = this.fixture.get(this.state.selectedId)
    if (!this.state.repositoryTopology && selected && !isPrimaryNode(selected)) {
      const relatedSession = this.fixture.nodes.find((node) => node.kind === "session" && (selected.kind === "worktree" ? node.worktreeId === selected.id : sessionRepositoryIds(node).includes(selected.id)))
      this.state.selectedId = relatedSession?.goalId ?? "goal-router"
    }
    this.state.lastAction = `repository topology lens ${this.state.repositoryTopology ? "shown" : "hidden"}`
  }

  private getViewport(width: number, height: number): Viewport & { inspector?: Rect } {
    const headerHeight = 3
    const footerHeight = Math.min(4, Math.max(3, height - headerHeight - 1))
    const wantsInspector = this.state.inspector
    const wideInspector = wantsInspector && width >= 100
    const inspectorWidth = wideInspector ? 34 : 0
    let mapHeight = Math.max(5, height - headerHeight - footerHeight)
    let inspector: Rect | undefined

    // A bottom inspector is useful only when it leaves the spatial map enough
    // rows to breathe. On short terminals keep the map full-height; selection
    // remains visible in the header/footer and the inspector returns as soon
    // as the terminal is widened or made taller.
    if (wantsInspector && !wideInspector && height >= 26) {
      const inspectorHeight = Math.min(11, Math.max(7, Math.floor(height * 0.28)))
      mapHeight = Math.max(5, mapHeight - inspectorHeight)
      inspector = { x: 0, y: headerHeight + mapHeight, width, height: inspectorHeight }
    } else if (wideInspector) {
      inspector = { x: width - inspectorWidth, y: headerHeight, width: inspectorWidth, height: mapHeight }
    }

    const map = { x: 0, y: headerHeight, width: Math.max(20, width - inspectorWidth), height: mapHeight }
    return { ...map, inner: { x: map.x + 1, y: map.y + 1, width: Math.max(1, map.width - 2), height: Math.max(1, map.height - 2) }, inspector }
  }

  private drawHeader(buffer: OptimizedBuffer, width: number): void {
    const title = "AO OBSERVATORY  /  DISPOSABLE NATIVE POC"
    const mode = `[${this.state.mode}] ${modeName(this.state.mode)}`
    const stats = this.renderer.getStats()
    const fps = stats.fps > 0 ? stats.fps : 0
    const frameTime = stats.averageFrameTime > 0 ? stats.averageFrameTime : this.lastDrawDuration
    const updateRate = this.updateRate()
    const capability = this.capabilitySummary(this.renderer.capabilities)
    const visibleCount = this.visibleNodes().length
    const lensLabel = this.state.repositoryTopology ? "repo lens" : "intent map"

    this.text(buffer, title, 1, 0, COLORS.white, COLORS.bg, TextAttributes.BOLD)
    this.textRight(buffer, mode, width - 1, 0, this.modeColor(), COLORS.bg, TextAttributes.BOLD)
    const compact = width < 100
    const leftHint = compact ? "1/2/3 modes  j/k select  v infra  f lens  / find" : "1 portable  2 orbital  3 enhanced  v infra lens  f lens"
    this.text(buffer, leftHint, 1, 1, COLORS.textDim, COLORS.bg)
    const diagnostic = this.state.diagnostics
      ? compact
        ? `FPS ${fps.toFixed(0)}  ${frameTime.toFixed(1)}ms  N${visibleCount}  S${this.fixture.sessionCount}  U${updateRate.toFixed(0)}/s  ${capability}`
        : `FPS ${fps.toFixed(1)}  ${frameTime.toFixed(1)}ms  N ${visibleCount}  S ${this.fixture.sessionCount}  I ${this.fixture.infrastructureCount}  U ${updateRate.toFixed(1)}/s  GFX ${capability}`
      : compact
        ? `diag off  N${visibleCount}  S${this.fixture.sessionCount}  U${updateRate.toFixed(0)}/s`
        : `diagnostics off  |  N${visibleCount} visible / S${this.fixture.sessionCount} sessions  |  updates ${updateRate.toFixed(1)}/s`
    this.textRight(buffer, shorten(diagnostic, Math.max(10, width - leftHint.length - 4)), width - 1, 1, COLORS.textDim, COLORS.bg)
    const rightStatus = this.state.searchActive
      ? `find: ${this.state.query || "_"}`
      : compact
        ? this.state.mode === 1
          ? this.state.focusOnly
            ? `focus · ${this.state.repositoryTopology ? "repo" : "intent"}`
            : `full · ${this.state.repositoryTopology ? "repo" : "intent"}`
          : `${this.state.repositoryTopology ? "repo" : "AO"} map`
        : this.state.mode === 1
          ? this.state.focusOnly
            ? `focus path / ${lensLabel} / in-memory`
            : `full topology / ${lensLabel} / in-memory`
          : `map / ${lensLabel} / in-memory`
    const leftStatus = shorten(this.state.lastAction, Math.max(4, width - rightStatus.length - 4))
    this.text(buffer, leftStatus, 1, 2, this.state.suspended ? COLORS.attentionHot : COLORS.textFaint, COLORS.bg)
    this.textRight(buffer, rightStatus, width - 1, 2, this.state.searchActive ? COLORS.attention : COLORS.textFaint, COLORS.bg)
  }

  private drawMap(buffer: OptimizedBuffer, viewport: Viewport): void {
    this.currentMapRect = viewport.inner
    this.panel(buffer, viewport, COLORS.bgMap, COLORS.lineDim)
    const visibleNodes = this.visibleNodes()
    const positions = new Map<string, Point>()
    for (const node of visibleNodes) positions.set(node.id, this.worldToScreen(node, viewport.inner))

    if (this.state.mode === 1) {
      this.drawPortableBackground(buffer, viewport.inner)
    } else if (this.state.mode === 2) {
      this.drawOrbitalBackground(buffer, viewport.inner)
    } else {
      this.drawEnhancedBackground(buffer, viewport.inner)
    }

    this.drawRelations(buffer, viewport.inner, positions)
    if (this.state.mode !== 1) this.drawGoalOrbits(buffer, viewport.inner, positions)

    for (const node of visibleNodes) {
      const point = positions.get(node.id)
      if (!point) continue
      const radii = this.nodeRadii(node)
      if (!this.inRect(point, viewport.inner, radii.radiusX + 1, radii.radiusY + 1)) continue
      this.hitTargets.push({ id: node.id, x: point.x, y: point.y, radiusX: radii.radiusX + 1, radiusY: radii.radiusY + 1 })

      if (this.state.mode === 1) {
        this.drawPortableNode(buffer, node, point, radii, false)
      } else if (this.state.mode === 2) {
        this.drawOrbitalNode(buffer, node, point, radii, false)
      } else {
        this.drawEnhancedNode(buffer, node, point, radii, false)
      }
    }

    // Draw every card before any label. This prevents a later node body from
    // painting over an earlier label when two orbits get close on a cell grid.
    for (const node of visibleNodes) {
      const point = positions.get(node.id)
      if (!point) continue
      const radii = this.nodeRadii(node)
      if (this.inRect(point, viewport.inner, radii.radiusX + 1, radii.radiusY + 1)) this.drawCalmLabel(buffer, node, point, radii)
    }

  }

  private drawPortableBackground(buffer: OptimizedBuffer, rect: Rect): void {
    // Keep a quiet observing field. The cards and selected path should carry
    // the scene; a regular star grid competes with labels at terminal scale.
    for (let y = rect.y + 3; y < rect.y + rect.height; y += 7) {
      for (let x = rect.x + ((y / 7) % 5); x < rect.x + rect.width; x += 15) {
        this.cell(buffer, x, y, "·", COLORS.textFaint, COLORS.bgMap)
      }
    }
    const lens = this.state.focusOnly ? "selected path bright · f for full topology" : "full topology · f for selected path"
    const infrastructure = this.state.repositoryTopology ? " · repository topology lens" : " · infrastructure hidden"
    this.text(buffer, `PORTABLE OBSERVATORY  ·  direct goal/session  ·  ${lens}${infrastructure}`, rect.x + 2, rect.y, COLORS.cyan, COLORS.bgMap, TextAttributes.BOLD)
  }

  private drawOrbitalBackground(buffer: OptimizedBuffer, rect: Rect): void {
    for (let y = rect.y + 3; y < rect.y + rect.height - 1; y += 7) {
      this.hline(buffer, rect.x + 1, y, rect.width - 2, "·", COLORS.textFaint, COLORS.bgMap)
    }
    for (let i = 0; i < 16; i += 1) {
      const x = rect.x + 2 + ((i * 37 + 11) % Math.max(1, rect.width - 4))
      const y = rect.y + 2 + ((i * 17 + 5) % Math.max(1, rect.height - 4))
      this.cell(buffer, x, y, i % 4 === 0 ? "✦" : "·", i % 4 === 0 ? COLORS.blue : COLORS.textFaint, COLORS.bgMap)
    }
    const infrastructure = this.state.repositoryTopology ? " · repository topology lens" : " · infrastructure hidden"
    this.text(buffer, `ORBITAL OBSERVATORY  ·  direct goal/session orbits + frame-buffer motion${infrastructure}`, rect.x + 2, rect.y, COLORS.violet, COLORS.bgMap, TextAttributes.BOLD)
  }

  private drawEnhancedBackground(buffer: OptimizedBuffer, rect: Rect): void {
    const sourceWidth = Math.max(1, Math.min(96, rect.width))
    const sourceHeight = Math.max(2, Math.min(64, rect.height * 2))
    const intensity = new Float32Array(sourceWidth * sourceHeight)
    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const nx = x / Math.max(1, sourceWidth - 1)
        const ny = y / Math.max(1, sourceHeight - 1)
        const wave = Math.sin(nx * 11 + this.state.phase * 0.45) * 0.15 + Math.cos(ny * 15 - this.state.phase * 0.3) * 0.12
        const cloud = Math.max(0, 1 - Math.hypot(nx - 0.63, ny - 0.43) * 1.7)
        intensity[y * sourceWidth + x] = clamp(0.13 + cloud * 0.32 + wave, 0, 1)
      }
    }

    try {
      buffer.drawGrayscaleBufferSupersampled(rect.x + 1, rect.y + 1, intensity, sourceWidth, sourceHeight, COLORS.nebula, COLORS.bgMap)
      this.state.enhancedFallback = null
    } catch (error) {
      this.state.enhancedFallback = `supersampled native buffer unavailable (${String(error).slice(0, 42)})`
      this.drawOrbitalBackground(buffer, rect)
    }

    const infrastructure = this.state.repositoryTopology ? " · repository topology lens" : " · infrastructure hidden"
    this.text(buffer, `ENHANCED OBSERVATORY  ·  direct goal/session + native supersampled buffer${infrastructure}`, rect.x + 2, rect.y, COLORS.magenta, COLORS.bgMap, TextAttributes.BOLD)
  }

  private drawRelations(buffer: OptimizedBuffer, rect: Rect, positions: Map<string, Point>): void {
    for (const relation of this.fixture.relations) {
      const from = positions.get(relation.from)
      const to = positions.get(relation.to)
      if (!from || !to) continue
      const selectedRelation = relation.from === this.state.selectedId || relation.to === this.state.selectedId
      const focused = this.state.mode === 1 && this.state.focusOnly
        ? selectedRelation
        : this.currentPortableFocus.has(relation.from) && this.currentPortableFocus.has(relation.to)
      // The default lens is an observation of the selected node, not a graph
      // dump. Sibling conflicts, repository links, and delegation edges stay
      // available through selection, the inspector, or `f` full topology.
      if (this.state.mode === 1 && this.state.focusOnly && !selectedRelation) continue
      const portable = this.state.mode === 1
      const colour = relation.type === "conflict-risk"
        ? focused
          ? COLORS.attentionHot
          : COLORS.red
        : relation.type === "shared-worktree"
          ? focused
            ? COLORS.textDim
            : COLORS.textFaint
          : portable
            ? relation.type === "delegated-to" || relation.type === "result-handoff"
              ? focused
                ? COLORS.textDim
                : COLORS.lineDim
              : focused
                ? COLORS.line
                : COLORS.lineDim
            : relation.type === "delegated-to"
              ? COLORS.attention
              : relation.type === "result-handoff"
                ? COLORS.green
                : relation.type === "reviews"
                  ? COLORS.yellow
                  : relation.type === "depends-on"
                    ? COLORS.magenta
                    : relation.type === "integrates-into"
                      ? COLORS.blue
                      : relation.type === "uses"
                        ? COLORS.violet
                        : COLORS.line
      const glyph = portable
        ? relation.type === "conflict-risk"
          ? "×"
          : "·"
        : relation.type === "conflict-risk"
          ? "╳"
          : relation.type === "shared-worktree"
            ? "┈"
            : relation.type === "delegated-to"
              ? "╱"
              : relation.type === "reviews"
                ? "┈"
                : relation.type === "depends-on" || relation.type === "uses"
                  ? "┄"
                  : relation.type === "integrates-into"
                    ? "─"
                    : "·"
      this.line(buffer, from, to, rect, glyph, colour, COLORS.bgMap)
      if (relation.type === "delegated-to" || relation.type === "result-handoff" || relation.type === "reviews" || relation.type === "conflict-risk") {
        const marker = { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) }
        const markerGlyph = relation.type === "conflict-risk" ? "⚠" : relation.type === "delegated-to" ? "›" : relation.type === "result-handoff" ? "»" : "◇"
        const markerColor = relation.type === "conflict-risk" ? COLORS.attentionHot : relation.type === "delegated-to" ? COLORS.attention : relation.type === "result-handoff" ? COLORS.green : COLORS.yellow
        this.cell(buffer, marker.x, marker.y, markerGlyph, focused ? markerColor : COLORS.textFaint, COLORS.bgMap)
      }
    }
  }

  private drawGoalOrbits(buffer: OptimizedBuffer, rect: Rect, positions: Map<string, Point>): void {
    const goals = this.fixture.nodes.filter((node) => node.kind === "goal")
    for (const goal of goals) {
      const point = positions.get(goal.id)
      if (!point) continue
      const rx = Math.max(7, Math.round(10 * this.state.zoom))
      const ry = Math.max(4, Math.round(6 * this.state.zoom))
      for (let step = 0; step < 36; step += 1) {
        const angle = (step / 36) * Math.PI * 2
        const x = Math.round(point.x + Math.cos(angle) * rx)
        const y = Math.round(point.y + Math.sin(angle) * ry)
        if (step % 2 === 0) this.cell(buffer, x, y, "·", priorityColor(goal.priority), COLORS.bgMap)
      }
    }
  }

  private drawPortableNode(buffer: OptimizedBuffer, node: FixtureNode, point: Point, radii: { radiusX: number; radiusY: number }, drawLabel = true): void {
    this.drawCalmNode(buffer, node, point, radii, drawLabel)
  }

  private drawOrbitalNode(buffer: OptimizedBuffer, node: FixtureNode, point: Point, radii: { radiusX: number; radiusY: number }, drawLabel = true): void {
    this.drawCalmNode(buffer, node, point, radii, drawLabel)
  }

  private drawEnhancedNode(buffer: OptimizedBuffer, node: FixtureNode, point: Point, radii: { radiusX: number; radiusY: number }, drawLabel = true): void {
    this.drawCalmNode(buffer, node, point, radii, drawLabel)
  }

  private drawCalmNode(buffer: OptimizedBuffer, node: FixtureNode, point: Point, radii: { radiusX: number; radiusY: number }, drawLabel: boolean): void {
    const selected = this.state.selectedId === node.id
    const focused = this.state.mode !== 1 || !this.state.focusOnly || this.currentPortableFocus.has(node.id)
    const quiet = node.kind === "session" && this.state.mode === 1 && this.state.focusOnly && !focused && !node.attention
    const primary = node.kind === "goal" || node.kind === "session"
    const palette = paletteForNode(node)
    const priority = priorityColor(node.priority)
    const strongAttention = node.status === "blocked" || node.infrastructureWarningText?.includes("conflict") === true
    const pulse = node.attention
      ? Math.sin(this.state.phase * 2.2 + stableNumber(node.id)) > 0
        ? strongAttention ? COLORS.attentionHot : COLORS.attention
        : strongAttention ? this.mixWithBackground(COLORS.attentionHot, 0.5) : this.mixWithBackground(COLORS.attention, 0.5)
      : priority
    const priorityRing = quiet ? this.mixWithBackground(priority, 0.28) : this.mixWithBackground(priority, 0.68)
    const ring = selected
      ? COLORS.white
      : node.attention
        ? pulse
        : node.infrastructureWarning
          ? node.infrastructureWarningText?.includes("conflict") ? COLORS.attentionHot : COLORS.attention
          : priorityRing
    const surface = selected
      ? COLORS.bgSelected
      : quiet
        ? this.mixWithBackground(COLORS.bgPanel, 0.76)
        : this.mixWithBackground(COLORS.bgPanel, 0.92)
    const familyTint = node.kind === "goal" ? quiet ? 0.07 : 0.14 : quiet ? 0.02 : 0.055
    const cardFill = primary ? this.mixWithBackground(palette.base, familyTint) : surface
    const card = {
      x: point.x - radii.radiusX,
      y: point.y - radii.radiusY,
      width: radii.radiusX * 2 + 1,
      height: radii.radiusY * 2 + 1,
    }
    this.roundedPanel(buffer, card, cardFill, ring)

    const marker = node.attention
      ? strongAttention ? COLORS.attentionHot : COLORS.attention
      : node.infrastructureWarning
        ? node.infrastructureWarningText?.includes("conflict") ? COLORS.attentionHot : COLORS.attention
        : node.status === "blocked"
          ? COLORS.attentionHot
          : node.status === "waiting"
            ? COLORS.attention
            : node.status === "done"
              ? COLORS.textDim
              : node.status === "idle"
                ? COLORS.textFaint
                : palette.base

    if (node.kind === "goal") {
      this.cell(buffer, point.x, point.y, "◎", palette.core, cardFill, TextAttributes.BOLD)
    } else {
      this.cell(buffer, point.x, point.y, statusGlyph(node), marker, cardFill, selected || node.attention ? TextAttributes.BOLD : TextAttributes.NONE)
    }

    if (node.activeAgents > 0) {
      const activityColor = selected || this.state.hoveredId === node.id
        ? COLORS.green
        : quiet
          ? COLORS.textFaint
          : this.mixWithBackground(COLORS.green, 0.45)
      this.cell(buffer, point.x + radii.radiusX + 1, point.y, "·", activityColor, COLORS.bgMap)
    }

    if (drawLabel) this.drawCalmLabel(buffer, node, point, radii)
  }

  private drawCalmLabel(buffer: OptimizedBuffer, node: FixtureNode, point: Point, radii: { radiusX: number; radiusY: number }): void {
    const focused = this.state.mode !== 1 || !this.state.focusOnly || this.currentPortableFocus.has(node.id)
    const quiet = node.kind === "session" && this.state.mode === 1 && this.state.focusOnly && !focused && !node.attention
    const forceLabel = this.state.selectedId === node.id || focused || node.kind === "goal" || node.attention
    this.drawNodeLabel(buffer, node, point, radii, COLORS.bgMap, forceLabel, this.state.mode !== 1 && !quiet)
  }

  private drawNodeLabel(buffer: OptimizedBuffer, node: FixtureNode, point: Point, radii: { radiusX: number; radiusY: number }, background: RGBA, force: boolean, allowAmbient = false): void {
    const hovered = this.state.hoveredId === node.id
    const compact = this.renderer.width < 100 || this.renderer.height < 18
    if (compact && !hovered && this.state.selectedId !== node.id && !node.attention && node.kind !== "goal") return
    if (!force && !hovered && !allowAmbient) return
    if (!force && !hovered && node.kind === "session" && node.recency < 0.3) return
    const prefix = node.kind === "goal"
      ? node.attention ? "! G " : "G "
      : node.kind === "session"
        ? node.attention ? "! " : ""
        : node.kind === "repository" ? "R " : "T "
    const label = shorten(`${prefix}${node.label}`, node.kind === "goal" ? 22 : 18)
    const preferredX = point.x + radii.radiusX + 2
    const estimatedWidth = label.length
    const map = this.currentMapRect ?? { x: 0, y: 0, width: this.renderer.width, height: this.renderer.height }
    const rightEdge = map.x + map.width - 1
    const maxX = Math.max(map.x + 1, rightEdge - estimatedWidth)
    const maxY = Math.max(map.y + 1, map.y + map.height - 2)
    const leftX = preferredX + estimatedWidth < rightEdge ? preferredX : point.x - radii.radiusX - estimatedWidth - 2
    const sideCandidates = [
      { x: leftX, y: point.y - radii.radiusY },
      { x: point.x - radii.radiusX - estimatedWidth - 2, y: point.y - radii.radiusY },
    ]
    const centeredCandidates = [
      { x: point.x - Math.floor(estimatedWidth / 2), y: point.y - radii.radiusY - 2 },
      { x: point.x - Math.floor(estimatedWidth / 2), y: point.y + radii.radiusY + 1 },
    ]
    const candidates = (node.kind === "goal" ? [...centeredCandidates, ...sideCandidates] : [...sideCandidates, ...centeredCandidates]).map((candidate) => ({
      x: clamp(candidate.x, map.x + 1, maxX),
      y: clamp(candidate.y, map.y + 1, maxY),
    }))
    const chosen = candidates.find((candidate) => {
      const labelRect = { x: candidate.x, y: candidate.y, width: estimatedWidth, height: 1 }
      const overlapsLabel = this.labelRects.some((existing) => this.rectanglesOverlap(labelRect, existing, 1))
      const overlapsNode = this.currentNodeBounds.some(({ id, rect }) => id !== node.id && this.rectanglesOverlap(labelRect, rect))
      return !overlapsLabel && !overlapsNode
    })
    if (!chosen && this.state.selectedId !== node.id && node.kind !== "goal" && !node.attention) return
    const labelX = chosen?.x ?? candidates[0]?.x ?? map.x + 1
    const labelY = chosen?.y ?? candidates[0]?.y ?? map.y + 1
    const foreground = node.attention
      ? COLORS.attention
      : this.state.selectedId === node.id
        ? COLORS.white
        : paletteForNode(node).base
    this.text(buffer, label, labelX, labelY, foreground, background, node.kind === "goal" || hovered ? TextAttributes.BOLD : TextAttributes.NONE)
    this.labelRects.push({ x: labelX, y: labelY, width: estimatedWidth, height: 1 })
  }

  private drawInspector(buffer: OptimizedBuffer, rect: Rect): void {
    this.panel(buffer, rect, COLORS.bgPanel, COLORS.violet)
    const node = this.fixture.get(this.state.selectedId) ?? this.fixture.nodes[0]
    const contentWidth = Math.max(10, rect.width - 4)
    let y = rect.y + 1
    const write = (value: string, foreground = COLORS.text, attributes = TextAttributes.NONE): void => {
      if (y >= rect.y + rect.height - 1) return
      this.text(buffer, shorten(value, contentWidth), rect.x + 2, y, foreground, COLORS.bgPanel, attributes)
      y += 1
    }
    const writeWrapped = (value: string, foreground = COLORS.text): void => {
      for (const line of wrap(value, contentWidth)) write(line, foreground)
    }

    write("SELECTED NODE", COLORS.violet, TextAttributes.BOLD)
    write(`${KIND_SYMBOL[node.kind]} ${node.label}`, COLORS.white, TextAttributes.BOLD)
    write(`${node.kind.toUpperCase()}  ${node.id}`, paletteForNode(node).base)
    if (node.kind === "session") write(`tracked session · ${node.status === "idle" || node.status === "done" ? "stopped / resumable" : "live agent view"}`, COLORS.textDim)
    write(statusLabel(node), node.attention ? COLORS.attentionHot : node.status === "blocked" ? COLORS.red : COLORS.green, TextAttributes.BOLD)
    write(`priority P${node.priority}  scope ${node.scope}`)
    write(`live agents ${node.activeAgents}  tracked sessions ${node.totalSessions}`)
    write(`recency ${(node.recency * 100).toFixed(0)}%`)
    if (node.infrastructureWarning) writeWrapped(`EXECUTION WARNING  ${node.infrastructureWarningText ?? "shared execution infrastructure"}`, COLORS.attentionHot)
    y += 1
    writeWrapped(node.description, COLORS.textDim)
    y += 1
    write(`path  ${this.semanticPath(node)}`, COLORS.cyan)
    if (node.kind === "session") {
      const repositories = sessionRepositoryIds(node).map((repositoryId) => this.fixture.get(repositoryId)?.label ?? repositoryId)
      if (repositories.length > 0) write(`repositories ${repositories.join(", ")}`, COLORS.blue)
      if (node.branch) write(`branch ${node.branch}`, COLORS.textDim)
      if (node.worktreeId) {
        const worktree = this.fixture.get(node.worktreeId)
        const shared = this.fixture.nodes.some((other) => other.kind === "session" && other.id !== node.id && other.worktreeId === node.worktreeId)
        write(`worktree ${worktree?.label ?? node.worktreeId}${shared ? " · shared" : " · isolated"}`, node.infrastructureWarning ? COLORS.attention : shared ? COLORS.yellow : COLORS.textDim)
      }
      if (node.runtime) write(`runtime ${node.runtime}`, COLORS.textDim)
      if (node.host) write(`host ${node.host}`, COLORS.textDim)
      if (node.contextSize) write(`context ${node.contextSize}`, COLORS.textDim)
      if (node.changeMode) write(`changes ${node.changeMode}`, COLORS.textDim)
    } else if (node.kind === "goal") {
      const repositories = this.fixture.nodes
        .filter((session) => session.kind === "session" && session.goalId === node.id)
        .flatMap((session) => sessionRepositoryIds(session))
        .map((repositoryId) => this.fixture.get(repositoryId)?.label ?? repositoryId)
        .filter((label, index, labels) => labels.indexOf(label) === index)
      if (repositories.length > 0) write(`repositories ${repositories.join(", ")}`, COLORS.blue)
    } else {
      write("execution record · optional lens only", COLORS.textDim)
      if (node.kind === "worktree" && node.repositoryId) write(`repository ${this.fixture.get(node.repositoryId)?.label ?? node.repositoryId}`, COLORS.blue)
      const attachedSessions = this.fixture.nodes.filter((session) => session.kind === "session" && (node.kind === "worktree" ? session.worktreeId === node.id : sessionRepositoryIds(session).includes(node.id)))
      if (attachedSessions.length > 0) write(`sessions ${attachedSessions.map((session) => session.label).join(", ")}`, COLORS.textDim)
    }
    const outgoing = this.fixture.relations.filter((relation) => relation.from === node.id).map((relation) => `${relationLabel(relation.type)} → ${this.fixture.get(relation.to)?.label ?? relation.to}`)
    const incoming = this.fixture.relations.filter((relation) => relation.to === node.id).map((relation) => `← ${this.fixture.get(relation.from)?.label ?? relation.from} ${relationLabel(relation.type)}`)
    const relationships = [...outgoing, ...incoming]
    if (relationships.length > 0) {
      y += 1
      write("RELATIONSHIPS", COLORS.violet, TextAttributes.BOLD)
      for (const relation of relationships.slice(0, 5)) writeWrapped(relation, COLORS.textDim)
    }
    if (this.state.mode === 3) {
      y += 1
      write("ENHANCED PATH", COLORS.magenta, TextAttributes.BOLD)
      writeWrapped(this.enhancedReport(), COLORS.textDim)
    }
  }

  private drawFooter(buffer: OptimizedBuffer, width: number, height: number): void {
    const y = Math.max(0, height - 3)
    this.hline(buffer, 0, y - 1, width, "─", COLORS.line, COLORS.bg)
    const controls = "1/2/3 mode  j/k select  h/l/u/d pan  +/- or wheel zoom  drag pan  f focus  v infra  / find  i inspector  t diagnostics  s suspend  q quit"
    this.text(buffer, shorten(controls, Math.max(1, width - 2)), 1, y, COLORS.textDim, COLORS.bg)
    const query = this.state.query ? `find=${this.state.query}` : "find=none"
    const selection = this.fixture.get(this.state.selectedId)
    this.text(buffer, shorten(`${query}  selected=${selection?.label ?? "none"}`, Math.max(1, width - 2)), 1, y + 1, this.state.searchActive ? COLORS.attention : COLORS.textFaint, COLORS.bg)
    this.textRight(buffer, `mode ${this.state.mode}  ${this.state.suspended ? "SUSPENDED" : "live"}`, width - 1, y + 1, this.state.suspended ? COLORS.attentionHot : COLORS.green, COLORS.bg)
  }

  private worldToScreen(node: FixtureNode, rect: Rect): Point {
    const logical = this.fixture.layout.get(node.id) ?? { x: 50, y: 20 }
    const scaledX = 50 + (logical.x - 50) * this.state.zoom - this.state.panX
    const scaledY = 20 + (logical.y - 20) * this.state.zoom - this.state.panY
    return {
      x: Math.round(rect.x + (scaledX / 100) * rect.width),
      y: Math.round(rect.y + (scaledY / 40) * rect.height),
    }
  }

  private nodeRadii(node: FixtureNode): { radiusX: number; radiusY: number } {
    const compact = this.renderer.width < 100 || this.renderer.height < 18
    const base = node.kind === "goal"
      ? (compact ? 4 : 5) + (node.scope >= 12 ? 1 : 0)
      : node.kind === "session"
        ? compact ? 2 : 3
        : node.kind === "repository"
          ? compact ? 2 : 3
          : compact ? 1 : 2
    const vertical = node.kind === "goal" ? 2 : 1
    return {
      radiusX: Math.max(1, Math.round(base * clamp(this.state.zoom, 0.65, 1.4))),
      radiusY: Math.max(1, Math.round(vertical * clamp(this.state.zoom, 0.65, 1.4))),
    }
  }

  private inRect(point: Point, rect: Rect, padX = 0, padY = 0): boolean {
    return point.x >= rect.x - padX && point.x < rect.x + rect.width + padX && point.y >= rect.y - padY && point.y < rect.y + rect.height + padY
  }

  private rectanglesOverlap(first: Rect, second: Rect, padding = 0): boolean {
    return first.x < second.x + second.width + padding && first.x + first.width + padding > second.x && first.y < second.y + second.height + padding && first.y + first.height + padding > second.y
  }

  private semanticPath(node: FixtureNode): string {
    const labels: string[] = []
    if (node.kind === "goal") return node.label
    if (node.kind === "repository") return `repository / ${node.label}`
    if (node.kind === "worktree") {
      if (node.repositoryId) labels.push(this.fixture.get(node.repositoryId)?.label ?? node.repositoryId)
      labels.push(`worktree ${node.label}`)
      return labels.join(" / ")
    }
    if (node.goalId) labels.push(this.fixture.get(node.goalId)?.label ?? node.goalId)
    if (node.kind === "session" && node.delegatedBy) labels.push(`child of ${this.fixture.get(node.delegatedBy)?.label ?? node.delegatedBy}`)
    const repositories = sessionRepositoryIds(node).map((repositoryId) => this.fixture.get(repositoryId)?.label ?? repositoryId)
    if (repositories.length > 0) labels.push(`repos ${repositories.join(", ")}`)
    if (node.worktreeId) labels.push(this.fixture.get(node.worktreeId)?.label ?? node.worktreeId)
    return labels.length > 0 ? labels.join(" / ") : node.label
  }

  private buildPortableFocus(): Set<string> {
    const focus = new Set<string>([this.state.selectedId])
    let changed = true
    while (changed) {
      changed = false
      for (const relation of this.fixture.relations) {
        if (!focus.has(relation.from) && !focus.has(relation.to)) continue
        if (!focus.has(relation.from)) {
          focus.add(relation.from)
          changed = true
        }
        if (!focus.has(relation.to)) {
          focus.add(relation.to)
          changed = true
        }
      }
    }
    return focus
  }

  private modeColor(): RGBA {
    return this.state.mode === 1 ? COLORS.cyan : this.state.mode === 2 ? COLORS.violet : COLORS.magenta
  }

  private updateRate(): number {
    const now = performance.now()
    this.state.updateTimes = this.state.updateTimes.filter((timestamp) => now - timestamp < 1000)
    return this.state.updateTimes.length
  }

  private capabilitySummary(capabilities: TerminalCapabilities | null): string {
    if (!capabilities) return "detecting"
    const graphics = [capabilities.kitty_graphics ? "kitty" : "", capabilities.sixel ? "sixel" : "", capabilities.rgb ? "rgb" : "ansi"].filter(Boolean).join("+")
    return shorten(`${graphics || "cells"}/${capabilities.unicode}`, 24)
  }

  private enhancedReport(): string {
    const capabilities = this.renderer.capabilities
    const advertised = capabilities ? [capabilities.kitty_graphics ? "Kitty" : "", capabilities.sixel ? "Sixel" : ""].filter(Boolean).join(" + ") : "capability query pending"
    if (this.state.enhancedFallback) return `${this.state.enhancedFallback}; orbital cell fallback is active.`
    if (advertised) return `${advertised} advertised, but @opentui/core 0.4.5 exposes no public image or @opentui/three renderable here. Native supersampled framebuffer is active; no graphics escape sequence is emitted.`
    return "No Kitty/Sixel graphics advertised. Native supersampled framebuffer is active as the clean cell fallback; @opentui/three is not installed."
  }

  private handleKey(key: KeyEvent): void {
    if (key.eventType === "release") return
    if (key.ctrl && key.name === "c") {
      key.preventDefault()
      this.state.lastAction = "clean exit requested"
      this.shutdown()
      return
    }

    if (this.state.searchActive) {
      if (key.name === "escape") {
        this.state.searchActive = false
        this.state.query = ""
        this.state.lastAction = "search cleared"
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        this.state.query = this.state.query.slice(0, -1)
        this.applySearch()
        return
      }
      if (key.name === "return" || key.name === "enter") {
        this.state.searchActive = false
        this.state.inspector = true
        this.state.lastAction = `search selected ${this.fixture.get(this.state.selectedId)?.label ?? "none"}`
        return
      }
      if (!key.ctrl && !key.meta && !key.option) {
        const typed = key.name === "space" ? " " : key.sequence || key.name
        if (typed.length === 1 && typed >= " ") {
          this.state.query += typed
          this.applySearch()
        }
      }
      return
    }

    const command = key.name === "plus" || key.name === "kpplus" ? "+" : key.name === "equal" || key.name === "kpequal" ? "=" : key.name || key.sequence
    switch (command) {
      case "1":
      case "2":
      case "3":
        this.state.mode = Number(key.name) as VisualMode
        this.state.lastAction = `visual mode ${this.state.mode}: ${modeName(this.state.mode)}`
        return
      case "q":
        this.state.lastAction = "clean exit requested"
        this.shutdown()
        return
      case "escape":
        this.state.query = ""
        this.state.searchActive = false
        this.state.lastAction = "selection mode"
        return
      case "j":
      case "down":
        this.moveSelection(1)
        return
      case "k":
      case "up":
        this.moveSelection(-1)
        return
      case "h":
      case "left":
        if (key.name === "left") this.moveSelection(-1)
        else this.pan(-7, 0)
        return
      case "l":
      case "right":
        if (key.name === "right") this.moveSelection(1)
        else this.pan(7, 0)
        return
      case "u":
        this.pan(0, -5)
        return
      case "d":
        this.pan(0, 5)
        return
      case "+":
      case "=":
        this.zoomAt(1.1)
        return
      case "-":
        this.zoomAt(0.9)
        return
      case "/":
        this.state.searchActive = true
        this.state.query = ""
        this.state.lastAction = "type-to-find active"
        return
      case "f":
        this.state.focusOnly = !this.state.focusOnly
        this.state.lastAction = `portable lens ${this.state.focusOnly ? "focused" : "full topology"}`
        return
      case "v":
        this.toggleRepositoryTopology()
        return
      case "return":
      case "enter":
        this.state.inspector = true
        this.state.lastAction = `focused ${this.fixture.get(this.state.selectedId)?.label ?? "node"}`
        return
      case "i":
        this.state.inspector = !this.state.inspector
        this.state.lastAction = `inspector ${this.state.inspector ? "shown" : "hidden"}`
        return
      case "t":
        this.state.diagnostics = !this.state.diagnostics
        this.state.lastAction = `diagnostics ${this.state.diagnostics ? "shown" : "hidden"}`
        return
      case "r":
        this.state.panX = 0
        this.state.panY = 0
        this.state.zoom = 1
        this.state.lastAction = "viewport reset"
        return
      case "s":
        this.smokeSuspendResume()
        return
      default:
        break
    }

    if (!key.ctrl && !key.meta && !key.option) {
      const typed = key.sequence || key.name
      if (typed.length === 1 && typed >= " " && typed !== "1" && typed !== "2" && typed !== "3") {
        this.state.searchActive = true
        this.state.query = typed
        this.applySearch()
        this.state.lastAction = `find: ${typed}`
      }
    }
  }

  private moveSelection(direction: number): void {
    const nodes = this.visibleNodes()
    const index = Math.max(0, nodes.findIndex((node) => node.id === this.state.selectedId))
    const next = (index + direction + nodes.length) % nodes.length
    this.state.selectedId = nodes[next]?.id ?? this.state.selectedId
    this.state.inspector = true
    this.state.lastAction = `selected ${this.fixture.get(this.state.selectedId)?.label ?? "node"}`
  }

  private pan(deltaX: number, deltaY: number): void {
    this.state.panX = clamp(this.state.panX + deltaX / this.state.zoom, -35, 35)
    this.state.panY = clamp(this.state.panY + deltaY / this.state.zoom, -16, 16)
    this.state.lastAction = `pan ${this.state.panX.toFixed(0)},${this.state.panY.toFixed(0)}`
  }

  private applySearch(): void {
    const query = this.state.query.trim().toLowerCase()
    if (!query) return
    const searchableNodes = [...this.fixture.nodes, ...this.fixture.infrastructure]
    const found = searchableNodes.find((node) => {
      const repositoryIds = sessionRepositoryIds(node)
      const repositories = repositoryIds.flatMap((repositoryId) => [repositoryId, this.fixture.get(repositoryId)?.label ?? repositoryId])
      const worktree = node.worktreeId ? [node.worktreeId, this.fixture.get(node.worktreeId)?.label ?? node.worktreeId] : []
      const searchText = [node.label, node.kind, node.description, node.id, ...repositories, ...worktree, node.branch, node.runtime, node.host, node.contextSize, node.changeMode].filter(Boolean).join(" ")
      return searchText.toLowerCase().includes(query)
    })
    if (found) {
      this.state.selectedId = found.id
      if (!isPrimaryNode(found)) this.state.repositoryTopology = true
      this.state.inspector = true
      this.state.lastAction = `find matched ${found.label}`
    } else {
      this.state.lastAction = `find: no match for ${this.state.query}`
    }
  }

  private handleMouse(event: MouseEvent): void {
    if (event.type === "down") {
      this.handleMouseDown(event)
      return
    }
    if (event.type === "drag-end" || event.type === "up") {
      this.handleMouseDragEnd(event)
      return
    }
    if (event.type === "move") this.handleMouseMove(event)
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== MouseButton.LEFT) return
    if (!this.currentMapRect || !this.inRect({ x: event.x, y: event.y }, this.currentMapRect)) return
    event.preventDefault()
    this.dragState = { lastX: event.x, lastY: event.y }
    const target = this.nearestHit(event.x, event.y)
    if (!target) return
    this.state.selectedId = target.id
    this.state.inspector = true
    this.state.searchActive = false
    this.state.query = ""
    this.state.lastAction = `mouse selected ${this.fixture.get(target.id)?.label ?? target.id}`
  }

  private handleMouseDrag(event: MouseEvent): void {
    if (!this.dragState || !this.currentMapRect) return
    const deltaX = event.x - this.dragState.lastX
    const deltaY = event.y - this.dragState.lastY
    if (deltaX === 0 && deltaY === 0) return
    this.state.panX = clamp(this.state.panX - (deltaX * 100) / Math.max(1, this.currentMapRect.width), -35, 35)
    this.state.panY = clamp(this.state.panY - (deltaY * 40) / Math.max(1, this.currentMapRect.height), -16, 16)
    this.dragState.lastX = event.x
    this.dragState.lastY = event.y
    this.state.lastAction = `mouse pan ${this.state.panX.toFixed(0)},${this.state.panY.toFixed(0)}`
    this.renderer.requestRender()
  }

  private handleMouseDragEnd(_event: MouseEvent): void {
    if (!this.dragState) return
    this.dragState = null
    this.state.lastAction = "mouse pan complete"
  }

  private handleMouseScroll(event: MouseEvent): void {
    if (!this.currentMapRect || !this.inRect({ x: event.x, y: event.y }, this.currentMapRect)) return
    const direction = event.scroll?.direction ?? (event.button === MouseButton.WHEEL_UP ? "up" : event.button === MouseButton.WHEEL_DOWN ? "down" : undefined)
    if (direction === "up") this.zoomAt(1.1, event.x, event.y, "mouse wheel")
    if (direction === "down") this.zoomAt(0.9, event.x, event.y, "mouse wheel")
  }

  private handleMouseMove(event: MouseEvent): void {
    const target = this.nearestHit(event.x, event.y)
    this.state.hoveredId = target?.id ?? null
  }

  private nearestHit(x: number, y: number): HitTarget | undefined {
    let best: HitTarget | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const target of this.hitTargets) {
      const dx = (x - target.x) / target.radiusX
      const dy = (y - target.y) / target.radiusY
      const distance = dx * dx + dy * dy
      if (distance <= 1.5 && distance < bestDistance) {
        best = target
        bestDistance = distance
      }
    }
    return best
  }

  private zoomAt(factor: number, anchorX?: number, anchorY?: number, source = "zoom"): void {
    const map = this.currentMapRect
    const previousZoom = this.state.zoom
    const nextZoom = clamp(previousZoom * factor, 0.65, 1.4)
    if (map) {
      const x = anchorX ?? map.x + map.width / 2
      const y = anchorY ?? map.y + map.height / 2
      const screenX = ((x - map.x) / Math.max(1, map.width)) * 100
      const screenY = ((y - map.y) / Math.max(1, map.height)) * 40
      const logicalX = 50 + (screenX + this.state.panX - 50) / previousZoom
      const logicalY = 20 + (screenY + this.state.panY - 20) / previousZoom
      this.state.zoom = nextZoom
      this.state.panX = clamp(50 + (logicalX - 50) * nextZoom - screenX, -35, 35)
      this.state.panY = clamp(20 + (logicalY - 20) * nextZoom - screenY, -16, 16)
    } else {
      this.state.zoom = nextZoom
    }
    this.state.lastAction = `${source} ${(this.state.zoom * 100).toFixed(0)}%`
    this.renderer.requestRender()
  }

  private smokeSuspendResume(): void {
    if (this.state.suspended || this.renderer.isDestroyed) return
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

  private panel(buffer: OptimizedBuffer, rect: Rect, background: RGBA, border: RGBA): void {
    if (rect.width <= 0 || rect.height <= 0) return
    buffer.fillRect(rect.x, rect.y, rect.width, rect.height, background)
    if (rect.width >= 2) {
      this.hline(buffer, rect.x, rect.y, rect.width, "─", border, background)
      this.hline(buffer, rect.x, rect.y + rect.height - 1, rect.width, "─", border, background)
    }
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 1) {
      this.cell(buffer, rect.x, y, "│", border, background)
      if (rect.width >= 2) this.cell(buffer, rect.x + rect.width - 1, y, "│", border, background)
    }
    this.cell(buffer, rect.x, rect.y, "┌", border, background)
    this.cell(buffer, rect.x + rect.width - 1, rect.y, "┐", border, background)
    this.cell(buffer, rect.x, rect.y + rect.height - 1, "└", border, background)
    this.cell(buffer, rect.x + rect.width - 1, rect.y + rect.height - 1, "┘", border, background)
  }

  private roundedPanel(buffer: OptimizedBuffer, rect: Rect, background: RGBA, border: RGBA): void {
    buffer.fillRect(rect.x, rect.y, rect.width, rect.height, background)
    if (rect.width < 2 || rect.height < 2) return
    this.hline(buffer, rect.x + 1, rect.y, rect.width - 2, "─", border, background)
    this.hline(buffer, rect.x + 1, rect.y + rect.height - 1, rect.width - 2, "─", border, background)
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 1) {
      this.cell(buffer, rect.x, y, "│", border, background)
      this.cell(buffer, rect.x + rect.width - 1, y, "│", border, background)
    }
    this.cell(buffer, rect.x, rect.y, "╭", border, background)
    this.cell(buffer, rect.x + rect.width - 1, rect.y, "╮", border, background)
    this.cell(buffer, rect.x, rect.y + rect.height - 1, "╰", border, background)
    this.cell(buffer, rect.x + rect.width - 1, rect.y + rect.height - 1, "╯", border, background)
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
      if (x0 >= rect.x && x0 < rect.x + rect.width && y0 >= rect.y && y0 < rect.y + rect.height) this.cell(buffer, x0, y0, glyph, foreground, background)
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
    const start = Math.max(0, right - value.length)
    this.text(buffer, value, start, y, foreground, background, attributes)
  }

  private mixWithBackground(foreground: RGBA, amount: number): RGBA {
    const mix = (a: number, b: number): number => b + (a - b) * amount
    return RGBA.fromValues(
      mix(foreground.r, COLORS.bgMap.r),
      mix(foreground.g, COLORS.bgMap.g),
      mix(foreground.b, COLORS.bgMap.b),
      foreground.a,
    )
  }
}

let app: UniverseApp | undefined

const renderer = await createCliRenderer({
  targetFps: 30,
  maxFps: 60,
  gatherStats: true,
  maxStatSamples: 180,
  useMouse: true,
  enableMouseMovement: true,
  autoFocus: false,
  exitOnCtrlC: true,
  clearOnShutdown: true,
  onDestroy: () => app?.disposeTimers(),
})

app = new UniverseApp(renderer)
app.start()
