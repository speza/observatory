# Observatory polling analysis

Status: current-state analysis for review; no product decision

Date: 2026-09-02

Related documents:

- [Observatory polling solutions](polling-solutions.md)
- [Observatory technical architecture](design/technical-architecture.md)
- [Observatory technology decisions](design/technology-decisions.md)
- [Observatory plugin architecture](design/plugin-architecture.md)
- [Conversation-first Agent tracking](specs/conversation-first-agent-tracking.md)
- [Provider-native Agent observations](specs/provider-native-agent-observations.md)

## Purpose

This document describes where Observatory polls today, what work each poll
performs, which source owns the resulting facts, and where work is duplicated.
It deliberately does not choose an event transport or propose an implementation
plan.

## Executive summary

Observatory currently has four steady-state polling loops:

1. the browser fetches the portfolio every 2 seconds;
2. the browser fetches pending launches every 2 seconds;
3. the server snapshots the selected `SessionHost` every 2 seconds; and
4. the server reads provider-observation journals every 2 seconds.

Provider conversation catalogues are refreshed at startup and on explicit
Conversation history requests, not on a recurring timer.

There is also one bounded, operation-local polling loop: after launching a
process, the Herdr adapter can repeatedly snapshot Herdr while waiting for the
new Agent to appear.

| Poll                          | Default interval | Work performed                                                     |
| ----------------------------- | ---------------: | ------------------------------------------------------------------ |
| Browser portfolio             |        2 seconds | Fetch and rebuild the complete browser portfolio                   |
| Browser pending launches      |        2 seconds | Fetch the current durable pending-launch receipt view              |
| Session host                  |        2 seconds | Spawn `herdr api snapshot`, translate and reconcile the inventory  |
| Provider observations         |        2 seconds | Read and parse each configured retained hook journal               |
| Herdr post-launch observation | 250 milliseconds | Repeatedly snapshot until the launched pane is recognised, bounded |

For one open browser tab, no pending launches and all three built-in harnesses,
the steady-state defaults produce approximately:

- 30 portfolio requests per minute;
- 30 pending-launch requests per minute;
- 30 Herdr snapshot subprocesses per minute;
- 30 observation refresh cycles per minute, each reading up to three journals.

The browser and backend loops are independent. Browser polling normally reads
already reconciled state; it does not cause the routine Herdr, observation or
catalogue refreshes.

Agent hooks already acquire provider lifecycle events when they happen. They do
not currently notify the running Observatory process. Instead, they write a
bounded retained journal, and Observatory discovers journal changes during its
next two-second observation refresh:

```text
Agent event -> hook/extension -> retained JSONL journal
                                      ^
                                      |
                         Observatory polls every 2 seconds
```

The three backend snapshot families observe different authorities:

- provider-observation journals contain provider activity, input, outcome and
  context evidence;
- provider catalogues contain recoverable conversation identity, metadata,
  aliases and scoped completeness; and
- `SessionHost` snapshots contain execution presence, placement, lifecycle and
  host availability.

These are related observations, but they are not interchangeable.

## What counts as polling

This analysis calls work polling when it repeatedly reads a source on a timer
to discover whether state changed.

It distinguishes polling from:

- an SSE heartbeat that keeps an existing stream alive;
- a timeout that bounds a child process;
- retrying a contended journal lock;
- startup reconciliation;
- a one-off refresh caused by opening a view or pressing Refresh;
- fresh revalidation before or after a sensitive operation;
- the bounded wait inside one launch; and
- Vite or Bun source-file watching during development.

Some of those operations use timers or repeat reads, but they do not create
Observatory's idle steady-state load. The bounded post-launch wait is included
separately because it can create a concentrated burst of Herdr snapshots.

## Current end-to-end data flow

