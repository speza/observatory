# Control-plane events and browser projection delivery

Status: initial snapshot/replacement delivery implemented; live measurement pending

Date: 2026-09-02

Depends on:

- [Observatory technical architecture](../design/technical-architecture.md)
- [Observatory polling analysis](../polling-analysis.md)
- [Observatory polling solutions](../polling-solutions.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)

## Implementation status

The initial implementation now includes the closed process-local event hub,
post-persistence Universe/provider/launch publication, 250 ms server-side
batching, cached portfolio and pending-launch projections, bounded SSE
subscribers, a 500-subject aggregate bound with conservative overflow repair,
a 5 MiB serialized-event limit, failure-atomic projection replacement,
epoch/revision ordering, complete reconnect snapshots, a 30-second subscriber-only
time-derived refresh, and disconnected-browser HTTP recovery.

Complete projection replacements remain the supported protocol. Deltas,
persisted event replay, multi-process fan-out and plugin publication remain
explicitly deferred. The implementation uses one routine batching lane; a second
interactive lane should be added only if measured latency requires it.

## Purpose

Introduce a typed event architecture for committed Observatory changes, then use
those events to maintain and deliver browser projections without two-second
browser polling.

The design must handle frequent and concurrent changes without turning React
into a second domain model, without treating provider hooks as execution truth,
and without requiring durable replay of high-volume operational observations.

## Problem

Observatory currently obtains and mutates state through several independent
authorities:

- human commands change accepted semantic state in Universe;
- SessionHost snapshots change accepted execution evidence in Universe;
- AgentHarness observations change provider-native operational evidence;
- launch coordination changes durable pending-launch receipts; and
- time changes the freshness of already retained evidence.

The browser discovers the resulting projection changes by repeatedly fetching
the complete portfolio and pending-launch state every two seconds.

A resource-invalidation channel would reduce those requests, but it starts at
the renderer and works backwards: producers would need to know that a change
invalidates `portfolio`, `pending-launches` or another browser resource. That is
a shallow interface and the wrong dependency direction.

Sending raw domain events directly to React is also wrong. One Agent change may
affect its card, Goal aggregates, attention ordering, Catch up and Atlas
placement. Applying domain events in the browser would duplicate projection and
reconciliation rules.

The missing layer is a server-side event and projection pipeline:

```text
committed semantic and operational changes
                  │
                  ▼
          typed control-plane events
                  │
                  ▼
           ProjectionPublisher
       - batch and order events
       - rebuild affected projections
       - retain current projection state
       - assign projection revisions
                  │
                  ▼
      snapshot + projection update stream
                  │
                  ▼
                React
```

## Goals

- Represent committed semantic and operational changes as typed events owned by
  the module that knows the change occurred.
- Preserve the different authority and durability of semantic, execution,
  provider and launch changes.
- Publish events only after the owning state write succeeds.
- Batch frequent or concurrent events before projection work.
- Compute each affected projection at most once per publication batch.
- Compute shared projections once for all connected browser tabs.
- Deliver complete projection replacements initially; add deltas only where
  identity and application rules are demonstrably safe.
- Recover from stream loss, subscriber lag and server restart through current
  snapshots.
- Remove the browser's portfolio and pending-launch two-second timers.
- Keep Universe, SessionHost, plugins and persistence independent of browser
  transport.

## Non-goals

- Converting Universe to event sourcing.
- Persisting every host or provider transition as a domain event log.
- Exposing raw Herdr, provider-hook or plugin events to subscribers.
- Allowing plugins to publish arbitrary events onto a global bus.
- Reimplementing projection logic in React.
- Guaranteeing delivery of every operational event to every browser.
- Replacing SessionHost snapshots or sensitive operation-specific revalidation.
- Adding Kafka, Redis, a daemon or distributed pub/sub infrastructure.
- Making Catch up a complete operational audit log.

## External precedent

A current source review of the closest products shows a consistent hybrid rather
than one universal event strategy.

### Conductor OSS

Conductor's general SSE path sends an initial full snapshot and subsequent
broadcast snapshots. A lagged receiver gets an explicit `refresh` event. Its
more specialised dispatcher stream uses typed deltas when safe and falls back
to a full replacement when identity or ordering is ambiguous. Its board listens
to relevant SSE events and performs a debounced reload.

### Superset

