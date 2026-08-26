# Observatory feature roadmap and surface ownership

Status: draft for review

Date: 2026-08-26

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [V0 live Herdr universe/map](v0-live-herdr-command-centre.md)
- [Local web Observatory walking slice](local-web-observatory-walking-slice.md)

## Purpose

The visual direction has crossed the proof threshold. The next uncertainty is
usefulness: can Observatory help one operator understand, triage, resume and
verify a large body of concurrent agent work?

This document is the implementation roadmap and the ownership map for the
three surfaces. It prevents the roadmap becoming a list of disconnected UI
features and makes it explicit whether a capability belongs in the semantic
control plane, the native terminal client, the local browser client, or more
than one of them.

## Product decision: keep both clients for now

Keep the TUI and the local web client through V1 and the first real dogfood
evaluation. They are two projections of one control plane, not two competing
semantic products.

- **CORE** owns durable meaning, commands, persistence, reconciliation,
  projections and host capability boundaries.
- **TUI** is the keyboard-first operational client and the reliable terminal
  fallback. It is the fastest path to Herdr-native launch, attachment and
  recovery workflows.
- **WEB** is the primary high-fidelity orientation client. It owns the Mineral
  Atlas composition, pointer interaction, responsive layout and richer visual
  explanation.

The clients must share semantic behaviour for finding, triaging, inspecting,
assigning, completing, archiving and opening a hosted Agent. They do not need
identical geometry, key bindings or animation. A feature should not be built
twice merely because it is visually different, but a task-critical semantic
capability should not be trapped in one client without an explicit reason.

Re-evaluate this split after the one-week live-host dogfood and the Atlas versus
Ledger task comparison. Do not remove the TUI before the web client proves that
it can replace keyboard-first recovery and host-edge workflows in practice.

## Ownership contract

`CORE` means the pure Universe/projection/persistence behaviour plus the
injected host/provider edge where necessary. `TUI` and `WEB` mean renderer and
client work over those contracts; neither is allowed to invent durable state.

| Mark       | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `Done`     | Implemented and covered by the current acceptance baseline           |
| `Next`     | Required for the next product slice                                  |
| `Later`    | Valid follow-on after the next slice proves useful                   |
| `Deferred` | Deliberately excluded until new evidence or a second consumer exists |
| `—`        | Not owned by that surface for this phase                             |

## Feature ownership matrix

### Semantic model, projections and trust

| Feature                                                                                         | CORE  | TUI   | WEB   | Priority / note                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----- | ----- | ----- | ---------------------------------------------------------------------------------------------------- |
| Goal → Agent durable topology and direct assignment                                             | Done  | Done  | Done  | Shared semantic baseline                                                                             |
| Goal lifecycle, priority, description and accepted map position                                 | Done  | Done  | Done  | Web can edit metadata; web position editing is still missing                                         |
| Agent identity, rename/description and unassignment                                             | Done  | Done  | Done  | Host identity remains opaque                                                                         |
| SQLite restart, migrations and atomic commands                                                  | Done  | Done  | —     | Web goes through CORE; never reaches SQLite                                                          |
| Herdr snapshot reconciliation, stale and unknown state                                          | Done  | Done  | Done  | Web currently consumes the polled projection                                                         |
| Explainable attention with reason and age                                                       | Done  | Done  | Done  | Initial blocked/waiting/stale signals only                                                           |
| Rich attention: stalled, parent-waiting, result-returned, integration-blocked, context pressure | Next  | Next  | Next  | Biggest trust/usefulness expansion after discovery                                                   |
| Catch-up checkpoint and semantic change projection                                              | Done  | Next  | Done  | Add a compact TUI catch-up lens for client parity                                                    |
| Metadata search over goals, Agents and host/Git facts                                           | Done  | Done  | Next  | Core and TUI exist; web transport and UI are the immediate slice                                     |
| Evidence-backed related-Agent candidates                                                        | Done  | Done  | Next  | Web needs transport, inspector UI and adopt/dismiss commands                                         |
| Code-context list/map lens                                                                      | Done  | Done  | Later | Supporting lens; not a new topology layer                                                            |
| Typed delegation, dependency, result and integration relationships                              | Next  | Next  | Next  | Keep distinct from Goal → Agent and Git topology                                                     |
| Verification and handoff evidence                                                               | Next  | Next  | Next  | Distinguish runtime `done` from verified/integration-ready                                           |
| Read-only agent working-tree diff/review                                                        | Next  | —     | Done  | Web reads the primary reported workspace as bounded Git evidence; multi-repo change sets remain open |
| Cross-agent Git overlap, divergence and integration warnings                                    | Next  | Next  | Next  | Evidence and warnings, never durable map nodes                                                       |
| Provider facts and optional hooks                                                               | Later | Later | Later | Progressive enrichment; no transcript ingestion by default                                           |
| Archive history and restore lens                                                                | Later | Later | Later | Archive exists; restore/history is intentionally deferred                                            |