```text
Claude/Codex/Pi hooks
    -> append and compact retained observation journals
    -> 2-second backend observation poll
    -> AgentObservationCoordinator
    -> operational evidence store

Claude/Codex/Pi session files
    -> 60-second backend catalogue poll
    -> ConversationTracker
    -> catalogue store and Universe observations

Herdr inventory
    -> 2-second `herdr api snapshot` process
    -> ConversationTracker canonicalisation
    -> Universe host reconciliation
    -> pending-launch recovery

Universe + evidence store
    -> browser requests `/api/portfolio` every 2 seconds
    -> deterministic projections
    -> React state

Launch receipt store
    -> browser requests `/api/launch/pending` every 2 seconds
    -> React pending-launch state
```

## Scheduling behaviour

The three server loops are created in `src/web/main.ts` and use
`startSerializedRefreshLoop()` from `src/web/refresh-loop.ts`.

The loop schedules its next timer only after the current asynchronous refresh
settles. Therefore:

- one loop never overlaps itself;
- a slow refresh lowers that loop's effective frequency;
- failures are reported and the next iteration is still scheduled; and
- the configured interval is a delay after completion, not a fixed wall-clock
  period.

The three server loops are independent of one another. Host, catalogue and
observation refreshes can therefore overlap each other even though each family
is internally serialized. `ConversationTracker.refresh()` also uses an Effect
semaphore to serialize timer-driven and explicit catalogue refreshes.

## Detailed inventory

### 1. Browser portfolio polling

**Location:** `web/src/app/usePortfolio.ts`

`usePortfolio()` immediately calls `fetchPortfolio()`, then schedules the next
call with `window.setTimeout(..., 2_000)` after the current request settles. It
requests:

```text
GET /api/portfolio
```

The server handles this in `src/web/api.ts`. It does not refresh an external
source. It synchronously derives three views from current trusted state:

- Universe map;
- command centre; and
- catch up.

It then enriches those views from the latest stored agent-observation evidence.
The complete portfolio is serialized on every request; the response does not
indicate whether anything materially changed.

The browser protects itself from out-of-order responses by comparing
`map.generatedAt`. Command, launch, conversation-add and closeout responses can
also include a portfolio, allowing successful mutations to update the UI before
the next poll. `usePortfolio()` aborts an in-flight request when such a response
is accepted.

#### What this poll transports

- Backend host reconciliation already accepted by Universe.
- Provider-observation enrichment already accepted by the evidence store.
- Human commands made through another browser context.
- Time-derived projection changes.

#### What it does not refresh

- It does not invoke `SessionHost.snapshot()`.
- It does not refresh provider catalogues.
- It does not read provider hook journals directly.

#### Cost and behaviour

- One complete local HTTP request every two seconds per open tab.
- Complete portfolio derivation and JSON serialization on every request.
- Up to roughly two seconds between a backend change and browser visibility.
- `generatedAt` is a wall-clock projection timestamp, not a state revision.
- A temporarily failed request leaves the last accepted projection visible and
  the loop tries again after the request settles.

### 2. Browser pending-launch polling

**Location:** `web/src/app/App.tsx`

On mount, the browser requests:

```text
GET /api/launch/pending?refresh=1
```

It then uses `window.setInterval(..., 2_000)` to request:

```text
GET /api/launch/pending
```

The initial `refresh=1` request asks the backend to run
`StartAgentCoordinator.refreshPending()`. Subsequent requests normally read the
current durable launch receipts without refreshing the host.

The backend host loop independently runs `refreshPending()` every two seconds.
The recurring browser request therefore transports already-updated receipt
state into React rather than discovering host state itself.

#### Cost and behaviour

- One additional local HTTP request every two seconds per open tab.
- Up to roughly two seconds between a receipt update and browser visibility.
- The mount-time forced refresh can duplicate pending recovery that already ran
  during server startup or the backend host loop.
- Dismissing a pending-launch card is browser-local presentation state and does
  not change the durable receipt.

### 3. Backend SessionHost polling

**Locations:**

- scheduling: `src/web/main.ts`;
- loop implementation: `src/web/refresh-loop.ts`;
- interface: `src/hosts/types.ts`;
- Herdr implementation: `src/hosts/herdr/adapter.ts`;
- command runner: `src/hosts/herdr/runner.ts`.