Superset exposes one typed host-service WebSocket bus. Some events are
state-bearing (`workspace:changed`, `port:changed`), some are lifecycle events
(`agent:lifecycle`, `terminal:lifecycle`), and some are explicitly
invalidation-only (`git:changed`, `agent:bindings-changed`). Filesystem and Git
churn is batched before publication. Consumers choose patch or refetch according
to the event contract.

### Orca

Orca uses typed runtime subscription methods, structured Agent-session streams,
coalescers, snapshot recovery and central renderer stores. It can sustain this
larger interface because it owns the runtime and remote synchronization layer.

### Nimbalyst

Nimbalyst centralises Electron IPC listeners and updates narrow Jotai atom
families. Its renderer guidance explicitly avoids one coarse root subscription
that causes every change to rerender every session.

### Agenttrail

Agenttrail sends an initial full SSE model, partial activity updates, and
throttles hook-driven publication. It retains polling for broader world
discovery and fallback.

The useful pattern for Observatory is therefore:

```text
typed source events + current snapshots + selective projection updates
                     + explicit snapshot repair
```

## Vocabulary

### Domain event

A past-tense fact about a successful semantic state transition owned by
Universe, such as a Goal changing lifecycle or an Agent changing assignment.
Semantic domain events may reference the existing durable `UniverseChange`
sequence.

### Operational event

A past-tense fact about successfully accepted external or coordination evidence,
such as execution evidence changing, provider evidence changing or a pending
launch changing. Operational events are recoverable from current snapshots or
durable receipts and do not have semantic authority.

### Control-plane event

The closed union of Observatory-owned domain and operational events consumed by
the projection pipeline. It is not a claim that all members have equal authority
or durability.

### Projection update

A renderer-facing replacement or, later, a safe delta produced from current
trusted state. Projection updates are not domain events.

## Authority and durability

| Event family       | Owner                      | Authority                                   | Recovery                                                          |
| ------------------ | -------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Semantic           | Universe                   | Accepted human semantic state               | SQLite Universe state and change sequence                         |
| Execution evidence | Universe after SessionHost | Presence, runtime, placement and host state | Fresh complete SessionHost snapshot                               |
| Provider evidence  | AgentObservationModule     | Provider activity/input/outcome evidence    | Current retained evidence; missed ephemeral events remain unknown |
| Launch operation   | StartAgentCoordinator      | Launch receipt and pending-operation state  | Durable launch receipts                                           |

Transport does not alter this table. In particular, receiving or publishing a
provider event never admits an Agent, proves execution presence, completes a Goal
or archives anything.

## Event model

Use a closed discriminated union. Event names are past tense and describe the
accepted change, not the command or external message that attempted it.

```ts
interface ControlPlaneEventBase {
  readonly occurredAt: number;
  readonly cause:
    "human-command" | "host-observation" | "provider-observation" | "launch-operation";
}

type UnsequencedControlPlaneEvent =
  | (ControlPlaneEventBase & {
      readonly type: "system-changed";
      readonly systemIds: readonly SystemId[];
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "goal-changed";
      readonly goalIds: readonly GoalId[];
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "agent-changed";
      readonly agentIds: readonly AgentId[];
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "execution-evidence-changed";
      readonly agentIds: readonly AgentId[];
      readonly hostInstanceIds: readonly string[];
      readonly availabilityChanged: boolean;
    })
  | (ControlPlaneEventBase & {
      readonly type: "provider-evidence-changed";
      readonly agentIds: readonly AgentId[];
      readonly kinds: readonly AgentObservationKind[];
    })
  | (ControlPlaneEventBase & {
      readonly type: "pending-launch-changed";
      readonly requestIds: readonly string[];
    });

interface ControlPlaneEvent extends UnsequencedControlPlaneEvent {
  readonly epoch: string;
  readonly sequence: number;
}
```

The exact TypeScript representation may use intersections or variant-specific
interfaces. The behavioral contract matters more than the syntax.

### Why these events are intentionally bounded

Events contain stable Observatory IDs and classifications needed to select and
explain projection work. They do not contain:

- complete Systems, Goals or Agents;
- native host targets or Herdr topology;
- provider session identifiers;
- prompts, responses or raw hook payloads;
- terminal data;
- arbitrary plugin extension payloads; or
- browser resource names.

A consumer needing current state reads it from the owning module. This prevents
events becoming an accidental second source of truth.

### Event granularity

The initial union is entity- and authority-granular, not command-granular.
`goal-changed` covers title, priority, lifecycle, assignment-driven aggregate
and position changes because the projection pipeline currently responds to all
of them in the same way.

