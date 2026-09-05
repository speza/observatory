# Observatory technical architecture

Status: implemented V1 architecture
Updated: 2026-09-03

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

`save(state)` remains an authoritative full snapshot, not an append-only command:
new semantic events are appended without touching their prefix, but explicit
record edits (including an existing sequence), omitted records and cleared
optional values must also persist. The adapter compares normalized SQL bindings
for all seven semantic tables and replaces only changed rows (delete + insert),
inserting new rows and deleting actual omissions. Unchanged rows have no SQLite
mutations. There is no implicit history retention or compaction policy.

An immediate transaction keeps comparison and writes on one database revision.
Foreign-key checks are deferred during row replacement, then explicitly checked
before completion; changed execution identities are all removed before insertion
so valid swaps satisfy the unique index. Assignments, dismissals, semantic history
and the semantic checkpoint still commit or roll back together. Provider
catalogues, observations, their checkpoint and launch receipts retain separate
ownership and are not included in semantic snapshot writes.

The adapter caches committed SQL bindings, never caller-owned domain objects.
`total_changes()` and `data_version` invalidate this cache after same-connection
writes (including reset or failed writes) or another connection's commit. Cache
publication follows successful commit only; saves inside a caller-owned outer
transaction discard the cache because that transaction may still roll back.
Restart reconstructs bindings from SQLite on the first save. This optimizes disk
writes, not the Universe history representation: each save still scans and builds
bindings for the full history, with O(history) time and memory; cache invalidation
also requires reading stored rows. Provider writes conservatively invalidate the
semantic cache too.

`bun run scripts/benchmark-sqlite-save.ts` measures synthetic, file-backed,
identical one-Goal snapshots at 0/10k/100k retained events. It seeds outside the
measurement and reports five individual `performance.now()` durations, their
median, and SQLite `total_changes()` deltas without triggers. These are store
measurements, not observed live terminal latency. Regression tests use mutation
counts and prefix-protection triggers rather than timing thresholds.

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
bounded and read-only. The multi-pane review path resolves trusted Agent
worktrees server-side, issues process-local snapshot and file handles, and
provides bounded repository indexing, source/baseline reads and diffs without
accepting browser filesystem paths.

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

Portfolio assembly builds Command Centre once and derives the base Map from
that view. Provider evidence is fused once into Command Centre; Map reuses its
enriched Agent views, attention and counts while retaining base spatial order
and positions. Catch-up retains its own historical selection and base attention
evaluation, then consumes the enriched Command Centre for provider evidence.

The command-centre projection retains archived Goals as context containers only
for unresolved execution exceptions (live, conflict, or unknown with a retained
execution reference), including archived Agents. Atlas, code-context lenses,
System aggregates and renderer selection all consume that same Goal/Agent
shape. Confirmed absence removes the exception; missing observations do not.
Attention composes the archived-running lifecycle claim with blocked/waiting or
runtime-complete evidence, and exposes uncertainty as Monitor rather than live
work. Archive status and assignment are never rewritten to make work visible;
terminal access still requires fresh SessionHost validation. This is a derived
visibility policy, not a durable schema or host-protocol change.

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
closeout and terminal actions use separate typed endpoints rather than pretending
they are synchronous Universe commands. The closeout endpoint decodes its bounded
request and runs the closeout coordinator's Effect directly at the HTTP edge;
launch and terminal gateways own their additional transport behavior.

The `ProjectionPublisher` subscribes to typed post-persistence events from
Universe and the provider-observation and launch coordinators. It batches
concurrent changes, derives each affected portfolio once, and fans cached
complete replacements to bounded SSE subscribers. Initial and reconnect
snapshots repair missed process-local events. Projection schemas remain
transport-neutral and renderers do not replay domain events.

The browser uses the SSE snapshot as its primary bootstrap rather than issuing
parallel REST bootstrap requests. A five-second bootstrap deadline, stream
errors and malformed events trigger REST recovery, limited to once per thirty
seconds. Disconnected streams and incomplete baselines also receive periodic
recovery attempts. Partial events do not cancel baseline recovery; REST fills
missing state without replacing newer pending-launch events or portfolio data.
HTTP portfolio reads and all mutation replies containing portfolios use the same
publisher epoch/revision as SSE. A synchronous capture refreshes both portfolio
and pending launches, publishes the complete baseline and returns its cursor;
failed capture returns an error, never stale state stamped with a new revision.
Generation timestamps are display facts, not ordering keys. The browser tracks
revision independently for each replacement slice, so an older complete baseline
can fill a missing slice without overwriting a newer partial replacement.

