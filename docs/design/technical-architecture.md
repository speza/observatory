# Observatory technical architecture

Status: implemented V1 architecture
Updated: 2026-09-02

Related documents:

- [Goal-centred agent orchestration map](agent-orchestration-map.md)
- [Technology decisions](technology-decisions.md)
- [Plugin architecture](plugin-architecture.md)
- [Conversation-first Agent tracking](../specs/conversation-first-agent-tracking.md)
- [Feature roadmap](../specs/observatory-feature-roadmap.md)

## Purpose

Observatory is a local semantic control plane for supervising agent work. It
owns durable human intent, accepted organisation, uncertainty and review
context. Agent providers own conversations; session hosts own processes,
terminals and execution placement.

The architecture is designed around deep modules: each module hides substantial
behaviour behind a small interface. Renderers and adapters exercise the same
interfaces as tests. Host, provider and plugin details meet the control plane at
explicit seams instead of leaking through the model.

## Product invariants

- The durable topology is `System → Goal → Agent`.
- Systems and Goals are human-authored semantic organisation.
- Repositories, worktrees, hosts and terminal containers are Agent metadata,
  never organisational nodes.
- A durable Agent represents an exactly identified provider conversation, not a
  pane, process or inferred workspace match.
- Goal priority, completion, archive and Agent archive remain human-controlled
  unless a future explicit policy says otherwise.
- Missing, stale, partial or conflicting observations remain uncertain. They are
  never promoted into accepted semantic truth.
- Observatory is local-only and single-user. It does not ingest transcripts,
  own agent processes or expose its control plane remotely.
- V1 requires Herdr for live execution, while Universe, persistence, projections
  and renderer interfaces remain independent of Herdr protocol and topology.

## System shape

```text
Browser GUI
    │ projections and human commands
    ▼
Loopback web composition root
    ├── Universe ───────────────► UniverseStore ─► SQLite
    ├── ControlPlaneEventHub ───► ProjectionPublisher ─► renderer SSE
    ├── Projection / Attention / Spatial
    ├── ConversationTracker ────► AgentHarness plugins
    ├── AgentObservationModule ─► observation-source plugins
    ├── StartAgentCoordinator ──► WorkspaceProvider
    ├── RepositoryStatusReader ─► code-host plugins
    └── SessionHost ────────────► Herdr adapter
```

The composition root in `src/web/` is the imperative edge. It runs Effects,
polls external capabilities, coordinates modules and serves the React client.
Each remaining source polling loop is serialized and each process-backed
observation has a deadline, so a slow refresh cannot accumulate overlapping
work. The closed process-local `ControlPlaneEventHub` carries committed change
notifications to a batched `ProjectionPublisher`; the browser receives complete
revisioned projections over SSE instead of polling. The browser never imports
persistence, the mutable Universe or concrete host adapters.

## Module ownership

### `universe/`

`Universe` is the only writer of trusted Observatory state. Its interface
accepts typed commands and typed observations. It owns:

- Systems, Goals and conversation-backed Agents;
- assignment, priority, completion, archive and accepted Goal position;
- provider continuity and execution-presence invariants;
- host reconciliation and identity conflict handling;
- durable semantic changes and the operator catch-up checkpoint; and
- atomic persistence through `UniverseStore`.

A failed command or save restores the previous state. Callers do not mutate
records directly or write the store around Universe commands.

### `persistence/`

`UniverseStore` is synchronous and Effect-free. The SQLite adapter stores the
current clean-break schema and atomic Universe snapshots. It also implements
narrow stores used by conversation tracking, launch receipts and provider
observations.

Schema compatibility is explicit: an incompatible experimental database is
reset rather than silently guessed into the current model.

### `hosts/`

`SessionHost` is the only execution-host seam. Its interface is capability-based
and deliberately smaller than any concrete host protocol. It supports:

- complete or partial execution snapshots;
- structured process launch plans;
- per-Agent access capabilities;
- activation or native handoff;
- close with target revalidation;
- host-owned terminal streams; and
- transient linked execution terminals.

Identifiers and targets remain opaque outside the adapter. Herdr protocol
names, workspace/tab/pane concepts and lifecycle rules stay in `hosts/herdr/`.
The mock adapter satisfies the same contract and is the deterministic evidence
path for core and browser tests.

Host work returns typed Effects. Terminal output is an Effect Stream. Core
state, persistence records, projections and spatial calculations remain
Effect-free.

### `plugins/` and `plugin-sdk/`

The plugin registry loads explicitly configured local packages and reports
bounded health diagnostics. Plugins contribute narrow capabilities such as:

- `agent-harness` discovery and start/resume planning;
- metadata-only provider observation sources; and
- code-host repository facts.