The interval is configured by `AO_WEB_REFRESH_MS`. It defaults to 2,000 ms and
has a minimum accepted value of 100 ms.

Each loop iteration performs:

1. `runtime.host.snapshot()`;
2. `conversations.observeHost(snapshot)`; and
3. `startAgent.refreshPending()`.

For the live adapter, `SessionHost.snapshot()` spawns:

```text
herdr api snapshot
```

The command has a default 15-second deadline, configured by
`AO_HERDR_COMMAND_TIMEOUT_MS`, and a 2 MiB output bound. The adapter parses the
Herdr result, translates it into generic host and Agent observations, and
refreshes process-local access fingerprints.

`ConversationTracker.observeHost()` then:

- canonicalises host-provided conversation references against the retained
  provider catalogue;
- submits a `host-executions` observation to Universe;
- retains the latest host snapshot for later provider-first reconciliation; and
- refreshes accepted partial provider facts after an accepted host observation.

Universe uses a complete fresh snapshot to establish execution absence for one
host instance. Unavailable, incomplete, malformed or out-of-order snapshots do
not prove absence.

#### Facts owned by this source

The host snapshot is the routine source for:

- Herdr availability and diagnostics;
- complete current execution inventory;
- executions created outside Observatory;
- execution disappearance;
- host-reported runtime state;
- opaque execution bindings;
- host-assisted harness and conversation evidence;
- worktree, branch, repository and execution-container metadata;
- target reuse and identity conflicts;
- linked execution discovery; and
- current access-target fingerprints.

Provider hook silence cannot establish any of these facts. A process may crash,
a pane may close externally, a hook may be absent, or Herdr itself may become
unavailable without a final provider event.

#### Pending-launch snapshot amplification

`refreshPending()` processes pending receipts sequentially. Each receipt's
recovery path calls `SessionHost.snapshot()` again. One nominal host-loop cycle
therefore performs:

```text
1 normal host snapshot + 1 host snapshot per pending recovery receipt
```

With no pending receipt, the baseline is 30 Herdr snapshot commands per minute.
With `N` pending receipts, the loop may perform `1 + N` snapshots every two
seconds until those receipts settle.

The outer host-loop snapshot is not currently reused by pending-launch
recovery, even though it was taken immediately before `refreshPending()`.

#### Other host snapshots

Fresh snapshots are also taken during operations such as launch, resume,
pending-terminal access and closeout. These are operation-driven revalidation,
not idle polling. They protect exact-target, continuity and destructive-action
invariants.

Closeout takes snapshots before and after its host action. Terminal access for a
pending launch takes a fresh snapshot to prove the temporary execution remains
visible. These reads remain distinct from routine observation even when they
happen near a scheduled host refresh.

### 4. Bounded Herdr post-launch polling

**Location:** `src/hosts/herdr/adapter.ts`

`launchExecution()` must determine whether the newly started command has become
a recognised Herdr Agent. After running the process, it takes an immediate
snapshot. If the expected pane is not yet in the Agent inventory,
`waitForAgentObservation()` takes up to 20 additional snapshots, sleeping 250
milliseconds between unsuccessful attempts.

In the worst unresolved case, this is approximately a five-second observation
window and a burst of 21 post-run Herdr snapshot commands: the initial snapshot
plus up to 20 snapshots in the bounded wait.

If the process plan already contains a provider conversation reference and the
pane becomes visible, the adapter reports that reference to Herdr, sleeps 500
milliseconds, and takes another snapshot to recover the enriched host evidence.

This loop:

- occurs only during a launch;
- is bounded;
- bridges the delay between process-start acknowledgement and Herdr inventory
  visibility; and
- supports exact process-to-Agent correlation.

A provider hook can report a provider session lifecycle event, but that event
does not prove that the expected Herdr pane has been recognised or bound.

### 5. Backend provider-observation polling

**Locations:**

- scheduling: `src/web/main.ts`;
- coordinator: `src/agent-observations/coordinator.ts`;
- source interface: `src/plugin-sdk/index.ts`;
- journal implementation:
  `plugins/agent-harnesses/provider-observation-journal.ts`; and
