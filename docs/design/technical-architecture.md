# Observatory technical architecture

Status: implemented V1 control plane and web-only local product
Updated: 2026-08-27
Depends on: [Goal-centred agent orchestration map](agent-orchestration-map.md)

Technology choices: [Observatory technology decisions](technology-decisions.md)

Extension boundary: [Observatory plugin architecture](plugin-architecture.md)

Continuity and recovery: [Provider-session continuity and execution recovery](../specs/provider-session-continuity-and-recovery.md)

Future distributed execution study:
[Distributed execution and host aggregation](distributed-execution-and-host-aggregation.md)

Feature ownership and delivery: [Observatory feature roadmap](../specs/observatory-feature-roadmap.md)

## Purpose

This document defines the technical shape of Observatory: a local semantic
control plane with one maintained React GUI over agents hosted by other tools.

The architecture serves one operator loop: understand what the concurrent work
is doing, catch up on what changed, identify the result that matters, find where
human judgment is needed, and decide whether reported completion is trustworthy.
Every module should contribute evidence to that loop or stay out of the trusted
model. AO is therefore responsible for durable intent, accountability,
attention, relationships and verification context; agent runtimes remain
responsible for their own internal planning and task execution graphs.

The implementation language and toolchain are selected separately in the
technology decision record. Disposable and retired renderer experiments remain
historical evidence; live web-product evidence drives current layout decisions.

The staged native-terminal experiments are specified in
[Native terminal surface POCs](../specs/terminal-surface-pocs.md). They test
terminal fidelity and Herdr transport separately from the semantic control
plane and do not change the implemented V0 boundary by themselves.

The 2026-08-22 evidence pass found that Herdr could stream a live Agent while
retaining process ownership after release. That host-owned capability remains
implemented behind `SessionHost` and now terminates in xterm.js through the
loopback gateway. The retired OpenTUI experiment proved the seam but is no
longer a maintained client or dependency. This does not add transcript
ingestion or justify an Observatory-owned daemon.

The terminal interaction and scroll-ownership decision is recorded in
[Embedded terminal interaction](terminal-interaction.md). That document explains
why host-owned scrolling is distinct from sending PageUp or mouse input to an
agent and defines the boundary future agent hosts must implement.
The [agent and linked execution model](../specs/agent-execution-model.md) and
[contextual linked execution surface](../specs/contextual-companion-surfaces.md)
decision extend the same boundary to transient shells and sibling-agent
surfaces beside the selected Agent. The local web client now adds a bounded,
read-only working-tree diff review through the separate workspace capability;
interactive diff tooling remains outside the `SessionHost` interface, and a
linked shell or Herdr itself handles provider-specific review workflows.

## Client decision

Observatory has one maintained application client: the local web GUI. It owns
the Mineral Atlas, Ledger, attention, review and hosted-terminal experiences.
The OpenTUI client was retired on 2026-08-27 after proving the architecture but
before client parity became a permanent product tax. Herdr remains the native
terminal fallback. A future CLI may expose launch, status and structured
commands, but must not become another interactive renderer.

## Architectural objective

AO must make many heterogeneous agents understandable as durable,
goal-centred work without becoming coupled to a particular agent provider,
terminal multiplexer or renderer.

The architecture must support:

- vanilla Claude Code, Codex, OpenCode and Pi agents;
- optional skills and hooks for richer semantic reporting;
- goals spanning repositories, worktrees and providers;
- human and agent mutation through the same interface;
- completed disposable rendering experiments followed by a live Herdr walking
  slice;
- a rich browser terminal without making terminal rendering part of the domain;
- future tmux and other agent-host adapters; and
- a possible AO-native multiplexer without requiring one for v1.

Every optional capability is composed as a plugin at the control-plane edge.
The Universe remains the trusted kernel; plugins translate hosts and external
systems into typed observations, proposals and capabilities without writing
SQLite or bypassing Universe commands. The proposed plugin boundary is defined
separately in [Plugin architecture](plugin-architecture.md).

## System shape

```text
                        Human / external agent
                                 │
                Browser GUI / narrow command API
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│                     AO control plane                            │
│                                                                 │
│  Universe model ─ Attention ─ Proposals ─ Search ─ Projections  │
│         │              │           │          │                 │
│         └──────────── persistent local state ──┘                 │
└───────────────┬───────────────────┬──────────────────┬───────────┘
                │                   │                  │
        agent-host seam    agent-harness seam     Git seam
                │                   │                  │
         ┌──────┴──────┐      ┌─────┴──────┐      repository /
         │             │      │            │      worktree state
       Herdr          tmux   Claude       Codex
       first          later  OpenCode     Pi
                │
          hosted terminals

Control-plane projections
         ├── local web Atlas / Ledger GUI
         ├── attention/review/inspector supporting lenses
         ├── deterministic test fixtures
         └── future structured CLI consumers
```

The control plane is the only module allowed to author trusted AO state.
Adapters report observations and execute host-specific operations. Renderers
query projections and submit commands; they do not read the store directly.

Runtime orchestration is deliberately outside this model. A provider or agent
runtime may decompose a goal, spawn workers, retry steps and route tools through
its own execution graph. AO may receive summaries, proposals and evidence from
that graph, but it does not make the graph its durable topology. Only work that
has independent ownership, lifecycle, result or human-attention value should
become a first-class Observatory relationship or Agent.

## Module design

### Universe module

The Universe module owns goals, tracked agents, typed relationships,
lifecycle, priority, acceptance and archive state.

Its interface is command/query oriented:

```text
execute(command, actor, idempotency_key) -> CommandResult
query(query, viewer)                     -> Projection
subscribe(cursor, filter)                -> EventStream
```

The small interface hides validation, persistence, concurrency, provenance and
projection maintenance. CLI commands, agents and renderers use the same
interface.

Key invariants:

- A System is the largest durable organisational object and groups Goals.
- A Goal belongs to at most one System; an Agent's System is derived through
  its primary Goal.
- V1 has no durable organisational object between a goal and its agents.
- A tracked worker agent has at most one primary goal.
- An Agent may reference other goals without owning work within them.
- Repositories and worktrees may contribute to multiple goals over time.
- Observed execution-container, repository and worktree matches are evidence for
  related-agent candidates, never accepted assignment by themselves.
