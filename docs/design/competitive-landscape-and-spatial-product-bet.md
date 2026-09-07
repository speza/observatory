# Competitive landscape and the spatial product bet

Status: product research snapshot

Last verified: 2026-09-07

Related design:

- [Goal-centred agent orchestration map](agent-orchestration-map.md)
- [Observatory technical architecture](technical-architecture.md)
- [Observatory feature roadmap](../specs/observatory-feature-roadmap.md)

## Purpose

This document records the competitive landscape around agent session managers,
orchestrators and observability products, and evaluates Observatory's central
product hypothesis:

> Can a stable System -> Goal -> Agent spatial universe materially outperform cards,
> kanban and flat session lists for supervising a large body of concurrent and
> long-lived agent work?

The market is moving quickly. Product and installation details below were
checked against linked first-party sources on the verification date and should
be reverified before making packaging, licensing or partnership decisions.
Descriptions of product capabilities are observations; sections explicitly
labelled **Observatory assessment** contain our interpretation and strategy.
Product names identify their respective projects and do not imply affiliation
or endorsement.

## Conclusion

The category is already crowded at the execution layer. Most products either:

1. own agent launch, PTYs, session persistence and worktrees themselves; or
2. package a management interface over tmux.

Conductor OSS, Superset, Orca and bb own PTY, session or provider-process and
worktree capabilities that overlap materially with capabilities Observatory
currently obtains through Herdr. They do not depend on an external
general-purpose agent session host for their primary product path.

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

These products own substantial execution and workspace lifecycle capability as
part of their application. Descriptions of each organising model are based on
first-party documentation, not necessarily an explicit vendor term.

