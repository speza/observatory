# Observatory plugin architecture

Status: accepted boundary; contributed plugin system implemented

Date: 2026-08-23

Last clarified: 2026-09-07

Depends on: [Observatory technical architecture](technical-architecture.md)

## Direction

The Observatory control plane is a small trusted kernel. Every capability added
around that kernel is a plugin, including first-party capabilities such as the
Herdr agent host. GitHub pull requests, Jira or Linear issues, agent-provider
facts, extra render lenses, skills and hooks must not become special cases in
the Universe or renderer.

This policy now includes a real contributed plugin system. The first runtime
loads only explicitly configured local packages, keeps them in-process and
trusted, and preserves a path to an isolated process later. It is not a request
to build a marketplace, automatic installer or universal extension framework.

The governing principle is:

> Everything outside the trusted semantic kernel should be replaceable through
> a plugin contract.

"Plugin" describes the architectural relationship, not necessarily a package
loaded dynamically at runtime. Some capabilities, such as `SessionHost`, are
best expressed as composition-time ports. Others use the contributed package
runtime. Renderer contributions need a constrained presentation contract. All
three follow the same rule: the implementation can be replaced without moving
its provider-specific concepts into the kernel.

This does not mean turning every module, function or component into an
extension point. Observatory should remain an opinionated product, not a
framework assembled from arbitrary callbacks. Add a plugin boundary where a
capability has independent implementations, optional availability, external
I/O or a credible reason to evolve separately. Keep cohesive product behaviour
inside a deep core module when no such boundary exists.

## Why this is foundational

Agent providers, execution hosts, tools and operator workflows will change more
quickly than Observatory's durable semantic model. Agents will also be able to
create and maintain integrations themselves. Versioned, narrow capability
contracts let that edge evolve rapidly without granting generated or
third-party code authority over accepted state.

The benefit is not extensibility for its own sake. It is preserving a stable
human control plane while the surrounding agent ecosystem changes. The kernel
provides coherence and trust; plugins provide adaptation and reach.

## Kernel versus plugin

The kernel owns:

- trusted systems, goals, agents, typed relationships and lifecycle invariants;
- SQLite persistence and explicit clean-break schema boundaries;
- provenance, uncertainty and human authority;
- deterministic attention and projections; and
- generic renderer, interaction and capability contracts.

Plugins own translation and optional capability. A plugin may observe external
systems, expose a capability, or propose semantic facts. It must not write
SQLite, bypass Universe commands, or turn an unverified external fact into
trusted state. The kernel can disable or lose a plugin without losing accepted
goals, agents or navigation.

First-party implementations receive no architectural privilege. Herdr, GitHub,
Codex and built-in lenses should satisfy the same contracts and failure rules as
contributed equivalents. A built-in may be packaged differently when that keeps
the system simpler, but it must not gain a private route into kernel state.

```text
external system
      │
      ▼
plugin adapter ── observations / proposals / capabilities ──► kernel ports
      ▲                                                        │
      └──────── read-only snapshots / commands / events ◄──────┘
```

## Initial plugin categories

These are capability categories, not a promise to implement all of them in
v1:

- **Agent host** — Herdr first; later tmux, Superlogical-style hosts or an
  Observatory-owned host behind `SessionHost`.
- **Workspace provider** — recent project locations, Git inspection and
  worktree preparation for agent launch. The first implementation is local
  Git; it is not a new map topology node.
- **Agent harness** — Claude Code, Codex, OpenCode, Pi and other coding-agent
  CLIs. Each harness plugin owns availability, structured new-session and
  resume plans, provider-owned session catalogue and identity acquisition, and
  any optional provider facts or richer controls. Identity may arrive
  asynchronously through hooks, a structured provider interface or another
  declared observation mechanism; lack of one remains explicit. `SessionHost`
  executes those plans in a host-owned surface and may contribute host-assisted
  restore or agent-aware evidence; it does not choose provider commands or
  define resume semantics.
- **Code host** — GitHub first; later contributed GitLab or Bitbucket plugins
  providing pull requests, checks, reviews and merge state.
- **Related work** — Jira issues, Linear tickets and similar external
  references attached to a goal or agent.
- **Projection/lens** — optional attention, relationship or detail views that
  consume core projections rather than querying SQLite directly.
- **Renderer contribution** — bounded evidence, badges, actions or inspector
  sections attached to a core view through typed presentation data. This is a
  direction for the renderer contract, not an implemented arbitrary-component
  API.
- **Automation** — agent commands, skills and hooks that submit normal kernel
  commands or proposals.

The default map should show related work as inspector metadata or an optional
lens, not as a new required topology node. A missing integration must remain a
clear absence, not an inferred relationship.

