# Observatory technical architecture

Status: implemented V0 boundary; Herdr terminal lens added, future extensions remain proposed
Date: 2026-08-22
Depends on: [Goal-centred agent orchestration map](agent-orchestration-map.md)

Technology choices: [Observatory technology decisions](technology-decisions.md)

Extension boundary: [Observatory plugin architecture](plugin-architecture.md)

## Purpose

This document defines the initial technical shape of Observatory: a local semantic
control plane with a portable native spatial universe and a later higher-fidelity
web interface over agent sessions hosted by other tools.

The implementation language and initial toolchain are selected separately in
the technology decision record. Disposable renderer experiments established the
v0 presentation split; live product evidence must drive later layout decisions.

The staged native-terminal experiments are specified in
[Native terminal surface POCs](../specs/terminal-surface-pocs.md). They test
terminal fidelity and Herdr transport separately from the semantic control
plane and do not change the implemented V0 boundary by themselves.

The 2026-08-22 evidence pass found both experiments technically plausible:
Bun/OpenTUI can host a small native terminal surface, and Herdr can stream a
live session into the same panel while retaining process ownership after
release. The first Herdr-backed embedded-terminal slice is now implemented
behind the SessionHost seam and has passed deterministic mock coverage plus a
non-destructive live map → terminal → release → map smoke. This promotes the
host-owned capability, not the disposable AO-owned PTY, into V0. It does not add
transcript ingestion or justify an AO-owned daemon.

## Architectural objective

AO must make many heterogeneous agent sessions understandable as durable,
goal-centred work without becoming coupled to a particular agent provider,
terminal multiplexer or renderer.

The architecture must support:

- vanilla Claude Code, Codex, OpenCode and Pi sessions;
- optional skills and hooks for richer semantic reporting;
- goals spanning repositories, worktrees and providers;
- human and agent mutation through the same interface;
- completed disposable rendering experiments followed by a live Herdr walking
  slice;
- a rich terminal client without making terminal rendering part of the domain;
- future tmux and other session-host adapters; and
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
                       CLI + control interface
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│                     AO control plane                            │
│                                                                 │
│  Universe model ─ Attention ─ Proposals ─ Search ─ Projections  │
│         │              │           │          │                 │
│         └──────────── persistent local state ──┘                 │
└───────────────┬───────────────────┬──────────────────┬───────────┘
                │                   │                  │
        session-host seam    provider-facts seam    Git seam
                │                   │                  │
         ┌──────┴──────┐      ┌─────┴──────┐      repository /
         │             │      │            │      worktree state
       Herdr          tmux   Claude       Codex
       first          later  OpenCode     Pi
                │
          hosted terminals

Control-plane projections
         ├── native spatial universe client
         ├── attention/list/inspector supporting lenses
         ├── deterministic test fixtures
         └── later local web observatory