- Goal priority is human-authored unless an explicit auto policy allows an
  agent mutation.
- Archive is non-destructive and never deletes history; the V0 restore command
  remains deferred until a history lens exists.
- Unknown facts remain unknown; adapters cannot silently convert inference into
  accepted structure.

Systems solve portfolio-scale separation without changing direct Goal → Agent
accountability. Delegation and dependency relationships provide structure
inside a Goal without another container. If real usage shows that crowded goals
need an independently named, prioritised and completed intermediate object,
revisit nested goals or workstreams as a new model decision.

### Agent-host module

The Agent-host module hides how terminal agents are discovered, persisted,
launched, inspected and attached. Herdr and tmux are adapters at this seam; a
future AO-native multiplexer would be another adapter.

#### Host abstraction policy

Herdr is the required live host for V0/V1. This keeps the first product slice
focused and lets Herdr own process lifetime, PTY transport and current
execution restoration. Provider sessions own conversation continuity. It does
not make Herdr a dependency of the semantic control plane or the durable Agent
identity.

`SessionHost` is the sole external-host seam. Only the Herdr adapter and the
composition root may know Herdr protocol payloads, CLI commands or native
identifiers. Universe, persistence, attention, spatial layout, projections and
renderers consume generic snapshots, access capabilities and terminal events.
They must not import Herdr modules or encode Herdr workspace, tab or pane
concepts. The renderer may receive the generic `SessionHost` port for explicit
attach and terminal actions, but never a concrete adapter or host payload.

The seam is intentionally deep rather than a collection of pass-through
wrappers: an adapter translates discovery, lifecycle, attachment, terminal
transport, errors and version/feature detection into the small generic
capabilities. Unsupported operations are explicit. We add a capability only
when a real host or user workflow proves it is needed; we do not pre-design a
universal agent or terminal API.

Host operations are represented as typed Effect values. `SessionHost` failures
use a small `HostError` contract, while semantic unsupported results remain
explicit data. Embedded terminal output is an Effect Stream so the renderer can
interrupt consumption and release host-owned resources without inventing a
second cancellation protocol. Effect stops at the host/runtime edge: the
Universe, persistence records and projections remain ordinary TypeScript data
and deterministic functions.

Host observations may include an optional opaque execution-container reference.
The adapter owns its meaning and identity; core modules may compare exact
references as provenance-bearing evidence but do not expose the host's
workspace, tab or pane concepts as domain objects.

Herdr may additionally contribute optional agent-aware evidence and
host-assisted restoration through this seam. That is a deliberate advantage
over a lowest-common-denominator multiplexer, not permission for Herdr to own
Claude Code, Codex, Pi or another harness's launch and resume policy. Harness
plugins construct provider-specific start/resume plans and judge native
conversation continuity; `SessionHost` executes plans and reports the strongest
bounded evidence the selected host can prove. The detailed contract and phased
migration are defined in
[Agent harness plugins](../specs/agent-harness-plugins.md).

The replacement test is architectural, not aspirational: selecting a future
tmux adapter, Superlogical-style host or AO-owned multiplexer at composition
time must leave Universe, persistence, projections and renderers unchanged.
If it does not, the host seam is leaking and must be repaired before the new
host is developed further. The mock host supplies deterministic contract
coverage; every production adapter also needs sanitised fixtures and a live
smoke path where available.

The implemented V0/V1 host interface remains smaller than the underlying host
interfaces and contains no provider-specific launch members:

```text
snapshot()                                      -> Effect<HostSnapshot, HostError>
launchExecution(HostExecutionLaunchRequest)     -> Effect<HostLaunchResult, HostError>
access({ hostKind, nativeId })                  -> Effect<AgentAccess, HostError>
activate(AgentAccess)                           -> Effect<HostActionResult, HostError>
openTerminal(AgentAccess, TerminalDimensions, TerminalOpenOptions?)
                                                -> Effect<HostTerminalOpenResult, HostError>
openLinkedExecutionTerminal(LinkedExecution,
                             TerminalDimensions, TerminalOpenOptions?)
                                                -> Effect<HostTerminalOpenResult, HostError>
```

V0 obtains fresh snapshots on a composition-root polling interval, including
while embedded terminal surfaces are open so shell-to-Agent promotion remains
observable. A future host event stream may reduce polling, but it is not part
of this seam yet.
`launchExecution` runs a harness-owned structured process plan but does not
assign semantic meaning;
reconciliation must observe the resulting Agent before the coordinator assigns
it to a Goal. `access` returns the capabilities and opaque attachment targets
proven for the selected Agent.

The implemented architecture splits agent-harness lifecycle from execution hosting.
`AgentHarness` plugins own availability, structured start/resume plans and
native conversation continuity. `SessionHost` accepts a generic process plan
and owns only its execution surface. Claude Code, Codex and third-party
harnesses use the same registry and host operation. See [Agent harness
plugins](../specs/agent-harness-plugins.md).

New-session native identity remains provider-owned. A harness does not invent a
Claude, Codex or other provider identifier to make launch synchronous. Hooks,
structured provider results and native integrations contribute asynchronous,
provenance-bearing evidence through the host edge; recurring lifecycle events
may repair a missed startup observation. Provider catalogue snapshots recover
dormant sessions independently of host executions and repair missed events.
Providers without a reliable identity mechanism remain usable only through an
explicitly degraded host-bound path and cannot offer exact resume or
database-wipe recovery.

`AgentAccess` reports a small capability list per agent because the same host
may offer different operations depending on provider recognition, permissions,
whether the process is live, and terminal protocol support. V0 capabilities are
`embedded-terminal`, `native-handoff` and, where proven, `linked-terminal`
together with transient `LinkedExecution` descriptors. Targets and attachment
modes remain opaque outside the Agent-host module. Herdr supports
the proven capabilities, while another host may return an honest unsupported
result.

Do not expose Herdr workspaces, tabs and panes as universal domain concepts.
They remain adapter details referenced through opaque native identifiers.

