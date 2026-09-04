# Observatory documentation

This index separates current product and architecture decisions from supporting
implementation records. Git history preserves retired proposals and completed
review documents; they are not kept in the current tree when a newer document
owns the decision.

## Start here

- [Goal-centred agent orchestration map](design/agent-orchestration-map.md) —
  product model and spatial hypothesis.
- [Technical architecture](design/technical-architecture.md) — trusted module
  boundaries and composition.
- [Feature roadmap](specs/observatory-feature-roadmap.md) — current baseline and
  next product evidence.
- [Conversation-first Agent tracking](specs/conversation-first-agent-tracking.md)
  — canonical Agent identity, continuity and recovery model.

## Current design decisions

- [Plugin architecture](design/plugin-architecture.md)
- [Technology decisions](design/technology-decisions.md)
- [Browser terminal interaction](design/terminal-interaction.md)
- [Naming decision](design/naming.md)
- [Competitive landscape and spatial product bet](design/competitive-landscape-and-spatial-product-bet.md)

## Current implementation specifications

These documents retain detailed invariants that are not repeated in the
architecture overview.

- [Agent launch and workspace preparation](specs/session-launch.md)
- [Agent harness plugins](specs/agent-harness-plugins.md)
- [Provider-native Agent observations](specs/provider-native-agent-observations.md)
- [Plugin system](specs/observatory-plugin-system.md)
- [Repository status and code-host plugins](specs/agent-repository-and-code-host-plugins.md)

## Active product specifications and investigations

- [Multi-pane Agent review](specs/multi-pane-agent-review.md) — accepted next
  slice for bounded file, source, diff, evidence and terminal review.
- [Structured conversation interaction](specs/structured-conversation-interaction.md) —
  feasibility and stop gates for an optional native conversation surface.

## Guides and operations

- [Plugin contributor guide](guides/plugin-contributor.md)
- [Provider observation hooks](guides/provider-observation-hooks.md)

## Historical evidence

Disposable UI and rendering investigations live under [`prototypes/`](../prototypes/).
They are evidence for decisions, not maintained product code. The retired
OpenTUI experiments retain their findings but no runnable implementations or
package dependencies. Superseded specs,
future-scope proposals, dated reviews and one-off manual test records remain
available through Git history rather than competing with current documentation.

## Maintenance rule

A document belongs in the current tree only when it owns an accepted decision,
defines a maintained interface or invariant, guides a supported workflow, or
tracks an active product direction. When a replacement becomes canonical,
update inbound links and remove the superseded document in the same change.
