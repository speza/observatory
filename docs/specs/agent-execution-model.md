# Agent and linked execution model

Status: accepted implementation model
Date: 2026-08-24
Related: [Goal-centred agent orchestration map](../design/agent-orchestration-map.md),
[Contextual linked execution surfaces](contextual-companion-surfaces.md),
[Observatory technical architecture](../design/technical-architecture.md)

## Decision

The durable Observatory unit is an **Agent**. A host execution is a runtime
location owned by `SessionHost`; it is not a second product identity.

```text
Goal
└── Agent*
    └── host-observed linked executions*
```

An Agent is the worker a person supervises. A linked execution is a shell or
sibling agent surface that the host can expose in the context of that Agent.
Observatory does not own the process, PTY or Herdr topology.

## Durable model

`UniverseState.agents` is the authoritative durable inventory of recognised
agent work. Each observation receives one stable Observatory `AgentId`, matched
by host kind and opaque native identity.

Goals assign directly to Agents:

```text
Goal 1 ── contains ──> 0..n Agents
Agent  ── assigned to ──> 0..1 Goal
```

The existing human-controlled assignment, archive, attention and map-position
rules retain their meaning. The database is intentionally a fresh schema with
`agents` and `related_agent_dismissals`; no compatibility reader or migration
from the earlier session-shaped schema is required.

## Host model

`SessionHost` remains the only host seam. Herdr and future hosts own process
lifecycle, panes, terminals and provider attachment mechanics. They report
generic observations and capabilities; Herdr identifiers and topology remain
opaque outside the adapter.

`HostSnapshot.agents` is the host's authoritative recognised-agent inventory.
Shell-only panes are not inserted into `UniverseState.agents`. When a durable
Agent is accessed, the host may return transient `LinkedExecution` values:

```text
HostSnapshot.agents
  ├── recognised agent execution -> Universe Agent
  └── linked execution access -> shell or sibling-agent surface
```

Each linked execution has:

- `kind`: `shell` or `agent`;
- an opaque owner target identifying its parent host Agent;
- a host-owned label and optional working directory;
- an opaque terminal target and adapter-owned identity binding when available; and
- an `observed` or `prepared` source plus an explanation.

The capability list is N-sized. The first renderer presents a picker for all
available linked executions and opens the selected one as the single secondary
surface beside the primary map or Agent terminal.

Host snapshots continue while terminal surfaces are open. `Ctrl-Shift-R` forces
an immediate refresh without taking ordinary `R` input away from the focused
shell. A picker refresh revalidates its owner and replaces its rows from the
latest host capability; it closes only when no valid linked target remains.

## Shell-to-agent promotion

Promotion is observational. The person opens a linked shell and starts Claude,
Codex, Pi or another supported agent. On a later host snapshot, the host's
authoritative agent inventory includes that execution. Reconciliation then
creates or updates the normal Agent record using the same native identity; it
does not create a duplicate shell-derived identity.

```text
linked shell
  -> person starts an agent in it
  -> host reports the recognised agent
  -> Universe reconciles the same native execution as an Agent
```

Missing or ambiguous host facts remain uncertain observations. A shared
worktree or execution-container match may support a related-agent projection,
but it never silently assigns an Agent to a Goal.

## Interaction

- The map renders durable Agents as selectable satellites around Goals.
- Selecting an Agent exposes linked executions in its inspector and menu.
- The user can open a linked execution entirely inside Observatory.
- More than one linked execution opens a labelled picker; the user chooses the
  shell or sibling Agent to inspect.
- The primary surface remains visible while the selected linked surface runs.
- Selecting another Agent releases the old contextual terminal, preserving the
  normal one-primary/one-linked surface constraint.
- A linked execution that becomes recognised appears as its own Agent node after
  reconciliation; it is never duplicated as a durable linked-execution node.

The map remains the navigation surface. Terminal streams are transient
presentation surfaces, not map topology.

## Non-goals

- Observatory-owned process or PTY lifecycle.
- A general-purpose multiplexer or arbitrary nested split tree.
- Automatic Goal assignment from shared host context.
- Treating every shell pane as an Agent before the host recognises it.
- Native diff/review rendering; users can run their preferred tool in a linked
  shell.
