# Competitive landscape and the spatial product bet

Status: product research snapshot

Date: 2026-08-26

Related design:

- [Goal-centred agent orchestration map](agent-orchestration-map.md)
- [Observatory technical architecture](technical-architecture.md)
- [Observatory feature roadmap](../specs/observatory-feature-roadmap.md)

## Purpose

This document records the competitive landscape around agent session managers,
orchestrators and observability products, and evaluates Observatory's central
product hypothesis:

> Can a stable Goal -> Agent spatial universe materially outperform cards,
> kanban and flat session lists for supervising a large body of concurrent and
> long-lived agent work?

The market is moving quickly. Product and installation details below are a
dated snapshot and should be reverified before making packaging or partnership
decisions.

## Conclusion

The category is already crowded at the execution layer. Most products either:

1. own agent launch, PTYs, session persistence and worktrees themselves; or
2. package a management interface over tmux.

Conductor OSS and Superset therefore contain their own equivalent of the
capability Observatory currently obtains from Herdr. They do not depend on an
external general-purpose agent session host.

Observatory should not respond by absorbing multiplexer scope. Its strongest
case remains a host-neutral semantic control plane above execution:

```text
Agent runtime or multiplexer
        |
        v
SessionHost observations
        |
        v
Goal-centred semantic universe
        |
        +--> spatial overview
        +--> attention queue
        +--> catch-up
        +--> evidence and verification inspector
        +--> terminal intervention
```

The spatial interface can plausibly beat cards as a durable mental model,
particularly for orientation and dormant-work resumption. It will not beat an
ordered queue for immediate triage or a focused evidence surface for outcome
verification. The winning product is therefore a coordinated set of lenses,
not a map-only interface.

## Competitive landscape

### Full execution environments

These products own most or all of the Herdr-equivalent layer as part of their
application.