### Host and execution surfaces

| Feature                                                              | CORE     | TUI      | WEB      | Priority / note                                                                                          |
| -------------------------------------------------------------------- | -------- | -------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Host-owned embedded terminal                                         | Done     | Done     | Done     | SessionHost remains the only host seam                                                                   |
| Terminal input, resize, scroll, release and return-state restoration | Done     | Done     | Done     | Web primary-terminal loop is implemented                                                                 |
| Linked execution terminal and sibling picker                         | Done     | Done     | Done     | Web uses a transient `Main` + companion tab deck; Herdr prepared links use a tab in the parent workspace |
| Native foreground handoff                                            | Done     | Done     | —        | TUI/host-edge capability; browser can offer a clear explanation instead                                  |
| Start-agent coordinator and workspace preparation                    | Done     | Done     | Done     | Web and TUI share the coordinator, WorkspaceProvider and SessionHost launch capability                   |
| Host-loss recovery and live watch optimisation                       | Next     | Next     | Next     | Polling is sufficient for the walking slice; recovery must be tested live                                |
| Agent quick messages or structured approvals                         | Deferred | Deferred | Deferred | Do not broaden interaction until exact-target trust is proven                                            |
| AO daemon, concurrent clients and general event transport            | Deferred | Deferred | Deferred | Introduce only when one in-process client is a real constraint                                           |

### Presentation and navigation

| Feature                                              | CORE                 | TUI  | WEB                 | Priority / note                                                             |
| ---------------------------------------------------- | -------------------- | ---- | ------------------- | --------------------------------------------------------------------------- |
| Goal-centred Atlas/map                               | Projection           | Done | Done                | Atlas remains the primary orientation surface                               |
| Supporting Ledger/grouped list                       | Projection           | Done | Done                | Precision/scanning baseline                                                 |
| Attention queue and actionable Inbox                 | Projection           | Done | Done                | Unassigned observations stay outside map topology                           |
| Focused goal/agent view and preserved camera context | Layout/projection    | Done | Done                | Selecting a child in a focused goal must not jump the camera                |
| Semantic zoom and density control                    | Projection contract  | Done | Next                | Web has focus-driven labels but not the full TUI detail control             |
| Search-result focus into owning Goal/Agent context   | Projection           | Done | Next                | Must work from every web lens                                               |
| Persistent goal dragging and accepted anchor editing | Commands/layout      | Done | Next                | Web currently pans but does not persist moved goals                         |
| Collision-aware labels and dense-scale layout        | Layout/projection    | Done | Done/next hardening | Keep deterministic; no browser graph engine                                 |
| Context menu/action palette                          | Commands             | Done | Next                | Add accessible pointer and keyboard action entry                            |
| Theme, reduced motion and state key                  | Projection semantics | Done | Done                | Visual treatment must not carry meaning alone                               |
| Catch-up jump to affected target                     | Projection           | Next | Done                | TUI parity is the remaining client gap                                      |
| Keyboard navigation and terminal-safe fallback       | —                    | Done | Done/partial        | Web uses browser bindings; add missing semantic actions, not identical keys |

## What the original specs still leave open

These are not forgotten implementation details; they are the deliberate next
product questions from the original design:

1. **Verification is still thin.** The current inspector shows runtime and
   repository facts, but not trustworthy result evidence, review state or
   integration readiness.