The implemented web closeout slice adds one generic per-Agent close capability
to this existing seam. It does not make Observatory the process owner: the host
continues to decide how a recognised Agent execution is closed. A closeout
coordinator obtains fresh access, asks the adapter to close the opaque target,
reconciles the resulting host snapshot and only then submits `ArchiveAgent` to
the Universe. The Herdr adapter may translate this to a pane-close operation,
but that command and pane identity remain private to the adapter. See
[Agent closeout and host lifecycle](../specs/agent-closeout-and-host-lifecycle.md).

Closing and archiving remain distinct operations. Host failure must leave the
semantic Agent active; successful host close followed by persistence failure
must converge through stale reconciliation and a retryable local archive.
Unsupported close capability leaves `Archive only` available without claiming
that execution stopped.

Terminal input, resize and release are capabilities of the host-owned terminal
stream returned by `openTerminal` or `openLinkedExecutionTerminal`. The host
still owns the PTY and its lifecycle; clients only render and transport it.
Hosts that cannot provide a capability return an explicit unsupported result.
This keeps the module deep and avoids copying Herdr or tmux mechanics into
every caller.

Opening a terminal accepts an optional `TerminalOpenOptions.resizeMode`. The
default `fit` mode sizes the host PTY to the client viewport, as the browser
terminal and workspace-review split do. The `preserve` mode remains available
for a future read-mostly browser surface that must not impose its viewport on
the host terminal.

The implemented shape is deliberately small:

```text
openTerminal(AgentAccess, TerminalDimensions, TerminalOpenOptions?)
  -> Effect<HostTerminalOpenResult, HostError>
       events: Stream<frame | closed, HostError>
       send(text | bytes): Effect<HostActionResult, HostError>
       resize(columns, rows): Effect<HostActionResult, HostError>
       release(): Effect<HostActionResult, HostError>

openLinkedExecutionTerminal(LinkedExecution, TerminalDimensions, TerminalOpenOptions?)
  -> Effect<HostTerminalOpenResult, HostError>
```

Linked execution owners, terminal targets and target identity bindings remain
opaque host values. Adapters revalidate them against a fresh snapshot before
attaching or taking over a terminal, and fail closed when the binding is
missing, stale or reused.

The Herdr adapter translates both terminal capabilities into its controller
stream; the mock adapter exercises the same contract. Herdr may discover
shell-only panes by matching an Agent's opaque host context and working
directory, or prepare a linked shell tab in the existing Agent workspace when
no existing one is available. It also
classifies recognised sibling agents as linked executions. The adapter returns
only opaque targets and human-readable explanations: Herdr workspaces, tabs,
panes and split layouts never become Observatory nodes.

The browser owns terminal interpretation through xterm.js and transient
terminal presentation. It keeps a primary terminal and multiple selected linked
executions as tabs, and can show workspace evidence beside the active terminal.
The host remains responsible for process ownership, resize and release.
Releasing a linked execution releases
Observatory's controller; it must not silently terminate an existing user-owned
shell process. The bounded browser diff is a separate workspace capability, not
part of `SessionHost`.

An embedded PTY is not a guarantee of native provider UI. In particular, image
or file attachment may depend on an OS picker, terminal clipboard/graphics
protocol or provider-specific command. Do not grow `SessionHost` into a
universal upload interface; expose proven capabilities and retain a
capability-gated explanation or Herdr route for provider-only interactions. The
browser terminal is the default in-product route.

The first launch slice is implemented and specified in
[session-launch.md](../specs/session-launch.md). It keeps `SessionHost` as the
only host seam and uses a typed launch capability; project recency, Git
inspection and worktree preparation remain a separate workspace-provider
capability at the control-plane edge. The local web client now consumes that
same coordinator through a narrow loopback launch gateway with workspace and
host-provided choices; a JSON CLI remains a follow-up client.

The web workspace review uses that edge capability without adding Git state to
the Universe. The API accepts an observed Agent id, resolves its trusted
worktree metadata server-side, and returns a bounded `WorkspaceDiffSnapshot`.
The browser never submits a filesystem path, writes the checkout, or persists
diff contents. A local provider compares the working tree with `HEAD`, includes
safe untracked files, caps file/output size, and reports unavailable or
non-Git workspaces as explicit states. The web renderer owns only transient
file selection and unified/split presentation. The current review shell places
that read-only diff beside the selected Agent's host-owned terminal deck; both
are still transient views over the same Agent and neither creates a second
workspace or repository model. Companion tabs use server-issued opaque link
handles and are revalidated through `SessionHost` before opening.

The next verification slice deepens this edge into one
`AgentRepositoryStatusReader`. A caller supplies only an Observatory Agent id;
the module resolves its trusted host-observed worktree, combines bounded local
Git status with pull-request facts from contributed `CodeHostingProvider`
plugins, and returns one provenance-bearing snapshot. GitHub is the first
built-in plugin and uses structured `gh` output; a synthetic plugin and external
example use the same versioned manifest, loader and contract suite. Neither the
renderer nor Universe learns provider fields, command syntax, authentication or
filesystem paths. Remote status is cached by repository/branch/HEAD and never
fetched on every host poll. See
[Observatory plugin system](../specs/observatory-plugin-system.md) and
[Agent repository status and code-host plugins](../specs/agent-repository-and-code-host-plugins.md).

### Agent-harness and provider-session module

Provider facts and catalogue discovery sit behind the deeper `AgentHarness`
plugin interface. An agent host knows where a process runs; a harness adapter
knows which provider sessions exist, how its CLI starts and resumes, and how to
prove native conversation continuity.

```text
snapshotSessions(ProviderInstance) -> ProviderSessionSnapshot
recognise(HostObservation)         -> Recognition
inspect(NativeAgentReference)      -> ProviderFacts
watch(ProviderInstance)            -> EventStream<ProviderObservation>?
```

Candidate facts include:

- provider and native agent identifier;
- native transcript locator;
- agent-reported title or objective;
- runtime state and the source of that state;
- last activity time;
- context usage where exposed; and
- parent agent identity where exposed.

AO does not ingest transcripts by default. Catalogue discovery reads bounded
provider metadata, while start, resume and continuity use the provider's opaque
native conversation reference rather than conversation contents. A later
capability may expose bounded transcript or result inspection with explicit
provenance.

