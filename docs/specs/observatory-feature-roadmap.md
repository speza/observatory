# Observatory feature roadmap

Status: accepted web-first direction; plugin and harness baseline implemented

Date: 2026-08-28

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Local web Observatory walking slice](local-web-observatory-walking-slice.md)
- [Agent harness plugins](agent-harness-plugins.md)
- [Provider-session continuity and execution recovery](provider-session-continuity-and-recovery.md)
- [Agent repository and code-host plugins](agent-repository-and-code-host-plugins.md)

## Product decision

Observatory has one maintained client: the local web GUI. The native TUI was
retired after proving the product boundaries because graphical interfaces have
the stronger long-term fit for portfolio density, evidence, diffs, multiple
terminal surfaces, accessibility and rapid iteration.

`CORE` owns durable meaning, commands, persistence, reconciliation, projections
and host capabilities. `WEB` owns the Atlas, Ledger, attention and review
experience. A future command-line interface may start the server, report status
or submit structured commands, but it must not become a second interactive UI.
Herdr remains the terminal-native fallback for provider-specific or recovery
workflows.

## Current baseline

| Feature                                          | CORE       | WEB  | Note                                 |
| ------------------------------------------------ | ---------- | ---- | ------------------------------------ |
| Goal → Agent topology and assignment             | Done       | Done | Durable semantic baseline            |
| Goal lifecycle, priority and accepted position   | Done       | Done | Auto-repair plus drag-to-pin         |
| SQLite persistence and atomic commands           | Done       | —    | Browser never accesses SQLite        |
| Herdr reconciliation and uncertainty             | Done       | Done | Snapshot polling walking slice       |
| Explainable blocked/waiting/stale attention      | Done       | Done | Initial signal vocabulary only       |
| Catch-up checkpoint and semantic changes         | Done       | Done | Explicit acknowledgement             |
| Atlas, Ledger, Inbox and Closeout                | Projection | Done | One model, several lenses            |
| Host-owned terminal and linked executions        | Done       | Done | xterm.js renders host streams        |
| Agent launch and workspace preparation           | Done       | Done | Shared coordinator                   |
| Agent-harness plugins and exact resume           | Done       | Done | Claude and Codex live-validated      |
| Provider catalogue and dormant-session recovery  | Done       | Done | Scoped rebinding and exact resume    |
| Contributed plugins and repository status        | Done       | Done | GitHub is the first code-host plugin |
| Host-synchronised closeout                       | Done       | Done | Close before semantic archive        |
| Read-only working-tree review                    | Done       | Done | Bounded server-side path resolution  |
| Search and related-Agent evidence                | Done       | Next | Immediate discovery slice            |
| Verification and handoff evidence                | Next       | Next | Major trust gap                      |
| Rich deterministic attention                     | Next       | Next | Major usefulness gap                 |
| Typed delegation/result/dependency relationships | Next       | Next | Preserve provenance                  |
| Cross-agent Git and integration warnings         | Next       | Next | Evidence, not map nodes              |

## Product risks still to prove

1. **Verification is thin.** Runtime `done`, local repository state and bounded
   pull-request/check facts are visible, but trustworthy result and handoff
   evidence remains incomplete.
2. **Attention is narrow.** Returned results, downstream blockers, failed
   checks, stalled work and context pressure do not yet form a complete model.
3. **Atlas geography is stable but not sufficiently semantic.** Goal membership
   is clear; delegation, dependency, handoff and integration relationships are
   not yet represented truthfully enough to prove that space beats a strong
   Ledger.
4. **The GUI needs full live-host sign-off.** Mock and API coverage are strong;
   browser → Herdr terminal → return, host loss and resize/scroll need sustained
   real use.
5. **Atlas versus Ledger remains unproven.** Preference and visual character are
   not evidence of faster, more accurate supervision.

Provider transcript ingestion, a remotely accessible service, an AO-owned
multiplexer, automatic assignment/completion and a generic graph engine remain
non-goals.

## Delivery sequence

### Now — discovery and context

1. Implement metadata-only Claude and Codex provider-session catalogues and a
   full-screen Session import lens.
2. Prove laptop/Herdr restart as `dormant/resumable`, with exact resume into a
   new execution and no automatic continuation.
3. Expose search and related-Agent projections through the loopback API.
4. Add a browser command palette with keyboard navigation.
5. Add related-Agent evidence with explicit adopt and dismiss commands.
6. Preserve owning Goal, camera context and inspector for every result.
7. Complete live browser acceptance for terminal return and host loss.
8. Dogfood repository/code-host status against real Agent pull requests and
   preserve ambiguity when more than one candidate matches.

### Next — trust and daily operation

1. Define a verification/evidence contract with synthetic evidence first.
2. Add deterministic returned-result, stalled, failed-check and downstream
   blocker attention signals.
3. Make completion a coherent flow: reported done → inspect evidence → review
   diff/checks → accept, revise, close or archive.
4. Harden terminal tabs, resize, release and host-loss recovery from real use.
5. Add explicit semantic-density controls.

### Later — relationships and scale

1. Add typed delegation, result, dependency and integration relationships.
2. Surface cross-Agent workspace overlap, divergence and integration risk.
3. Add provider enrichment only through provenance-bearing plugin observations.
4. Evaluate a second production host only after Herdr workflows prove useful;
   use it to validate `SessionHost`, not broaden the domain model.

## Evaluation gate

Compare Atlas and Ledger with the same 20–40 Agent world. The decisive session
is a return after 24–72 hours of realistic changes. Measure whether the operator
can:

- explain active Goal state in under two minutes;
- identify every item requiring judgment without opening every Agent;
- find a named Goal or Agent and reach its context in under ten seconds;
- catch up without losing orientation;
- distinguish runtime completion from verified integration readiness; and
- reach the correct terminal, artifact or review surface and return without
  reconstructing their place.

If users consistently use Ledger or Herdr to orient, simplify or change the
spatial product. Do not defend the Atlas by adding decoration.