```

The control plane is the only module allowed to author trusted AO state.
Adapters report observations and execute host-specific operations. Renderers
query projections and submit commands; they do not read the store directly.

## Module design

### Universe module

The Universe module owns goals, tracked sessions, typed relationships,
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

- A goal is the largest durable organisational object.
- V1 has no durable organisational object between a goal and its sessions.
- A tracked worker session has at most one primary goal.
- A session may reference other goals without owning work within them.
- Repositories and worktrees may contribute to multiple goals over time.
- Goal priority is human-authored unless an explicit auto policy allows an
  agent mutation.
- Archive is reversible and never deletes history.
- Unknown facts remain unknown; adapters cannot silently convert inference into
  accepted structure.

This is an intentional v1 simplification, not a claim that every goal will
remain flat forever. Delegation and dependency relationships provide structure
without another container. If real usage shows that crowded goals need an
independently named, prioritised and completed intermediate object, revisit
nested goals, workstreams or derived clusters as a new model decision.

### Session-host module

The Session-host module hides how terminal sessions are discovered, persisted,
launched, inspected and attached. Herdr and tmux are adapters at this seam; a
future AO-native multiplexer would be another adapter.

#### Host abstraction policy

Herdr is the required live host for V0/V1. This keeps the first product slice
focused and lets Herdr own session persistence, process lifetime and PTY
transport. It does not make Herdr a dependency of the semantic control plane.

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

The replacement test is architectural, not aspirational: selecting a future
tmux adapter, Superlogical-style host or AO-owned multiplexer at composition
time must leave Universe, persistence, projections and renderers unchanged.
If it does not, the host seam is leaking and must be repaired before the new
host is developed further. The mock host supplies deterministic contract
coverage; every production adapter also needs sanitised fixtures and a live
smoke path where available.

The v1 interface should remain smaller than the underlying host interfaces:

```text
snapshot()                         -> Effect<HostSnapshot, HostError>
watch(cursor)                      -> Stream<HostObservation, HostError>
launch(LaunchRequest)              -> Effect<LaunchResult, HostError>
access(HostedSessionId)            -> Effect<SessionAccess, HostError>
interact(HostedSessionId,
         SessionInteraction)       -> Effect<InteractionResult, HostError>
capabilities()                     -> Effect<HostCapabilities, HostError>
```

`snapshot` and `watch` provide reconciliation plus live updates. `launch`
creates a hosted session but does not assign semantic meaning; the control plane
does that atomically around the launch workflow. `access` returns the
session-specific capabilities and opaque attachment targets understood by the
relevant client or launcher.

`SessionInteraction` is a closed tagged set rather than an arbitrary host
command. Initial candidates are:

```text
ReadRecentOutput
SendText
AnswerPrompt
Resume
Stop
```

Only `SendText` is required for the first quick-interaction experiment.
`AnswerPrompt` is available only when the combined host and provider integration
can identify and answer the prompt reliably. Clients never infer support from a
provider name.

`SessionAccess` reports capabilities per session because the same host may offer
different operations depending on provider recognition, permissions, whether
the process is live, and terminal protocol support. Candidate attachment modes
are focus-existing, open-split, foreground-takeover and embedded-terminal.
Herdr's V0 adapter supports foreground attachment and an embedded terminal;
other hosts may return an honest unsupported result. These modes remain opaque
outside the Session-host module.

Do not expose Herdr workspaces, tabs and panes as universal domain concepts.
They remain adapter details referenced through opaque native identifiers.

Resizing and unrestricted terminal input are not part of the typed `interact`
interface. Quick messages and structured answers cross that operation. A host
may separately expose an optional embedded-terminal attachment capability with
an opaque byte stream plus input, resize and detach operations. The host still
owns the PTY and its lifecycle; clients only render and transport it. Hosts that
cannot provide this capability fall back to another attachment mode. This keeps
the module deep and avoids copying Herdr or tmux mechanics into every caller.

The implemented shape is deliberately small:

```text
openTerminal(SessionAccess, TerminalDimensions)
  -> Effect<HostTerminalOpenResult, HostError>
       events: Stream<frame | closed, HostError>
       send(text | bytes): Effect<HostActionResult, HostError>
       resize(columns, rows): Effect<HostActionResult, HostError>
       release(): Effect<HostActionResult, HostError>