Add a narrower event only when a real consumer can avoid meaningful work or
express different behavior. Do not mirror every Universe command into a public
event type speculatively.

## Publication rules

1. Publish only after validation and persistence succeed.
2. Failed, rejected or rolled-back operations publish nothing.
3. A successful no-op publishes nothing.
4. One logical transaction publishes one batch containing all affected subjects.
5. IDs in one event are unique, sorted and bounded.
6. Events report accepted Observatory identity, never unresolved external identity.
7. Raw host/provider events are translated before this seam.
8. Listener failure cannot roll back committed state or fail another listener.
9. Publication is synchronous into bounded process-local storage; projection
   calculation happens asynchronously after publication.
10. Publishers cannot choose browser projections or transport behavior.

## ControlPlaneEventHub

Add a deep in-process module under `src/control-plane-events/`. Separate publisher
and consumer roles at its interface:

```ts
interface ControlPlaneEventSink {
  publish(events: readonly UnsequencedControlPlaneEvent[]): void;
}

interface ControlPlaneEventSource {
  cursor(): { readonly epoch: string; readonly sequence: number };
  subscribe(listener: (events: readonly ControlPlaneEvent[]) => void): () => void;
}
```

One implementation satisfies both roles. It owns:

- a random process epoch;
- monotonic sequence assignment;
- validation and per-batch normalization;
- listener isolation;
- reentrant publication ordering; and
- bounded diagnostics.

It does not own state persistence, event durability, projection calculation or
network transport.

The hub is a closed control-plane mechanism, not a plugin interface. Plugins,
SessionHost adapters and browser code cannot obtain its sink. Universe and the
coordinators receive the sink at construction through the composition root.
Tests use a recording sink or the real in-memory hub.

### Concurrency and reentrancy

`publish()` contains no await point. JavaScript run-to-completion assigns one
global process order even when asynchronous operations settle close together.
If a listener causes another publication, the hub queues that batch until the
current listener pass completes rather than recursively interleaving it.

The hub does not coalesce events. It preserves committed event meaning and lets
each consumer choose its own batching policy.

### No durable replay requirement

A subscriber first reads current module snapshots, then subscribes using the
current hub cursor. If it misses an in-process event during startup, its final
snapshot/cursor check detects the race and repeats the snapshot. Browser
reconnect never replays the control-plane event stream; it receives current
projection state.

Semantic Catch up continues using durable `UniverseChange` records. Do not
replace them with this process-local hub.

## Event production by owning modules

### Universe

Universe emits events after its atomic store save succeeds.

- Human commands emit `system-changed`, `goal-changed` and/or `agent-changed`.
- Host reconciliation emits `execution-evidence-changed` only when
  projection-relevant execution or host health changes.
- Provider-catalogue reconciliation that enriches an admitted Agent emits
  `agent-changed`.
- Repeated observations that only advance acquisition timestamps do not emit a
  browser-driving event.

Universe already computes affected IDs and durable semantic changes. Event
construction belongs inside Universe so callers do not compare snapshots or
reverse-engineer commands.

### AgentObservationModule

The observation store already reports whether reconciliation changed retained
evidence. The coordinator resolves admitted Agent IDs and emits one
`provider-evidence-changed` batch after all changed snapshots have been stored.
Untracked provider evidence continues to produce no retained state and no event.

### StartAgentCoordinator

The coordinator emits `pending-launch-changed` after reserving, updating,
completing or failing a durable launch receipt when the pending view actually
changes. If launch completion also admits or updates an Agent, Universe emits the
corresponding Agent event independently.

### ConversationTracker

Conversation history refresh does not emit a portfolio event merely because a
dormant catalogue entry changed. Explicit admission and admitted-Agent
enrichment flow through Universe and produce Universe events. If live
Conversation history delivery becomes a requirement, add a tracker-owned event
then; do not overload Agent events now.

## ProjectionPublisher

Add a server-side `ProjectionPublisher` under `src/web/` that consumes
`ControlPlaneEventSource` and owns browser-facing current projection state.

```ts
interface ProjectionPublisher {
  current(): BrowserProjectionSnapshot;
  stream(request: Request): Response;
  refreshTimeDerivedState(): void;
  close(): void;
}
```

Its implementation hides:

- event batching and dependency mapping;
- projection calculation;
- serialized JSON caching;
- projection revision assignment;
- SSE subscribers and heartbeats;
- slow-subscriber handling; and
- process shutdown cleanup.

`current()` and the first stream event return the same current projection model.
Tests and HTTP delivery use this interface rather than reading its queues or
timers.

