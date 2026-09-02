# Observatory plugin architecture

Status: accepted boundary; contributed plugin system implemented
Date: 2026-08-23  
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

## Kernel versus plugin

The kernel owns:

- trusted goals, agents, typed relationships and lifecycle invariants;
- SQLite persistence and explicit clean-break schema boundaries;
- provenance, uncertainty and human authority;
- deterministic attention and projections; and
- generic renderer and agent-host capability contracts.

Plugins own translation and optional capability. A plugin may observe external
systems, expose a capability, or propose semantic facts. It must not write
SQLite, bypass Universe commands, or turn an unverified external fact into
trusted state. The kernel can disable or lose a plugin without losing accepted
goals, agents or navigation.

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
- **Automation** — agent commands, skills and hooks that submit normal kernel
  commands or proposals.

The default map should show related work as inspector metadata or an optional
lens, not as a new required topology node. A missing integration must remain a
clear absence, not an inferred relationship.

## Contract requirements

Before adding the first external-work integration, define a versioned plugin
contract with:

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
observation source. The composition root reconciles those bounded observations
with host, workspace and code-host evidence; deterministic projections consume
the resulting snapshot. Hooks improve latency but never write persistence or
accepted Universe state, and missing support remains explicit. See
[Provider-native Agent observations](../specs/provider-native-agent-observations.md).
