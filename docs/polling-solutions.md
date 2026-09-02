# Observatory polling solutions

Status: solution options after explicit Agent-admission decision

Date: 2026-09-02

Depends on: [Observatory polling analysis](polling-analysis.md)

Related documents:

- [Observatory technical architecture](design/technical-architecture.md)
- [Observatory technology decisions](design/technology-decisions.md)
- [Observatory plugin architecture](design/plugin-architecture.md)
- [Conversation-first Agent tracking](specs/conversation-first-agent-tracking.md)
- [Provider-native Agent observations](specs/provider-native-agent-observations.md)

## Purpose

The polling analysis describes four steady-state pollers, one bounded launch
poller and request-driven provider catalogue refresh. This document explores ways to reduce that polling without weakening
identity, completeness, recovery or uncertainty.

The problem is not simply to replace timers with streams. Observatory currently
uses snapshots for several correctness properties:

- recovery after process restart;
- idempotent reconciliation;
- complete-scope absence proofs;
- source health and diagnostics;
- repair after missed provider events; and
- fresh target revalidation before sensitive actions.

A successful solution must preserve those properties while avoiding repeated
unchanged work.

## Desired outcome

The target behaviour is:

```text
normal operation: events wake bounded reconciliation immediately
idle operation:   little high-frequency external work
recovery:         retained snapshots repair missed notifications
sensitive action: fresh explicit revalidation remains mandatory
browser delivery: accepted changes arrive without repeated full GET requests
```

This can be summarized as:

> Notifications announce possible change. Snapshots establish current evidence.

A notification is never accepted semantic truth. It causes the module that owns
the relevant source to obtain and reconcile a bounded snapshot through its
existing trusted path.

## Constraints

### Preserve source authority

The solution must keep the current authority split:

- `SessionHost` owns execution observations and host capability;
- `AgentHarness` catalogues own provider conversation observations;
- provider-observation sources own activity and input evidence;
- Universe remains the only writer of trusted Observatory state; and
- the web renderer consumes projections and submits commands.

A provider hook must not prove host execution absence. A host event must not
prove provider conversation continuity without exact evidence.

### Preserve snapshots

Streams and watchers can disconnect, coalesce events, miss writes or start after
the source already changed. Startup, reconnect and periodic repair therefore
still require bounded snapshots.

The goal is less polling, not snapshot deletion.

### Keep Effect at the imperative edge

Long-lived source notifications, host streams and terminal streams are
asynchronous resources. Their lifecycle belongs in Effect-backed adapters and
the web composition root. Universe, persistence records, projections,
attention and spatial calculations remain Effect-free.

### Keep host-specific details inside the adapter

Herdr commands, identifiers, event names and lifecycle rules must remain in
`hosts/herdr/`. A future host must be selectable without changing Universe,
persistence, projection or browser interfaces.

### Do not build a generic event bus

The application has a small number of known acquisition and publication paths.
A universal publisher/subscriber abstraction would expose more interface than
the problem requires. Each notification should live at the seam whose source
owns the possible change.

### Preserve operation-specific revalidation

Closeout, terminal access, resume and other target-sensitive operations should
continue to take fresh observations where their invariants require them. An
old stream event or recently cached snapshot is not automatically sufficient
proof for a destructive action.

## Solution options

The options below are not mutually exclusive. They address different pollers
and provide different levels of reduction.

### Option A: tune polling intervals only

Increase the existing intervals through:

- `AO_WEB_REFRESH_MS`;
- `AO_OBSERVATION_REFRESH_MS`; and
- `AO_PROVIDER_REFRESH_MS`.

#### Advantages

- No interface changes.
- Existing snapshot and failure semantics remain intact.
- Very low implementation risk.
- Useful as a temporary operational control.

#### Limitations

- Every idle cycle still performs unchanged work.
- Longer intervals directly increase event-to-screen latency.
- One fixed interval cannot fit both stable and uncertain states.
- It does not remove duplicate pending-launch snapshots.
- It does not address one polling loop waking another unnecessarily.

#### Assessment

This is a tuning mechanism rather than an event-driven solution. It is useful
for measurement and emergency load reduction but does not change the underlying
shape.

### Option B: skip unchanged filesystem work

Retain the existing timers but cache source metadata and parsed state.

For an atomically replaced observation journal, the adapter can compare a safe
file identity such as size, modification time and inode/file identifier. If the
journal is unchanged, it can reuse parsed retained state and recalculate only
clock-derived health.

