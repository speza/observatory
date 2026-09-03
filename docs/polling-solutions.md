# Observatory polling solutions

Status: solution options after ephemeral provider-hook delivery

Date: 2026-09-02

Depends on: [Observatory polling analysis](polling-analysis.md)

## Accepted provider-observation decision

Provider hooks now use best-effort authenticated loopback delivery while the
Observatory control plane is running:

```text
hook event -> bounded invalidation payload -> harness receiver
           -> immediate trusted snapshot -> coordinator reconciliation
```

There is no provider journal or file watcher, and built-in hook sources require
no provider-observation polling loop. Pull-only contributed sources retain their
snapshot timer. Herdr remains the restart-recovery source for current execution truth. Missing
provider events remain unknown, and Catch up does not claim to be a complete
provider audit history.

This decision removes idle journal reads, JSONL parsing, locking, compaction,
file-change detection and offline replay. A durable host-local outbox may be
added for future remote sites only if disconnected delivery becomes a measured
requirement.

## Desired outcome for remaining polling

```text
normal operation: source notifications wake bounded reconciliation
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

1. Browser portfolio, every 2 seconds.
2. Browser pending launches, every 2 seconds.
3. SessionHost/Herdr snapshot, every 2 seconds.
4. Bounded post-launch Herdr snapshots, every 250 ms for one operation.

Provider catalogues remain startup/request-driven rather than recurring.

## Option A: browser projection versions

Expose a monotonically increasing server projection version or ETag. Browser
requests can receive `304 Not Modified` or a small unchanged response rather
than the complete portfolio.

This preserves the current request lifecycle and reconnect behaviour while
reducing serialization, transfer and React replacement. Timers still wake.

## Option B: server-to-browser invalidation

Extend the existing SSE infrastructure with a portfolio-invalidated message.
The browser then requests the normal bounded projection. Keep a slow safety
refresh or version comparison for reconnect repair.

The notification must carry no mutable domain payload. One coalesced
invalidation is preferable to reproducing every internal change as browser
events.

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

## Option E: pending-launch invalidation

The pending-launch view is local durable state. Start, retry, completion and
dismissal already pass through known coordinators, so those operations can
invalidate the browser view directly. A separate two-second poll is probably
unnecessary once browser invalidation exists.

## Rejected shortcuts

- Treat a hook event as host execution truth.
- Treat Herdr silence or stream disconnection as execution absence.
- Remove startup or sensitive-operation snapshots.
- Parse terminal output or provider transcripts to replace structured evidence.
- Build a universal event bus for three known delivery paths.
- Add a local daemon solely to remove timers.
- Restore a durable local hook journal without a demonstrated offline-replay
  workflow.

## Recommended sequence

1. Dogfood ephemeral hooks and verify that Herdr waiting/blocked state is useful
   when a provider event is intentionally missed.
2. Add browser projection versioning or invalidation to remove duplicate full
   portfolio work.
3. Fold pending-launch updates into the same browser invalidation path.
4. Measure Herdr subprocess cost and latency.
5. Use a supported Herdr notification stream if one exists; otherwise add
   adaptive polling before inventing another host interface.
6. Exercise startup, host loss, target reuse and long-running server behaviour.

## Success criteria

- Provider events appear promptly while Observatory runs and never interrupt a
  provider when it does not.
- Startup remains truthful with no provider replay.
- Browser idle work falls substantially without weakening reconnect recovery.
- Herdr absence is accepted only from a complete trusted snapshot.
- Closeout and terminal access retain fresh target checks.
- Universe, persistence, projections and renderer interfaces remain free of
  Herdr protocol concepts.
