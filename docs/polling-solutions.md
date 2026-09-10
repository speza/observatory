# Observatory polling solutions

Status: Herdr-first polling decision; provider-native delivery deferred

Date: 2026-09-02

Depends on: [Observatory polling analysis](polling-analysis.md)

Detailed proposal: [Control-plane events and browser projection delivery](specs/control-plane-events-and-projection-delivery.md)

## Current provider-observation decision

Herdr is the only maintained live-status source in the built-in configuration.
Claude Code, Codex and Pi harnesses do not install hooks or extensions. The
generic observation boundary remains available for a future optional plugin,
but missing provider-native evidence stays unknown rather than being inferred.

This keeps the current runtime free of hook delivery, provider journals,
extension manifests and offline replay. A future provider source must justify
the added operational surface with a concrete supervision workflow.

## Desired outcome for remaining polling

```text
normal operation: Herdr snapshots establish current execution facts
idle operation:   little repeated external work
recovery:         trusted snapshots restore current evidence
sensitive action: fresh explicit revalidation remains mandatory
browser delivery: accepted changes arrive without repeated full GET requests
```

Notifications announce possible change. Trusted snapshots establish current
evidence. This remains especially important for `SessionHost`, where complete
snapshots establish absence and operation-specific snapshots protect destructive
actions.

## Remaining pollers

The browser portfolio and pending-launch two-second loops have been replaced by
typed control-plane events and renderer projection SSE. The remaining recurring
external-source poll is the SessionHost/Herdr snapshot every 2 seconds.

There is also a bounded post-launch Herdr snapshot every 250 ms for one operation
and a 30-second disconnected-renderer safety refresh. Provider catalogues remain
startup/request-driven rather than recurring.

## Implemented browser projection delivery

Owning modules publish bounded typed events only after their state changes
persist. A closed process-local event hub orders those events. The web projection
publisher batches concurrent changes, computes shared transport-neutral
projections once, and sends complete revisioned snapshot or replacement events
over SSE.

The renderer does not replay domain events or reproduce projection logic. A new
or reconnected client receives current complete state. A disconnected client
uses the existing bounded snapshot endpoints every 30 seconds until SSE recovers.

Complete replacements are deliberate for the first implementation. Projection
deltas remain deferred until payload measurements justify their additional
identity, ordering, deletion and recovery rules. Renderer-resource invalidation
was rejected as the foundation because it discards authority-specific meaning
needed by other control-plane consumers.

## Option C: Herdr change notification plus safety sweep

If Herdr exposes a supported retained event or inventory-change stream, the
Herdr adapter can translate it into a notification that requests a normal
`SessionHost.snapshot()`. Retain:

- startup snapshot;
- reconnect snapshot;
- slow complete safety sweep; and
- fresh operation-specific revalidation.

Do not parse terminal output or infer absence from a disconnected stream.
Herdr-specific event names and reconnect behaviour remain inside
`hosts/herdr/`.

## Option D: adaptive Herdr polling

Without a supported Herdr notification interface, adapt the snapshot interval:

- short while launches or uncertain states exist;
- moderate while active executions exist;
- long while the complete inventory is stable and idle;
- immediate after explicit actions.

This reduces subprocess spawning without introducing a speculative stream seam.
The adapter must preserve serialized execution and complete-scope uncertainty.

## Implemented pending-launch delivery

The pending-launch view is local durable state. Start, retry, completion and
dismissal pass through the owning coordinator, which now publishes typed
`pending-launch-changed` events after receipt writes. The projection publisher
delivers the resulting current view, so no separate two-second browser poll is
needed.

## Rejected shortcuts

- Treat Herdr silence or stream disconnection as execution absence.
- Remove startup or sensitive-operation snapshots.
- Parse terminal output or provider transcripts to replace structured evidence.
- Build a universal event bus for three known delivery paths.
- Add a local daemon solely to remove timers.
- Restore a durable local hook journal without a demonstrated offline-replay
  workflow.

## Recommended sequence

1. Dogfood the implemented control-plane event and renderer projection stream
   under parallel provider, command, launch and host changes.
2. Measure renderer projection calculation, serialization, stream volume and
   reconnect behaviour before adding deltas.
3. Measure Herdr subprocess cost and latency.
4. Use a supported Herdr notification stream if one exists; otherwise add
   adaptive polling before inventing another host interface.
5. Exercise startup, host loss, target reuse and long-running server behaviour.

## Success criteria

- Startup remains truthful with no provider replay.
- Browser idle work falls substantially without weakening reconnect recovery.
- Herdr absence is accepted only from a complete trusted snapshot.
- Closeout and terminal access retain fresh target checks.
- Universe, persistence, projections and renderer interfaces remain free of
  Herdr protocol concepts.