Plugins never write SQLite, mutate the Universe or bypass commands. Harness
plugins describe provider lifecycle; they do not own process placement. A
provider capability and a host capability meet only in a coordinator that
understands both typed interfaces.

### `conversations/`

`ConversationTracker` ingests provider catalogues through harness plugins. It
owns supporting Conversation history and submits provider facts to Universe
without granting them admission authority:

- catalogue entries remain history until explicitly added;
- host liveness and recency do not admit an entry;
- aliases are canonicalised only with provider proof; and
- unavailable or incomplete catalogues cannot prove absence.

Only `AddConversation` and a proven Observatory-managed new launch create a
durable Agent. Admission provenance is explicit: catalogue admission carries
scoped provider evidence, while managed-launch admission may begin with an
unscoped host reference and must not fabricate provider freshness or naming.
Exact resume requires an Agent that already exists.

Universe owns admitted-reference resolution. Conversation history, provider
observation correlation and launch coordination ask Universe to resolve an
identity rather than reimplementing scope matching. A scoped provider reference
may enrich one compatible unscoped managed launch only when no conflicting
scope exists.

### `agent-observations/`

`AgentObservationModule` stores bounded metadata-only activity, human-input,
turn-outcome and context-pressure claims. It correlates observations by exact
conversation identity, preserves source and freshness, and enriches projections
without changing accepted semantic state.

Evidence authority remains split by claim axis:

| Claim                                                               | Evidence owner                        | Cannot establish                                          |
| ------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| Execution presence, location, runtime state and terminal capability | `SessionHost`                         | Provider outcome or accepted completion                   |
| Human-input request, provider turn outcome and context pressure     | `AgentHarness` observation source     | Execution presence, Agent admission or semantic lifecycle |
| Agent identity, Goal assignment, priority, completion and archive   | Universe commands and human decisions | Fresh external runtime facts                              |

A provider claim may explain or conflict with host state, but does not replace
it. Missing or conflicting evidence stays explicit, and target-sensitive
operations obtain their own fresh host revalidation.

Raw provider events, prompts, responses and transcript paths are not retained.

### `session-launch/` and `workspaces/`

`StartAgentCoordinator` turns one start or exact-resume intent into a durable,
idempotent operation. It coordinates:

1. workspace validation or preparation;
2. provider plan construction through an AgentHarness;
3. process placement through `SessionHost`;
4. canonical host/provider reconciliation; and
5. Goal assignment after exact Agent identity exists.

Launch receipts prevent ordinary retries from creating duplicate processes.
A pending launch is visible but is not a phantom Agent. Workspace inspection is
bounded and read-only; browser callers provide trusted Agent IDs rather than
filesystem paths for diff review.

### `agent-closeout/`

The closeout coordinator orders host and semantic lifecycle safely:

1. resolve current Agent access;
2. revalidate and close the exact host execution;
3. reconcile a fresh canonical host observation; and
4. archive through a Universe command.

It fails closed on missing, partial, reused or conflicting targets. A live close
request never degrades silently into local archive.

### `attention/`, `projection/` and `spatial/`

These modules are deterministic, Effect-free views over trusted state and typed
observations.

- Attention composes independent claims into one decision subject per Agent.
- Projection builds Atlas, Ledger, Inbox, Needs-you, Catch up, search and
  inspector views.
- Spatial assigns deterministic Goal anchors and Agent satellites, repairs only
  unpinned collisions and keeps viewport state outside persistence.

Renderers consume projections; they do not reproduce domain rules.

### `repositories/`

`AgentRepositoryStatusReader` resolves bounded local Git facts from the selected
Agent's trusted workspace metadata. Optional code-host plugins add pull-request
and check evidence. Ambiguous associations remain ambiguous; no candidate is
silently selected.

### `web/` and `web/src/`

`src/web/` composes the application and exposes a narrow same-origin loopback
interface. Browser requests must use the configured loopback authority and a
matching Origin, so DNS rebinding cannot turn read endpoints into a cross-origin
data channel. Browser mutation additionally requires JSON, an explicit command
header and an allow-list of commands. The provider-observation ingress is a
separate POST-only, size-bounded interface authenticated by a user-owned bearer
token; it accepts no browser credentials or CORS. Host-backed launch,
closeout and terminal actions use separate typed gateways rather than pretending
they are synchronous Universe commands.

The `ProjectionPublisher` subscribes to typed post-persistence events from
Universe and the provider-observation and launch coordinators. It batches
concurrent changes, derives each affected portfolio once, and fans cached
complete replacements to bounded SSE subscribers. Initial and reconnect
snapshots repair missed process-local events. Projection schemas remain
transport-neutral and renderers do not replay domain events.

`web/src/` owns presentation-only state: selection, viewport, zoom, active lens,
theme, dialogs and terminal tabs. It renders native SVG/CSS and xterm.js. It
never reads SQLite or concrete host/provider protocols.