- hook writer: `scripts/provider-observation-hook.ts` and installed bundles.

The interval is configured by `AO_OBSERVATION_REFRESH_MS`. It defaults to 2,000
ms and has a minimum accepted value of 100 ms.

Every iteration asks every loaded harness with an `observationSource` for a
snapshot. Sources are refreshed concurrently. The built-in Claude, Codex and Pi
sources all use `ProviderObservationJournal`.

For each configured source, the journal implementation:

1. stats the journal;
2. rejects it if it exceeds 8 MiB;
3. reads the complete file as UTF-8;
4. parses and validates every JSONL row;
5. reconstructs current claims;
6. returns current state and transitions after the stored cursor; and
7. calculates healthy, stale or degraded source health.

The journal retains bounded current state plus the latest 1,000 semantic
transitions. The coordinator independently bounds accepted snapshot arrays to
500 observations, validates identity, payload size, clock skew and provenance,
deduplicates by cursor/revision, and writes accepted evidence through the
kernel-owned store.

#### Current hook-to-Observatory path

Provider hooks and the Pi extension run in the agent lifecycle. They normalise
safe events including:

- session and turn started;
- tool started or completed;
- permission requested;
- compaction started or completed;
- response settled; and
- session ended.

They discard prompts, responses, command arguments, tool results and transcript
paths. The writer acquires a user-owned journal lock, reconstructs retained
state and atomically replaces the compacted journal.

Atomic replacement means the journal's parent directory changes when an event
is written, but no maintained watcher or direct server notification currently
consumes that change. The server learns about it only on its next scheduled
snapshot.

#### Facts owned by this source

Provider observations contribute:

- current coarse activity;
- tool-category activity;
- human-input requests where supported;
- response outcomes;
- compaction and context-pressure evidence;
- exact scoped provider conversation references; and
- source health, freshness and diagnostics.

The observation coordinator correlates this evidence only with an already
accepted Agent carrying the same exact conversation identity. It does not:

- create or admit an Agent;
- update the provider conversation catalogue;
- bind a provider conversation to a host execution;
- resolve a pending launch receipt; or
- submit accepted lifecycle commands to Universe.

#### Cost and behaviour

At defaults, Observatory runs 30 observation refreshes per minute. With all
three built-in sources configured, that can mean 90 complete journal reads and
parses per minute, including while all files are unchanged.

At the 8 MiB per-journal safety maximum, three journals read every two seconds
would represent a theoretical 12 MiB/s of file reads and JSON parsing. Normal
journals are expected to be substantially smaller because transition history is
bounded.

Hook-to-store latency is hook execution time plus up to approximately two
seconds before the next journal refresh. The reader currently does not use an
in-process file notification, incremental tail or unchanged-file metadata cache
to skip full analysis.

### 6. Time-derived provider-observation changes

The journal does not need to change for its projected meaning to change.
Provider evidence has configured useful lifetimes:

| Evidence kind       | Built-in freshness |
| ------------------- | -----------------: |
| Activity            |          2 minutes |
| Human-input request |         30 minutes |
| Turn outcome        |           24 hours |
| Context pressure    |         10 minutes |

Projection enrichment compares the current time with each observation's
`observedAt`. Consequently, an unchanged stored activity can become stale, an
old outcome can stop producing a current signal, and an expired open request can
become explicitly stale merely because time passed.

The current two-second browser portfolio poll repeatedly re-evaluates these
rules using a new projection time. The two-second backend observation refresh
also recalculates source health and writes a newer source capture time even when
no provider event arrived.

This time-derived behaviour is separate from detecting journal writes. It is an
existing reason that projections can change without any external source
producing a new event.

### 7. Request-driven provider-conversation catalogue refresh

**Locations:**

- startup composition and API trigger: `src/web/main.ts` and `src/web/api.ts`;
- coordinator: `src/conversations/tracker.ts`; and
- built-in readers: `plugins/agent-harnesses/plugin.ts`.