Provider catalogue adapters can similarly cache provider-specific index and
root metadata before repeating bounded header reads.

#### Advantages

- Keeps existing module interfaces and scheduling.
- Reduces file reads and JSON parsing during idle periods.
- Preserves current two-second observation latency and request-driven catalogue behaviour.
- Useful independently of watchers or streams.

#### Limitations

- Timers still wake and stat sources.
- Recursive catalogue discovery may still be needed to establish that no new
  files exist.
- Metadata equality must not be treated as a cross-restart correctness proof.
- Atomic replacement, timestamp resolution and provider-specific storage rules
  require careful adapter-local handling.
- It does not reduce Herdr subprocess spawning or browser requests.

#### Assessment

This is a low-risk efficiency improvement, especially for observation journals.
It reduces the cost of polling but not its frequency.

### Option C: direct hook notification

After durably writing the retained journal, an installed hook could notify the
running Observatory process through loopback HTTP or a local socket.

The notification would carry only source identity or an opaque invalidation;
Observatory would still read the retained journal snapshot.

#### Advantages

- Very low hook-to-server latency.
- No recursive filesystem watching.
- The retained journal remains available when Observatory is stopped.
- Notification can be sent only after the durable write succeeds.

#### Limitations

- Hooks need discovery, authentication and failure handling for the local
  Observatory endpoint.
- Observatory may not be running.
- Port changes and multiple checkouts/processes complicate routing.
- A direct callback increases coupling between installed hook bundles and the
  server lifecycle.
- Provider hook execution should not block on Observatory availability.
- It introduces an additional local command/security surface.

#### Assessment

A direct callback can be a useful optional latency hint, but it is a poor sole
notification mechanism. The retained journal must remain authoritative for
recovery, and callback failure must not make the hook operation fail.

### Option D: source-owned change notification

Allow an observation source to expose an optional Effect Stream that emits a
bounded wake-up when its retained state may have changed.

Conceptually:

```ts
interface AgentObservationSourceV1 {
  describe(): AgentObservationCapability;
  snapshot(request: AgentObservationSnapshotRequest): Effect<AgentObservationSnapshot>;
  changes?: Stream<AgentObservationChange, HarnessObservationError>;
}

interface AgentObservationChange {
  readonly kind: "source-may-have-changed";
}
```

The notification contains no provider payload and does not advance a cursor.
The coordinator responds by invoking the existing `snapshot()` interface.

For `ProviderObservationJournal`, the adapter would watch the configured
journal's parent directory because journal compaction uses atomic rename. It
would filter by filename and coalesce rename/change bursts.

#### Advantages

- Source-specific notification mechanics remain behind the plugin seam.
- Filesystem paths do not leak into the web composition root.
- Structured provider integrations can later use native notifications behind
  the same narrow interface.
- Sources without notifications continue to work through snapshots.
- The snapshot remains the single validation and reconciliation interface.

#### Limitations

- Changes the contributed plugin interface.
- All current production providers use the same journal adapter, so the first
  implementation has limited mechanism variation.
- Filesystem watchers can coalesce or lose notifications.
- The coordinator must handle watcher failure, reconnection and bursts.
- Clock-derived freshness still changes without a source notification.

#### Assessment

This is the strongest general solution for provider-observation polling if the
interface remains a notification-only wake-up. It gives callers high leverage
without exposing journal paths, watcher events or provider payloads.

The interface should remain optional until source notification is part of the
accepted plugin contract. It must not replace `snapshot()`.

### Option E: composition-root filesystem watchers

The web composition root could directly watch the built-in journal and provider
storage paths, then call the current refresh methods.

#### Advantages

- Avoids changing plugin interfaces.
- Fast to implement for the built-in local providers.
- Uses the existing coordinator refresh methods unchanged.

#### Limitations

- Leaks plugin configuration and filesystem layout into `src/web/`.
- Couples the composition root to Claude, Codex and Pi storage mechanics.
- Third-party sources cannot participate without further special cases.
- Violates locality: watcher fixes and provider path changes spread outside the
  owning adapter.
- Makes a future structured source awkward.

#### Assessment

This is a shallow shortcut. Deleting it would push provider-specific complexity
back into the composition root, showing that it does not create useful module
depth. It should not be the maintained design.

### Option F: adaptive host polling

Keep `SessionHost.snapshot()` but vary the cadence according to current
operational conditions.

Possible cadence inputs include:

- pending launch receipts;
- recently launched or resumed executions;
- unavailable or incomplete host observations;
- identity conflicts;
- recent provider hook activity;
- recent Observatory host actions; and
- a stable, healthy host with no unresolved operations.

A stable host can be inspected less often. Pending or uncertain work can retain
a short cadence. Relevant hook or command activity can trigger an immediate
snapshot without waiting for the next timer.

#### Advantages

- Does not require a Herdr event stream that does not currently exist in the
  adapter.
- Reduces idle `herdr api snapshot` subprocesses.
- Retains complete host snapshots and current uncertainty semantics.
- Provides low latency around Observatory-controlled operations.

#### Limitations

- Silent external pane closure, process crash or host failure is visible only at
  the fallback cadence.
- Cadence becomes policy that must be explicit and tested.
- Hook activity covers only configured providers and cannot prove host change.
- An overly elaborate state machine could exceed the value of the saved local
  work.
- Host freshness in projections must align with the chosen maximum cadence.

#### Assessment

This is the strongest interim host solution while Herdr lacks a consumed native
inventory stream. It can reduce idle polling but cannot eliminate a conservative
host safety sweep.

### Option G: native SessionHost observation stream

If a real host exposes a reconnectable inventory or lifecycle stream, the
adapter can translate it into generic host change notifications or snapshots.

Two possible interface shapes are:

```ts
interface SessionHost {
  snapshot(): Effect<HostSnapshot, HostError>;
  changes?: Stream<HostChange, HostError>;
}
```

or a deeper acquisition interface owned by a host-observation module:

```ts
interface HostObserver {
  observe(): Stream<HostSnapshot, HostError>;
}
```

In either shape, startup and reconnect still require a complete snapshot. A
native event can wake reconciliation but cannot fabricate snapshot completeness
unless the host protocol itself provides a complete ordered snapshot stream.

#### Advantages

- Can remove most routine host snapshot subprocesses.
- Detects host-owned changes that provider hooks cannot see.
- Can replace the bounded post-launch snapshot loop if the host supplies a safe
  wait primitive.
- Keeps host protocol details in the adapter.

#### Limitations

- The current Observatory Herdr adapter consumes snapshots and terminal streams,
  not an inventory-change stream.
- Adding a generic stream before a production adapter can implement it creates a
  hypothetical seam.
- Reconnect ordering, loss and completeness semantics must be specified.
- A stream internally implemented by the same fixed polling loop only moves the
  timer; it does not reduce polling.

#### Assessment

This is the eventual host direction only when Herdr or another real host
provides the capability. It should not be added speculatively.

### Option H: browser SSE publication

Replace browser portfolio and pending-launch timers with one same-origin
application state stream.

The server would publish a complete web-state envelope containing at least:

```ts
interface WebStatePublication {
  readonly instanceId: string;
  readonly revision: number;
  readonly portfolio: PortfolioResponse;
  readonly pendingLaunches: WebPendingLaunchesResponse;
}
```

The stream sends a complete current publication on connection and reconnection.
Commands remain HTTP and can continue returning immediate results.

#### Advantages

- Removes two timers and two repeated GET paths per browser tab.
- Delivers backend changes immediately after publication.
- Reuses an already proven local transport; terminal output uses SSE today.
- A complete reconnect publication avoids a durable browser event log.
- A process-local monotonic revision is stronger than ordering by
  `generatedAt`.

#### Limitations

- Does not reduce backend source polling by itself.
- The server needs one authoritative place to decide when web state may have
  changed.
- Time-derived freshness needs publication even without a source event.
- Inspector and other selected views need an explicit invalidation policy.
- Multiple command responses and stream publications need one ordering
  contract.

#### Assessment

SSE is the natural browser-delivery solution. It should be a narrow web
publication module, not a generic application event bus and not a replacement
for HTTP commands.

## Cross-cutting solution requirements

### Coalescing and serialization

One provider turn can produce several hook events and one Observatory operation
can change host, provider and launch state in quick succession. Notification
handling should coalesce bursts before expensive snapshot or projection work.

For each source, the implementation needs these semantics:

1. only one snapshot runs at a time;
2. a notification arriving during a snapshot marks the source dirty;
3. the source runs once more after the current snapshot if dirty;
4. duplicate notifications carry no semantic meaning; and
5. failure leaves the source unavailable or degraded according to its existing
   rules rather than terminating all observation.