## Identity and reconciliation

Provider conversation identity and host execution identity are independent.
Observations can arrive provider-first or host-first and must converge to the
same Agent only when exact evidence proves the join.

```text
Provider catalogue ──► exact conversation ref ──┐
                                                  ├─► Universe observation
Host snapshot ───────► execution + exact ref ────┘
```

Cwd, repository, title, recency and plausible process location are supporting
facts only. They may block an unsafe resume but never establish identity or
inherit a Goal.

A complete fresh snapshot can prove execution absence for one host instance. A
partial snapshot, transport failure or stale last-known state cannot. Provider
absence likewise requires a complete catalogue for the relevant continuity
scope.

## Main flows

### Reconciliation

1. Poll the selected SessionHost through a serialized, deadline-bounded refresh loop.
2. Enrich host observations with exact harness evidence where available.
3. Refresh provider catalogues at startup or on explicit history requests.
4. Receive ephemeral provider hook events through the owning harness and
   immediately reconcile its bounded observation snapshot.
5. Submit typed host and catalogue observations to Universe; provider evidence
   remains in its separate operational store.
6. Persist accepted state atomically, then publish an authority-specific typed
   event.
7. Batch concurrent events and derive each affected renderer projection once.
8. Deliver revisioned complete snapshots or replacements to renderers over SSE;
   repair reconnects with current snapshots.

Out-of-order observations are ignored without regressing accepted state.

### Terminal access

The browser requests access for a selected Agent. The host returns an opaque,
fingerprinted target and proven capabilities. The server opens a host-owned
terminal stream, bounds dimensions and input, and relays frames over loopback.
Release detaches the browser; it does not terminate the Agent.

Scrolling is a host viewport action, not fabricated keyboard input. Unsupported
handoff or linked-terminal capabilities remain explicit.

### Catch up

Universe records semantic changes with a monotonic sequence. Projection groups
changes since the durable operator checkpoint by System, Goal or Inbox. Only
explicit acknowledgement advances the checkpoint; projection delivery does not.
Retention and compaction of acknowledged history remain an explicit post-V1
decision; the current clean-break store does not yet bound that table.

## Persistence

Persisted semantic state includes Systems, Goals, Agents, assignments, accepted
Goal positions, identity evidence, host observations, semantic changes and the
operator checkpoint.

Renderer-local selection, hover, viewport, zoom, open dialogs and terminal tabs
are not persisted in SQLite. Versioned browser preferences may use local
storage, but they do not become trusted Observatory state.

## Security and privacy

- Bind only to loopback; reject foreign browser authorities/origins and require
  the separate bearer token for provider-observation ingress.
- Keep the local database and provider-observation delivery token user-owned.
- Never ingest transcripts by default.
- Do not expose transcript paths or provider aliases to browser projections.
- Bound process output and deadlines, terminal dimensions, diffs, search results
  and plugin diagnostics.
- Build commands from structured arguments rather than shell strings.
- Treat observed labels and terminal output as untrusted data.
- Never execute instructions embedded in observations.
- Keep fixtures synthetic or sanitised.
- Do not automatically merge, complete Goals, archive Agents or delete
  worktrees.

## Testing strategy

- Universe invariants are tested through the Universe interface with a memory
  store and controlled clock.
- SQLite tests exercise the same store contract and restart behaviour.
- Every production SessionHost adapter runs the shared host contract suite.
- Mock host scenarios prove healthy, degraded, unavailable and recovered paths
  without Herdr.
- Harness and plugin tests use synthetic packages and bounded process runners.
- Projection, attention and spatial tests are deterministic.
- Browser seam tests prevent imports from persistence, host adapters or the
  mutable Universe.
- Web tests exercise command, launch, closeout, repository, search and terminal
  gateways through their public interfaces.
- Live Herdr smoke paths use disposable Agents only.

## Dependency rule

The intended dependency direction is:

```text
renderer → web gateways → coordinators → module interfaces
                                      ├─► Universe
                                      ├─► plugins
                                      ├─► WorkspaceProvider
                                      └─► SessionHost

Universe → UniverseStore interface
adapters → the interfaces they satisfy
```

A future host, provider integration or renderer must not require changes to
Universe records merely to expose its native concepts. If an integration needs
that leakage, repair the seam before adding the integration.

## Explicit non-goals

The current architecture does not include:

- a daemon, remote control plane or host-local edge collector;
- an Observatory-owned multiplexer, process runtime or PTY;
- transcript ingestion or universal provider chat;
- repositories, worktrees or hosts as organisational topology;
- automatic Goal completion, acceptance, merge or archive;
- distributed host aggregation; or
- a second maintained interactive client.
