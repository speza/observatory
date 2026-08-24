# Observatory plugin architecture

Status: proposed boundary; no general plugin runtime implemented yet  
Date: 2026-08-23  
Depends on: [Observatory technical architecture](technical-architecture.md)

## Direction

The Observatory control plane is a small trusted kernel. Every capability added
around that kernel is a plugin, including first-party capabilities such as the
Herdr agent host. GitHub pull requests, Jira or Linear issues, agent-provider
facts, extra render lenses, skills and hooks must not become special cases in
the Universe or renderer.

This is a modularity policy, not a request to build a marketplace or dynamic
loader immediately. The first implementation should establish the contracts
and composition seam; it can keep plugins local and in-process while preserving
a path to an isolated process later.

## Kernel versus plugin

The kernel owns:

- trusted goals, agents, typed relationships and lifecycle invariants;
- SQLite persistence and migrations;
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
- **Provider facts** — optional metadata from Claude Code, Codex, OpenCode, Pi
  or agent hooks/skills.
- **Related work** — GitHub pull requests, Jira issues, Linear tickets and
  similar external references attached to a goal or agent.
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

## Implementation sequence

1. Define the registry, manifest and capability-port contracts without adding a
   provider integration.
2. Compose Herdr as a first-party plugin while preserving the generic
   `SessionHost` contract tests.
3. Add a synthetic related-work plugin to prove lifecycle, provenance,
   projection and failure isolation.
4. Only then evaluate GitHub, Jira and Linear adapters against real workflows.

Until that work starts, external integrations remain deferred and no provider
logic should leak into the kernel.