This behaviour belongs behind a small scheduling interface, not in every
notification caller.

### Startup and reconnect

Every long-lived notification path must follow:

```text
subscribe or prepare watcher
    -> obtain complete retained snapshot
    -> reconcile
    -> consume notifications
    -> resnapshot after reconnect or detected gap
```

The exact ordering may differ where a source cannot buffer between subscription
and snapshot. The invariant is that a notification gap cannot silently become
accepted current state.

### Safety sweeps

A safety sweep is still required where notification delivery is not durable or
complete. Its role is repair rather than ordinary latency.

Different sources may need different sweeps:

- observation journals repair missed filesystem notifications;
- provider catalogues refresh Conversation history at startup or on explicit
  request for providers without healthy hooks;
- the host detects silent external closure and host unavailability; and
- browser SSE reconnect sends a complete current publication rather than
  replaying a durable event history.

A sweep interval is an explicit product tolerance, not merely a performance
constant. It defines how long silent source changes may remain unseen.

### Time-derived freshness scheduling

Provider evidence can become stale with no journal write. Re-reading the source
is unnecessary because only derived presentation changed.

A scheduler can compute the next relevant deadline from retained evidence:

```text
next deadline = minimum(observedAt + useful lifetime for visible evidence)
```

At that deadline it invalidates projections and source-health presentation. It
does not need to reread an unchanged journal unless the safety sweep is also
due.

Open human-input requests require particular care: expiry changes them from
fresh attention evidence to explicitly stale evidence rather than silently
removing them.

### Publication revision

Browser ordering should not depend solely on wall-clock `generatedAt`.
A process-local publication module can assign:

- a random server `instanceId` at startup; and
- a monotonic `revision` for each accepted web-state publication.

On server restart, the instance changes and the first stream event is a complete
snapshot. Within one process, HTTP mutation responses and SSE publications can
share the same revision source.

This revision is renderer transport state. It does not need to become durable
Universe state.

### Failure and uncertainty

Notification health and observed-source health are different:

- a filesystem watcher can fail while the last retained snapshot remains valid
  but ages naturally;
- a provider journal can become malformed while the watcher remains connected;
- an SSE browser connection can fail while backend host evidence remains fresh;
- a host stream can disconnect while saved semantic state remains intact.

The implementation must not collapse these into one generic online/offline
flag.

## Deep module opportunities

### Web publication module

The browser should learn one small interface: connect to current web state and
receive complete ordered publications. The module hides:

- projection derivation;
- pending-launch composition;
- revision assignment;
- burst coalescing;
- heartbeats;
- subscriber lifecycle; and
- reconnect snapshots.

This is deeper than exposing separate portfolio, launch and inspector event
channels.

### Source notification remains adapter-owned

A source adapter should hide whether its wake-up comes from:

- a filesystem directory watcher;
- a structured provider stream;
- a local callback; or
- no notification capability.

The coordinator should know only that the source may have changed and should
request a snapshot.

### Reconciliation scheduling

The current composition root has three independent fixed loops and several
operation-driven refreshes. Scheduling complexity will increase with wake-ups,
deadlines, dirty flags, adaptive host cadence and shutdown.

A focused reconciliation scheduling module could hide:

- serialization by source;
- notification coalescing;
- safety timers;
- freshness deadlines;
- adaptive host timing;
- shutdown; and
- changed/unchanged instrumentation.

Its interface should remain bounded to the known source families. It must not
become a universal event bus or gain authority to write around the existing
coordinators.

## Recommended direction

The strongest combined solution is:

1. retain every current typed snapshot interface;
2. use source-owned notifications as wake-up hints where real sources support
   them;
3. retain slow, explicit safety sweeps for missed or silent changes;
4. schedule time-derived projection deadlines without rereading sources;
5. remove duplicate snapshots before adding new transport complexity;
6. use adaptive host polling until a real native host stream exists; and
7. publish complete ordered browser state through one SSE feed.

The resulting shape is:

```text
provider hook
    -> retained journal
    -> source-owned wake-up
    -> validated observation snapshot
    -> evidence store

provider store change or unknown exact hook identity
    -> provider catalogue snapshot
    -> ConversationTracker
    -> Universe observation

host notification, relevant hook, operation or safety timer
    -> SessionHost snapshot
    -> ConversationTracker canonicalisation
    -> Universe observation
    -> pending-launch recovery

Universe/evidence/launch change or freshness deadline
    -> web publication module
    -> complete revisioned SSE state
    -> browser
```