2. **Attention is still narrow.** Blocked/waiting and stale observations work;
   returned results, downstream blockers, failed checks and context pressure do
   not yet form a complete attention model.
3. **Relationships are not yet durable semantics.** Related-agent evidence is
   implemented, but delegation, dependency, result consumption and integration
   still need typed observations and explicit human actions.
4. **Git topology is an incremental evidence lens.** The web now exposes a
   bounded, read-only working-tree diff for a selected Agent. Overlap,
   divergence, pull requests and checks still need typed evidence and should
   enrich decisions without turning repositories or worktrees into map nodes.
5. **The web has not yet had full live-host sign-off.** The mock and API
   baselines are green, but the browser-to-Herdr map → terminal → return,
   host-loss and resize/scroll flows still need direct dogfooding.
6. **The Atlas versus Ledger experiment is not complete.** The visual POC was
   closed, but the product decision still needs task evidence: catch-up,
   attention, dormant-work resumption, relationship discovery and outcome
   verification.

Provider adapters, transcript ingestion, a daemon, an AO-owned multiplexer,
automatic assignment/completion, and a generic graph engine remain deliberate
non-goals for this roadmap.

## Web additions required from the TUI

The web does not need every TUI affordance immediately. The following are the
meaningful gaps, in order:

### First web slice: discovery and context

1. Expose `search` and `related-agents` through the loopback API.
2. Add a browser command palette/search surface with keyboard navigation.
3. Add related-Agent evidence to the inspector with explicit adopt/dismiss.
4. Make every result preserve the owning Goal, camera context and inspector.
5. Add a read-only workspace review surface for the selected Agent's bounded
   Git diff, with file navigation, unified/split rendering and a paired
   host-terminal context.
6. Add contract tests for transport, command allow-list and human authority.

### Web parity hardening

1. Add persisted goal movement and a clear reset/revert affordance.
2. Add explicit semantic-density controls rather than relying only on focus.
3. Add an accessible action menu for related, context and host actions.
4. Add richer terminal deck actions (tab close/reopen state, explicit focus
   affordances and host-loss recovery) after live use.
5. Fix attention-jump navigation so `g` also focuses the target camera, not only
   the selection.

### TUI parity work

The reverse gap matters too: catch-up is a core projection and web surface but
does not yet have a native TUI lens. Add a compact keyboard-first catch-up view
before claiming full cross-client parity.

## Delivery sequence

### Now — Web discovery slice

- Search transport and browser command palette.
- Related-agent transport, inspector panel and adopt/dismiss actions.
- Host-provided companion-terminal deck: `Main` plus transient browser tabs,
  with Herdr prepared shells created in the parent workspace.
- Navigation/selection regression tests.
- Mock dogfood at the 12-goal/75-agent fixture.

### Next — Trust and daily operation

- TUI catch-up lens and web attention-jump hardening.
- Verification/evidence contract spike with synthetic evidence first.
- Richer deterministic attention signals.
- Live Herdr/browser resilience and terminal return acceptance.

### Later — Context and scale

- Cross-agent Git/worktree overlap, divergence and integration evidence (the
  first web working-tree diff is already part of the walking slice).
- Typed delegation/result/dependency relationships.
- Web context lens and persisted goal movement.
- Provider enrichment and broader host adapters only after the Herdr seam has
  survived real use.

Every slice should include CORE contract changes, the consuming renderer work,
deterministic fixtures, automated tests and the relevant mock/live dogfood. Do
not split work into “frontend polish” and “backend plumbing” that cannot be
validated as an operator task.

## Acceptance gate

The roadmap is working when a user managing at least 20 mixed agents can:

- explain active Goal state in under two minutes;
- identify every item requiring judgment without opening every Agent;
- find a named Agent or Goal and reach its owning context in under ten seconds;
- discover and safely adopt or dismiss related work;
- catch up on changes without losing spatial context;
- distinguish runtime completion from verified integration readiness; and
- move from overview to the correct terminal, artifact or review surface and
  return without reconstructing their place.

The map remains the primary hypothesis. If users consistently return to the
Ledger or Herdr sidebar for these tasks, simplify or change the spatial product
rather than adding more decoration.