### Current browser projection state

```ts
interface BrowserProjectionSnapshot {
  readonly epoch: string;
  readonly revision: number;
  readonly generatedAt: number;
  readonly portfolio: PortfolioResponse;
  readonly pendingLaunches: readonly WebPendingLaunch[];
}
```

The projection epoch is process-local and may reuse the control-plane epoch. The
revision increases only when the published browser projection state changes.
It is not the Universe schema version or semantic change sequence.

### Event-to-projection dependencies

The mapping lives inside `ProjectionPublisher`, not in event producers.
Initially:

| Event                        | Recompute portfolio             | Recompute pending launches | Affected inspector subjects |
| ---------------------------- | ------------------------------- | -------------------------- | --------------------------- |
| `system-changed`             | yes                             | no                         | matching Systems            |
| `goal-changed`               | yes                             | no                         | matching Goals              |
| `agent-changed`              | yes                             | maybe                      | matching Agents             |
| `execution-evidence-changed` | yes                             | maybe                      | matching Agents             |
| `provider-evidence-changed`  | yes                             | no                         | matching Agents             |
| `pending-launch-changed`     | no unless paired Universe event | yes                        | none                        |

This table is implementation knowledge behind the projection interface. A new
renderer projection changes this module rather than every producer.

## Projection batching

The publisher maintains two scheduling lanes.

### Interactive lane

Human commands, pending-launch transitions, human-input evidence and host
availability changes enter a non-resetting 50 ms window. The first event starts
the timer; later events join the batch without resetting it. Continuous input
cannot postpone publication indefinitely.

### Activity lane

Routine provider activity and repeated runtime transitions enter a
non-resetting 250 ms window. This caps projection reconstruction and browser
publication at four batches per second during sustained tool activity.

An interactive event promotes all pending activity into the next interactive
batch. A projection is never calculated concurrently with another projection
calculation; events arriving during calculation form one subsequent batch.

The first implementation may use one 100 ms non-resetting lane if classification
adds disproportionate complexity, but it must retain a hard maximum delay and
must not use an indefinitely reset trailing debounce.

## Projection calculation and caching

For each batch:

1. Union event types and affected IDs.
2. Read current Universe, observation and pending-launch snapshots.
3. Recompute each affected projection once.
4. Reuse unaffected projection values.
5. Assign one new projection revision.
6. Serialize each emitted update once.
7. Fan the cached bytes out to all subscribers.

Projection calculation is process-local and Effect-free. It performs no host,
provider, SQLite or Git acquisition. Ten browser tabs therefore share one
projection calculation and serialization per batch rather than triggering ten
copies.

Initially, every portfolio-affecting batch may rebuild the complete portfolio.
The event metadata preserves a future path to incremental server-side projection
calculation, but incremental materialization is not required until measurement
shows the pure in-memory projection build is material.

## Browser projection protocol

Use SSE because delivery is one-way, the application already serves SSE, and
browser commands remain ordinary authenticated same-origin HTTP requests.

```http
GET /api/projections/events
Accept: text/event-stream
```

### Initial snapshot

Every connection begins with a complete current snapshot:

```text
event: snapshot
id: <epoch>:<revision>
data: { ...BrowserProjectionSnapshot }
```

This removes the connection-before-fetch race and follows the Conductor pattern.
The browser can render from one stream response without separately coordinating
an initial GET.

Retain `GET /api/portfolio` and `GET /api/launch/pending` during migration and as
bounded debugging/fallback reads. They are not the normal recurring delivery
path after rollout.

### Subsequent updates

The initial implementation sends complete replacements for the affected
renderer projection:

```text
event: portfolio-replaced
id: <epoch>:<revision>
data: {
  "epoch": "...",
  "revision": 42,
  "portfolio": { ... },
  "affected": [{ "type": "agent", "id": "agent-1" }],
  "affectedAll": false
}

event: pending-launches-replaced
id: <epoch>:<revision>
data: {
  "epoch": "...",
  "revision": 43,
  "pendingLaunches": [ ... ]
}
```

If both changed in one batch, one `snapshot-replaced` event may carry the full
current browser snapshot. The protocol should prefer one atomic replacement
when separate updates would expose an impossible intermediate combination.

`affected` contains Observatory subject IDs only. It lets the browser refresh an
open inspector whose subject changed; it is not enough information to apply a
domain mutation. If a publication batch exceeds the bounded affected-subject
set, `affectedAll` is true and the browser refreshes any open inspector
conservatively.

