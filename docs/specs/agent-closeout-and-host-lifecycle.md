# Agent closeout and host lifecycle

Status: implemented web closeout slice; policy automation deferred

Date: 2026-08-27

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Observatory feature roadmap](observatory-feature-roadmap.md)
- [Provider-session continuity and execution recovery](provider-session-continuity-and-recovery.md)

> **Continuity amendment, 2026-08-28:** the implemented closeout slice used
> `stale` as a proxy for host absence. The target recovery model separates
> stale evidence, confirmed execution absence and provider-session continuity.
> Only a fresh complete host snapshot can prove that no execution is present.

## Why

Observatory currently preserves human authority by requiring explicit archive,
but this makes the operator perform repetitive cleanup. It also creates two
lifecycles: archiving an Agent in Observatory does not stop its live execution
in the session host.

The web client should provide one trustworthy closeout workflow. It should make
finished work easy to review, move ended work out of the active universe, and
keep Observatory and the host in sync without converting runtime state or host
absence into accepted completion.

## Product decisions

- **Close & archive** is the primary action for a live Agent. It closes the
  host-owned execution and archives the durable Observatory record.
- **Archive only** remains available as a secondary explicit action. It hides
  the Agent from active Observatory projections but leaves its host execution
  running.
- A dormant Agent has a confirmed provider session and no current execution, so
  its closeout action archives the Observatory record without a host close.
- A stale or unavailable Agent has unknown execution presence. Its explicit
  action is `Archive only`; Observatory must not claim that execution stopped.
- Runtime `done` is not authoritative completion. Done Agents remain awaiting
  review until the operator accepts, keeps or archives them.
- Stale Agents may be automatically shelved from the Atlas into a reversible
  closeout projection after a grace period. Shelving is presentation state, not
  archive or completion.
- Automatic host termination is out of scope for the first slice. Any later
  policy must be explicit, visible and reversible where possible.

## Operator workflow

The web client adds a **Closeout** surface with two lanes:

1. **Results to review** contains live Agents reporting `done`. The primary
   action is `Review`; after inspection the operator can choose
   `Accept & close`, `Keep active` or `Archive only`.
2. **No current execution** contains Agents whose absence is confirmed by a
   fresh complete host snapshot. Stale or unavailable Agents remain a separate
   uncertain subset and can only be archived explicitly.

Goals and the portfolio header show compact closeout counts such as
`2 results · 3 ended`. Shelved Agents no longer consume normal Atlas space, but
the count and Closeout surface keep them discoverable. Goal completion may
offer `Complete goal and archive settled Agents`; it must not silently accept
unreviewed results.

Working or blocked Agents can still be closed, but the confirmation must state
that execution will stop. The first bulk close action is limited to `done`
Agents. Bulk archive may include confirmed dormant Agents. It must not imply
that stale or unavailable executions are already absent.

## Architecture

`SessionHost` remains the only host seam. Extend its per-Agent capability model
with a generic close capability and one close operation. The interface should
express host capability and outcome; it must not expose panes, tabs, process
signals or Herdr commands.

The Herdr adapter maps that operation to the host-supported pane close action.
It resolves and revalidates the opaque Agent target immediately before closing
so a missing, changed or reused pane fails closed. Revalidation binds both the
terminal container and the opaque provider conversation occupying it; a new
conversation in the same pane is a changed target. After Herdr accepts the close,
the adapter takes another host snapshot and only reports success when that exact
pane is absent. A close acknowledgement without observed absence leaves the
Observatory Agent active. The mock adapter provides the deterministic contract
evidence path.

A closeout coordinator owns the cross-module ordering behind one small
interface. Both pre-close and post-close snapshots go through the composition
root's canonical host-observation path before reaching Universe. Closeout must
not bypass provider identity enrichment by writing a raw host snapshot directly.
If that canonical observer is unavailable, closeout itself is unavailable:

```text
Web action
  -> closeout coordinator
      -> resolve current Agent
      -> request fresh SessionHost access
      -> close host execution
      -> canonically reconcile a fresh host snapshot
      -> submit ArchiveAgent to Universe
  -> refreshed projection
```

Host closing is asynchronous Effect work at the control-plane edge. Archive
remains a synchronous Universe command and the Universe remains the only writer
of trusted Observatory state. The normal web command gateway must not grow
host-specific side effects.

## Failure semantics

- If the close capability is unsupported, present `Archive only`; do not imply
  that the host execution stopped.
- If target revalidation or host close fails, leave the Agent active and report
  the exact host error.
- If multiple executions claim the Agent, reject closeout without choosing or
  archiving any execution.
- If the host inventory is partial, it cannot prove execution absence and
  closeout fails without mutation.
- If the host accepts close but still reports the target, or its target identity
  is reused before verification, leave the Agent active and report that the
  close was not confirmed.
- If an Agent that was live when close was requested disappears from the fresh
  host observation, fail without archiving. A live close request must never
  downgrade into `Archive only`; the operator can refresh and retry or choose
  the separate archive-only action explicitly.
- If host close succeeds but archive persistence fails, reconciliation leaves a
  stale record visible in Closeout so local archive can be retried.
- If the host is unavailable, fail closed. Host unavailability does not prove
  that a particular Agent ended.
- Repeated close requests must be safe: an already-ended execution can converge
  on the same archived Observatory state.
- A uniquely scoped provider observation may consolidate a persisted unscoped
  duplicate created by an older Observatory bug. Consolidation retains the
  scoped Agent identity and preserves human metadata and assignment. An
  unscoped observation never downgrades an existing scoped identity.

## Delivery status

### Slice 1 — one safe close path (implemented)

- Add the generic per-Agent close capability to `SessionHost`.
- Implement mock and Herdr adapter behaviour with target revalidation.
- Add the closeout coordinator and a loopback web endpoint.
- Add `Close & archive` and `Archive only` to the selected-Agent action surface.
- Prove done, working, stale, unsupported, reused-target and partial-failure
  paths through contract and web tests.
- Exercise the adapter against a disposable live Herdr Agent; existing user
  sessions must never be used as closeout test targets.

### Slice 2 — closeout inbox (implemented)

- Add a deterministic closeout projection for results awaiting review and
  Agents ended externally.
- Add portfolio and per-Goal counts plus the web Closeout drawer.
- Connect `Review` to the existing inspector without losing Atlas context; the
  inspector retains its existing terminal and workspace-review actions.
- Add batch archive for stale Agents and batch close for reviewed done Agents.
- Exercise the workflow at the 12-Goal/75-Agent mock scale.

### Slice 3 — reduce recurring housekeeping (deferred pending evidence)

- Add a configurable grace period before stale Agents are shelved.
- Add `Complete goal and archive settled Agents` with an explicit preview.
- Measure closeout backlog, unnecessary confirmations, incorrect closures and
  time spent maintaining the active universe.
- Only after live evidence, consider an explicit policy for automatic archive
  or close of narrowly defined Agent states.

## Acceptance

The feature is ready when:

- closing a live Agent from the web reliably closes the correct host execution
  and archives the same Observatory Agent;
- no failure path reports success while the host and Universe disagree;
- done results remain visibly unverified until a human decision;
- stale cleanup can be completed as one bounded batch;
- the active Atlas stays useful without deleting history or hiding uncertainty;
  and
- mock contract tests plus live Herdr dogfood cover close, already-ended,
  unsupported and stale-reconciliation paths.