Harness support is progressive:

1. host-only process recognition and terminal access;
2. provider-session catalogue discovery;
3. plugin-backed new-session and exact-session resume;
4. proved native conversation continuity and replaceable execution binding;
5. optional native metadata or hook integration; and
6. optional richer harness controls.

### Git topology module

The Git topology module turns repository paths into operational facts without
becoming a complete Git client.

```text
inspect(paths)                   -> GitSnapshot
compare(worktree_ids)            -> OverlapReport
prepareWorktree(request)         -> PreparedWorktree
```

It owns:

- repository identity and common directory;
- base branch, current branch and worktree provenance;
- dirty state and changed-file summary;
- worktree-to-worktree changed-file overlap;
- commit divergence where cheap to obtain; and
- optional pull-request and checks references when another adapter supplies
  them.

New write-capable implementation agents should receive a fresh worktree by
default. Sharing an existing worktree requires an explicit override unless the
new agent is declared read-only.

### Attention module

The Attention module derives explainable attention signals from accepted state
and observations. It must be deterministic in v1; continuous LLM judgment is
out of scope.

```text
evaluate(UniverseSnapshot, now) -> AttentionProjection
```

Each signal contains:

- type;
- target;
- human-set priority inherited from its goal;
- first-observed and most-recent timestamps;
- number of downstream items blocked where known;
- source facts; and
- a human-readable explanation.

Default ordering is:

1. human intervention required;
2. human-set work priority;
3. intervention type;
4. time waiting;
5. downstream work blocked; and
6. risk of work or context loss.

Candidate signal types are question, approval, review-ready, stalled,
parent-waiting, integration-blocked, context-pressure and host-error.

### Proposal and authority module

Humans and agents submit the same commands, but actors have different authority.
The Proposal and authority module decides whether a command is applied,
recorded as provisional or rejected.

Initial modes:

```text
observe   discovered facts only; no agent-authored structure
propose   agent commands create provisional structure
auto      trusted actor may mutate within configured scope
```

Auto policy should be scoped by actor and optionally goal. Global auto authority
is not required. Execution never waits for acceptance of organisational
metadata.

Humans own priority, authoritative goal completion and archive state by default.
Whether trusted agents may create top-level goals is a prototype question.

### Projection module

The Projection module converts the universe into renderer-oriented read models.
It prevents each client from reimplementing filtering, attention promotion and
graph traversal.

Initial projections:

- systems overview: human-authored Systems with rolled-up Goal, Agent,
  attention and uncertainty counts;
- portfolio: active goals plus one level of children within a selected System;
- focused goal: expanded work, agent and Git relationships;
- attention queue: ordered signals with explanations;
- code contexts: observed repository/worktree groups with agents;
- code-context map: the same observed groups rendered as derived map bodies
  with agent satellites;
- related agents: evidence-backed candidates around a selected goal, with
  explicit adopt or dismiss commands;
- search: active and archived metadata results;
- catch-up: changes since a cursor grouped by goal; and
- inspector: one object's full known facts and provenance.

Deep blocked descendants appear as warnings on collapsed ancestors. Selecting a
warning returns a projection that reveals the relevant path.

The code-context projections are an experimental supporting lens. They derive
repository, worktree and unknown-context groups from current agent
observations; the map projection adds deterministic positions for the derived
cluster bodies and their agent satellites. Agents remain the only
selectable records. These projections do not write accepted state, create
project nodes or change Goal → Agent assignment. A separate persisted
worktree/context record remains deferred until real usage shows that agent
metadata is insufficient. The related-agent projection does not create a
project, workstream or execution-container node: it compares current
observations, preserves confidence and assignment ownership, and only changes
Goal → Agent state after an explicit human command. Dismissals are durable per
goal/agent pair so the same rejected evidence does not repeatedly interrupt
the user.

### Layout module

The Layout module owns logical 2D positions independently of screen resolution
or renderer technology.

```text
place(new_nodes, existing_layout) -> LayoutPatch
format(selection, constraints)    -> LayoutPatch
apply(LayoutPatch)                -> LayoutVersion
```

Rules:

- accepted positions persist across restarts;
- adding observations does not move accepted existing nodes;
- placing a new goal scans deterministic logical candidates against the occupied
  goal and direct-satellite footprints;
- manual movement pins nodes;
- moving a goal moves its derived direct-satellite positions without persisting
  separate agent coordinates;
- explicit formatting may preserve pinned nodes;
- layout mutations are undoable; and
- renderers scale and clip logical coordinates to their viewport.

The production web Atlas retains the accepted logical goal anchors and derived
satellite positions from the projection. Its responsive viewport scales the
distance between those anchors while keeping the rendered bodies and labels
legible. The current evidence does not justify a client-side graph layout
engine or a second set of browser-owned positions.

### Search module

V1 search covers AO-owned metadata only:

- goal and agent names;
- descriptions;
- provider, repository, branch and worktree metadata; and
- active and archived state.

Search is type-to-find and returns the owning goal and view context for each
result. Transcript search remains provider-native.

## Core records

Identifiers are AO-generated, stable and unrelated to display names. Native
identifiers are stored as locators, never used as primary AO identity.

```text
System
  id, title, description?, version

Goal
  id, system_id?, title, description?, priority?, lifecycle, acceptance, version

Agent
  id, primary_goal_id?, host_ref, provider_ref?, display_name,
  access_mode, lifecycle, acceptance, version

RepositoryRef
  id, canonical_path, common_directory, remote_identity?

WorktreeRef
  id, repository_id, path, branch, base_ref?, lifecycle

AgentWorktree
  agent_id, worktree_id, access_mode

Relationship
  id, type, from_id, to_id, acceptance, source, version

Observation
  id, subject_id, fact_type, value, source, confidence, observed_at, expires_at?

AttentionSignal
  id, subject_id, type, explanation, opened_at, updated_at, resolved_at?

LayoutNode
  object_id, x, y, pinned, layout_version
```

Initial relationship types should be deliberately small:

- contains;
- delegated-to;
- spawned;
- depends-on;
- blocked-by;
- reports-to; and
- integrates-into.