There is no recurring provider-catalogue timer. Each startup or explicit
Conversation history refresh asks every configured harness to run
`snapshotSessions()`.
Harnesses are refreshed concurrently; the overall tracker operation is guarded
by an Effect semaphore.

Built-in behaviour is filesystem-based:

- **Claude Code:** recursively discovers `sessions-index.json` and session JSONL
  files, stats session files, reads indexes bounded to 8 MiB, and reads up to
  256 KiB from recent session headers.
- **Codex:** reads `session_index.jsonl` bounded to 8 MiB, recursively discovers
  session JSONL files, and reads up to 64 KiB from selected headers.
- **Pi:** recursively discovers session JSONL files, stats them to select recent
  sessions, and reads up to 64 KiB from selected headers.

The default catalogue limit is 500 sessions per harness. Snapshots explicitly
report completeness. Exceeding the limit or encountering read diagnostics
prevents the result from proving provider absence.

`ConversationTracker` stores accepted catalogues and re-runs the latest host
observation against newly learned aliases. Catalogue entries remain supporting
Conversation history until an operator explicitly adds one; catalogue refresh
never admits an Agent.

#### Facts owned by this source

A catalogue snapshot contributes:

- exact scoped conversation references;
- provider-declared aliases;
- workspace metadata;
- creation and last-activity times;
- resume eligibility;
- provider availability;
- snapshot completeness; and
- scoped evidence of conversation absence.

An activity hook can carry exact conversation identity, but the current hook
envelope does not supply all catalogue semantics. In particular, it does not
establish complete scope, recoverable history, aliases or resume eligibility.

The provider catalogue is how direct or historical sessions become visible in
Conversation history when they were not launched by Observatory, have no
configured hooks, or produced events before hooks were installed. Visibility
does not imply admission.

#### Additional triggers

Catalogue refresh occurs:

- once during server startup, except in mock mode;
- when Conversation history opens with `refresh=1`; and
- when the operator explicitly refreshes Conversation history.

Concurrent explicit refreshes are serialized by the tracker semaphore.

#### Cost and behaviour

This is not a steady-state loop, but it is potentially the broadest filesystem
scan. It recursively enumerates provider roots and can stat or read
hundreds of session files even when no provider catalogue changed.

Its worst-case cost depends on the number of files below each provider root,
not only the 500 sessions returned. The limit bounds accepted output and recent
header processing; recursive discovery still enumerates candidate files before
selection.

### 8. Startup reconciliation

Before serving browser traffic, `src/web/main.ts` performs:

1. provider catalogue refresh, except in mock mode;
2. provider-observation journal refresh;
3. SessionHost snapshot and Universe reconciliation; and
4. pending-launch recovery.

Pending recovery can take an additional host snapshot per receipt. Shortly
after the browser mounts, its initial `pending?refresh=1` request can ask for
pending recovery again.

These reads are not steady-state polling. They recover facts that existed
before the process started and ensure saved runtime evidence is not treated as
currently live without fresh observation.

## Polling-like paths outside the steady-state loops

### Explicit view refreshes

Opening Conversation history performs a provider catalogue refresh. The dialog
also has an explicit Refresh action.

Repository status and working-tree diff are loaded when their views open and
refreshed by explicit user action or a relevant local revision. They do not run
recurring background loops.

Search and Inspector loading are request-driven. An Inspector is fetched when
selection changes or its local revision is incremented; it is not independently
polled while the same selection remains open.

### Terminal streams and heartbeat

Terminal output is already streamed from the host through an Effect Stream and
relayed to the browser over SSE. The server sends a five-second comment
heartbeat. That heartbeat does not inspect host, Universe or provider state.

Opening a pending-launch terminal performs a fresh host snapshot before granting
access, but it is tied to the user action rather than a timer.

### Process deadlines

Herdr commands, plugin commands and workspace commands use timeout timers to
kill bounded child processes. These timers do not run external reads while the
application is idle.

### Journal locking