SSE and guarded REST recovery can establish a new process epoch. This clears both
slices, invalidates in-flight recovery and retires the previous epoch; late
responses cannot return to it. Every accepted epoch adoption, including the first
baseline, synchronously advances a shared transport generation, aborts old REST
requests and closes/replaces EventSource. Superseded SSE callbacks are inert before
decoding or recovery bookkeeping, including snapshots from epochs never previously
observed. Same-epoch updates neither rotate streams nor abort baseline recovery.
This fencing assumes the single-authority loopback restart topology: newly opened
transports reach the current process. Overlapping live replicas would require
authoritative incarnation fencing instead of opaque process UUIDs.

Mutation replies cannot switch an established epoch (opaque UUIDs have no
chronological ordering); reconnect/recovery supplies
the new baseline instead. Request abort and generation checks protect recovery
across epoch changes and unmount, while same-epoch partial updates do not cancel
baseline recovery. Equal revisions are duplicates, regardless of timestamps.

`usePortfolio` is the sole browser owner of pending launches. Launch replies
reconcile their complete, revisioned pending list through the same path rather
than inserting the individual operation result. Late replies therefore cannot
resurrect a resolved launch. App owns only dismissed IDs and terminal/dialog
presentation. The standalone pending-launch endpoint remains an operation query,
not a source for browser portfolio reconciliation.

`web/src/` owns presentation-only state: selection, viewport, zoom, active lens,
theme, dialogs and terminal tabs. It renders native SVG/CSS and xterm.js. It
never reads SQLite or concrete host/provider protocols.

`App` retains navigation, selection and layout orchestration. Search query,
results and request cancellation belong to `search/useSearch`; inspector
projection loading, selection resets and affected-subject invalidation belong
to `inspector/useInspector`. Commands and retry actions explicitly refresh the
inspector through the hook, retaining its last projection during refresh.

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

### Workspace review

The browser opens a review by accepted Agent ID. The server resolves its trusted
worktree and returns a bounded tracked/non-ignored file index, working-tree diff
and opaque process-local handles. Diff views use the hunks already in that
snapshot; only Source and Baseline require selected-file reads. Those reads
revalidate the Agent worktree and review revision; source reads validate and
consume the same file descriptor and recheck the revision afterward. Concurrent
changes therefore become stale rather than mixing observations. A truncated
diff yields partial review evidence without invalidating safe file capabilities.
Source and diff content remains ephemeral and is excluded from SQLite,
projections and diagnostics.

The renderer coordinates Changes, Files, Evidence and Terminal panes through a
discriminated presentation state while keeping repository and file identity out
of durable topology. Collapsed changes defer syntax and diff construction, and
only the active layout is built. Terminal context continues through the
independent `SessionHost` gateway.

### Terminal access

The browser requests access for a selected Agent. The host returns an opaque,
fingerprinted target and proven capabilities. The server opens a host-owned
terminal stream, bounds dimensions and input, and relays ordered input and
frames over one origin-checked loopback WebSocket. Release detaches the browser;
it does not terminate the Agent.

Scrolling is a host viewport action, not fabricated keyboard input. Unsupported
handoff or linked-terminal capabilities remain explicit.

### Catch up

Universe records semantic changes with a monotonic sequence. Projection groups
changes since the durable operator checkpoint by System, Goal or Inbox. Only
explicit acknowledgement advances the checkpoint; projection delivery does not.
Agent trajectory summaries consult typed current Agent state before interpreting
a generic `changed` transition as recovery. Renames, descriptions and assignments
cannot resolve blocked/waiting or uncertain observations. Current lifecycle
attention comes from the shared attention evaluator, so an archive marker cannot
turn a later metadata change into a finished summary while execution remains
unresolved. The durable historical transitions are not rewritten and display
strings are never semantic evidence.

Catch-up projections carry independent `throughSequence` (Universe) and
`evidenceThroughSequence` (provider observations) boundaries. The browser sends
both from the projection it rendered. The web composition root validates the
provider boundary before submitting the semantic command, then acknowledges each
stream through its owning module. Boundaries must be non-negative safe integers
no higher than the available stream boundary. Checkpoints advance monotonically;
older requests and retries preserve the checkpoint timestamp and leave newer
changes unread. Provider deletion is restricted to the acknowledged prefix and
does not delete current evidence. Both checkpoints use existing SQLite records.

The two writes remain independent: a provider save failure after semantic success
is reported explicitly, and retrying the same boundaries safely completes the
provider acknowledgement without swallowing later semantic or provider changes.
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
