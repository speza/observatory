# Observatory polling analysis

Status: current-state analysis for review; no product decision

Date: 2026-09-02

Related documents:

- [Observatory polling solutions](polling-solutions.md)
- [Observatory technical architecture](design/technical-architecture.md)
- [Provider-native Agent observations](specs/provider-native-agent-observations.md)

## Purpose

This document describes where Observatory polls today, what work each poll
performs and which source owns the resulting facts. It does not choose a future
event transport.

## Executive summary

Observatory's built-in configuration now has one steady-state external-source
polling loop: the server snapshots the selected `SessionHost` every 2 seconds.

The browser receives renderer-ready projection snapshots and replacements over
SSE. A disconnected stream uses a 30-second HTTP safety refresh; connected
browsers do not poll portfolio or pending-launch endpoints. A process-local
30-second projection refresh updates time-derived presentation while subscribers
exist, but performs no external acquisition.

Provider conversation catalogues refresh at startup and on explicit Conversation
history requests. The built-in harnesses do not install provider hooks or
extensions, so Herdr is the only maintained live execution source. A future
contributed pull-only observation source may add its own bounded refresh loop.
There is also one bounded operation-local Herdr poll after launch.

| Poll or timed recovery                                 | Default interval | Work performed                                                |
| ------------------------------------------------------ | ---------------: | ------------------------------------------------------------- |
| Session host                                           |        2 seconds | Spawn `herdr api snapshot`, translate and reconcile inventory |
| Disconnected browser safety refresh                    |       30 seconds | Fetch portfolio and pending state until SSE recovers          |
| Renderer time-derived refresh (not source acquisition) |       30 seconds | Rebuild cached projections for connected renderers            |
| Herdr post-launch observation                          | 250 milliseconds | Snapshot until the launched pane is recognised, bounded       |

For a connected browser and no pending launch, defaults produce no recurring
portfolio or pending-launch HTTP requests. The server still performs about 30
Herdr snapshot subprocesses per minute. Closing the browser stops renderer time
refresh while the server continues observing Herdr.

An OpenCode pane without a native session report triggers one bounded
`herdr pane process-info` query per terminal. The adapter caches the recognised
foreground process for that terminal, so later snapshots reuse the evidence
instead of spawning another query.

## Current end-to-end data flow

```text
Claude/Codex/Pi catalogue request
    -> bounded provider metadata snapshot
    -> ConversationTracker
    -> conversation history and Universe observations

Herdr inventory
    -> 2-second `herdr api snapshot` process
    -> ConversationTracker canonicalisation
    -> Universe host reconciliation
    -> pending-launch recovery

Universe + evidence store + launch receipts
    -> committed typed control-plane events
    -> batched server-side renderer projections
    -> SSE snapshot/replacement stream
    -> React state
```

The evidence authorities remain independent:

- provider catalogues contain recoverable conversation identity and metadata;
- `SessionHost` snapshots contain execution presence, placement, lifecycle and
  host availability; and
- Universe commands contain accepted human semantic state.

An optional future provider-observation plugin may add provider activity,
input, outcome or context evidence through the generic observation boundary.

## What counts as polling

Polling means repeatedly reading a source on a timer to discover change. It does
not include:

- startup reconciliation;
- an explicit Conversation history refresh;
- fresh revalidation before a sensitive operation;
- an SSE heartbeat;
- a timeout that bounds work; or
- the bounded post-launch wait.

## Renderer projection delivery

Universe, provider-evidence and pending-launch modules publish bounded typed
events only after accepted writes. A process-local event hub assigns an epoch
and sequence. The web projection publisher batches concurrent events for 250 ms,
rebuilds affected deterministic projections once, and fans cached complete
projection replacements out over SSE.

A new renderer receives one complete snapshot. Slow renderers retain only the
latest replacement and reconnect with another complete snapshot; they do not
replay control-plane history. The browser validates projection schemas and never
reduces domain events itself.

The former portfolio and pending-launch two-second timers are removed. While SSE
is disconnected, one 30-second safety timer fetches both existing snapshot
endpoints. This preserves repair without making fallback polling the normal
delivery path.

## Session-host polling

The web composition root snapshots `SessionHost` every two seconds through a
serialized loop. For live V1 the Herdr adapter launches `herdr api snapshot`,
validates and translates the bounded response, then `ConversationTracker`
submits canonical host observations to Universe and refreshes pending launches.

This poll establishes execution presence and complete-scope absence. It cannot
be replaced by provider hooks because hook loss or silence proves neither
presence nor absence. Sensitive closeout and terminal actions retain their own
fresh target revalidation.

## Bounded post-launch polling

After a process launch, the Herdr adapter may snapshot at 250 ms intervals until
the new pane appears or the bounded deadline expires. This bridges process-start
acknowledgement and inventory visibility and supports exact launch correlation.
It is operation-local rather than idle steady-state work.

## Optional provider observations

Provider-native observations are deliberately deferred. The generic
`AgentObservationSourceV1` and receiver boundary remains available for a future
plugin, but no built-in Claude Code, Codex or Pi source is installed or loaded.
Herdr restores current execution truth on startup; provider-specific reasons
remain unknown until an optional source can establish them.

## Time-derived observation changes for optional sources

If a future provider source is loaded, its evidence will have useful lifetimes:

| Evidence kind       | Built-in freshness |
| ------------------- | -----------------: |
| Activity            |          2 minutes |
| Human-input request |         30 minutes |
| Turn outcome        |           24 hours |
| Context pressure    |         10 minutes |

Projection enrichment compares current time with `observedAt`, so optional
evidence can become stale without a new provider event. No built-in provider
source currently produces these records.

## Provider catalogue refresh

Provider catalogues are request-driven. Startup obtains one bounded snapshot;
opening or refreshing Conversation history requests another. Catalogues do not
run continuously and cannot admit an Agent without an explicit add action or a
proven managed launch.

## Current duplicated and idle work

The remaining obvious repeated external work is full Herdr subprocess snapshots
when inventory is unchanged. The browser's former unchanged portfolio and empty
pending-launch retrieval loops no longer exist.

There is no built-in provider journal, hook delivery or provider polling loop.
A provider polling loop exists only when a future loaded observation source
exposes no live receiver.

## Failure and uncertainty

- A failed Herdr snapshot marks host evidence unavailable; it does not prove
  executions absent.
- Missing provider-native evidence leaves provider semantics unknown; Herdr
  current state remains authoritative for execution.
- A failed catalogue refresh preserves earlier conversation metadata with
  degraded health.
- Browser request failure preserves the last rendered projection until retry.
- Optional provider notifications never replace fresh operation-specific checks.

## Current conclusion

With the built-in configuration and a connected renderer, Observatory has one
recurring external-source poller: SessionHost. It remains the highest-cost and
most correctness-sensitive loop because it launches a Herdr subprocess and
establishes execution presence and absence. Browser delivery is event-driven;
provider semantic enrichment is deferred and has no built-in delivery path.