### Future safe deltas

A later protocol version may add a projection delta only when all of these hold:

- the target has stable projection identity;
- application is deterministic and idempotent;
- ordering and deletion are explicit;
- aggregate effects are included or impossible;
- a mismatched base revision is detectable; and
- full replacement remains available.

For example, replacing one independent pending-launch row may be safe. Applying
an `AgentChanged` event directly to all Atlas and attention structures is not.

## Slow subscribers and backpressure

The server retains at most one unsent complete projection snapshot for each
subscriber. A newer complete replacement supersedes an older unsent replacement,
and all slow subscribers share its serialized bytes. It does not queue every
control-plane event or projection revision.

If a subscriber misses a delta in a future protocol, reports a mismatched base
revision, or falls behind a bounded delta buffer, the server sends
`refresh-required` or a complete `snapshot` replacement.

Limit active projection subscribers, initially to 32. Reject excess connections
with `503`. Heartbeats are SSE comments approximately every 15 seconds and never
advance revisions. The HTTP server idle timeout must remain longer than the
heartbeat interval; the Bun composition root currently uses 30 seconds.

## Browser model

The browser maintains only the latest validated projections and projection
cursor. It does not retain or reduce control-plane events.

On a stream event:

1. Validate the envelope and projection schema.
2. Reject an older revision from the same epoch.
3. Treat a changed epoch as a complete reset.
4. Atomically replace the supplied projection value.
5. If the selected inspector appears in `affected`, schedule one inspector
   refresh with the existing stale-response guard.
6. Render through existing React state and selectors.

Because the stream carries already-derived projections, React does not need Goal,
Agent, host or provider transition rules.

Mutation responses may continue to include eager projections during migration.
Both eager responses and stream updates must use the same epoch/revision ordering
so an older HTTP response cannot overwrite a newer stream result. Once the
stream is proven, mutation responses can return command results only.

## Time-derived changes

Evidence freshness and human-readable ages can change without a committed event.
The `ProjectionPublisher` runs a cheap in-process time refresh, initially every
30 seconds while at least one browser is subscribed.

This refresh:

- performs no external acquisition;
- rebuilds only time-sensitive projections;
- publishes only if renderer-visible state or age buckets changed; and
- stops when no browser is subscribed.

A future implementation may calculate exact next freshness deadlines. Do not
keep two-second browser or backend timers merely to update age labels.

## Recovery and delivery guarantees

### Browser reconnect

A reconnect receives a complete current snapshot. No control-plane or projection
event replay is required.

### Server restart

The process epoch changes. The publisher rebuilds current projections from
Universe, retained provider evidence and launch receipts before accepting
subscribers. The browser replaces all prior projection state.

### Provider-event loss

Missed provider hooks remain unknown. A projection snapshot cannot reconstruct
them and must not imply complete provider history.

### Host loss

SessionHost failure or incomplete inventory produces the existing uncertain host
state. Stream silence never proves absence. Fresh host snapshots remain the only
execution-recovery authority.

### Subscriber lag

Complete replacements permit dropping intermediate projection revisions. A slow
subscriber eventually receives the latest state, not every animation step.

The projection channel guarantees current-state convergence while connected or
reconnected. It does not guarantee that every operational transition was shown.

## Security and privacy

- Use the configured loopback browser authority and existing Origin/Host checks.
- Do not add CORS or remote exposure.
- Keep mutations on the existing JSON, Origin and command-header path.
- Validate every browser projection envelope and bound event size.
- Never include host targets, opaque native provider references, raw hook data,
  transcript paths or terminal frames.
- Bound subscribers and per-subscriber pending state.
- Do not let a plugin publish a control-plane event directly.
- Listener or socket failure cannot fail a committed Universe command.

## Observability

Expose aggregate development counters without event payloads:

- events published by family;
- events coalesced per projection batch;
- projection calculation count and duration;
- serialized projection byte size;
- active and rejected subscribers;
- replacements superseded for slow subscribers;
- reconnect snapshots; and
- time-derived publications.

Measure before introducing incremental portfolio projection logic.

## Testing strategy

### Event hub contract

- assigns strictly increasing sequences within one epoch;
- preserves publication batch order under concurrent asynchronous callers;
- queues reentrant publication after the current listener pass;
- isolates throwing listeners;
- normalizes, deduplicates and bounds IDs;
- publishes nothing for an empty batch; and
- releases subscribers cleanly.