## Renderer and Agent-card boundary

Agent cards are part of Observatory's core interaction language. Their identity,
goal relationship, lifecycle state, attention treatment, selection behaviour,
primary navigation and accessibility remain renderer-owned. Making the entire
card an arbitrary plugin surface would fragment the product and allow optional
code to obscure trusted state.

The card should instead expose bounded contribution slots. A plugin may
contribute typed, serializable data for:

- status or evidence badges with provenance and freshness;
- secondary actions routed through declared capabilities or kernel commands;
- inspector sections and summaries; and
- optional overlays that do not replace core identity or lifecycle state.

Plugins should not initially contribute arbitrary React components, CSS or
event handlers. The renderer maps contribution descriptors onto Observatory's
own components, layout, iconography and accessibility behaviour. A richer UI
extension mechanism can be justified later only with concrete workflows and an
explicit trust, isolation, performance and compatibility model.

An entirely different view of the same projected state belongs at the optional
lens boundary rather than inside every Agent card. Disabling that lens must
leave the default map, Ledger and Inspector coherent.

## Contract requirements

Every versioned plugin contract must provide:

- a manifest containing a stable plugin id, version and capability list;
- explicit configuration and health/diagnostic reporting;
- narrow typed ports for observations, proposals, commands and projections;
- Effect-based lifecycle and I/O at the boundary, with typed plugin errors;
- namespaced configuration and opaque external identifiers;
- provenance and observed-at data on every contributed fact; and
- deterministic disable/failure behaviour that leaves kernel state intact.

The normalized related-work shape should be deliberately small, for example:

```text
RelatedResource
  provider, kind, externalId, url, title, status
  target (goal | agent), observedAt, provenance
```

Provider-specific fields belong to the plugin or an explicitly namespaced
extension payload, not to a growing core union. Contracts should be serializable
so an eventual out-of-process plugin can use the same boundary.

## Boundary test

Before introducing or widening a plugin seam, verify that:

1. disabling or removing the plugin cannot corrupt accepted semantic state;
2. the plugin cannot write SQLite or bypass Universe commands;
3. unavailable, stale and failed capability states remain explicit;
4. every contributed fact retains source, observation time and uncertainty;
5. a second implementation can be added without provider-specific edits to the
   Universe, persistence or renderer;
6. the contract is narrow, typed, versioned and serializable where practical;
7. first-party and contributed implementations share contract tests; and
8. the seam represents real variation rather than a pass-through abstraction.

If these conditions cannot be met, either the boundary is in the wrong place or
the proposed capability belongs in the trusted kernel. "Everything is a plugin"
must never mean "everything can mutate everything."

## First plugin implementation

GitHub repository status is the first concrete contributed integration. Build
the smallest real plugin runtime: a validated manifest, explicit local package
configuration, versioned activation interface, registry, health diagnostics
and one `code-host` capability. The built-in GitHub plugin, a synthetic plugin
and external example all use the same loader and contract suite. Do not build a
marketplace or automatic package installation. Herdr continues to satisfy
`SessionHost`; plugin policy does not justify wrapping the working host seam in
a pass-through layer.

The deep Agent repository-status module owns trusted worktree resolution, local
Git inspection, remote correlation, caching, provenance and degraded states
behind one small interface. Provider logic must not leak into the Universe or
renderer. See [Observatory plugin system](../specs/observatory-plugin-system.md)
and
[Agent repository status and code-host plugins](../specs/agent-repository-and-code-host-plugins.md).

The next capability category justified by a concrete workflow is
`agent-harness`. It separates coding-agent lifecycle from the execution host:
Herdr remains the first `SessionHost`, while harness plugins describe how to
discover, start, identify and resume a particular CLI. Provider catalogues
recover durable or dormant conversation candidates; host snapshots recover
current executions; exact evidence joins the two. A new harness can therefore
be added without editing the Herdr adapter, launch coordinator, Universe or
renderer. Herdr's semantic state and native session restoration remain useful
optional host capabilities rather than provider policy. See
[Agent harness plugins](../specs/agent-harness-plugins.md) and
[Conversation-first Agent tracking](../specs/conversation-first-agent-tracking.md).

Provider-native activity, human-input requests, turn outcomes and context
pressure deepen that same harness capability through a versioned optional
observation source and, for live hooks, an optional receiver. The authenticated
composition-root ingress dispatches bounded events to the owning harness, then
reconciles its snapshot with host, workspace and code-host evidence.
Deterministic projections consume the result. Hook delivery is best effort and
never writes persistence or accepted Universe state directly; missing support
or delivery remains explicit. See
[Provider-native Agent observations](../specs/provider-native-agent-observations.md).