| Product                                                                           | Verified product shape                                                                                                                                                                                                                                                                                                                                                   | Distribution and licence                                                                                                                                                                                | Observatory assessment                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Conductor OSS](https://github.com/charannyk06/conductor-oss/blob/main/README.md) | Local-first browser dashboard organised around workspaces and sessions. Its backend owns PTYs, coding-agent launch, Git worktrees and SQLite state; the UI adds terminal, diff, preview, feedback and task-board surfaces.                                                                                                                                               | `npx`/npm launcher with native backends for macOS, Linux x64 and Windows x64; paired-device browser access; Apache-2.0.                                                                                 | Demonstrates that a local browser control surface can package execution and review while remaining session/workspace-centred.                             |
| [Superset](https://github.com/superset-sh/superset/blob/main/README.md)           | Agentic IDE organised around isolated repository workspaces, with persistent terminals, worktrees, agent status, diffs, previews, automations, CLI/SDK/MCP control and remote hosts.                                                                                                                                                                                     | Current README promotes a macOS desktop download and phone access through its remote surface; [Elastic License 2.0](https://github.com/superset-sh/superset/blob/main/LICENSE.md).                      | A vertically integrated execution product whose convenience may reduce demand for a separate supervisory layer.                                           |
| [Orca](https://github.com/stablyai/orca/blob/main/README.md)                      | AI orchestrator/ADE organised around repository worktrees, terminal agents and orchestration runs. It owns persistent terminals, worktrees, agent launch, review and SSH execution; its [orchestration model](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/orchestration.mdx) adds task DAGs, dispatches, workers, messages and decision gates. | Desktop builds for macOS, Windows and Linux plus documented iOS and Android companions; MIT.                                                                                                            | A close full-stack comparator because it combines execution ownership with structured task orchestration.                                                 |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst/blob/main/README.md)           | Visual workspace spanning files/documents, agent sessions, worktrees and tasks. It provides session Kanban, search/resume, task tracking, visual diff approval and [related-session workstreams](https://github.com/Nimbalyst/nimbalyst/blob/main/docs/SESSION_HIERARCHY.md).                                                                                            | Desktop downloads for macOS, Windows and Linux plus a documented iOS companion; desktop/iOS repository is MIT, with sync hosted separately.                                                             | A close semantic comparator through tasks, workstreams and human review, although no distinct human-confirmed completion state was verified.              |
| [Xum, formerly Mux](https://github.com/coder/xum/blob/main/README.md)             | Coding-agent multiplexer organised around isolated workspaces and conversations. It uses a custom agent loop with local-directory, Git-worktree and SSH runtimes, plus review, Git divergence, cost and context-management surfaces.                                                                                                                                     | Prebuilt macOS and Linux desktop binaries; responsive server-mode web UI for mobile; AGPL-3.0-only.                                                                                                     | Strong execution-product comparator, but its organising model remains workspace/conversation-centred.                                                     |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban/blob/main/README.md)         | Local application organised around Kanban issues and execution workspaces, with per-workspace branches, terminals, dev servers, diff comments, previews and PR/merge flows.                                                                                                                                                                                              | `npx vibe-kanban`; Apache-2.0. Bloop [shut down on 2026-04-10](https://www.vibekanban.com/blog/shutdown), and hosted services were withdrawn; the local OSS project was left for community maintenance. | A clear task-to-agent planning and review baseline, but no longer a commercially supported hosted product.                                                |
| [Luvus](https://github.com/RizRiyz/luvus/blob/main/README.md)                     | Terminal-native mission control organised around persistent project workspaces, tabs, panes and agent sessions. Its own server owns PTYs and supports agent detection, resume/fork/message/wait, worktrees and dependency-aware task coordination.                                                                                                                       | Terminal application distributed for macOS, Linux and Windows through installers, packages and Cargo; Apache-2.0.                                                                                       | Shows how much of the multi-agent workflow can be packaged in a terminal-native execution product.                                                        |
| [Warp and Oz](https://github.com/warpdotdev/warp/blob/main/README.md)             | Warp is an agentic development environment with a locally installed terminal client and local or hosted agents. Drive sync, hosted-model agents, team services and Oz cloud orchestration retain proprietary backend dependencies.                                                                                                                                       | Desktop application for macOS, Linux and Windows; most client code AGPLv3, `warpui` crates MIT, server/Drive/Oz proprietary.                                                                            | Represents the enterprise and cloud end of the category rather than Observatory’s local control-plane boundary.                                           |
| [bb](https://github.com/get-bb/bb/blob/main/README.md)                            | Local-first agentic IDE organised around projects and threads. A SQLite server coordinates host daemons that provision environments and run provider processes. Desktop, web, CLI and API surfaces support steering, delegation and automation; Tasks and Workflows add optional higher-level organisation.                                                              | `npx bb-app`, macOS arm64 desktop, alpha Linux x64 AppImage, Windows through WSL2 and early-access iOS; MIT.                                                                                            | Strong execution-layer competitor. Its core remains project/thread-centred, and its 2D interaction is pane tiling rather than durable semantic geography. |

### Tmux-based session managers

These products are closer to Herdr itself. They package installation and UX
around tmux rather than owning a native PTY/session runtime end to end.

| Product                                                                       | Verified capabilities                                                                                                                                                                  | Observatory assessment                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Agent Deck](https://github.com/asheshgoplani/agent-deck/blob/main/README.md) | Grouped tmux sessions, running/waiting/done state, search, attach, worktrees, conversation forks, cost tracking, Git features, web control and optional messaging-channel supervision. | A broad mission-control layer over terminal sessions.                                                   |
| [Claude Squad](https://github.com/smtg-ai/claude-squad/blob/main/README.md)   | Tmux sessions and Git worktrees with create, attach, pause/resume, delete, diff preview and review before checkout or push.                                                            | A deliberately small terminal application over tmux and Git worktrees.                                  |
| [dmux](https://github.com/standardagents/dmux/blob/main/README.md)            | Agent launch, per-pane Git worktrees, durable terminals, conversation resume, file/diff browsing, merge/PR workflow, lifecycle hooks and macOS attention notifications.                | Packages most of the parallel-agent terminal workflow around tmux.                                      |
| [fleet](https://github.com/brizzai/fleet/blob/master/README.md)               | Tmux sessions with Claude Code, Codex and OpenCode hook-derived state, pane fallback heuristics, attention jumping, PR state, worktrees, resume and forking.                           | Relevant to `SessionHost` because it derives richer provider state while retaining tmux as the runtime. |

### Substrates rather than supervisory products

[AgentAPI](https://github.com/coder/agentapi/blob/main/README.md) wraps one
coding-agent conversation in a common HTTP API by driving its terminal and
parsing output. It exposes messages, coarse running/stable status, events,
terminal attachment and a basic chat page. Observatory classifies it as
infrastructure: it is more likely to inform a future `SessionHost` adapter than
to compete with Observatory's product surface.

### Adjacent observability products

[agenttrail](https://github.com/sodiumsun/agenttrail/blob/main/README.md) is a
local, read-only spatial dashboard organised around repository components and
files. It combines a durable `PLAN.md`, filesystem activity and optional
repository-local Claude Code hooks to show runs, tools, todos and provenance.
It switches between per-repository daemons but does not own or attach to agent
execution. Observatory considers its codebase-centred map a useful UX
comparator for the spatial hypothesis, but not a substitute for a cross-repository
System -> Goal -> Agent control plane.

## Installation and packaging

Not all of these tools are packaged as conventional desktop applications.

| Product       | Installation shape                                                                                       | Conventional desktop app?                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Superset      | Current first-party README promotes a macOS desktop download                                             | Yes, on the currently documented platform                                   |
| Orca          | macOS, Windows and Linux desktop builds; native iOS and Android companions                               | Yes                                                                         |
| Nimbalyst     | macOS, Windows and Linux desktop builds; documented iOS companion                                        | Yes                                                                         |
| Xum           | Prebuilt macOS and Linux desktop binaries; responsive server-mode web UI                                 | Yes, on the currently documented platforms                                  |
| Warp          | macOS, Linux and Windows desktop application                                                             | Yes                                                                         |
| bb            | macOS arm64 desktop; alpha Linux x64 AppImage; npm/browser path; Windows through WSL2; early-access iOS  | Yes, with platform-specific maturity                                        |
| Conductor OSS | npm/npx launcher starts its local dashboard and native backend                                           | Installable product, but browser-hosted rather than a normal desktop bundle |
| Vibe Kanban   | `npx vibe-kanban` starts the community-maintained local web application                                  | Local web application, not a conventional desktop package                   |
| Luvus         | Install scripts, Homebrew, packages, release binaries or Cargo; terminal application for major platforms | No; packaged terminal application                                           |
| Agent Deck    | Install script, Homebrew or Go binary; TUI plus optional local web UI                                    | No; packaged terminal application                                           |
| Claude Squad  | Homebrew or installed Go binary; requires tmux                                                           | No; packaged terminal application                                           |
| dmux          | Global npm package; requires tmux                                                                        | No; packaged terminal application                                           |
| fleet         | Homebrew, install script, Go binary, Linux packages or Docker; requires tmux                             | No; packaged terminal application                                           |
| AgentAPI      | Downloadable macOS/Linux CLI/server binary                                                               | No; infrastructure component                                                |
| agenttrail    | `npx` starts a dependency-free Node CLI and local browser dashboard                                      | No; local web application                                                   |

This distinction matters commercially even though it does not change the core
architecture. Depending on Herdr is reasonable for proving the product, but a
future external release cannot assume users will manually assemble several
tools. Observatory will eventually need one low-friction installation story.
That could package Observatory and a compatible Herdr version together while
preserving `SessionHost` as the architectural seam; it does not require
Observatory to own the multiplexer.

## Observatory assessment

### What is already commodity

The landscape increasingly treats the following as baseline capabilities:

- launching several agent providers;
- persistent terminals and session resume;
- isolated Git worktrees;
- running, waiting, completed and needs-attention indicators;
- diffs, branches, pull requests and merge workflows;
- kanban or grouped-list overviews; and
- some form of remote or mobile monitoring in products such as Orca, Nimbalyst,
  Superset, Conductor OSS, Xum, bb and Agent Deck, although their native-app,
  responsive-web, paired-browser and messaging-channel approaches differ.

Observatory should not position terminal persistence or a needs-attention list
as its central differentiation.

### Closest comparators

**Orca is a close full-stack comparator.** It owns the execution environment
and includes structured task orchestration, agent-to-agent messages and
coordinator workflows.

**Nimbalyst is a close product-model comparator.** Workstreams, session phases,
human review and mobile supervision overlap with parts of Observatory's
semantic and human-in-the-loop case. No distinct human-confirmed completion
state was verified in its first-party documentation.

**Superset and Xum are strong execution-product comparators.** They can make the
integrated worktree IDE sufficiently convenient that some users never seek a
separate supervisory layer.

**bb is a strong execution-layer comparator.** It combines broad provider
support, worktrees, timelines, terminals, remote hosts and first-class desktop,
web, CLI and API control. Optional Tasks and Workflows plugins move upward into
task semantics and multi-agent orchestration. Its core model remains
project/thread-centred, and its 2D split-pane workspace is not a persistent
semantic geography. Its extensibility nevertheless means users could add a map
surface faster than competitors with closed interfaces.

**Agenttrail is the closest spatial observability comparator.** It demonstrates
an alternative durable geography based on repository components and overlays
live agent activity without owning the runtime. Observatory must prove that a
System -> Goal -> Agent world supports cross-repository supervision better than
this codebase-centred model.

**The tmux cohort validates the Herdr layer.** Agent Deck, Claude Squad, dmux
and fleet repeatedly rebuild the same session-management capability. This is
evidence that Herdr supplies a real and valuable layer, not evidence that
Observatory should reproduce it.

### Remaining opening

No reviewed product's first-party documentation was found to make a durable,
host-independent, cross-repository System -> Goal -> Agent universe its primary
model. Most make a repository, worktree, task card, terminal or runtime task
graph the primary organising object.

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
2. Watch Orca and Nimbalyst for movement into task semantics, human review and
   cross-session context. Watch bb's Tasks and Workflows plugins for movement
   from optional project/thread organisation into durable outcome semantics.
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
- [Superset](https://github.com/superset-sh/superset)
- [Orca](https://github.com/stablyai/orca)
- [Nimbalyst](https://github.com/Nimbalyst/nimbalyst)
- [Xum](https://github.com/coder/xum)
- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)
- [Vibe Kanban shutdown announcement](https://www.vibekanban.com/blog/shutdown)
- [Luvus](https://github.com/RizRiyz/luvus)
- [Agent Deck](https://github.com/asheshgoplani/agent-deck)
- [Claude Squad](https://github.com/smtg-ai/claude-squad)
- [dmux](https://github.com/standardagents/dmux)
- [fleet](https://github.com/brizzai/fleet)
- [Warp](https://github.com/warpdotdev/warp)
- [bb](https://github.com/get-bb/bb)
- [bb site](https://getbb.app/)
- [bb changelog](https://getbb.app/changelog)
- [bb privacy policy](https://getbb.app/privacy)
- [AgentAPI](https://github.com/coder/agentapi)
- [agenttrail](https://github.com/sodiumsun/agenttrail)

Human-computer interaction sources:

- [Data Mountain: Using Spatial Memory for Document Management](https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/)
- [Supporting and Exploiting Spatial Memory in User Interfaces](https://doi.org/10.1561/1100000046)
- [The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations](https://drum.lib.umd.edu/items/155a868e-fb83-4115-9899-9187ea8c0498)
