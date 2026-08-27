# Observatory application review

Date: 2026-08-27

Scope: product concept, architecture, maintained clients and 12-goal/75-Agent
web mock

## Summary

Observatory has a strong and coherent product premise: people supervising many
long-running agents have an attention, orientation and accountability problem,
not merely an agent-management problem. The durable Goal → Agent model is the
right V1 simplification, and the architecture protects that model from Herdr,
SQLite and renderer details unusually well.

The application is technically ahead of its product evidence. Before this
review it had already accumulated persistence, reconciliation, launch,
closeout, terminals, Catch up, workspace review and two substantial renderer
implementations, while the central Atlas-versus-Ledger hypothesis still needed
longitudinal task evidence. Product work should now favour trust and measured
usefulness over surface breadth.

## Product assessment

The differentiated product is not a planetary map. It is the combination of:

- durable organisational memory centred on intended outcomes;
- reliable catch-up after time away;
- explainable routing of scarce human attention;
- evidence-backed completion and handoff; and
- rapid movement from overview to the exact terminal, diff or artifact.

The strongest principles are goals over agents, attention over activity,
evidence over self-report, stable space over continuous layout and explicit
human authority. Those principles should remain release criteria.

The main product risk is that stable geography currently communicates Goal
membership more strongly than meaningful cross-work relationships. The Atlas
is visually distinctive, but dependency, delegation, returned-result and
integration semantics must become truthful before spatial layout can clearly
outperform a strong grouped Ledger.

## Interface assessment

The web Mineral Atlas has an exceptional identity: calm, coherent and unlike a
generic developer dashboard. At 12 goals and 75 agents, however, the complete
Atlas already pushes small labels and ambiguous peripheral detail. The open
Attention Queue materially improves the experience by adding rank, explanation
and Goal context while preserving geography. The Ledger remains faster for raw
fact scanning.

The strongest interaction composition is therefore hybrid:

```text
Catch up -> Attention -> Atlas/Ledger -> Evidence -> Terminal/Diff
```

Atlas should answer “where does this belong?”, Attention should answer “what
needs me?”, and evidence should answer “can I trust it?”. No single surface
needs to perform every job.

The native TUI was valuable evidence, but a poor long-term product constraint.
Terminal cells limit portfolio density, typography, evidence review and
multi-surface composition. Maintaining parity also duplicated interaction work
and concentrated more than 6,000 lines in the native renderer. The decision to
retire it and make the local GUI the sole maintained client is sound. Herdr can
remain the native terminal and recovery route; a future CLI should be a small
launcher/status/structured-command surface, not another UI.

## Architecture assessment

The strongest engineering decision is the flow:

```text
SessionHost -> HostSnapshot -> Universe -> Store
                                  |
                                  -> Projections -> Web GUI
```

The Universe is the only writer of accepted semantic state. Host adapters
translate opaque external facts, projections remain deterministic, SQLite is
an implementation detail, and the browser uses narrow command and capability
gateways. The mock host provides a credible deterministic evidence path without
making Herdr the control-plane model.

Retain the in-process local server until concurrent clients create a measured
need for a daemon. Retain the `SessionHost` seam, but do not add a second live
host merely to demonstrate abstraction. When product value is proven, a tmux
adapter would be a useful contract test and distribution expansion.

## Recommendations

1. Prioritise verification and richer attention before additional visual
   effects, host breadth or orchestration automation.
2. Make reported completion the signature workflow: inspect evidence, review
   changes and checks, then explicitly accept, revise, close or archive.
3. Add search and related-Agent evidence to the GUI so zero-configuration
   observations can be organised without inventing goals.
4. Run Atlas-versus-Ledger tests after 24–72 hours away. Measure correctness,
   missed signals, unnecessary Agent opens, resumption time and trust
   calibration—not visual preference alone.
5. Allow the result to change the interface. Atlas for orientation plus queues
   for execution is a success; consistent Ledger-first behaviour is evidence
   to simplify the map.
6. Keep the GUI local and browser-based. Do not adopt Electron, remote access or
   a general daemon before a concrete distribution or concurrency need exists.
7. Preserve uncertainty and human authority. Never turn missing host facts,
   inferred relationships or runtime `done` into accepted semantic truth.

## Decision log

- 2026-08-27: Retire the maintained OpenTUI client and its project-local POCs.
- 2026-08-27: Make the local React/SVG GUI the sole maintained product client.
- 2026-08-27: Keep historical isolated renderer prototypes as evidence only.
- 2026-08-27: Prefer a future minimal CLI over a second interactive client.