Adding a generic untyped edge would make the three topologies indistinguishable
and should be avoided.

## Fact provenance

Every fact exposed to the UI needs a source classification:

```text
human       explicitly authored by the user
agent       reported through AO by an agent
host        observed from Herdr, tmux or another host
provider    read from native agent metadata
git         derived deterministically from Git
inferred    heuristic and not authoritative
```

The latest fact is not automatically the most trustworthy. Resolution uses a
fact-specific precedence rule and recency. For example, a live host state can
supersede an older agent report, while human priority cannot be superseded by an
inferred value.

Full history UI is out of scope for v1. The store should nevertheless retain the
actor, timestamp and previous accepted value for structural mutations so recent
changes can be explained or undone later.

## Commands

The control interface should expose domain commands rather than CRUD over
tables. Candidate v1 commands are:

```text
CreateSystem
RenameSystem
SetSystemDescription
CreateGoal
RenameGoal
SetGoalPriority
AssignGoalToSystem
CompleteGoal
ArchiveGoal
AssignAgent
AssignAgents
ImportAgent
ProposeRelationship
AcceptProposal
RejectProposal
PlaceNode
FormatSelection
LaunchAgent
ReportAttention
ResolveAttention
```

Commands include an actor, expected object version where applicable and an
idempotency key. This makes agent retries safe and prevents silent overwrites
between a human and an auto-mode agent.

The CLI is a thin caller of this interface. An illustrative surface is:

```sh
ao goal create --title "Ship model router" --priority p1
ao agent import <native-ref> --goal <goal-id>
ao agent launch --goal <goal-id> --harness codex --host herdr
ao relation propose --type delegated-to --from <parent> --to <child>
ao attention request --agent <id> --type question --summary "Choose cache policy"
ao goal context <goal-id> --format json
```

Exact grammar is deferred until the command model is exercised through the live
walking slice.

## Reconciliation and event flow

AO reconciles host snapshots because hosts or clients can stop while Agents
continue running. V0 uses renderer-triggered snapshot polling; host event
streams remain a future optimisation rather than a domain dependency.

```text
startup / refresh
  -> load accepted AO state
  -> ask the host for a snapshot
  -> match native agents to tracked Agents
  -> add newly observed Agents to the unassigned inbox
  -> evaluate attention
  -> publish updated projections
```

Observations are idempotent and may arrive out of order. Each adapter supplies a
source-native identity and observed timestamp. Reconciliation must never create
a trusted goal or relationship from process discovery alone.

Newly discovered Agents are durable host observations in the unassigned inbox;
they do not receive a Goal assignment without an explicit human command. A
shell-only pane that is absent from `snapshot.agents` is not reconciled at all.

## Persistence

V1 should use a local transactional store. SQLite is the leading default because
AO needs durable relationships, indexes, atomic commands and simple distribution
without operating a server.

Store responsibilities:

- accepted and provisional semantic state;
- stable layout;
- native locators;
- latest observations plus enough history for catch-up;
- attention lifecycle;
- mutation provenance; and
- schema migration.

The implemented catch-up slice persists accepted semantic changes with a
monotonic sequence and one durable operator checkpoint. The projection groups
post-checkpoint records into new, changed, attention, finished and stale
outcomes. The operator lens coalesces those records to the latest outcome per
affected Goal or Agent while retaining the underlying transition count.
Reading or polling does not advance the cursor; only the explicit
`AcknowledgeCatchUp` Universe command does. This bounded semantic vocabulary is
for operator resumption and is not a transcript, event-sourcing model or
general audit log.

Transcripts, terminal scrollback and repository contents remain outside the AO
store. Large provider payloads should not be copied into generic metadata.

The store is an implementation detail of the control plane. Renderers, agents
and adapters must not query SQLite directly.

## Local control transport

The control plane currently serves one in-process browser GUI over loopback
HTTP and SSE. A future structured CLI or agent skill may consume versioned
commands, but that is not a reason to maintain a second renderer. A daemon and
general subscription transport remain later decisions for demonstrated
concurrent-client needs.

The first production web slice uses an in-process loopback HTTP adapter. The
`web` composition root owns one `Universe`, reconciles one selected
`SessionHost`, serves the static browser client, and exposes JSON for the
existing universe-map, command-centre, catch-up, closeout and inspector
projections. A narrow web command gateway accepts only goal editing, single or
atomic batch assignment, completion and archive commands and delegates their
invariants and persistence to `Universe`. A separate bounded closeout gateway
coordinates fresh host access, close, reconciliation and semantic archive. It is
not CRUD and does not expose the full internal command union. It binds to
`127.0.0.1`; mutations require an exact loopback Origin, JSON content type and
an explicit intent header. The browser polls because host refresh is already
snapshot based. There is no browser-to-SQLite access, Herdr protocol, second
semantic model, event bus or daemon in this slice.

A separate bounded launch gateway exposes host launch options, workspace
choices and directory browsing, then accepts one `StartAgent` intent. It calls
the shared `StartAgentCoordinator`, which owns workspace preparation, host
launch, reconciliation and goal assignment. The browser never receives a
concrete host adapter, invokes Git or manufactures an Agent before host
observation. Launch mutations use the same exact-origin and explicit-intent
boundary as Universe commands.

The same process exposes a narrow hosted-terminal gateway. The browser asks to
open an accepted Agent; the server re-resolves it through the generic
`SessionHost` access capability and retains only a transient session handle.
Server-sent events carry bounded replay plus live terminal frames. Separate
same-origin JSON requests carry input, resize and release. Random session IDs
act as process-local capabilities, and shutdown releases every open host
session. SSE comment keepalives prevent a quiet terminal from tripping the
loopback server's idle timeout. Workspace review opens the terminal beside the
read-only working-tree diff with `resizeMode: fit`, matching the fullscreen
terminal's wrapping and cell geometry in the half-width pane. This adds no
browser PTY, terminal persistence, concrete Herdr type, WebSocket or remotely
authenticated service.