```

The Herdr adapter translates its controller stream into this capability; the
mock adapter exercises the same contract. The renderer owns terminal-cell
interpretation and transient panel state, while the host remains responsible
for process ownership and cleanup.

### Provider-facts module

The Provider-facts module enriches a host observation with facts specific to an
agent CLI. A session host knows where a process runs; a provider adapter knows
what the process means.

```text
recognise(HostObservation)          -> Recognition
inspect(NativeSessionReference)     -> ProviderFacts
watch(NativeSessionReference)       -> EventStream<ProviderObservation>?
```

Candidate facts include:

- provider and native session identifier;
- native transcript locator;
- agent-reported title or objective;
- runtime state and the source of that state;
- last activity time;
- context usage where exposed; and
- parent session identity where exposed.

AO does not ingest transcripts in v1. It stores a native locator so a user or
chief-of-staff agent can retrieve the transcript through the provider's normal
storage or CLI.

Provider support is progressive:

1. process recognition and filesystem discovery;
2. native metadata inspection;
3. optional hook integration; and
4. optional AO skill commands executed by the agent.

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

New write-capable implementation sessions should receive a fresh worktree by
default. Sharing an existing worktree requires an explicit override unless the
new session is declared read-only.

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

- portfolio: active goals plus one level of children;
- focused goal: expanded work, agent and Git relationships;
- attention queue: ordered signals with explanations;
- search: active and archived metadata results;
- catch-up: changes since a cursor grouped by goal; and
- inspector: one object's full known facts and provenance.

Deep blocked descendants appear as warnings on collapsed ancestors. Selecting a
warning returns a projection that reveals the relevant path.

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
  separate session coordinates;
- explicit formatting may preserve pinned nodes;
- layout mutations are undoable; and
- renderers scale and clip logical coordinates to their viewport.

The later web observatory should compare at least one graph layout with simple
manual placement. Selecting a production layout engine before that test is
premature.

### Search module

V1 search covers AO-owned metadata only:

- goal and session names;
- descriptions;
- provider, repository, branch and worktree metadata; and
- active and archived state.

Search is type-to-find and returns the owning goal and view context for each
result. Transcript search remains provider-native.

## Core records

Identifiers are AO-generated, stable and unrelated to display names. Native
identifiers are stored as locators, never used as primary AO identity.

```text
Goal
  id, title, description?, priority?, lifecycle, acceptance, version

TrackedSession
  id, primary_goal_id?, host_ref, provider_ref?, display_name,
  access_mode, lifecycle, acceptance, version

RepositoryRef
  id, canonical_path, common_directory, remote_identity?

WorktreeRef
  id, repository_id, path, branch, base_ref?, lifecycle

SessionWorktree
  session_id, worktree_id, access_mode

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
CreateGoal
RenameGoal
SetGoalPriority
CompleteGoal
ArchiveGoal
AssignSession
ImportSession
ProposeRelationship
AcceptProposal
RejectProposal
PlaceNode
FormatSelection
LaunchSession
ReportAttention
ResolveAttention
```

Commands include an actor, expected object version where applicable and an
idempotency key. This makes agent retries safe and prevents silent overwrites
between a human and an auto-mode agent.

The CLI is a thin caller of this interface. An illustrative surface is:

```sh
ao goal create --title "Ship model router" --priority p1
ao session import <native-ref> --goal <goal-id>
ao session launch --goal <goal-id> --provider codex --host herdr
ao relation propose --type delegated-to --from <parent> --to <child>
ao attention request --session <id> --type question --summary "Choose cache policy"
ao goal context <goal-id> --format json
```

Exact grammar is deferred until the command model is exercised through the live
walking slice.

## Reconciliation and event flow

AO must reconcile snapshots and event streams because hosts or clients can stop
while sessions continue running.

```text
startup
  -> load accepted AO state
  -> ask each host for a snapshot
  -> match native sessions to tracked sessions
  -> place unknown sessions in the discovery inbox
  -> inspect provider and Git facts
  -> evaluate attention
  -> publish updated projections
  -> subscribe from the host cursor
