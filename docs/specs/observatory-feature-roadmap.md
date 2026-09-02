# Observatory feature roadmap

Status: current product direction
Updated: 2026-09-02

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Technical architecture](../design/technical-architecture.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Agent harness plugins](agent-harness-plugins.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)
- [Repository status and code-host plugins](agent-repository-and-code-host-plugins.md)

## Product decision

Observatory has one maintained client: the local React GUI. The spatial Atlas is
the primary product hypothesis. Ledger, Needs you, Catch up, Inbox, inspector,
workspace review and terminals are supporting lenses over the same state.

The immediate goal is not broader infrastructure. It is to prove that the
implemented local product improves human supervision of realistic concurrent
agent work.

## Implemented baseline

| Capability                                            | State       | Evidence                                                  |
| ----------------------------------------------------- | ----------- | --------------------------------------------------------- |
| System → Goal → Agent organisation                    | Implemented | Durable Universe and SQLite tests                         |
| Human Goal priority, completion, archive and position | Implemented | Command and restart tests                                 |
| Conversation-first Agent identity                     | Implemented | Provider-first/host-first convergence tests               |
| Herdr execution reconciliation                        | Implemented | Shared host contract and live smoke path                  |
| Deterministic mock host                               | Implemented | Healthy, degraded and recovery scenarios                  |
| Atlas and Ledger                                      | Implemented | Shared projection and browser tests                       |
| Needs-you decision composition                        | Implemented | Independent host/provider claims compose per Agent        |
| Durable Goal-level Catch up                           | Implemented | Explicit checkpoint and synthesis tests                   |
| Inbox and Conversation history                        | Implemented | Explicit add plus Observatory-managed launch admission    |
| New launch and exact resume                           | Implemented | Idempotent coordinator and browser gateway tests          |
| Claude Code, Codex and Pi harnesses                   | Implemented | Plugin contract and live validation                       |
| Metadata-only provider observations                   | Implemented | Activity, input, outcome and context evidence             |
| Host-owned primary and linked terminals               | Implemented | Mock and Herdr stream contract tests                      |
| Repository and code-host status                       | Implemented | Bounded local reader and plugin evidence                  |
| Working-tree diff review                              | Implemented | Trusted Agent lookup and bounded diff tests               |
| Host-synchronised close and archive                   | Implemented | Revalidation and failure-path tests                       |
| Search and browser preference retention               | Implemented | Browser and projection tests                              |
| Related-Agent evidence projection                     | Core only   | Deterministic projection exists; product workflow pending |

## Risks to prove

### Spatial value

Atlas geography is stable, but it is not yet proved to outperform Ledger for
orientation and catch-up. Visual character is not evidence. The decisive test is
whether operators remember where work is and make fewer navigation errors after
time away.

### Verification depth

Runtime completion, provider outcome, local repository state, pull-request facts
and working-tree diffs are visible, but trustworthy handoff and integration
evidence remains incomplete. Observatory must help the operator decide, not
merely make `done` prominent.

### Attention coverage

Human-input requests, blocked/waiting state, result review and lifecycle
uncertainty compose correctly. Failed checks, downstream blockers, stalled work
and integration risk are not yet a complete model.

### Daily reliability

Mock and automated coverage are strong. Browser terminal return, host loss,
restart recovery, long-running observation hooks and closeout still require
sustained use against disposable real Agents.

## Now: evaluate the implemented product

1. Dogfood Atlas and Ledger over the same realistic 20–40 Agent portfolios.
2. Run return-after-absence sessions at 24–72 hours and record missed decisions,
   unnecessary Agent opens, completion time and confidence.
3. Exercise browser → Herdr terminal → return, restart, host-loss and exact-resume
   paths repeatedly with disposable work.
4. Review real pull requests and dirty worktrees through the inspector and diff
   surfaces; preserve ambiguous associations.
5. Measure whether Needs you and Catch up replace manual reconstruction rather
   than adding another inbox.
6. Keep screenshots, fixtures and public evidence synthetic or sanitised.

## Next: deepen trust and spatial meaning

1. Define a typed verification and handoff evidence contract.
2. Add failed-check, stalled, returned-result and downstream-blocker decisions
   without creating one queue item per raw claim.
3. Complete the human-controlled flow from reported result to inspect, revise,
   accept, close or archive.
4. Add the Related-Agent review/adopt/dismiss workflow over the existing
   projection; never auto-assign from weak similarity.
5. Introduce only the typed delegation, result, dependency or integration
   relationships that improve concrete supervision tasks.
6. Surface cross-Agent workspace overlap and integration risk as evidence, not
   new organisational nodes.
7. Add explicit semantic-density controls only if focus and Ledger do not solve
   realistic Atlas density.

## Later: broaden only after evidence

- Evaluate a second production SessionHost to validate the existing seam, not to
  broaden the Universe model.
- Consider richer read-only provider or code-host facts when they improve a
  measured decision workflow.
- Consider remote observation or another client only after an explicit product
  decision and a concrete local limitation.
- Consider narrow automation only when its authority, preview, reversibility and
  failure semantics are explicit.

A daemon, remote control plane, Observatory-owned multiplexer, transcript
pipeline, automatic completion/merge/archive and generic graph engine remain
out of scope.

## Evaluation gate

Compare Atlas and Ledger over identical state. After time away, measure whether
the operator can:

- explain active Goal state in under two minutes;
- identify every subject requiring judgment without opening every Agent;
- find named work and reach its context in under ten seconds;
- distinguish runtime completion from verified integration readiness;
- reach the correct terminal or review surface and return without losing place;
  and
- recall stable Goal locations across sessions.

If Ledger or Herdr consistently wins orientation, simplify or change the spatial
product. Do not defend Atlas by adding decoration.