This is an ordinary browser surface launched by `bun run web` or
`bun run web:mock`, not an Electron application. Projection polling is an
intentional walking-slice transport. Add a versioned local
command/subscription transport only when a real concurrent consumer requires
it. The hosted terminal uses SSE plus narrow
POST actions because its data flow does not yet require a general WebSocket
transport. The browser never owns or creates a PTY.

## Renderer contract

Renderers receive projections, not raw events or database rows. A renderer must
be able to:

- request portfolio, focused-goal, attention, search and inspector projections;
- subscribe to projection changes;
- submit domain commands;
- retain local viewport state; and
- request agent access;
- invoke a host attachment target; and
- submit a supported agent interaction.

The first overview shows goals and one level of children. Additional delegation
and Git edges are lenses. Attention from hidden descendants is aggregated on the
nearest visible ancestor.

Candidate visual facts are defined semantically rather than as colours:

```text
scope_weight
human_priority
attention_required
recency
active_agent_count
total_agent_count
context_pressure
lifecycle
acceptance
```

The web renderer decides how to encode those facts while preserving meaning and
accessibility.

Renderer-specific objects and event types stop at the renderer module. The
Projection and Layout modules define what exists and where it is logically
placed; the browser maps that state onto its viewport without creating a second
semantic model.

### Local interaction state

Selection, viewport, zoom, active lens, open floating inspector card, search text and navigation
history are client-local state. They are not durable universe facts. A client
must retain this state while an attachment target is active and restore it when
the user returns.

The inspector projection supplies AO-owned facts and provenance. Supported
actions and attachment targets come from `AgentAccess`; recent output comes
from the typed `ReadRecentOutput` interaction. None are copied into the
projection or persisted as generic metadata. A renderer combines these sources
in its floating inspector card without weakening their provenance.

The floating inspector card is not a universal chat client. In V0 it supports
inspection and routes into the authoritative hosted agent. Messaging,
structured answers and approval controls are later capabilities, not part of the
first live walking slice.

## Herdr adapter: first live slice

Deterministic fixtures and the live Herdr adapter provide the first real pair
required to justify the Agent-host seam.

The live adapter should use:

- an agent snapshot for bootstrap, with recognized agent records as the
  agent inventory;
- event subscription for ongoing workspace, pane and agent changes;
- opaque workspace/tab/pane identifiers as native locators and metadata;
- agent status and agent identity where available;
- worktree provenance from Herdr plus canonical Git inspection from AO;
- an attachment target that directly attaches the current terminal to the
  relevant pane;
- recent pane output for an optional read-only preview.

The adapter must translate Herdr-specific hierarchy into hosted-agent facts.
For the current V0 adapter, `snapshot.agents` is authoritative: pane, tab and
workspace records are joined only to enrich an agent and provide its
opaque focus target. A shell-only pane is not promoted into a hosted agent.
The Universe module must not depend on Herdr record types.