## Suggested delivery sequence

### Phase 0: establish measurements

Record, by source:

- refresh count;
- changed versus unchanged result;
- duration;
- bytes read and parsed where available;
- Herdr command count;
- pending receipt count;
- hook event time to accepted evidence time; and
- accepted backend change to browser-visible time.

This establishes whether later work reduces idle cost without increasing missed
or late observations.

### Phase 1: remove current duplication

- Reuse one accepted host snapshot across ordinary host reconciliation and all
  pending receipts in the same cycle.
- Avoid repeating mount-time pending recovery when startup or a fresh backend
  cycle already performed it.
- Cache parsed unchanged observation journals safely within one process.

This phase changes no source authority and introduces no new long-lived stream.

### Phase 2: make provider observations event-triggered

- Add optional source-owned change notification.
- Implement parent-directory watching for retained journals.
- Debounce, serialize and retain a dirty flag.
- Keep the current snapshot validation and persistence path.
- Add time-derived freshness deadline scheduling.
- Retain a slow observation safety sweep.

This removes the highest-frequency repeated filesystem parsing.

### Phase 3: publish browser state over SSE

- Add one web publication module.
- Publish portfolio and pending launches with instance/revision ordering.
- Send a complete initial and reconnect state.
- Keep HTTP commands and explicit GET recovery paths.
- Define Inspector invalidation and disconnected-stream presentation.
- Remove the two browser timers.

Pairing this after provider notifications gives hook-to-screen delivery without
a residual two-second browser delay.

### Phase 4: optimise request-driven catalogue scans

The recurring catalogue timer has already been removed as part of explicit
Agent admission. Remaining work is limited to startup and operator-requested
Conversation history refreshes:

- Use provider-owned index/root metadata where available without leaking paths.
- Short-circuit unchanged provider metadata inside each harness adapter.
- Retain startup and explicit catalogue snapshots for history discovery.
- Never use an unknown hook or host identity to admit an Agent.

### Phase 5: reduce host polling

- Trigger immediate snapshots after relevant hook events and Observatory host
  operations.
- Poll quickly while launches are pending or host evidence is uncertain.
- Use a slower safety cadence while the host is stable.
- Keep sensitive operation revalidation independent.
- Replace adaptive polling only when a real host change stream or wait primitive
  is available.

## Decision points

Before implementation, decide:

1. What is the primary success measure: idle resource usage, event latency,
   process count, or architectural simplicity?
2. What is the maximum acceptable delay for a silent external host change while
   no native host stream exists?
3. How quickly must a direct provider session appear when hooks are absent or
   unhealthy?
4. Should optional source notification become part of
   `AgentObservationSourceV1`, or require a versioned V2 capability?
5. Should the web publication include only portfolio and pending launches, or
   also selected Inspector invalidations?
6. Does a process-local file watcher provide sufficient dogfooding evidence, or
   is an optional post-write callback worth its security and routing cost?
7. Is launch-to-provider identity latency important enough to justify a future
   opaque launch-correlation token?

## Success criteria

A polling-reduction implementation should demonstrate:

- substantially fewer idle Herdr commands and journal reads;
- lower or equal hook-to-screen latency;
- no overlapping snapshots for one source;
- deterministic recovery after a missed notification;
- complete startup reconciliation;
- correct stale transitions at freshness deadlines;
- unchanged host, provider and Universe authority rules;
- unchanged closeout and terminal target safety;
- browser recovery after SSE disconnect or server restart; and
- deterministic tests through mock sources without requiring Herdr.

## Rejected framings

### “Replace all snapshots with events”

Events do not provide complete retained state after restart and cannot safely
prove absence after a delivery gap.

### “Let hooks update Universe directly”

Hooks are lossy provider observations, not trusted semantic commands. They must
not write SQLite or bypass Universe invariants.

### “Use provider session-ended as process absence”

Provider lifecycle and host execution lifecycle are independent authorities.

### “Put file watchers in the web server”

That leaks provider storage details out of their adapters and creates a shallow
pass-through design.

### “Add a SessionHost stream backed by the same timer”

Moving polling behind a stream-shaped interface does not reduce polling and
misrepresents the capability.

### “Use one global event bus”

It would enlarge the interface, blur source authority and distribute ordering
rules without adding necessary capability.

### “Remove operation-specific snapshots”

Fresh closeout, resume and terminal checks protect exact-target invariants and
are not the idle polling problem.