```

Observations are idempotent and may arrive out of order. Each adapter supplies a
source-native identity and observed timestamp. Reconciliation must never create
a trusted goal or relationship from process discovery alone.

Newly discovered sessions do not appear in the accepted universe until a user
imports them or an authorised agent assigns them. They remain searchable in a
discovery inbox.

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

Transcripts, terminal scrollback and repository contents remain outside the AO
store. Large provider payloads should not be copied into generic metadata.

The store is an implementation detail of the control plane. Renderers, agents
and adapters must not query SQLite directly.

## Local control transport

The control plane should be usable from a CLI, long-running renderer and agent
skill. The transport therefore needs request/response commands plus event
subscriptions.

Initial direction:

- a local daemon;
- JSON messages over a Unix domain socket on macOS and Linux;
- a schema-versioned request and event protocol;
- filesystem permissions restricting access to the current user; and
- a later Windows named-pipe adapter if needed.

An HTTP/WebSocket loopback adapter may be added for the web prototype or later
web client. It should translate the same command/query interface rather than
becoming a second domain interface.

A possible local web client would be an ordinary browser surface launched by a
command such as `ao web`, not an Electron application. The daemon would serve
the static client over loopback and carry control events and any supported
embedded-terminal stream over authenticated local WebSockets. The browser can
render that stream with [xterm.js](https://github.com/xtermjs/xterm.js/); it
does not own or create the PTY. xterm.js should reproduce normal ANSI and
true-colour terminal applications closely, while fonts, palette and
terminal-specific graphics may differ from Ghostty, Kitty or another native
terminal. This is a recorded later option, not a change to the native terminal
client as the current implementation priority.

The v0 live slice does not need a daemon. Introduce one only when a second live
client or agent process needs concurrent access.

## Renderer contract

Renderers receive projections, not raw events or database rows. A renderer must
be able to:

- request portfolio, focused-goal, attention, search and inspector projections;
- subscribe to projection changes;
- submit domain commands;
- retain local viewport state; and
- request session access;
- invoke a host attachment target; and
- submit a supported session interaction.

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
total_session_count
context_pressure
lifecycle
acceptance
```

The web and terminal renderers decide how to encode those facts while preserving
meaning and accessibility.

Renderer-specific objects and event types stop at the renderer module. The
Projection and Layout modules define what exists and where it is logically
placed; a renderer maps that state onto its viewport. This keeps the terminal
technology replaceable without creating a second semantic model.

### Local interaction state

Selection, viewport, zoom, active lens, open floating inspector card, search text and navigation
history are client-local state. They are not durable universe facts. A client
must retain this state while an attachment target is active and restore it when
the user returns.

The inspector projection supplies AO-owned facts and provenance. Supported
actions and attachment targets come from `SessionAccess`; recent output comes
from the typed `ReadRecentOutput` interaction. None are copied into the
projection or persisted as generic metadata. A renderer combines these sources
in its floating inspector card without weakening their provenance.

The floating inspector card is not a universal chat client. In V0 it supports
inspection and routes into the authoritative hosted session. Messaging,
structured answers and approval controls are later capabilities, not part of the
first live walking slice.

## Herdr adapter: first live slice

Deterministic fixtures and the live Herdr adapter provide the first real pair
required to justify the Session-host seam.

The live adapter should use:

- a session snapshot for bootstrap, with recognized agent records as the
  session inventory;
- event subscription for ongoing workspace, pane and agent changes;
- opaque workspace/tab/pane identifiers as native locators and metadata;
- agent status and session identity where available;
- worktree provenance from Herdr plus canonical Git inspection from AO;
- an attachment target that directly attaches the current terminal to the
  relevant pane;
- recent pane output for an optional read-only preview.

The adapter must translate Herdr-specific hierarchy into hosted-session facts.
For the current V0 adapter, `snapshot.agents` is authoritative: pane, tab and
workspace records are joined only to enrich an agent session and provide its
opaque focus target. A shell-only pane is not promoted into a hosted session.
The Universe module must not depend on Herdr record types.