This first-party adapter is intentionally the only live host in V0/V1. The
boundary is considered successful when a later host can implement the same
contract without changing the semantic model; no multi-host feature is implied
until that evidence exists. External efforts such as
[Superlogical](https://www.superlogical.com/), which describe a broader
agent/multiplexer substrate, are monitored as possible future host adapters,
not modelled as new AO domain objects today.

The current V0 adapter is read-only except for explicit focus, terminal access,
agent launch and the operations already proven by the live slice. Stop and
broader pane control remain deferred.

### Deterministic mock host

The project also includes a development-only `MockHostAdapter`. It implements
the same `SessionHost` interface as Herdr and is selected only by the explicit
`AO_HOST=mock` composition setting. A clock-driven scenario selects immutable
frames rather than sleeping or mutating a second domain model. Each frame emits
stable synthetic native identities, opaque access targets and sanitized agent
metadata. The real Universe reconciliation, stale-agent handling, attention
evaluation, projections, layout and browser terminal-return path therefore run
unchanged.

The default `orbit` scenario starts at twenty agents, introduces additional
agents, rotates working/idle/waiting/blocked/done states and omits one agent
for a frame to exercise recovery. `AO_MOCK_SEED=portfolio` is an explicit
development convenience that creates three synthetic goals and assigns agents
through `Universe.execute`; it never runs for the live Herdr host. The mock
attachment action is intentionally local and reports simulated focus rather
than claiming to control a real terminal.

The opt-in `degraded` scenario cycles through a healthy baseline, complete host
unavailability, recovered observations with a failing action transport, and
full recovery. It lets the assembled product exercise retained stale state and
bounded launch, close, handoff and terminal errors without making the default
portfolio intermittently unusable.

## Retired native-client evidence

The native terminal client was the first real renderer and established several
useful interaction and layout rules. It was retired on 2026-08-27. The remainder
of this section records that historical evidence; it is not a maintained-client
contract. Current behaviour and future work belong to the web GUI and feature
roadmap.

The default top-level projection is a Systems overview. Selecting a System
enters a portfolio map of stable goal bodies and direct agent satellites. Goal
size communicates agent load, human-set priority has a persistent visual
treatment, and blocked/waiting attention reaches the owning goal even when the
satellite is outside the current viewport. Narrow terminals use a focused
goal/lens fallback rather than compressing the whole universe.
Worktrees, repositories, runtimes and hosts are agent metadata in the
inspector, not navigation levels or map nodes.

Unassigned agents are hidden from the portfolio map and represented by an
`INBOX !N · v list` warning in the header. The inbox is a transient queue, not
a topology node or durable domain object; it must not consume the central map
footprint needed to understand accepted goals. Stale or unavailable host state
is called out in the header and remains actionable through the list and
attention lenses. Attention and focused inbox lenses expose an attention-first
list, and a selected goal's assignment picker supports type-to-filter agent
metadata. Goal satellites continue to use
identity-derived, collision-aware perimeter slots. This is deterministic slot
allocation, not a force-directed graph layout.

Agents may be explicitly archived by a human without stopping their host
execution. The web Closeout surface separately offers `Close & archive` for a
live Agent and local archive for an Agent confirmed stale. Archive removes the
agent from active
projections without deleting its identity, assignment or observed history;
future host reconciliation updates the archived record but does not silently
restore it.

New goals use the Layout module's nearest-free placement scan. It is dynamic at
insertion time because it considers current footprint and occupied space. If an
unpinned goal later gains enough direct agents to collide, the same module
repairs only that goal into the nearest deterministic free slot; it does not
globally reflow accepted goals. The Atlas also spaces complete rendered
footprints, including satellite orbits, as a projection-time safety net for
older persisted layouts. A manually dragged goal stores and pins its
world-space anchor, and its direct agent satellites continue to derive their
positions relative to that anchor. Pinned goals are never moved by automatic
repair. Clicking or focusing a goal selects a
goal-only map projection in the renderer; that view contains the goal and all
of its direct agents, not repositories, worktrees or panes. Selecting an
unassigned agent and focusing it reaches the supporting inbox list lens.
Creating a goal selects it automatically, and `a` from a selected goal opens a
picker over unassigned agents; `a` from a selected agent retains the
agent-to-goal picker.

Map keyboard navigation follows the visible hierarchy: `j`/`k` cycles goal
bodies in the portfolio, then cycles a focused goal's direct agents clockwise
around its body. The focused inbox cycles unassigned agents, while the
supporting grouped list retains flat row navigation.

The attention queue, unassigned inbox, inspector and grouped list remain
supporting projections of the same state. A renderer can switch to them for
rapid execution, but the spatial universe is the primary V0 experience.

The V0 renderer treats attention as navigation, not decoration. Current
attention uses a steady `!` marker and owning-goal `!N` aggregate; stale or
uncertain state uses `?` and `?N`. Human-set `P0`–`P3` priority remains a
separate durable treatment. `g` selects and focuses the next item in the exact
attention ordering, `f` can focus or reset the selected context, and `t`,
`Enter` or an agent double-click opens the selected hosted terminal. These
actions may change emphasis and viewport, but never reflow durable positions.

Live `working` agents are deliberately distinct from merely live `idle`
agents: their marker cycles through a restrained half-moon animation and
their map border pulses green. The animation is a progress cue, not a state
source; the runtime state and host health remain visible in detail/list views.
Recently completed live agents receive the same low-noise treatment in
reverse: a `✓` marker, muted green emphasis and completion age keep them easy
to review briefly without turning completion into an attention condition. A
stale or unavailable last-known `done` state keeps the uncertainty treatment.

The renderer has semantic presentation tiers independent of camera zoom:
overview uses compact labels and summary markers, context expands
attention-bearing labels in their owning context, and the selected target gets
the detail tier with a complete wrapped title. Focus/detail additionally
exposes larger labels plus the complete direct orbit. This is a presentation
policy over the same projection, not a second layout or domain model. Dense
focused goals apply the same rule deliberately: overview may collapse healthy
satellites to status glyphs, while selected or attention-bearing nodes retain
labels and context/detail restore progressively more identity. When geometric
zoom drops below the readable cell density, overview nodes collapse to glyphs
and priority markers. Terminal zoom cannot shrink text, so density reduction
must remove labels rather than allow fixed-width cards to overlap.

Keyboard operation remains complete: type-to-find, focus navigation, inspect,
attention navigation, terminal entry and return-to-universe. Quick message and
additional lenses are later capabilities.

Selecting a goal, agent or inbox opens a transient floating inspector card.
The card is anchored near its target, clamped inside the map/list surface, and
does not reserve a permanent sidebar. Opening the terminal is the direct
agent action, normally `Enter` or double click. Capability-aware actions may
appear in a right-click menu, but every action must also be reachable by
keyboard. Opening that menu is transient: it records a context target without
changing primary selection or inspector state. Choosing an action explicitly
promotes the target when the action needs primary context.

## Security and privacy

V1 is local-only and single-user.

- Bind control transport only to a user-owned local socket or loopback endpoint.
- Restrict store and socket filesystem permissions.
- Never ingest transcripts by default.
- Treat native transcript locators and repository paths as sensitive metadata.
  A local explicit Agent inspector may expose an ID-kind provider session
  reference for diagnosis and copying; transcript-path references and aliases
  never enter browser projections.
- Keep host launch arguments structured; do not build commands through shell
  string concatenation.
- Require explicit authority for auto-mode mutations.
- Keep agent-supplied labels and descriptions untrusted at rendering and command
  seams.
- Do not execute instructions embedded in observed terminal output.
- Do not automatically merge, delete worktrees or archive goals.

Implementation and fixtures must remain clean-room: no employer code,
confidential information, customer data, internal designs, credentials, work
accounts or proprietary agent transcripts.

## Failure handling

- Host unavailable: preserve the Universe and mark execution presence unknown;
  do not convert transport loss into dormancy or process exit.
- Provider unavailable: preserve saved session continuity as unknown until a
  scoped catalogue refresh succeeds.
- Adapter crash: restart independently; do not corrupt accepted state.
- Duplicate discovery: reconcile managed Agents by exact scoped provider
  identity, then bind current host executions; host-native identity alone does
  not establish durable continuity.
- Missing provider session: preserve the Agent and report continuity lost only
  when a complete provider scope proves absence.
- Current implementation persists provider continuity, execution presence,
  resume capability and observation health independently. Provider-session
  recovery scopes exact host evidence before Universe reconciliation; native
  provider aliases may canonicalise to one session, but cwd, title and recency
  never do. Execution bindings are keyed by host instance and retained as
  history when a complete snapshot proves them absent.
- A same-harness, same-workspace unidentified execution is plausible-live
  evidence, not identity proof. The Universe projects the provider-backed Agent
  as `possibly-running`, and the launch coordinator blocks ordinary resume at
  its existing interface until the ambiguity disappears or exact evidence
  arrives.
- Stale agent report: show source and age; a fresher deterministic host fact may
  supersede runtime state.
- Launch succeeds but assignment fails: retain the discovered agent in the
  inbox and report the partial result.
- Assignment succeeds but launch fails: do not leave a phantom live agent;
  preserve the failed launch event for inspection.
- Renderer disconnect: hosted agents and the control plane continue running.

## Testing strategy

### Replay fixtures

Use synthetic or sanitised fixtures representing at least:

- 20–30 mixed active and idle agents;
- several goals across multiple repositories;
- a cross-repository goal;
- parent-child delegation;
- two worktrees editing overlapping files;
- blocked descendants hidden below the overview level;
- provisional agent-created structure; and
- completed but unarchived work.

### Module tests

- Universe invariants are tested only through its interface.
- Attention rules use table-driven clock-controlled cases.
- Projections use deterministic golden fixtures.
- Layout tests assert stability when unrelated nodes arrive.
- Search tests cover active, provisional and archived metadata.
- Git tests use disposable repositories and real worktrees.
- Store tests verify command atomicity, idempotency and migration.

### Adapter contract tests

Every agent-host adapter runs the same contract suite for snapshot,
reconciliation, watch recovery, access capability reporting, attachment targets
and each interaction it claims to support. Provider adapters run shared tests
for recognition, missing metadata, stale locators and malformed native state.

### End-to-end tests

The completed v0 live Herdr slice demonstrated the following boundary:

1. discover existing vanilla agents into an unassigned inbox;
2. create a goal and assign an agent directly to it;
3. rename and reprioritise the goal;
4. restart AO and recover the accepted organisation;
5. surface an explainable blocked or waiting attention signal;
6. find a goal or agent by name;
7. inspect agent execution metadata without introducing infrastructure nodes;
8. focus or attach to the real hosted agent; and
9. complete and archive a goal only through an explicit human action.

## Implementation sequence record

The phases below record how the current architecture was reached. They are not
the active product roadmap; current priorities live in the
[feature roadmap](../specs/observatory-feature-roadmap.md).

### Phase 0 — rendering discovery (complete)

- OpenTUI proved viable for a portable native spatial universe client.
- Spatial, enhanced-graphics and ANSI-raster experiments did not justify a
  custom graphical terminal renderer.
- The native client proved the first spatial boundary and was then retired; the
  web GUI is now the sole maintained product renderer.

### Phase 1 — live Herdr walking slice (complete)

- Implement only the Universe, Attention, Projection and SQLite behaviour needed
  by the v0 workflow.
- Add Herdr snapshot discovery and focus/attachment through the Agent-host
  interface.
- Build the goal-centred universe map, direct Agent satellites,
  unassigned inbox, inspector, supporting list lens and search.
- Keep the process in-process; do not add a daemon solely for this slice.
- Dogfood with real agents before broadening the model.

### Phase 2 — live-state hardening (partially complete)

- Add Herdr watch/reconciliation and stale-host recovery.
- Add the minimum provider recognition needed for reliable attention signals.
- Add Git/worktree inspection as agent metadata and conflict warnings.
- The outstanding evidence gate is a one-week test with at least 15 real
  recognized agents, excluding shell-only panes, tabs and workspaces.

### Phase 3 — interaction and agent integration (partially complete)

- Preserve the completed [native terminal surface POCs](../specs/terminal-surface-pocs.md)
  as historical evidence for the host-owned terminal boundary.
- Add targeted quick messages only after exact-target UX is trusted.
- Add the `StartAgent` CLI/skill flow for agent-created goals, workspace
  preparation and agent assignment; keep the one-request contract above
  Herdr.
- Preserve human approval for completion and archive behaviour.
- Introduce the local daemon and control transport when multiple clients or
  agent processes create a real need.

### Phase 4 — local web observatory (complete walking slice)

- Build a maintained React client with native SVG and CSS over the accepted
  universe-map, command-centre and inspector projections.
- Preserve atlas, attention queue and ledger as projections of the same state;
  keep selection, viewport, zoom, theme and active lens browser-local.
- Evolve the proven read-only slice with a narrow same-origin command gateway;
  all mutation still goes through `Universe`, and the browser never receives
  persistence or host capabilities.
- Use the core-owned durable checkpoint and deterministic catch-up projection;
  do not infer history from browser polling.
- Render only a transient host-owned terminal through the loopback capability
  gateway; do not create a browser PTY or expose concrete host protocol.
- Keep the browser client local; do not require Electron or introduce a daemon
  solely for this slice.

### Phase 5 — broader hosting

- Add tmux after the Herdr interface has survived real use.
- Evaluate other durable agent hosts, including Superlogical, through the
  adapter contract rather than by importing their internal model.
- Add skills and hooks for enhanced reporting.
- Revisit launch, input and lifecycle capabilities.
- Consider an AO-native multiplexer only if existing hosts prevent important
  workflows.

## Decisions deliberately deferred

- Broader Atlas relationship and layout semantics
- Whether the daemon starts on demand or runs continuously
- Provider-specific metadata mechanisms
- Pull-request provider integrations
- Cross-machine synchronisation
- AO-native multiplexer implementation

## Technical success criteria

- A renderer can be replaced without changing domain or host adapters.
- An agent host can be replaced without changing domain or renderers.
- Replay and live Herdr observations produce the same projections.
- Vanilla executions are useful without AO-specific hooks, but durable managed
  continuity remains explicitly unsupported until provider identity is proved.
- Enhanced metadata can arrive without restarting or recreating an agent.
- Adding an unrelated agent does not disrupt the current terminal selection.
- A blocked agent inside a collapsed goal reaches the overview with an
  explanation.
- Goal positions remain stable when unrelated agents are discovered, and
  accepted goal positions survive SQLite restart.
- Type-to-find and attention navigation place a selected result in its owning
  goal context.
- Agent retries do not duplicate goals, agents or relationships.
- No transcript contents are required to reconcile the Universe after restart;
  metadata-only provider catalogues can reconstruct recovery candidates after
  a database reset.
- The live Herdr adapter can disconnect and reconcile without losing accepted
  state.
- A user can inspect and message one supported agent without leaving the map,
  then attach and return without losing local navigation state.

## Open technical questions

- What minimum native facts can be obtained reliably from each vanilla provider?
- Can Herdr attachment be represented portably without leaking pane concepts?
- Does one canonical logical layout work across web and terminal viewports?
- Which attention signals can be derived reliably without hooks?
- How should stale observations expire while preserving historical catch-up?
- What capability model supports host differences without producing a shallow,
  sprawling Agent-host interface?
- At what scale does the graph need level-of-detail aggregation beyond one
  visible child layer?
- What is the smallest safe auto-mode policy users will trust?