### Owning module tests

- a persisted Universe command emits the expected event after save;
- a failed store save emits nothing;
- a no-op or stale observation emits nothing;
- host availability, identity and runtime transitions emit execution events;
- timestamp-only host refresh emits no projection-driving event;
- untracked provider evidence emits nothing;
- changed admitted provider evidence emits affected Agent IDs and kinds; and
- pending launch creation, completion and failure emit launch events after receipt persistence.

### Projection publisher tests

- starts from complete current snapshots;
- maps each event family to the correct projections;
- unions affected IDs and computes each projection once per batch;
- an interactive event promotes pending routine activity;
- continuous activity publishes within the hard maximum delay;
- projection calculations never overlap;
- ten subscribers share one calculation and serialized payload;
- a slow subscriber retains only the latest complete replacement;
- reconnect and changed epoch produce a complete snapshot;
- heartbeats do not change revisions; and
- `close()` releases timers and subscribers.

### Browser tests

- initial snapshot replaces all projection state;
- same-epoch older revisions are ignored;
- changed epoch resets all projection state;
- malformed events preserve the last valid rendering;
- affected selected subjects trigger one inspector refresh;
- eager mutation responses cannot overwrite newer stream state;
- stream failure retains state and reconnects; and
- no two-second portfolio or pending-launch timer remains.

### Integration tests

- parallel command, host and provider changes converge in one or two bounded
  projection batches;
- repeated equivalent Herdr snapshots produce no browser event;
- provider activity is capped at the configured publication rate;
- permission requests and host availability changes arrive promptly;
- pending launch state updates without recurring browser reads;
- foreign Origin and authority requests cannot open the stream; and
- browser modules continue to avoid persistence, mutable Universe and concrete
  host imports.

## Rollout sequence

1. **Done:** add `ControlPlaneEventHub` and its contract tests.
2. **Done:** emit semantic and execution events from Universe after successful
   saves.
3. **Done:** emit provider-evidence and pending-launch events from their owning
   coordinators.
4. **Done:** add `ProjectionPublisher` with batching, current snapshots and
   bounded subscribers. Production metrics remain pending.
5. **Done:** add SSE initial snapshots with the existing reads available for
   recovery.
6. **Done:** switch portfolio state to the projection stream and retain one slow,
   disconnected-only fallback read.
7. **Done:** add pending-launch replacement events and remove its independent
   timer.
8. **Done:** move time-derived refresh into the publisher and remove the
   two-second portfolio timer.
9. **Pending:** dogfood parallel hook, command, launch and Herdr transitions with
   mock and live sessions.
10. **Pending:** decide from measured projection cost whether any
    projection-specific delta earns its additional interface and recovery
    complexity.

Each stage preserves snapshot recovery and can be reverted without changing
SessionHost or plugin interfaces.

## Success criteria

- Every browser-driving change originates as a typed event from the module that
  accepted and persisted it.
- Event producers contain no browser resource or transport vocabulary.
- One projection calculation and serialization serves all connected tabs for a
  publication batch.
- Sustained routine activity causes no more than four portfolio publications per
  second; urgent changes normally appear within 250 ms.
- Slow subscribers use bounded memory and converge through complete replacement.
- Browser reconnect and server restart require no operational event replay.
- Idle browser portfolio and pending-launch polling is removed.
- React consumes projections rather than domain events.
- Herdr remains execution truth and operation-specific revalidation is unchanged.
- Missing provider evidence remains unknown.
- `bun run format`, `bun run check`, `bun test`, `bun run build:web` and live mock
  dogfooding pass.

## Rejected alternatives

### Resource invalidations as the foundational model

They make producers know renderer resources and provide no reusable account of
what changed. Resource invalidation remains an internal projection-publisher
implementation detail.

### Raw domain events in React

This duplicates projection, aggregation and reconciliation logic in the
renderer and makes reconnect recovery substantially harder.

### Durable global event log

Operational host/provider events have different recovery and authority from
semantic history. Persisting all of them would recreate an audit guarantee the
product does not need. Durable Catch up remains Universe-owned.

### Full projection on every source event

This allows provider and filesystem bursts to determine browser work directly.
Projection batching and publication rate limits are mandatory.

### Delta-only delivery

Deltas require exact base revisions, replay, deletion semantics and lag repair.
Begin with complete projection replacements, then add only measured, safe deltas.

### Universal plugin event bus

Plugins propose typed observations through existing capability seams. They do
not gain arbitrary publication rights into the control plane.