This first-party adapter is intentionally the only live host in V0/V1. The
boundary is considered successful when a later host can implement the same
contract without changing the semantic model; no multi-host feature is implied
until that evidence exists. External efforts such as
[Superlogical](https://www.superlogical.com/), which describe a broader
session/multiplexer substrate, are monitored as possible future host adapters,
not modelled as new AO domain objects today.

The initial adapter is read-only except for explicit focus or attachment.
Messaging, launch/stop and broader pane control can follow after live use proves
exact-target interaction and the goal model; they are not part of V0.

### Deterministic mock host

The project also includes a development-only `MockHostAdapter`. It implements
the same `SessionHost` interface as Herdr and is selected only by the explicit
`AO_HOST=mock` composition setting. A clock-driven scenario selects immutable
frames rather than sleeping or mutating a second domain model. Each frame emits
stable synthetic native identities, opaque access targets and sanitized session
metadata. The real Universe reconciliation, stale-session handling, attention
evaluation, projections, layout and TUI attachment-return path therefore run
unchanged.

The default `orbit` scenario starts at twenty sessions, introduces additional
sessions, rotates working/idle/waiting/blocked/done states and omits one session
for a frame to exercise recovery. `AO_MOCK_SEED=portfolio` is an explicit
development convenience that creates three synthetic goals and assigns sessions
through `Universe.execute`; it never runs for the live Herdr host. The mock
attachment action is intentionally local and reports simulated focus rather
than claiming to control a real terminal.

## Terminal client

The terminal is the first real client. It is a restrained, keyboard-first
spatial universe built from portable cells, typography, colour and limited
semantic motion. It does not emulate a graphical canvas or provide a second
enhanced-graphics mode in v0.

The default projection is a portfolio map of stable goal bodies and direct
session satellites. Goal size communicates session load, human-set priority has
a persistent visual treatment, and blocked/waiting attention reaches the owning
goal even when the satellite is outside the current viewport. Narrow terminals
use a focused goal/lens fallback rather than compressing the whole universe.
Worktrees, repositories, runtimes and hosts are session metadata in the
inspector, not navigation levels or map nodes.

Unassigned sessions are hidden from the portfolio map and represented by an
`INBOX !N · v list` warning in the header. The inbox is a transient queue, not
a topology node or durable domain object; it must not consume the central map
footprint needed to understand accepted goals. Stale or unavailable host state
is called out in the header and remains actionable through the list and
attention lenses. Attention and focused inbox lenses expose an attention-first
list, and a selected goal's assignment picker supports type-to-filter session
metadata. Goal satellites continue to use
identity-derived, collision-aware perimeter slots. This is deterministic slot
allocation, not a force-directed graph layout.

Stale or unavailable sessions may be explicitly archived by a human from the
supporting list or attention lens. Archive removes the session from active
projections without deleting its identity, assignment or observed history;
future host reconciliation updates the archived record but does not silently
restore it.

New goals use the Layout module's nearest-free placement scan. It is dynamic at
insertion time because it considers current footprint and occupied space, but
it does not continuously reflow accepted goals. A manually dragged goal stores
its world-space anchor and its direct session satellites continue to derive
their positions relative to that anchor. Clicking or focusing a goal selects a
goal-only map projection in the renderer; that view contains the goal and all
of its direct sessions, not repositories, worktrees or panes. Selecting an
unassigned session and focusing it reaches the supporting inbox list lens.
Creating a goal selects it automatically, and `a` from a selected goal opens a
picker over unassigned sessions; `a` from a selected session retains the
session-to-goal picker.

Map keyboard navigation follows the visible hierarchy: `j`/`k` cycles goal
bodies in the portfolio, then cycles a focused goal's direct sessions clockwise
around its body. The focused inbox cycles unassigned sessions, while the
supporting grouped list retains flat row navigation.

The attention queue, unassigned inbox, inspector and grouped list remain
supporting projections of the same state. A renderer can switch to them for
rapid execution, but the spatial universe is the primary V0 experience.

The V0 renderer treats attention as navigation, not decoration. Current
attention uses a steady `!` marker and owning-goal `!N` aggregate; stale or
uncertain state uses `?` and `?N`. Human-set `P0`–`P3` priority remains a
separate durable treatment. `g` selects and focuses the next item in the exact
attention ordering, `f` can focus or reset the selected context, and `Enter`
attaches to the selected hosted session. These actions may change emphasis and
viewport, but never reflow durable positions.

Live `working` sessions are deliberately distinct from merely live `idle`
sessions: their marker cycles through a restrained half-moon animation and
their map border pulses green. The animation is a progress cue, not a state
source; the runtime state and host health remain visible in detail/list views.

The renderer has semantic presentation tiers independent of camera zoom:
overview uses compact labels and summary markers, context expands
attention-bearing labels in their owning context, and the selected target gets
the detail tier with a complete wrapped title. Focus/detail additionally
exposes larger labels plus the complete direct orbit. This is a presentation
policy over the same projection, not a second layout or domain model. When
geometric zoom drops below the readable cell density, overview nodes collapse
to glyphs and priority markers; selected or attention-bearing nodes retain
labels. Terminal zoom cannot shrink text, so density reduction must remove
labels rather than allow fixed-width cards to overlap.

Keyboard operation remains complete: type-to-find, focus navigation, inspect,
attention navigation, attach and return-to-universe. Quick message and
additional lenses are later capabilities.

Selecting a goal, session or inbox opens a transient floating inspector card.
The card is anchored near its target, clamped inside the map/list surface, and
does not reserve a permanent sidebar. Attaching is a separate action,
normally `Enter` or double click. Capability-aware actions may appear in a
right-click menu, but every action must also be reachable by keyboard.

## Security and privacy

V1 is local-only and single-user.

- Bind control transport only to a user-owned local socket or loopback endpoint.
- Restrict store and socket filesystem permissions.
- Never ingest transcripts by default.
- Treat native transcript locators and repository paths as sensitive metadata.
- Keep host launch arguments structured; do not build commands through shell
  string concatenation.
- Require explicit authority for auto-mode mutations.
- Keep agent-supplied labels and descriptions untrusted at rendering and command
  seams.
- Do not execute instructions embedded in observed terminal output.
- Do not automatically merge, delete worktrees or archive goals.

Implementation and fixtures must remain clean-room: no employer code,
confidential information, customer data, internal designs, credentials, work
accounts or proprietary session transcripts.

## Failure handling

- Host unavailable: preserve the universe and mark host observations stale.
- Adapter crash: restart independently; do not corrupt accepted state.
- Duplicate discovery: reconcile by host plus native identifier, then provider
  identity where available.
- Missing transcript: keep the locator and display unavailable rather than
  deleting the session.
- Stale agent report: show source and age; a fresher deterministic host fact may
  supersede runtime state.
- Launch succeeds but assignment fails: retain the discovered session in the
  inbox and report the partial result.
- Assignment succeeds but launch fails: do not leave a phantom live session;
  preserve the failed launch event for inspection.
- Renderer disconnect: hosted sessions and the control plane continue running.

## Testing strategy

### Replay fixtures

Use synthetic or sanitised fixtures representing at least:

- 20–30 mixed active and idle sessions;
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

Every session-host adapter runs the same contract suite for snapshot,
reconciliation, watch recovery, access capability reporting, attachment targets
and each interaction it claims to support. Provider adapters run shared tests
for recognition, missing metadata, stale locators and malformed native state.

### End-to-end tests

The v0 live Herdr slice should demonstrate:

1. discover existing vanilla sessions into an unassigned inbox;
2. create a goal and assign a session directly to it;
3. rename and reprioritise the goal;
4. restart AO and recover the accepted organisation;
5. surface an explainable blocked or waiting attention signal;
6. find a goal or session by name;
7. inspect session execution metadata without introducing infrastructure nodes;
8. focus or attach to the real hosted session; and
9. complete and archive a goal only through an explicit human action.

## Delivery sequence

### Phase 0 — rendering discovery (complete)

- OpenTUI proved viable for a portable native spatial universe client.
- Spatial, enhanced-graphics and ANSI-raster experiments did not justify a
  custom graphical terminal renderer.
- Native TUI owns the first spatial product proof; a later web observatory may
  provide higher visual fidelity over the same semantic model.

### Phase 1 — live Herdr walking slice

- Implement only the Universe, Attention, Projection and SQLite behaviour needed
  by the v0 workflow.
- Add Herdr snapshot discovery and focus/attachment through the Session-host
  interface.
- Build the native goal-centred universe map, direct session satellites,
  unassigned inbox, inspector, supporting list lens and search.
- Keep the process in-process; do not add a daemon solely for this slice.
- Dogfood with real sessions before broadening the model.

### Phase 2 — live-state hardening

- Add Herdr watch/reconciliation and stale-host recovery.
- Add the minimum provider recognition needed for reliable attention signals.
- Add Git/worktree inspection as session metadata and conflict warnings.
- Run the one-week test with at least 15 real recognized agent sessions; do not
  count shell-only panes, tabs or workspaces as sessions.

### Phase 3 — interaction and agent integration

- Run the [native terminal surface POCs](../specs/terminal-surface-pocs.md):
  first an AO-owned Bun PTY for renderer fidelity, then a Herdr-backed control
  stream for durable-session behaviour.
- Add targeted quick messages only after exact-target UX is trusted.
- Add CLI commands and an installable skill for agent-created goals, assignment
  and structured reporting.
- Preserve human approval for completion and archive behaviour.
- Introduce the local daemon and control transport when multiple clients or
  agent processes create a real need.

### Phase 4 — local web observatory

- Build the high-fidelity spatial canvas over the accepted control-plane
  projections.
- Add embedded xterm.js sessions only where the host exposes an interactive
  terminal capability.
- Keep the browser client local; do not require Electron.

### Phase 5 — broader hosting

- Add tmux after the Herdr interface has survived real use.
- Evaluate other durable session hosts, including Superlogical, through the
  adapter contract rather than by importing their internal model.
- Add skills and hooks for enhanced reporting.
- Revisit launch, input and lifecycle capabilities.
- Consider an AO-native multiplexer only if existing hosts prevent important
  workflows.

## Decisions deliberately deferred

- Web/canvas rendering library
- Layout algorithm
- Exact local transport framing
- Whether the daemon starts on demand or runs continuously
- Provider-specific metadata mechanisms
- Pull-request provider integrations
- Cross-machine synchronisation
- AO-native multiplexer implementation

## Technical success criteria

- A renderer can be replaced without changing domain or host adapters.
- A session host can be replaced without changing domain or renderers.
- Replay and live Herdr observations produce the same projections.
- Vanilla sessions are useful without AO-specific hooks.
- Enhanced metadata can arrive without restarting or recreating a session.
- Adding an unrelated session does not disrupt the current terminal selection.
- A blocked session inside a collapsed goal reaches the overview with an
  explanation.
- Goal positions remain stable when unrelated sessions are discovered, and
  accepted goal positions survive SQLite restart.
- Type-to-find and attention navigation place a selected result in its owning
  goal context.
- Agent retries do not duplicate goals, sessions or relationships.
- No transcript contents are required to reconstruct the universe after restart.
- The live Herdr adapter can disconnect and reconcile without losing accepted
  state.
- A user can inspect and message one supported session without leaving the map,
  then attach and return without losing local navigation state.

## Open technical questions

- What minimum native facts can be obtained reliably from each vanilla provider?
- Can Herdr attachment be represented portably without leaking pane concepts?
- Does one canonical logical layout work across web and terminal viewports?
- Which attention signals can be derived reliably without hooks?
- How should stale observations expire while preserving historical catch-up?
- What capability model supports host differences without producing a shallow,
  sprawling Session-host interface?
- At what scale does the graph need level-of-detail aggregation beyond one
  visible child layer?
- What is the smallest safe auto-mode policy users will trust?