A hook writer encountering an owned journal lock retries every 10 milliseconds
for at most two seconds. This is operation-local contention handling, not
server-side observation polling.

### Mock host timing

The mock host derives scenario progress from elapsed time when a snapshot is
requested. It does not run a production background poll of its own.

### Disposable prototypes

Prototype renderers contain update timers. They are excluded from maintained
product behaviour and do not affect the production web application.

## Authority boundaries exposed by the polling inventory

### Provider activity is not host execution state

A provider event can prove that a particular provider conversation reported an
activity transition. It does not prove:

- that Herdr remains available;
- that a particular host execution still exists;
- that the complete host inventory contains no other execution;
- that a pane target has not been reused;
- that a provider session ended because its host execution disappeared; or
- that a host execution disappeared because a final hook said `session-ended`.

Provider hooks can be concurrent, delayed, missing or cancelled during process
exit. Current journals and source health preserve that uncertainty.

### Provider activity is not a complete conversation catalogue

A hook observation may carry an exact scoped conversation reference. The
observation module currently stores it as operational evidence and correlates it
with accepted Agents. It does not establish:

- complete provider scope;
- provider absence;
- historical recoverability;
- aliases;
- workspace history;
- resume eligibility; or
- an admission decision.

The first six remain catalogue observations. Admission remains an explicit
Universe command or a proven Observatory-managed new launch.

### Provider conversation identity is not host placement

Provider identity and host execution identity are independent. The current
model joins them only when exact evidence proves the association. Cwd, title,
process name, timing and recency remain supporting facts rather than identity
proof.

The current hook envelope does not carry a Herdr execution target or an
Observatory launch request identifier. The current host snapshot may carry
host-assisted provider evidence, but only the Herdr adapter interprets its
native target.

### Silence is not absence

Each snapshot family has explicit completeness and health semantics because a
missing event or failed read is not accepted absence:

- only a complete fresh host snapshot can prove execution absence for its host
  instance;
- only a complete scoped provider catalogue can contribute provider absence;
- only a complete observation snapshot can resolve certain retained claims by
  omission; and
- stale or unavailable sources retain uncertainty.

## Current duplication and amplification

The inventory exposes several places where the same broad source is read more
than once without a corresponding independent authority:

1. The server performs pending-launch recovery at startup, and the browser's
   initial `pending?refresh=1` can immediately request it again.
2. Every host loop takes one outer host snapshot and then pending recovery takes
   another snapshot for every pending receipt.
3. Every browser tab rebuilds the same complete portfolio and pending-launch
   view on independent two-second timers.
4. Every configured observation journal is fully read and parsed every two
   seconds even when unchanged.
5. Provider roots are recursively enumerated on startup and explicit history
   refresh even when no session metadata changed.
6. Operation-driven snapshots can occur close to a routine host timer because
   the loops do not share a freshness token or accepted snapshot cache.

Not all repeated work is redundant. Fresh closeout, terminal-access and launch
checks intentionally revalidate sensitive targets. The duplication above is a
current-work inventory, not a conclusion that every repeated read can be
removed.

## Consolidated findings

1. Observatory has **four steady-state pollers** and **one bounded launch
   poller**.
2. The two browser loops transport state but do not acquire external truth.
3. The host loop is the only routine observer of complete execution inventory
   and host availability.
4. Provider hooks already acquire lifecycle events immediately, but the server
   discovers retained journal changes by polling.
5. Observation polling performs the highest-frequency repeated filesystem work:
   up to three complete journal reads every two seconds in the built-in setup.
6. Request-driven catalogue refresh recursively examines broader provider
   filesystem trees but no longer runs on a steady-state timer.
7. Pending-launch recovery amplifies host snapshots by one complete snapshot per
   pending receipt per host cycle.
8. Time passing changes projected evidence freshness even when no journal or
   trusted state changes.
9. Startup snapshots and operation-specific revalidation are separate from idle
   polling and carry correctness responsibilities.
10. Hooks, catalogues and host snapshots observe different authorities; one
    cannot be removed merely because another reports related evidence.