| Product                                                       | Primary object                            | Runtime/session approach                                                                           | Product significance                                                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Conductor OSS](https://github.com/charannyk06/conductor-oss) | Workspace and project session             | Rust backend, provider executors, interactive terminal runtime, persistence and worktree lifecycle | Demonstrates that a browser-based local control surface can package its own complete runtime. Its overview remains session/workspace-centred.    |
| [Superset](https://github.com/superset-sh/superset)           | Repository workspace and branch/worktree  | Standalone PTY daemon, persistent terminal panes and provider hooks/wrappers                       | One of the closest execution-product competitors. It combines worktree management, terminals, diffs and attention-oriented boards.               |
| [Orca](https://github.com/stablyai/orca)                      | Repository worktree and agent terminal    | Own desktop runtime, persistent terminals, worktrees, remote execution and agent launch            | The strongest full-stack competitor. Its experimental orchestration layer adds task DAGs, dispatches, persistent messages and coordinator loops. |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst)           | Session, task and workstream              | Electron runtime, terminals, worktrees and persistent session metadata                             | The closest semantic competitor. It has kanban phases, related-session workstreams, agent supervision and human-confirmed completion.            |
| [Xum, formerly Coder Mux](https://github.com/coder/xum)       | Isolated workspace and agent conversation | Custom agent loop with local worktree and SSH environments                                         | A parallel-agent desktop IDE with integrated review, Git divergence, costs and context management.                                               |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)         | Kanban issue and execution workspace      | Local Rust/React service, per-task branches, terminals and dev servers                             | A direct task-to-agent product with strong planning and review. The project currently says it is sunsetting.                                     |
| [Warp and Oz](https://github.com/warpdotdev/warp)             | Cloud or local agent run                  | Warp-owned terminal and cloud execution environment                                                | The enterprise and cloud end of the category. The Warp terminal is available as an application; Oz orchestration remains proprietary.            |

### Tmux-based session managers

These products are closer to Herdr itself. They package installation and UX
around tmux rather than owning a native PTY/session runtime end to end.

| Product                                                   | Main capabilities                                                                                                        | Product significance                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agent Deck](https://github.com/asheshgoplani/agent-deck) | Groups, search, running/waiting/done state, forking, worktrees, costs and optional web control                           | A broad mission-control layer over terminal sessions.                                                                                          |
| [Claude Squad](https://github.com/smtg-ai/claude-squad)   | Parallel agents in isolated workspaces, attach and review                                                                | A deliberately simple terminal application over tmux and Git worktrees.                                                                        |
| [dmux](https://github.com/standardagents/dmux)            | Multi-agent launch, worktrees, durable terminals, conversation resumption, merge/PR workflow and attention notifications | A polished example of packaging the whole parallel-agent workflow around tmux.                                                                 |
| [fleet](https://github.com/brizzai/fleet)                 | Hook-derived agent state, attention jumping, PR state, worktrees, session resume and forking                             | Particularly relevant to Observatory's host boundary because it derives richer status from provider hooks while retaining tmux as the runtime. |

### Substrates rather than supervisory products

[AgentAPI](https://github.com/coder/agentapi) wraps supported coding agents in a
common HTTP API. It is an installable server binary with a basic chat page, not
an agent observatory. A tool like this is more likely to inform a future
`SessionHost` adapter than to compete with Observatory's product surface.

## Installation and packaging

Not all of these tools are packaged as conventional desktop applications.

| Product       | Installation shape                                                                         | Conventional desktop app?                                                   |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Superset      | Signed macOS DMG; experimental Linux AppImage; automatic updates                           | Yes                                                                         |
| Orca          | macOS DMG, Windows installer, Linux AppImage, package-manager options and mobile companion | Yes                                                                         |
| Nimbalyst     | macOS DMG, Windows installer, Linux AppImage and mobile companion                          | Yes                                                                         |
| Xum           | Prebuilt macOS and Linux desktop binaries                                                  | Yes, on currently documented platforms                                      |
| Warp          | Downloadable desktop application                                                           | Yes                                                                         |
| Conductor OSS | npm/npx launcher starts its local dashboard and bundled Rust backend                       | Installable product, but browser-hosted rather than a normal desktop bundle |
| Vibe Kanban   | `npx vibe-kanban` starts a local service and opens the browser                             | Local web application, not a conventional desktop package                   |
| Agent Deck    | Install script, Homebrew or Go binary; TUI plus optional local web UI                      | No; packaged terminal application                                           |
| Claude Squad  | Homebrew or installed Go binary; requires tmux                                             | No; packaged terminal application                                           |
| dmux          | Global npm package; requires tmux                                                          | No; packaged terminal application                                           |
| fleet         | Homebrew, install script, Go binary, Linux packages or Docker; requires tmux               | No; packaged terminal application                                           |
| AgentAPI      | Downloadable CLI/server binary                                                             | No; infrastructure component                                                |

This distinction matters commercially even though it does not change the core
architecture. Depending on Herdr is reasonable for proving the product, but a
future external release cannot assume users will manually assemble several
tools. Observatory will eventually need one low-friction installation story.
That could package Observatory and a compatible Herdr version together while
preserving `SessionHost` as the architectural seam; it does not require
Observatory to own the multiplexer.

## Competitive interpretation

### What is already commodity

The landscape increasingly treats the following as baseline capabilities:

- launching several agent providers;
- persistent terminals and session resume;
- isolated Git worktrees;
- running, waiting, completed and needs-attention indicators;
- diffs, branches, pull requests and merge workflows;
- kanban or grouped-list overviews; and
- remote or mobile monitoring in the more mature products.

Observatory should not position terminal persistence or a needs-attention list
as its central differentiation.

### Closest threats

**Orca is the closest full-stack threat.** It owns the execution environment
and is moving upward into structured task orchestration, agent-to-agent
messages and coordinator workflows.

**Nimbalyst is the closest product-model threat.** Workstreams, session phases,
human-confirmed completion and mobile supervision overlap with parts of
Observatory's semantic and human-in-the-loop case.

**Superset and Xum are strong execution-product threats.** They can make the
integrated worktree IDE sufficiently convenient that some users never seek a
separate supervisory layer.

**The tmux cohort validates the Herdr layer.** Agent Deck, Claude Squad, dmux
and fleet repeatedly rebuild the same session-management capability. This is
evidence that Herdr supplies a real and valuable layer, not evidence that
Observatory should reproduce it.

### Remaining opening

None of the reviewed products is primarily organised around a durable,
cross-repository Goal -> Agent universe that remains independent of the
session host. Most make a repository, worktree, task card, terminal or runtime
task graph the primary organising object.

The strongest Observatory position is:

> Observatory helps an operator understand why a fleet exists, what outcomes
> it is pursuing, what changed, where judgment is required, and whether
> completed execution actually satisfied those outcomes, independently of
> which runtime hosts the sessions.

That opening is real but narrowing. Task graphs and workstreams mean
"semantic control plane" is no longer sufficient as a claim by itself.
Observatory must demonstrate a better supervisory experience.

## Why spatial organisation could work

The spatial hypothesis has credible human-factors foundations.

People can learn stable object locations and use those locations as retrieval
cues. The 1998 [Data Mountain study](https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/)
found reliable advantages over a conventional favourites mechanism for
managing previously organised documents. The later review
[Supporting and Exploiting Spatial Memory in User Interfaces](https://doi.org/10.1561/1100000046)
describes how stable locations can reduce repeated visual search, and how
interfaces that continually rearrange items destroy that benefit.

Observatory has properties that suit this mechanism:

- goals can act as durable landmarks;
- goal geography can remain stable while agent execution changes;
- the operator explicitly accepts the organisation and positions;
- agents can stop, resume or be replaced without erasing the intended outcome;
- dormant work benefits from being remembered by place; and
- cross-repository work can remain conceptually together.

The map is therefore not primarily a way to fit more objects on screen. It is
an externalised, persistent mental model of the work system.

The likely benefit is longitudinal. A short first-use test will favour cards
because cards are familiar. Spatial value should emerge after the operator has
learned the geography, left the system and returned later.

## Where the universe can and cannot win

| Operator question                            | Best primary surface                         | Role of the universe                                                                               |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| What is all this work doing?                 | Universe                                     | Shows portfolio shape, ownership and neglected regions.                                            |
| How are these agents and outcomes related?   | Universe                                     | Shows meaningful proximity and typed relationships.                                                |
| Where was that dormant investigation?        | Universe                                     | Uses stable geography as a retrieval cue.                                                          |
| Which goal is accumulating risk?             | Universe with attention overlay              | Preserves surrounding context and potential downstream impact.                                     |
| What needs me immediately?                   | Ordered attention queue                      | Provides exact, keyboard-friendly priority; the universe supplies context after selection.         |
| What changed while I was away?               | Catch-up summary projected onto the universe | History explains the change; spatial highlighting explains where it occurred.                      |
| Can I trust this reported result?            | Evidence and verification inspector          | The universe distinguishes reported completion from verified completion and leads to the evidence. |
| Sort or compare everything by an exact field | List or Ledger                               | The universe is not an efficient sortable table.                                                   |

The intended interaction model is:

```text
Universe         = durable mental model
Attention queue  = inbox
Catch-up         = history and change explanation
Inspector        = judgment and verification
Terminal         = intervention
Ledger/list      = exact search, sorting and comparison
```

This follows the established information-visualisation pattern of overview,
filtering and details on demand. Shneiderman's
[task-by-data-type taxonomy](https://drum.lib.umd.edu/items/155a868e-fb83-4115-9899-9187ea8c0498)
treats overview, zoom, filter, details, relationships and history as distinct
operations rather than capabilities one view must perform equally well.

## Conditions for success

### Stable geography

Goals and accepted anchors must not move because an Agent becomes blocked,
idle or complete. Status changes emphasis, not position. Automatic force
layouts that continually optimise the screen would erase the learned world.

### Meaningful space

Position, proximity, boundaries and connections must express goal membership,
delegation, dependency or another explicit semantic relationship. Decorative
space does not reduce cognitive load.

### Recognisable landmarks

Goal regions need persistent names, silhouettes, boundaries and relative
positions. Visual distinction and stable edges matter more than ambient
animation.

### Explicit time

A current-state map cannot explain what happened. Catch-up must provide a
textual and navigable "since last visit" account, with affected regions marked
without rearranging geography.

### Immediate attention without exploration

Urgent work must be reachable through a precise ordered queue and keyboard
navigation. The operator must never need to pan around looking for a pulse.

### Evidence-backed completion

`done` is a runtime observation. `verified` is a human decision supported by
inspectable artifacts, checks, diffs or other evidence. The map can expose the
distinction but cannot replace the verification surface.

### Semantic zoom and aggregation

At larger scales, goals must collapse their healthy agents and surface counts,
exceptions and attention. A 100-Agent overview should show portfolio shape and
anomalies rather than attempt to render 100 readable cards.

### Restrained dimensionality

A planetary visual language can provide character and landmarks, but ordinary
interaction should remain spatially 2D. Free-flight cameras, perspective and
3D occlusion would consume attention without adding supervisory meaning.

### Accessibility and alternative views

Every important state requires text and keyboard access. Colour, motion and
position may reinforce meaning but cannot be its only representation. The
Ledger remains a first-class supporting lens, not an admission that the map
failed.

## Failure conditions

The spatial hypothesis should be considered unsuccessful if:

- the geography changes frequently enough that users cannot learn it;
- users praise the presentation but consistently use the Ledger to orient;
- urgent items require exploration rather than an attention jump;
- the map displays runtime activity without explaining intended outcomes;
- every runtime subtask, process or worktree becomes a durable node;
- users confuse goal, delegation and Git relationships;
- maintaining positions and assignments feels like project administration;
- catch-up is reduced to coloured animation without a reliable history;
- `done` remains more salient than missing or failed verification; or
- the map encourages more agent concurrency without improving outcomes.

## Evaluation

The comparison must use a deliberately strong card/list baseline, not Herdr's
current sidebar alone.

### Test design

Use the same deterministic world in two conditions:

1. Ledger, attention queue and inspector; and
2. universe, attention queue and inspector.

Use at least 20–40 agents across several goals, repositories and semantic
states. Introduce realistic delegation, returned results, stale observations,
blocked work, dormant work and at least one misleading runtime completion with
insufficient evidence.

Initial use tests discoverability. The decisive session occurs after the user
returns 24–72 hours later to a changed world.

### Operator tasks

Ask the operator to:

1. explain the state of each important goal;
2. identify what changed during their absence;
3. find every item requiring judgment;
4. understand which downstream work a blocker affects;
5. resume a dormant investigation;
6. identify a returned result that has not been consumed; and
7. decide which reported completions are actually ready to accept or integrate.

### Measures

Record:

- time to a correct answer;
- missed attention items and incorrect conclusions;
- Agents opened unnecessarily;
- navigation and context-switch count;
- resumption time for dormant work;
- confidence and whether it matches correctness; and
- whether the operator chooses the universe or Ledger without prompting.

The spatial product wins only if it improves task performance and trust
calibration. Preference, delight and visual novelty are supporting evidence,
not proof.

## Product judgment

The current qualitative judgment is:

- roughly 70% confidence that a universe plus attention queue, catch-up and
  evidence inspector can outperform kanban for a practiced operator supervising
  15–50 persistent agents; and
- below 20% confidence that a map-only product would outperform a strong list.

These are decision-making estimates, not measured results.

The experiment is worth funding because agent supervision has the persistence,
relationships and repeated return behaviour that spatial memory can exploit.
The defensible product is not the star-map rendering. It is the combination of
durable semantic geography, historical catch-up, explainable attention and
human verification.

Competitors can add a map visualisation. Reproducing a coherent operational
world that users learn and trust requires the semantic model beneath it.

## Strategic implications

1. Keep Herdr as the required V1 host behind `SessionHost`; do not rebuild its
   runtime in response to competitors that chose vertical integration.
2. Treat Orca and Nimbalyst as the primary products to watch, especially their
   movement into task semantics, human verification and cross-session context.
3. Treat the Ledger as the experimental control and permanent precision lens,
   not as the primary Observatory hypothesis.
4. Prioritise catch-up, rich attention and verification because the spatial
   surface cannot prove value without them.
5. Run a longitudinal Atlas-versus-Ledger comparison before adding more visual
   decoration or relationship types.
6. Separate architecture from distribution: Observatory can remain
   host-neutral while eventually shipping a cohesive installer containing
   compatible components.

## Primary sources

Competitive product sources:

- [Conductor OSS](https://github.com/charannyk06/conductor-oss)
- [Superset installation](https://github.com/superset-sh/superset/blob/main/apps/docs/content/docs/install.mdx)
- [Orca](https://github.com/stablyai/orca)
- [Nimbalyst](https://github.com/Nimbalyst/nimbalyst)
- [Xum](https://github.com/coder/xum)
- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)
- [Agent Deck](https://github.com/asheshgoplani/agent-deck)
- [Claude Squad](https://github.com/smtg-ai/claude-squad)
- [dmux](https://github.com/standardagents/dmux)
- [fleet](https://github.com/brizzai/fleet)
- [Warp](https://github.com/warpdotdev/warp)
- [AgentAPI](https://github.com/coder/agentapi)

Human-computer interaction sources:

- [Data Mountain: Using Spatial Memory for Document Management](https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/)
- [Supporting and Exploiting Spatial Memory in User Interfaces](https://doi.org/10.1561/1100000046)
- [The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations](https://drum.lib.umd.edu/items/155a868e-fb83-4115-9899-9187ea8c0498)
